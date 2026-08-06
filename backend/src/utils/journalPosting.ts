import type { ClientSession, Types } from "mongoose";
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORY_ACCOUNT_MAP,
  FEE_TYPE_ACCOUNT_MAP,
  INCOME_CATEGORY_ACCOUNT_MAP,
  PURCHASE_CATEGORY_ACCOUNT_MAP,
  SYSTEM_ACCOUNT_CODES,
  type FeeType,
  type JournalReferenceType,
  type VoucherType
} from "@phit-erp/shared";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { getFiscalYearFromBsDate } from "./fiscalYear.js";
import { nextVoucherNumber } from "./voucherNumbering.js";

interface JournalLineInput {
  accountCode: string;
  accountName: string;
  debitNpr: number;
  creditNpr: number;
  description?: string;
}

interface PostJournalParams {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  dateBs: string;
  narration: string;
  lines: JournalLineInput[];
  voucherType?: VoucherType;
  /** When set, used as journal voucherNumber (e.g. manual Goshwara no.) */
  voucherNumber?: string;
  referenceType?: JournalReferenceType;
  referenceId?: Types.ObjectId | string;
  studentId?: Types.ObjectId | string;
  bankAccountId?: Types.ObjectId | string;
  isReversal?: boolean;
  /** Year-end closing voucher — excluded from period statements, included in the balance sheet. */
  isClosingEntry?: boolean;
  reversedEntryId?: Types.ObjectId | string;
  session?: ClientSession | null;
}

const getPaymentAccountCode = (paymentMethod: string): string => {
  if (
    paymentMethod === "BANK_TRANSFER" ||
    paymentMethod === "CHEQUE" ||
    paymentMethod === "ESEWA" ||
    paymentMethod === "KHALTI" ||
    paymentMethod === "IMEPAY" ||
    paymentMethod === "FONEPAY" ||
    paymentMethod === "CONNECT_IPS" ||
    paymentMethod === "ONLINE"
  ) {
    return SYSTEM_ACCOUNT_CODES.BANK;
  }
  return SYSTEM_ACCOUNT_CODES.CASH;
};

/**
 * Schools whose default accounts have been seeded during this process.
 *
 * Seeding used to run on every single journal post — around forty upserts per receipt,
 * all of them no-ops after the first time. The default chart only changes when the code
 * changes, so seeding once per school per process is enough; a deploy that adds accounts
 * seeds them on the first post after restart.
 */
const seededSchools = new Set<string>();

/**
 * Seed missing system accounts without wiping custom ledgers.
 * Idempotent: uses $setOnInsert so existing accounts are never overwritten.
 */
export const ensureDefaultChartOfAccounts = async (
  schoolId: Types.ObjectId,
  options?: { force?: boolean }
): Promise<void> => {
  const key = schoolId.toString();
  if (!options?.force && seededSchools.has(key)) return;

  await ChartOfAccount.bulkWrite(
    DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
      updateOne: {
        filter: { schoolId, code: account.code },
        update: {
          $setOnInsert: {
            schoolId,
            code: account.code,
            name: account.name,
            nameNp: account.nameNp,
            accountType: account.accountType,
            parentCode: account.parentCode,
            isSystem: account.isSystem,
            isActive: true
          }
        },
        upsert: true
      }
    })),
    { ordered: false }
  );

  seededSchools.add(key);
};

/**
 * Resolve display names for many account codes in one query.
 *
 * Replaces a per-line `findOne`, which meant a fee receipt with five breakdown lines cost
 * five extra round trips before the voucher could even be written.
 */
const resolveAccountNames = async (
  schoolId: Types.ObjectId,
  codes: string[],
  session?: ClientSession | null
): Promise<Map<string, string>> => {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const query = ChartOfAccount.find({ schoolId, code: { $in: unique } }).select("code name");
  if (session) query.session(session);
  const accounts = await query.lean();

  return new Map(accounts.map((account) => [account.code, account.name]));
};

/**
 * Marker for "let postJournalEntry look this name up".
 *
 * Every posting helper below used to fetch its own account names before building the
 * voucher, which cost one query per line. Names are now resolved in a single batched
 * lookup inside postJournalEntry, so helpers leave the field blank.
 */
const RESOLVE_NAME = "";

