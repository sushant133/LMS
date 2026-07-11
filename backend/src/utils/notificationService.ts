import type { Request } from "express";
import type { NotificationChannel, NotificationType } from "@phit-erp/shared";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { tenantObjectId } from "./tenant.js";

interface SendNotificationInput {
  schoolId: string;
  recipientUserId: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  type?: NotificationType;
  metadata?: Record<string, string>;
  /** When set, skip creating a second identical unread notification within this many hours. */
  dedupeHours?: number;
}

const sendSmsStub = async (phone: string, message: string): Promise<"SENT" | "FAILED" | "SKIPPED"> => {
  if (!phone) {
    return "SKIPPED";
  }

  // Stub: log SMS for development. Wire to Sparrow SMS / Twilio in production.
  console.log(`[SMS] To: ${phone} | ${message}`);
  return "SENT";
};

export const serializeNotification = (doc: {
  _id: { toString(): string };
  schoolId: { toString(): string };
  recipientUserId: { toString(): string };
  recipientPhone?: string | null;
  title: string;
  message: string;
  channel: string;
  type: string;
  read: boolean;
  smsStatus: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}) => ({
  _id: doc._id.toString(),
  schoolId: doc.schoolId.toString(),
  recipientUserId: doc.recipientUserId.toString(),
  recipientPhone: doc.recipientPhone ?? undefined,
  title: doc.title,
  message: doc.message,
  channel: doc.channel,
  type: doc.type,
  read: Boolean(doc.read),
  smsStatus: doc.smsStatus,
  metadata: (doc.metadata as Record<string, string> | undefined) ?? undefined,
  createdAt: doc.createdAt?.toISOString(),
  updatedAt: doc.updatedAt?.toISOString()
});

export const sendNotification = async (input: SendNotificationInput) => {
  const recipientId = String(input.recipientUserId || "").trim();
  if (!recipientId) {
    return null;
  }

  const user = await User.findById(recipientId).select("phone schoolId isActive").lean();
  if (!user || user.isActive === false) {
    return null;
  }

  // Recipient must belong to the same school (skip for super-admin schoolId null edge cases on recipient)
  if (user.schoolId && user.schoolId.toString() !== String(input.schoolId)) {
    return null;
  }

  const channel = input.channel ?? "IN_APP";
  const type = input.type ?? "GENERAL";
  const dedupeHours = input.dedupeHours ?? 12;

  if (dedupeHours > 0) {
    const since = new Date(Date.now() - dedupeHours * 60 * 60 * 1000);
    const existing = await Notification.findOne({
      schoolId: input.schoolId,
      recipientUserId: recipientId,
      title: input.title,
      message: input.message,
      type,
      read: false,
      createdAt: { $gte: since }
    })
      .select("_id")
      .lean();
    if (existing) {
      return existing;
    }
  }

  let smsStatus: "PENDING" | "SENT" | "FAILED" | "SKIPPED" = "SKIPPED";
  if (channel === "SMS" || channel === "BOTH") {
    smsStatus = await sendSmsStub(user.phone ?? "", input.message);
  }

  return Notification.create({
    schoolId: input.schoolId,
    recipientUserId: recipientId,
    recipientPhone: user.phone,
    title: input.title,
    message: input.message,
    channel,
    type,
    smsStatus,
    metadata: input.metadata
  });
};

export const notifyParentsOfStudent = async (
  schoolId: string,
  studentId: string,
  title: string,
  message: string,
  type: NotificationType,
  channel: NotificationChannel = "BOTH"
) => {
  const { ParentChildLink } = await import("../models/ParentChildLink.js");
  const links = await ParentChildLink.find({
    schoolId,
    studentId,
    status: "APPROVED"
  }).lean();

  await Promise.all(
    links.map((link) =>
      sendNotification({
        schoolId,
        recipientUserId: link.parentUserId.toString(),
        title,
        message,
        type,
        channel,
        metadata: { studentId }
      })
    )
  );
};

export const getSchoolIdFromRequest = (req: Request): string => {
  if (req.tenantSchoolId) {
    return req.tenantSchoolId;
  }
  return tenantObjectId(req).toString();
};

/**
 * Inbox is always personal: every user only sees notifications addressed to them.
 * Institution admins previously saw school-wide noise; that broke badge/count sync.
 */
export const buildPersonalNotificationFilter = (
  req: Request,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (!req.user?.userId) {
    return { ...extra, recipientUserId: "__none__" };
  }
  const schoolId = req.tenantSchoolId ? req.tenantSchoolId : tenantObjectId(req);
  return {
    schoolId,
    recipientUserId: req.user.userId,
    ...extra
  };
};
