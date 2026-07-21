import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Teacher / Staff daily attendance sheet.
 * One document per school + category (TEACHER|STAFF) + dateBs.
 * Entries reference existing Teacher or CollegeStaff records (no duplicate employees).
 * source / deviceId / geo reserved for future biometric / RFID / QR / GPS.
 */
const entrySchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    staffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff" },
    employeeUserId: { type: Schema.Types.ObjectId, ref: "User" },
    employeeCode: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    department: { type: String, default: "" },
    designation: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LEAVE", "HALF_DAY", "LATE", "OFFICIAL_DUTY", "HOLIDAY"],
      required: true
    },
    checkInTime: { type: String, default: "" },
    checkOutTime: { type: String, default: "" },
    remarks: { type: String, default: "" },
    source: {
      type: String,
      enum: ["MANUAL", "BIOMETRIC", "RFID", "QR", "MOBILE", "GPS"],
      default: "MANUAL"
    },
    deviceId: { type: String, default: "" },
    externalRef: { type: String, default: "" },
    geo: {
      lat: { type: Number },
      lng: { type: Number }
    }
  },
  { _id: false }
);

const employeeAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    category: {
      type: String,
      enum: ["TEACHER", "STAFF"],
      required: true,
      index: true
    },
    dateBs: { type: String, required: true, index: true },
    academicYearBs: { type: String, default: "" },
    entries: { type: [entrySchema], default: [] },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "LOCKED"],
      default: "LOCKED",
      index: true
    },
    sourceDefault: {
      type: String,
      enum: ["MANUAL", "BIOMETRIC", "RFID", "QR", "MOBILE", "GPS"],
      default: "MANUAL"
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    unlockedBy: { type: Schema.Types.ObjectId, ref: "User" },
    unlockedAt: { type: Date },
    unlockReason: { type: String },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

employeeAttendanceSchema.index(
  { schoolId: 1, category: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
employeeAttendanceSchema.index({ schoolId: 1, dateBs: 1, category: 1 });
employeeAttendanceSchema.index({ "entries.teacherId": 1, dateBs: 1 });
employeeAttendanceSchema.index({ "entries.staffId": 1, dateBs: 1 });
employeeAttendanceSchema.index({ "entries.employeeUserId": 1, dateBs: 1 });

export type EmployeeAttendanceDocument = InferSchemaType<typeof employeeAttendanceSchema>;
export const EmployeeAttendance = mongoose.model(
  "EmployeeAttendance",
  employeeAttendanceSchema
);
