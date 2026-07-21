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

const editRequestSchema = new Schema(
  {
    requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    requestedAt: { type: Date },
    reason: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, default: "" }
  },
  { _id: false }
);

const fieldDutyAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: "FieldDutySchedule", required: true, index: true },
    dateBs: { type: String, required: true, index: true },
    postingType: { type: String, default: "HOSPITAL", index: true },
    siteName: { type: String, default: "" },
    hospitalName: { type: String, required: true },
    department: { type: String, default: "" },
    ward: { type: String, default: "" },
    shift: {
      type: String,
      enum: ["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"],
      default: "DAY"
    },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", required: true, index: true },
    /** Primary field coordinator (CollegeStaff). */
    supervisorStaffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff", required: true, index: true },
    /** @deprecated Legacy teacher supervisor */
    supervisorTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: false, index: true },
    entries: { type: [entrySchema], default: [] },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "LOCKED"],
      default: "LOCKED",
      index: true
    },
    /** Coordinator-initiated correction request; only admin may approve. */
    editRequest: { type: editRequestSchema, required: false },
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

// One attendance record per duty schedule per day per shift
// (MULTI_SHIFT postings submit separately for MORNING / DAY / NIGHT / …)
fieldDutyAttendanceSchema.index(
  { schoolId: 1, scheduleId: 1, dateBs: 1, shift: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
fieldDutyAttendanceSchema.index({ schoolId: 1, dateBs: 1 });
fieldDutyAttendanceSchema.index({ "entries.studentId": 1, dateBs: 1 });
fieldDutyAttendanceSchema.index({ schoolId: 1, "editRequest.status": 1 });

export type FieldDutyAttendanceDocument = InferSchemaType<typeof fieldDutyAttendanceSchema>;
export const FieldDutyAttendance = mongoose.model("FieldDutyAttendance", fieldDutyAttendanceSchema);
