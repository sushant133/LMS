/**
 * Student Early Leave Management — campus exit before end of day.
 */

export const EARLY_LEAVE_PERIOD_KINDS = [
  "AFTER_PERIOD",
  "DURING_BREAK",
  "OTHER"
] as const;
export type EarlyLeavePeriodKind = (typeof EARLY_LEAVE_PERIOD_KINDS)[number];

/** Common reasons (free text still allowed). */
export const EARLY_LEAVE_REASON_SUGGESTIONS = [
  "Stomachache",
  "Fever",
  "Family emergency",
  "Personal reason",
  "Medical appointment",
  "Other"
] as const;

export interface StudentEarlyLeaveRecord {
  _id: string;
  schoolId: string;
  studentId: string | {
    _id: string;
    admissionNumber?: string;
    rollNumber?: number;
    batchId?: string;
    yearId?: string;
    classId?: string;
    sectionId?: string;
    user?: { fullName?: string };
  };
  dateBs: string;
  /** How the leave point is described */
  periodKind: EarlyLeavePeriodKind;
  /**
   * Teaching period number after which the student left (1–12).
   * Used when periodKind is AFTER_PERIOD.
   */
  leftAfterPeriod?: number | null;
  /** Free-text period label, e.g. "after 2nd period", "during tiffin break" */
  periodLabel: string;
  reason: string;
  approvedBy?: string;
  remarks?: string;
  /** HH:MM when recorded (optional wall-clock leave time) */
  leftAtTime?: string;
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
  academicYearBs?: string;
  /** Linked daily attendance document if updated */
  dailyAttendanceId?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  /** Populated display helpers */
  studentName?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  createdByName?: string;
}

export interface StudentEarlyLeaveListResponse {
  records: StudentEarlyLeaveRecord[];
  total: number;
}
