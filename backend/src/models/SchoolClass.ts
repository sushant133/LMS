import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { CLASS_LEVELS } from "@phit-erp/shared";

const schoolClassSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    level: { type: String, enum: CLASS_LEVELS, required: true },
    academicYearBs: { type: String, required: true },
    coordinatorId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

schoolClassSchema.index({ schoolId: 1, name: 1, academicYearBs: 1 }, { unique: true });

export type SchoolClassDocument = InferSchemaType<typeof schoolClassSchema>;
export const SchoolClass = mongoose.model("SchoolClass", schoolClassSchema);