export const postJournalEntry = async (params: PostJournalParams): Promise<typeof JournalEntry.prototype> => {
  await ensureDefaultChartOfAccounts(params.schoolId);

  const settingsQuery = AccountingSettings.findOne({ schoolId: params.schoolId });
  if (params.session) settingsQuery.session(params.session);
  const settings = await settingsQuery.lean();
  const fiscalYearBs = getFiscalYearFromBsDate(params.dateBs, settings?.currentFiscalYearBs);

  // Single lookup for every line that still needs a name, rather than one query per line.
  const namesNeeded = params.lines.filter((line) => !line.accountName).map((line) => line.accountCode);
  const nameMap = await resolveAccountNames(params.schoolId, namesNeeded, params.session);

  const resolvedLines = params.lines.map((line) => ({
    ...line,
    accountName: line.accountName || nameMap.get(line.accountCode) || line.accountCode
  }));

  const totalDebitNpr = resolvedLines.reduce((sum, line) => sum + line.debitNpr, 0);
  const totalCreditNpr = resolvedLines.reduce((sum, line) => sum + line.creditNpr, 0);

  if (Math.abs(totalDebitNpr - totalCreditNpr) > 0.01) {
    throw new Error("Journal entry is not balanced");
  }

  const voucherPrefix = settings?.voucherPrefix ?? "JV";
  const manualNo = params.voucherNumber?.trim();
  const voucherNumber =
    manualNo ||
    (await nextVoucherNumber({
      schoolId: params.schoolId,
      prefix: voucherPrefix,
      fiscalYearBs,
      session: params.session
    }));

  if (manualNo) {
    const existingQuery = JournalEntry.findOne({ schoolId: params.schoolId, voucherNumber: manualNo });
    if (params.session) existingQuery.session(params.session);
    const existing = await existingQuery.lean();
    if (existing) {
      throw new Error(`Voucher number ${manualNo} already exists`);
    }
  }

  const [created] = await JournalEntry.create(
    [
      {
        schoolId: params.schoolId,
        voucherNumber,
        voucherType: params.voucherType ?? "JOURNAL",
        dateBs: params.dateBs,
        fiscalYearBs,
        narration: params.narration,
        lines: resolvedLines,
        totalDebitNpr,
        totalCreditNpr,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        studentId: params.studentId,
        bankAccountId: params.bankAccountId,
        isReversal: params.isReversal ?? false,
        isClosingEntry: params.isClosingEntry ?? false,
        reversedEntryId: params.reversedEntryId,
        isPosted: true,
        createdBy: params.userId
      }
    ],
    params.session ? { session: params.session } : undefined
  );
  return created;
};

/**
 * Reverse all journal entries for a domain reference (FeeCollection, AccountingExpense, etc.).
 * Purchases may have two posts (purchase + AP settlement) — both must reverse on void.
 * Keeps originals posted so original + reversal net to zero in GL reports.
 */
export const reverseJournalEntry = async (
  schoolId: Types.ObjectId,
  userId: Types.ObjectId,
  referenceType: JournalReferenceType,
  referenceId: Types.ObjectId | string
): Promise<void> => {
  const originals = await JournalEntry.find({
    schoolId,
    referenceType,
    referenceId,
    isReversal: false,
    isDeleted: false,
    isReversed: { $ne: true }
  }).sort({ createdAt: 1 });

  if (originals.length === 0) return;

  for (const original of originals) {
    const existingReversal = await JournalEntry.findOne({
      schoolId,
      reversedEntryId: original._id,
      isReversal: true,
      isDeleted: false
    }).lean();
    if (existingReversal) {
      original.isReversed = true;
      await original.save();
      continue;
    }

    const reversalLines = original.lines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      debitNpr: line.creditNpr,
      creditNpr: line.debitNpr,
      description: `Reversal: ${line.description ?? ""}`
    }));

    await postJournalEntry({
      schoolId,
      userId,
      dateBs: original.dateBs,
      narration: `Reversal of ${original.voucherNumber}`,
      lines: reversalLines,
      voucherType: original.voucherType as VoucherType,
      referenceType,
      referenceId,
      studentId: original.studentId ?? undefined,
      bankAccountId: original.bankAccountId ?? undefined,
      isReversal: true,
      reversedEntryId: original._id
    });

    // Do NOT soft-delete original — both stay posted so reports net correctly.
    original.isReversed = true;
    await original.save();
  }
};

