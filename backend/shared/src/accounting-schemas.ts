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
import {
  addressSchema,
  academicYearSchema,
  adDateSchema,
  bsDateSchema,
  moneySchema,
  objectIdSchema,
  optionalObjectIdSchema
} from "./schemas.js";

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

export const enhancedFeeCollectionSchema = z
  .object({
    studentId: objectIdSchema,
    feeStructureId: optionalObjectIdSchema,
    receiptNumber: z.string().optional(),
    /** BS payment date — required unless paidDateAd is provided (server converts). */
    paidDateBs: bsDateSchema.optional().or(z.literal("")),
    /** AD payment date — optional; if only AD is given, server converts to BS. */
    paidDateAd: adDateSchema.optional().or(z.literal("")),
    academicYearBs: z.string().optional(),
    semesterBs: z.string().optional(),
    /** HA / multi-year: 1 = 1st year, 2 = 2nd year, 3 = 3rd year */
    programYear: z.coerce.number().int().min(1).max(3).optional(),
    /**
     * Payment against the existing fee plan (Bank / Cash entry): book it to the earliest
     * program year that still has a due, instead of the year picked on the form.
     */
    applyToOldestDue: z.boolean().optional(),
    /**
     * Advance on this receipt for later program years (2nd / 3rd year), paid
     * together with this year's fee. Included in amountPaidNpr.
     */
    advanceAllocations: z
      .array(
        z.object({
          programYear: z.coerce.number().int().min(2).max(3),
          amountNpr: moneySchema
        })
      )
      .max(2)
      .optional(),
    currentChargesNpr: moneySchema.default(0),
    /** Tuition / fee amount paid (excludes security deposit). */
    amountPaidNpr: moneySchema,
    /**
     * Admission security / caution deposit collected with this payment (NPR).
     * Does not reduce tuition dues; increases student.securityDepositNpr held.
     * Cash received = amountPaidNpr + securityDepositPaidNpr.
     */
    securityDepositPaidNpr: moneySchema.default(0).optional(),
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
    /** Staff / person who received cash, voucher, or deposit slip */
    receivedByName: z.string().trim().max(200).optional().or(z.literal("")),
    /** Person who paid or deposited cash / voucher */
    paidByName: z.string().trim().max(200).optional().or(z.literal("")),
    feeBreakdown: z.array(feeBreakdownItemSchema).default([]),
    attachments: z.array(feeAttachmentSchema).optional().default([]),
    isInstallment: z.boolean().default(false),
    installmentNumber: z.coerce.number().int().min(1).optional(),
    totalInstallments: z.coerce.number().int().min(1).optional(),
    notes: z.string().optional(),
    /** When recording a topper scholarship with this payment */
    scholarshipAwardId: optionalObjectIdSchema
  })
  .superRefine((value, ctx) => {
    const hasBs = Boolean(value.paidDateBs && value.paidDateBs.trim());
    const hasAd = Boolean(value.paidDateAd && value.paidDateAd.trim());
    if (!hasBs && !hasAd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Payment date is required (BS or AD)",
        path: ["paidDateBs"]
      });
    }
    const feePaid = Number(value.amountPaidNpr) || 0;
    const depositPaid = Number(value.securityDepositPaidNpr) || 0;
    if (feePaid <= 0 && depositPaid <= 0) {
      // Allow pure scholarship (amount 0) when scholarshipNpr > 0 or charges with sch
      const hasScholarship = (Number(value.scholarshipNpr) || 0) > 0;
      if (!hasScholarship) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Enter amount paid and/or security deposit amount (or apply scholarship)",
          path: ["amountPaidNpr"]
        });
      }
    }
  });

