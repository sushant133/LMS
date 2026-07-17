import type { TimetableSessionType } from "@phit-erp/shared";

/** Background / text styles for timetable session kinds (Nepali college print friendly). */
export const SESSION_COLORS: Record<
  TimetableSessionType | "EMPTY" | "HOLIDAY_ROW",
  { bg: string; border: string; text: string; badge: string }
> = {
  THEORY: {
    bg: "bg-sky-50",
    border: "border-sky-200",
    text: "text-sky-950",
    badge: "bg-sky-100 text-sky-800",
  },
  PRACTICAL: {
    bg: "bg-violet-50",
    border: "border-violet-300",
    text: "text-violet-950",
    badge: "bg-violet-200 text-violet-900",
  },
  SPORTS: {
    bg: "bg-lime-50",
    border: "border-lime-300",
    text: "text-lime-950",
    badge: "bg-lime-200 text-lime-900",
  },
  BREAK: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-950",
    badge: "bg-amber-100 text-amber-900",
  },
  HOLIDAY: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-900",
    badge: "bg-rose-100 text-rose-800",
  },
  EXAM: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-950",
    badge: "bg-orange-100 text-orange-900",
  },
  SPECIAL: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-950",
    badge: "bg-emerald-100 text-emerald-900",
  },
  ONLINE: {
    bg: "bg-cyan-50",
    border: "border-cyan-200",
    text: "text-cyan-950",
    badge: "bg-cyan-100 text-cyan-900",
  },
  GUEST: {
    bg: "bg-fuchsia-50",
    border: "border-fuchsia-200",
    text: "text-fuchsia-950",
    badge: "bg-fuchsia-100 text-fuchsia-900",
  },
  EMPTY: {
    bg: "bg-white",
    border: "border-slate-100",
    text: "text-slate-400",
    badge: "bg-slate-100 text-slate-500",
  },
  HOLIDAY_ROW: {
    bg: "bg-rose-50/80",
    border: "border-rose-100",
    text: "text-rose-800",
    badge: "bg-rose-100 text-rose-800",
  },
};

export const SESSION_LABELS: Record<TimetableSessionType, string> = {
  THEORY: "Theory",
  PRACTICAL: "Lab",
  SPORTS: "Sports",
  BREAK: "Break",
  HOLIDAY: "Holiday",
  EXAM: "Exam",
  SPECIAL: "Special",
  ONLINE: "Online",
  GUEST: "Guest",
};
