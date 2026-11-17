/**
 * Timetable change notifications.
 *
 * Every create / update / delete / period-time change in Timetable Management
 * tells the people it concerns exactly what changed:
 *  - students of that batch + year (college) or class + section (school);
 *  - the teacher(s) of the changed period — before and after the change.
 *
 * Changes are collected per group for a short while and sent as ONE notice, so
 * building or reshuffling a timetable does not flood every student with a
 * separate notification per period.
 */
import { DAYS_OF_WEEK } from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { sendNotification } from "./notificationService.js";

type Id = { toString(): string } | string | null | undefined;

/** The fields of a timetable slot a notice talks about. */
export interface TimetableSlotSnapshot {
  dayOfWeek: number;
  periodNumber: number;
  startTime: string;
  endTime: string;
  sessionType?: string | null;
  subjectId?: Id;
  teacherId?: Id;
  room?: string | null;
  breakLabel?: string | null;
  batchId?: Id;
  yearId?: Id;
  classId?: Id;
  sectionId?: Id;
}

interface Group {
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
}

interface ChangeLine {
  text: string;
  /** Teacher records (not users) the line concerns. */
  teacherIds: string[];
}

interface PendingGroup {
  schoolId: string;
  group: Group;
  lines: ChangeLine[];
  firstAt: number;
  timer: NodeJS.Timeout;
}

/** Send once nothing has changed for this long… */
const QUIET_MS = 60 * 1000;
/** …but never hold a change longer than this. */
const MAX_HOLD_MS = 5 * 60 * 1000;
/** Lines shown in one notice; the rest are summarised. */
const MAX_LINES = 12;

const pending = new Map<string, PendingGroup>();

const idOf = (value: Id): string => (value ? value.toString() : "");

const groupOf = (slot: TimetableSlotSnapshot): Group => ({
  batchId: idOf(slot.batchId) || undefined,
  yearId: idOf(slot.yearId) || undefined,
  classId: idOf(slot.classId) || undefined,
  sectionId: idOf(slot.sectionId) || undefined
});

const groupKey = (schoolId: string, group: Group): string =>
  [schoolId, group.batchId ?? "", group.yearId ?? "", group.classId ?? "", group.sectionId ?? ""].join("|");

const sameGroup = (a: Group, b: Group): boolean => groupKey("", a) === groupKey("", b);

const SOFT_LABELS: Record<string, string> = {
  BREAK: "Break",
  HOLIDAY: "Holiday",
  SPORTS: "Sports"
};

const dayName = (day: number): string => DAYS_OF_WEEK[day] ?? `Day ${day}`;

const isSoft = (sessionType?: string | null) => sessionType === "BREAK" || sessionType === "HOLIDAY";

/** "Sunday, Period 3 (10:00–10:45)" — breaks have no period number. */
const placeOf = (slot: TimetableSlotSnapshot): string => {
  const time = `${slot.startTime}–${slot.endTime}`;
  if (isSoft(slot.sessionType)) return `${dayName(slot.dayOfWeek)} (${time})`;
  return `${dayName(slot.dayOfWeek)}, Period ${slot.periodNumber} (${time})`;
};

const nameCache = async () => {
  const subjects = new Map<string, string>();
  const teachers = new Map<string, string>();
  return {
    subject: async (id: Id): Promise<string> => {
      const key = idOf(id);
      if (!key) return "";
      if (!subjects.has(key)) {
        const doc = await Subject.findById(key).select("name code").lean();
        subjects.set(key, doc ? (doc.code ? `${doc.name} (${doc.code})` : doc.name) : "");
      }
      return subjects.get(key) ?? "";
    },
    teacher: async (id: Id): Promise<string> => {
      const key = idOf(id);
      if (!key) return "";
      if (!teachers.has(key)) {
        const doc = (await Teacher.findById(key).populate("user", "fullName").lean()) as {
          user?: { fullName?: string } | null;
        } | null;
        teachers.set(key, doc?.user?.fullName ?? "");
      }
      return teachers.get(key) ?? "";
    }
  };
};

export type Names = Awaited<ReturnType<typeof nameCache>>;

/** "Physics (PHY101) with Sita Karki, Room 204" / "Break" / "Sports". */
const whatOf = async (slot: TimetableSlotSnapshot, names: Names): Promise<string> => {
  const session = slot.sessionType ?? "THEORY";
  if (isSoft(session)) return slot.breakLabel?.trim() || SOFT_LABELS[session] || session;
  const subject = (await names.subject(slot.subjectId)) || SOFT_LABELS[session] || "Period";
  const teacher = await names.teacher(slot.teacherId);
  const kind = session === "PRACTICAL" ? " (Practical)" : "";
  const parts = [`${subject}${kind}`];
  if (teacher) parts[0] += ` with ${teacher}`;
  if (slot.room?.trim()) parts.push(`Room ${slot.room.trim()}`);
  return parts.join(", ");
};

