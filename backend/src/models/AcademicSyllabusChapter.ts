import mongoose, { Schema, type InferSchemaType } from "mongoose";

const chapterSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus", required: true, index: true },
    chapterNo: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    estimatedHours: { type: Number, default: 0, min: 0 },
    weightagePercent: { type: Number, default: 0, min: 0, max: 100 },
    references: { type: String, default: "" },
    remarks: { type: String, default: "" },
    tentativeCompletionMonth: { type: String, default: "" },
    sortOrder: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

chapterSchema.index({ syllabusId: 1, chapterNo: 1 }, { unique: true });
chapterSchema.index({ syllabusId: 1, sortOrder: 1 });

export type AcademicSyllabusChapterDocument = InferSchemaType<typeof chapterSchema>;
export const AcademicSyllabusChapter = mongoose.model("AcademicSyllabusChapter", chapterSchema);
