import type { CSSProperties } from "react";
import {
  ACADEMIC_CALENDAR_EVENT_TYPE_COLORS,
  ACADEMIC_CALENDAR_EVENT_TYPE_LABELS,
  ACADEMIC_CALENDAR_LEGEND_GROUPS,
  BS_MONTH_NAMES,
  PRIMARY_ACADEMIC_CALENDAR_EVENT_TYPES,
  parseAcademicYearStart,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord,
  type AcademicCalendarEventType,
  type AcademicCalendarFilters,
} from "@phit-erp/shared";
import {
  bsToAd,
  getDaysInBsMonth,
  getTodayBs,
} from "@munatech/nepali-datepicker";
import * as XLSX from "xlsx";

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const defaultCalendarFilters = (): AcademicCalendarFilters => ({
  academicYearBs: "",
  monthBs: "",
  eventType: undefined,
  keyword: "",
  dateFromBs: "",
  dateToBs: "",
  dateAd: "",
  status: undefined,
  excludeSystemGenerated: undefined,
});

export const filtersToParams = (
  filters: AcademicCalendarFilters,
): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params[key] = String(value);
    }
  });
  return params;
};

export const formatBsDateLabel = (dateBs: string): string => dateBs;

export const bsToAdString = (dateBs: string): string => {
  const [year, month, day] = dateBs.split("-").map(Number);
  if (!year || !month || !day) return "";
  const ad = bsToAd(year, month, day);
  return `${ad.year}-${String(ad.month).padStart(2, "0")}-${String(ad.day).padStart(2, "0")}`;
};

export const getWeekdayFromBs = (dateBs: string): string => {
  const [year, month, day] = dateBs.split("-").map(Number);
  if (!year || !month || !day) return "";
  const ad = bsToAd(year, month, day);
  const date = new Date(ad.year, ad.month - 1, ad.day);
  return (
    [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][date.getDay()] ?? ""
  );
};

export const isSaturdayBs = (dateBs: string): boolean => {
  const [year, month, day] = dateBs.split("-").map(Number);
  if (!year || !month || !day) return false;
  const ad = bsToAd(year, month, day);
  const date = new Date(ad.year, ad.month - 1, ad.day);
  return date.getDay() === 6;
};

export const getFirstWeekdayIndex = (year: number, month: number): number => {
  const ad = bsToAd(year, month, 1);
  const date = new Date(ad.year, ad.month - 1, ad.day);
  return date.getDay();
};

export const buildMonthGrid = (
  year: number,
  month: number,
): Array<number | null> => {
  const daysInMonth = getDaysInBsMonth(year, month);
  const firstWeekday = getFirstWeekdayIndex(year, month);
  const cells: Array<number | null> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
};

export const formatMonthKey = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

const AD_MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** English short month name (1–12). */
export const getAdMonthAbbrev = (adMonth: number): string =>
  AD_MONTH_ABBREV[adMonth - 1] ?? "";

/**
 * AD month span for a BS month, e.g. Baisakh → "Apr/May".
 * Uses first and last day of the BS month.
 */
export const getBsMonthAdRangeLabel = (year: number, month: number): string => {
  try {
    const daysInMonth = getDaysInBsMonth(year, month);
    const first = bsToAd(year, month, 1);
    const last = bsToAd(year, month, daysInMonth);
    const a = getAdMonthAbbrev(first.month);
    const b = getAdMonthAbbrev(last.month);
    if (!a || !b) return "";
    return a === b ? a : `${a}/${b}`;
  } catch {
    return "";
  }
};

/** AD calendar day for a BS date (day of month only), for cell corner display. */
export const getAdDayParts = (
  dateBs: string,
): { day: number; month: number; year: number; label: string } | null => {
  const [year, month, day] = dateBs.split("-").map(Number);
  if (!year || !month || !day) return null;
  try {
    const ad = bsToAd(year, month, day);
    return {
      day: ad.day,
      month: ad.month,
      year: ad.year,
      /** Small corner label: AD day number only (no month) */
      label: String(ad.day),
    };
  } catch {
    return null;
  }
};

/**
 * Unique events that touch any day of a given BS month (for the list under each month).
 * Sorted by start date, then name.
 */
export const listEventsForBsMonth = (
  eventsByDate: Map<string, AcademicCalendarEventRecord[]>,
  year: number,
  month: number,
): AcademicCalendarEventRecord[] => {
  const prefix = formatMonthKey(year, month);
  const byId = new Map<string, AcademicCalendarEventRecord>();

  eventsByDate.forEach((dayEvents, dateBs) => {
    if (!dateBs.startsWith(prefix)) return;
    dayEvents.forEach((event) => {
      if (!byId.has(event._id)) {
        byId.set(event._id, event);
      }
    });
  });

  return [...byId.values()].sort((a, b) => {
    const sa = a.startDateBs || a.dateBs;
    const sb = b.startDateBs || b.dateBs;
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.localeCompare(b.name);
  });
};

