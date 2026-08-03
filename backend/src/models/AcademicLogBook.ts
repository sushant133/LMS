import mongoose, { Schema, type InferSchemaType } from "mongoose";

const logBookSchema = new Schema(
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
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    month: { type: String, required: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

logBookSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, teacherId: 1, month: 1, classId: 1, sectionId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, classId: { $exists: true } } }
);
logBookSchema.index(
  { schoolId: 1, academicYearBs: 1, subjectId: 1, teacherId: 1, month: 1, batchId: 1, yearId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, batchId: { $exists: true } } }
);

export type AcademicLogBookDocument = InferSchemaType<typeof logBookSchema>;
export const AcademicLogBook = mongoose.model("AcademicLogBook", logBookSchema);