export const studentScholarshipAwardSchema = z.object({
  studentId: objectIdSchema,
  /** 0 = Entrance, 1 = 1st year final, 2 = 2nd year final (not 3rd). */
  toppedProgramYear: z.coerce.number().int().min(0).max(2),
  /** Program year whose fees are waived (1–3). */
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

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/** Extra details printed on an expense's Journal Voucher (AGF No. 10). */
export const journalVoucherDetailsSchema = z.object({
  narration: optionalText(500),
  receiptNo: optionalText(60),
  chequeNo: optionalText(60),
  chequeDateBs: optionalText(20),
  preparedByName: optionalText(120),
  preparedByDesignation: optionalText(80),
  checkedByName: optionalText(120),
  approvedByName: optionalText(120),
  receivedByName: optionalText(120),
  receivedByDesignation: optionalText(80)
});

export const accountingExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  /** Optional for legacy; new daily expenses often omit vendor */
  vendor: z.string().optional().or(z.literal("")).default(""),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  /** Bank account used when paid by bank (Bank / Cash register). */
  bankAccountId: optionalObjectIdSchema,
  description: z.string().min(1),
  voucherNumber: z.string().optional().or(z.literal("")),
  approvedBy: z.string().optional().or(z.literal("")),
  attachmentUrl: z.string().optional().or(z.literal("")),
  /** Printed on the Journal Voucher */
  voucherDetails: journalVoucherDetailsSchema.optional()
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
  /** Bank account used when paid by bank (Bank / Cash register). */
  bankAccountId: optionalObjectIdSchema,
  description: z.string().optional().or(z.literal("")),
  voucherNumber: z.string().optional().or(z.literal("")),
  attachmentUrl: z.string().optional().or(z.literal("")),
  /** Printed on the Journal Voucher */
  voucherDetails: journalVoucherDetailsSchema.optional()
});

export const accountingIncomeSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  source: z.string().min(1),
  dateBs: bsDateSchema,
  amountNpr: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  /** Bank account received into when paid by bank (Bank / Cash register). */
  bankAccountId: optionalObjectIdSchema,
  description: z.string().optional().or(z.literal("")),
  /** Manual receipt number — required (the server checks it is not already used). */
  receiptNumber: z.string().trim().min(1, "Enter the receipt number"),
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
    presentDays: z.coerce.number().min(0).optional().default(0),
    absentDays: z.coerce.number().min(0).optional().default(0),
    leaveDays: z.coerce.number().min(0).optional().default(0),
    extraDuty: z.coerce.number().min(0).optional().default(0),
    paymentType: z.enum(["MONTHLY", "TENDER", "PERIOD"]).optional(),
    periodRateNpr: moneySchema.optional(),
    periodsAttended: z.coerce.number().min(0).optional(),
    tenderAmountNpr: moneySchema.optional(),
    syllabusCompletedPercent: z.coerce.number().min(0).max(100).optional(),
    syllabusAlreadyPaidPercent: z.coerce.number().min(0).max(100).optional(),
    syllabusThisMonthPercent: z.coerce.number().min(0).max(100).optional(),
    syllabusRemainingPercent: z.coerce.number().min(0).max(100).optional(),
    tenderAlreadyPaidNpr: moneySchema.optional(),
    tenderThisMonthNpr: moneySchema.optional(),
    payBreakdown: z.string().optional().or(z.literal("")),
    academicYearBs: z.string().optional().or(z.literal("")),
    absentDeductionNpr: moneySchema.optional().default(0),
    extraAmountNpr: moneySchema.optional().default(0),
    salaryAmountNpr: moneySchema.optional().default(0),
    attendanceIncomplete: z.boolean().optional().default(false),
    attendanceManualOverride: z.boolean().optional().default(false),
    valuesManualOverride: z.boolean().optional().default(false),
    status: z.enum(["DRAFT", "PROCESSED", "PENDING_APPROVAL", "APPROVED", "PAID"]).default("DRAFT"),
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

export const BANK_CASH_TRANSFER_TYPES = ["CASH_TO_BANK", "BANK_TO_CASH", "BANK_TO_BANK"] as const;

