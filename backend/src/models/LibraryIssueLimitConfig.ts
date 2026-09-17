import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  defaultLibraryIssueStaffLimits,
  defaultLibraryIssueYearLimits
} from "@phit-erp/shared";

/**
 * One document per school.
 *
 * `limits` holds the per-academic-year student caps; `staffLimits` holds the
 * flat teacher / staff caps. Both are Mixed so labels with spaces (e.g.
 * "1st Year") are safe as keys.
 */
const libraryIssueLimitConfigSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: true,
      unique: true,
      index: true
    },
    limits: {
      type: Schema.Types.Mixed,
      required: true,
      default: () => defaultLibraryIssueYearLimits()
    },
    /** Older configs predate this field — readers fall back to defaults. */
    staffLimits: {
      type: Schema.Types.Mixed,
      default: () => defaultLibraryIssueStaffLimits()
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export type LibraryIssueLimitConfigDocument = InferSchemaType<
  typeof libraryIssueLimitConfigSchema
>;
export const LibraryIssueLimitConfig = mongoose.model(
  "LibraryIssueLimitConfig",
  libraryIssueLimitConfigSchema
);
