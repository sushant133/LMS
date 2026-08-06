import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { DEPRECIATION_METHODS, DEPRECIATION_POOL_KEYS } from "@phit-erp/shared";

const fixedAssetSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    assetCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameNp: { type: String, default: "" },
    description: { type: String, default: "" },
    /** Income Tax Act 2058 Schedule 2 pool. LAND is held but never depreciated. */
    pool: { type: String, enum: DEPRECIATION_POOL_KEYS, required: true, index: true },
    category: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    serialNumber: { type: String, default: "" },
    location: { type: String, default: "" },
    custodian: { type: String, default: "" },
    vendorName: { type: String, default: "" },
    invoiceNumber: { type: String, default: "" },

    acquisitionDateBs: { type: String, required: true, index: true },
    acquisitionCostNpr: { type: Number, required: true },
    salvageValueNpr: { type: Number, default: 0 },

    /** WDV (pooled diminishing balance, the Nepal default) or straight line. */
    method: { type: String, enum: DEPRECIATION_METHODS, default: "WDV" },
    /** Defaults to the pool's statutory rate; overridable for intangibles. */
    ratePercent: { type: Number, required: true },
    /** Straight-line / intangible amortisation life. */
    usefulLifeYears: { type: Number, default: 0 },

    /**
     * Depreciation already charged before this register existed. Lets a school onboard
     * assets mid-life without back-posting years of depreciation journals.
     */
    openingAccumulatedDepreciationNpr: { type: Number, default: 0 },
    /** Running total charged by depreciation runs (excludes the opening figure). */
    accumulatedDepreciationNpr: { type: Number, default: 0 },

    status: { type: String, enum: ["ACTIVE", "DISPOSED", "WRITTEN_OFF"], default: "ACTIVE", index: true },
    disposalDateBs: { type: String },
    disposalProceedsNpr: { type: Number, default: 0 },
    disposalNotes: { type: String, default: "" },
    disposalJournalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },

    /** Journal that capitalised the asset, when it was posted through this module. */
    acquisitionJournalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

fixedAssetSchema.index(
  { schoolId: 1, assetCode: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export type FixedAssetDocument = InferSchemaType<typeof fixedAssetSchema>;
export const FixedAsset = mongoose.model("FixedAsset", fixedAssetSchema);
