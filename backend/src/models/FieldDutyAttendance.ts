import mongoose, { Schema, type InferSchemaType } from "mongoose";

const entrySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LATE", "LEAVE", "EMERGENCY_DUTY"],
      required: true
    },
    remarks: { type: String, default: "" }
  },
  { _id: false }
);

const fieldDutyAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: "FieldDutySchedule", required: true, index: true },
    dateBs: { type: String, required: true, index: true },
    hospitalName: { type: String, required: true },
    department: { type: String, required: true },
    ward: { type: String, default: "" },
    shift: {
      type: String,
      enum: ["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"],
      default: "DAY"
    },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", required: true, index: true },
    supervisorTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    entries: { type: [entrySchema], default: [] },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "LOCKED"],
      default: "LOCKED",
      index: true
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    unlockedBy: { type: Schema.Types.ObjectId, ref: "User" },
    unlockedAt: { type: Date },
    unlockReason: { type: String },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

// One attendance record per duty schedule per day
fieldDutyAttendanceSchema.index(
  { schoolId: 1, scheduleId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
fieldDutyAttendanceSchema.index({ schoolId: 1, dateBs: 1 });
fieldDutyAttendanceSchema.index({ "entries.studentId": 1, dateBs: 1 });

export type FieldDutyAttendanceDocument = InferSchemaType<typeof fieldDutyAttendanceSchema>;
export const FieldDutyAttendance = mongoose.model("FieldDutyAttendance", fieldDutyAttendanceSchema);
