import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Student-specific extra borrowing allowance on top of year default limit.
 */
const libraryIssueLimitExceptionSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true
    },
    additionalBooks: { type: Number, required: true, min: 1, max: 20 },
    reason: { type: String, required: true, trim: true },
    effectiveFromBs: { type: String, required: true, trim: true },
    /** Empty string = no end date. */
    effectiveUntilBs: { type: String, default: "", trim: true },
    remarks: { type: String, default: "", trim: true },
    isRevoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

libraryIssueLimitExceptionSchema.index({
  schoolId: 1,
  studentId: 1,
  isRevoked: 1
});
libraryIssueLimitExceptionSchema.index({ schoolId: 1, isRevoked: 1 });

export type LibraryIssueLimitExceptionDocument = InferSchemaType<
  typeof libraryIssueLimitExceptionSchema
>;
export const LibraryIssueLimitException = mongoose.model(
  "LibraryIssueLimitException",
  libraryIssueLimitExceptionSchema
);
