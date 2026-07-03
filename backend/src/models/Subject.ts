import mongoose, { Schema, type InferSchemaType } from "mongoose";

const subjectSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    yearIds: [{ type: Schema.Types.ObjectId, ref: "Year" }],
    teacherIds: [{ type: Schema.Types.ObjectId, ref: "Teacher" }],
    fullMarks: { type: Number, required: true },
    passMarks: { type: Number, required: true }
  },
  { timestamps: true }
);

subjectSchema.index({ schoolId: 1, code: 1 }, { unique: true });

export type SubjectDocument = InferSchemaType<typeof subjectSchema>;
export const Subject = mongoose.model("Subject", subjectSchema);
