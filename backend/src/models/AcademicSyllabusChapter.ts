import mongoose, { Schema, type InferSchemaType } from "mongoose";

const chapterSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus", required: true, index: true },
    chapterNo: { type: Number, required: true, min: 1 },
    /**
     * Optional grouping kind — pick at most one of Chapter or Part.
     * NONE = units only (no Chapter/Part heading).
     */
    sectionKind: {
      type: String,
      enum: ["NONE", "CHAPTER", "PART"],
      default: "NONE",
      index: true
    },
    /** Title for Chapter or Part (ignored when sectionKind is NONE). */
    title: { type: String, default: "", trim: true },
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
