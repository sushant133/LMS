import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Confidential code written on a student's answer sheet for one exam, so
 * evaluators mark scripts without knowing whose they are. Codes are typed by
 * the exam office (never generated). This collection is the only link between
 * a code and a student and is read by administrators only.
 */
const examConfidentialCodeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    /** As entered (shown on screen / written on the sheet). */
    code: { type: String, required: true, trim: true },
    /** Case-insensitive identity — "a-458" and "A-458" are the same sheet. */
    codeKey: { type: String, required: true },
    assignedByUserId: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// One code per student per exam…
examConfidentialCodeSchema.index({ examId: 1, studentId: 1 }, { unique: true });
// …and no two answer sheets in the same exam may share one.
examConfidentialCodeSchema.index({ schoolId: 1, examId: 1, codeKey: 1 }, { unique: true });

export const toConfidentialCodeKey = (code: string): string => code.trim().toUpperCase();

export type ExamConfidentialCodeDocument = InferSchemaType<typeof examConfidentialCodeSchema>;
export const ExamConfidentialCode = mongoose.model("ExamConfidentialCode", examConfidentialCodeSchema);
