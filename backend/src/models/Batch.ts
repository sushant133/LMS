import mongoose, { Schema, type InferSchemaType } from "mongoose";

const batchSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    academicYearBs: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

batchSchema.index({ schoolId: 1, name: 1, academicYearBs: 1 }, { unique: true });

export type BatchDocument = InferSchemaType<typeof batchSchema>;
export const Batch = mongoose.model("Batch", batchSchema);