import type { Types } from "mongoose";
import { Notice } from "../models/Notice.js";
import { NotificationDedupe } from "../models/NotificationDedupe.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { User } from "../models/User.js";
import { getTodayBs } from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";
import { approvedParentLinkFilter } from "./parentScope.js";

const MESSAGE_PREVIEW_LENGTH = 240;

interface DispatchableNotice {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  title: string;
  content: string;
  images?: Array<{ url: string; thumbnailUrl?: string | null }> | null;
  visibleTo: string[];
  classId?: Types.ObjectId | null;
  sectionId?: Types.ObjectId | null;
  subjectId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
}

/** Plain-text preview of the notice body, with a note when images are attached. */
const buildMessage = (notice: DispatchableNotice): string => {
  const text = notice.content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const preview =
    text.length > MESSAGE_PREVIEW_LENGTH ? `${text.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trimEnd()}…` : text;

  const imageCount = notice.images?.length ?? 0;
  const imageNote = imageCount > 0 ? `${imageCount} image${imageCount === 1 ? "" : "s"} attached` : "";

  if (preview && imageNote) return `${preview} (${imageNote})`;
  return preview || imageNote || "New notice published on the notice board.";
};

/**
 * Students a notice is addressed to — mirrors the notice board's own visibility:
 * a class (optionally one section) when the notice is scoped, the classes of its
 * subject when only a subject is set, otherwise every active student.
 */
const resolveStudentAudience = async (notice: DispatchableNotice) => {
  const filter: Record<string, unknown> = {
    schoolId: notice.schoolId,
    academicStatus: { $in: ["ACTIVE", null] }
  };

  if (notice.classId) {
    filter.classId = notice.classId;
    if (notice.sectionId) filter.sectionId = notice.sectionId;
  } else if (notice.subjectId) {
    const subject = await Subject.findById(notice.subjectId).select("classIds").lean();
    const classIds = (subject as { classIds?: Types.ObjectId[] } | null)?.classIds ?? [];
    if (classIds.length === 0) return { scoped: true, students: [] as Array<{ _id: Types.ObjectId; user: Types.ObjectId }> };
    filter.classId = { $in: classIds };
  } else {
    return { scoped: false, students: [] as Array<{ _id: Types.ObjectId; user: Types.ObjectId }> };
  }

  const students = await Student.find(filter).select("_id user").lean();
  return { scoped: true, students: students as Array<{ _id: Types.ObjectId; user: Types.ObjectId }> };
};

const resolveRecipientUserIds = async (notice: DispatchableNotice): Promise<string[]> => {
  const roles = new Set(notice.visibleTo);
  const recipients = new Set<string>();

  const needsStudentScope = roles.has("STUDENT") || roles.has("PARENT");
  const audience = needsStudentScope ? await resolveStudentAudience(notice) : null;

  // Roles addressed school-wide. Scoped notices only reach the matching students/parents.
  const schoolWideRoles = [...roles].filter(
    (role) => !(audience?.scoped && (role === "STUDENT" || role === "PARENT"))
  );

  if (schoolWideRoles.length > 0) {
    const users = await User.find({
      schoolId: notice.schoolId,
      role: { $in: schoolWideRoles },
      isActive: { $ne: false }
    })
      .select("_id")
      .lean();
    users.forEach((user) => recipients.add(user._id.toString()));
  }

  if (audience?.scoped) {
    if (roles.has("STUDENT")) {
      audience.students.forEach((student) => recipients.add(student.user.toString()));
    }
    if (roles.has("PARENT") && audience.students.length > 0) {
      const links = await ParentChildLink.find(
        approvedParentLinkFilter({
          schoolId: notice.schoolId,
          studentId: { $in: audience.students.map((student) => student._id) }
        })
      )
        .select("parentUserId")
        .lean();
      links.forEach((link) => recipients.add(link.parentUserId.toString()));
    }
  }

  // The author is included when their own role is in the audience, so the notice
  // shows up in their inbox like everyone else's.
  return [...recipients];
};

const noticeDedupeKey = (noticeId: Types.ObjectId | string) => `notice:${noticeId.toString()}`;

