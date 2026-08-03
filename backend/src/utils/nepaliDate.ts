import NepaliDateImport from "nepali-date-converter";
import type { AssignmentDeadlineStatus } from "@phit-erp/shared";
import { getNepalGrade } from "@phit-erp/shared";
import { ApiError } from "./apiError.js";

type NepaliDateInstance = {
  getYear(): number;
  getMonth(): number;
  getDate(): number;
};

type NepaliDateConstructor = new (value?: string | number | Date) => NepaliDateInstance & {
  getYear(): number;
  getMonth(): number;
  getDate(): number;
};

const NepaliDate = ((NepaliDateImport as { default?: NepaliDateConstructor }).default ?? NepaliDateImport) as NepaliDateConstructor;

const formatBsDate = (date: NepaliDateInstance): string =>
  `${date.getYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Nepal (NPT) is UTC+5:45. */
const NEPAL_TIMEZONE_OFFSET_MINUTES = 345;

/**
 * Nepal wall-clock AD calendar day as a local Date at noon.
 * Uses UTC epoch + NPT offset, then UTC Y/M/D so result is independent of server TZ.
 * (nepali-date-converter reads getFullYear/getMonth/getDate of the Date.)
 */
export const getNepalTodayAdDate = (): Date => {
  const nepalNow = new Date(Date.now() + NEPAL_TIMEZONE_OFFSET_MINUTES * 60_000);
  return new Date(nepalNow.getUTCFullYear(), nepalNow.getUTCMonth(), nepalNow.getUTCDate(), 12, 0, 0);
};

/**
 * Today's BS date in Nepal timezone (not server local TZ).
 * Critical for attendance "current working day" checks on UTC hosts.
 */
export const getTodayBs = (): string => formatBsDate(new NepaliDate(getNepalTodayAdDate()));

/** Offset from Nepal "today" (or a provided AD base) by N days, returned as BS. */
export const getOffsetBsDate = (offsetDays: number, fromAd: Date = getNepalTodayAdDate()): string => {
  const date = new Date(fromAd);
  date.setDate(date.getDate() + offsetDays);
  return formatBsDate(new NepaliDate(date));
};

/** Offset a BS date (YYYY-MM-DD) by N calendar days, returned as BS. */
export const getOffsetFromBsDate = (dateBs: string, offsetDays: number): string => {
  const { dateAd } = bsToAdDate(dateBs);
  const [y, m, d] = dateAd.split("-").map(Number);
  const ad = new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  ad.setDate(ad.getDate() + offsetDays);
  return formatBsDate(new NepaliDate(ad));
};

export const compareBsDates = (left: string, right: string): number => {
  const leftParts = left.split("-").map(Number);
  const rightParts = right.split("-").map(Number);
  const ly = leftParts[0] ?? 0;
  const lm = leftParts[1] ?? 0;
  const ld = leftParts[2] ?? 0;
  const ry = rightParts[0] ?? 0;
  const rm = rightParts[1] ?? 0;
  const rd = rightParts[2] ?? 0;
  if (ly !== ry) return ly < ry ? -1 : 1;
  if (lm !== rm) return lm < rm ? -1 : 1;
  if (ld !== rd) return ld < rd ? -1 : 1;
  return 0;
};

/**
 * Inclusive calendar-day count between two BS dates (YYYY-MM-DD).
 * Same day → 1. End before start throws.
 */
export const countInclusiveBsDays = (startBs: string, endBs: string): number => {
  const startAd = bsToAdDate(startBs).dateAd;
  const endAd = bsToAdDate(endBs).dateAd;
  const [sy, sm, sd] = startAd.split("-").map(Number);
  const [ey, em, ed] = endAd.split("-").map(Number);
  const startMs = Date.UTC(sy!, (sm ?? 1) - 1, sd ?? 1);
  const endMs = Date.UTC(ey!, (em ?? 1) - 1, ed ?? 1);
  if (endMs < startMs) {
    throw new ApiError(400, "End date must be on or after start date");
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
};

export const getDeadlineStatus = (dueDateBs: string | undefined, todayBs: string): AssignmentDeadlineStatus | null => {
  if (!dueDateBs) return null;
  const cmp = compareBsDates(dueDateBs, todayBs);
  if (cmp < 0) return "OVERDUE";
  if (cmp === 0) return "DUE_TODAY";
  return "UPCOMING";
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const formatAdDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const ensureValidBsDate = (dateBs: string): string => {
  const [year, month, day] = dateBs.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    throw new ApiError(400, `Invalid BS date: ${dateBs}`);
  }

  try {
    const NepaliDateBs = NepaliDate as NepaliDateConstructor & {
      new (year: number, monthIndex: number, date: number): NepaliDateInstance;
    };
    const date = new NepaliDateBs(year, month - 1, day);
    const formatted = formatBsDate(date);

    if (formatted !== dateBs) {
      throw new Error("Invalid BS date");
    }

    return formatted;
  } catch (error) {
    throw new ApiError(400, `Invalid BS date: ${dateBs}`);
  }
};

export const getDaysInBsMonth = (year: number, month: number): number => {
  const NepaliDateBs = NepaliDate as NepaliDateConstructor & {
    new (year: number, monthIndex: number, date: number): NepaliDateInstance;
  };

  for (let day = 32; day >= 28; day -= 1) {
    try {
      const date = new NepaliDateBs(year, month - 1, day);
      const formatted = formatBsDate(date);
      const [, monthValue, dayValue] = formatted.split("-").map(Number);
      if (monthValue === month && dayValue === day) {
        return day;
      }
    } catch {
      continue;
    }
  }

  return 30;
};

export const bsToAdDate = (dateBs: string): { dateAd: string; dayOfWeek: string } => {
  const validated = ensureValidBsDate(dateBs);
  const [year, month, day] = validated.split("-").map(Number);
  const NepaliDateBs = NepaliDate as NepaliDateConstructor & {
    new (year: number, monthIndex: number, date: number): NepaliDateInstance & { toJsDate(): Date };
  };
  const jsDate = new NepaliDateBs(year!, month! - 1, day!).toJsDate();
  return {
    dateAd: formatAdDate(jsDate),
    dayOfWeek: WEEKDAY_NAMES[jsDate.getDay()] ?? "Sunday"
  };
};

/** Validate Gregorian (AD) calendar date as YYYY-MM-DD. */
export const ensureValidAdDate = (dateAd: string): string => {
  const trimmed = dateAd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, `Invalid AD date: ${dateAd}`);
  }
  const [year, month, day] = trimmed.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new ApiError(400, `Invalid AD date: ${dateAd}`);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ApiError(400, `Invalid AD date: ${dateAd}`);
  }
  const jsDate = new Date(year, month - 1, day, 12, 0, 0);
  if (
    jsDate.getFullYear() !== year ||
    jsDate.getMonth() !== month - 1 ||
    jsDate.getDate() !== day
  ) {
    throw new ApiError(400, `Invalid AD date: ${dateAd}`);
  }
  return formatAdDate(jsDate);
};

/** Convert Gregorian (AD) YYYY-MM-DD to Bikram Sambat (BS) YYYY-MM-DD. */
export const adToBsDate = (dateAd: string): { dateBs: string; dayOfWeek: string } => {
  const validated = ensureValidAdDate(dateAd);
  const [year, month, day] = validated.split("-").map(Number);
  const jsDate = new Date(year!, (month ?? 1) - 1, day ?? 1, 12, 0, 0);
  const bs = new NepaliDate(jsDate);
  return {
    dateBs: formatBsDate(bs),
    dayOfWeek: WEEKDAY_NAMES[jsDate.getDay()] ?? "Sunday"
  };
};

/**
 * Resolve a pair of AD/BS dates from either calendar.
 * Prefer the calendar that was explicitly provided; convert the other.
 */
export const resolveAdBsDatePair = (input: {
  dateBs?: string;
  dateAd?: string;
}): { dateBs: string; dateAd: string } => {
  const dateBs = input.dateBs?.trim() || "";
  const dateAd = input.dateAd?.trim() || "";
  if (dateBs && dateAd) {
    const bs = ensureValidBsDate(dateBs);
    const ad = ensureValidAdDate(dateAd);
    // Trust BS as source of truth when both provided (fiscal/Nepal calendar primary)
    const fromBs = bsToAdDate(bs).dateAd;
    return { dateBs: bs, dateAd: fromBs || ad };
  }
  if (dateBs) {
    const bs = ensureValidBsDate(dateBs);
    return { dateBs: bs, dateAd: bsToAdDate(bs).dateAd };
  }
  if (dateAd) {
    const ad = ensureValidAdDate(dateAd);
    return { dateBs: adToBsDate(ad).dateBs, dateAd: ad };
  }
  throw new ApiError(400, "Payment date (BS or AD) is required");
};

/** JS weekday (0=Sunday … 6=Saturday) for a BS calendar date. */
export const getDayOfWeekFromBs = (dateBs: string): number => {
  const validated = ensureValidBsDate(dateBs);
  const [year, month, day] = validated.split("-").map(Number);
  const NepaliDateBs = NepaliDate as NepaliDateConstructor & {
    new (year: number, monthIndex: number, date: number): NepaliDateInstance & { toJsDate(): Date };
  };
  return new NepaliDateBs(year!, month! - 1, day!).toJsDate().getDay();
};

export const calculateResultGrade = (obtained: number, total: number): { percentage: number; gpa: number; grade: string } => {
  const percentage = total === 0 ? 0 : Number(((obtained / total) * 100).toFixed(2));
  const { grade, gpa } = getNepalGrade(percentage);

  return { percentage, gpa, grade };
};
