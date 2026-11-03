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