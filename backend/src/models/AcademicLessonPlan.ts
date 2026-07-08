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

const lessonPlanSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    sessionPlanId: { type: Schema.Types.ObjectId, ref: "AcademicSessionPlan" },
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
    month: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "REJECTED"],
      default: "DRAFT",
      index: true
    },
    preparedBy: { type: String },
    checkedBy: { type: String },
    approvedByName: { type: String },
    approvalDate: { type: String },
    adminRemarks: { type: String },
    audit: { type: auditSchema, required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

lessonPlanSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, teacherId: 1, month: 1, classId: 1, sectionId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, classId: { $exists: true } } }
);
lessonPlanSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, teacherId: 1, month: 1, batchId: 1, yearId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, batchId: { $exists: true } } }
);

export type AcademicLessonPlanDocument = InferSchemaType<typeof lessonPlanSchema>;
export const AcademicLessonPlan = mongoose.model("AcademicLessonPlan", lessonPlanSchema);