/** Saturday BS dates in a month that have no stored event (auto public holidays). */
export const listAutoSaturdayDatesInMonth = (
  year: number,
  month: number,
  eventsByDate: Map<string, AcademicCalendarEventRecord[]>,
): string[] => {
  const daysInMonth = getDaysInBsMonth(year, month);
  const saturdays: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateBs = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isSaturdayBs(dateBs)) continue;
    const dayEvents = eventsByDate.get(dateBs) ?? [];
    // Already covered by a holiday/event entry
    if (dayEvents.some((e) => e.isHoliday || e.isSystemGenerated)) continue;
    saturdays.push(dateBs);
  }
  return saturdays;
};

export const buildAcademicYearMonths = (
  academicYearBs: string,
): Array<{ year: number; month: number; name: string; adRangeLabel: string }> => {
  const startYear = parseAcademicYearStart(academicYearBs);
  return BS_MONTH_NAMES.map((name, index) => {
    const month = index + 1;
    return {
      year: startYear,
      month,
      name,
      adRangeLabel: getBsMonthAdRangeLabel(startYear, month),
    };
  });
};

export const inferDefaultAcademicYear = (): string => {
  const today = getTodayBs();
  const year = today.year;
  return `${year}/${year + 1}`;
};

/**
 * Prefer the institution's active academic year, then the year containing today's BS date,
 * then the first available year in the list.
 */
export const resolvePreferredAcademicYear = (
  years: string[] | undefined,
  schoolAcademicYearBs?: string | null,
): string => {
  const inferred = inferDefaultAcademicYear();
  const list = years ?? [];

  if (
    schoolAcademicYearBs &&
    (list.length === 0 || list.includes(schoolAcademicYearBs))
  ) {
    return schoolAcademicYearBs;
  }
  if (list.includes(inferred)) {
    return inferred;
  }
  const matching = list.find((year) =>
    year.startsWith(`${inferred.split("/")[0]}/`),
  );
  if (matching) return matching;

  return list[0] ?? schoolAcademicYearBs ?? inferred;
};

export const getEventTypeLabel = (
  eventType: AcademicCalendarEventType,
): string => ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[eventType];

export const getEventTypeColor = (
  eventType: AcademicCalendarEventType,
): string => ACADEMIC_CALENDAR_EVENT_TYPE_COLORS[eventType];

export const eventCoversDate = (
  event: AcademicCalendarEventRecord,
  dateBs: string,
): boolean => {
  const start = event.startDateBs || event.dateBs;
  const end = event.endDateBs || event.dateBs;
  return dateBs >= start && dateBs <= end;
};

/** Prefer holidays, then exams, then other events for cell coloring. */
export const pickPrimaryEvent = (
  events: AcademicCalendarEventRecord[],
): AcademicCalendarEventRecord | undefined => {
  if (events.length === 0) return undefined;
  const holiday = events.find((event) => event.isHoliday);
  if (holiday) return holiday;
  const override = events.find((event) => event.isWorkingDayOverride);
  if (override) return override;
  return events[0];
};

export const getDateCellClass = (
  event: AcademicCalendarEventRecord | undefined,
  isToday: boolean,
  isSaturday = false,
): string => {
  if (!event) {
    if (isSaturday) {
      return isToday
        ? "bg-gradient-to-b from-rose-100 to-rose-50 text-rose-800 ring-2 ring-brand-500/70"
        : "bg-gradient-to-b from-rose-50 to-rose-50/70 text-rose-700 hover:from-rose-100 hover:to-rose-50";
    }
    return isToday
      ? "bg-gradient-to-b from-brand-100 to-brand-50 text-brand-900 ring-2 ring-brand-500/70"
      : "";
  }
  if (event.isWorkingDayOverride) {
    return isToday
      ? "bg-gradient-to-b from-emerald-100 to-emerald-50 text-emerald-900 ring-2 ring-brand-500/70"
      : "bg-gradient-to-b from-emerald-50 to-white text-emerald-800 hover:from-emerald-100";
  }
  if (event.isHoliday) {
    return "bg-gradient-to-b from-rose-100 to-rose-50 text-rose-800 hover:from-rose-200 hover:to-rose-100";
  }
  return isToday ? "ring-2 ring-brand-500/70" : "hover:brightness-[0.98]";
};

export const getDateCellStyle = (
  event: AcademicCalendarEventRecord | undefined,
): CSSProperties | undefined => {
  if (!event || event.isHoliday || event.isWorkingDayOverride) return undefined;
  return {
    backgroundColor: `${getEventTypeColor(event.eventType)}22`,
    color: "#0f172a",
  };
};

