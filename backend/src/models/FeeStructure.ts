import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeStructureSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    feeType: {
      type: String,
      enum: ["ADMISSION", "TUITION", "MONTHLY", "EXAM", "LIBRARY", "LAB", "TRANSPORT", "HOSTEL", "OTHER", "ANNUAL"],
      required: true
    },
    frequency: { type: String, enum: ["MONTHLY", "ANNUAL", "ONE_TIME"], required: true },
    academicYearBs: { type: String, required: true },
    amountNpr: { type: Number, required: true },
    isOptional: { type: Boolean, default: false }
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, title: 1, academicYearBs: 1 }, { unique: true });

export type FeeStructureDocument = InferSchemaType<typeof feeStructureSchema>;
export const FeeStructure = mongoose.model("FeeStructure", feeStructureSchema);
