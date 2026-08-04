/**
 * Teacher & Staff (employee) attendance — separate from student / lab / field attendance.
 * Designed for future biometric / RFID / QR / GPS sources without schema redesign.
 */

export const EMPLOYEE_ATTENDANCE_CATEGORIES = ["TEACHER", "STAFF"] as const;
export type EmployeeAttendanceCategory = (typeof EMPLOYEE_ATTENDANCE_CATEGORIES)[number];

export const EMPLOYEE_ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "HALF_DAY",
  "LATE",
  "OFFICIAL_DUTY",
  "HOLIDAY"
] as const;
export type EmployeeAttendanceStatus = (typeof EMPLOYEE_ATTENDANCE_STATUSES)[number];

/**
 * Day-sheet lifecycle for teacher/staff attendance:
 * - DRAFT — working draft
 * - CHECK_IN_SUBMITTED — check-in times recorded (still editable for check-out)
 * - CHECK_OUT_SUBMITTED — check-out times recorded (still open until final)
 * - SUBMITTED / LOCKED — final day sheet (legacy SUBMITTED treated as locked)
 */
export const EMPLOYEE_ATTENDANCE_RECORD_STATUSES = [
  "DRAFT",
  "CHECK_IN_SUBMITTED",
  "CHECK_OUT_SUBMITTED",
  "SUBMITTED",
  "LOCKED"
] as const;
export type EmployeeAttendanceRecordStatus =
  (typeof EMPLOYEE_ATTENDANCE_RECORD_STATUSES)[number];

/** Submit step for the same table (check-in → check-out → final lock). */
export const EMPLOYEE_ATTENDANCE_SUBMIT_PHASES = [
  "DRAFT",
  "CHECK_IN",
  "CHECK_OUT",
  "FINAL"
] as const;
export type EmployeeAttendanceSubmitPhase =
  (typeof EMPLOYEE_ATTENDANCE_SUBMIT_PHASES)[number];

/** Capture source — MANUAL today; ready for devices later. */
export const EMPLOYEE_ATTENDANCE_SOURCES = [
  "MANUAL",
  "BIOMETRIC",
  "RFID",
  "QR",
  "MOBILE",
  "GPS"
] as const;
export type EmployeeAttendanceSource = (typeof EMPLOYEE_ATTENDANCE_SOURCES)[number];

export interface EmployeeAttendanceEntryRecord {
  /** Teacher document id when category = TEACHER */
  teacherId?: string;
  /** CollegeStaff document id when category = STAFF */
  staffId?: string;
  employeeUserId?: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  designation?: string;
  status: EmployeeAttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  /** Number of periods taught (teachers). Omitted when not recorded. */
  periodsTaught?: number;
  remarks?: string;
  source?: EmployeeAttendanceSource;
  deviceId?: string;
  externalRef?: string;
  geo?: { lat?: number; lng?: number };
}

export interface EmployeeAttendanceRecord {
  _id: string;
  schoolId: string;
  category: EmployeeAttendanceCategory;
  dateBs: string;
  academicYearBs?: string;
  entries: EmployeeAttendanceEntryRecord[];
  notes?: string;
  status: EmployeeAttendanceRecordStatus;
  sourceDefault?: EmployeeAttendanceSource;
  createdBy?: string;
  submittedBy?: string;
  submittedAt?: string;
  unlockedBy?: string;
  unlockedAt?: string;
  unlockReason?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: EmployeeAttendanceSummary;
}

export interface EmployeeAttendanceSummary {
  total: number;
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  late: number;
  officialDuty: number;
  holiday: number;
  pending: number;
}

export interface EmployeeAttendanceDashboard {
  category: EmployeeAttendanceCategory;
  dateBs: string;
  totalEmployees: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
  officialDuty: number;
  holiday: number;
  pending: number;
  recordStatus?: EmployeeAttendanceRecordStatus | "NONE";
  attendancePercent: number;
}

export interface EmployeeAttendanceEmployeeRow {
  _id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  designation?: string;
  userId?: string;
  status?: "ACTIVE" | "INACTIVE";
}

export interface EmployeeAttendanceMarkContext {
  category: EmployeeAttendanceCategory;
  dateBs: string;
  employees: EmployeeAttendanceEmployeeRow[];
  existingRecord: EmployeeAttendanceRecord | null;
  canMark: boolean;
  canEdit: boolean;
  message?: string;
}

export interface EmployeeAttendanceSelfSummary {
  category: EmployeeAttendanceCategory;
  monthBs?: string;
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
  officialDuty: number;
  holiday: number;
  totalMarked: number;
  attendancePercent: number;
  history: Array<{
    dateBs: string;
    status: EmployeeAttendanceStatus;
    checkInTime?: string;
    checkOutTime?: string;
    periodsTaught?: number;
    remarks?: string;
  }>;
}

export interface EmployeeAttendanceRegisterRow {
  dateBs: string;
  category: EmployeeAttendanceCategory;
  employeeCode: string;
  fullName: string;
  department?: string;
  designation?: string;
  status: EmployeeAttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  periodsTaught?: number;
  remarks?: string;
  recordStatus: EmployeeAttendanceRecordStatus;
  attendanceId: string;
}
