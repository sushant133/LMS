import { z } from "zod";
import { objectIdSchema, optionalObjectIdSchema, bsDateSchema, moneySchema } from "./schemas.js";

/** EXPENSE / INCOME = cash-affecting; CREDIT = recorded on credit (payable / receivable, not settled in cash yet). */
export const FINANCE_TRANSACTION_TYPES = ["EXPENSE", "INCOME", "CREDIT"] as const;
export const FINANCE_EXPENSE_TYPES = [
  "COLLEGE_EXPENSE",
  "OTHER_EXPENSE",
  "EXTERNAL_EXPENSE"
] as const;
export const FINANCE_PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "ONLINE",
  "UPI",
  "CARD",
  "OTHER"
] as const;
export const FINANCE_CATEGORY_KINDS = ["EXPENSE", "INCOME", "BOTH"] as const;

/**
 * Who “owns” a finance archive row:
 * - INSTITUTION: recorded by Administrator / Superadmin (shared college finance)
 * - COLLEGE_ADMINISTRATOR: recorded by a College Administrator (their own book)
 * - STAFF: recorded by college staff with personal finance access (admin-granted)
 * Institution admins can view all; college administrators / staff only see their own.
 */
export const FINANCE_OWNER_SCOPES = [
  "INSTITUTION",
  "COLLEGE_ADMINISTRATOR",
  "STAFF"
] as const;

export const FINANCE_OWNER_SCOPE_LABELS: Record<
  (typeof FINANCE_OWNER_SCOPES)[number],
  string
> = {
  INSTITUTION: "Institution (Admin)",
  COLLEGE_ADMINISTRATOR: "College Administrator",
  STAFF: "Staff"
};

export const FINANCE_PAYMENT_METHOD_LABELS: Record<
  (typeof FINANCE_PAYMENT_METHODS)[number],
  string
> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  ONLINE: "Online",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other"
};

export const FINANCE_EXPENSE_TYPE_LABELS: Record<
  (typeof FINANCE_EXPENSE_TYPES)[number],
  string
> = {
  COLLEGE_EXPENSE: "College expense",
  OTHER_EXPENSE: "Other expense",
  EXTERNAL_EXPENSE: "External expense"
};

export const FINANCE_TRANSACTION_TYPE_LABELS: Record<
  (typeof FINANCE_TRANSACTION_TYPES)[number],
  string
> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  CREDIT: "Credit"
};

/** Default categories seeded per institution (admin may add more). */
export const DEFAULT_FINANCE_CATEGORIES: Array<{
  name: string;
  kind: (typeof FINANCE_CATEGORY_KINDS)[number];
  sortOrder: number;
}> = [
  // Expense
  { name: "College Expenses", kind: "EXPENSE", sortOrder: 10 },
  { name: "Office Expenses", kind: "EXPENSE", sortOrder: 20 },
  { name: "Furniture", kind: "EXPENSE", sortOrder: 30 },
  { name: "Computer & IT Equipment", kind: "EXPENSE", sortOrder: 40 },
  { name: "Laboratory", kind: "EXPENSE", sortOrder: 50 },
  { name: "Library", kind: "EXPENSE", sortOrder: 60 },
  { name: "Building Maintenance", kind: "EXPENSE", sortOrder: 70 },
  { name: "Vehicle", kind: "EXPENSE", sortOrder: 80 },
  { name: "Electricity", kind: "EXPENSE", sortOrder: 90 },
  { name: "Internet", kind: "EXPENSE", sortOrder: 100 },
  { name: "Water", kind: "EXPENSE", sortOrder: 110 },
  { name: "Printing", kind: "EXPENSE", sortOrder: 120 },
  { name: "Stationery", kind: "EXPENSE", sortOrder: 130 },
  { name: "Travel", kind: "EXPENSE", sortOrder: 140 },
  { name: "Events", kind: "EXPENSE", sortOrder: 150 },
  { name: "Marketing", kind: "EXPENSE", sortOrder: 160 },
  { name: "Hospital", kind: "EXPENSE", sortOrder: 170 },
  { name: "Community / PHC", kind: "EXPENSE", sortOrder: 180 },
  { name: "Consultancy", kind: "EXPENSE", sortOrder: 190 },
  { name: "External Services", kind: "EXPENSE", sortOrder: 200 },
  { name: "Investments", kind: "EXPENSE", sortOrder: 210 },
  { name: "Meetings", kind: "EXPENSE", sortOrder: 220 },
  { name: "Miscellaneous", kind: "BOTH", sortOrder: 230 },
  { name: "Other Expenses", kind: "EXPENSE", sortOrder: 240 },
  // Income
  { name: "Donations", kind: "INCOME", sortOrder: 310 },
  { name: "Consultancy Income", kind: "INCOME", sortOrder: 320 },
  { name: "Training Programs", kind: "INCOME", sortOrder: 330 },
  { name: "Rent", kind: "INCOME", sortOrder: 340 },
  { name: "Interest", kind: "INCOME", sortOrder: 350 },
  { name: "Grants", kind: "INCOME", sortOrder: 360 },
  { name: "Miscellaneous Income", kind: "INCOME", sortOrder: 370 }
];

export const financeAttachmentSchema = z.object({
  url: z.string().min(1),
  path: z.string().optional(),
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().nonnegative(),
  kind: z.string().optional(),
  uploadedAt: z.string().optional(),
  uploadedBy: z.string().optional()
});

export const financeCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(FINANCE_CATEGORY_KINDS).default("EXPENSE"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().optional()
});

export const financeTransactionSchema = z
  .object({
    transactionType: z.enum(FINANCE_TRANSACTION_TYPES),
    dateBs: bsDateSchema,
    title: z.string().trim().min(2).max(200),
    categoryId: objectIdSchema,
    expenseType: z.enum(FINANCE_EXPENSE_TYPES).optional(),
    incomeSource: z.string().trim().max(200).optional().or(z.literal("")),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    vendorPayee: z.string().trim().max(200).optional().or(z.literal("")),
    amountNpr: moneySchema,
    paymentMethod: z.enum(FINANCE_PAYMENT_METHODS),
    referenceNumber: z.string().trim().max(100).optional().or(z.literal("")),
    remarks: z.string().trim().max(1000).optional().or(z.literal("")),
    attachments: z.array(financeAttachmentSchema).max(20).default([])
  })
  .superRefine((value, ctx) => {
    if (value.amountNpr <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Amount must be greater than zero",
        path: ["amountNpr"]
      });
    }
    if (value.transactionType === "EXPENSE" && !value.expenseType) {
      ctx.addIssue({
        code: "custom",
        message: "Expense type is required for expenses",
        path: ["expenseType"]
      });
    }
    // CREDIT entries: no expense type / income source required — party is captured in vendor/payee.
  });

export const financeTransactionUpdateSchema = financeTransactionSchema.partial().extend({
  categoryId: optionalObjectIdSchema
});

export type FinanceCategoryInput = z.infer<typeof financeCategorySchema>;
export type FinanceTransactionInput = z.infer<typeof financeTransactionSchema>;
