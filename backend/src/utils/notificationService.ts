import { Notification } from "../models/Notification";
import { User } from "../models/User";
import type { NotificationChannel, NotificationType } from "@nepal-school-erp/shared";
import { tenantObjectId } from "./tenant";
import type { Request } from "express";

interface SendNotificationInput {
  schoolId: string;
  recipientUserId: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  type?: NotificationType;
  metadata?: Record<string, string>;
}

const sendSmsStub = async (phone: string, message: string): Promise<"SENT" | "FAILED" | "SKIPPED"> => {
  if (!phone) {
    return "SKIPPED";
  }

  // Stub: log SMS for development. Wire to Sparrow SMS / Twilio in production.
  console.log(`[SMS] To: ${phone} | ${message}`);
  return "SENT";
};

export const sendNotification = async (input: SendNotificationInput) => {
  const user = await User.findById(input.recipientUserId).select("phone");
  const channel = input.channel ?? "IN_APP";
  let smsStatus: "PENDING" | "SENT" | "FAILED" | "SKIPPED" = "SKIPPED";

  if (channel === "SMS" || channel === "BOTH") {
    smsStatus = await sendSmsStub(user?.phone ?? "", input.message);
  }

  return Notification.create({
    schoolId: input.schoolId,
    recipientUserId: input.recipientUserId,
    recipientPhone: user?.phone,
    title: input.title,
    message: input.message,
    channel,
    type: input.type ?? "GENERAL",
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
  const { ParentChildLink } = await import("../models/ParentChildLink");
  const links = await ParentChildLink.find({ schoolId, studentId }).lean();

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