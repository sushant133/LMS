import type { Request, Response } from "express";
import { sendNotificationSchema } from "@phit-erp/shared";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildPersonalNotificationFilter,
  sendNotification,
  serializeNotification
} from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";

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

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!id) throw new ApiError(400, "Notification id is required");

  const notification = await Notification.findOneAndUpdate(
    buildPersonalNotificationFilter(req, { _id: id }),
    { read: true },
    { new: true }
  ).lean();

  if (!notification) throw new ApiError(404, "Notification not found");
  return sendSuccess(
    res,
    "Notification marked as read",
    serializeNotification(notification as Parameters<typeof serializeNotification>[0])
  );
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const result = await Notification.updateMany(
    buildPersonalNotificationFilter(req, { read: false }),
    { read: true }
  );
  return sendSuccess(res, "All notifications marked as read", {
    modifiedCount: result.modifiedCount ?? 0
  });
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
