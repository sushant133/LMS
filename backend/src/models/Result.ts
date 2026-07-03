import mongoose, { Schema, type InferSchemaType } from "mongoose";

const markSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    fullMarks: { type: Number, required: true },
    passMarks: { type: Number, required: true },
    theoryMarks: { type: Number, default: 0 },
    practicalMarks: { type: Number, default: 0 },
    internalMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, required: true },
    attendanceStatus: {
      type: String,
      enum: ["PRESENT", "ABSENT", "EXEMPT"],
      default: "PRESENT"
    },
    teacherRemarks: { type: String, trim: true },
    percentage: { type: Number },
    grade: { type: String },
    passFail: { type: String, enum: ["PASS", "FAIL"] }
  },
  { _id: false }
);

const resultSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    marks: { type: [markSchema], default: [] },
    percentage: { type: Number, required: true },
    gpa: { type: Number, required: true },
    grade: { type: String, required: true },
    passFailStatus: { type: String, enum: ["PASS", "FAIL"], required: true },
    publishedAtBs: { type: String }
  },
  { timestamps: true }
);

resultSchema.index({ schoolId: 1, examId: 1, studentId: 1 }, { unique: true });

export type ResultDocument = InferSchemaType<typeof resultSchema>;
export const Result = mongoose.model("Result", resultSchema);