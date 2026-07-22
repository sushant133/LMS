import mongoose, { Schema, type InferSchemaType } from "mongoose";

const accountingIncomeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    category: { type: String, required: true },
    source: { type: String, required: true },
    dateBs: { type: String, required: true },
    amountNpr: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"],
      default: "CASH"
    },
    description: { type: String },
    receiptNumber: { type: String },
    voucherNumber: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String }
  },
  { timestamps: true }
);

export type AccountingIncomeDocument = InferSchemaType<typeof accountingIncomeSchema>;
export const AccountingIncome = mongoose.model("AccountingIncome", accountingIncomeSchema);