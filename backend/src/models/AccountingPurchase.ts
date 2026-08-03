import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

const accountingPurchaseSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    category: { type: String, required: true },
    vendor: { type: String, required: true },
    purchaseDateBs: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    item: { type: String },
    quantity: { type: Number, required: true },
    unitPriceNpr: { type: Number, required: true },
    totalAmountNpr: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["PENDING", "PARTIAL", "PAID"], default: "PENDING" },
    paymentMethod: {
      type: String,
      enum: [
        "CASH",
        "BANK_TRANSFER",
        "CHEQUE",
        "ESEWA",
        "KHALTI",
        "IMEPAY",
        "FONEPAY",
        "CONNECT_IPS",
        "ONLINE",
        "OTHER"
      ],
      default: "CASH"
    },
    description: { type: String },
    voucherNumber: { type: String },
    attachmentUrl: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String }
  },
  { timestamps: true }
);

export type AccountingPurchaseDocument = InferSchemaType<typeof accountingPurchaseSchema>;
accountingPurchaseSchema.plugin(softDeletePlugin);
export const AccountingPurchase = mongoose.model("AccountingPurchase", accountingPurchaseSchema);