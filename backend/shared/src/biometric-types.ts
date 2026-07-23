/**
 * Biometric / electronic attendance foundation.
 * Hidden from UI until devices are configured; used by device punch ingest API.
 */

export const BIOMETRIC_PERSON_TYPES = ["STUDENT", "TEACHER", "STAFF", "UNKNOWN"] as const;
export type BiometricPersonType = (typeof BIOMETRIC_PERSON_TYPES)[number];

export const BIOMETRIC_PUNCH_RESULTS = [
  "APPLIED",
  "IGNORED_DUPLICATE",
  "IGNORED_ALREADY_MARKED",
  "UNKNOWN_PERSON",
  "SKIPPED_PROTECTED_STATUS",
  "ERROR"
] as const;
export type BiometricPunchResult = (typeof BIOMETRIC_PUNCH_RESULTS)[number];

export const BIOMETRIC_PUNCH_ACTIONS = [
  "STUDENT_MARKED_PRESENT",
  "STUDENT_MARKED_LATE",
  "STUDENT_ALREADY_MARKED",
  "STAFF_CHECK_IN",
  "STAFF_CHECK_OUT",
  "NONE"
] as const;
export type BiometricPunchAction = (typeof BIOMETRIC_PUNCH_ACTIONS)[number];

/** Explicit punch type from device; AUTO = infer check-in/out from existing times. */
export const BIOMETRIC_PUNCH_TYPES = ["AUTO", "IN", "OUT"] as const;
export type BiometricPunchType = (typeof BIOMETRIC_PUNCH_TYPES)[number];

export const STUDENT_CAMPUS_ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "MEDICAL_LEAVE"
] as const;
export type StudentCampusAttendanceStatus =
  (typeof STUDENT_CAMPUS_ATTENDANCE_STATUSES)[number];

export const STUDENT_CAMPUS_ATTENDANCE_SOURCES = ["MANUAL", "BIOMETRIC"] as const;
export type StudentCampusAttendanceSource =
  (typeof STUDENT_CAMPUS_ATTENDANCE_SOURCES)[number];

export interface BiometricPunchInput {
  /** Required unless BIOMETRIC_DEFAULT_SCHOOL_ID is set on the server. */
  schoolId?: string;
  deviceId: string;
  /** Machine user ID — student admission no. / teacherCode / staffId. */
  biometricCode: string;
  /** ISO-8601 timestamp; defaults to server "now" when omitted. */
  punchTime?: string;
  /** Device log id for idempotency. */
  externalRef?: string;
  punchType?: BiometricPunchType;
}

export interface BiometricPunchResultItem {
  biometricCode: string;
  result: BiometricPunchResult;
  action: BiometricPunchAction;
  personType: BiometricPersonType;
  personId?: string;
  dateBs?: string;
  punchTimeHm?: string;
  message: string;
  punchLogId?: string;
}

export interface BiometricPunchBatchResult {
  enabled: boolean;
  processed: number;
  results: BiometricPunchResultItem[];
}
