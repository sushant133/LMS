import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { PARENT_LINK_STATUSES, PARENT_RELATIONSHIPS } from "@phit-erp/shared";

const parentChildLinkSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    parentUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    relationship: { type: String, enum: PARENT_RELATIONSHIPS, required: true },
    isPrimary: { type: Boolean, default: false },
    status: { type: String, enum: PARENT_LINK_STATUSES, default: "APPROVED", index: true },
    studentRegistrationNumber: { type: String, trim: true },
    rejectionReason: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

parentChildLinkSchema.index({ schoolId: 1, parentUserId: 1, studentId: 1 }, { unique: true });
parentChildLinkSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export type ParentChildLinkDocument = InferSchemaType<typeof parentChildLinkSchema>;
export const ParentChildLink = mongoose.model("ParentChildLink", parentChildLinkSchema);