const teacherIdsOf = (...slots: Array<TimetableSlotSnapshot | null>): string[] =>
  [...new Set(slots.map((slot) => idOf(slot?.teacherId)).filter(Boolean))];

/** Exact description of one slot change; null when nothing people see has changed. */
export const describeTimetableChange = async (
  before: TimetableSlotSnapshot | null,
  after: TimetableSlotSnapshot | null,
  names: Names
): Promise<string | null> => {
  if (!before && after) return `Added — ${placeOf(after)}: ${await whatOf(after, names)}.`;
  if (before && !after) return `Removed — ${placeOf(before)}: ${await whatOf(before, names)} (no longer on the timetable).`;
  if (!before || !after) return null;

  const beforeSession = before.sessionType ?? "THEORY";
  const afterSession = after.sessionType ?? "THEORY";
  const timeChanged = before.startTime !== after.startTime || before.endTime !== after.endTime;
  const timeText = `time changed from ${before.startTime}–${before.endTime} to ${after.startTime}–${after.endTime}`;

  // Class ↔ break / holiday / sports: say what replaces what
  const kindOf = (session: string) => (isSoft(session) || session === "SPORTS" ? session : "CLASS");
  if (kindOf(beforeSession) !== kindOf(afterSession)) {
    const replaced = `${placeOf(before)}: ${await whatOf(before, names)} replaced by ${await whatOf(after, names)}`;
    if (before.dayOfWeek !== after.dayOfWeek) {
      return `${replaced}, now on ${placeOf(after)}.`;
    }
    return `${replaced}${timeChanged ? `; ${timeText}` : ""}.`;
  }

  const changes: string[] = [];
  const beforeSubject = await names.subject(before.subjectId);
  const afterSubject = await names.subject(after.subjectId);
  {
    if (beforeSubject !== afterSubject) {
      changes.push(`subject changed from ${beforeSubject || "none"} to ${afterSubject || "none"}`);
    }
    const beforeTeacher = await names.teacher(before.teacherId);
    const afterTeacher = await names.teacher(after.teacherId);
    if (beforeTeacher !== afterTeacher) {
      changes.push(`teacher changed from ${beforeTeacher || "none"} to ${afterTeacher || "none"}`);
    }
    if ((before.sessionType ?? "THEORY") !== (after.sessionType ?? "THEORY")) {
      changes.push(`now a ${(after.sessionType ?? "THEORY").toLowerCase()} class`);
    }
    const beforeRoom = before.room?.trim() ?? "";
    const afterRoom = after.room?.trim() ?? "";
    if (beforeRoom.toLowerCase() !== afterRoom.toLowerCase()) {
      changes.push(`room changed from ${beforeRoom || "none"} to ${afterRoom || "none"}`);
    }
  }

  // Same day and period with new clock times is a time change, not a move
  const moved =
    before.dayOfWeek !== after.dayOfWeek ||
    (!isSoft(beforeSession) && before.periodNumber !== after.periodNumber);
  if (!moved && timeChanged) changes.push(timeText);
  if (!moved && changes.length === 0) return null;

  const subjectLabel = (await whatOf(before, names)).split(",")[0];
  if (moved) {
    const rest = changes.length ? `; ${changes.join("; ")}` : "";
    return `${subjectLabel}: moved from ${placeOf(before)} to ${placeOf(after)}${rest}.`;
  }
  return `${placeOf(before)}: ${changes.join("; ")}.`;
};

const groupLabel = async (group: Group): Promise<string> => {
  if (group.batchId || group.yearId) {
    const [batch, year] = await Promise.all([
      group.batchId ? Batch.findById(group.batchId).select("name").lean() : null,
      group.yearId ? Year.findById(group.yearId).select("name").lean() : null
    ]);
    return [year?.name, batch?.name ? `Batch ${batch.name}` : ""].filter(Boolean).join(", ");
  }
  const [schoolClass, section] = await Promise.all([
    group.classId ? SchoolClass.findById(group.classId).select("name").lean() : null,
    group.sectionId ? Section.findById(group.sectionId).select("name").lean() : null
  ]);
  return [schoolClass?.name ? `Class ${schoolClass.name}` : "", section?.name ? `Section ${section.name}` : ""]
    .filter(Boolean)
    .join(", ");
};

const formatMessage = (lines: string[]): string => {
  const shown = lines.slice(0, MAX_LINES).map((line) => `• ${line}`);
  if (lines.length > MAX_LINES) {
    shown.push(`• …and ${lines.length - MAX_LINES} more change(s). Open the timetable to see them all.`);
  }
  return shown.join("\n");
};