/** Reverse a journal entry by its own Mongo id (manual journals, etc.). */
export const reverseJournalEntryById = async (
  schoolId: Types.ObjectId,
  userId: Types.ObjectId,
  journalEntryId: Types.ObjectId | string
): Promise<void> => {
  const original = await JournalEntry.findOne({
    _id: journalEntryId,
    schoolId,
    isReversal: false,
    isDeleted: false
  });
  if (!original) {
    throw new Error("Journal entry not found or already reversed");
  }

  const existingReversal = await JournalEntry.findOne({
    schoolId,
    reversedEntryId: original._id,
    isReversal: true,
    isDeleted: false
  }).lean();
  if (existingReversal) return;

  const reversalLines = original.lines.map((line) => ({
    accountCode: line.accountCode,
    accountName: line.accountName,
    debitNpr: line.creditNpr,
    creditNpr: line.debitNpr,
    description: `Reversal: ${line.description ?? ""}`
  }));

  await postJournalEntry({
    schoolId,
    userId,
    dateBs: original.dateBs,
    narration: `Reversal of ${original.voucherNumber}`,
    lines: reversalLines,
    voucherType: original.voucherType as VoucherType,
    referenceType: original.referenceType ?? "Manual",
    referenceId: original.referenceId ?? original._id,
    studentId: original.studentId ?? undefined,
    bankAccountId: original.bankAccountId ?? undefined,
    isReversal: true,
    reversedEntryId: original._id
  });

  original.isReversed = true;
  await original.save();
};

/**
 * Cash-basis fee collection journal:
 * Dr Cash/Bank = amountPaidNpr + securityDepositPaidNpr
 * Dr Discount / Scholarship expenses
 * Cr Fee income (scaled) + Fine income
 * Cr Security deposit liability (if deposit collected)
 * So cash book amount and GL cash debit always match total cash received.
 */
export const postFeeCollectionJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  collectionId: Types.ObjectId | string;
  studentId: Types.ObjectId | string;
  dateBs: string;
  amountPaidNpr: number;
  /** Security deposit collected with this receipt (liability credit). */
  securityDepositPaidNpr?: number;
  discountNpr: number;
  scholarshipNpr: number;
  lateFeeNpr: number;
  paymentMethod: string;
  bankAccountId?: Types.ObjectId | string;
  receiptNumber: string;
  feeBreakdown: Array<{ feeType: string; title: string; amountNpr: number }>;
  session?: ClientSession | null;
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const paymentName = RESOLVE_NAME;

  const discountNpr = Math.max(0, params.discountNpr);
  const scholarshipNpr = Math.max(0, params.scholarshipNpr);
  const lateFeeNpr = Math.max(0, params.lateFeeNpr);
  const amountPaidNpr = Math.max(0, params.amountPaidNpr);
  const securityDepositPaidNpr = Math.max(0, params.securityDepositPaidNpr ?? 0);
  const cashDebit = amountPaidNpr + securityDepositPaidNpr;

  // Fee income credit so entry balances for the fee portion only:
  // Cash(fee) + discount + scholarship = fee income + late fee
  const feeIncomeCredit = Math.max(0, amountPaidNpr + discountNpr + scholarshipNpr - lateFeeNpr);

  // Exclude SECURITY_DEPOSIT lines from fee income allocation (handled as liability)
  const incomeBreakdown = (params.feeBreakdown.length > 0
    ? params.feeBreakdown
    : [{ feeType: "OTHER", title: "Fee Collection", amountNpr: feeIncomeCredit }]
  ).filter((item) => String(item.feeType) !== "SECURITY_DEPOSIT");

  const breakdownTotal = incomeBreakdown.reduce((sum, item) => sum + item.amountNpr, 0);
  const incomeLines: JournalLineInput[] = [];

  if (feeIncomeCredit > 0) {
    if (breakdownTotal > 0) {
      let allocated = 0;
      incomeBreakdown.forEach((item, index) => {
        const isLast = index === incomeBreakdown.length - 1;
        const share = isLast
          ? Number((feeIncomeCredit - allocated).toFixed(2))
          : Number(((item.amountNpr / breakdownTotal) * feeIncomeCredit).toFixed(2));
        allocated += share;
        if (share <= 0) return;
        const incomeCode = FEE_TYPE_ACCOUNT_MAP[item.feeType as FeeType] ?? SYSTEM_ACCOUNT_CODES.OTHER_INCOME;
        incomeLines.push({
          accountCode: incomeCode,
          accountName: "",
          debitNpr: 0,
          creditNpr: share,
          description: item.title
        });
      });
    } else {
      incomeLines.push({
        accountCode: SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
        accountName: "",
        debitNpr: 0,
        creditNpr: feeIncomeCredit,
        description: "Fee Collection"
      });
    }
  }

  if (lateFeeNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.FINE_INCOME,
      accountName: "",
      debitNpr: 0,
      creditNpr: lateFeeNpr,
      description: "Late fine"
    });
  }

  if (securityDepositPaidNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY,
      accountName: "",
      debitNpr: 0,
      creditNpr: securityDepositPaidNpr,
      description: "Security / caution deposit held"
    });
  }

  if (discountNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
      accountName: "",
      debitNpr: discountNpr,
      creditNpr: 0,
      description: "Fee discount"
    });
  }

  if (scholarshipNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE,
      accountName: "",
      debitNpr: scholarshipNpr,
      creditNpr: 0,
      description: "Scholarship"
    });
  }

  // Skip empty journal (e.g. pure scholarship with 0 cash and 0 deposit)
  if (cashDebit <= 0 && incomeLines.every((l) => l.debitNpr <= 0 && l.creditNpr <= 0)) {
    return;
  }

  const lines: JournalLineInput[] = [
    ...(cashDebit > 0
      ? [
          {
            accountCode: paymentAccount,
            accountName: paymentName,
            debitNpr: cashDebit,
            creditNpr: 0,
            description: `Receipt ${params.receiptNumber}`
          }
        ]
      : []),
    ...incomeLines
  ];

  // Ensure balance (floating point safety)
  const totalDebit = lines.reduce((sum, line) => sum + line.debitNpr, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.creditNpr, 0);
  const drift = Number((totalDebit - totalCredit).toFixed(2));
  if (Math.abs(drift) > 0 && Math.abs(drift) <= 0.05 && incomeLines.length > 0) {
    const lastIncome = incomeLines[incomeLines.length - 1]!;
    if (lastIncome.creditNpr > 0) lastIncome.creditNpr = Number((lastIncome.creditNpr + drift).toFixed(2));
    else lastIncome.debitNpr = Number((lastIncome.debitNpr - drift).toFixed(2));
  }

  const hasDeposit = securityDepositPaidNpr > 0;
  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: hasDeposit
      ? `Fee + security deposit — Receipt ${params.receiptNumber}`
      : `Fee collection — Receipt ${params.receiptNumber}`,
    lines,
    voucherType: "RECEIPT",
    referenceType: "FeeCollection",
    referenceId: params.collectionId,
    studentId: params.studentId,
    bankAccountId: params.bankAccountId,
    session: params.session
  });
};

