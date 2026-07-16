import mongoose, { Schema, type InferSchemaType } from "mongoose";

/** Unit (topic) under a syllabus chapter. */
const topicSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus", required: true, index: true },
    chapterId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabusChapter", required: true, index: true },
    unitNo: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    teachingHours: { type: Number, default: 0, min: 0 },
    learningObjective: { type: String, default: "" },
    references: { type: String, default: "" },
    remarks: { type: String, default: "" },
    practicalRequired: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

topicSchema.index({ chapterId: 1, unitNo: 1 }, { unique: true });
topicSchema.index({ syllabusId: 1, sortOrder: 1 });
topicSchema.index({ chapterId: 1, sortOrder: 1 });

export type AcademicSyllabusTopicDocument = InferSchemaType<typeof topicSchema>;
export const AcademicSyllabusTopic = mongoose.model("AcademicSyllabusTopic", topicSchema);
