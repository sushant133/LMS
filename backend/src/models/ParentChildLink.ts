import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { PARENT_RELATIONSHIPS } from "@nepal-school-erp/shared";

const parentChildLinkSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    parentUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    relationship: { type: String, enum: PARENT_RELATIONSHIPS, required: true },
    isPrimary: { type: Boolean, default: false }
  },
  { timestamps: true }
);

parentChildLinkSchema.index({ schoolId: 1, parentUserId: 1, studentId: 1 }, { unique: true });

export type ParentChildLinkDocument = InferSchemaType<typeof parentChildLinkSchema>;
export const ParentChildLink = mongoose.model("ParentChildLink", parentChildLinkSchema);