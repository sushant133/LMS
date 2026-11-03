import mongoose, { Schema, type InferSchemaType } from "mongoose";

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
    /** Bank account used when paid by bank; absent on cash and older records. */
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    /** Details printed on the Journal Voucher (AGF No. 10) */
    voucherDetails: {
      narration: { type: String, default: "" },
      receiptNo: { type: String, default: "" },
      chequeNo: { type: String, default: "" },
      chequeDateBs: { type: String, default: "" },
      preparedByName: { type: String, default: "" },
      preparedByDesignation: { type: String, default: "" },
      checkedByName: { type: String, default: "" },
      approvedByName: { type: String, default: "" },
      receivedByName: { type: String, default: "" },
      receivedByDesignation: { type: String, default: "" }
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
export const AccountingPurchase = mongoose.model("AccountingPurchase", accountingPurchaseSchema);