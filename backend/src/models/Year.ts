import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { COLLEGE_YEAR_NAMES } from "@nepal-school-erp/shared";

const yearSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    name: { type: String, required: true, trim: true, enum: COLLEGE_YEAR_NAMES },
    level: { type: Number, required: true, min: 1, max: 3 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

yearSchema.index({ schoolId: 1, batchId: 1, level: 1 }, { unique: true });

export type YearDocument = InferSchemaType<typeof yearSchema>;
export const Year = mongoose.model("Year", yearSchema);