export const buildDefaultEventInput = (
  academicYearBs: string,
  dateBs = "",
): AcademicCalendarEventInput => ({
  academicYearBs,
  startDateBs: dateBs,
  endDateBs: dateBs,
  dateBs,
  name: "",
  eventType: "PUBLIC_HOLIDAY",
  reason: "",
  status: "ACTIVE",
});

export const exportEventsExcel = (
  events: AcademicCalendarEventRecord[],
  filename: string,
) => {
  const rows = events.map((event) => ({
    "Event Name": event.name,
    Category: getEventTypeLabel(event.eventType),
    "Start Date (BS)": event.startDateBs || event.dateBs,
    "End Date (BS)": event.endDateBs || event.dateBs,
    "Total Days": event.totalDays ?? 1,
    Description: event.reason ?? "",
    "Created By": event.audit?.createdByName ?? "",
    Status: event.status ?? "ACTIVE",
    "AD Start": event.startDateAd || event.dateAd,
    "AD End": event.endDateAd || event.dateAd,
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Calendar Events");
  XLSX.writeFile(workbook, filename);
};

/** Primary categories for the create/edit form. */
export const eventTypeOptions = PRIMARY_ACADEMIC_CALENDAR_EVENT_TYPES.map(
  (eventType) => ({
    value: eventType,
    label: getEventTypeLabel(eventType),
    color: getEventTypeColor(eventType),
  }),
);

/** Compact legend for the calendar footer. */
export const legendGroups = ACADEMIC_CALENDAR_LEGEND_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  color: group.color,
}));

/**
 * Map each BS date to events covering that day (supports multi-day ranges).
 */
export const groupEventsByDate = (
  events: AcademicCalendarEventRecord[],
): Map<string, AcademicCalendarEventRecord[]> => {
  const map = new Map<string, AcademicCalendarEventRecord[]>();

  events.forEach((event) => {
    const start = event.startDateBs || event.dateBs;
    const end = event.endDateBs || event.dateBs;

    // Walk AD-based offsets via string compare — dates are ISO-like YYYY-MM-DD
    // For multi-day, expand using known month lengths on the client.
    const days = expandBsRangeClient(start, end);
    days.forEach((dateBs) => {
      const existing = map.get(dateBs) ?? [];
      // Avoid duplicate entries for the same event id
      if (!existing.some((item) => item._id === event._id)) {
        existing.push(event);
      }
      map.set(dateBs, existing);
    });
  });

  return map;
};

/**
 * Expand a BS range for calendar display.
 * Uses nepali-datepicker month lengths when possible; falls back to day-by-day AD walk.
 */
export const expandBsRangeClient = (
  startDateBs: string,
  endDateBs: string,
): string[] => {
  if (!startDateBs) return [];
  if (!endDateBs || endDateBs === startDateBs) return [startDateBs];
  if (endDateBs < startDateBs) return [startDateBs];

  const dates: string[] = [];
  let [y, m, d] = startDateBs.split("-").map(Number);
  if (!y || !m || !d) return [startDateBs];

  for (let i = 0; i < 450; i += 1) {
    const current = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dates.push(current);
    if (current >= endDateBs) break;

    const daysInMonth = getDaysInBsMonth(y, m);
    d += 1;
    if (d > daysInMonth) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  return dates;
};

export const filterEventsLocally = (
  events: AcademicCalendarEventRecord[],
  filters: AcademicCalendarFilters,
): AcademicCalendarEventRecord[] => {
  const keyword = filters.keyword?.trim().toLowerCase();
  return events.filter((event) => {
    if (filters.eventType && event.eventType !== filters.eventType)
      return false;
    if (filters.status && event.status !== filters.status) return false;
    if (filters.monthBs) {
      const start = event.startDateBs || event.dateBs;
      const end = event.endDateBs || event.dateBs;
      const monthStart = `${filters.monthBs}-01`;
      const monthEnd = `${filters.monthBs}-32`;
      // Overlap with month
      if (end < monthStart || start > monthEnd) return false;
    }
    if (filters.dateAd && event.dateAd !== filters.dateAd && event.startDateAd !== filters.dateAd)
      return false;
    if (keyword) {
      const haystack = [
        event.dateBs,
        event.startDateBs,
        event.endDateBs,
        event.dateAd,
        event.name,
        getEventTypeLabel(event.eventType),
        event.reason ?? "",
        event.audit?.createdByName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
};

/** Stored events only (exclude auto Saturday holidays) for the admin event table. */
export const storedEventsOnly = (
  events: AcademicCalendarEventRecord[],
): AcademicCalendarEventRecord[] =>
  events.filter((event) => !event.isSystemGenerated);
