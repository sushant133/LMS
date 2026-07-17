import { DAYS_OF_WEEK, type TimetableSessionType } from "@phit-erp/shared";

export type TimetableSlotRow = {
  _id: string;
  dayOfWeek: number;
  periodNumber: number;
  subjectId?: { _id?: string; name?: string; code?: string } | string | null;
  teacherId?:
    | { _id?: string; user?: { fullName?: string } }
    | string
    | null;
  startTime: string;
  endTime: string;
  room?: string;
  academicYearBs?: string;
  sessionType?: TimetableSessionType | string;
  breakLabel?: string;
  remarks?: string;
  roomKind?: "CLASSROOM" | "LABORATORY" | "OTHER" | string;
  batchId?: { _id?: string; name?: string } | string;
  yearId?: { _id?: string; name?: string; level?: number } | string;
  classId?: { _id?: string; name?: string } | string;
  sectionId?: { _id?: string; name?: string } | string;
};

export type PeriodColumn = {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
  periodNumber: number;
};

export type MatrixCell =
  | { kind: "empty" }
  | { kind: "holiday" }
  | { kind: "slot"; slot: TimetableSlotRow; conflict?: boolean }
  | { kind: "multi"; slots: TimetableSlotRow[] };

export type WeeklyMatrix = {
  periods: PeriodColumn[];
  /** [dayIndex 0..6][periodIndex] */
  cells: MatrixCell[][];
  days: readonly string[];
};

export const idOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id?: string })._id ?? "");
  }
  return "";
};

export const nameOf = (value: unknown, fallback = "—"): string => {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as {
      name?: string;
      user?: { fullName?: string };
    };
    return obj.name || obj.user?.fullName || fallback;
  }
  return fallback;
};

export const resolveSessionType = (
  slot: TimetableSlotRow,
): TimetableSessionType => {
  const raw = (slot.sessionType ?? "THEORY").toString().toUpperCase();
  const allowed: TimetableSessionType[] = [
    "THEORY",
    "PRACTICAL",
    "BREAK",
    "HOLIDAY",
    "EXAM",
    "SPECIAL",
    "ONLINE",
    "GUEST",
  ];
  if (allowed.includes(raw as TimetableSessionType)) {
    return raw as TimetableSessionType;
  }
  return "THEORY";
};

export const isLabSlot = (slot: TimetableSlotRow): boolean => {
  if (slot.roomKind === "LABORATORY") return true;
  if (resolveSessionType(slot) === "PRACTICAL") return true;
  return Boolean(slot.room && /lab/i.test(slot.room));
};

export const formatTimeRange = (start: string, end: string): string =>
  // Compact college style: 06:30–07:20 (stored as 24h HH:MM)
  `${start}–${end}`;

const periodKey = (start: string, end: string) => `${start}|${end}`;

/** Build ordered period columns from slots (unique start–end, sorted by time). */
export const buildPeriodColumns = (slots: TimetableSlotRow[]): PeriodColumn[] => {
  const map = new Map<string, PeriodColumn>();
  for (const slot of slots) {
    const key = periodKey(slot.startTime, slot.endTime);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatTimeRange(slot.startTime, slot.endTime),
        startTime: slot.startTime,
        endTime: slot.endTime,
        periodNumber: slot.periodNumber,
      });
    } else {
      const existing = map.get(key)!;
      existing.periodNumber = Math.min(existing.periodNumber, slot.periodNumber);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.periodNumber - b.periodNumber;
  });
};

/**
 * Build day × period matrix. Existing slots are placed dynamically — no re-entry.
 * When saturdayIsHoliday and Saturday cell empty → holiday cell.
 */
export const buildWeeklyMatrix = (
  slots: TimetableSlotRow[],
  options?: { saturdayIsHoliday?: boolean },
): WeeklyMatrix => {
  const saturdayIsHoliday = options?.saturdayIsHoliday ?? true;
  const periods = buildPeriodColumns(slots);
  const days = DAYS_OF_WEEK;

  // Index slots by day + period key
  const bucket = new Map<string, TimetableSlotRow[]>();
  for (const slot of slots) {
    const key = `${slot.dayOfWeek}|${periodKey(slot.startTime, slot.endTime)}`;
    const list = bucket.get(key) ?? [];
    list.push(slot);
    bucket.set(key, list);
  }

  const cells: MatrixCell[][] = days.map((_, dayIndex) =>
    periods.map((period) => {
      const key = `${dayIndex}|${period.key}`;
      const list = bucket.get(key) ?? [];

      if (list.length === 0) {
        if (saturdayIsHoliday && dayIndex === 6) {
          return { kind: "holiday" };
        }
        return { kind: "empty" };
      }

      // Prefer holiday/break display
      const holiday = list.find((s) => resolveSessionType(s) === "HOLIDAY");
      if (holiday) return { kind: "slot", slot: holiday };

      if (list.length === 1) {
        return { kind: "slot", slot: list[0]! };
      }
      return { kind: "multi", slots: list };
    }),
  );

  // If no periods at all but saturday holiday — show placeholder period for print
  if (periods.length === 0 && saturdayIsHoliday) {
    const placeholder: PeriodColumn = {
      key: "placeholder",
      label: "—",
      startTime: "00:00",
      endTime: "00:00",
      periodNumber: 1,
    };
    return {
      periods: [placeholder],
      days,
      cells: days.map((_, dayIndex) => [
        dayIndex === 6 ? { kind: "holiday" } : { kind: "empty" },
      ]),
    };
  }

  return { periods, cells, days };
};

export const filterSlotsByView = (
  slots: TimetableSlotRow[],
  view: {
    mode: "group" | "mine" | "teacher" | "room" | "lab";
    teacherId?: string;
    room?: string;
    mineTeacherId?: string;
  },
): TimetableSlotRow[] => {
  switch (view.mode) {
    case "mine":
      if (!view.mineTeacherId) return slots;
      return slots.filter((s) => idOf(s.teacherId) === view.mineTeacherId);
    case "teacher":
      if (!view.teacherId) return slots;
      return slots.filter((s) => idOf(s.teacherId) === view.teacherId);
    case "room":
      if (!view.room?.trim()) return slots;
      return slots.filter(
        (s) =>
          (s.room ?? "").trim().toLowerCase() === view.room!.trim().toLowerCase(),
      );
    case "lab":
      return slots.filter((s) => isLabSlot(s));
    default:
      return slots;
  }
};

export const uniqueRooms = (slots: TimetableSlotRow[]): string[] => {
  const set = new Set<string>();
  for (const s of slots) {
    const r = (s.room ?? "").trim();
    if (r) set.add(r);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};
