import mongoose, { Schema, type InferSchemaType } from "mongoose";

const examSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    academicYearBs: { type: String, required: true },
    startDateBs: { type: String, required: true },
    endDateBs: { type: String, required: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }]
  },
  { timestamps: true }
);

examSchema.index({ schoolId: 1, name: 1, academicYearBs: 1 }, { unique: true });

export type ExamDocument = InferSchemaType<typeof examSchema>;
export const Exam = mongoose.model("Exam", examSchema);
