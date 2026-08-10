import type { Request, Response } from "express";
import { sendNotificationSchema } from "@phit-erp/shared";
import { z } from "zod";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  registerFcmToken,
  sanitizeFcmPlatform,
  sanitizeFcmToken,
  unregisterFcmToken
} from "../utils/fcmPushService.js";
import {
  buildPersonalNotificationFilter,
  sendNotification,
  serializeNotification
} from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";

const deviceTokenBodySchema = z.object({
  token: z.string().min(32).max(4096),
  platform: z.enum(["android", "ios", "web"]).optional()
});

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === "true" || req.query.unread === "1";
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  const filter = buildPersonalNotificationFilter(req, {
    ...(unreadOnly ? { read: false } : {}),
    ...(type ? { type } : {})
  });

  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return sendSuccess(
    res,
    "Notifications fetched",
    notifications.map((n) => serializeNotification(n as Parameters<typeof serializeNotification>[0]))
  );
});

export const getUnreadNotificationCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await Notification.countDocuments(buildPersonalNotificationFilter(req, { read: false }));
  return sendSuccess(res, "Unread notification count fetched", { count });
});

/**
 * Mark one notification as read and remove it from the inbox.
 * Read notifications are cleared immediately (not kept as a "read" history list).
 */
export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!id) throw new ApiError(400, "Notification id is required");

  const notification = await Notification.findOneAndDelete(
    buildPersonalNotificationFilter(req, { _id: id })
  ).lean();

  if (!notification) throw new ApiError(404, "Notification not found");
  return sendSuccess(res, "Notification cleared", {
    ...serializeNotification(notification as Parameters<typeof serializeNotification>[0]),
    read: true,
    cleared: true
  });
});

/**
 * Clear the entire personal inbox (all notifications for this user).
 */
export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const result = await Notification.deleteMany(buildPersonalNotificationFilter(req, {}));
  return sendSuccess(res, "All notifications cleared", {
    deletedCount: result.deletedCount ?? 0,
    modifiedCount: result.deletedCount ?? 0
  });
});

/**
 * Register this device's FCM token for the authenticated user only.
 * Client-supplied userId is ignored — identity comes from the session cookie.
 */
export const registerDeviceToken = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const payload = deviceTokenBodySchema.parse(req.body);
  const token = sanitizeFcmToken(payload.token);
  if (!token) {
    throw new ApiError(400, "Invalid device token");
  }

  const platform = sanitizeFcmPlatform(payload.platform);
  await registerFcmToken(req.user.userId, token, platform);
  return sendSuccess(res, "Device token registered", { registered: true, platform });
});

/**
 * Remove this device's FCM token from the authenticated user (call on logout).
 */
export const unregisterDeviceToken = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const payload = deviceTokenBodySchema.parse(req.body);
  const token = sanitizeFcmToken(payload.token);
  if (!token) {
    throw new ApiError(400, "Invalid device token");
  }

  await unregisterFcmToken(req.user.userId, token);
  return sendSuccess(res, "Device token removed", { registered: false });
});

export const sendManualNotification = asyncHandler(async (req: Request, res: Response) => {
  const payload = sendNotificationSchema.parse(req.body);
  if (!payload.recipientUserId) {
    throw new ApiError(400, "recipientUserId is required");
  }

  const recipient = await User.findById(payload.recipientUserId).select("schoolId isActive").lean();
  if (!recipient || recipient.isActive === false) {
    throw new ApiError(404, "Recipient user not found");
  }

  const schoolId = req.tenantSchoolId!;
  if (recipient.schoolId && recipient.schoolId.toString() !== schoolId) {
    throw new ApiError(403, "Recipient is outside your institution");
  }

  const notification = await sendNotification({
    schoolId,
    recipientUserId: payload.recipientUserId,
    title: payload.title,
    message: payload.message,
    channel: payload.channel,
    type: payload.type,
    dedupeHours: 0
  });

  if (!notification) {
    throw new ApiError(400, "Could not deliver notification to recipient");
  }

  const plain =
    notification &&
    typeof notification === "object" &&
    "toObject" in notification &&
    typeof (notification as { toObject: () => unknown }).toObject === "function"
      ? (notification as { toObject: () => Record<string, unknown> }).toObject()
      : (notification as Record<string, unknown>);

  return sendSuccess(
    res,
    "Notification sent",
    serializeNotification(plain as Parameters<typeof serializeNotification>[0]),
    201
  );
});
