import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  ACADEMIC_PROMOTION_OUTCOMES,
  ACADEMIC_PROMOTION_STATUSES,
  STUDENT_ACADEMIC_STATUSES
} from "@phit-erp/shared";

const studentSnapshotSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    admissionNumber: { type: String, required: true },
    fullName: { type: String },
    previousYearId: { type: Schema.Types.ObjectId, ref: "Year" },
    previousYearName: { type: String },
    previousLevel: { type: Number },
    newYearId: { type: Schema.Types.ObjectId, ref: "Year" },
    newYearName: { type: String },
    newLevel: { type: Number },
    previousStatus: { type: String, enum: STUDENT_ACADEMIC_STATUSES, required: true },
    newStatus: { type: String, enum: STUDENT_ACADEMIC_STATUSES, required: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    batchName: { type: String, required: true },
    outcome: { type: String, enum: ACADEMIC_PROMOTION_OUTCOMES, required: true }
  },
  { _id: false }
);

const promotionGroupSchema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    batchName: { type: String, required: true },
    previousYearId: { type: Schema.Types.ObjectId, ref: "Year" },
    previousYearName: { type: String, required: true },
    previousLevel: { type: Number, required: true },
    newYearId: { type: Schema.Types.ObjectId, ref: "Year" },
    newYearName: { type: String, required: true },
    newLevel: { type: Number },
    outcome: { type: String, enum: ACADEMIC_PROMOTION_OUTCOMES, required: true },
    studentCount: { type: Number, required: true, min: 0 },
    students: { type: [studentSnapshotSchema], default: [] }
  },
  { _id: false }
);

const academicPromotionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicSessionBs: { type: String, required: true, trim: true },
    promotionDate: { type: Date, required: true, default: () => new Date() },
    promotedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    promotedByName: { type: String, required: true },
    remarks: { type: String },
    status: { type: String, enum: ACADEMIC_PROMOTION_STATUSES, default: "COMPLETED", index: true },
    totalStudents: { type: Number, required: true, min: 0 },
    groups: { type: [promotionGroupSchema], default: [] },
    rolledBackAt: { type: Date },
    rolledBackBy: { type: Schema.Types.ObjectId, ref: "User" },
    rolledBackByName: { type: String },
    rollbackRemarks: { type: String }
  },
  { timestamps: true }
);

academicPromotionSchema.index({ schoolId: 1, createdAt: -1 });
academicPromotionSchema.index(
  { schoolId: 1, academicSessionBs: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "COMPLETED" } }
);

export type AcademicPromotionDocument = InferSchemaType<typeof academicPromotionSchema>;
export const AcademicPromotion = mongoose.model("AcademicPromotion", academicPromotionSchema);
