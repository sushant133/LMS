import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

const hospitalDepartmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    shortCode: { type: String, required: true, trim: true, uppercase: true },
    sortOrder: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

hospitalDepartmentSchema.index({ schoolId: 1, shortCode: 1 }, { unique: true });

export type HospitalDepartmentDocument = InferSchemaType<
  typeof hospitalDepartmentSchema
>;
hospitalDepartmentSchema.plugin(softDeletePlugin);
export const HospitalDepartment = mongoose.model(
  "HospitalDepartment",
  hospitalDepartmentSchema,
);
