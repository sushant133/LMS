import mongoose, { Schema, type InferSchemaType } from "mongoose";

const salaryPaymentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    employeeType: { type: String, enum: ["TEACHER", "STAFF"], required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    staffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff" },
    staffName: { type: String },
    monthBs: { type: String, required: true },
    /** Monthly gross salary (sheet: Monthly Salary) */
    basicSalaryNpr: { type: Number, required: true },
    allowancesNpr: { type: Number, default: 0 },
    bonusNpr: { type: Number, default: 0 },
    advanceSalaryNpr: { type: Number, default: 0 },
    loanDeductionNpr: { type: Number, default: 0 },
    /** 1% tax on Salary Amount (sheet: 1% Tax) */
    taxNpr: { type: Number, default: 0 },
    otherDeductionsNpr: { type: Number, default: 0 },
    /** Attendance / payroll sheet fields */
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    /** Extra duty units (days) approved for the month */
    extraDuty: { type: Number, default: 0 },
    absentDeductionNpr: { type: Number, default: 0 },
    extraAmountNpr: { type: Number, default: 0 },
    /** Monthly Salary − Absent Deduction + Extra Amount */
    salaryAmountNpr: { type: Number, default: 0 },
    /** True when attendance register incomplete for this employee/month */
    attendanceIncomplete: { type: Boolean, default: false },
    /** Present/absent overridden manually by authorized user */
    attendanceManualOverride: { type: Boolean, default: false },
    /**
     * Super Admin / College Admin entered money fields manually
     * (absent deduction, extra amount, salary amount, tax, net) — do not auto-recalc.
     */
    valuesManualOverride: { type: Boolean, default: false },
    netSalaryNpr: { type: Number, required: true },
    status: { type: String, enum: ["DRAFT", "PROCESSED", "PAID"], default: "DRAFT" },
    paidDateBs: { type: String },
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
      default: "BANK_TRANSFER"
    },
    /** Bank / cheque / Fonepay reference */
    transactionNumber: { type: String, default: "" },
    notes: { type: String, default: "" },
    /** Payslip / bank advice attachments */
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