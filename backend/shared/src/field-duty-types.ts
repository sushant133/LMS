/**
 * Field Management — types for Community/PHC & Hospital postings.
 * Posting types are configurable strings so new types can be added without schema migrations.
 */

/** Built-in posting types (extensible — DB stores free string keyed by these defaults). */
export const FIELD_POSTING_TYPES = [
  "COMMUNITY",
  "PHC",
  "HOSPITAL",
  "COMMUNITY_HEALTH_CAMP",
  "RURAL_HEALTH",
  "URBAN_HEALTH",
  "CLINICAL_ROTATION",
  "INTERNSHIP",
  "OUTREACH",
  "INDUSTRIAL_VISIT",
  "RESEARCH_FIELD_VISIT"
] as const;

export type FieldPostingType = (typeof FIELD_POSTING_TYPES)[number] | (string & {});

/** Sidebar / filter sections. OTHER types map into Community/PHC or Hospital via grouping. */
export const FIELD_POSTING_SECTIONS = ["COMMUNITY_PHC", "HOSPITAL"] as const;
export type FieldPostingSection = (typeof FIELD_POSTING_SECTIONS)[number];

export const FIELD_POSTING_TYPE_LABELS: Record<string, string> = {
  COMMUNITY: "Community",
  PHC: "PHC",
  HOSPITAL: "Hospital",
  COMMUNITY_HEALTH_CAMP: "Community Health Camp",
  RURAL_HEALTH: "Rural Health Posting",
  URBAN_HEALTH: "Urban Health Posting",
  CLINICAL_ROTATION: "Clinical Rotation",
  INTERNSHIP: "Internship",
  OUTREACH: "Outreach Program",
  INDUSTRIAL_VISIT: "Industrial Visit",
  RESEARCH_FIELD_VISIT: "Research Field Visit"
};

/** Map posting type → UI section (Community/PHC vs Hospital). */
export const postingTypeToSection = (postingType: string): FieldPostingSection => {
  const t = (postingType || "HOSPITAL").toUpperCase();
  if (
    t === "HOSPITAL" ||
    t === "CLINICAL_ROTATION" ||
    t === "INTERNSHIP"
  ) {
    return "HOSPITAL";
  }
  return "COMMUNITY_PHC";
};

export const postingTypesForSection = (section: FieldPostingSection): string[] => {
  if (section === "HOSPITAL") {
    return ["HOSPITAL", "CLINICAL_ROTATION", "INTERNSHIP"];
  }
  return [
    "COMMUNITY",
    "PHC",
    "COMMUNITY_HEALTH_CAMP",
    "RURAL_HEALTH",
    "URBAN_HEALTH",
    "OUTREACH",
    "INDUSTRIAL_VISIT",
    "RESEARCH_FIELD_VISIT"
  ];
};

export type FieldDutyScheduleStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type FieldDutyAttendanceStatus = "DRAFT" | "SUBMITTED" | "LOCKED";

export type FieldDutyStudentStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "LEAVE"
  | "EMERGENCY_DUTY";

export type FieldDutyShift = "MORNING" | "DAY" | "EVENING" | "NIGHT" | "FULL_DAY";

export type FieldDutyRosterMode = "AUTO_BATCH_YEAR" | "MANUAL";

export type FieldDutyEditRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type FieldCoordinatorRole = "PRIMARY" | "ASSISTANT";

export interface FieldCoordinatorRef {
  staffId: string;
  role: FieldCoordinatorRole;
  staff?: {
    _id: string;
    staffId?: string;
    designation?: string;
    fullName?: string;
    user?: { fullName: string };
  };
}

