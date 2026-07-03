import mongoose, { Schema, type InferSchemaType } from "mongoose";

const examRoutineSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    examDateBs: { type: String, required: true },
    day: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    examHall: { type: String, trim: true },
    invigilator: { type: String, trim: true },
    remarks: { type: String, trim: true }
  },
  { timestamps: true }
);

examRoutineSchema.index({ examId: 1, subjectId: 1 }, { unique: true });

export type ExamRoutineDocument = InferSchemaType<typeof examRoutineSchema>;
export const ExamRoutine = mongoose.model("ExamRoutine", examRoutineSchema);