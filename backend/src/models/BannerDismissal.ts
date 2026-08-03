import mongoose, { Schema, type InferSchemaType } from "mongoose";

const bannerDismissalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    bannerId: { type: Schema.Types.ObjectId, ref: "Banner", required: true }
  },
  { timestamps: true }
);

bannerDismissalSchema.index({ userId: 1, bannerId: 1 }, { unique: true });

export type BannerDismissalDocument = InferSchemaType<typeof bannerDismissalSchema>;
export const BannerDismissal = mongoose.model("BannerDismissal", bannerDismissalSchema);