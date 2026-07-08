import type { CSSProperties } from "react";
import {
  ACADEMIC_CALENDAR_EVENT_TYPE_COLORS,
  ACADEMIC_CALENDAR_EVENT_TYPE_LABELS,
  ACADEMIC_CALENDAR_EVENT_TYPES,
  BS_MONTH_NAMES,
  parseAcademicYearStart,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord,
  type AcademicCalendarEventType,
  type AcademicCalendarFilters
} from "@phit-erp/shared";
import { bsToAd, getDaysInBsMonth, getTodayBs } from "@munatech/nepali-datepicker";
import * as XLSX from "xlsx";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const defaultCalendarFilters = (): AcademicCalendarFilters => ({
  academicYearBs: "",
  monthBs: "",
  eventType: undefined,
  keyword: "",
  dateFromBs: "",
  dateToBs: "",
  dateAd: ""
});

export const filtersToParams = (filters: AcademicCalendarFilters): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = String(value);
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
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()] ?? "";
};

export const getFirstWeekdayIndex = (year: number, month: number): number => {
  const ad = bsToAd(year, month, 1);
  const date = new Date(ad.year, ad.month - 1, ad.day);
  return date.getDay();
};

export const buildMonthGrid = (year: number, month: number): Array<number | null> => {
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

export const buildAcademicYearMonths = (academicYearBs: string): Array<{ year: number; month: number; name: string }> => {
  const startYear = parseAcademicYearStart(academicYearBs);
  return BS_MONTH_NAMES.map((name, index) => ({
    year: startYear,
    month: index + 1,
    name
  }));
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
  schoolAcademicYearBs?: string | null
): string => {
  const inferred = inferDefaultAcademicYear();
  const list = years ?? [];

  if (schoolAcademicYearBs && (list.length === 0 || list.includes(schoolAcademicYearBs))) {
    return schoolAcademicYearBs;
  }
  if (list.includes(inferred)) {
    return inferred;
  }
  // Year that matches today's BS calendar year (e.g. 2083/2084 when today is 2083-…)
  const matching = list.find((year) => year.startsWith(`${inferred.split("/")[0]}/`));
  if (matching) return matching;

  return list[0] ?? schoolAcademicYearBs ?? inferred;
};

export const getEventTypeLabel = (eventType: AcademicCalendarEventType): string =>
  ACADEMIC_CALENDAR_EVENT_TYPE_LABELS[eventType];

export const getEventTypeColor = (eventType: AcademicCalendarEventType): string =>
  ACADEMIC_CALENDAR_EVENT_TYPE_COLORS[eventType];

export const getDateCellClass = (event: AcademicCalendarEventRecord | undefined, isToday: boolean): string => {
  if (!event) {
    return isToday ? "ring-2 ring-brand-500 bg-brand-50" : "hover:bg-slate-50";
  }
  if (event.isHoliday) {
    return "bg-red-100 text-red-800 hover:bg-red-200";
  }
  return isToday ? "ring-2 ring-brand-500" : "hover:opacity-90";
};

export const getDateCellStyle = (event: AcademicCalendarEventRecord | undefined): CSSProperties | undefined => {
  if (!event || event.isHoliday) return undefined;
  return { backgroundColor: `${getEventTypeColor(event.eventType)}22`, color: "#0f172a" };
};

export const buildDefaultEventInput = (academicYearBs: string, dateBs = ""): AcademicCalendarEventInput => ({
  academicYearBs,
  dateBs,
  name: "",
  eventType: "ACADEMIC_EVENT",
  reason: ""
});

export const exportEventsExcel = (events: AcademicCalendarEventRecord[], filename: string) => {
  const rows = events.map((event) => ({
    "BS Date": event.dateBs,
    "AD Date": event.dateAd,
    Day: event.dayOfWeek,
    "Holiday/Event": event.name,
    Type: getEventTypeLabel(event.eventType),
    Reason: event.reason ?? ""
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Calendar Events");
  XLSX.writeFile(workbook, filename);
};

export const eventTypeOptions = ACADEMIC_CALENDAR_EVENT_TYPES.map((eventType) => ({
  value: eventType,
  label: getEventTypeLabel(eventType),
  color: getEventTypeColor(eventType)
}));

export const groupEventsByDate = (events: AcademicCalendarEventRecord[]): Map<string, AcademicCalendarEventRecord[]> => {
  const map = new Map<string, AcademicCalendarEventRecord[]>();
  events.forEach((event) => {
    const existing = map.get(event.dateBs) ?? [];
    existing.push(event);
    map.set(event.dateBs, existing);
  });
  return map;
};

export const filterEventsLocally = (
  events: AcademicCalendarEventRecord[],
  filters: AcademicCalendarFilters
): AcademicCalendarEventRecord[] => {
  const keyword = filters.keyword?.trim().toLowerCase();
  return events.filter((event) => {
    if (filters.eventType && event.eventType !== filters.eventType) return false;
    if (filters.monthBs && !event.dateBs.startsWith(filters.monthBs)) return false;
    if (filters.dateAd && event.dateAd !== filters.dateAd) return false;
    if (keyword) {
      const haystack = [
        event.dateBs,
        event.dateAd,
        event.name,
        getEventTypeLabel(event.eventType),
        event.reason ?? ""
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
};