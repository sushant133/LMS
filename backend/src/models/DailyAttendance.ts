import mongoose, { Schema, type InferSchemaType } from "mongoose";

const dailyAttendanceEntrySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"],
      required: true
    },
    remarks: { type: String, default: "" }
  },
  { _id: false }
);

const dailyAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    academicYearBs: { type: String, required: true },
    dateBs: { type: String, required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    timetableSlotId: { type: Schema.Types.ObjectId, ref: "TimetableSlot" },
    periodNumber: { type: Number, default: 1 },
    startTime: { type: String },
    endTime: { type: String },
    entries: { type: [dailyAttendanceEntrySchema], default: [] },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["DRAFT", "SUBMITTED", "LOCKED"], default: "LOCKED" },
    syncedAttendanceId: { type: Schema.Types.ObjectId, ref: "Attendance" },
    synchronizedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    lastEditedBy: { type: Schema.Types.ObjectId, ref: "User" },
    unlockedBy: { type: Schema.Types.ObjectId, ref: "User" },
    unlockedAt: { type: Date },
    unlockReason: { type: String },
    reassignedFromTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    teacherReassignReason: { type: String },
    isSubstituteMarking: { type: Boolean, default: false }
  },
  { timestamps: true }
);

dailyAttendanceSchema.index(
  { schoolId: 1, classId: 1, sectionId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true }, sectionId: { $exists: true } } }
);
dailyAttendanceSchema.index(
  { schoolId: 1, batchId: 1, yearId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true }, yearId: { $exists: true } } }
);
dailyAttendanceSchema.index({ schoolId: 1, teacherId: 1, dateBs: 1 });
dailyAttendanceSchema.index({ syncedAttendanceId: 1 });

export type DailyAttendanceDocument = InferSchemaType<typeof dailyAttendanceSchema>;
export const DailyAttendance = mongoose.model("DailyAttendance", dailyAttendanceSchema);