export type AcademicPlanStatus = "DRAFT" | "SUBMITTED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type LessonPlanItemStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";

export type LogBookReviewStatus = "PENDING" | "REVIEWED" | "APPROVED" | "NEEDS_IMPROVEMENT";

export type AcademicManagementTab =
  | "dashboard"
  | "syllabus"
  | "session-plan"
  | "lesson-plan"
  | "log-book"
  | "reports";

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

export type SyllabusUnitPlanningStatus = "UNPLANNED" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";

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
  /** Unit teaching window (BS YYYY-MM-DD). */
  startDateBs?: string;
  endDateBs?: string;
  status: LessonPlanItemStatus;
  attachmentUrl?: string;
  /** Months where this unit appears in a Lesson Plan (hierarchical coverage). */
  plannedInMonths?: string[];
  planningStatus?: SyllabusUnitPlanningStatus;
}

/** Yearly syllabus coverage: which Session Plan units are planned / remaining / completed. */
export interface SessionPlanSyllabusCoverage {
  sessionPlanId: string;
  subjectId: string;
  teacherId: string;
  academicYearBs: string;
  status: AcademicPlanStatus;
  totalUnits: number;
  plannedUnits: number;
  remainingUnits: number;
  completedUnits: number;
  inProgressUnits: number;
  delayedUnits: number;
  completedPercent: number;
  remainingPercent: number;
  units: Array<
    AcademicSessionPlanUnitRecord & {
      plannedInMonths: string[];
      planningStatus: SyllabusUnitPlanningStatus;
      lessonPlanItemCount: number;
      completedClasses: number;
      estimatedClasses: number;
    }
  >;
  planned: AcademicSessionPlanUnitRecord[];
  remaining: AcademicSessionPlanUnitRecord[];
  completed: AcademicSessionPlanUnitRecord[];
}

/** Official subject syllabus: units/chapters as configurable boxes (before Session Plan). */
export interface AcademicSyllabusUnitRecord {
  _id: string;
  syllabusId: string;
  unitNo: number;
  chapterName: string;
  estimatedTeachingHours: number;
  learningOutcomes: string;
  topicsCovered: string;
  references: string;
  practicalRequired: boolean;
  internalAssessment: string;
  tentativeCompletionMonth: string;
  startDateBs?: string;
  endDateBs?: string;
  status: LessonPlanItemStatus;
  attachmentUrl?: string;
}

export interface AcademicSyllabusRecord extends AcademicManagementScope {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  session: string;
  faculty?: string;
  semesterBs?: string;
  subjectId: string;
  /** Optional owner; access for teachers is by assigned subject. */
  teacherId?: string;
  status: AcademicPlanStatus;
  adminRemarks?: string;
  attachmentUrl?: string;
  units: AcademicSyllabusUnitRecord[];
  completedPercent: number;
  remainingPercent: number;
  completedUnits: number;
  remainingUnits: number;
  audit: AcademicAuditTrail;
  subject?: { _id: string; name: string; code: string };
  teacher?: { _id: string; teacherCode: string; user?: { fullName: string } };
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
  /** Sub-topic selected from the session plan unit's topics list. */
  subUnitTitle?: string;
  subjectLabel: string;
  plannedTopic: string;
  description: string;
  learningObjectives: string;
  teachingMethod: string;
  teachingAids: string;
  assessmentMethod: string;
  deadline: string;
  itemStartDateBs?: string;
  itemEndDateBs?: string;
  estimatedClasses: number;
  completedClasses: number;
  completionStatus: LessonPlanItemStatus;
  remarks: string;
  completedPercent: number;
  /** Percent of estimated classes still remaining (100 - completedPercent, floored at 0). */
  remainingPercent: number;
  unit?: Pick<
    AcademicSessionPlanUnitRecord,
    "_id" | "unitNo" | "chapterName" | "topicsCovered" | "startDateBs" | "endDateBs"
  >;
}

export type AcademicTeacherAlertType = "LOG_BOOK_MISSING" | "LESSON_PLAN_APPROACHING" | "LESSON_PLAN_OVERDUE";

export interface AcademicTeacherAlert {
  type: AcademicTeacherAlertType;
  teacherId: string;
  lessonPlanId?: string;
  lessonPlanItemId?: string;
  subjectName: string;
  topic: string;
  month: string;
  deadline?: string;
  completedPercent: number;
  remainingPercent: number;
  estimatedClasses: number;
  completedClasses: number;
  message: string;
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
  /** @deprecated Prefer startDateBs / endDateBs. */
  month: string;
  startDateBs?: string;
  endDateBs?: string;
  monthlyDescription?: string;
  status: AcademicPlanStatus;
  preparedBy?: string;
  checkedBy?: string;
  approvedByName?: string;
  approvalDate?: string;
  adminRemarks?: string;
  items: AcademicLessonPlanItemRecord[];
  completedPercent: number;
  remainingPercent: number;
  /** Topics planned this month. */
  plannedTopics: number;
  /** Topics completed via Log Book. */
  completedTopics: number;
  /** Topics not yet completed. */
  pendingTopics: number;
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
  subUnitTitle?: string;
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
  /** Overall syllabus still remaining (100 - completion). */
  syllabusRemainingPercent: number;
  teachersPendingLogBook: number;
  /** Actionable teacher alerts: missing log book, near/overdue lesson plans with remaining %. */
  teacherAlerts: AcademicTeacherAlert[];
  monthlyProgress: Array<{ month: string; completed: number; planned: number }>;
  teacherPerformance: Array<{ teacherId: string; teacherName: string; completionPercent: number; remainingPercent: number }>;
  subjectProgress: Array<{ subjectId: string; subjectName: string; completionPercent: number; remainingPercent: number }>;
  facultyProgress: Array<{ faculty: string; completionPercent: number; remainingPercent: number }>;
  syllabusCompletion: Array<{ subjectName: string; percent: number; remainingPercent: number }>;
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