/** Send the notice notification to the given people (skipping any already notified). */
const deliverNoticeNotification = async (notice: DispatchableNotice, onlyNewRecipients: boolean) => {
  const dedupeKey = noticeDedupeKey(notice._id);
  let recipientIds = await resolveRecipientUserIds(notice);

  if (onlyNewRecipients && recipientIds.length > 0) {
    // Every delivery leaves a dedupe row, so it doubles as "already received".
    const alreadyNotified = await NotificationDedupe.find({
      dedupeKey,
      recipientUserId: { $in: recipientIds }
    })
      .select("recipientUserId")
      .lean();
    const seen = new Set(alreadyNotified.map((row) => row.recipientUserId.toString()));
    recipientIds = recipientIds.filter((id) => !seen.has(id));
  }

  if (recipientIds.length === 0) return;

  const schoolId = notice.schoolId.toString();
  const message = buildMessage(notice);
  const firstImage = notice.images?.[0];

  const metadata: Record<string, string> = {
    noticeId: notice._id.toString(),
    path: "/notices"
  };
  if (firstImage?.url) metadata.imageUrl = firstImage.url;
  if (firstImage?.thumbnailUrl) metadata.thumbnailUrl = firstImage.thumbnailUrl;

  // allSettled: one bad recipient must not stop the rest of the fan-out.
  const results = await Promise.allSettled(
    recipientIds.map((recipientUserId) =>
      sendNotification({
        schoolId,
        recipientUserId,
        title: notice.title,
        message,
        type: "NOTICE",
        metadata,
        // One delivery per notice per person — the atomic claim / filter above is the main guard.
        dedupeKey
      })
    )
  );
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `Notice notification: ${failed.length} of ${recipientIds.length} deliveries failed`,
      (failed[0] as PromiseRejectedResult).reason
    );
  }
};

/**
 * Send the audience notification for a notice if it is due (publish date reached,
 * not expired) and has not been sent yet. The PENDING → SENT claim is atomic, so
 * concurrent calls (create + scheduler) can never deliver it twice.
 *
 * The notification title is the notice title exactly as the author typed it.
 */
export const dispatchNoticeNotificationIfDue = async (noticeId: Types.ObjectId | string): Promise<boolean> => {
  const todayBs = getTodayBs();
  const claimed = await Notice.findOneAndUpdate(
    {
      _id: noticeId,
      notificationStatus: "PENDING",
      publishDateBs: { $lte: todayBs },
      $or: [{ expiresAtBs: { $exists: false } }, { expiresAtBs: null }, { expiresAtBs: "" }, { expiresAtBs: { $gte: todayBs } }]
    },
    { $set: { notificationStatus: "SENT", notifiedAt: new Date() } },
    { new: true }
  ).lean();

  if (!claimed) return false;

  await deliverNoticeNotification(claimed as unknown as DispatchableNotice, false);
  return true;
};

/**
 * After a notice is edited: deliver it if it is now due, or — when it was already
 * sent — notify only people newly added to its audience (e.g. an extra role, class
 * or section). Existing recipients are never re-notified for an edit.
 */
export const dispatchNoticeNotificationAfterEdit = async (noticeId: Types.ObjectId | string): Promise<void> => {
  if (await dispatchNoticeNotificationIfDue(noticeId)) return;

  const todayBs = getTodayBs();
  const notice = await Notice.findOne({
    _id: noticeId,
    notificationStatus: "SENT",
    publishDateBs: { $lte: todayBs },
    $or: [{ expiresAtBs: { $exists: false } }, { expiresAtBs: null }, { expiresAtBs: "" }, { expiresAtBs: { $gte: todayBs } }]
  }).lean();
  if (!notice) return;

  await deliverNoticeNotification(notice as unknown as DispatchableNotice, true);
};

/** Periodic sweep: deliver future-dated notices once their publish date arrives. */
export const runScheduledNoticeNotifications = async (): Promise<void> => {
  const todayBs = getTodayBs();
  const due = await Notice.find({ notificationStatus: "PENDING", publishDateBs: { $lte: todayBs } })
    .select("_id")
    .limit(500)
    .lean();

  for (const notice of due) {
    await dispatchNoticeNotificationIfDue(notice._id);
  }
};

export const startNoticeNotificationScheduler = (): void => {
  const intervalMs = 15 * 60 * 1000;
  const run = () => {
    void runScheduledNoticeNotifications().catch((error) => {
      console.error("Scheduled notice notification job failed:", error);
    });
  };
  run();
  setInterval(run, intervalMs);
};
