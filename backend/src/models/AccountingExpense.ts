import mongoose, { Schema, type InferSchemaType } from "mongoose";

const accountingExpenseSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    category: { type: String, required: true },
    vendor: { type: String, default: "" },
    dateBs: { type: String, required: true },
    amountNpr: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"],
      default: "CASH"
    },
    description: { type: String, required: true },
    voucherNumber: { type: String },
    approvedBy: { type: String },
    attachmentUrl: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String }
  },
  { timestamps: true }
);

export type AccountingExpenseDocument = InferSchemaType<typeof accountingExpenseSchema>;
export const AccountingExpense = mongoose.model("AccountingExpense", accountingExpenseSchema);