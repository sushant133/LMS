import {
  ACADEMIC_EVENT_TYPES,
  EXAMINATION_EVENT_TYPES,
  HOLIDAY_EVENT_TYPES,
  resolveIsHoliday,
  type AcademicCalendarDashboard,
  type AcademicCalendarEventRecord,
  type AcademicCalendarEventStatus,
  type AcademicCalendarEventType,
  type AcademicCalendarFilters
} from "@phit-erp/shared";
import type { Types } from "mongoose";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { Batch } from "../models/Batch.js";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { User } from "../models/User.js";
import {
  bsToAdDate,
  compareBsDates,
  getDayOfWeekFromBs,
  getDaysInBsMonth,
  getOffsetFromBsDate,
  getTodayBs
} from "./nepaliDate.js";

type EventLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  academicYearBs: string;
  dateBs: string;
  startDateBs?: string;
  endDateBs?: string;
  dateAd: string;
  startDateAd?: string;
  endDateAd?: string;
  dayOfWeek: string;
  name: string;
  eventType: AcademicCalendarEventType;
  reason?: string;
  isHoliday: boolean;
  status?: AcademicCalendarEventStatus;
  isWorkingDayOverride?: boolean;
  audit?: {
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
  };
  createdAt?: Date;
  updatedAt?: Date;
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Expand inclusive BS date range into individual YYYY-MM-DD strings. */
export const expandBsDateRange = (startDateBs: string, endDateBs: string): string[] => {
  if (compareBsDates(endDateBs, startDateBs) < 0) return [];

  const dates: string[] = [];
  let current = startDateBs;
  // Safety cap: ~14 months of BS days
  for (let i = 0; i < 450; i += 1) {
    dates.push(current);
    if (compareBsDates(current, endDateBs) >= 0) break;
    current = getOffsetFromBsDate(current, 1);
  }
  return dates;
};

export const countBsDaysInclusive = (startDateBs: string, endDateBs: string): number =>
  expandBsDateRange(startDateBs, endDateBs).length;

export const normalizeEventDates = (event: EventLean): {
  startDateBs: string;
  endDateBs: string;
  startDateAd: string;
  endDateAd: string;
  dateBs: string;
  dateAd: string;
  dayOfWeek: string;
} => {
  const startDateBs = event.startDateBs || event.dateBs;
  const endDateBs = event.endDateBs || event.startDateBs || event.dateBs;
  const startMeta = event.startDateAd
    ? { dateAd: event.startDateAd, dayOfWeek: event.dayOfWeek }
    : bsToAdDate(startDateBs);
  const endMeta = event.endDateAd ? { dateAd: event.endDateAd } : bsToAdDate(endDateBs);

  return {
    startDateBs,
    endDateBs,
    startDateAd: startMeta.dateAd,
    endDateAd: endMeta.dateAd,
    dateBs: startDateBs,
    dateAd: startMeta.dateAd,
    dayOfWeek: startMeta.dayOfWeek || event.dayOfWeek
  };
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

  return events.map((event) => {
    const dates = normalizeEventDates(event);
    const isWorkingDayOverride = Boolean(event.isWorkingDayOverride) || event.eventType === "WORKING_DAY";

    return {
      _id: event._id.toString(),
      schoolId: event.schoolId.toString(),
      academicYearBs: event.academicYearBs,
      dateBs: dates.dateBs,
      startDateBs: dates.startDateBs,
      endDateBs: dates.endDateBs,
      dateAd: dates.dateAd,
      startDateAd: dates.startDateAd,
      endDateAd: dates.endDateAd,
      dayOfWeek: dates.dayOfWeek,
      name: event.name,
      eventType: event.eventType,
      reason: event.reason,
      isHoliday: isWorkingDayOverride ? false : Boolean(event.isHoliday),
      totalDays: countBsDaysInclusive(dates.startDateBs, dates.endDateBs),
      status: event.status ?? "ACTIVE",
      isSystemGenerated: false,
      isWorkingDayOverride,
      audit: {
        createdBy: event.audit?.createdBy?.toString(),
        createdByName: event.audit?.createdBy
          ? userById.get(event.audit.createdBy.toString())
          : undefined,
        updatedBy: event.audit?.updatedBy?.toString(),
        updatedByName: event.audit?.updatedBy
          ? userById.get(event.audit.updatedBy.toString())
          : undefined,
        createdAt: event.audit?.createdAt?.toISOString() ?? event.createdAt?.toISOString(),
        updatedAt: event.audit?.updatedAt?.toISOString() ?? event.updatedAt?.toISOString()
      }
    };
  });
};

