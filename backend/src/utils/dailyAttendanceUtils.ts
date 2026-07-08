import NepaliDateImport from "nepali-date-converter";
import type { ClientSession } from "mongoose";
import {
  DAYS_OF_WEEK,
  DEFAULT_DAILY_ATTENDANCE_CONFIG,
  type DailyAttendanceConfig
} from "@phit-erp/shared";
import { Attendance } from "../models/Attendance.js";
import { Batch } from "../models/Batch.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { DailyAttendanceLog } from "../models/DailyAttendanceLog.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { isCollege } from "./institution.js";
import { compareBsDates, getTodayBs } from "./nepaliDate.js";
import { getSessionOption } from "./transaction.js";

const NEPAL_TIMEZONE_OFFSET_MINUTES = 345;

export const getNepalCurrentTime = (): { hours: number; minutes: number; timeString: string } => {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + NEPAL_TIMEZONE_OFFSET_MINUTES;
  const normalized = ((utcMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return {
    hours,
    minutes,
    timeString: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  };
};

type NepaliDateInstance = {
  getYear(): number;
  getMonth(): number;
  getDate(): number;
  toJsDate?(): Date;
};

type NepaliDateConstructor = new (value?: string | number | Date) => NepaliDateInstance & {
  toJsDate(): Date;
};

const NepaliDate = ((NepaliDateImport as { default?: NepaliDateConstructor }).default ??
  NepaliDateImport) as NepaliDateConstructor;

export const getDayOfWeekFromDate = (dateBs: string): number => {
  const [year, month, day] = dateBs.split("-").map(Number);
  const NepaliDateBs = NepaliDate as NepaliDateConstructor & {
    new (year: number, monthIndex: number, date: number): NepaliDateInstance & { toJsDate(): Date };
  };
  const nepaliDate = new NepaliDateBs(year!, month! - 1, day!);
  const jsDate = nepaliDate.toJsDate();
  return jsDate.getDay();
};

export const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

export const getDailyAttendanceConfig = async (schoolId: string): Promise<DailyAttendanceConfig> => {
  const settings = await Setting.findOne({ schoolId }).select("dailyAttendance").lean();
  return {
    ...DEFAULT_DAILY_ATTENDANCE_CONFIG,
    ...(settings?.dailyAttendance ?? {})
  };
};

export const getHolidayForDate = async (
  schoolId: string,
  dateBs: string
): Promise<{ title: string; dateBs: string } | null> => {
  const settings = await Setting.findOne({ schoolId }).select("holidays").lean();
  const holiday = settings?.holidays?.find((item) => item.dateBs === dateBs);
  return holiday ?? null;
};

interface AvailabilityParams {
  dateBs: string;
  config: DailyAttendanceConfig;
  firstPeriodEndTime?: string;
  adminOverride?: boolean;
  holidayTitle?: string;
}

export const evaluateAttendanceAvailability = (params: AvailabilityParams): {
  canMark: boolean;
  message?: string;
  isHoliday: boolean;
} => {
  if (params.adminOverride) {
    return { canMark: true, isHoliday: false };
  }

  if (params.holidayTitle) {
    return {
      canMark: false,
      isHoliday: true,
      message: `Attendance is unavailable today: ${params.holidayTitle}`
    };
  }

  const todayBs = getTodayBs();
  if (compareBsDates(params.dateBs, todayBs) !== 0) {
    return {
      canMark: false,
      isHoliday: false,
      message: "Daily attendance can only be marked on the current working day."
    };
  }

  const current = getNepalCurrentTime();
  const currentMinutes = current.hours * 60 + current.minutes;
  const startMinutes = parseTimeToMinutes(params.config.startTime);
  const endMinutes = parseTimeToMinutes(params.config.endTime);

  if (currentMinutes < startMinutes) {
    return {
      canMark: false,
      isHoliday: false,
      message: `Attendance opens at ${params.config.startTime}.`
    };
  }

  if (params.config.closeBeforeFirstPeriodEnds && params.firstPeriodEndTime) {
    const periodEndMinutes = parseTimeToMinutes(params.firstPeriodEndTime);
    if (currentMinutes > periodEndMinutes) {
      return {
        canMark: false,
        isHoliday: false,
        message: `Attendance closed after the first period ended at ${params.firstPeriodEndTime}.`
      };
    }
  } else if (currentMinutes > endMinutes) {
    return {
      canMark: false,
      isHoliday: false,
      message: `Attendance window closed at ${params.config.endTime}.`
    };
  }

  return { canMark: true, isHoliday: false };
};

type TimetableSlotLean = {
  _id: { toString(): string };
  classId?: { toString(): string } | null;
  sectionId?: { toString(): string } | null;
  batchId?: { toString(): string } | null;
  yearId?: { toString(): string } | null;
  subjectId: { toString(): string };
  teacherId: { toString(): string };
  periodNumber: number;
  startTime: string;
  endTime: string;
  academicYearBs: string;
};

export const getAcademicGroupKey = (
  slot: { classId?: { toString(): string } | null; sectionId?: { toString(): string } | null; batchId?: { toString(): string } | null; yearId?: { toString(): string } | null },
  college: boolean
): string =>
  college
    ? `${slot.batchId?.toString() ?? ""}-${slot.yearId?.toString() ?? ""}`
    : `${slot.classId?.toString() ?? ""}-${slot.sectionId?.toString() ?? ""}`;

export const getFirstPeriodSlotForGroup = async (
  schoolId: string,
  academicYearBs: string,
  dayOfWeek: number,
  slot: TimetableSlotLean,
  college: boolean
) => {
  const query: Record<string, unknown> = {
    schoolId,
    academicYearBs,
    dayOfWeek,
    periodNumber: 1
  };

  if (college) {
    query.batchId = slot.batchId;
    query.yearId = slot.yearId;
  } else {
    query.classId = slot.classId;
    query.sectionId = slot.sectionId;
  }

  return TimetableSlot.findOne(query).lean();
};

export const getDailyAttendanceSlots = async (
  schoolId: string,
  academicYearBs: string,
  dayOfWeek: number,
  college: boolean,
  options: { teacherId?: string; adminView?: boolean; lockedGroupKeys?: Set<string> }
) => {
  const baseQuery: Record<string, unknown> = { schoolId, academicYearBs, dayOfWeek };
  let slots: TimetableSlotLean[] = [];

  if (options.adminView) {
    slots = (await TimetableSlot.find({ ...baseQuery, periodNumber: 1 }).sort({ startTime: 1 }).lean()) as TimetableSlotLean[];
  } else if (options.teacherId) {
    const primarySlots = (await TimetableSlot.find({
      ...baseQuery,
      periodNumber: 1,
      teacherId: options.teacherId
    }).lean()) as TimetableSlotLean[];

    const substituteSlots = (await TimetableSlot.find({
      ...baseQuery,
      teacherId: options.teacherId,
      periodNumber: { $gt: 1 }
    })
      .sort({ periodNumber: 1, startTime: 1 })
      .lean()) as TimetableSlotLean[];

    const lockedKeys = options.lockedGroupKeys ?? new Set<string>();
    const filteredSubstitute = substituteSlots.filter(
      (slot) => !lockedKeys.has(getAcademicGroupKey(slot, college))
    );

    slots = [...primarySlots, ...filteredSubstitute];
  } else {
    slots = (await TimetableSlot.find({ ...baseQuery, periodNumber: 1 }).sort({ startTime: 1 }).lean()) as TimetableSlotLean[];
  }

  if (!slots.length) {
    return [];
  }

  const classIds = slots.map((slot) => slot.classId).filter(Boolean);
  const sectionIds = slots.map((slot) => slot.sectionId).filter(Boolean);
  const batchIds = slots.map((slot) => slot.batchId).filter(Boolean);
  const yearIds = slots.map((slot) => slot.yearId).filter(Boolean);
  const subjectIds = slots.map((slot) => slot.subjectId).filter(Boolean);
  const teacherIds = slots.map((slot) => slot.teacherId).filter(Boolean);

  const [classes, sections, batches, years, subjects, teachers] = await Promise.all([
    college ? [] : SchoolClass.find({ _id: { $in: classIds } }).lean(),
    college ? [] : Section.find({ _id: { $in: sectionIds } }).lean(),
    college ? Batch.find({ _id: { $in: batchIds } }).lean() : [],
    college ? Year.find({ _id: { $in: yearIds } }).lean() : [],
    Subject.find({ _id: { $in: subjectIds } }).lean(),
    Teacher.find({ _id: { $in: teacherIds } }).populate("user", "fullName").lean()
  ]);

  const classMap = new Map(classes.map((item) => [item._id.toString(), item.name]));
  const sectionMap = new Map(sections.map((item) => [item._id.toString(), item.name]));
  const batchMap = new Map(batches.map((item) => [item._id.toString(), item.name]));
  const yearMap = new Map(years.map((item) => [item._id.toString(), item.name]));
  const subjectMap = new Map(subjects.map((item) => [item._id.toString(), item]));
  const teacherMap = new Map(
    teachers.map((item) => [
      item._id.toString(),
      (item as { user?: { fullName?: string } }).user?.fullName ?? "Teacher"
    ])
  );

  const firstPeriodTeacherMap = new Map<string, string>();
  const firstPeriodSlots = (await TimetableSlot.find({ ...baseQuery, periodNumber: 1 }).lean()) as TimetableSlotLean[];
  if (firstPeriodSlots.length) {
    const firstPeriodTeacherIds = [...new Set(firstPeriodSlots.map((slot) => slot.teacherId.toString()))];
    const firstPeriodTeachers = await Teacher.find({ _id: { $in: firstPeriodTeacherIds } })
      .populate("user", "fullName")
      .lean();
    const fpTeacherMap = new Map(
      firstPeriodTeachers.map((item) => [
        item._id.toString(),
        (item as { user?: { fullName?: string } }).user?.fullName ?? "Teacher"
      ])
    );
    firstPeriodSlots.forEach((slot) => {
      firstPeriodTeacherMap.set(
        getAcademicGroupKey(slot, college),
        fpTeacherMap.get(slot.teacherId.toString()) ?? "Teacher"
      );
    });
  }

  return slots.map((slot) => ({
    slot,
    className: slot.classId ? classMap.get(slot.classId.toString()) : undefined,
    sectionName: slot.sectionId ? sectionMap.get(slot.sectionId.toString()) : undefined,
    batchName: slot.batchId ? batchMap.get(slot.batchId.toString()) : undefined,
    yearName: slot.yearId ? yearMap.get(slot.yearId.toString()) : undefined,
    subject: subjectMap.get(slot.subjectId.toString()),
    teacherName: teacherMap.get(slot.teacherId.toString()) ?? "Teacher",
    firstPeriodTeacherName: firstPeriodTeacherMap.get(getAcademicGroupKey(slot, college)),
    isSubstituteSlot: slot.periodNumber > 1
  }));
};

/** @deprecated Use getDailyAttendanceSlots */
export const getFirstPeriodSlots = async (
  schoolId: string,
  academicYearBs: string,
  dayOfWeek: number,
  college: boolean,
  teacherId?: string
) =>
  getDailyAttendanceSlots(schoolId, academicYearBs, dayOfWeek, college, {
    teacherId,
    adminView: !teacherId
  });

export const recordDailyAttendanceLog = async (
  params: {
    schoolId: string;
    dailyAttendanceId: string;
    action: "CREATE" | "SUBMIT" | "UPDATE" | "UNLOCK" | "DELETE" | "SYNC" | "SYNC_UPDATE" | "REASSIGN";
    actorUserId: string;
    actorRole: string;
    before?: unknown;
    after?: unknown;
    synchronizationStatus?: string;
    metadata?: unknown;
  },
  session: ClientSession | null
) => {
  await DailyAttendanceLog.create(
    [
      {
        schoolId: params.schoolId,
        dailyAttendanceId: params.dailyAttendanceId,
        action: params.action,
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        before: params.before ?? null,
        after: params.after ?? null,
        synchronizationStatus: params.synchronizationStatus,
        metadata: params.metadata ?? null
      }
    ],
    getSessionOption(session)
  );
};

export const syncDailyAttendanceToSubject = async (
  dailyAttendance: {
    _id: string;
    schoolId: string;
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    subjectId: string;
    teacherId: string;
    dateBs: string;
    entries: Array<{ studentId: string; status: string }>;
    createdBy: string;
    syncedAttendanceId?: string;
  },
  college: boolean,
  actorUserId: string,
  actorRole: string,
  session: ClientSession | null
) => {
  const lookupFilter: Record<string, unknown> = {
    schoolId: dailyAttendance.schoolId,
    subjectId: dailyAttendance.subjectId,
    dateBs: dailyAttendance.dateBs
  };

  if (college) {
    lookupFilter.batchId = dailyAttendance.batchId;
    lookupFilter.yearId = dailyAttendance.yearId;
  } else {
    lookupFilter.classId = dailyAttendance.classId;
    lookupFilter.sectionId = dailyAttendance.sectionId;
  }

  const existing = dailyAttendance.syncedAttendanceId
    ? await Attendance.findById(dailyAttendance.syncedAttendanceId).session(session)
    : await Attendance.findOne(lookupFilter).session(session);

  const payload = {
    ...lookupFilter,
    teacherId: dailyAttendance.teacherId,
    entries: dailyAttendance.entries.map((entry) => ({
      studentId: entry.studentId,
      status: entry.status
    })),
    createdBy: dailyAttendance.createdBy
  };

  const attendance = existing
    ? await Attendance.findByIdAndUpdate(existing._id, payload, { new: true, ...getSessionOption(session) })
    : await Attendance.create([payload], getSessionOption(session)).then((docs) => docs[0]!);

  if (!attendance) {
    throw new ApiError(500, "Failed to synchronize subject attendance");
  }

  await DailyAttendance.findByIdAndUpdate(
    dailyAttendance._id,
    {
      syncedAttendanceId: attendance._id,
      synchronizedAt: new Date()
    },
    getSessionOption(session)
  );

  await recordDailyAttendanceLog(
    {
      schoolId: dailyAttendance.schoolId.toString(),
      dailyAttendanceId: dailyAttendance._id.toString(),
      action: existing ? "SYNC_UPDATE" : "SYNC",
      actorUserId,
      actorRole,
      before: existing?.toObject() ?? null,
      after: attendance.toObject(),
      synchronizationStatus: "SUCCESS",
      metadata: { syncedAttendanceId: attendance._id.toString() }
    },
    session
  );

  return attendance;
};

export const validateDailyAttendanceStudents = async (
  schoolId: string,
  college: boolean,
  scope: { classId?: string; sectionId?: string; batchId?: string; yearId?: string },
  entries: Array<{ studentId: string }>
) => {
  const studentFilter: Record<string, unknown> = { schoolId };
  if (college) {
    studentFilter.batchId = scope.batchId;
    studentFilter.yearId = scope.yearId;
  } else {
    studentFilter.classId = scope.classId;
    studentFilter.sectionId = scope.sectionId;
  }

  const students = await Student.find(studentFilter).select("_id").lean();
  if (students.length !== entries.length) {
    throw new ApiError(400, "Every student in the class must have an attendance status.");
  }

  const rosterIds = new Set(students.map((student) => student._id.toString()));
  const invalid = entries.find((entry) => !rosterIds.has(entry.studentId));
  if (invalid) {
    throw new ApiError(400, "Attendance includes students outside the selected academic group.");
  }
};

export const getDayName = (dayOfWeek: number): string => DAYS_OF_WEEK[dayOfWeek] ?? "Unknown";