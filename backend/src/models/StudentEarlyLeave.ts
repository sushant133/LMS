import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { EARLY_LEAVE_PERIOD_KINDS } from "@phit-erp/shared";

const studentEarlyLeaveSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    dateBs: { type: String, required: true, index: true },
    periodKind: {
      type: String,
      enum: EARLY_LEAVE_PERIOD_KINDS,
      default: "AFTER_PERIOD"
    },
    leftAfterPeriod: { type: Number, min: 1, max: 12, default: null },
    periodLabel: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true },
    approvedBy: { type: String, default: "", trim: true },
    remarks: { type: String, default: "", trim: true },
    leftAtTime: { type: String, default: "" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    academicYearBs: { type: String, default: "" },
    dailyAttendanceId: { type: Schema.Types.ObjectId, ref: "DailyAttendance" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

studentEarlyLeaveSchema.index(
  { schoolId: 1, studentId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
studentEarlyLeaveSchema.index({ schoolId: 1, dateBs: 1, isDeleted: 1 });
studentEarlyLeaveSchema.index({ schoolId: 1, batchId: 1, yearId: 1, dateBs: 1 });
studentEarlyLeaveSchema.index({ schoolId: 1, classId: 1, sectionId: 1, dateBs: 1 });

export type StudentEarlyLeaveDocument = InferSchemaType<typeof studentEarlyLeaveSchema>;
export const StudentEarlyLeave = mongoose.model("StudentEarlyLeave", studentEarlyLeaveSchema);