export const resolveAcademicYearRangeAccurate = (
  academicYearBs: string
): { fromDateBs: string; toDateBs: string } => {
  const startYear = parseInt(academicYearBs.split("/")[0] ?? "", 10);
  const year = Number.isFinite(startYear) && startYear > 2000 ? startYear : Number(getTodayBs().split("-")[0]);
  const lastDay = getDaysInBsMonth(year, 12);
  return {
    fromDateBs: `${year}-01-01`,
    toDateBs: `${year}-12-${String(lastDay).padStart(2, "0")}`
  };
};

export const inferAcademicYearFromDateBs = (dateBs: string): string => {
  const year = Number(dateBs.split("-")[0]);
  return `${year}/${year + 1}`;
};

/**
 * Events that overlap a BS date window.
 * Matches any stored event whose [start, end] intersects [from, to].
 */
export const buildEventFilter = (
  schoolId: Types.ObjectId,
  filters: AcademicCalendarFilters
): Record<string, unknown> => {
  const query: Record<string, unknown> = { schoolId };

  const andClauses: Record<string, unknown>[] = [];

  if (filters.status === "INACTIVE") {
    query.status = "INACTIVE";
  } else if (filters.status === "ACTIVE") {
    // Treat missing status (legacy docs) as ACTIVE
    andClauses.push({ $or: [{ status: "ACTIVE" }, { status: { $exists: false } }] });
  } else {
    // Default list shows active events only
    query.status = { $ne: "INACTIVE" };
  }

  let rangeStart: string | undefined;
  let rangeEnd: string | undefined;

  if (filters.academicYearBs) {
    const { fromDateBs, toDateBs } = resolveAcademicYearRangeAccurate(filters.academicYearBs);
    rangeStart = fromDateBs;
    rangeEnd = toDateBs;
  }

  if (filters.monthBs) {
    const [yearText, monthText] = filters.monthBs.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (year && month) {
      const days = getDaysInBsMonth(year, month);
      rangeStart = `${year}-${monthText}-01`;
      rangeEnd = `${year}-${monthText}-${String(days).padStart(2, "0")}`;
    }
  }

  if (filters.dateFromBs || filters.dateToBs) {
    rangeStart = filters.dateFromBs ?? rangeStart;
    rangeEnd = filters.dateToBs ?? rangeEnd;
  }

  if (rangeStart || rangeEnd) {
    // Overlap: event.start <= rangeEnd AND event.end >= rangeStart
    if (rangeEnd) {
      andClauses.push({
        $or: [
          { startDateBs: { $lte: rangeEnd } },
          { startDateBs: { $exists: false }, dateBs: { $lte: rangeEnd } }
        ]
      });
    }
    if (rangeStart) {
      andClauses.push({
        $or: [
          { endDateBs: { $gte: rangeStart } },
          { endDateBs: { $exists: false }, dateBs: { $gte: rangeStart } }
        ]
      });
    }
  }

  if (filters.dateAd) {
    andClauses.push({
      $or: [
        { startDateAd: filters.dateAd },
        { endDateAd: filters.dateAd },
        { dateAd: filters.dateAd }
      ]
    });
  }

  if (filters.eventType) {
    query.eventType = filters.eventType;
  }

  if (filters.keyword?.trim()) {
    // Escape metacharacters to prevent ReDoS / unintended regex matching
    const keyword = filters.keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    andClauses.push({
      $or: [
        { name: { $regex: keyword, $options: "i" } },
        { reason: { $regex: keyword, $options: "i" } },
        { dateBs: filters.keyword.trim() },
        { startDateBs: filters.keyword.trim() },
        { endDateBs: filters.keyword.trim() },
        { dateAd: filters.keyword.trim() }
      ]
    });
  }

  if (andClauses.length) {
    query.$and = andClauses;
  }

  return query;
};

