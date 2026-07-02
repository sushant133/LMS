import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeBreakdownSchema = new Schema(
  {
    feeType: { type: String, required: true },
    title: { type: String, required: true },
    amountNpr: { type: Number, required: true }
  },
  { _id: false }
);

const feeCollectionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    feeStructureId: { type: Schema.Types.ObjectId, ref: "FeeStructure" },
    receiptNumber: { type: String, required: true, trim: true },
    paidDateBs: { type: String, required: true },
    previousDueNpr: { type: Number, default: 0 },
    currentChargesNpr: { type: Number, default: 0 },
    amountPaidNpr: { type: Number, required: true },
    discountNpr: { type: Number, default: 0 },
    scholarshipNpr: { type: Number, default: 0 },
    lateFeeNpr: { type: Number, default: 0 },
    advancePaymentNpr: { type: Number, default: 0 },
    remainingDueNpr: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"], default: "CASH" },
    feeBreakdown: { type: [feeBreakdownSchema], default: [] },
    isInstallment: { type: Boolean, default: false },
    installmentNumber: { type: Number },
    notes: { type: String },
    accountantName: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

feeCollectionSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });

export type FeeCollectionDocument = InferSchemaType<typeof feeCollectionSchema>;
export const FeeCollection = mongoose.model("FeeCollection", feeCollectionSchema);