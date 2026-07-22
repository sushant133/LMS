import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  FEE_STRUCTURE_STATUSES,
  FEE_TYPES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PURCHASE_CATEGORIES
} from "./constants.js";
import { addressSchema, academicYearSchema, bsDateSchema, moneySchema, objectIdSchema, optionalObjectIdSchema } from "./schemas.js";

export const feeBreakdownItemSchema = z.object({
  feeType: z.enum(FEE_TYPES),
  title: z.string().min(1),
  amountNpr: moneySchema
});

export const feeAttachmentSchema = z.object({
  name: z.string().optional().or(z.literal("")),
  url: z.string().min(1),
  mimeType: z.string().optional().or(z.literal("")),
  size: z.coerce.number().optional(),
  kind: z
    .enum(["BANK_VOUCHER", "PAYMENT_SCREENSHOT", "INVOICE", "RECEIPT_SLIP", "OTHER"])
    .optional()
    .default("OTHER")
});

export const enhancedFeeCollectionSchema = z.object({
  studentId: objectIdSchema,
  feeStructureId: optionalObjectIdSchema,
  receiptNumber: z.string().optional(),
  paidDateBs: bsDateSchema,
  academicYearBs: z.string().optional(),
  semesterBs: z.string().optional(),
  /** HA / multi-year: 1 = 1st year, 2 = 2nd year, 3 = 3rd year */
  programYear: z.coerce.number().int().min(1).max(3).optional(),
  currentChargesNpr: moneySchema.default(0),
  amountPaidNpr: moneySchema,
  discountNpr: moneySchema.default(0),
  scholarshipNpr: moneySchema.default(0),
  scholarshipType: z
    .enum(["NONE", "TOPPER_YEAR_WAIVER", "MERIT", "OTHER"])
    .optional()
    .default("NONE"),
  lateFeeNpr: moneySchema.default(0),
  advancePaymentNpr: moneySchema.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  bankAccountId: optionalObjectIdSchema,
  transactionNumber: z.string().optional().or(z.literal("")),
  feeBreakdown: z.array(feeBreakdownItemSchema).default([]),
  attachments: z.array(feeAttachmentSchema).optional().default([]),
  isInstallment: z.boolean().default(false),
  installmentNumber: z.coerce.number().int().min(1).optional(),
  totalInstallments: z.coerce.number().int().min(1).optional(),
  notes: z.string().optional(),
  /** When recording a topper scholarship with this payment */
  scholarshipAwardId: optionalObjectIdSchema
});

export const studentScholarshipAwardSchema = z.object({
  studentId: objectIdSchema,
  toppedProgramYear: z.coerce.number().int().min(1).max(3),
  coversProgramYear: z.coerce.number().int().min(1).max(3).optional(),
  academicYearBs: z.string().optional().or(z.literal("")),
  examName: z.string().optional().or(z.literal("")),
  rank: z.coerce.number().int().min(1).optional(),
  waiverType: z.enum(["FULL", "PARTIAL"]).default("FULL"),
  amountNpr: moneySchema.default(0),
  reason: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal(""))
});

export const accountantSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().trim().min(3, "Login ID must be at least 3 characters"),
  phone: z.string().optional().or(z.literal("")),
  password: z.string().min(6).optional(),
  employeeId: z.string().min(1),
  gender: z.string().min(1),
  address: addressSchema,
  joinedDateBs: bsDateSchema,
  photoUrl: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

export const accountingExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  /** Optional for legacy; new daily expenses often omit vendor */
  vendor: z.string().optional().or(z.literal("")).default(""),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().min(1),
  voucherNumber: z.string().optional().or(z.literal("")),
  approvedBy: z.string().optional().or(z.literal("")),
  attachmentUrl: z.string().optional().or(z.literal(""))
});

export const accountingPurchaseSchema = z.object({
  category: z.enum(PURCHASE_CATEGORIES),
  vendor: z.string().min(1),
  purchaseDateBs: bsDateSchema,
  /** Bill / invoice number */
  invoiceNumber: z.string().min(1),
  item: z.string().optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1),
  unitPriceNpr: moneySchema,
  paymentStatus: z.enum(PAYMENT_STATUSES).default("PENDING"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().optional().or(z.literal("")),
  voucherNumber: z.string().optional().or(z.literal("")),
  attachmentUrl: z.string().optional().or(z.literal(""))
});

export const accountingIncomeSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  source: z.string().min(1),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().optional().or(z.literal("")),
  receiptNumber: z.string().optional().or(z.literal("")),
  voucherNumber: z.string().optional().or(z.literal(""))
});

