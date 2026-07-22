import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeRefundSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    feeCollectionId: { type: Schema.Types.ObjectId, ref: "FeeCollection" },
    refundNumber: { type: String, required: true, trim: true },
    /**
     * DEPOSIT_REFUND — admission security deposit returned after pass-out
     * OVERPAYMENT — excess fee payment returned
     * FEE_ADJUSTMENT — partial tuition/fee refund
     * WITHDRAWAL — refund on course withdrawal
     * OTHER — miscellaneous student refund
     */
    refundType: {
      type: String,
      enum: ["DEPOSIT_REFUND", "OVERPAYMENT", "FEE_ADJUSTMENT", "WITHDRAWAL", "OTHER"],
      default: "OTHER",
      index: true
    },
    amountNpr: { type: Number, required: true },
    dateBs: { type: String, required: true },
    reason: { type: String, required: true },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"],
      default: "CASH"
    },
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    transactionNumber: { type: String },
    notes: { type: String },
    approvedBy: { type: String },
    attachments: {
      type: [
        {
          _id: false,
          name: { type: String, default: "" },
          url: { type: String, required: true },
          mimeType: { type: String, default: "" },
          size: { type: Number, default: 0 }
        }
      ],
      default: []
    },
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

feeRefundSchema.index({ schoolId: 1, refundNumber: 1 }, { unique: true });

export type FeeRefundDocument = InferSchemaType<typeof feeRefundSchema>;
export const FeeRefund = mongoose.model("FeeRefund", feeRefundSchema);