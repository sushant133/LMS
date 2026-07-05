import mongoose, { Schema, type InferSchemaType } from "mongoose";

const salaryPaymentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    employeeType: { type: String, enum: ["TEACHER", "STAFF"], required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    staffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff" },
    staffName: { type: String },
    monthBs: { type: String, required: true },
    basicSalaryNpr: { type: Number, required: true },
    allowancesNpr: { type: Number, default: 0 },
    bonusNpr: { type: Number, default: 0 },
    advanceSalaryNpr: { type: Number, default: 0 },
    loanDeductionNpr: { type: Number, default: 0 },
    taxNpr: { type: Number, default: 0 },
    otherDeductionsNpr: { type: Number, default: 0 },
    netSalaryNpr: { type: Number, required: true },
    status: { type: String, enum: ["DRAFT", "PROCESSED", "PAID"], default: "DRAFT" },
    paidDateBs: { type: String },
    paymentMethod: { type: String, enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"], default: "BANK_TRANSFER" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: { type: String }
  },
  { timestamps: true }
);

salaryPaymentSchema.index({ schoolId: 1, teacherId: 1, monthBs: 1 }, { unique: true, sparse: true });
salaryPaymentSchema.index({ schoolId: 1, staffId: 1, monthBs: 1 }, { unique: true, sparse: true });

export type SalaryPaymentDocument = InferSchemaType<typeof salaryPaymentSchema>;
export const SalaryPayment = mongoose.model("SalaryPayment", salaryPaymentSchema);