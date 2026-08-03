import mongoose, { Schema, type InferSchemaType } from "mongoose";

const feeStructureSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    batchIds: [{ type: Schema.Types.ObjectId, ref: "Batch" }],
    yearIds: [{ type: Schema.Types.ObjectId, ref: "Year" }],
    faculty: { type: String },
    program: { type: String },
    feeType: {
      type: String,
      enum: [
        "ADMISSION",
        "REGISTRATION",
        "TUITION",
        "MONTHLY",
        "EXAM",
        "PRACTICAL",
        "LIBRARY",
        "LAB",
        "TRANSPORT",
        "HOSTEL",
        "FINE",
        "SCHOLARSHIP",
        "MISC",
        "REFUND",
        "OTHER",
        "ANNUAL"
      ],
      required: true
    },
    frequency: { type: String, enum: ["MONTHLY", "ANNUAL", "ONE_TIME", "SEMESTER"], required: true },
    academicYearBs: { type: String, required: true },
    semesterBs: { type: String },
    amountNpr: { type: Number, required: true },
    installmentCount: { type: Number },
    isOptional: { type: Boolean, default: false },
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE" },
    version: { type: Number, default: 1 },
    versionGroupId: { type: String },
    effectiveFromBs: { type: String }
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, title: 1, academicYearBs: 1, version: 1 }, { unique: true });

export type FeeStructureDocument = InferSchemaType<typeof feeStructureSchema>;
export const FeeStructure = mongoose.model("FeeStructure", feeStructureSchema);
