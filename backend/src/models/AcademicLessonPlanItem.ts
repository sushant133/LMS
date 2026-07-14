import mongoose, { Schema, type InferSchemaType } from "mongoose";

const itemSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    lessonPlanId: { type: Schema.Types.ObjectId, ref: "AcademicLessonPlan", required: true },
    serialNo: { type: Number, required: true, min: 1 },
    sessionPlanUnitId: { type: Schema.Types.ObjectId, ref: "AcademicSessionPlanUnit" },
    subUnitTitle: { type: String, default: "" },
    subjectLabel: { type: String, default: "" },
    plannedTopic: { type: String, required: true },
    description: { type: String, default: "" },
    learningObjectives: { type: String, default: "" },
    teachingMethod: { type: String, default: "" },
    teachingAids: { type: String, default: "" },
    assessmentMethod: { type: String, default: "" },
    deadline: { type: String, default: "" },
    itemStartDateBs: { type: String, default: "" },
    itemEndDateBs: { type: String, default: "" },
    estimatedClasses: { type: Number, default: 1, min: 1 },
    completedClasses: { type: Number, default: 0, min: 0 },
    completionStatus: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"],
      default: "PENDING"
    },
    remarks: { type: String, default: "" }
  },
  { timestamps: true }
);

itemSchema.index({ lessonPlanId: 1, serialNo: 1 }, { unique: true });

export type AcademicLessonPlanItemDocument = InferSchemaType<typeof itemSchema>;
export const AcademicLessonPlanItem = mongoose.model("AcademicLessonPlanItem", itemSchema);