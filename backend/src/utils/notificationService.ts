import { createHash } from "node:crypto";
import type { Request } from "express";
import type { NotificationChannel, NotificationType } from "@phit-erp/shared";
import { Notification } from "../models/Notification.js";
import { NotificationDedupe } from "../models/NotificationDedupe.js";
import { User } from "../models/User.js";
import { deliverPushToUser } from "./fcmPushService.js";
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
  /**
   * Stable identity of a recurring notification stream (e.g. "admin-pending:<schoolId>").
   *
   * Recurring jobs MUST pass this. Unlike `dedupeHours`, it is checked against a
   * separate collection that clearing a notification does not touch and that
   * survives restarts, so a digest is not re-delivered just because the user
   * dismissed it or the server rebooted.
   */
  dedupeKey?: string;
  /**
   * Re-send the same content after this many hours. Omit for "only when the
   * content actually changes" — the right default for backlog digests, which
   * otherwise nag every single run with an identical list.
   */
  renotifyAfterHours?: number;
}

/**
 * Identity of "what this notification says". Metadata is folded in so two
 * notices that read alike but point at different records (two book loans, two
 * students) are still treated as distinct.
 */
const hashContent = (
  title: string,
  message: string,
  type: string,
  metadata?: Record<string, string>
): string => {
  const meta = metadata
    ? Object.keys(metadata)
        .sort()
        .map((key) => `${key}=${metadata[key]}`)
        .join("&")
    : "";
  return createHash("sha1").update([type, title, message, meta].join("")).digest("hex");
};

/** Named streams are remembered for a year; auto keys only past their window. */
const dedupeExpiry = (renotifyAfterHours: number): Date => {
  const hours = renotifyAfterHours > 0 ? Math.max(renotifyAfterHours * 2, 24) : 24 * 365;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
};

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

  const contentHash = hashContent(input.title, input.message, type, input.metadata);

  /*
   * Dedupe identity.
   *
   * An explicit dedupeKey names a recurring stream and, by default, repeats
   * only when its content changes. Without one we derive a key from the
   * message itself so that EVERY caller still gets a durable guard: re-saving
   * a sheet, reloading a page that re-evaluates reminders, or restarting the
   * server will not produce a second copy within `dedupeHours`.
   *
   * Pass dedupeHours: 0 to force a send (e.g. an admin pressing "send reminder"
   * on purpose).
   */
  const explicitKey = input.dedupeKey?.trim();
  const dedupeKey = explicitKey || (dedupeHours > 0 ? `auto:${type}:${contentHash}` : "");
  const renotifyAfterHours = input.renotifyAfterHours ?? (explicitKey ? 0 : dedupeHours);

  if (dedupeKey) {
    /*
     * Deliberately NOT a query against the Notification rows: clearing a
     * notification DELETES its row, so consulting them made dismissing a
     * notification the very thing that re-armed it. This collection is
     * untouched by clearing and survives restarts.
     */
    const seen = await NotificationDedupe.findOne({
      recipientUserId: recipientId,
      dedupeKey
    })
      .select("contentHash lastSentAt")
      .lean();

    if (seen && seen.contentHash === contentHash) {
      if (renotifyAfterHours <= 0) return null;
      const nextAllowedAt =
        new Date(seen.lastSentAt).getTime() + renotifyAfterHours * 60 * 60 * 1000;
      if (Date.now() < nextAllowedAt) return null;
    }
  }

  let smsStatus: "PENDING" | "SENT" | "FAILED" | "SKIPPED" = "SKIPPED";
  if (channel === "SMS" || channel === "BOTH") {
    smsStatus = await sendSmsStub(user.phone ?? "", input.message);
  }

  const created = await Notification.create({
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

  if (dedupeKey) {
    await NotificationDedupe.updateOne(
      { recipientUserId: recipientId, dedupeKey },
      {
        $set: {
          schoolId: input.schoolId,
          contentHash,
          lastSentAt: new Date(),
          expiresAt: dedupeExpiry(renotifyAfterHours)
        }
      },
      { upsert: true }
    );
  }

  // Mobile system tray push (FCM). Fire-and-forget so in-app delivery is never blocked.
  // Personal: only this recipientUserId's registered devices receive the banner.
  void deliverPushToUser({
    recipientUserId: recipientId,
    title: input.title,
    message: input.message,
    type,
    notificationId: created._id.toString(),
    metadata: input.metadata,
    /*
     * Only named recurring streams collapse. FCM keeps at most 4 distinct
     * collapse keys per device and drops the rest unpredictably while a device
     * is offline — and the auto key is unique per message, so using it here
     * would spend that budget on one-off notifications and risk losing them.
     * One-offs are meant to stack in the tray anyway.
     */
    collapseKey: explicitKey || undefined
  });

  return created;
};

export const notifyParentsOfStudent = async (
  schoolId: string,
  studentId: string,
  title: string,
  message: string,
  type: NotificationType,
  channel: NotificationChannel = "BOTH",
  /**
   * `key` names a recurring stream (see SendNotificationInput.dedupeKey).
   * `hours: 0` forces delivery — use it for deliberate admin actions such as
   * publishing results, which may legitimately repeat identical text.
   */
  dedupe?: { key?: string; hours?: number }
) => {
  const { ParentChildLink } = await import("../models/ParentChildLink.js");
  const { approvedParentLinkFilter } = await import("./parentScope.js");
  const links = await ParentChildLink.find(
    approvedParentLinkFilter({
      schoolId,
      studentId
    })
  ).lean();

  if (links.length === 0) return;

  await Promise.all(
    links.map((link) =>
      sendNotification({
        schoolId,
        recipientUserId: link.parentUserId.toString(),
        title,
        message,
        type,
        channel,
        metadata: { studentId },
        dedupeKey: dedupe?.key,
        // Avoid flooding parents when the same day is re-saved
        dedupeHours: dedupe?.hours ?? (type === "ATTENDANCE" ? 12 : undefined)
      })
    )
  );
};

/**
 * Fan a notification out to every administrator of a school.
 *
 * Anything an admin must act on (an approval queue, an exception, a request)
 * should go through here so no admin-facing event depends on someone
 * remembering to look at a list page.
 */
export const notifySchoolAdmins = async (
  schoolId: string,
  input: {
    title: string;
    message: string;
    type?: NotificationType;
    channel?: NotificationChannel;
    metadata?: Record<string, string>;
    dedupeKey?: string;
    dedupeHours?: number;
    renotifyAfterHours?: number;
  }
): Promise<void> => {
  const admins = await User.find({
    schoolId,
    role: { $in: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
    isActive: { $ne: false }
  })
    .select("_id")
    .lean();

  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId,
        recipientUserId: admin._id.toString(),
        ...input
      })
    )
  );
};

/** Resolve student display name for parent-facing attendance messages. */
export const getStudentDisplayName = async (studentId: string): Promise<string> => {
  try {
    const { Student } = await import("../models/Student.js");
    const student = await Student.findById(studentId).populate("user", "fullName").lean();
    const name = (student?.user as { fullName?: string } | null | undefined)?.fullName?.trim();
    return name || "Your child";
  } catch {
    return "Your child";
  }
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
    return { ...extra, recipientUserId: { $in: [] } };
  }
  const schoolId = req.tenantSchoolId ? req.tenantSchoolId : tenantObjectId(req);
  return {
    schoolId,
    recipientUserId: req.user.userId,
    ...extra
  };
};
