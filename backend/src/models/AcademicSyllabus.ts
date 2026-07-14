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

const academicSyllabusSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicYearBs: { type: String, required: true, index: true },
    session: { type: String, required: true },
    faculty: { type: String },
    semesterBs: { type: String },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    /** Optional — subject syllabus shared by assigned teachers. */
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", index: true },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "REJECTED"],
      default: "DRAFT",
      index: true
    },
    adminRemarks: { type: String },
    attachmentUrl: { type: String },
    audit: { type: auditSchema, required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

// One active syllabus per subject + year level (college) or class (school)
academicSyllabusSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, yearId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, yearId: { $exists: true, $ne: null } } }
);
academicSyllabusSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, classId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, classId: { $exists: true, $ne: null } } }
);

export type AcademicSyllabusDocument = InferSchemaType<typeof academicSyllabusSchema>;
export const AcademicSyllabus = mongoose.model("AcademicSyllabus", academicSyllabusSchema);
