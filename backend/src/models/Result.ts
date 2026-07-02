import mongoose, { Schema, type InferSchemaType } from "mongoose";

const markSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    obtainedMarks: { type: Number, required: true }
  },
  { _id: false }
);

const resultSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    marks: { type: [markSchema], default: [] },
    percentage: { type: Number, required: true },
    gpa: { type: Number, required: true },
    grade: { type: String, required: true },
    publishedAtBs: { type: String }
  },
  { timestamps: true }
);

resultSchema.index({ schoolId: 1, examId: 1, studentId: 1 }, { unique: true });

export type ResultDocument = InferSchemaType<typeof resultSchema>;
export const Result = mongoose.model("Result", resultSchema);
