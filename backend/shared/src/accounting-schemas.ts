import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  FEE_TYPES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PURCHASE_CATEGORIES
} from "./constants.js";
import { addressSchema, academicYearSchema, bsDateSchema, moneySchema, objectIdSchema } from "./schemas.js";

export const feeBreakdownItemSchema = z.object({
  feeType: z.enum(FEE_TYPES),
  title: z.string().min(1),
  amountNpr: moneySchema
});

export const enhancedFeeCollectionSchema = z.object({
  studentId: objectIdSchema,
  feeStructureId: objectIdSchema.optional(),
  receiptNumber: z.string().optional(),
  paidDateBs: bsDateSchema,
  currentChargesNpr: moneySchema.default(0),
  amountPaidNpr: moneySchema,
  discountNpr: moneySchema.default(0),
  scholarshipNpr: moneySchema.default(0),
  lateFeeNpr: moneySchema.default(0),
  advancePaymentNpr: moneySchema.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  feeBreakdown: z.array(feeBreakdownItemSchema).default([]),
  isInstallment: z.boolean().default(false),
  installmentNumber: z.coerce.number().int().min(1).optional(),
  notes: z.string().optional()
});

export const accountantSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
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
  vendor: z.string().min(1),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().min(1),
  attachmentUrl: z.string().optional().or(z.literal(""))
});

export const accountingPurchaseSchema = z.object({
  category: z.enum(PURCHASE_CATEGORIES),
  vendor: z.string().min(1),
  purchaseDateBs: bsDateSchema,
  invoiceNumber: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  unitPriceNpr: moneySchema,
  paymentStatus: z.enum(PAYMENT_STATUSES).default("PENDING"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().optional().or(z.literal(""))
});

export const accountingIncomeSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  source: z.string().min(1),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  description: z.string().optional().or(z.literal(""))
});

export const salaryPaymentSchema = z.object({
  employeeType: z.enum(["TEACHER", "STAFF"]),
  teacherId: objectIdSchema.optional(),
  staffName: z.string().optional().or(z.literal("")),
  monthBs: z.string().regex(/^\d{4}-\d{2}$/),
  basicSalaryNpr: moneySchema,
  allowancesNpr: moneySchema.default(0),
  bonusNpr: moneySchema.default(0),
  advanceSalaryNpr: moneySchema.default(0),
  loanDeductionNpr: moneySchema.default(0),
  taxNpr: moneySchema.default(0),
  otherDeductionsNpr: moneySchema.default(0),
  status: z.enum(["DRAFT", "PROCESSED", "PAID"]).default("DRAFT"),
  paidDateBs: bsDateSchema.optional().or(z.literal("")),
  paymentMethod: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER")
}).superRefine((value, ctx) => {
  if (value.employeeType === "TEACHER" && !value.teacherId) {
    ctx.addIssue({ code: "custom", message: "teacherId is required for teacher salaries", path: ["teacherId"] });
  }
  if (value.employeeType === "STAFF" && !value.staffName?.trim()) {
    ctx.addIssue({ code: "custom", message: "staffName is required for staff salaries", path: ["staffName"] });
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
  referenceId: objectIdSchema.optional()
});

export const accountingSettingsSchema = z.object({
  lateFinePercent: z.coerce.number().min(0).max(100).default(0),
  lateFineGraceDays: z.coerce.number().int().min(0).default(0),
  receiptPrefix: z.string().default("RCPT"),
  autoReceiptNumber: z.boolean().default(true),
  defaultPaymentMethod: z.enum(PAYMENT_METHODS).default("CASH")
});

export const extendedFeeStructureSchema = z.object({
  title: z.string().min(1),
  classIds: z.array(objectIdSchema).default([]),
  feeType: z.enum(FEE_TYPES),
  frequency: z.enum(["MONTHLY", "ANNUAL", "ONE_TIME"]),
  academicYearBs: academicYearSchema,
  amountNpr: moneySchema,
  isOptional: z.boolean().default(false)
});

export type AccountantInput = z.infer<typeof accountantSchema>;
export type EnhancedFeeCollectionInput = z.infer<typeof enhancedFeeCollectionSchema>;
export type AccountingExpenseInput = z.infer<typeof accountingExpenseSchema>;
export type AccountingPurchaseInput = z.infer<typeof accountingPurchaseSchema>;
export type AccountingIncomeInput = z.infer<typeof accountingIncomeSchema>;
export type SalaryPaymentInput = z.infer<typeof salaryPaymentSchema>;
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type CashBookEntryInput = z.infer<typeof cashBookEntrySchema>;
export type AccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;
export type ExtendedFeeStructureInput = z.infer<typeof extendedFeeStructureSchema>;