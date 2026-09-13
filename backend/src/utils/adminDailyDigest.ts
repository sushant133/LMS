import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { getDayOfWeekFromBs, getNepalHour } from "./nepaliDate.js";
import { notifySchoolAdmins } from "./notificationService.js";

/**
 * End-of-day roll-up for administrators.
 *
 * Most notifications in the system are addressed to the person who has to act:
 * a parent hears about their child's absence, a teacher about their overdue
 * lesson plan, a borrower about an overdue book. An administrator needs to see
 * that the school as a whole is on track, but copying them on every one of
 * those messages would mean thousands of notifications a day and guarantee
 * that none of them get read.
 *
 * So the same ground is covered once, as counts, in a single evening message —
 * and only for the sections that actually have something in them. A school
 * with nothing outstanding gets no notification at all.
 */

const DIGEST_WINDOW_START_HOUR = 16;
const DIGEST_WINDOW_END_HOUR = 22;

interface DigestSection {
  label: string;
  detail: string;
}

export const buildAdminDailyDigest = async (
  schoolId: string,
  todayBs: string
): Promise<{ title: string; message: string; sections: number } | null> => {
  const dayOfWeek = getDayOfWeekFromBs(todayBs);

  const [sheets, pendingLeave, overdueBooks, overduePlans, teachersWithSlots, teachersWithLog] =
    await Promise.all([
      DailyAttendance.find({ schoolId, dateBs: todayBs }).select("entries").lean(),
      LeaveRequest.countDocuments({ schoolId, status: "PENDING" }),
      LibraryIssue.countDocuments({ schoolId, status: "OVERDUE" }),
      AcademicLessonPlanItem.countDocuments({ schoolId, completionStatus: "DELAYED" }),
      TimetableSlot.distinct("teacherId", { schoolId, dayOfWeek, teacherId: { $ne: null } }),
      AcademicLogBookEntry.distinct("teacherId", { schoolId, dateBs: todayBs, isDeleted: false })
    ]);

  const sections: DigestSection[] = [];

  // Student attendance taken today.
  let absent = 0;
  let onLeave = 0;
  let marked = 0;
  for (const sheet of sheets) {
    for (const entry of sheet.entries ?? []) {
      marked += 1;
      if (entry.status === "ABSENT") absent += 1;
      else if (entry.status === "LEAVE" || entry.status === "MEDICAL_LEAVE") onLeave += 1;
    }
  }
  if (marked > 0 && (absent > 0 || onLeave > 0)) {
    const leavePart = onLeave > 0 ? `, ${onLeave} on leave` : "";
    sections.push({
      label: "Attendance",
      detail: `${absent} student(s) absent${leavePart} out of ${marked} marked today.`
    });
  }

  // Teachers who had class today but filed no log book.
  const loggedSet = new Set(teachersWithLog.map((id) => String(id)));
  const missingLog = teachersWithSlots
    .map((id) => String(id ?? ""))
    .filter((id) => id && !loggedSet.has(id)).length;
  if (missingLog > 0) {
    sections.push({
      label: "Log book",
      detail: `${missingLog} teacher(s) taught today but have not submitted the log book.`
    });
  }

  if (overduePlans > 0) {
    sections.push({
      label: "Lesson plans",
      detail: `${overduePlans} lesson plan topic(s) are past their deadline.`
    });
  }

  if (pendingLeave > 0) {
    sections.push({
      label: "Leave requests",
      detail: `${pendingLeave} leave request(s) waiting for your approval.`
    });
  }

  if (overdueBooks > 0) {
    sections.push({
      label: "Library",
      detail: `${overdueBooks} book(s) are overdue and not yet returned.`
    });
  }

  if (sections.length === 0) return null;

  const message = [
    `Summary for ${todayBs} BS.`,
    ...sections.map((section) => `${section.label}: ${section.detail}`)
  ].join(" ");

  return { title: "Daily summary", message, sections: sections.length };
};

/** Evening delivery. Silent on a day with nothing outstanding. */
export const notifyAdminDailyDigest = async (
  schoolId: string,
  todayBs: string
): Promise<void> => {
  const hour = getNepalHour();
  if (hour < DIGEST_WINDOW_START_HOUR || hour >= DIGEST_WINDOW_END_HOUR) return;

  const digest = await buildAdminDailyDigest(schoolId, todayBs);
  if (!digest) return;

  await notifySchoolAdmins(schoolId, {
    title: digest.title,
    message: digest.message,
    type: "GENERAL",
    metadata: { dateBs: todayBs },
    // One per day; the content hash means an unchanged summary is not resent.
    dedupeKey: `admin-daily:${schoolId}:${todayBs}`
  });
};