/** Build a synthetic Saturday Public Holiday event (not persisted). */
export const buildSaturdayHolidayEvent = (
  schoolId: string,
  dateBs: string,
  academicYearBs?: string
): AcademicCalendarEventRecord => {
  const { dateAd, dayOfWeek } = bsToAdDate(dateBs);
  const year = academicYearBs ?? inferAcademicYearFromDateBs(dateBs);

  return {
    _id: `saturday-${dateBs}`,
    schoolId,
    academicYearBs: year,
    dateBs,
    startDateBs: dateBs,
    endDateBs: dateBs,
    dateAd,
    startDateAd: dateAd,
    endDateAd: dateAd,
    dayOfWeek,
    name: "Public Holiday",
    eventType: "PUBLIC_HOLIDAY",
    reason: "Weekly Saturday holiday",
    isHoliday: true,
    totalDays: 1,
    status: "ACTIVE",
    isSystemGenerated: true,
    isWorkingDayOverride: false
  };
};

/**
 * Generate Saturday public holidays for every Saturday in [fromBs, toBs],
 * excluding dates that have an explicit WORKING_DAY override.
 */
export const generateSaturdayHolidays = (
  schoolId: string,
  fromBs: string,
  toBs: string,
  workingDayOverrideDates: Set<string>,
  academicYearBs?: string
): AcademicCalendarEventRecord[] => {
  if (!fromBs || !toBs || compareBsDates(toBs, fromBs) < 0) return [];

  const saturdays: AcademicCalendarEventRecord[] = [];
  let current = fromBs;

  for (let i = 0; i < 450; i += 1) {
    const weekday = getDayOfWeekFromBs(current);
    if (weekday === 6 && !workingDayOverrideDates.has(current)) {
      saturdays.push(buildSaturdayHolidayEvent(schoolId, current, academicYearBs));
    }
    if (compareBsDates(current, toBs) >= 0) break;
    current = getOffsetFromBsDate(current, 1);
  }

  return saturdays;
};

const collectWorkingDayOverrides = (events: AcademicCalendarEventRecord[]): Set<string> => {
  const dates = new Set<string>();
  for (const event of events) {
    if (!event.isWorkingDayOverride && event.eventType !== "WORKING_DAY") continue;
    for (const day of expandBsDateRange(event.startDateBs, event.endDateBs)) {
      dates.add(day);
    }
  }
  return dates;
};

const resolveListRange = (
  filters: AcademicCalendarFilters
): { fromBs: string; toBs: string } | null => {
  if (filters.dateFromBs && filters.dateToBs) {
    return { fromBs: filters.dateFromBs, toBs: filters.dateToBs };
  }
  if (filters.monthBs) {
    const [yearText, monthText] = filters.monthBs.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (year && month) {
      const days = getDaysInBsMonth(year, month);
      return {
        fromBs: `${year}-${monthText}-01`,
        toBs: `${year}-${monthText}-${String(days).padStart(2, "0")}`
      };
    }
  }
  if (filters.academicYearBs) {
    const { fromDateBs, toDateBs } = resolveAcademicYearRangeAccurate(filters.academicYearBs);
    return { fromBs: fromDateBs, toBs: toDateBs };
  }
  return null;
};

