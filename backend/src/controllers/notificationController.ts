import type { Request, Response } from "express";
import { sendNotificationSchema } from "@nepal-school-erp/shared";
import { Notification } from "../models/Notification.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (req.user?.role !== "SUPER_ADMIN" && req.user?.role !== "SCHOOL_ADMIN") {
    Object.assign(filter, { recipientUserId: req.user?.userId });
  }

  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(100);
  return sendSuccess(res, "Notifications fetched", notifications);
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, recipientUserId: req.user?.userId }),
    { read: true },
    { new: true }
  );
  if (!notification) throw new ApiError(404, "Notification not found");
  return sendSuccess(res, "Notification marked as read", notification);
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany(
    withTenantScope(req, { recipientUserId: req.user?.userId, read: false }),
    { read: true }
  );
  return sendSuccess(res, "All notifications marked as read");
});

export const sendManualNotification = asyncHandler(async (req: Request, res: Response) => {
  const payload = sendNotificationSchema.parse(req.body);
  if (!payload.recipientUserId) {
    throw new ApiError(400, "recipientUserId is required");
  }

  const notification = await sendNotification({
    schoolId: req.tenantSchoolId!,
    recipientUserId: payload.recipientUserId,
    title: payload.title,
    message: payload.message,
    channel: payload.channel,
    type: payload.type
  });

  return sendSuccess(res, "Notification sent", notification, 201);
});