export interface FieldDutyScheduleRecord {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  faculty?: string;
  semesterBs?: string;
  batchId: string;
  yearId: string;
  sectionId?: string;
  /** Configurable posting type (COMMUNITY, PHC, HOSPITAL, …). */
  postingType: string;
  /** UI section derived from postingType. */
  postingSection?: FieldPostingSection;
  /**
   * Site name (Hospital / PHC / Community name).
   * `hospitalName` is kept for backward compatibility (same value).
   */
  siteName: string;
  hospitalName: string;
  address?: string;
  department?: string;
  ward?: string;
  /** Primary field coordinator (college staff). */
  supervisorStaffId: string;
  /** Additional assistant coordinators (college staff). */
  assistantCoordinatorStaffIds?: string[];
  /** @deprecated Legacy teacher-based supervisor id if present on old rows */
  supervisorTeacherId?: string;
  clinicalInstructorName?: string;
  hospitalSupervisorName?: string;
  startDateBs: string;
  endDateBs: string;
  shift: FieldDutyShift;
  remarks?: string;
  status: FieldDutyScheduleStatus;
  /** AUTO_BATCH_YEAR (default) or MANUAL selected students. */
  rosterMode?: FieldDutyRosterMode;
  /** When rosterMode is MANUAL (or hybrid override), explicit student ids. */
  assignedStudentIds?: string[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  batch?: { _id: string; name: string };
  year?: { _id: string; name: string; level?: number };
  supervisor?: {
    _id: string;
    staffId?: string;
    designation?: string;
    fullName?: string;
    user?: { fullName: string };
  };
  assistants?: Array<{
    _id: string;
    staffId?: string;
    designation?: string;
    fullName?: string;
    user?: { fullName: string };
  }>;
  coordinators?: FieldCoordinatorRef[];
  studentCount?: number;
}

export interface FieldDutyAttendanceEntryRecord {
  studentId: string;
  status: FieldDutyStudentStatus;
  remarks?: string;
  student?: {
    _id: string;
    fullName?: string;
    admissionNumber?: string;
    rollNumber?: number;
  };
}

export interface FieldDutyEditRequestRecord {
  requestedBy?: string;
  requestedAt?: string;
  reason?: string;
  status: FieldDutyEditRequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

export interface FieldDutyAttendanceRecord {
  _id: string;
  schoolId: string;
  scheduleId: string;
  dateBs: string;
  postingType?: string;
  siteName?: string;
  hospitalName: string;
  department: string;
  ward?: string;
  shift: FieldDutyShift;
  batchId: string;
  yearId: string;
  supervisorStaffId: string;
  /** @deprecated Legacy teacher-based supervisor id if present on old rows */
  supervisorTeacherId?: string;
  entries: FieldDutyAttendanceEntryRecord[];
  notes?: string;
  status: FieldDutyAttendanceStatus;
  editRequest?: FieldDutyEditRequestRecord;
  submittedBy?: string;
  submittedAt?: string;
  unlockedBy?: string;
  unlockedAt?: string;
  unlockReason?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  schedule?: FieldDutyScheduleRecord;
  summary?: {
    present: number;
    absent: number;
    late: number;
    leave: number;
    emergencyDuty: number;
    total: number;
  };
}

export interface FieldDutyRosterStudent {
  _id: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: number;
  batchId?: string;
  yearId?: string;
}

export interface FieldDutyDashboard {
  studentsOnDutyToday: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  emergencyDuty: number;
  pendingSubmissions: number;
  submittedToday: number;
  missingAttendance: number;
  overallAttendancePercent: number;
  hospitalWise: Array<{ hospital: string; present: number; absent: number; total: number }>;
  siteWise: Array<{ siteName: string; postingType?: string; present: number; absent: number; total: number }>;
  supervisorWise: Array<{
    supervisorId: string;
    supervisorName: string;
    present: number;
    absent: number;
    total: number;
  }>;
  postingTypeWise?: Array<{
    postingType: string;
    present: number;
    absent: number;
    total: number;
  }>;
  myAssignments?: Array<{
    scheduleId: string;
    hospitalName: string;
    siteName?: string;
    postingType?: string;
    department: string;
    batchName?: string;
    yearName?: string;
    studentCount: number;
    attendanceStatus?: FieldDutyAttendanceStatus | "NONE";
    startDateBs?: string;
    endDateBs?: string;
  }>;
  upcomingPostings?: Array<{
    scheduleId: string;
    siteName: string;
    postingType: string;
    startDateBs: string;
    endDateBs: string;
    studentCount: number;
  }>;
}

export interface FieldDutyPortalRow {
  _id: string;
  dateBs: string;
  hospitalName: string;
  siteName?: string;
  postingType?: string;
  department: string;
  ward?: string;
  shift: FieldDutyShift;
  supervisorName?: string;
  status: FieldDutyStudentStatus;
  remarks?: string;
  attendanceRecordStatus: FieldDutyAttendanceStatus;
}

export interface FieldDutyPortalSummary {
  rows: FieldDutyPortalRow[];
  present: number;
  absent: number;
  late: number;
  leave: number;
  emergencyDuty: number;
  totalMarked: number;
  attendancePercent: number;
  postings?: Array<{
    scheduleId: string;
    siteName: string;
    postingType: string;
    coordinatorName?: string;
    startDateBs?: string;
    endDateBs?: string;
    present: number;
    absent: number;
    late: number;
    leave: number;
    total: number;
    attendancePercent: number;
  }>;
}

/** Admin monitoring snapshot. */
export interface FieldDutyMonitoringSummary {
  overallAttendancePercent: number;
  pendingAttendance: number;
  submittedAttendance: number;
  missingAttendance: number;
  communityPostingAttendance: number;
  hospitalPostingAttendance: number;
  byCoordinator: Array<{
    coordinatorId: string;
    coordinatorName: string;
    present: number;
    absent: number;
    total: number;
    percent: number;
  }>;
  byBatch: Array<{ batchId: string; batchName: string; present: number; total: number; percent: number }>;
  byYear: Array<{ yearId: string; yearName: string; present: number; total: number; percent: number }>;
  byPosting: Array<{
    scheduleId: string;
    siteName: string;
    postingType: string;
    present: number;
    total: number;
    percent: number;
  }>;
  byDate: Array<{ dateBs: string; present: number; absent: number; total: number; percent: number }>;
}

/** Settings fragment for field attendance contribution to overall. */
export interface FieldAttendanceSettings {
  /** When true, field attendance contributes to overall student attendance %. */
  contributeToOverall: boolean;
  /** When true, LATE counts as present for field % (default true). */
  countLateAsPresent: boolean;
}
