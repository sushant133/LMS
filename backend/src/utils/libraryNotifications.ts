import type { HydratedDocument } from "mongoose";
import type { LibraryIssueStatus } from "@phit-erp/shared";
import { LibraryIssue, type LibraryIssueDocument } from "../models/LibraryBook.js";

type LibraryIssueEntity = HydratedDocument<LibraryIssueDocument>;
import { CollegeStaff } from "../models/CollegeStaff.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { compareBsDates, getOffsetBsDate, getTodayBs } from "./nepaliDate.js";
import { notifyParentsOfStudent, sendNotification } from "./notificationService.js";

type ReminderType = "BEFORE_DUE" | "DUE_TODAY" | "OVERDUE";

const reminderTitles: Record<ReminderType, string> = {
  BEFORE_DUE: "Library book due soon",
  DUE_TODAY: "Library book due today",
  OVERDUE: "Library book overdue"
};

const getReminderMessage = (bookTitle: string, dueDateBs: string, type: ReminderType): string => {
  switch (type) {
    case "BEFORE_DUE":
      return `"${bookTitle}" is due on ${dueDateBs}. Please return it on time.`;
    case "DUE_TODAY":
      return `"${bookTitle}" is due today (${dueDateBs}). Please return it to the library.`;
    case "OVERDUE":
      return `"${bookTitle}" is overdue (was due ${dueDateBs}). Please return it immediately.`;
  }
};

/**
 * Stable identity for "we already sent this reminder for this loan".
 *
 * This used to be answered by looking for a matching row in the Notification
 * collection — but clearing a notification DELETES that row, and these
 * reminders are re-evaluated on every GET /library/issues. So a borrower who
 * dismissed an overdue reminder got it again on the next page load, forever.
 */
const reminderDedupeKey = (issueId: string, reminderType: ReminderType): string =>
  `library:${reminderType}:${issueId}`;

const sendLibraryReminder = async (
  schoolId: string,
  recipientUserId: string,
  issueId: string,
  bookTitle: string,
  dueDateBs: string,
  reminderType: ReminderType
): Promise<void> => {
  await sendNotification({
    schoolId,
    recipientUserId,
    title: reminderTitles[reminderType],
    message: getReminderMessage(bookTitle, dueDateBs, reminderType),
    type: "LIBRARY",
    channel: "BOTH",
    dedupeKey: reminderDedupeKey(issueId, reminderType),
    metadata: {
      libraryIssueId: issueId,
      reminderType
    }
  });
};

const getBorrowerUserId = async (issue: LibraryIssueEntity): Promise<string | null> => {
  const borrowerType = issue.borrowerType ?? "STUDENT";

  if (borrowerType === "TEACHER" && issue.teacherId) {
    const teacher = await Teacher.findById(issue.teacherId).select("user").lean();
    return teacher?.user?.toString() ?? null;
  }

  if (borrowerType === "STAFF" && issue.staffId) {
    const staff = await CollegeStaff.findById(issue.staffId).select("user").lean();
    return staff?.user?.toString() ?? null;
  }

  if (issue.studentId) {
    const student = await Student.findById(issue.studentId).select("user").lean();
    return student?.user?.toString() ?? null;
  }

  return null;
};

export const processLibraryIssueReminders = async (
  schoolId: string,
  issue: LibraryIssueEntity,
  bookTitle: string,
  todayBs: string = getTodayBs()
): Promise<LibraryIssueStatus> => {
  if (issue.status === "RETURNED") {
    return issue.status;
  }

  let status: LibraryIssueStatus = issue.status;
  const dueComparison = compareBsDates(todayBs, issue.dueDateBs);
  const tomorrowBs = getOffsetBsDate(1);

  if (dueComparison > 0) {
    status = "OVERDUE";
  } else if (issue.status === "OVERDUE" && dueComparison <= 0) {
    status = "ISSUED";
  }

  if (status !== issue.status) {
    issue.status = status;
    await issue.save();
  }

  const borrowerUserId = await getBorrowerUserId(issue);
  if (!borrowerUserId) {
    return status;
  }

  if (issue.dueDateBs === tomorrowBs) {
    await sendLibraryReminder(schoolId, borrowerUserId, issue._id.toString(), bookTitle, issue.dueDateBs, "BEFORE_DUE");
    if (issue.studentId) {
      await notifyParentsOfStudent(
        schoolId,
        issue.studentId.toString(),
        reminderTitles.BEFORE_DUE,
        getReminderMessage(bookTitle, issue.dueDateBs, "BEFORE_DUE"),
        "LIBRARY",
        "BOTH",
        { key: reminderDedupeKey(issue._id.toString(), "BEFORE_DUE") + ":parent" }
      );
    }
  }

  if (dueComparison === 0) {
    await sendLibraryReminder(schoolId, borrowerUserId, issue._id.toString(), bookTitle, issue.dueDateBs, "DUE_TODAY");
    if (issue.studentId) {
      await notifyParentsOfStudent(
        schoolId,
        issue.studentId.toString(),
        reminderTitles.DUE_TODAY,
        getReminderMessage(bookTitle, issue.dueDateBs, "DUE_TODAY"),
        "LIBRARY",
        "BOTH",
        { key: reminderDedupeKey(issue._id.toString(), "DUE_TODAY") + ":parent" }
      );
    }
  }

  if (status === "OVERDUE") {
    await sendLibraryReminder(schoolId, borrowerUserId, issue._id.toString(), bookTitle, issue.dueDateBs, "OVERDUE");
    if (issue.studentId) {
      await notifyParentsOfStudent(
        schoolId,
        issue.studentId.toString(),
        reminderTitles.OVERDUE,
        getReminderMessage(bookTitle, issue.dueDateBs, "OVERDUE"),
        "LIBRARY",
        "BOTH",
        { key: reminderDedupeKey(issue._id.toString(), "OVERDUE") + ":parent" }
      );
    }
  }

  return status;
};

export const syncSchoolLibraryOverdueStatuses = async (schoolId: string): Promise<void> => {
  const todayBs = getTodayBs();
  const activeIssues = await LibraryIssue.find({
    schoolId,
    status: { $in: ["ISSUED", "OVERDUE"] }
  }).populate("bookId", "title");

  await Promise.all(
    activeIssues.map((issue) => {
      const book = issue.bookId as { title?: string } | null;
      return processLibraryIssueReminders(schoolId, issue, book?.title ?? "Book", todayBs);
    })
  );
};