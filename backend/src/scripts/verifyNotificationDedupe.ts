/**
 * Integration check for the recurring-notification dedupe.
 *
 * Reproduces the reported bug against a scratch database:
 *   "Pending academic reviews" arrived again and again for an unchanged
 *   backlog, and came back after the admin cleared it.
 *
 * Run: npx tsx src/scripts/verifyNotificationDedupe.ts
 */
import mongoose from "mongoose";
import { Notification } from "../models/Notification.js";
import { NotificationDedupe } from "../models/NotificationDedupe.js";
import { User } from "../models/User.js";
import { sendNotification } from "../utils/notificationService.js";

const URI = "mongodb://127.0.0.1:27017/phit_dedupe_check";

const DIGEST_TITLE = "Pending academic reviews";
const digest = (count: number) =>
  `${count} academic items are waiting for administrator review: 1) Lesson plan — Botany (2083-04-03) by Sunil Sah.`;

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} (got ${actual}, want ${expected})`);
};

const inboxCount = (userId: string) =>
  Notification.countDocuments({ recipientUserId: userId, title: DIGEST_TITLE });

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db?.dropDatabase();

  const schoolId = new mongoose.Types.ObjectId();
  const admin = await User.create({
    schoolId,
    fullName: "Dinesh Singh",
    email: `admin-${Date.now()}@test.local`,
    password: "x".repeat(20),
    role: "COLLEGE_ADMIN",
    isActive: true
  });
  const adminId = admin._id.toString();
  const dedupeKey = `admin-pending:${schoolId.toString()}`;

  const runJob = (count = 217) =>
    sendNotification({
      schoolId: schoolId.toString(),
      recipientUserId: adminId,
      title: DIGEST_TITLE,
      message: digest(count),
      type: "ACADEMIC_MANAGEMENT",
      dedupeKey
    });

  // 1. First run delivers exactly one.
  await runJob();
  check("first run delivers 1", await inboxCount(adminId), 1);

  // 2. The 6-hourly job re-running with an unchanged backlog must stay silent.
  await runJob();
  await runJob();
  await runJob();
  check("3 further runs, unchanged backlog", await inboxCount(adminId), 1);

  // 3. A new BS day must NOT resurrect it (the old key embedded todayBs).
  //    Nothing about the call changes, so this is the same assertion the old
  //    code failed: it keyed on the date rather than the backlog.
  await runJob();
  check("next day, unchanged backlog", await inboxCount(adminId), 1);

  // 4. Server restart: the old in-memory Set was lost here and the scheduler
  //    fires run() immediately on boot. The durable record must survive.
  await mongoose.disconnect();
  await mongoose.connect(URI);
  await runJob();
  check("after restart, unchanged backlog", await inboxCount(adminId), 1);

  // 5. THE REPORTED BUG: admin clears the inbox, job runs again.
  await Notification.deleteMany({ recipientUserId: adminId });
  check("inbox empty after clearing", await inboxCount(adminId), 0);
  await runJob();
  await runJob();
  check("cleared inbox stays clear", await inboxCount(adminId), 0);

  // 6. The backlog genuinely changes -> the admin SHOULD hear about it once.
  await runJob(218);
  check("backlog changed 217->218 notifies", await inboxCount(adminId), 1);
  await runJob(218);
  check("then goes quiet again", await inboxCount(adminId), 1);

  // 7. Dedupe state is one row per stream, not one per run.
  check("dedupe rows", await NotificationDedupe.countDocuments({ dedupeKey }), 1);

  // 8. Library overdue reminders are re-evaluated on every GET /library/issues.
  //    Clearing one must not make the next page load re-send it.
  const issueId = new mongoose.Types.ObjectId().toString();
  const libTitle = "Library book overdue";
  const libKey = `library:OVERDUE:${issueId}`;
  const libraryReminder = () =>
    sendNotification({
      schoolId: schoolId.toString(),
      recipientUserId: adminId,
      title: libTitle,
      message: `"Botany Practical" is overdue (was due 2083-04-03).`,
      type: "LIBRARY",
      channel: "IN_APP",
      dedupeKey: libKey,
      metadata: { libraryIssueId: issueId, reminderType: "OVERDUE" }
    });

  const libInbox = () =>
    Notification.countDocuments({ recipientUserId: adminId, title: libTitle });

  await libraryReminder();
  check("library: first send", await libInbox(), 1);
  for (let i = 0; i < 5; i += 1) await libraryReminder(); // 5 more page loads
  check("library: 5 more page loads", await libInbox(), 1);

  await Notification.deleteMany({ recipientUserId: adminId, title: libTitle });
  await libraryReminder();
  await libraryReminder();
  check("library: cleared, then 2 page loads", await libInbox(), 0);

  // 9. The universal guarantee: a caller that passes NO dedupeKey (most of the
  //    app) must still not re-notify after the user clears it.
  const plainTitle = "Field attendance recorded";
  const plainSend = () =>
    sendNotification({
      schoolId: schoolId.toString(),
      recipientUserId: adminId,
      title: plainTitle,
      message: "Ram Sharma: ABSENT on 2083-05-27 at Bir Hospital.",
      type: "ATTENDANCE"
    });
  const plainInbox = () =>
    Notification.countDocuments({ recipientUserId: adminId, title: plainTitle });

  await plainSend();
  await plainSend();
  await plainSend();
  check("no-key caller: 3 saves -> 1", await plainInbox(), 1);

  await Notification.deleteMany({ recipientUserId: adminId, title: plainTitle });
  await plainSend();
  check("no-key caller: cleared stays clear", await plainInbox(), 0);

  // 10. A DIFFERENT student on the same day is a different notification.
  await sendNotification({
    schoolId: schoolId.toString(),
    recipientUserId: adminId,
    title: plainTitle,
    message: "Sita Gurung: ABSENT on 2083-05-27 at Bir Hospital.",
    type: "ATTENDANCE"
  });
  check("different subject still delivered", await plainInbox(), 1);

  // 11. dedupeHours: 0 is the deliberate-resend escape hatch (admin button).
  await Notification.deleteMany({ recipientUserId: adminId });
  const forced = () =>
    sendNotification({
      schoolId: schoolId.toString(),
      recipientUserId: adminId,
      title: "Fee payment reminder",
      message: "An outstanding balance of NPR 12,000 is due.",
      type: "FEE",
      dedupeHours: 0
    });
  await forced();
  await forced();
  check(
    "explicit resend (dedupeHours 0) not blocked",
    await Notification.countDocuments({ recipientUserId: adminId, title: "Fee payment reminder" }),
    2
  );

  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
