import type { ClientSession, Types } from "mongoose";
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORY_ACCOUNT_MAP,
  FEE_TYPE_ACCOUNT_MAP,
  INCOME_CATEGORY_ACCOUNT_MAP,
  SYSTEM_ACCOUNT_CODES,
  type FeeType,
  type JournalReferenceType,
  type VoucherType
} from "@phit-erp/shared";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { getFiscalYearFromBsDate } from "./fiscalYear.js";

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
  reversedEntryId?: Types.ObjectId | string;
  session?: ClientSession | null;
}

const getPaymentAccountCode = (paymentMethod: string): string => {
  if (paymentMethod === "BANK_TRANSFER" || paymentMethod === "CHEQUE" || paymentMethod === "FONEPAY") {
    return SYSTEM_ACCOUNT_CODES.BANK;
  }
  return SYSTEM_ACCOUNT_CODES.CASH;
};

export const ensureDefaultChartOfAccounts = async (schoolId: Types.ObjectId): Promise<void> => {
  const existing = await ChartOfAccount.countDocuments({ schoolId });
  if (existing > 0) return;

  await ChartOfAccount.insertMany(
    DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
      schoolId,
      ...account
    }))
  );
};

const getAccountName = async (schoolId: Types.ObjectId, code: string): Promise<string> => {
  const account = await ChartOfAccount.findOne({ schoolId, code }).lean();
  return account?.name ?? code;
};

const generateVoucherNumber = async (
  schoolId: Types.ObjectId,
  prefix: string,
  session?: ClientSession | null
): Promise<string> => {
  const countQuery = JournalEntry.countDocuments({ schoolId });
  if (session) countQuery.session(session);
  const count = await countQuery;
  const year = new Date().getFullYear();
  // Suffix reduces collision under concurrent cashiers even if count races
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${year}-${String(count + 1).padStart(5, "0")}-${suffix}`;
};

export const postJournalEntry = async (params: PostJournalParams): Promise<typeof JournalEntry.prototype> => {
  await ensureDefaultChartOfAccounts(params.schoolId);

  const settingsQuery = AccountingSettings.findOne({ schoolId: params.schoolId });
  if (params.session) settingsQuery.session(params.session);
  const settings = await settingsQuery.lean();
  const fiscalYearBs = getFiscalYearFromBsDate(params.dateBs, settings?.currentFiscalYearBs);

  const resolvedLines = await Promise.all(
    params.lines.map(async (line) => ({
      ...line,
      accountName: line.accountName || (await getAccountName(params.schoolId, line.accountCode))
    }))
  );

  const totalDebitNpr = resolvedLines.reduce((sum, line) => sum + line.debitNpr, 0);
  const totalCreditNpr = resolvedLines.reduce((sum, line) => sum + line.creditNpr, 0);

  if (Math.abs(totalDebitNpr - totalCreditNpr) > 0.01) {
    throw new Error("Journal entry is not balanced");
  }

  const voucherPrefix = settings?.voucherPrefix ?? "JV";
  const manualNo = params.voucherNumber?.trim();
  const voucherNumber =
    manualNo || (await generateVoucherNumber(params.schoolId, voucherPrefix, params.session));

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
 * Reverse a journal entry by domain reference (FeeCollection, AccountingExpense, etc.).
 * Keeps the original posted (not soft-deleted) so original + reversal net to zero in GL reports.
 */
export const reverseJournalEntry = async (
  schoolId: Types.ObjectId,
  userId: Types.ObjectId,
  referenceType: JournalReferenceType,
  referenceId: Types.ObjectId | string
): Promise<void> => {
  const original = await JournalEntry.findOne({
    schoolId,
    referenceType,
    referenceId,
    isReversal: false,
    isDeleted: false
  });

  if (!original) return;

  // Already reversed
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
 * Dr Cash/Bank = amountPaidNpr
 * Dr Discount / Scholarship expenses
 * Cr Fee income (scaled) + Fine income
 * So cash book amount and GL cash debit always match amountPaidNpr.
 */
export const postFeeCollectionJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  collectionId: Types.ObjectId | string;
  studentId: Types.ObjectId | string;
  dateBs: string;
  amountPaidNpr: number;
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
  const paymentName = await getAccountName(params.schoolId, paymentAccount);

  const discountNpr = Math.max(0, params.discountNpr);
  const scholarshipNpr = Math.max(0, params.scholarshipNpr);
  const lateFeeNpr = Math.max(0, params.lateFeeNpr);
  const amountPaidNpr = Math.max(0, params.amountPaidNpr);

  // Fee income credit so entry balances: Cash + discount + scholarship = fee income + late fee
  const feeIncomeCredit = Math.max(0, amountPaidNpr + discountNpr + scholarshipNpr - lateFeeNpr);

  const breakdown = params.feeBreakdown.length > 0
    ? params.feeBreakdown
    : [{ feeType: "OTHER", title: "Fee Collection", amountNpr: feeIncomeCredit }];

  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.amountNpr, 0);
  const incomeLines: JournalLineInput[] = [];

  if (feeIncomeCredit > 0) {
    if (breakdownTotal > 0) {
      let allocated = 0;
      breakdown.forEach((item, index) => {
        const isLast = index === breakdown.length - 1;
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
        accountCode: SYSTEM_ACCOUNT_CODES.FEE_INCOME,
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

  // Resolve account names
  for (const line of incomeLines) {
    line.accountName = await getAccountName(params.schoolId, line.accountCode);
  }

  const lines: JournalLineInput[] = [
    {
      accountCode: paymentAccount,
      accountName: paymentName,
      debitNpr: amountPaidNpr,
      creditNpr: 0,
      description: `Receipt ${params.receiptNumber}`
    },
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

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Fee collection — Receipt ${params.receiptNumber}`,
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
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const paymentName = await getAccountName(params.schoolId, paymentAccount);
  const incomeName = await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.FEE_INCOME);

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Fee refund — ${params.refundNumber}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNT_CODES.FEE_INCOME,
        accountName: incomeName,
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: "Fee refund"
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
        accountName: await getAccountName(params.schoolId, expenseCode),
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: params.category
      },
      {
        accountCode: paymentAccount,
        accountName: await getAccountName(params.schoolId, paymentAccount),
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
        accountName: await getAccountName(params.schoolId, paymentAccount),
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: "Receipt"
      },
      {
        accountCode: incomeCode,
        accountName: await getAccountName(params.schoolId, incomeCode),
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
  const expenseCode = SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE;
  const isPaid = params.paymentStatus === "PAID";

  const creditLine: JournalLineInput = isPaid
    ? {
        accountCode: getPaymentAccountCode(params.paymentMethod),
        accountName: await getAccountName(params.schoolId, getPaymentAccountCode(params.paymentMethod)),
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: "Payment"
      }
    : {
        accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
        accountName: await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE),
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
        accountName: await getAccountName(params.schoolId, expenseCode),
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

export const postSalaryJournal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  salaryId: Types.ObjectId | string;
  dateBs: string;
  amountNpr: number;
  paymentMethod: string;
  monthBs: string;
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);

  await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Salary payment — ${params.monthBs}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE,
        accountName: await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE),
        debitNpr: params.amountNpr,
        creditNpr: 0,
        description: "Salary"
      },
      {
        accountCode: paymentAccount,
        accountName: await getAccountName(params.schoolId, paymentAccount),
        debitNpr: 0,
        creditNpr: params.amountNpr,
        description: "Payment"
      }
    ],
    voucherType: "PAYMENT",
    referenceType: "SalaryPayment",
    referenceId: params.salaryId
  });
};