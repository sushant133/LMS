import mongoose, { Schema, type InferSchemaType } from "mongoose";

const accountingPurchaseSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    category: { type: String, required: true },
    vendor: { type: String, required: true },
    purchaseDateBs: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPriceNpr: { type: Number, required: true },
    totalAmountNpr: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["PENDING", "PARTIAL", "PAID"], default: "PENDING" },
    paymentMethod: { type: String, enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"], default: "CASH" },
    description: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

export type AccountingPurchaseDocument = InferSchemaType<typeof accountingPurchaseSchema>;
export const AccountingPurchase = mongoose.model("AccountingPurchase", accountingPurchaseSchema);