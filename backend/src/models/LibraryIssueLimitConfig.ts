import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { defaultLibraryIssueYearLimits } from "@phit-erp/shared";

/**
 * One document per school: max concurrent library books by academic year level.
 * `limits` is stored as Mixed so year labels with spaces (e.g. "1st Year") are safe.
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
