import { ACADEMIC_CALENDAR_EVENT_TYPE_LABELS, type AcademicCalendarEventType } from "@phit-erp/shared";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { Exam } from "../models/Exam.js";
import { User } from "../models/User.js";
import {
  compareBsDates,
  getDayNameFromBs,
  getDayOfWeekFromBs,
  getNepalHour,
  getOffsetFromBsDate
} from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";

interface CalendarEventNotice {
  _id: string;
  name: string;
  dateBs: string;
  startDateBs?: string;
  endDateBs?: string;
  eventType: AcademicCalendarEventType;
}

const calendarRoles = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "COLLEGE_STAFF",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
] as const;

const formatEventDates = (event: CalendarEventNotice): string => {
  const start = event.startDateBs || event.dateBs;
  const end = event.endDateBs || event.dateBs;
  if (start === end) return `${start} BS`;
  return `${start} → ${end} BS`;
};

const notifySchoolUsers = async (
  schoolId: string,
  title: string,
  message: string,
  metadata?: Record<string, string>,
  dedupeKey?: string
): Promise<void> => {
  const users = await User.find({ schoolId, role: { $in: calendarRoles } }).select("_id").lean();
  await Promise.all(
    users.map((user) =>
      sendNotification({
        schoolId,
        recipientUserId: user._id.toString(),
        title,
        message,
        type: "ACADEMIC_CALENDAR",
        metadata,
        dedupeKey
      })
    )
  );
};

export const notifyCalendarEventCreated = async (schoolId: string, event: CalendarEventNotice): Promise<void> => {
  const typeLabel = ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[event.eventType];
  await notifySchoolUsers(
    schoolId,
    "Academic calendar updated",
    `${event.name} (${typeLabel}) scheduled for ${formatEventDates(event)}.`,
    { eventId: event._id, dateBs: event.startDateBs || event.dateBs }
  );
};

export const notifyCalendarEventUpdated = async (schoolId: string, event: CalendarEventNotice): Promise<void> => {
  const typeLabel = ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[event.eventType];
  await notifySchoolUsers(
    schoolId,
    "Academic calendar event updated",
    `${event.name} (${typeLabel}) for ${formatEventDates(event)} has been updated.`,
    { eventId: event._id, dateBs: event.startDateBs || event.dateBs }
  );
};

export const notifyCalendarEventDeleted = async (
  schoolId: string,
  event: Pick<CalendarEventNotice, "name" | "dateBs">
): Promise<void> => {
  await notifySchoolUsers(
    schoolId,
    "Academic calendar event removed",
    `${event.name} on ${event.dateBs} has been removed from the calendar.`
  );
};

/* ------------------------------------------------------------------------ *
 * Day-ahead digest — "what is happening tomorrow"
 * ------------------------------------------------------------------------ */

/** Event types that mean "an examination", for the dedicated exam line. */
const EXAM_EVENT_TYPES = new Set<AcademicCalendarEventType>([
  "EXAMINATION_WEEK",
  "INTERNAL_EXAMINATION",
  "PRACTICAL_EXAMINATION",
  "FINAL_EXAMINATION",
  "VIVA"
]);

/**
 * Types that are administrative noise for a day-ahead notice — nobody needs a
 * push at 6pm because a "working day" row exists for tomorrow.
 */
const SILENT_EVENT_TYPES = new Set<AcademicCalendarEventType>(["WORKING_DAY", "OTHER"]);

/** Send only in the evening, so "tomorrow" means what the reader expects. */
const DIGEST_WINDOW_START_HOUR = 16;
const DIGEST_WINDOW_END_HOUR = 22;

const SATURDAY = 6;

interface DayAheadEvent {
  _id: { toString(): string };
  name: string;
  eventType: AcademicCalendarEventType;
  startDateBs: string;
  endDateBs: string;
  isHoliday: boolean;
  isWorkingDayOverride?: boolean | null;
}

const uniqueNames = (names: string[]): string[] => [...new Set(names.map((n) => n.trim()).filter(Boolean))];

/**
 * One organised "tomorrow" notice per person per day.
 *
 * Deliberately quiet:
 *  - nothing scheduled            -> no notification at all;
 *  - tomorrow is a routine Saturday -> no notification (the weekly day off is
 *    not news; a Saturday that has been converted into a working day IS);
 *  - multi-day events             -> announced the evening before they START,
 *    not re-announced on every one of their days.
 */
