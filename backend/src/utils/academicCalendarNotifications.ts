import { ACADEMIC_CALENDAR_EVENT_TYPE_LABELS, type AcademicCalendarEventType } from "@phit-erp/shared";
import { User } from "../models/User.js";
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
  metadata?: Record<string, string>
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
        metadata
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
