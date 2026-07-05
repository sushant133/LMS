import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeRefundSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    feeCollectionId: { type: Schema.Types.ObjectId, ref: "FeeCollection" },
    refundNumber: { type: String, required: true, trim: true },
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
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

feeRefundSchema.index({ schoolId: 1, refundNumber: 1 }, { unique: true });

export type FeeRefundDocument = InferSchemaType<typeof feeRefundSchema>;
export const FeeRefund = mongoose.model("FeeRefund", feeRefundSchema);