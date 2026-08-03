/**
 * Hospital Roster & Clinical Duty Management (Field Management upgrade).
 * Additive to existing FieldDutySchedule / FieldDutyAttendance — does not replace them.
 */

export type HospitalStatus = "ACTIVE" | "INACTIVE";

export type HospitalRosterStatus = "DRAFT" | "PUBLISHED" | "LOCKED";

export type HospitalRosterAttendanceMark =
  | "PRESENT"
  | "ABSENT"
  | "LEAVE"
  | "LATE"
  | "NO_DUTY";

export interface FieldHospitalRecord {
  _id: string;
  schoolId: string;
  name: string;
  address?: string;
  contact?: string;
  coordinatorStaffId?: string;
  coordinatorName?: string;
  status: HospitalStatus;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HospitalDepartmentRecord {
  _id: string;
  schoolId: string;
  name: string;
  shortCode: string;
  sortOrder: number;
  isActive: boolean;
  isSystem?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DutyShiftRecord {
  _id: string;
  schoolId: string;
  name: string;
  shortCode: string;
  startTime: string;
  endTime: string;
  dutyHours: number;
  sortOrder: number;
  isActive: boolean;
  isSystem?: boolean;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Free-form cell codes (Off / Leave / custom) — managed like shifts/departments. */
export interface RosterDutyCodeRecord {
  _id: string;
  schoolId: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isSystem?: boolean;
  isLeave?: boolean;
  isOff?: boolean;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One cell in the student × day grid. */
export interface HospitalRosterCell {
  studentId: string;
  /** Day index within period (1 = startDateBs). Legacy: day-of-month. */
  day: number;
  shiftId?: string;
  departmentId?: string;
  /** Free-form code when no shift/dept (e.g. Off, Leave, ID, DW). */
  code?: string;
  remarks?: string;
}

export interface HospitalRosterStudentRow {
  studentId: string;
  fullName: string;
  admissionNumber?: string;
  rollNumber?: number;
}

export interface HospitalRosterRecord {
  _id: string;
  schoolId: string;
  name: string;
  academicYearBs: string;
  program?: string;
  batchId: string;
  batchName?: string;
  yearId: string;
  yearName?: string;
  sectionId?: string;
  hospitalId: string;
  hospitalName?: string;
  /** Inclusive period start BS (YYYY-MM-DD). */
  startDateBs?: string;
  /** Inclusive period end BS (YYYY-MM-DD). */
  endDateBs?: string;
  /** BS month of start as YYYY-MM (e.g. 2083-03) — legacy list/filter key. */
  monthBs: string;
  /** Inclusive days in the From–To period (1–93). */
  daysInMonth: number;
  coordinatorStaffId?: string;
  coordinatorName?: string;
  remarks?: string;
  status: HospitalRosterStatus;
  /** Ordered student rows. */
  studentIds: string[];
  students?: HospitalRosterStudentRow[];
  cells: HospitalRosterCell[];
  preparedByName?: string;
  approvedByName?: string;
  lockedAt?: string;
  lockedBy?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentDutySummaryRow {
  studentId: string;
  fullName: string;
  admissionNumber?: string;
  rollNumber?: number;
  /** Counts keyed by shift shortCode (M, E, N, OD…). */
  byShift: Record<string, number>;
  /** Counts keyed by department shortCode (ER, OPD…). */
  byDepartment: Record<string, number>;
  /** Counts for free codes (Off, Leave…). */
  byCode: Record<string, number>;
  totalDuties: number;
  totalDutyHours: number;
  workingDays: number;
  leaveDays: number;
  offDays: number;
  remarks?: string;
}

export interface ClinicalDutyRecordRow {
  studentId: string;
  fullName: string;
  admissionNumber?: string;
  rollNumber?: number;
  byDepartment: Record<string, number>;
  totalDuties: number;
  remarks?: string;
}

export interface HospitalRosterSummary {
  roster: HospitalRosterRecord;
  dutySummary: StudentDutySummaryRow[];
  clinicalRecord: ClinicalDutyRecordRow[];
  shiftLegend: Array<{ shortCode: string; name: string; dutyHours: number }>;
  departmentLegend: Array<{ shortCode: string; name: string }>;
  codeLegend?: Array<{ code: string; label: string; isLeave?: boolean; isOff?: boolean }>;
}

/** Default departments seeded per school on first use. */
export const DEFAULT_HOSPITAL_DEPARTMENTS: Array<{
  name: string;
  shortCode: string;
  sortOrder: number;
}> = [
  { name: "Emergency / ER", shortCode: "ER", sortOrder: 10 },
  { name: "Medical Ward", shortCode: "MW", sortOrder: 20 },
  { name: "Surgical Ward", shortCode: "SW", sortOrder: 30 },
  { name: "Orthopedic", shortCode: "ORTHO", sortOrder: 40 },
  { name: "Gynecology", shortCode: "GYNE", sortOrder: 50 },
  { name: "Dental", shortCode: "DENT", sortOrder: 60 },
  { name: "ICU", shortCode: "ICU", sortOrder: 70 },
  { name: "NICU", shortCode: "NICU", sortOrder: 80 },
  { name: "PICU", shortCode: "PICU", sortOrder: 90 },
  { name: "Laboratory", shortCode: "LAB", sortOrder: 100 },
  { name: "Radiology", shortCode: "RAD", sortOrder: 110 },
  { name: "USG", shortCode: "USG", sortOrder: 120 },
  { name: "X-Ray", shortCode: "XRAY", sortOrder: 130 },
  { name: "OPD", shortCode: "OPD", sortOrder: 140 },
  { name: "HDU", shortCode: "HDU", sortOrder: 150 },
  { name: "Medicine", shortCode: "MED", sortOrder: 160 },
  { name: "Pediatrics", shortCode: "PED", sortOrder: 170 },
  { name: "Psychiatry", shortCode: "PSY", sortOrder: 180 },
  { name: "Physiotherapy", shortCode: "PHYSIO", sortOrder: 190 },
  { name: "Operation Theatre", shortCode: "OT", sortOrder: 200 },
  { name: "Dialysis", shortCode: "DIAL", sortOrder: 210 },
  { name: "Infectious Disease", shortCode: "ID", sortOrder: 220 },
  { name: "Duty Ward", shortCode: "DW", sortOrder: 230 },
];

/** Default shifts seeded per school on first use. */
export const DEFAULT_DUTY_SHIFTS: Array<{
  name: string;
  shortCode: string;
  startTime: string;
  endTime: string;
  dutyHours: number;
  sortOrder: number;
  color?: string;
}> = [
  {
    name: "Morning",
    shortCode: "M",
    startTime: "07:00",
    endTime: "13:00",
    dutyHours: 6,
    sortOrder: 10,
    color: "#dbeafe",
  },
  {
    name: "Evening",
    shortCode: "E",
    startTime: "13:00",
    endTime: "19:00",
    dutyHours: 6,
    sortOrder: 20,
    color: "#fef3c7",
  },
  {
    name: "Night",
    shortCode: "N",
    startTime: "19:00",
    endTime: "07:00",
    dutyHours: 12,
    sortOrder: 30,
    color: "#e0e7ff",
  },
  {
    name: "Official Duty",
    shortCode: "OD",
    startTime: "10:00",
    endTime: "16:00",
    dutyHours: 6,
    sortOrder: 40,
    color: "#d1fae5",
  },
  {
    name: "OPD",
    shortCode: "OPD",
    startTime: "09:00",
    endTime: "15:00",
    dutyHours: 6,
    sortOrder: 50,
    color: "#fce7f3",
  },
  {
    name: "Emergency",
    shortCode: "EMG",
    startTime: "00:00",
    endTime: "23:59",
    dutyHours: 8,
    sortOrder: 60,
    color: "#fee2e2",
  },
  {
    name: "Ward",
    shortCode: "W",
    startTime: "08:00",
    endTime: "16:00",
    dutyHours: 8,
    sortOrder: 70,
    color: "#ecfccb",
  },
];

export const DEFAULT_ROSTER_FREE_CODES = [
  { code: "Off", label: "Off", isOff: true, isLeave: false, sortOrder: 10 },
  { code: "Leave", label: "Leave", isOff: false, isLeave: true, sortOrder: 20 },
  { code: "ID", label: "Infectious Duty", isOff: false, isLeave: false, sortOrder: 30 },
  { code: "DW", label: "Duty Ward", isOff: false, isLeave: false, sortOrder: 40 },
] as const;
