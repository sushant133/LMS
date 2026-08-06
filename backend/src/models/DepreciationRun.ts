import mongoose, { Schema, type InferSchemaType } from "mongoose";

const depreciationLineSchema = new Schema(
  {
    assetId: { type: Schema.Types.ObjectId, ref: "FixedAsset", required: true },
    assetCode: { type: String, default: "" },
    assetName: { type: String, default: "" },
    pool: { type: String, default: "" },
    ratePercent: { type: Number, default: 0 },
    /** Fraction applied for assets acquired mid-year (1, 2/3 or 1/3). */
    acquisitionFactor: { type: Number, default: 1 },
    openingWdvNpr: { type: Number, default: 0 },
    depreciationNpr: { type: Number, default: 0 },
    closingWdvNpr: { type: Number, default: 0 }
  },
  { _id: false }
);

const depreciationRunSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    fiscalYearBs: { type: String, required: true, index: true },
    /** Posting date — normally the last day of the fiscal year. */
    runDateBs: { type: String, required: true },
    lines: { type: [depreciationLineSchema], default: [] },
    totalDepreciationNpr: { type: Number, default: 0 },
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    notes: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// One live depreciation run per fiscal year — prevents charging a year twice.
depreciationRunSchema.index(
  { schoolId: 1, fiscalYearBs: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export type DepreciationRunDocument = InferSchemaType<typeof depreciationRunSchema>;
export const DepreciationRun = mongoose.model("DepreciationRun", depreciationRunSchema);