const flush = async (key: string): Promise<void> => {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  clearTimeout(entry.timer);
  const { schoolId, group, lines } = entry;
  if (lines.length === 0) return;

  const label = (await groupLabel(group)) || "your class";
  const title = `Timetable changed — ${label}`;
  const metadata = { path: "/timetable-view" };

  // Students of this batch + year (or class + section) only
  const studentFilter: Record<string, unknown> = {
    schoolId,
    $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }]
  };
  if (group.batchId || group.yearId) {
    if (group.batchId) studentFilter.batchId = group.batchId;
    if (group.yearId) studentFilter.yearId = group.yearId;
  } else {
    if (group.classId) studentFilter.classId = group.classId;
    if (group.sectionId) studentFilter.sectionId = group.sectionId;
  }
  const hasGroup = Boolean(group.batchId || group.yearId || group.classId || group.sectionId);
  const students = hasGroup ? await Student.find(studentFilter).select("user").lean() : [];

  const studentMessage = formatMessage(lines.map((line) => line.text));
  const sends: Array<Promise<unknown>> = students.map((student) =>
    sendNotification({
      schoolId,
      recipientUserId: String(student.user),
      title,
      message: studentMessage,
      type: "TIMETABLE",
      metadata
    })
  );

  // Teachers of the changed periods — only the lines about their periods
  const teacherIds = [...new Set(lines.flatMap((line) => line.teacherIds))];
  if (teacherIds.length > 0) {
    const teachers = await Teacher.find({ _id: { $in: teacherIds }, schoolId }).select("user").lean();
    for (const teacher of teachers) {
      const own = lines.filter((line) => line.teacherIds.includes(teacher._id.toString()));
      if (own.length === 0) continue;
      sends.push(
        sendNotification({
          schoolId,
          recipientUserId: String(teacher.user),
          title: `Your timetable changed — ${label}`,
          message: formatMessage(own.map((line) => line.text)),
          type: "TIMETABLE",
          metadata
        })
      );
    }
  }

  await Promise.allSettled(sends);
};

const enqueue = (schoolId: string, group: Group, line: ChangeLine): void => {
  const key = groupKey(schoolId, group);
  const now = Date.now();
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const entry: PendingGroup = existing ?? { schoolId, group, lines: [], firstAt: now, timer: undefined as never };
  entry.lines.push(line);
  const wait = Math.max(0, Math.min(QUIET_MS, entry.firstAt + MAX_HOLD_MS - now));
  entry.timer = setTimeout(() => {
    void flush(key).catch((error) => console.error("[timetable-notify] send failed", error));
  }, wait);
  entry.timer.unref?.();
  pending.set(key, entry);
};

/**
 * Record a timetable slot change (create: before = null, delete: after = null).
 * Never throws — a notification problem must not fail the timetable save.
 */
export const queueTimetableSlotChange = async (
  schoolId: string,
  before: TimetableSlotSnapshot | null,
  after: TimetableSlotSnapshot | null
): Promise<void> => {
  try {
    const names = await nameCache();
    const beforeGroup = before ? groupOf(before) : null;
    const afterGroup = after ? groupOf(after) : null;

    // Moved to another batch / year / class: a removal for one, an addition for the other
    if (before && after && beforeGroup && afterGroup && !sameGroup(beforeGroup, afterGroup)) {
      const removed = await describeTimetableChange(before, null, names);
      const added = await describeTimetableChange(null, after, names);
      if (removed) enqueue(schoolId, beforeGroup, { text: removed, teacherIds: teacherIdsOf(before) });
      if (added) enqueue(schoolId, afterGroup, { text: added, teacherIds: teacherIdsOf(after) });
      return;
    }

    const text = await describeTimetableChange(before, after, names);
    if (!text) return;
    const group = (afterGroup ?? beforeGroup)!;
    enqueue(schoolId, group, { text, teacherIds: teacherIdsOf(before, after) });
  } catch (error) {
    console.error("[timetable-notify] could not describe change", error);
  }
};

/** Whole-week period time change (Timetable → change period times). */
export const queueTimetablePeriodTimesChange = async (
  schoolId: string,
  group: Group,
  slots: TimetableSlotSnapshot[],
  oldTime: { start: string; end: string },
  newTime: { start: string; end: string }
): Promise<void> => {
  try {
    if (slots.length === 0) return;
    const teaching = slots.filter((slot) => !isSoft(slot.sessionType));
    const periods = [...new Set(teaching.map((slot) => slot.periodNumber))].sort((a, b) => a - b);
    const which = periods.length ? `Period ${periods.join(", ")}` : "The break";
    const days = [...new Set(slots.map((slot) => slot.dayOfWeek))].sort((a, b) => a - b).map(dayName);
    const text =
      `${which} time changed from ${oldTime.start}–${oldTime.end} to ${newTime.start}–${newTime.end} ` +
      `on ${days.length >= 6 ? "every day" : days.join(", ")}.`;
    enqueue(schoolId, group, { text, teacherIds: teacherIdsOf(...slots) });
  } catch (error) {
    console.error("[timetable-notify] could not describe period time change", error);
  }
};
