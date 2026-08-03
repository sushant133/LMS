import mongoose, { Schema, type InferSchemaType } from "mongoose";

const attendanceEntrySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: { type: String, enum: ["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"], required: true }
  },
  { _id: false }
);

const attendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    dateBs: { type: String, required: true },
    entries: { type: [attendanceEntrySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

attendanceSchema.index(
  { schoolId: 1, classId: 1, sectionId: 1, subjectId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true }, sectionId: { $exists: true } } }
);
attendanceSchema.index(
  { schoolId: 1, batchId: 1, yearId: 1, subjectId: 1, dateBs: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true }, yearId: { $exists: true } } }
);

export type AttendanceDocument = InferSchemaType<typeof attendanceSchema>;
export const Attendance = mongoose.model("Attendance", attendanceSchema);
