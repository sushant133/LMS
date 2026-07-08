import {
  ACADEMIC_EVENT_TYPES,
  EXAMINATION_EVENT_TYPES,
  HOLIDAY_EVENT_TYPES,
  isHolidayEventType,
  parseAcademicYearStart,
  type AcademicCalendarDashboard,
  type AcademicCalendarEventRecord,
  type AcademicCalendarFilters
} from "@phit-erp/shared";
import type { Types } from "mongoose";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { Batch } from "../models/Batch.js";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { User } from "../models/User.js";
import { bsToAdDate, compareBsDates, getDaysInBsMonth, getTodayBs } from "./nepaliDate.js";

type EventLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  academicYearBs: string;
  dateBs: string;
  dateAd: string;
  dayOfWeek: string;
  name: string;
  eventType: AcademicCalendarEventRecord["eventType"];
  reason?: string;
  isHoliday: boolean;
  audit?: {
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
  };
  createdAt?: Date;
  updatedAt?: Date;
};

const enrichEvents = async (events: EventLean[]): Promise<AcademicCalendarEventRecord[]> => {
  const userIds = [
    ...new Set(
      events
        .flatMap((event) => [event.audit?.createdBy?.toString(), event.audit?.updatedBy?.toString()])
        .filter(Boolean)
    )
  ] as string[];

  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("fullName")
        .lean()
    : [];
  const userById = new Map(users.map((user) => [user._id.toString(), user.fullName]));

  return events.map((event) => ({
    _id: event._id.toString(),
    schoolId: event.schoolId.toString(),
    academicYearBs: event.academicYearBs,
    dateBs: event.dateBs,
    dateAd: event.dateAd,
    dayOfWeek: event.dayOfWeek,
    name: event.name,
    eventType: event.eventType,
    reason: event.reason,
    isHoliday: event.isHoliday,
    audit: {
      createdBy: event.audit?.createdBy?.toString(),
      createdByName: event.audit?.createdBy ? userById.get(event.audit.createdBy.toString()) : undefined,
      updatedBy: event.audit?.updatedBy?.toString(),
      updatedByName: event.audit?.updatedBy ? userById.get(event.audit.updatedBy.toString()) : undefined,
      createdAt: event.audit?.createdAt?.toISOString(),
      updatedAt: event.audit?.updatedAt?.toISOString()
    }
  }));
};

export const resolveAcademicYearRangeAccurate = (academicYearBs: string): { fromDateBs: string; toDateBs: string } => {
  const startYear = parseAcademicYearStart(academicYearBs);
  const lastDay = getDaysInBsMonth(startYear, 12);
  return {
    fromDateBs: `${startYear}-01-01`,
    toDateBs: `${startYear}-12-${String(lastDay).padStart(2, "0")}`
  };
};

export const inferAcademicYearFromDateBs = (dateBs: string): string => {
  const year = Number(dateBs.split("-")[0]);
  return `${year}/${year + 1}`;
};

export const buildEventFilter = (
  schoolId: Types.ObjectId,
  filters: AcademicCalendarFilters
): Record<string, unknown> => {
  const query: Record<string, unknown> = { schoolId };

  if (filters.academicYearBs) {
    const { fromDateBs, toDateBs } = resolveAcademicYearRangeAccurate(filters.academicYearBs);
    query.dateBs = { $gte: fromDateBs, $lte: toDateBs };
  }

  if (filters.monthBs) {
    const [yearText, monthText] = filters.monthBs.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (year && month) {
      const days = getDaysInBsMonth(year, month);
      query.dateBs = {
        $gte: `${year}-${monthText}-01`,
        $lte: `${year}-${monthText}-${String(days).padStart(2, "0")}`
      };
    }
  }

  if (filters.dateFromBs || filters.dateToBs) {
    const range: Record<string, string> = {};
    if (filters.dateFromBs) range.$gte = filters.dateFromBs;
    if (filters.dateToBs) range.$lte = filters.dateToBs;
    query.dateBs = range;
  }

  if (filters.dateAd) {
    query.dateAd = filters.dateAd;
  }

  if (filters.eventType) {
    query.eventType = filters.eventType;
  }

  if (filters.keyword?.trim()) {
    const keyword = filters.keyword.trim();
    query.$or = [
      { name: { $regex: keyword, $options: "i" } },
      { reason: { $regex: keyword, $options: "i" } },
      { dateBs: keyword },
      { dateAd: keyword }
    ];
  }

  return query;
};

