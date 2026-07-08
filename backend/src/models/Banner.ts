import mongoose, { Schema, type InferSchemaType } from "mongoose";

const bannerSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    imageUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    isActive: { type: Boolean, default: true },
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
export const Banner = mongoose.model("Banner", bannerSchema);