/** Contra voucher between Cash in Hand and bank accounts. */
export const bankCashTransferSchema = z
  .object({
    transferType: z.enum(BANK_CASH_TRANSFER_TYPES),
    dateBs: bsDateSchema,
    amountNpr: moneySchema,
    fromBankAccountId: optionalObjectIdSchema,
    toBankAccountId: optionalObjectIdSchema,
    /** Deposit slip / cheque / transaction number */
    referenceNumber: z.string().trim().max(60).optional().or(z.literal("")),
    narration: z.string().trim().max(300).optional().or(z.literal(""))
  })
  .superRefine((value, ctx) => {
    if (!(value.amountNpr > 0)) {
      ctx.addIssue({ code: "custom", message: "Amount must be more than 0", path: ["amountNpr"] });
    }
    const needsFrom = value.transferType !== "CASH_TO_BANK";
    const needsTo = value.transferType !== "BANK_TO_CASH";
    if (needsFrom && !value.fromBankAccountId) {
      ctx.addIssue({ code: "custom", message: "Select the bank account money leaves", path: ["fromBankAccountId"] });
    }
    if (needsTo && !value.toBankAccountId) {
      ctx.addIssue({ code: "custom", message: "Select the bank account money goes into", path: ["toBankAccountId"] });
    }
    if (
      value.transferType === "BANK_TO_BANK" &&
      value.fromBankAccountId &&
      value.fromBankAccountId === value.toBankAccountId
    ) {
      ctx.addIssue({ code: "custom", message: "Choose two different bank accounts", path: ["toBankAccountId"] });
    }
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
  /** Direct Expense in an asset category at or above this is capitalised (Fixed Assets). */
  capitalizationThresholdNpr: z.coerce.number().min(0).default(5000),
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

export const salarySheetSaveSchema = z.object({
  monthBs: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM (BS month)"),
  /** Which salary sheet of the month (1, 2, 3 …). */
  sheetNo: z.coerce.number().int().min(1).max(50).default(1),
  /** Optional sheet name, e.g. "Staff" or "Teachers". */
  sheetLabel: z.string().trim().max(60).optional(),
  status: z.enum(["DRAFT", "PROCESSED", "PENDING_APPROVAL", "APPROVED", "PAID"]).default("DRAFT"),
  paidDateBs: bsDateSchema.optional().or(z.literal("")),
  paymentMethod: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER"),
  /** Signature blocks for print / PDF / Excel — stored with the month. */
  signatories: z
    .array(
      z.object({
        position: z.string().trim().max(80).default(""),
        name: z.string().trim().max(120).default("")
      })
    )
    .max(4)
    .optional(),
  rows: z
    .array(
      z.object({
        employeeType: z.enum(["TEACHER", "STAFF"]),
        teacherId: optionalObjectIdSchema,
        staffId: optionalObjectIdSchema,
        employeeName: z.string().optional().or(z.literal("")),
        monthlySalaryNpr: moneySchema,
        presentDays: z.coerce.number().min(0).default(0),
        absentDays: z.coerce.number().min(0).default(0),
        leaveDays: z.coerce.number().min(0).default(0),
        extraDuty: z.coerce.number().min(0).default(0),
        paymentType: z.enum(["MONTHLY", "TENDER", "PERIOD"]).optional(),
        periodRateNpr: moneySchema.optional(),
        periodsAttended: z.coerce.number().min(0).optional(),
        tenderAmountNpr: moneySchema.optional(),
        syllabusCompletedPercent: z.coerce.number().min(0).max(100).optional(),
        syllabusAlreadyPaidPercent: z.coerce.number().min(0).max(100).optional(),
        syllabusThisMonthPercent: z.coerce.number().min(0).max(100).optional(),
        syllabusRemainingPercent: z.coerce.number().min(0).max(100).optional(),
        tenderAlreadyPaidNpr: moneySchema.optional(),
        tenderThisMonthNpr: moneySchema.optional(),
        payBreakdown: z.string().optional().or(z.literal("")),
        extraAmountNpr: moneySchema.optional(),
        absentDeductionNpr: moneySchema.optional(),
        salaryAmountNpr: moneySchema.optional(),
        tax1PercentNpr: moneySchema.optional(),
        netSalaryNpr: moneySchema.optional(),
        remarks: z.string().optional().or(z.literal("")),
        attendanceManualOverride: z.boolean().optional().default(false),
        /** Super Admin / College Admin only — keep client money fields as entered */
        valuesManualOverride: z.boolean().optional().default(false),
        salaryPaymentId: optionalObjectIdSchema
      })
    )
    .min(1)
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type CashBookEntryInput = z.infer<typeof cashBookEntrySchema>;
export type BankCashTransferInput = z.infer<typeof bankCashTransferSchema>;
export type JournalVoucherDetails = z.infer<typeof journalVoucherDetailsSchema>;
export type BankCashTransferType = (typeof BANK_CASH_TRANSFER_TYPES)[number];
export type AccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;
export type ExtendedFeeStructureInput = z.infer<typeof extendedFeeStructureSchema>;