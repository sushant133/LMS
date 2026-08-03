import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  FINANCE_EXPENSE_TYPES,
  FINANCE_OWNER_SCOPES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_TRANSACTION_TYPES
} from "@phit-erp/shared";

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    path: { type: String },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    kind: { type: String },
    uploadedAt: { type: String },
    uploadedBy: { type: String }
  },
  { _id: false }
);

const financeTransactionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    transactionType: {
      type: String,
      enum: FINANCE_TRANSACTION_TYPES,
      required: true,
      index: true
    },
    dateBs: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceCategory",
      required: true,
      index: true
    },
    expenseType: {
      type: String,
      enum: FINANCE_EXPENSE_TYPES
    },
    incomeSource: { type: String, trim: true },
    description: { type: String, trim: true },
    vendorPayee: { type: String, trim: true },
    amountNpr: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: FINANCE_PAYMENT_METHODS,
      required: true,
      index: true
    },
    referenceNumber: { type: String, trim: true },
    remarks: { type: String, trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    /**
     * INSTITUTION = admin/superadmin shared archive.
     * COLLEGE_ADMINISTRATOR = College Administrator personal finance book.
     * STAFF = college staff personal book (admin-granted access).
     * Missing/legacy rows are treated as INSTITUTION.
     */
    ownerScope: {
      type: String,
      enum: FINANCE_OWNER_SCOPES,
      default: "INSTITUTION",
      index: true
    },
    /** Future optional link to Accounting — never auto-filled today. */
    accountingLinkId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

financeTransactionSchema.index({ schoolId: 1, transactionType: 1, dateBs: -1 });
financeTransactionSchema.index({ schoolId: 1, categoryId: 1, dateBs: -1 });
financeTransactionSchema.index({ schoolId: 1, createdAt: -1 });
financeTransactionSchema.index({ schoolId: 1, ownerScope: 1, createdBy: 1, dateBs: -1 });

export type FinanceTransactionDocument = InferSchemaType<typeof financeTransactionSchema>;
export const FinanceTransaction = mongoose.model("FinanceTransaction", financeTransactionSchema);
