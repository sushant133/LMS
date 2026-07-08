import mongoose, { Schema, type InferSchemaType } from "mongoose";

const auditSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deletedAt: { type: Date }
  },
  { _id: false }
);

const entrySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    logBookId: { type: Schema.Types.ObjectId, ref: "AcademicLogBook", index: true },
    lessonPlanId: { type: Schema.Types.ObjectId, ref: "AcademicLessonPlan" },
    lessonPlanItemId: { type: Schema.Types.ObjectId, ref: "AcademicLessonPlanItem" },
    sessionPlanUnitId: { type: Schema.Types.ObjectId, ref: "AcademicSessionPlanUnit" },
    academicYearBs: { type: String, required: true, index: true },
    session: { type: String, required: true },
    faculty: { type: String },
    semesterBs: { type: String },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    timetableSlotId: { type: Schema.Types.ObjectId, ref: "TimetableSlot" },
    serialNo: { type: Number, required: true, min: 1 },
    dateBs: { type: String, required: true, index: true },
    unit: { type: String, default: "" },
    topicCovered: { type: String, required: true },
    objectives: { type: String, default: "" },
    teachingMethod: { type: String, default: "" },
    teachingAids: { type: String, default: "" },
    theoryPractical: { type: String, enum: ["THEORY", "PRACTICAL", "BOTH"], default: "THEORY" },
    periodNumber: { type: Number, required: true, min: 1 },
    startTime: { type: String },
    endTime: { type: String },
    attendancePresent: { type: Number, default: 0, min: 0 },
    attendanceAbsent: { type: Number, default: 0, min: 0 },
    attendancePercent: { type: Number, default: 0, min: 0, max: 100 },
    homeworkGiven: { type: String, default: "" },
    assignment: { type: String, default: "" },
    feedback: { type: String, default: "" },
    difficultiesFaced: { type: String, default: "" },
    nextClassPlan: { type: String, default: "" },
    attachmentUrl: { type: String },
    reviewStatus: {
      type: String,
      enum: ["PENDING", "REVIEWED", "APPROVED", "NEEDS_IMPROVEMENT"],
      default: "PENDING",
      index: true
    },
    teacherSignature: { type: String },
    adminSignature: { type: String },
    adminRemarks: { type: String },
    audit: { type: auditSchema, required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

entrySchema.index(
  { schoolId: 1, teacherId: 1, subjectId: 1, dateBs: 1, periodNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export type AcademicLogBookEntryDocument = InferSchemaType<typeof entrySchema>;
export const AcademicLogBookEntry = mongoose.model("AcademicLogBookEntry", entrySchema);