import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Borrower-specific extra allowance on top of the default limit.
 *
 * Students are addressed by `studentId`, teachers by `teacherId` and college
 * staff by `staffId`. Documents written before teacher/staff support have no
 * `borrowerType`; readers treat a missing value as "STUDENT".
 */
const libraryIssueLimitExceptionSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true
    },
    borrowerType: {
      type: String,
      enum: ["STUDENT", "TEACHER", "STAFF"],
      default: "STUDENT",
      index: true
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      index: true
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: "Teacher",
      index: true
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "CollegeStaff",
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
libraryIssueLimitExceptionSchema.index({
  schoolId: 1,
  teacherId: 1,
  isRevoked: 1
});
libraryIssueLimitExceptionSchema.index({
  schoolId: 1,
  staffId: 1,
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