export const salaryPaymentSchema = z
  .object({
    employeeType: z.enum(["TEACHER", "STAFF"]),
    teacherId: optionalObjectIdSchema,
    staffId: optionalObjectIdSchema,
    staffName: z.string().optional().or(z.literal("")),
    monthBs: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM (BS month)"),
    basicSalaryNpr: moneySchema,
    allowancesNpr: moneySchema.default(0),
    bonusNpr: moneySchema.default(0),
    advanceSalaryNpr: moneySchema.default(0),
    loanDeductionNpr: moneySchema.default(0),
    taxNpr: moneySchema.default(0),
    otherDeductionsNpr: moneySchema.default(0),
    status: z.enum(["DRAFT", "PROCESSED", "PAID"]).default("DRAFT"),
    paidDateBs: bsDateSchema.optional().or(z.literal("")),
    paymentMethod: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER"),
    transactionNumber: z.string().optional().or(z.literal("")),
    notes: z.string().optional().or(z.literal("")),
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
  })
  .superRefine((value, ctx) => {
    if (value.employeeType === "TEACHER" && !value.teacherId) {
      ctx.addIssue({
        code: "custom",
        message: "Select a teacher",
        path: ["teacherId"]
      });
    }
    if (value.employeeType === "STAFF" && !value.staffId && !value.staffName?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Select a college staff member",
        path: ["staffId"]
      });
    }
    if (value.status === "PAID" && !value.paidDateBs) {
      ctx.addIssue({
        code: "custom",
        message: "Paid date (BS) is required when status is Paid",
        path: ["paidDateBs"]
      });
    }
  });

export const bankAccountSchema = z.object({
  bankName: z.string().min(2),
  accountName: z.string().min(2),
  accountNumber: z.string().min(1),
  branch: z.string().optional().or(z.literal("")),
  openingBalanceNpr: moneySchema.default(0),
  isActive: z.boolean().default(true)
});

export const cashBookEntrySchema = z.object({
  dateBs: bsDateSchema,
  entryType: z.enum(["DEBIT", "CREDIT"]),
  category: z.string().min(1),
  description: z.string().min(1),
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  referenceType: z.string().optional(),
  referenceId: optionalObjectIdSchema
});

export const accountingSettingsSchema = z.object({
  lateFinePercent: z.coerce.number().min(0).max(100).default(0),
  lateFineGraceDays: z.coerce.number().int().min(0).default(0),
  receiptPrefix: z.string().default("RCPT"),
  autoReceiptNumber: z.boolean().default(true),
  defaultPaymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  voucherPrefix: z.string().default("JV"),
  currentFiscalYearBs: academicYearSchema.optional(),
  auditLockDateBs: z.string().optional().or(z.literal("")),
  /** Amounts at or above this NPR require dual approval for reverse/void. */
  approvalThresholdNpr: z.coerce.number().min(0).default(25000),
  panNumber: z.string().optional().or(z.literal("")),
  vatNumber: z.string().optional().or(z.literal("")),
  tdsEnabled: z.boolean().default(false),
  institutionSignatureUrl: z.string().optional().or(z.literal(""))
});

export const extendedFeeStructureSchema = z.object({
  title: z.string().min(1),
  classIds: z.array(objectIdSchema).default([]),
  batchIds: z.array(objectIdSchema).default([]),
  yearIds: z.array(objectIdSchema).default([]),
  faculty: z.string().optional().or(z.literal("")),
  program: z.string().optional().or(z.literal("")),
  feeType: z.enum(FEE_TYPES),
  frequency: z.enum(["MONTHLY", "ANNUAL", "ONE_TIME", "SEMESTER"]),
  academicYearBs: academicYearSchema,
  semesterBs: z.string().optional().or(z.literal("")),
  amountNpr: moneySchema,
  installmentCount: z.coerce.number().int().min(1).optional(),
  isOptional: z.boolean().default(false),
  status: z.enum(FEE_STRUCTURE_STATUSES).default("ACTIVE"),
  version: z.coerce.number().int().min(1).default(1),
  effectiveFromBs: bsDateSchema.optional().or(z.literal("")),
  versionGroupId: z.string().optional()
});

export type AccountantInput = z.infer<typeof accountantSchema>;
export type EnhancedFeeCollectionInput = z.infer<typeof enhancedFeeCollectionSchema>;
export type StudentScholarshipAwardInput = z.infer<typeof studentScholarshipAwardSchema>;
export type AccountingExpenseInput = z.infer<typeof accountingExpenseSchema>;
export type AccountingPurchaseInput = z.infer<typeof accountingPurchaseSchema>;
export type AccountingIncomeInput = z.infer<typeof accountingIncomeSchema>;
export type SalaryPaymentInput = z.infer<typeof salaryPaymentSchema>;
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type CashBookEntryInput = z.infer<typeof cashBookEntrySchema>;
export type AccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;
export type ExtendedFeeStructureInput = z.infer<typeof extendedFeeStructureSchema>;