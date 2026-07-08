import {
  adToBs,
  bsToAd,
  formatBsDate,
  getDaysInBsMonth,
  getTodayBs,
  parseBsDate,
  type NepaliDate
} from "@munatech/nepali-datepicker";

export type AttendanceExportPeriod = "weekly" | "monthly" | "yearly" | "custom";

export interface AttendancePeriodSelection {
  period: AttendanceExportPeriod;
  monthBs: string;
  yearBs: string;
  weekReferenceBs: string;
  fromDateBs: string;
  toDateBs: string;
}

export interface AttendanceDateRange {
  fromDateBs: string;
  toDateBs: string;
  monthBs?: string;
}

const formatBs = (date: NepaliDate): string => formatBsDate(date, "YYYY-MM-DD");

const bsToJsDate = (date: NepaliDate): Date => {
  const ad = bsToAd(date.year, date.month, date.day);
  return new Date(ad.year, ad.month - 1, ad.day);
};

const jsDateToBs = (date: Date): NepaliDate =>
  adToBs(date.getFullYear(), date.getMonth() + 1, date.getDate());

const getWeekRange = (reference: NepaliDate): { from: NepaliDate; to: NepaliDate } => {
  const date = bsToJsDate(reference);
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  return { from: jsDateToBs(sunday), to: jsDateToBs(saturday) };
};

export const createDefaultAttendancePeriod = (): AttendancePeriodSelection => {
  const today = getTodayBs();
  const monthBs = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const todayStr = formatBs(today);

  return {
    period: "monthly",
    monthBs,
    yearBs: String(today.year),
    weekReferenceBs: todayStr,
    fromDateBs: todayStr,
    toDateBs: todayStr
  };
};

export const resolveAttendancePeriodRange = (selection: AttendancePeriodSelection): AttendanceDateRange => {
  switch (selection.period) {
    case "weekly": {
      const reference = parseBsDate(selection.weekReferenceBs) ?? getTodayBs();
      const { from, to } = getWeekRange(reference);
      return { fromDateBs: formatBs(from), toDateBs: formatBs(to) };
    }
    case "monthly": {
      const fallback = getTodayBs();
      const monthBs =
        selection.monthBs.trim() || `${fallback.year}-${String(fallback.month).padStart(2, "0")}`;
      const [yearText, monthText] = monthBs.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      if (!year || !month || month < 1 || month > 12) {
        throw new Error("Enter a valid month in YYYY-MM format.");
      }
      return {
        fromDateBs: formatBs({ year, month, day: 1 }),
        toDateBs: formatBs({ year, month, day: getDaysInBsMonth(year, month) }),
        monthBs
      };
    }
    case "yearly": {
      const year = Number(selection.yearBs) || getTodayBs().year;
      return {
        fromDateBs: formatBs({ year, month: 1, day: 1 }),
        toDateBs: formatBs({ year, month: 12, day: getDaysInBsMonth(year, 12) })
      };
    }
    case "custom": {
      const fromDateBs = selection.fromDateBs.trim();
      const toDateBs = (selection.toDateBs.trim() || fromDateBs).trim();
      if (!fromDateBs || !toDateBs) {
        throw new Error("Select both start and end dates for a custom range.");
      }
      if (!parseBsDate(fromDateBs) || !parseBsDate(toDateBs)) {
        throw new Error("Custom dates must be valid BS dates (YYYY-MM-DD).");
      }
      if (fromDateBs > toDateBs) {
        throw new Error("Start date must be on or before the end date.");
      }
      return { fromDateBs, toDateBs };
    }
    default:
      return resolveAttendancePeriodRange({ ...selection, period: "monthly" });
  }
};

export const buildAttendanceQueryParams = (selection: AttendancePeriodSelection): Record<string, string> => {
  const range = resolveAttendancePeriodRange(selection);
  return {
    fromDateBs: range.fromDateBs,
    toDateBs: range.toDateBs
  };
};

export const getAttendancePeriodLabel = (selection: AttendancePeriodSelection): string => {
  const range = resolveAttendancePeriodRange(selection);
  switch (selection.period) {
    case "weekly":
      return `week_${range.fromDateBs}_to_${range.toDateBs}`;
    case "monthly":
      return range.monthBs ?? `month_${range.fromDateBs}`;
    case "yearly":
      return `year_${selection.yearBs || getTodayBs().year}`;
    case "custom":
      return `${range.fromDateBs}_to_${range.toDateBs}`;
    default:
      return "attendance";
  }
};