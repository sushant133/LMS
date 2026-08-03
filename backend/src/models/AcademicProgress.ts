import mongoose, { Schema, type InferSchemaType } from "mongoose";

const progressSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    sessionPlanId: { type: Schema.Types.ObjectId, ref: "AcademicSessionPlan", required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    academicYearBs: { type: String, required: true, index: true },
    completedPercent: { type: Number, default: 0, min: 0, max: 100 },
    remainingPercent: { type: Number, default: 100, min: 0, max: 100 },
    completedUnits: { type: Number, default: 0, min: 0 },
    remainingUnits: { type: Number, default: 0, min: 0 },
    delayedUnits: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

progressSchema.index({ sessionPlanId: 1 }, { unique: true });

export type AcademicProgressDocument = InferSchemaType<typeof progressSchema>;
export const AcademicProgress = mongoose.model("AcademicProgress", progressSchema);