import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  STUDENT_CAMPUS_ATTENDANCE_SOURCES,
  STUDENT_CAMPUS_ATTENDANCE_STATUSES
} from "@phit-erp/shared";

/**
 * Campus / gate daily attendance for students (one punch per day).
 * Separate from class DailyAttendance (teacher period sheets).
 * Foundation only — not shown in UI yet.
 */
const studentCampusAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    admissionNumber: { type: String, required: true, trim: true },
    dateBs: { type: String, required: true, index: true },
    academicYearBs: { type: String, default: "" },
    status: {
      type: String,
      enum: STUDENT_CAMPUS_ATTENDANCE_STATUSES,
      required: true
    },
    /** First punch time of day (HH:mm, Nepal). */
    punchTime: { type: String, default: "" },
    punchAt: { type: Date },
    source: {
      type: String,
      enum: STUDENT_CAMPUS_ATTENDANCE_SOURCES,
      default: "BIOMETRIC"
    },
    deviceId: { type: String, default: "" },
    externalRef: { type: String, default: "" },
    remarks: { type: String, default: "" }
  },
  { timestamps: true }
);

studentCampusAttendanceSchema.index(
  { schoolId: 1, studentId: 1, dateBs: 1 },
  { unique: true }
);
studentCampusAttendanceSchema.index({ schoolId: 1, dateBs: 1, status: 1 });
studentCampusAttendanceSchema.index({ schoolId: 1, admissionNumber: 1, dateBs: 1 });

export type StudentCampusAttendanceDocument = InferSchemaType<
  typeof studentCampusAttendanceSchema
>;
export const StudentCampusAttendance = mongoose.model(
  "StudentCampusAttendance",
  studentCampusAttendanceSchema
);
