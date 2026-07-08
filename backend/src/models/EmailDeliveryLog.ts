import mongoose, { Schema, type InferSchemaType } from "mongoose";

const emailDeliveryLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    subject: { type: String, required: true },
    emailType: {
      type: String,
      enum: ["ACCOUNT_CREDENTIALS", "PASSWORD_RESET", "GENERAL"],
      default: "ACCOUNT_CREDENTIALS",
      index: true
    },
    status: {
      type: String,
      enum: ["SENT", "FAILED", "SKIPPED"],
      required: true,
      index: true
    },
    errorMessage: { type: String },
    messageId: { type: String },
    triggeredByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

emailDeliveryLogSchema.index({ schoolId: 1, createdAt: -1 });
emailDeliveryLogSchema.index({ userId: 1, createdAt: -1 });

export type EmailDeliveryLogDocument = InferSchemaType<typeof emailDeliveryLogSchema>;
export const EmailDeliveryLog = mongoose.model("EmailDeliveryLog", emailDeliveryLogSchema);
