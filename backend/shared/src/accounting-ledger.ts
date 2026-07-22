import { z } from "zod";
import { ACCOUNT_TYPES, FEE_TYPE_ACCOUNT_MAP, JOURNAL_REFERENCE_TYPES, VOUCHER_TYPES } from "./accounting-constants.js";
import { bsDateSchema, moneySchema, objectIdSchema, optionalObjectIdSchema } from "./schemas.js";

export const chartOfAccountSchema = z.object({
  code: z.string().min(3).max(10),
  name: z.string().min(2),
  nameNp: z.string().optional().or(z.literal("")),
  accountType: z.enum(ACCOUNT_TYPES),
  parentCode: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true)
});

export const journalLineSchema = z.object({
  accountCode: z.string().min(3),
  accountName: z.string().min(1),
  debitNpr: moneySchema.default(0),
  creditNpr: moneySchema.default(0),
  description: z.string().optional().or(z.literal(""))
});

export const journalEntrySchema = z.object({
  voucherType: z.enum(VOUCHER_TYPES).default("JOURNAL"),
  dateBs: bsDateSchema,
  fiscalYearBs: z.string().regex(/^\d{4}\/\d{4}$/),
  narration: z.string().min(1),
  lines: z.array(journalLineSchema).min(2),
  referenceType: z.enum(JOURNAL_REFERENCE_TYPES).optional(),
  referenceId: optionalObjectIdSchema,
  studentId: optionalObjectIdSchema,
  bankAccountId: optionalObjectIdSchema
}).superRefine((value, ctx) => {
  const totalDebit = value.lines.reduce((sum, line) => sum + line.debitNpr, 0);
  const totalCredit = value.lines.reduce((sum, line) => sum + line.creditNpr, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    ctx.addIssue({ code: "custom", message: "Journal entry must balance (total debit = total credit)", path: ["lines"] });
  }
  if (totalDebit <= 0) {
    ctx.addIssue({ code: "custom", message: "Journal entry must have a positive amount", path: ["lines"] });
  }
});

export const vendorSchema = z.object({
  name: z.string().min(2),
  panNumber: z.string().optional().or(z.literal("")),
  vatNumber: z.string().optional().or(z.literal("")),
  contactPerson: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true)
});

export const FEE_REFUND_TYPES = [
  "DEPOSIT_REFUND",
  "OVERPAYMENT",
  "FEE_ADJUSTMENT",
  "WITHDRAWAL",
  "OTHER"
] as const;

export type FeeRefundType = (typeof FEE_REFUND_TYPES)[number];

export const FEE_REFUND_TYPE_LABELS: Record<FeeRefundType, string> = {
  DEPOSIT_REFUND: "Admission deposit (pass-out)",
  OVERPAYMENT: "Overpayment refund",
  FEE_ADJUSTMENT: "Fee adjustment refund",
  WITHDRAWAL: "Withdrawal refund",
  OTHER: "Other student refund"
};

export const feeRefundSchema = z.object({
  studentId: objectIdSchema,
  feeCollectionId: optionalObjectIdSchema,
  refundType: z.enum(FEE_REFUND_TYPES).default("OTHER"),
  amountNpr: moneySchema,
  dateBs: bsDateSchema,
  reason: z.string().min(1),
  paymentMethod: z
    .enum(["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"])
    .default("CASH"),
  bankAccountId: optionalObjectIdSchema,
  transactionNumber: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  approvedBy: z.string().optional().or(z.literal("")),
  /**
   * When recording a deposit refund, set or confirm the original admission deposit
   * if it was never stored on the student record.
   */
  originalDepositNpr: moneySchema.optional(),
  attachments: z
    .array(
      z.object({
        name: z.string().optional().or(z.literal("")),
        url: z.string().min(1),
        mimeType: z.string().optional().or(z.literal("")),
        size: z.coerce.number().optional()
      })
    )
    .optional()
    .default([])
});

export const fiscalYearSchema = z.object({
  yearBs: z.string().regex(/^\d{4}\/\d{4}$/),
  startDateBs: bsDateSchema,
  endDateBs: bsDateSchema,
  isCurrent: z.boolean().default(false),
  isClosed: z.boolean().default(false)
});

/** Create Goshwara voucher + linked balanced journal entry — all header fields manual */
export const goshwaraVoucherSchema = z.object({
  voucherType: z.enum(VOUCHER_TYPES).default("JOURNAL"),
  dateBs: bsDateSchema,
  /** Manual गो. भी. नं. — leave blank to auto-generate */
  voucherNo: z.string().optional().or(z.literal("")),
  /**
   * Under "नेपाल सरकार": government office line, printed as "{name} कार्यालय"
   * e.g. blank or "जिल्ला शिक्षा"
   */
  govOfficeName: z.string().optional().or(z.literal("")),
  /** Under office line — e.g. पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी */
  instituteName: z.string().optional().or(z.literal("")),
  /** Under institute — e.g. धनगढीमाई वडा नं. ३ */
  addressLine: z.string().optional().or(z.literal("")),
  /** Narration / main particulars */
  particulars: z.string().min(1),
  /** Optional free-text table rows for PDF (sn, विवरण, खाता, हि.नं., debit, credit) */
  printLines: z
    .array(
      z.object({
        sn: z.string().optional().or(z.literal("")),
        particulars: z.string().optional().or(z.literal("")),
        account: z.string().optional().or(z.literal("")),
        ledgerNo: z.string().optional().or(z.literal("")),
        debit: z.coerce.number().min(0).optional(),
        credit: z.coerce.number().min(0).optional()
      })
    )
    .optional(),
  /** Bottom-section optional fields (printed only if filled) */
  receiptNo: z.string().optional().or(z.literal("")),
  receivedAmount: z.string().optional().or(z.literal("")),
  presenterName: z.string().optional().or(z.literal("")),
  presenterRank: z.string().optional().or(z.literal("")),
  chequeNo: z.string().optional().or(z.literal("")),
  chequeAmount: z.string().optional().or(z.literal("")),
  chequePresenter: z.string().optional().or(z.literal("")),
  chequeDate: z.string().optional().or(z.literal("")),
  chequeRank: z.string().optional().or(z.literal("")),
  amountInWords: z.string().optional().or(z.literal("")),
  /** Journal lines for GL (must balance) */
  lines: z.array(journalLineSchema).min(2)
}).superRefine((value, ctx) => {
  const totalDebit = value.lines.reduce((sum, line) => sum + line.debitNpr, 0);
  const totalCredit = value.lines.reduce((sum, line) => sum + line.creditNpr, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    ctx.addIssue({
      code: "custom",
      message: "Voucher must balance (total debit = total credit)",
      path: ["lines"]
    });
  }
  if (totalDebit <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "Voucher must have a positive amount",
      path: ["lines"]
    });
  }
  for (const [index, line] of value.lines.entries()) {
    const hasDebit = line.debitNpr > 0;
    const hasCredit = line.creditNpr > 0;
    if (hasDebit === hasCredit) {
      ctx.addIssue({
        code: "custom",
        message: "Each line must have either debit or credit (not both/neither)",
        path: ["lines", index]
      });
    }
  }
});

