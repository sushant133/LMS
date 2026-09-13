import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Durable "we already told this user about X" record.
 *
 * Notifications themselves are DELETED when the user clears them
 * (markNotificationRead / markAllNotificationsRead both delete), so the
 * Notification collection cannot be used to decide whether a recurring digest
 * has already been delivered — clearing it would immediately re-arm the very
 * notification the user just dismissed.
 *
 * This collection is separate and is never touched by clearing, so a recurring
 * job can ask "has this exact content already gone out?" and stay quiet.
 * It also survives process restarts, unlike an in-memory Set.
 */
const notificationDedupeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Stable identity of the notification stream, e.g. "admin-pending:<schoolId>". */
    dedupeKey: { type: String, required: true },
    /** Hash of what was last said. A new hash means the content genuinely changed. */
    contentHash: { type: String, required: true },
    lastSentAt: { type: Date, required: true },
    /**
     * When this record stops mattering. Auto-derived keys (the default path)
     * only need to outlive their re-send window; named streams stick around so
     * a digest stays suppressed for good.
     */
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

notificationDedupeSchema.index({ recipientUserId: 1, dedupeKey: 1 }, { unique: true });
/** Housekeeping: Mongo drops each record at its own expiry. */
notificationDedupeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type NotificationDedupeDocument = InferSchemaType<typeof notificationDedupeSchema>;
export const NotificationDedupe = mongoose.model(
  "NotificationDedupe",
  notificationDedupeSchema
);
