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
    fiscalYearBs: { type: String },
    academicYearBs: { type: String },
    semesterBs: { type: String },
    previousDueNpr: { type: Number, default: 0 },
    currentChargesNpr: { type: Number, default: 0 },
    amountPaidNpr: { type: Number, required: true },
    discountNpr: { type: Number, default: 0 },
    scholarshipNpr: { type: Number, default: 0 },
    lateFeeNpr: { type: Number, default: 0 },
    advancePaymentNpr: { type: Number, default: 0 },
    remainingDueNpr: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"],
      default: "CASH"
    },
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    transactionNumber: { type: String },
    verificationCode: { type: String },
    feeBreakdown: { type: [feeBreakdownSchema], default: [] },
    isInstallment: { type: Boolean, default: false },
    installmentNumber: { type: Number },
    totalInstallments: { type: Number },
    notes: { type: String },
    accountantName: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String },
    printCount: { type: Number, default: 0 },
    lastPrintedAt: { type: Date },
    lastPrintedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

feeCollectionSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export type FeeCollectionDocument = InferSchemaType<typeof feeCollectionSchema>;
export const FeeCollection = mongoose.model("FeeCollection", feeCollectionSchema);