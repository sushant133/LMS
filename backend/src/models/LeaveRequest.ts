import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { LEAVE_TYPES } from "@phit-erp/shared";

const leaveRequestSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    startDateBs: { type: String, required: true },
    endDateBs: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export type LeaveRequestDocument = InferSchemaType<typeof leaveRequestSchema>;
export const LeaveRequest = mongoose.model("LeaveRequest", leaveRequestSchema);

const payrollSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    monthBs: { type: String, required: true },
    basicSalaryNpr: { type: Number, required: true, min: 0 },
    allowancesNpr: { type: Number, default: 0, min: 0 },
    deductionsNpr: { type: Number, default: 0, min: 0 },
    netSalaryNpr: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["DRAFT", "PROCESSED", "PAID"], default: "DRAFT" },
    paidDateBs: { type: String }
  },
  { timestamps: true }
);

payrollSchema.index({ schoolId: 1, teacherId: 1, monthBs: 1 }, { unique: true });

export type PayrollDocument = InferSchemaType<typeof payrollSchema>;
export const Payroll = mongoose.model("Payroll", payrollSchema);