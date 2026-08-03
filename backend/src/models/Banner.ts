import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";
import { BANNER_TARGET_ROLES } from "@phit-erp/shared";

const bannerSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    imageUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    isActive: { type: Boolean, default: true },
    /** Dashboard audiences who can see this banner (separate from notice visibility). */
    visibleTo: {
      type: [{ type: String, enum: BANNER_TARGET_ROLES }],
      default: () => [...BANNER_TARGET_ROLES],
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: "Select at least one audience for Visible to"
      }
    },
    fileSizeBytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    originalFileName: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

bannerSchema.index({ schoolId: 1, isActive: 1, createdAt: -1 });

export type BannerDocument = InferSchemaType<typeof bannerSchema>;
bannerSchema.plugin(softDeletePlugin);
export const Banner = mongoose.model("Banner", bannerSchema);