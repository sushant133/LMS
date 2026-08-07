/**
 * Library book issue limits — year-wise defaults + student exceptions.
 * College academic years (1st / 2nd / 3rd) only.
 */

export const LIBRARY_ISSUE_LIMIT_YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year"
] as const;

export type LibraryIssueLimitYearLevel =
  (typeof LIBRARY_ISSUE_LIMIT_YEAR_LEVELS)[number];

/** Default max books when a school has not configured limits yet. */
export const DEFAULT_LIBRARY_ISSUE_LIMIT = 3;

export type LibraryIssueYearLimits = Record<LibraryIssueLimitYearLevel, number>;

export const defaultLibraryIssueYearLimits = (): LibraryIssueYearLimits => ({
  "1st Year": DEFAULT_LIBRARY_ISSUE_LIMIT,
  "2nd Year": DEFAULT_LIBRARY_ISSUE_LIMIT,
  "3rd Year": DEFAULT_LIBRARY_ISSUE_LIMIT
});

export interface LibraryIssueLimitConfigRecord {
  _id: string;
  schoolId: string;
  limits: LibraryIssueYearLimits;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface LibraryIssueLimitExceptionRecord {
  _id: string;
  schoolId: string;
  studentId: string;
  studentName?: string;
  admissionNumber?: string;
  yearName?: string;
  batchName?: string;
  /** Extra books beyond the year default (e.g. 2 → +2). */
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

export interface LibraryStudentBorrowStatus {
  studentId: string;
  studentName?: string;
  yearName: string | null;
  yearLevel: LibraryIssueLimitYearLevel | null;
  /** Books currently issued (ISSUED + OVERDUE). */
  issuedCount: number;
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