export const listAcademicCalendarEvents = async (
  schoolId: Types.ObjectId,
  filters: AcademicCalendarFilters
): Promise<AcademicCalendarEventRecord[]> => {
  const events = await AcademicCalendarEvent.find(buildEventFilter(schoolId, filters))
    .sort({ startDateBs: 1, dateBs: 1, name: 1 })
    .lean<EventLean[]>();

  const enriched = await enrichEvents(events);

  if (filters.excludeSystemGenerated) {
    return sortEventsByDate(enriched);
  }

  const range = resolveListRange(filters);
  if (!range) {
    return sortEventsByDate(enriched);
  }

  const workingOverrides = collectWorkingDayOverrides(enriched);
  const saturdays = generateSaturdayHolidays(
    schoolId.toString(),
    range.fromBs,
    range.toBs,
    workingOverrides,
    filters.academicYearBs
  );

  // Filter Saturdays by eventType / keyword if those filters are set
  let filteredSaturdays = saturdays;
  if (filters.eventType && filters.eventType !== "PUBLIC_HOLIDAY") {
    filteredSaturdays = [];
  }
  if (filters.keyword?.trim()) {
    const keyword = filters.keyword.trim().toLowerCase();
    filteredSaturdays = filteredSaturdays.filter((event) => {
      const haystack = [event.name, event.reason ?? "", event.dateBs, "public holiday", "saturday"]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }

  return sortEventsByDate([...enriched, ...filteredSaturdays]);
};

/** Fetch a single stored event by id (never returns synthetic Saturdays). */
export const enrichEventById = async (
  schoolId: Types.ObjectId,
  eventId: string
): Promise<AcademicCalendarEventRecord | null> => {
  if (eventId.startsWith("saturday-")) {
    const dateBs = eventId.replace("saturday-", "");
    return buildSaturdayHolidayEvent(schoolId.toString(), dateBs);
  }

  const event = await AcademicCalendarEvent.findOne({ _id: eventId, schoolId }).lean<EventLean | null>();
  if (!event) return null;
  const [record] = await enrichEvents([event]);
  return record ?? null;
};

/** Institution's active academic year (School → Settings → year from today's BS date). */
export const resolveCurrentAcademicYear = async (schoolId: Types.ObjectId): Promise<string> => {
  const todayBs = getTodayBs();
  const [school, settings] = await Promise.all([
    School.findById(schoolId).select("academicYearBs").lean(),
    Setting.findOne({ schoolId }).select("academicYearBs").lean()
  ]);

  return school?.academicYearBs || settings?.academicYearBs || inferAcademicYearFromDateBs(todayBs);
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

  // Load a generous window of events (past week through next 90 days of BS)
  const windowStart = getOffsetFromBsDate(todayBs, -7);
  const windowEnd = getOffsetFromBsDate(todayBs, 90);

  const stored = await AcademicCalendarEvent.find({
    schoolId,
    status: { $ne: "INACTIVE" },
    $and: [
      {
        $or: [
          { startDateBs: { $lte: windowEnd } },
          { startDateBs: { $exists: false }, dateBs: { $lte: windowEnd } }
        ]
      },
      {
        $or: [
          { endDateBs: { $gte: windowStart } },
          { endDateBs: { $exists: false }, dateBs: { $gte: windowStart } }
        ]
      }
    ]
  })
    .sort({ startDateBs: 1, dateBs: 1 })
    .lean<EventLean[]>();

  const enriched = await enrichEvents(stored);
  const workingOverrides = collectWorkingDayOverrides(enriched);
  const saturdays = generateSaturdayHolidays(
    schoolId.toString(),
    windowStart,
    windowEnd,
    workingOverrides,
    resolvedYear
  );
  const all = sortEventsByDate([...enriched, ...saturdays]);

  const coversToday = (event: AcademicCalendarEventRecord) =>
    compareBsDates(event.startDateBs, todayBs) <= 0 && compareBsDates(event.endDateBs, todayBs) >= 0;

  const startsOnOrAfterToday = (event: AcademicCalendarEventRecord) =>
    compareBsDates(event.startDateBs, todayBs) >= 0;

  const todayEvents = all.filter(coversToday);
  const upcoming = all.filter(startsOnOrAfterToday);

  return {
    todayBs,
    todayAd,
    academicYearBs: resolvedYear,
    todayEvents: todayEvents.slice(0, 10),
    // Exclude automatic Saturday public holidays — they are fixed weekly days off,
    // not listed as "upcoming holidays". Real events/holidays on a Saturday still appear.
    upcomingHolidays: upcoming
      .filter(
        (event) =>
          !event.isSystemGenerated && HOLIDAY_EVENT_TYPES.includes(event.eventType)
      )
      .slice(0, 8),
    upcomingAcademicEvents: upcoming
      .filter((event) => ACADEMIC_EVENT_TYPES.includes(event.eventType))
      .slice(0, 5),
    upcomingExaminations: upcoming
      .filter((event) => EXAMINATION_EVENT_TYPES.includes(event.eventType))
      .slice(0, 5),
    activeMultiDayEvents: todayEvents.filter((event) => event.totalDays > 1).slice(0, 5)
  };
};

export const serializeCalendarEvent = (event: EventLean): AcademicCalendarEventRecord => {
  const dates = normalizeEventDates(event);
  const isWorkingDayOverride = Boolean(event.isWorkingDayOverride) || event.eventType === "WORKING_DAY";
  return {
    _id: event._id.toString(),
    schoolId: event.schoolId.toString(),
    academicYearBs: event.academicYearBs,
    dateBs: dates.dateBs,
    startDateBs: dates.startDateBs,
    endDateBs: dates.endDateBs,
    dateAd: dates.dateAd,
    startDateAd: dates.startDateAd,
    endDateAd: dates.endDateAd,
    dayOfWeek: dates.dayOfWeek,
    name: event.name,
    eventType: event.eventType,
    reason: event.reason,
    isHoliday: isWorkingDayOverride ? false : Boolean(event.isHoliday),
    totalDays: countBsDaysInclusive(dates.startDateBs, dates.endDateBs),
    status: event.status ?? "ACTIVE",
    isWorkingDayOverride
  };
};

export const resolveHolidayFlag = (eventType: AcademicCalendarEventType): boolean =>
  resolveIsHoliday(eventType);

export const sortEventsByDate = (events: AcademicCalendarEventRecord[]): AcademicCalendarEventRecord[] =>
  [...events].sort((left, right) => {
    const startCmp = compareBsDates(left.startDateBs, right.startDateBs);
    if (startCmp !== 0) return startCmp;
    return left.name.localeCompare(right.name);
  });

/**
 * Resolve whether a given BS date is a non-working day for attendance.
 * Priority:
 * 1. Explicit WORKING_DAY override → working
 * 2. Stored holiday/vacation event covering the date → holiday
 * 3. Saturday → automatic public holiday
 * 4. Legacy Setting.holidays entry → holiday
 */
export const resolveCalendarHolidayForDate = async (
  schoolId: Types.ObjectId | string,
  dateBs: string
): Promise<{ title: string; dateBs: string; source: "calendar" | "saturday" | "settings" } | null> => {
  const { Types: MongooseTypes } = await import("mongoose");
  const oid =
    typeof schoolId === "string" ? new MongooseTypes.ObjectId(schoolId) : schoolId;

  const covering = await AcademicCalendarEvent.find({
    schoolId: oid,
    status: { $ne: "INACTIVE" },
    $and: [
      {
        $or: [
          { startDateBs: { $lte: dateBs } },
          { startDateBs: { $exists: false }, dateBs: { $lte: dateBs } }
        ]
      },
      {
        $or: [
          { endDateBs: { $gte: dateBs } },
          { endDateBs: { $exists: false }, dateBs: { $gte: dateBs } }
        ]
      }
    ]
  })
    .lean<EventLean[]>();

  const hasWorkingDay = covering.some(
    (event) => event.eventType === "WORKING_DAY" || event.isWorkingDayOverride
  );
  if (hasWorkingDay) {
    return null;
  }

  const holidayEvent = covering.find((event) => {
    if (event.eventType === "WORKING_DAY" || event.isWorkingDayOverride) return false;
    return event.isHoliday || resolveIsHoliday(event.eventType);
  });

  if (holidayEvent) {
    return { title: holidayEvent.name, dateBs, source: "calendar" };
  }

  // Automatic Saturday public holiday
  if (getDayOfWeekFromBs(dateBs) === 6) {
    return { title: "Public Holiday", dateBs, source: "saturday" };
  }

  // Legacy settings holidays
  const settings = await Setting.findOne({ schoolId: oid }).select("holidays").lean();
  const legacy = settings?.holidays?.find((item) => item.dateBs === dateBs);
  if (legacy) {
    return { title: legacy.title, dateBs, source: "settings" };
  }

  return null;
};

export const prepareEventDateFields = (startDateBs: string, endDateBs: string) => {
  const start = bsToAdDate(startDateBs);
  const end = bsToAdDate(endDateBs);
  return {
    dateBs: startDateBs,
    startDateBs,
    endDateBs,
    dateAd: start.dateAd,
    startDateAd: start.dateAd,
    endDateAd: end.dateAd,
    dayOfWeek: start.dayOfWeek
  };
};

export { WEEKDAY_NAMES };
