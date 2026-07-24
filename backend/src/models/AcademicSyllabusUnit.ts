import mongoose, { Schema, type InferSchemaType } from "mongoose";

const unitSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus", required: true },
    unitNo: { type: Number, required: true, min: 1 },
    /** Optional — blank unit title is allowed for partial syllabus drafts. */
    chapterName: { type: String, default: "", trim: true },
    estimatedTeachingHours: { type: Number, default: 0, min: 0 },
    learningOutcomes: { type: String, default: "" },
    topicsCovered: { type: String, default: "" },
    references: { type: String, default: "" },
    practicalRequired: { type: Boolean, default: false },
    internalAssessment: { type: String, default: "" },
    tentativeCompletionMonth: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"],
      default: "PENDING"
    },
    attachmentUrl: { type: String }
  },
  { timestamps: true }
);

unitSchema.index({ syllabusId: 1, unitNo: 1 }, { unique: true });

export type AcademicSyllabusUnitDocument = InferSchemaType<typeof unitSchema>;
export const AcademicSyllabusUnit = mongoose.model("AcademicSyllabusUnit", unitSchema);
