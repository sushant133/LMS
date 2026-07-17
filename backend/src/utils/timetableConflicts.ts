import mongoose, { type Types } from "mongoose";
import { DAYS_OF_WEEK } from "@phit-erp/shared";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { ApiError } from "./apiError.js";

export type TimetableConflictInput = {
  schoolId: Types.ObjectId | string;
  academicYearBs: string;
  dayOfWeek: number;
  periodNumber: number;
  startTime: string;
  endTime: string;
  teacherId: string;
  subjectId?: string;
  room?: string;
  roomKind?: string;
  sessionType?: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  /** Exclude self on update (required for edits) */
  excludeId?: string;
};

/** Exam / break / holiday may overlay regular teaching slots. */
const NON_TEACHING_SESSION_TYPES = new Set(["EXAM", "BREAK", "HOLIDAY"]);

const isTeachingSession = (sessionType?: string): boolean => {
  const t = (sessionType ?? "THEORY").toUpperCase();
  return !NON_TEACHING_SESSION_TYPES.has(t);
};

const toMinutes = (time: string): number => {
  const parts = String(time ?? "").trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

const timesOverlap = (
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean => {
  const as = toMinutes(aStart);
  const ae = toMinutes(aEnd);
  const bs = toMinutes(bStart);
  const be = toMinutes(bEnd);
  return as < be && bs < ae;
};

const dayLabel = (dayOfWeek: number): string =>
  DAYS_OF_WEEK[dayOfWeek] ?? `Day ${dayOfWeek}`;

const idString = (value: unknown): string => {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if ("_id" in value) return String((value as { _id: unknown })._id);
    if (typeof (value as { toString?: () => string }).toString === "function") {
      const s = String(value);
      // Avoid "[object Object]"
      if (s && !s.startsWith("[object")) return s;
    }
  }
  return String(value);
};

const sameAcademicGroup = (
  a: {
    batchId?: string;
    yearId?: string;
    classId?: string;
    sectionId?: string;
  },
  b: {
    batchId?: unknown;
    yearId?: unknown;
    classId?: unknown;
    sectionId?: unknown;
  }
): boolean => {
  const bBatch = idString(b.batchId);
  const bYear = idString(b.yearId);
  const bClass = idString(b.classId);
  const bSection = idString(b.sectionId);

  if (a.batchId && a.yearId && bBatch && bYear) {
    return a.batchId === bBatch && a.yearId === bYear;
  }
  if (a.classId && a.sectionId && bClass && bSection) {
    return a.classId === bClass && a.sectionId === bSection;
  }
  return false;
};

/**
 * Conflict rules (practical for multi-year college schedules):
 *
 * 1. Never conflict with EXAM / BREAK / HOLIDAY vs teaching (overlays allowed).
 * 2. Never treat the document being edited as a conflict (excludeId).
 * 3. Teacher double-book only within the **same** batch+year (or class+section).
 *    The same teacher may appear at the same clock time on different year tables
 *    (common in existing data; admins can still edit those slots).
 * 4. Room / group still use real time overlap.
 */
export const assertNoTimetableConflicts = async (
  input: TimetableConflictInput
): Promise<void> => {
  const filter: Record<string, unknown> = {
    schoolId: input.schoolId,
    dayOfWeek: input.dayOfWeek
  };

  // academicYearBs is optional filter — empty string would match nothing useful
  if (input.academicYearBs?.trim()) {
    filter.academicYearBs = input.academicYearBs.trim();
  }

  const candidates = await TimetableSlot.find(filter)
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .populate("subjectId", "name")
    .lean();

  const exclude =
    input.excludeId && mongoose.Types.ObjectId.isValid(input.excludeId)
      ? String(input.excludeId)
      : input.excludeId
        ? String(input.excludeId)
        : "";

  const inputType = (input.sessionType ?? "THEORY").toUpperCase();
  const inputIsTeaching = isTeachingSession(inputType);
  const roomNorm = input.room?.trim().toLowerCase() ?? "";
  const isLab =
    input.roomKind === "LABORATORY" ||
    inputType === "PRACTICAL" ||
    (roomNorm.length > 0 && /lab/i.test(roomNorm));

  const inputTeacher = String(input.teacherId ?? "").trim();

  for (const other of candidates) {
    // Always skip the slot being edited
    if (exclude && String(other._id) === exclude) {
      continue;
    }

    const otherStart = other.startTime;
    const otherEnd = other.endTime;
    if (!timesOverlap(input.startTime, input.endTime, otherStart, otherEnd)) {
      continue;
    }

    const otherType = String(
      (other as { sessionType?: string }).sessionType ?? "THEORY"
    ).toUpperCase();
    const otherIsTeaching = isTeachingSession(otherType);

    // Exam / break / holiday may share time with class timetable
    if (inputIsTeaching !== otherIsTeaching) {
      continue;
    }
    if (!inputIsTeaching && !otherIsTeaching && inputType !== otherType) {
      continue;
    }

    const otherTeacherId = idString(other.teacherId);
    const otherRoom = (other.room ?? "").trim().toLowerCase();
    const timeLabel = `${input.startTime}–${input.endTime}`;
    const day = dayLabel(input.dayOfWeek);
    const sameGroup = sameAcademicGroup(
      {
        batchId: input.batchId,
        yearId: input.yearId,
        classId: input.classId,
        sectionId: input.sectionId
      },
      other
    );

    // Teacher conflict ONLY inside the same academic group
    // (allows same teacher on Year-1 and Year-2 tables at the same clock time)
    if (
      inputTeacher &&
      otherTeacherId &&
      otherTeacherId === inputTeacher &&
      sameGroup
    ) {
      const teacherName =
        typeof other.teacherId === "object" &&
        other.teacherId !== null &&
        "user" in other.teacherId
          ? ((other.teacherId as { user?: { fullName?: string } }).user?.fullName ??
            "Teacher")
          : "Teacher";
      throw new ApiError(
        400,
        `Teacher conflict: ${teacherName} is already scheduled for this class on ${day} ${otherStart}–${otherEnd}`
      );
    }

    // Room conflict (any group) — physical room can't hold two classes
    if (roomNorm && otherRoom && roomNorm === otherRoom) {
      const kind = isLab || /lab/i.test(otherRoom) ? "Laboratory" : "Classroom";
      throw new ApiError(
        400,
        `${kind} conflict: "${input.room?.trim()}" is already booked on ${day} ${otherStart}–${otherEnd}`
      );
    }

    // Same group already has another teaching period at this time
    if (sameGroup) {
      const subjectName =
        typeof other.subjectId === "object" &&
        other.subjectId !== null &&
        "name" in other.subjectId
          ? String((other.subjectId as { name?: string }).name ?? "Subject")
          : "Subject";
      throw new ApiError(
        400,
        `Class conflict: this group already has ${subjectName} on ${day} ${timeLabel} (overlaps ${otherStart}–${otherEnd})`
      );
    }
  }
};