export type ChartOfAccountInput = z.infer<typeof chartOfAccountSchema>;
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type VendorInput = z.infer<typeof vendorSchema>;
export type FeeRefundInput = z.infer<typeof feeRefundSchema>;
export type FiscalYearInput = z.infer<typeof fiscalYearSchema>;
export type GoshwaraVoucherInput = z.infer<typeof goshwaraVoucherSchema>;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type VoucherType = (typeof VOUCHER_TYPES)[number];
export type JournalReferenceType = (typeof JOURNAL_REFERENCE_TYPES)[number];

export interface ChartOfAccountRecord {
  _id: string;
  schoolId: string;
  code: string;
  name: string;
  nameNp?: string;
  accountType: AccountType;
  parentCode?: string;
  description?: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface JournalLineRecord {
  accountCode: string;
  accountName: string;
  debitNpr: number;
  creditNpr: number;
  description?: string;
}

export interface JournalEntryRecord {
  _id: string;
  schoolId: string;
  voucherNumber: string;
  voucherType: VoucherType;
  dateBs: string;
  fiscalYearBs: string;
  narration: string;
  lines: JournalLineRecord[];
  totalDebitNpr: number;
  totalCreditNpr: number;
  referenceType?: JournalReferenceType;
  referenceId?: string;
  studentId?: string;
  bankAccountId?: string;
  isReversal: boolean;
  /** True when a reversal entry has been posted against this original. */
  isReversed?: boolean;
  reversedEntryId?: string;
  isPosted: boolean;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface VendorRecord {
  _id: string;
  schoolId: string;
  name: string;
  panNumber?: string;
  vatNumber?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeeRefundRecord {
  _id: string;
  schoolId: string;
  studentId: string;
  feeCollectionId?: string;
  refundNumber: string;
  refundType?: FeeRefundType;
  amountNpr: number;
  dateBs: string;
  reason: string;
  paymentMethod: string;
  bankAccountId?: string;
  transactionNumber?: string;
  notes?: string;
  approvedBy?: string;
  attachments?: Array<{ name?: string; url: string; mimeType?: string; size?: number }>;
  journalEntryId?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FiscalYearRecord {
  _id: string;
  schoolId: string;
  yearBs: string;
  startDateBs: string;
  endDateBs: string;
  isCurrent: boolean;
  isClosed: boolean;
  closedAt?: string;
  closedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GoshwaraPrintLineRecord {
  sn?: string;
  particulars?: string;
  account?: string;
  ledgerNo?: string;
  debit?: number;
  credit?: number;
}

export interface GoshwaraVoucherRecord {
  _id: string;
  schoolId: string;
  voucherNo: string;
  voucherType: VoucherType;
  dateBs: string;
  fiscalYearBs: string;
  particulars: string;
  /** @deprecated use govOfficeName / instituteName */
  officeName?: string;
  govOfficeName?: string;
  instituteName?: string;
  addressLine?: string;
  printLines?: GoshwaraPrintLineRecord[];
  receiptNo?: string;
  receivedAmount?: string;
  presenterName?: string;
  presenterRank?: string;
  chequeNo?: string;
  chequeAmount?: string;
  chequePresenter?: string;
  chequeDate?: string;
  chequeRank?: string;
  amountInWords?: string;
  lines: JournalLineRecord[];
  totalAmount: number;
  totalDebitNpr: number;
  totalCreditNpr: number;
  journalEntryId: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitNpr: number;
  creditNpr: number;
}

export interface LedgerAccountRow {
  dateBs: string;
  voucherNumber: string;
  narration: string;
  debitNpr: number;
  creditNpr: number;
  balanceNpr: number;
}

export interface StudentLedgerSummary {
  studentId: string;
  admissionNumber: string;
  rollNumber: number;
  fullName: string;
  batchName: string;
  yearName: string;
  guardianName: string;
  scholarshipStatus: string;
  status: string;
  totalPayableNpr: number;
  totalPaidNpr: number;
  outstandingBalanceNpr: number;
  totalDiscountNpr: number;
  totalScholarshipNpr: number;
  totalFineNpr: number;
  advanceBalanceNpr: number;
  totalRefundsNpr: number;
}

export { FEE_TYPE_ACCOUNT_MAP };