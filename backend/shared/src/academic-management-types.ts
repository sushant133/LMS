export type AcademicPlanStatus = "DRAFT" | "SUBMITTED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type LessonPlanItemStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";

export type LogBookReviewStatus = "PENDING" | "REVIEWED" | "APPROVED" | "NEEDS_IMPROVEMENT";

export type AcademicManagementTab = "dashboard" | "session-plan" | "lesson-plan" | "log-book" | "reports";

export type AcademicReportType =
  | "session-plan"
  | "lesson-plan"
  | "teacher-lesson-plan"
  | "teacher-log-book"
  | "monthly-teaching"
  | "subject-progress"
  | "syllabus-completion"
  | "faculty-wise"
  | "year-wise"
  | "teacher-performance"
  | "daily-teaching"
  | "pending-log-book"
  | "late-submission"
  | "pending-approvals";

export interface AcademicReportResponse {
  title: string;
  rows: Array<Record<string, unknown>>;
}

export interface AcademicManagementScope {
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
}

export interface AcademicManagementFilters extends AcademicManagementScope {
  academicYearBs?: string;
  session?: string;
  faculty?: string;
  semesterBs?: string;
  subjectId?: string;
  teacherId?: string;
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AcademicPlanStatus | LogBookReviewStatus;
  keyword?: string;
}

export interface AcademicAuditTrail {
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  deletedBy?: string;
  deletedAt?: string;
}

export interface AcademicSessionPlanUnitRecord {
  _id: string;
  sessionPlanId: string;
  unitNo: number;
  chapterName: string;
  estimatedTeachingHours: number;
  learningOutcomes: string;
  topicsCovered: string;
  references: string;
  practicalRequired: boolean;
  internalAssessment: string;
  tentativeCompletionMonth: string;
  status: LessonPlanItemStatus;
  attachmentUrl?: string;
}

export interface AcademicSessionPlanRecord extends AcademicManagementScope {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  session: string;
  faculty?: string;
  semesterBs?: string;
  subjectId: string;
  teacherId: string;
  status: AcademicPlanStatus;
  adminRemarks?: string;
  attachmentUrl?: string;
  units: AcademicSessionPlanUnitRecord[];
  completedPercent: number;
  remainingPercent: number;
  completedUnits: number;
  remainingUnits: number;
  audit: AcademicAuditTrail;
  subject?: { _id: string; name: string; code: string };
  teacher?: { _id: string; teacherCode: string; user?: { fullName: string } };
}

export interface AcademicLessonPlanItemRecord {
  _id: string;
  lessonPlanId: string;
  serialNo: number;
  sessionPlanUnitId?: string;
  subjectLabel: string;
  plannedTopic: string;
  description: string;
  learningObjectives: string;
  teachingMethod: string;
  teachingAids: string;
  assessmentMethod: string;
  deadline: string;
  estimatedClasses: number;
  completedClasses: number;
  completionStatus: LessonPlanItemStatus;
  remarks: string;
  completedPercent: number;
  unit?: Pick<AcademicSessionPlanUnitRecord, "_id" | "unitNo" | "chapterName">;
}

export interface AcademicLessonPlanRecord extends AcademicManagementScope {
  _id: string;
  schoolId: string;
  sessionPlanId?: string;
  academicYearBs: string;
  session: string;
  faculty?: string;
  semesterBs?: string;
  subjectId: string;
  teacherId: string;
  month: string;
  status: AcademicPlanStatus;
  preparedBy?: string;
  checkedBy?: string;
  approvedByName?: string;
  approvalDate?: string;
  adminRemarks?: string;
  items: AcademicLessonPlanItemRecord[];
  completedPercent: number;
  remainingPercent: number;
  pendingUnits: number;
  delayedUnits: number;
  audit: AcademicAuditTrail;
  subject?: { _id: string; name: string; code: string };
  teacher?: { _id: string; teacherCode: string; user?: { fullName: string } };
}

export interface AcademicLogBookEntryRecord extends AcademicManagementScope {
  _id: string;
  schoolId: string;
  logBookId?: string;
  lessonPlanId?: string;
  lessonPlanItemId?: string;
  sessionPlanUnitId?: string;
  academicYearBs: string;
  session: string;
  faculty?: string;
  semesterBs?: string;
  subjectId: string;
  teacherId: string;
  timetableSlotId?: string;
  serialNo: number;
  dateBs: string;
  unit: string;
  topicCovered: string;
  objectives: string;
  teachingMethod: string;
  teachingAids: string;
  theoryPractical: "THEORY" | "PRACTICAL" | "BOTH";
  periodNumber: number;
  startTime?: string;
  endTime?: string;
  attendancePresent: number;
  attendanceAbsent: number;
  attendancePercent: number;
  homeworkGiven: string;
  assignment: string;
  feedback: string;
  difficultiesFaced: string;
  nextClassPlan: string;
  attachmentUrl?: string;
  reviewStatus: LogBookReviewStatus;
  teacherSignature?: string;
  adminSignature?: string;
  adminRemarks?: string;
  audit: AcademicAuditTrail;
  subject?: { _id: string; name: string; code: string };
  teacher?: { _id: string; teacherCode: string; user?: { fullName: string } };
}

export interface AcademicCommentRecord {
  _id: string;
  schoolId?: string;
  entityType: "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY";
  entityId: string;
  authorUserId?: string;
  authorRole: string;
  authorName: string;
  comment: string;
  createdAt?: string;
}

export interface AcademicProgressRecord {
  _id: string;
  schoolId: string;
  sessionPlanId: string;
  subjectId: string;
  teacherId: string;
  academicYearBs: string;
  completedPercent: number;
  remainingPercent: number;
  completedUnits: number;
  remainingUnits: number;
  delayedUnits: number;
  updatedAt: string;
}

export interface AcademicManagementDashboard {
  totalSubjects: number;
  totalSessionPlans: number;
  totalLessonPlans: number;
  todaysLogBooks: number;
  approvedPlans: number;
  pendingApprovals: number;
  delayedLessonPlans: number;
  syllabusCompletionPercent: number;
  teachersPendingLogBook: number;
  monthlyProgress: Array<{ month: string; completed: number; planned: number }>;
  teacherPerformance: Array<{ teacherId: string; teacherName: string; completionPercent: number }>;
  subjectProgress: Array<{ subjectId: string; subjectName: string; completionPercent: number }>;
  facultyProgress: Array<{ faculty: string; completionPercent: number }>;
  syllabusCompletion: Array<{ subjectName: string; percent: number }>;
}

export interface TodayTimetableSlot {
  _id: string;
  subjectId: string;
  subjectName: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  className?: string;
  sectionName?: string;
  batchName?: string;
  yearName?: string;
}

export interface SessionAttendanceSummary {
  present: number;
  absent: number;
  percent: number;
  marked: boolean;
}