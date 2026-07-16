import mongoose, { Schema, type InferSchemaType } from "mongoose";

const unitSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    sessionPlanId: { type: Schema.Types.ObjectId, ref: "AcademicSessionPlan", required: true },
    unitNo: { type: Number, required: true, min: 1 },
    chapterName: { type: String, required: true },
    estimatedTeachingHours: { type: Number, default: 0, min: 0 },
    learningOutcomes: { type: String, default: "" },
    topicsCovered: { type: String, default: "" },
    references: { type: String, default: "" },
    practicalRequired: { type: Boolean, default: false },
    internalAssessment: { type: String, default: "" },
    tentativeCompletionMonth: { type: String, default: "" },
    startDateBs: { type: String, default: "" },
    endDateBs: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"],
      default: "PENDING"
    },
    attachmentUrl: { type: String },
    /** Optional link to hierarchical syllabus unit (import source). */
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus" },
    syllabusChapterId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabusChapter" },
    syllabusUnitId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabusTopic" }
  },
  { timestamps: true }
);

unitSchema.index({ sessionPlanId: 1, unitNo: 1 }, { unique: true });

export type AcademicSessionPlanUnitDocument = InferSchemaType<typeof unitSchema>;
export const AcademicSessionPlanUnit = mongoose.model("AcademicSessionPlanUnit", unitSchema);