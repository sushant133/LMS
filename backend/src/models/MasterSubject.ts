import mongoose, { Schema, type InferSchemaType } from "mongoose";

const masterSubjectSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    yearLevel: { type: Number, required: true, min: 1, max: 3 },
    creditHours: { type: Number, min: 0 },
    theoryMarks: { type: Number, required: true, min: 0 },
    practicalMarks: { type: Number, min: 0 },
    internalMarks: { type: Number, min: 0 },
    passMarks: { type: Number, required: true, min: 0 },
    fullMarks: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

masterSubjectSchema.index({ schoolId: 1, code: 1 }, { unique: true });
masterSubjectSchema.index({ schoolId: 1, yearLevel: 1, name: 1 });

export type MasterSubjectDocument = InferSchemaType<typeof masterSubjectSchema>;
export const MasterSubject = mongoose.model("MasterSubject", masterSubjectSchema);