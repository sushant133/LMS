import type { LibraryBorrowerType } from "./module-types.js";

/**
 * Library book issue limits.
 *
 * Students are limited by academic year (1st / 2nd / 3rd). Teachers and college
 * staff are not in a year, so they get one flat limit each. Every borrower kind
 * can also receive individual exceptions on top of its default.
 */

export const LIBRARY_ISSUE_LIMIT_YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year"
] as const;

export type LibraryIssueLimitYearLevel =
  (typeof LIBRARY_ISSUE_LIMIT_YEAR_LEVELS)[number];

/** Borrower kinds that can hold library books. Order drives the UI tabs. */
export const LIBRARY_BORROWER_TYPES = [
  "STUDENT",
  "TEACHER",
  "STAFF"
] as const satisfies readonly LibraryBorrowerType[];

/** Default max books when a school has not configured limits yet. */
export const DEFAULT_LIBRARY_ISSUE_LIMIT = 3;

/** Teachers and staff usually need longer/heavier loans than students. */
export const DEFAULT_LIBRARY_TEACHER_ISSUE_LIMIT = 5;
export const DEFAULT_LIBRARY_STAFF_ISSUE_LIMIT = 3;

export type LibraryIssueYearLimits = Record<LibraryIssueLimitYearLevel, number>;

/** Flat limits for non-student borrowers. */
export interface LibraryIssueStaffLimits {
  TEACHER: number;
  STAFF: number;
}

export const defaultLibraryIssueYearLimits = (): LibraryIssueYearLimits => ({
  "1st Year": DEFAULT_LIBRARY_ISSUE_LIMIT,
  "2nd Year": DEFAULT_LIBRARY_ISSUE_LIMIT,
  "3rd Year": DEFAULT_LIBRARY_ISSUE_LIMIT
});

export const defaultLibraryIssueStaffLimits = (): LibraryIssueStaffLimits => ({
  TEACHER: DEFAULT_LIBRARY_TEACHER_ISSUE_LIMIT,
  STAFF: DEFAULT_LIBRARY_STAFF_ISSUE_LIMIT
});

export const libraryBorrowerTypeLabel = (type: LibraryBorrowerType): string =>
  type === "STUDENT" ? "Student" : type === "TEACHER" ? "Teacher" : "Staff";

export interface LibraryIssueLimitConfigRecord {
  _id: string;
  schoolId: string;
  limits: LibraryIssueYearLimits;
  /** Teacher / staff flat limits. Older configs fall back to defaults. */
  staffLimits: LibraryIssueStaffLimits;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface LibraryIssueLimitExceptionRecord {
  _id: string;
  schoolId: string;
  /** Which kind of borrower this exception belongs to. */
  borrowerType: LibraryBorrowerType;
  /** The borrower's id — studentId / teacherId / staffId depending on type. */
  borrowerId: string;
  borrowerName?: string;
  /** Present only for borrowerType === "STUDENT" (kept for existing callers). */
  studentId?: string;
  studentName?: string;
  admissionNumber?: string;
  yearName?: string;
  batchName?: string;
  /** Teacher / staff context — designation, department, staff code. */
  designation?: string;
  department?: string;
  staffCode?: string;
  /** Extra books beyond the default (e.g. 2 → +2). */
  additionalBooks: number;
  reason: string;
  effectiveFromBs: string;
  /** Empty / omit = open-ended. */
  effectiveUntilBs?: string;
  remarks?: string;
  isRevoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revokedByName?: string;
  createdBy: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryBorrowStatus {
  borrowerType: LibraryBorrowerType;
  borrowerId: string;
  borrowerName?: string;
  /** Students only — kept so existing student call-sites read unchanged. */
  studentId?: string;
  studentName?: string;
  /** Null for teachers and staff, who are not tied to an academic year. */
  yearName: string | null;
  yearLevel: LibraryIssueLimitYearLevel | null;
  /** Books currently issued (ISSUED + OVERDUE). */
  issuedCount: number;
  /** Year default for students; the flat teacher/staff limit otherwise. */
  yearDefaultLimit: number;
  exceptionAdditional: number;
  hasActiveException: boolean;
  activeExceptions: Array<{
    _id: string;
    additionalBooks: number;
    reason: string;
    effectiveFromBs: string;
    effectiveUntilBs?: string;
  }>;
  /** yearDefaultLimit + exceptionAdditional */
  maxAllowed: number;
  remaining: number;
  canIssue: boolean;
  limitReached: boolean;
  message?: string;
}

/** Student-shaped borrow status — `studentId` is always present. */
export type LibraryStudentBorrowStatus = LibraryBorrowStatus & {
  studentId: string;
};