export const postFeeRefundJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  refundId: Types.ObjectId | string;
  studentId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  paymentMethod: string;
  bankAccountId?: Types.ObjectId | string;
  refundNumber: string;
  /** When true, reverse liability (security deposit) instead of refund expense. */
  isDepositRefund?: boolean;
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const paymentName = RESOLVE_NAME;

  if (params.isDepositRefund) {
    // Dr Security deposit liability · Cr Cash/Bank
    const liabilityName = RESOLVE_NAME;
    await postJournalEntry({
      schoolId: params.schoolId,
      userId: params.userId,
      dateBs: params.dateBs,
      narration: `Security deposit refund — ${params.refundNumber}`,
      lines: [
        {
          accountCode: SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY,
          accountName: liabilityName,
          debitNpr: params.amountNpr,
          creditNpr: 0,
          description: "Security deposit returned"
        },
        {
          accountCode: paymentAccount,
          accountName: paymentName,
          debitNpr: 0,
          creditNpr: params.amountNpr,
          description: `Deposit refund ${params.refundNumber}`
        }
      ],
      voucherType: "PAYMENT",
      referenceType: "FeeRefund",
      referenceId: params.refundId,
      studentId: params.studentId,
      bankAccountId: params.bankAccountId
    });
    return;
  }

  // Spec: Debit Refund Expense · Credit Cash/Bank
  const refundExpenseName = RESOLVE_NAME;

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Student refund — ${params.refundNumber}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNT_CODES.REFUND_EXPENSE,
        accountName: refundExpenseName,
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: "Refund expense"
      },
      {
        accountCode: paymentAccount,
        accountName: paymentName,
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: `Refund ${params.refundNumber}`
      }
    ],
    voucherType: "PAYMENT",
    referenceType: "FeeRefund",
    referenceId: params.refundId,
    studentId: params.studentId,
    bankAccountId: params.bankAccountId
  });
};

export const postExpenseJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  expenseId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  category: string;
  paymentMethod: string;
  description: string;
}): Promise<void> => {
  const expenseCode = EXPENSE_CATEGORY_ACCOUNT_MAP[params.category] ?? SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE;
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: params.description,
    lines: [
      {
        accountCode: expenseCode,
        accountName: "",
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: params.category
      },
      {
        accountCode: paymentAccount,
        accountName: "",
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: "Payment"
      }
    ],
    voucherType: "PAYMENT",
    referenceType: "AccountingExpense",
    referenceId: params.expenseId
  });
};

