import NepaliDateImport from "nepali-date-converter";
import type { AssignmentDeadlineStatus } from "@nepal-school-erp/shared";
import { getNepalGrade } from "@nepal-school-erp/shared";
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

export const getTodayBs = (): string => formatBsDate(new NepaliDate(new Date()));

export const getOffsetBsDate = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return formatBsDate(new NepaliDate(date));
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

export const getDeadlineStatus = (dueDateBs: string | undefined, todayBs: string): AssignmentDeadlineStatus | null => {
  if (!dueDateBs) return null;
  const cmp = compareBsDates(dueDateBs, todayBs);
  if (cmp < 0) return "OVERDUE";
  if (cmp === 0) return "DUE_TODAY";
  return "UPCOMING";
};

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

export const calculateResultGrade = (obtained: number, total: number): { percentage: number; gpa: number; grade: string } => {
  const percentage = total === 0 ? 0 : Number(((obtained / total) * 100).toFixed(2));
  const { grade, gpa } = getNepalGrade(percentage);

  return { percentage, gpa, grade };
};