export const buildDayAheadDigest = async (
  schoolId: string,
  todayBs: string
): Promise<{ title: string; message: string; tomorrowBs: string } | null> => {
  const tomorrowBs = getOffsetFromBsDate(todayBs, 1);
  const tomorrowIsSaturday = getDayOfWeekFromBs(tomorrowBs) === SATURDAY;

  // Events covering tomorrow (a range may have started earlier).
  const events = (await AcademicCalendarEvent.find({
    schoolId,
    status: "ACTIVE",
    startDateBs: { $lte: tomorrowBs },
    endDateBs: { $gte: tomorrowBs }
  })
    .select("name eventType startDateBs endDateBs isHoliday isWorkingDayOverride")
    .lean()) as unknown as DayAheadEvent[];

  const relevant = events.filter((event) => !SILENT_EVENT_TYPES.has(event.eventType));

  const holidays = relevant.filter((event) => event.isHoliday && !event.isWorkingDayOverride);
  const workingSaturday = events.find((event) => event.isWorkingDayOverride);

  // Only announce things that BEGIN tomorrow — otherwise a 10-day vacation
  // would produce an identical notice every evening it is running.
  const startingTomorrow = relevant.filter((event) => event.startDateBs === tomorrowBs);
  const examEventsStarting = startingTomorrow.filter((event) => EXAM_EVENT_TYPES.has(event.eventType));
  const otherEventsStarting = startingTomorrow.filter(
    (event) => !EXAM_EVENT_TYPES.has(event.eventType) && !event.isHoliday
  );

  // Real exams from the exam schedule (DRAFT is not announced to anyone).
  const examsStarting = await Exam.find({
    schoolId,
    startDateBs: tomorrowBs,
    status: { $in: ["SCHEDULED", "ONGOING"] }
  })
    .select("name")
    .lean();

  const holidayStartingTomorrow = holidays.some((event) => event.startDateBs === tomorrowBs);

  // A routine Saturday off is not news. Skip it unless something real is
  // attached to the day (exam, event, or the Saturday being a working day).
  const hasRealNews =
    examEventsStarting.length > 0 ||
    examsStarting.length > 0 ||
    otherEventsStarting.length > 0 ||
    Boolean(workingSaturday) ||
    (holidayStartingTomorrow && !tomorrowIsSaturday);

  if (!hasRealNews) return null;

  const dayName = getDayNameFromBs(tomorrowBs);
  const lines: string[] = [];

  if (workingSaturday) {
    lines.push(`Working day: tomorrow is a ${dayName} but classes run as normal — ${workingSaturday.name}.`);
  } else if (holidayStartingTomorrow && !tomorrowIsSaturday) {
    const holiday = holidays.find((event) => event.startDateBs === tomorrowBs)!;
    const through =
      compareBsDates(holiday.endDateBs, tomorrowBs) > 0 ? ` through ${holiday.endDateBs} BS` : "";
    lines.push(
      `Holiday: ${holiday.name} (${ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[holiday.eventType]})${through} — no classes.`
    );
  }

  const examNames = uniqueNames([
    ...examsStarting.map((exam) => String(exam.name ?? "")),
    ...examEventsStarting.map((event) => event.name)
  ]);
  if (examNames.length > 0) {
    lines.push(`Exams start tomorrow: ${examNames.join(", ")}. Check your exam routine.`);
  }

  if (otherEventsStarting.length > 0) {
    const eventText = otherEventsStarting
      .map((event) => `${event.name} (${ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[event.eventType]})`)
      .join("; ");
    lines.push(`Events: ${eventText}.`);
  }

  if (lines.length === 0) return null;

  const title = workingSaturday
    ? "Tomorrow is a working day"
    : holidayStartingTomorrow && !tomorrowIsSaturday
      ? "Tomorrow is a holiday"
      : examNames.length > 0
        ? "Your exams start tomorrow"
        : "Tomorrow on the academic calendar";

  const message = [`Tomorrow is ${dayName}, ${tomorrowBs} BS.`, ...lines].join(" ");

  return { title, message, tomorrowBs };
};

/** Evening delivery of the day-ahead digest. Silent when there is no news. */
export const notifyDayAheadDigest = async (
  schoolId: string,
  todayBs: string
): Promise<void> => {
  const hour = getNepalHour();
  if (hour < DIGEST_WINDOW_START_HOUR || hour >= DIGEST_WINDOW_END_HOUR) return;

  const digest = await buildDayAheadDigest(schoolId, todayBs);
  if (!digest) return;

  await notifySchoolUsers(
    schoolId,
    digest.title,
    digest.message,
    { dateBs: digest.tomorrowBs, path: "/academic-calendar" },
    // One per school per day; re-sends only if tomorrow's plan actually changes.
    `day-ahead:${schoolId}:${digest.tomorrowBs}`
  );
};
