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

export type InventoryStockStatus = "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";

export type LibraryBorrowerType = "STUDENT" | "TEACHER";

export type LaboratoryType = "COMPUTER" | "PHYSICS" | "CHEMISTRY" | "BIOLOGY" | "OTHER";

export type SmsDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type LibraryIssueStatus = "ISSUED" | "RETURNED" | "OVERDUE";

export type LeaveType = "CASUAL" | "SICK" | "MATERNITY" | "UNPAID" | "OTHER";

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export type PayrollStatus = "DRAFT" | "PROCESSED" | "PAID";

export type ParentRelationship = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";

export type ParentFromStudentRelationship = "FATHER" | "MOTHER" | "GUARDIAN";

export interface TimetableSlotRecord {
  _id: string;
  schoolId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  subjectId: string;
  teacherId: string;
  room?: string;
  startTime: string;
  endTime: string;
  academicYearBs: string;
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

export interface LibraryBookRecord {
  _id: string;
  schoolId: string;
  title: string;
  author: string;
  isbn?: string;
  category: string;
  totalCopies: number;
  availableCopies: number;
  issuedCopies: number;
  status: InventoryStockStatus;
  shelfLocation?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryIssueRecord {
  _id: string;
  schoolId: string;
  bookId: string;
  borrowerType: LibraryBorrowerType;
  studentId?: string;
  teacherId?: string;
  borrowerName?: string;
  bookTitle?: string;
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
  recentlyIssued: LibraryIssueRecord[];
  inventoryAccessEnabled: boolean;
}

export interface LaboratoryRecord {
  _id: string;
  schoolId: string;
  name: string;
  type: LaboratoryType;
  customName?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LaboratoryCategoryRecord {
  _id: string;
  schoolId: string;
  laboratoryId: string;
  name: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LaboratoryEquipmentRecord {
  _id: string;
  schoolId: string;
  laboratoryId: string;
  categoryId: string;
  categoryName?: string;
  laboratoryName?: string;
  name: string;
  itemCode: string;
  quantity: number;
  availableQuantity: number;
  issuedQuantity: number;
  status: InventoryStockStatus;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LaboratoryIssueRecord {
  _id: string;
  schoolId: string;
  equipmentId: string;
  equipmentName?: string;
  teacherId: string;
  teacherName?: string;
  quantity: number;
  issuedDateBs: string;
  dueDateBs: string;
  returnedDateBs?: string;
  status: LibraryIssueStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface LaboratoryDashboardResponse {
  totalEquipment: number;
  availableEquipment: number;
  issuedEquipment: number;
  remainingStock: number;
  lowStockItems: LaboratoryEquipmentRecord[];
}

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
}

export interface ParentPortalResponse {
  children: ParentPortalChildSummary[];
  recentNotifications: NotificationRecord[];
  upcomingHomework: AssignmentRecord[];
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
}