export const listAcademicCalendarEvents = async (
  schoolId: Types.ObjectId,
  filters: AcademicCalendarFilters
): Promise<AcademicCalendarEventRecord[]> => {
  const events = await AcademicCalendarEvent.find(buildEventFilter(schoolId, filters))
    .sort({ dateBs: 1, name: 1 })
    .lean<EventLean[]>();

  return enrichEvents(events);
};

/** Institution's active academic year (School → Settings → year from today's BS date). */
export const resolveCurrentAcademicYear = async (schoolId: Types.ObjectId): Promise<string> => {
  const todayBs = getTodayBs();
  const [school, settings] = await Promise.all([
    School.findById(schoolId).select("academicYearBs").lean(),
    Setting.findOne({ schoolId }).select("academicYearBs").lean()
  ]);

  return (
    school?.academicYearBs ||
    settings?.academicYearBs ||
    inferAcademicYearFromDateBs(todayBs)
  );
};

export const listAcademicYears = async (schoolId: Types.ObjectId): Promise<string[]> => {
  const [currentYearLabel, batchYears, eventYears, todayBs] = await Promise.all([
    resolveCurrentAcademicYear(schoolId),
    Batch.find({ schoolId }).distinct("academicYearBs"),
    AcademicCalendarEvent.find({ schoolId }).distinct("academicYearBs"),
    Promise.resolve(getTodayBs())
  ]);

  const currentYear = Number(todayBs.split("-")[0]);
  const years = new Set<string>([
    currentYearLabel,
    ...batchYears.filter(Boolean),
    ...eventYears.filter(Boolean)
  ]);

  for (let offset = -2; offset <= 2; offset += 1) {
    const year = currentYear + offset;
    years.add(`${year}/${year + 1}`);
  }

  // Current institutional year first, then remaining years newest → oldest.
  const sorted = [...years].sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return [currentYearLabel, ...sorted.filter((year) => year !== currentYearLabel)];
};

export const buildAcademicCalendarDashboard = async (
  schoolId: Types.ObjectId,
  academicYearBs?: string
): Promise<AcademicCalendarDashboard> => {
  const todayBs = getTodayBs();
  const { dateAd: todayAd } = bsToAdDate(todayBs);
  const [years, currentYearLabel] = await Promise.all([
    listAcademicYears(schoolId),
    resolveCurrentAcademicYear(schoolId)
  ]);
  const resolvedYear =
    academicYearBs && years.includes(academicYearBs)
      ? academicYearBs
      : currentYearLabel || years[0] || inferAcademicYearFromDateBs(todayBs);

  const upcoming = await AcademicCalendarEvent.find({
    schoolId,
    dateBs: { $gte: todayBs }
  })
    .sort({ dateBs: 1 })
    .limit(50)
    .lean<EventLean[]>();

  const enriched = await enrichEvents(upcoming);

  return {
    todayBs,
    todayAd,
    academicYearBs: resolvedYear,
    upcomingHolidays: enriched.filter((event) => HOLIDAY_EVENT_TYPES.includes(event.eventType)).slice(0, 5),
    upcomingAcademicEvents: enriched.filter((event) => ACADEMIC_EVENT_TYPES.includes(event.eventType)).slice(0, 5),
    upcomingExaminations: enriched.filter((event) => EXAMINATION_EVENT_TYPES.includes(event.eventType)).slice(0, 5)
  };
};

export const serializeCalendarEvent = (event: EventLean): AcademicCalendarEventRecord => ({
  _id: event._id.toString(),
  schoolId: event.schoolId.toString(),
  academicYearBs: event.academicYearBs,
  dateBs: event.dateBs,
  dateAd: event.dateAd,
  dayOfWeek: event.dayOfWeek,
  name: event.name,
  eventType: event.eventType,
  reason: event.reason,
  isHoliday: event.isHoliday
});

export const resolveHolidayFlag = (eventType: AcademicCalendarEventRecord["eventType"]): boolean =>
  isHolidayEventType(eventType);

export const sortEventsByDate = (events: AcademicCalendarEventRecord[]): AcademicCalendarEventRecord[] =>
  [...events].sort((left, right) => compareBsDates(left.dateBs, right.dateBs));