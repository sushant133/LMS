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
  /** Exclude self on update */
  excludeId?: string;
};

/** Sessions that may share the day/time with normal teaching (exam overlay, breaks). */
const NON_TEACHING_SESSION_TYPES = new Set(["EXAM", "BREAK", "HOLIDAY"]);

const isTeachingSession = (sessionType?: string): boolean => {
  const t = (sessionType ?? "THEORY").toUpperCase();
  return !NON_TEACHING_SESSION_TYPES.has(t);
};

/** "HH:MM" → minutes since midnight for overlap checks. */
const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
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
  if (Number.isNaN(as) || Number.isNaN(ae) || Number.isNaN(bs) || Number.isNaN(be)) {
    return false;
  }
  return as < be && bs < ae;
};

const dayLabel = (dayOfWeek: number): string =>
  DAYS_OF_WEEK[dayOfWeek] ?? `Day ${dayOfWeek}`;

const idString = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

/**
 * Prevent teacher / room / lab / batch double-booking for the same day & overlapping time.
 *
 * Rules:
 * - EXAM / BREAK / HOLIDAY do not block THEORY / PRACTICAL (and reverse).
 *   Class timetable stays valid during exam periods; exams can be overlaid separately.
 * - Only real clock-time overlaps count (not periodNumber alone).
 * - On update, excludeId is always ignored (ObjectId-safe).
 */
export const assertNoTimetableConflicts = async (
  input: TimetableConflictInput
): Promise<void> => {
  const filter: Record<string, unknown> = {
    schoolId: input.schoolId,
    academicYearBs: input.academicYearBs,
    dayOfWeek: input.dayOfWeek
  };

  if (input.excludeId) {
    // Ensure ObjectId comparison works (string $ne can fail to exclude self)
    if (mongoose.Types.ObjectId.isValid(input.excludeId)) {
      filter._id = { $ne: new mongoose.Types.ObjectId(input.excludeId) };
    } else {
      filter._id = { $ne: input.excludeId };
    }
  }

  const candidates = await TimetableSlot.find(filter)
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .populate("subjectId", "name")
    .lean();

  const inputType = (input.sessionType ?? "THEORY").toUpperCase();
  const inputIsTeaching = isTeachingSession(inputType);
  const roomNorm = input.room?.trim().toLowerCase() ?? "";
  const isLab =
    input.roomKind === "LABORATORY" ||
    inputType === "PRACTICAL" ||
    (roomNorm.length > 0 && /lab/i.test(roomNorm));

  for (const other of candidates) {
    // Double-check self-exclusion (populate / type edge cases)
    if (input.excludeId && String(other._id) === String(input.excludeId)) {
      continue;
    }

    const otherStart = other.startTime;
    const otherEnd = other.endTime;
    // Real time overlap only — same periodNumber alone is not enough
    // (different years can reuse period numbers with different clocks).
    if (!timesOverlap(input.startTime, input.endTime, otherStart, otherEnd)) {
      continue;
    }

    const otherType = String(
      (other as { sessionType?: string }).sessionType ?? "THEORY"
    ).toUpperCase();
    const otherIsTeaching = isTeachingSession(otherType);

    // Exam / break / holiday may coexist with regular class timetable
    if (inputIsTeaching !== otherIsTeaching) {
      continue;
    }
    // Two non-teaching types (e.g. BREAK vs EXAM) also allowed to overlap
    if (!inputIsTeaching && !otherIsTeaching && inputType !== otherType) {
      continue;
    }

    const otherTeacherId = idString(other.teacherId);
    const otherRoom = (other.room ?? "").trim().toLowerCase();
    const timeLabel = `${input.startTime}–${input.endTime}`;
    const day = dayLabel(input.dayOfWeek);

    // Teacher conflict (only when both are teaching sessions, or same non-teaching type)
    if (
      input.teacherId &&
      otherTeacherId &&
      otherTeacherId === String(input.teacherId)
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
        `Teacher conflict: ${teacherName} is already scheduled on ${day} ${otherStart}–${otherEnd}`
      );
    }

    // Room / lab conflict
    if (roomNorm && otherRoom && roomNorm === otherRoom) {
      const kind = isLab || /lab/i.test(otherRoom) ? "Laboratory" : "Classroom";
      throw new ApiError(
        400,
        `${kind} conflict: "${input.room?.trim()}" is already booked on ${day} ${otherStart}–${otherEnd}`
      );
    }

    // Same academic group already has a teaching period at this time
    const sameGroupCollege =
      Boolean(input.batchId) &&
      Boolean(input.yearId) &&
      other.batchId?.toString() === String(input.batchId) &&
      other.yearId?.toString() === String(input.yearId);
    const sameGroupSchool =
      Boolean(input.classId) &&
      Boolean(input.sectionId) &&
      other.classId?.toString() === String(input.classId) &&
      other.sectionId?.toString() === String(input.sectionId);

    if (sameGroupCollege || sameGroupSchool) {
      const subjectName =
        typeof other.subjectId === "object" &&
        other.subjectId !== null &&
        "name" in other.subjectId
          ? String((other.subjectId as { name?: string }).name ?? "Subject")
          : "Subject";
      throw new ApiError(
        400,
        `Batch/class conflict: this group already has ${subjectName} on ${day} ${timeLabel} (overlaps ${otherStart}–${otherEnd})`
      );
    }
  }
};
