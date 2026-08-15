import type { LIBRARY_YEAR_LEVELS } from "./constants.js";
import type { UserRole } from "./types.js";

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AssignmentType = "HOMEWORK" | "CAS" | "NOTE";

export type AssignmentSubmissionStatus = "PENDING" | "SUBMITTED" | "GRADED";

export type NotificationChannel = "IN_APP" | "SMS" | "BOTH";

export type NotificationType =
  | "ATTENDANCE"
  | "HOMEWORK"
  | "FEE"
  | "NOTICE"
  | "TRANSPORT"
  | "LIBRARY"
  | "LABORATORY"
  | "PAYROLL"
  | "EXAM"
  | "COMPLAINT"
  | "ACADEMIC_MANAGEMENT"
  | "ACADEMIC_CALENDAR"
  | "ACADEMIC_PROMOTION"
  | "GENERAL";

export type ComplaintCategory =
  | "TEACHER"
  | "STAFF"
  | "STUDENT"
  | "STUDY"
  | "FACILITY"
  | "ADMINISTRATION"
  | "OTHER";

export type ComplaintStatus = "SUBMITTED" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

export interface ComplaintRecord {
  _id: string;
  schoolId: string;
  submittedBy: string;
  submitterRole: UserRole;
  submitterName?: string;
  subject: string;
  category: ComplaintCategory;
  content: string;
  attachments: AssignmentAttachment[];
  status: ComplaintStatus;
  adminResponse?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type InventoryStockStatus = "AVAILABLE" | "LOW_STOCK" | "CRITICAL_STOCK" | "OUT_OF_STOCK";

export type LibraryBorrowerType = "STUDENT" | "TEACHER" | "STAFF";

export type SmsDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type LibraryIssueStatus = "ISSUED" | "RETURNED" | "OVERDUE";

/** Status of one physical book copy. */
export type LibraryCopyStatus = "AVAILABLE" | "ISSUED" | "LOST" | "DAMAGED" | "MAINTENANCE";

/**
 * Year / Book type for the library catalog.
 *
 * Derived from LIBRARY_YEAR_LEVELS rather than spelled out: as a hand-written
 * union it had already fallen behind the constant (it was missing the
 * Reference/Other categories the model enum accepts), and the UI casts to this
 * type, so the drift was invisible at compile time.
 */
export type LibraryYearLevel = (typeof LIBRARY_YEAR_LEVELS)[number];

export type LeaveType = "CASUAL" | "SICK" | "MATERNITY" | "UNPAID" | "OTHER";

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export type PayrollStatus = "DRAFT" | "PROCESSED" | "PAID";

export type ParentRelationship = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";

export type ParentFromStudentRelationship = "FATHER" | "MOTHER" | "GUARDIAN";

export type TimetableSessionType =
  | "THEORY"
  | "PRACTICAL"
  | "SPORTS"
  | "BREAK"
  | "HOLIDAY"
  | "EXAM"
  | "SPECIAL"
  | "ONLINE"
  | "GUEST";

export type TimetableRoomKind = "CLASSROOM" | "LABORATORY" | "OTHER";

/** Staff duty roster kinds — separate from the teaching session types above. */
export type StaffTimetableSessionType = "DUTY" | "BREAK" | "DAY_OFF";

export interface TimetableSlotRecord {
  _id: string;
  schoolId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  dayOfWeek: DayOfWeek;
  /** Teaching: 1–12. BREAK/HOLIDAY: synthetic ≥1000 from start time (not a teaching period). */
  periodNumber: number;
  subjectId: string;
  teacherId: string;
  room?: string;
  startTime: string;
  endTime: string;
  academicYearBs: string;
  /** Optional; missing on legacy rows → treat as THEORY */
  sessionType?: TimetableSessionType;
  breakLabel?: string;
  remarks?: string;
  roomKind?: TimetableRoomKind;
  subjectAssignmentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** One cell of a college staff member's weekly duty timetable. */
export interface StaffTimetableSlotRecord {
  _id: string;
  schoolId: string;
  /** Populated to `{ _id, fullName, staffId, designation, department }` on list. */
  staffId:
    | string
    | {
        _id: string;
        fullName: string;
        staffId?: string;
        designation?: string;
        department?: string;
      };
  dayOfWeek: DayOfWeek;
  /** DUTY: 1–12. BREAK/DAY_OFF: synthetic ≥1000 from start time. */
  periodNumber: number;
  startTime: string;
  endTime: string;
  academicYearBs: string;
  sessionType: StaffTimetableSessionType;
  dutyTitle?: string;
  room?: string;
  department?: string;
  breakLabel?: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AssignmentAttachmentKind = "FILE" | "IMAGE" | "PDF" | "VIDEO" | "LINK";

export interface AssignmentAttachment {
  url: string;
  name: string;
  mimeType?: string;
  kind?: AssignmentAttachmentKind;
}

export interface AssignmentLink {
  title: string;
  url: string;
}

export type AssignmentDeadlineStatus = "UPCOMING" | "DUE_TODAY" | "OVERDUE";

export interface AssignmentRecord {
  _id: string;
  schoolId: string;
  type: AssignmentType;
  title: string;
  description: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  subjectId?: string;
  teacherId: string;
  topic?: string;
  dueDateBs?: string;
  maxMarks?: number;
  rubric?: string;
  visibleTo: UserRole[];
  allowSubmission?: boolean;
  isPinned?: boolean;
  attachments: AssignmentAttachment[];
  links?: AssignmentLink[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AssignmentCommentRecord {
  _id: string;
  schoolId: string;
  assignmentId: string;
  authorUserId: string;
  authorName: string;
  authorRole: UserRole;
  content: string;
  createdAt?: string;
}

export interface ClassroomPost extends AssignmentRecord {
  teacherName: string;
  subjectName: string;
  subjectCode: string;
  className: string;
  sectionName: string;
  deadlineStatus: AssignmentDeadlineStatus | null;
  submissionStatus: AssignmentSubmissionStatus | null;
  submissionId?: string;
  marks?: number;
  feedback?: string;
  commentCount: number;
  /** Number of student submissions (SUBMITTED/GRADED). Useful for teachers. */
  submissionCount?: number;
}

export interface ClassroomFeedResponse {
  posts: ClassroomPost[];
  topics: string[];
  todayBs: string;
  studentId?: string;
}

export interface AssignmentSubmissionRecord {
  _id: string;
  schoolId: string;
  assignmentId: string;
  studentId: string;
  content?: string;
  attachmentUrl?: string;
  marks?: number;
  feedback?: string;
  status: AssignmentSubmissionStatus;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ParentChildLinkRecord {
  _id: string;
  schoolId: string;
  parentUserId: string;
  studentId: string;
  relationship: ParentRelationship;
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationRecord {
  _id: string;
  schoolId: string;
  recipientUserId: string;
  recipientPhone?: string;
  title: string;
  message: string;
  channel: NotificationChannel;
  type: NotificationType;
  read: boolean;
  smsStatus: SmsDeliveryStatus;
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryBookCopyRecord {
  _id: string;
  schoolId: string;
  bookId: string;
  bookCode: string;
  status: LibraryCopyStatus;
  shelfLocation?: string;
  condition?: string;
  /** Publisher / publication imprint for this copy. */
  publication?: string;
  /** Purchase or catalog price of this copy (NPR). */
  priceNpr?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryBookRecord {
  _id: string;
  schoolId: string;
  title: string;
  author: string;
  isbn?: string;
  category: string;
  /** Year level for filtering (1st / 2nd / 3rd Year, or All Years). */
  yearLevel?: LibraryYearLevel;
  totalCopies: number;
  availableCopies: number;
  issuedCopies: number;
  status: InventoryStockStatus;
  shelfLocation?: string;
  /** Individual physical copies with librarian-entered codes. */
  copies?: LibraryBookCopyRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryIssueRecord {
  _id: string;
  schoolId: string;
  bookId: string;
  copyId?: string;
  /** Physical book code (e.g. ANA003) when issued by copy. */
  bookCode?: string;
  borrowerType: LibraryBorrowerType;
  studentId?: string;
  teacherId?: string;
  staffId?: string;
  borrowerName?: string;
  bookTitle?: string;
  /** User who issued the book (admin or library staff). */
  issuedByUserId?: string;
  issuedByName?: string;
  /** Role of issuer for display (e.g. LIBRARY_STAFF, COLLEGE_ADMIN). */
  issuedByRole?: string;
  /** Student academic placement (when borrower is a student). */
  studentBatchId?: string;
  studentBatchName?: string;
  studentYearId?: string;
  studentYearName?: string;
  studentClassId?: string;
  studentClassName?: string;
  studentSectionId?: string;
  studentSectionName?: string;
  issuedDateBs: string;
  dueDateBs: string;
  returnedDateBs?: string;
  fineNpr: number;
  status: LibraryIssueStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryInventoryAccessResponse {
  enabled: boolean;
}

export interface LibraryDashboardResponse {
  totalBooks: number;
  availableBooks: number;
  issuedBooks: number;
  overdueBooks: number;
  /** Total returned issue records (history). */
  returnedBooks: number;
  recentlyIssued: LibraryIssueRecord[];
  /** Latest returned books for dashboard. */
  recentlyReturned: LibraryIssueRecord[];
  inventoryAccessEnabled: boolean;
}

// Laboratory types are exported from laboratory-types.ts via package index only
// (avoid re-export star-export conflicts in Vite).

export interface TransportStop {
  name: string;
  pickupTime?: string;
}

export interface TransportRouteRecord {
  _id: string;
  schoolId: string;
  name: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  stops: TransportStop[];
  monthlyFeeNpr: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TransportAssignmentRecord {
  _id: string;
  schoolId: string;
  routeId: string;
  studentId: string;
  pickupStop: string;
  dropStop: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaveRequestRecord {
  _id: string;
  schoolId: string;
  teacherId: string;
  type: LeaveType;
  startDateBs: string;
  endDateBs: string;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PayrollRecord {
  _id: string;
  schoolId: string;
  teacherId: string;
  monthBs: string;
  basicSalaryNpr: number;
  allowancesNpr: number;
  deductionsNpr: number;
  netSalaryNpr: number;
  status: PayrollStatus;
  paidDateBs?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ParentPortalChildSummary {
  studentId: string;
  fullName: string;
  className: string;
  sectionName: string;
  rollNumber: number;
  feesDueNpr: number;
  attendanceRate: number;
  pendingHomework: number;
  relationship: ParentRelationship;
  /** Fee fields below are returned by GET /parent/portal; blanked when the fee section is off. */
  admissionNumber?: string;
  registrationNumber?: string;
  year1FeeNpr?: number;
  year2FeeNpr?: number;
  year3FeeNpr?: number;
  securityDepositExpectedNpr?: number;
  securityDepositNpr?: number;
  securityDepositRefundedNpr?: number;
  totalPaidNpr?: number;
  totalScholarshipNpr?: number;
  yearWise?: Array<{
    programYear: number;
    label: string;
    chargedNpr: number;
    paidNpr: number;
    scholarshipNpr: number;
    discountNpr: number;
    remainingNpr: number;
    status: "PAID" | "PARTIAL" | "DUE" | "SCHOLARSHIP" | "NO_RECORD";
    scholarshipNote?: string;
  }>;
}

export interface ParentPortalResponse {
  children: ParentPortalChildSummary[];
  recentNotifications: NotificationRecord[];
  upcomingHomework: AssignmentRecord[];
  /** School-level parent portal section switches (admin-configured). */
  portalAccess?: Partial<
    Record<
      | "overview"
      | "attendance"
      | "fees"
      | "homework"
      | "results"
      | "timetable"
      | "field-attendance"
      | "notices"
      | "notifications"
      | "complaints"
      | "library",
      boolean
    >
  >;
}

export interface ParentCandidateFromStudent {
  relationship: ParentFromStudentRelationship;
  fullName: string;
  phone: string;
  suggestedLoginId: string;
  isLinked: boolean;
  existingLinkId?: string;
  existingParentUserId?: string;
  existingParentEmail?: string;
}

export interface StudentParentCandidatesResponse {
  student: {
    _id: string;
    fullName: string;
    admissionNumber: string;
  };
  candidates: ParentCandidateFromStudent[];
}

/** Syllabus hierarchy exposed on student subject detail (read-only). */
export interface StudentSubjectSyllabus {
  _id: string;
  academicYearBs: string;
  subjectCode?: string;
  totalTheoryHours?: number;
  totalPracticalHours?: number;
  creditHours?: number;
  remarks?: string;
  status: string;
  subject?: { _id: string; name: string; code: string };
  chapters: Array<{
    _id: string;
    chapterNo: number;
    sectionKind?: string;
    title: string;
    description?: string;
    units: Array<{
      _id: string;
      unitNo: number;
      title: string;
      description?: string;
      teachingHours?: number;
      learningObjective?: string;
      practicalRequired?: boolean;
      subUnits: Array<{
        _id: string;
        displayNo: string;
        heading: string;
        description?: string;
        teachingHours?: number;
        status?: string;
        children?: StudentSubjectSyllabus["chapters"][number]["units"][number]["subUnits"];
      }>;
    }>;
  }>;
}

export interface StudentSubjectDetail {
  subject: {
    _id: string;
    name: string;
    code: string;
    fullMarks: number;
    passMarks: number;
  };
  attendance: Array<{ dateBs: string; status: string }>;
  marks: Array<{
    examId: string;
    obtainedMarks: number;
    percentage: number;
    grade: string;
    gpa: number;
    publishedAtBs?: string;
  }>;
  assignments: AssignmentRecord[];
  notes: AssignmentRecord[];
  submissions: AssignmentSubmissionRecord[];
  notices: Array<{ _id: string; title: string; content: string; publishDateBs: string }>;
  /** Official syllabus for this subject when available (not rejected). */
  syllabus?: StudentSubjectSyllabus | null;
}