export const postIncomeJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  incomeId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  category: string;
  paymentMethod: string;
  description: string;
}): Promise<void> => {
  const incomeCode = INCOME_CATEGORY_ACCOUNT_MAP[params.category] ?? SYSTEM_ACCOUNT_CODES.OTHER_INCOME;
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: params.description,
    lines: [
      {
        accountCode: paymentAccount,
        accountName: "",
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: "Receipt"
      },
      {
        accountCode: incomeCode,
        accountName: "",
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: params.category
      }
    ],
    voucherType: "RECEIPT",
    referenceType: "AccountingIncome",
    referenceId: params.incomeId
  });
};

export const postPurchaseJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  purchaseId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  category: string;
  paymentStatus: string;
  paymentMethod: string;
  vendor: string;
}): Promise<void> => {
  const expenseCode =
    PURCHASE_CATEGORY_ACCOUNT_MAP[params.category] ??
    SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE;
  const isPaid = params.paymentStatus === "PAID";

  const creditLine: JournalLineInput = isPaid
    ? {
        accountCode: getPaymentAccountCode(params.paymentMethod),
        accountName: "",
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: "Payment"
      }
    : {
        accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
        accountName: "",
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: `Payable — ${params.vendor}`
      };

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Purchase — ${params.vendor}`,
    lines: [
      {
        accountCode: expenseCode,
        accountName: "",
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: params.category
      },
      creditLine
    ],
    voucherType: "PURCHASE",
    referenceType: "AccountingPurchase",
    referenceId: params.purchaseId
  });
};

/**
 * When a pending purchase is marked PAID: settle Accounts Payable.
 * Dr Accounts Payable · Cr Cash/Bank
 * (Expense was already debited on original purchase voucher.)
 */
export const postPurchasePaymentJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  purchaseId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  paymentMethod: string;
  vendor: string;
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const apCode = SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE;

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Purchase payment — ${params.vendor}`,
    lines: [
      {
        accountCode: apCode,
        accountName: "",
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: `Settle payable — ${params.vendor}`
      },
      {
        accountCode: paymentAccount,
        accountName: "",
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: "Payment"
      }
    ],
    voucherType: "PAYMENT",
    referenceType: "AccountingPurchase",
    referenceId: params.purchaseId
  });
};

/**
 * Salary payment journal.
 *
 * `amountNpr` is the NET paid to the employee and `taxNpr` the 1% tax withheld from them.
 * Salary expense must be recognised GROSS (net + tax) with the withheld amount sitting in
 * TDS Payable until it is deposited with the IRD — previously the whole voucher was posted
 * at net, so salary expense was understated and the tax the institution had collected but
 * not yet remitted appeared nowhere on the balance sheet.
 *
 * Cash/bank is still credited with the net amount only, so the cash book is unchanged.
 * When `taxNpr` is zero or omitted the voucher is identical to the previous behaviour.
 */
export const postSalaryJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  salaryId: Types.ObjectId | string;
  dateBs: string;
  /** Net salary actually paid out. */
  amountNpr: number;
  /** Tax withheld from the employee (SalaryPayment.taxNpr). */
  taxNpr?: number;
  paymentMethod: string;
  monthBs: string;
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const netNpr = Math.max(0, params.amountNpr);
  const taxNpr = Math.max(0, params.taxNpr ?? 0);
  const grossNpr = Number((netNpr + taxNpr).toFixed(2));

  const lines: JournalLineInput[] = [
    {
      accountCode: SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE,
      accountName: "",
      debitNpr: grossNpr,
      creditNpr: 0,
      description: "Salary"
    }
  ];

  if (taxNpr > 0) {
    lines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.TDS_PAYABLE,
      accountName: "",
      debitNpr: 0,
      creditNpr: taxNpr,
      description: `Tax withheld — ${params.monthBs}`
    });
  }

  if (netNpr > 0) {
    lines.push({
      accountCode: paymentAccount,
      accountName: "",
      debitNpr: 0,
      creditNpr: netNpr,
      description: "Payment"
    });
  }

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Salary payment — ${params.monthBs}`,
    lines,
    voucherType: "PAYMENT",
    referenceType: "SalaryPayment",
    referenceId: params.salaryId
  });
};