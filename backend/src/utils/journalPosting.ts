import type { Types } from "mongoose";
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
  referenceType?: JournalReferenceType;
  referenceId?: Types.ObjectId | string;
  studentId?: Types.ObjectId | string;
  bankAccountId?: Types.ObjectId | string;
  isReversal?: boolean;
  reversedEntryId?: Types.ObjectId | string;
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

const generateVoucherNumber = async (schoolId: Types.ObjectId, prefix: string): Promise<string> => {
  const count = await JournalEntry.countDocuments({ schoolId });
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`;
};

export const postJournalEntry = async (params: PostJournalParams): Promise<typeof JournalEntry.prototype> => {
  await ensureDefaultChartOfAccounts(params.schoolId);

  const settings = await AccountingSettings.findOne({ schoolId: params.schoolId }).lean();
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
  const voucherNumber = await generateVoucherNumber(params.schoolId, voucherPrefix);

  return JournalEntry.create({
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
  });
};

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

  original.isDeleted = true;
  await original.save();
};

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
}): Promise<void> => {
  const paymentAccount = getPaymentAccountCode(params.paymentMethod);
  const paymentName = await getAccountName(params.schoolId, paymentAccount);

  const incomeLines: JournalLineInput[] = [];
  const breakdown = params.feeBreakdown.length > 0
    ? params.feeBreakdown
    : [{ feeType: "OTHER", title: "Fee Collection", amountNpr: params.amountPaidNpr }];

  for (const item of breakdown) {
    const incomeCode = FEE_TYPE_ACCOUNT_MAP[item.feeType as FeeType] ?? SYSTEM_ACCOUNT_CODES.OTHER_INCOME;
    incomeLines.push({
      accountCode: incomeCode,
      accountName: await getAccountName(params.schoolId, incomeCode),
      debitNpr: 0,
      creditNpr: item.amountNpr,
      description: item.title
    });
  }

  if (params.lateFeeNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.FINE_INCOME,
      accountName: await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.FINE_INCOME),
      debitNpr: 0,
      creditNpr: params.lateFeeNpr,
      description: "Late fine"
    });
  }

  if (params.discountNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
      accountName: await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE),
      debitNpr: params.discountNpr,
      creditNpr: 0,
      description: "Fee discount"
    });
  }

  if (params.scholarshipNpr > 0) {
    incomeLines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE,
      accountName: await getAccountName(params.schoolId, SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE),
      debitNpr: params.scholarshipNpr,
      creditNpr: 0,
      description: "Scholarship"
    });
  }

  const totalCredit = incomeLines.reduce((sum, line) => sum + line.creditNpr, 0);
  const totalDebit = incomeLines.reduce((sum, line) => sum + line.debitNpr, 0);
  const netAmount = totalCredit - totalDebit;

  const lines: JournalLineInput[] = [
    {
      accountCode: paymentAccount,
      accountName: paymentName,
      debitNpr: netAmount,
      creditNpr: 0,
      description: `Receipt ${params.receiptNumber}`
    },
    ...incomeLines
  ];

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
    bankAccountId: params.bankAccountId
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