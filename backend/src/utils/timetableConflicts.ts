import type { Types } from "mongoose";
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
  return as < be && bs < ae;
};

const dayLabel = (dayOfWeek: number): string =>
  DAYS_OF_WEEK[dayOfWeek] ?? `Day ${dayOfWeek}`;

/**
 * Prevent teacher / room / lab / batch double-booking for the same day & overlapping time.
 * Does not replace unique indexes on group+period; complements them with teacher/room checks.
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
    filter._id = { $ne: input.excludeId };
  }

  const candidates = await TimetableSlot.find(filter)
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .populate("subjectId", "name")
    .lean();

  const roomNorm = input.room?.trim().toLowerCase() ?? "";
  const isLab =
    input.roomKind === "LABORATORY" ||
    input.sessionType === "PRACTICAL" ||
    (roomNorm.length > 0 && /lab/i.test(roomNorm));

  for (const other of candidates) {
    const otherStart = other.startTime;
    const otherEnd = other.endTime;
    const samePeriod = other.periodNumber === input.periodNumber;
    const overlap =
      samePeriod || timesOverlap(input.startTime, input.endTime, otherStart, otherEnd);
    if (!overlap) continue;

    const otherTeacherId = other.teacherId
      ? String(
          typeof other.teacherId === "object" && other.teacherId !== null && "_id" in other.teacherId
            ? (other.teacherId as { _id: unknown })._id
            : other.teacherId
        )
      : "";
    const otherRoom = (other.room ?? "").trim().toLowerCase();
    const timeLabel = `${input.startTime}–${input.endTime}`;
    const day = dayLabel(input.dayOfWeek);

    // Teacher conflict
    if (otherTeacherId && otherTeacherId === String(input.teacherId)) {
      const teacherName =
        typeof other.teacherId === "object" &&
        other.teacherId !== null &&
        "user" in other.teacherId
          ? ((other.teacherId as { user?: { fullName?: string } }).user?.fullName ?? "Teacher")
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

    // Same academic group (batch+year or class+section) already has a period
    const sameGroupCollege =
      input.batchId &&
      input.yearId &&
      other.batchId?.toString() === String(input.batchId) &&
      other.yearId?.toString() === String(input.yearId);
    const sameGroupSchool =
      input.classId &&
      input.sectionId &&
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
