import mongoose, { Schema, type InferSchemaType } from "mongoose";

const notificationSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientPhone: { type: String },
    title: { type: String, required: true },
    message: { type: String, required: true },
    channel: { type: String, enum: ["IN_APP", "SMS", "BOTH"], default: "IN_APP" },
    type: {
      type: String,
      enum: ["ATTENDANCE", "HOMEWORK", "FEE", "NOTICE", "TRANSPORT", "LIBRARY", "LABORATORY", "PAYROLL", "EXAM", "COMPLAINT", "ACADEMIC_MANAGEMENT", "ACADEMIC_CALENDAR", "ACADEMIC_PROMOTION", "GENERAL"],
      default: "GENERAL"
    },
    read: { type: Boolean, default: false },
    smsStatus: { type: String, enum: ["PENDING", "SENT", "FAILED", "SKIPPED"], default: "SKIPPED" },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;
export const Notification = mongoose.model("Notification", notificationSchema);