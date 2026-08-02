import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeBreakdownSchema = new Schema(
  {
    feeType: { type: String, required: true },
    title: { type: String, required: true },
    amountNpr: { type: Number, required: true }
  },
  { _id: false }
);

/** Slip / voucher / invoice attached to a fee payment (image or PDF). */
const feeAttachmentSchema = new Schema(
  {
    name: { type: String, default: "" },
    url: { type: String, required: true },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    kind: {
      type: String,
      enum: ["BANK_VOUCHER", "PAYMENT_SCREENSHOT", "INVOICE", "RECEIPT_SLIP", "OTHER"],
      default: "OTHER"
    }
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
    /** Gregorian (AD) equivalent of paidDateBs — stored for dual-calendar display. */
    paidDateAd: { type: String },
    fiscalYearBs: { type: String },
    academicYearBs: { type: String },
    semesterBs: { type: String },
    /**
     * Program year for HA / multi-year college programs (1st / 2nd / 3rd year fee).
     * Used for year-wise paid vs remaining ledger.
     */
    programYear: { type: Number, enum: [1, 2, 3], index: true },
    previousDueNpr: { type: Number, default: 0 },
    currentChargesNpr: { type: Number, default: 0 },
    /** Tuition / fee amount paid (excludes security deposit). */
    amountPaidNpr: { type: Number, required: true },
    /**
     * Security / caution deposit collected with this payment (NPR).
     * Does not affect tuition balance; updates student.securityDepositNpr held.
     */
    securityDepositPaidNpr: { type: Number, default: 0 },
    discountNpr: { type: Number, default: 0 },
    scholarshipNpr: { type: Number, default: 0 },
    /**
     * NONE | TOPPER_YEAR_WAIVER (topped previous final → next year free) | MERIT | OTHER
     */
    scholarshipType: {
      type: String,
      enum: ["NONE", "TOPPER_YEAR_WAIVER", "MERIT", "OTHER"],
      default: "NONE"
    },
    lateFeeNpr: { type: Number, default: 0 },
    advancePaymentNpr: { type: Number, default: 0 },
    remainingDueNpr: { type: Number, default: 0 },
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
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    transactionNumber: { type: String },
    /** Staff / person who received cash, voucher, or deposit slip */
    receivedByName: { type: String, trim: true, default: "" },
    /** Person who paid or deposited cash / voucher (payer / depositor) */
    paidByName: { type: String, trim: true, default: "" },
    verificationCode: { type: String },
    feeBreakdown: { type: [feeBreakdownSchema], default: [] },
    attachments: { type: [feeAttachmentSchema], default: [] },
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