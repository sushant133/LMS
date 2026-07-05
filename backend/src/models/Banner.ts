import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { BANNER_PRIORITIES, BANNER_TARGET_ROLES } from "@phit-erp/shared";

const bannerSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    imageUrl: { type: String },
    buttonText: { type: String },
    buttonUrl: { type: String },
    backgroundColor: { type: String },
    textColor: { type: String },
    priority: { type: String, enum: BANNER_PRIORITIES, default: "MEDIUM" },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    showOnce: { type: Boolean, default: false },
    dismissible: { type: Boolean, default: true },
    targetRoles: { type: [String], enum: BANNER_TARGET_ROLES, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

bannerSchema.index({ schoolId: 1, isActive: 1, startAt: 1, endAt: 1 });

export type BannerDocument = InferSchemaType<typeof bannerSchema>;
export const Banner = mongoose.model("Banner", bannerSchema);