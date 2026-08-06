/**
 * Traditional Attendance Register (read-only view layer).
 * Does not define storage — maps statuses from existing attendance collections.
 */

/** Canonical status codes shown in the register grid. */
export const ATTENDANCE_REGISTER_CODE_MAP: Record<string, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LEAVE: "L",
  LATE: "Late",
  MEDICAL_LEAVE: "L",
  EARLY_LEAVE: "EL",
  HALF_DAY: "HD",
  OFFICIAL_DUTY: "OD",
  HOLIDAY: "H",
  FIELD_DUTY: "F",
  NIGHT_DUTY: "N",
  EVENING_DUTY: "E",
  MORNING_DUTY: "M",
  EMERGENCY_DUTY: "F",
  HD: "HD",
  OD: "OD",
  EL: "EL"
};

export type AttendanceRegisterTab = "STUDENT" | "TEACHER" | "STAFF";

export type AttendanceRegisterPersonType = "STUDENT" | "TEACHER" | "STAFF";

export interface AttendanceRegisterDayMeta {
  dateBs: string;
  dayOfMonth: number;
  weekday: string;
  weekdayShort: string;
  /** JS getDay(): 0=Sun … 6=Sat */
  dayOfWeek: number;
  isSaturday: boolean;
}

export interface AttendanceRegisterCell {
  dateBs: string;
  /** Raw status from source system, e.g. PRESENT */
  status: string | null;
  /** Display code, e.g. P */
  code: string | null;
  remarks?: string;
  checkInTime?: string;
  checkOutTime?: string;
  markedByName?: string;
  source?: string;
  locationLabel?: string;
  attendanceDocId?: string;
}

export interface AttendanceRegisterRowSummary {
  present: number;
  absent: number;
  leave: number;
  late: number;
  holiday: number;
  halfDay: number;
  officialDuty: number;
  fieldDuty: number;
  other: number;
  /** Days counted toward attendance % (excludes holiday/empty by default) */
  workingDays: number;
  markedDays: number;
  percentage: number;
}

export interface AttendanceRegisterPersonRow {
  personId: string;
  personType: AttendanceRegisterPersonType;
  sn: number;
  fullName: string;
  code?: string;
  rollNumber?: number;
  photoUrl?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  department?: string;
  designation?: string;
  academicStatus?: string;
  /** dateBs → cell */
  cells: Record<string, AttendanceRegisterCell>;
  summary: AttendanceRegisterRowSummary;
  remarks?: string;
}

export interface AttendanceRegisterStats {
  totalPeople: number;
  presentToday: number;
  absentToday: number;
  leaveToday: number;
  officialDutyToday: number;
  fieldDutyToday: number;
  attendancePercentToday: number;
  todayBs: string;
}

export interface AttendanceRegisterResponse {
  tab: AttendanceRegisterTab;
  monthBs: string;
  monthLabel: string;
  academicYearBs?: string;
  scopeLabel?: string;
  days: AttendanceRegisterDayMeta[];
  rows: AttendanceRegisterPersonRow[];
  stats: AttendanceRegisterStats;
  /** Full code legend for print/UI */
  legend: Array<{ status: string; code: string; label: string }>;
  filtersEcho: Record<string, string>;
  generatedAt: string;
}

export interface AttendanceRegisterCellDetail {
  personId: string;
  personName: string;
  dateBs: string;
  status: string | null;
  code: string | null;
  checkInTime?: string;
  checkOutTime?: string;
  remarks?: string;
  markedByName?: string;
  source?: string;
  locationLabel?: string;
  department?: string;
  designation?: string;
  batchName?: string;
  yearName?: string;
}

/** Map raw status → register code (unknown statuses pass through shortened). */
export const toAttendanceRegisterCode = (status?: string | null): string | null => {
  if (!status) return null;
  const key = status.trim().toUpperCase().replace(/\s+/g, "_");
  if (ATTENDANCE_REGISTER_CODE_MAP[key]) return ATTENDANCE_REGISTER_CODE_MAP[key]!;
  if (key.length <= 3) return key;
  return key.slice(0, 2);
};

export const ATTENDANCE_REGISTER_STATUS_LABELS: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LEAVE: "Leave",
  LATE: "Late",
  MEDICAL_LEAVE: "Medical Leave",
  EARLY_LEAVE: "Early Leave",
  HALF_DAY: "Half Day",
  OFFICIAL_DUTY: "Official Duty",
  HOLIDAY: "Holiday",
  FIELD_DUTY: "Field Duty",
  NIGHT_DUTY: "Night Duty",
  EVENING_DUTY: "Evening Duty",
  MORNING_DUTY: "Morning Duty",
  EMERGENCY_DUTY: "Emergency / Field Duty"
};
