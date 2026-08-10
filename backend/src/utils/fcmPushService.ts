import type { NotificationType } from "@phit-erp/shared";
import { User } from "../models/User.js";
import { getFirebaseMessaging } from "./firebaseAdmin.js";

export type FcmPlatform = "android" | "ios" | "web";

const MAX_TOKENS_PER_USER = 10;
const MAX_TOKEN_LENGTH = 4096;
const MIN_TOKEN_LENGTH = 32;

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument"
]);

export const sanitizeFcmToken = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  // FCM tokens are printable ASCII; reject whitespace / control characters
  if (!/^[\x21-\x7E]+$/.test(token)) return null;
  return token;
};

export const sanitizeFcmPlatform = (raw: unknown): FcmPlatform => {
  if (raw === "ios" || raw === "web" || raw === "android") return raw;
  return "android";
};

/**
 * Bind a device token to the authenticated user only.
 * Removes the same token from any other account (shared-device safety).
 */
export const registerFcmToken = async (
  userId: string,
  token: string,
  platform: FcmPlatform
): Promise<void> => {
  const now = new Date();

  // Device can only belong to one account at a time
  await User.updateMany(
    { _id: { $ne: userId }, "fcmTokens.token": token },
    { $pull: { fcmTokens: { token } } }
  );

  const user = await User.findById(userId).select("fcmTokens");
  if (!user) return;

  const existing = (user.fcmTokens ?? []).filter((entry) => entry.token !== token);
  existing.push({ token, platform, updatedAt: now });
  // Keep newest tokens only
  existing.sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });
  user.fcmTokens = existing.slice(0, MAX_TOKENS_PER_USER);
  await user.save();
};

/** Remove one device token from the authenticated user (logout / revoke). */
export const unregisterFcmToken = async (userId: string, token: string): Promise<void> => {
  await User.updateOne({ _id: userId }, { $pull: { fcmTokens: { token } } });
};

const removeInvalidTokens = async (tokens: string[]): Promise<void> => {
  if (tokens.length === 0) return;
  await User.updateMany(
    { "fcmTokens.token": { $in: tokens } },
    { $pull: { fcmTokens: { token: { $in: tokens } } } }
  );
};

export interface DeliverPushInput {
  recipientUserId: string;
  title: string;
  message: string;
  type: NotificationType | string;
  notificationId?: string;
  metadata?: Record<string, string>;
}

/**
 * Send a system (status-bar) push to all registered devices of one user.
 * No-op when FCM is not configured or the user has no tokens.
 * Never throws to callers — push failure must not break in-app notifications.
 */
export const deliverPushToUser = async (input: DeliverPushInput): Promise<void> => {
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return;

    const user = await User.findById(input.recipientUserId)
      .select("fcmTokens isActive")
      .lean();
    if (!user || user.isActive === false) return;

    const tokens = (user.fcmTokens ?? [])
      .map((entry) => entry.token)
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    if (tokens.length === 0) return;

    const data: Record<string, string> = {
      type: String(input.type || "GENERAL"),
      path: "/notifications"
    };
    if (input.notificationId) data.notificationId = input.notificationId;
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        if (typeof value === "string" && value.length > 0 && value.length <= 200) {
          // Avoid overwriting reserved keys
          if (key === "type" || key === "path" || key === "notificationId") continue;
          data[key] = value;
        }
      }
      if (typeof input.metadata.path === "string" && input.metadata.path.startsWith("/")) {
        data.path = input.metadata.path;
      }
    }

    const title = input.title.slice(0, 120);
    const body = input.message.slice(0, 240);

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body
      },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "lms_default",
          sound: "default",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true
        }
      }
    });

    const stale: string[] = [];
    response.responses.forEach(
      (result: { success: boolean; error?: { code?: string } }, index: number) => {
        if (result.success) return;
        const code = result.error?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) {
          const bad = tokens[index];
          if (bad) stale.push(bad);
        }
      }
    );
    if (stale.length > 0) {
      await removeInvalidTokens(stale);
    }
  } catch (error) {
    console.error(
      "[FCM] deliverPushToUser failed:",
      error instanceof Error ? error.message : error
    );
  }
};
