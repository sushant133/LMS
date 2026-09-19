import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Symbol numbers are issued by hand, per exam — the board hands the college a
 * block of numbers for one sitting, so the same student carries a different
 * symbol number in First Term and Final. Rows exist only for students who were
 * actually given a number; the admit card falls back to the registration /
 * admission number when none is stored.
 */
const examSymbolNumberSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    symbolNumber: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

// One symbol number per student per exam.
examSymbolNumberSchema.index({ examId: 1, studentId: 1 }, { unique: true });
// …and no two students in the same exam may share one.
examSymbolNumberSchema.index({ schoolId: 1, examId: 1, symbolNumber: 1 }, { unique: true });

export type ExamSymbolNumberDocument = InferSchemaType<typeof examSymbolNumberSchema>;
export const ExamSymbolNumber = mongoose.model("ExamSymbolNumber", examSymbolNumberSchema);
