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
  /** Unit heading only (e.g. "Unit 1 : Introduction to Human Anatomy"). */
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
  /** Optional link to hierarchical syllabus unit (import source). */
  syllabusId?: string;
  syllabusChapterId?: string;
  syllabusUnitId?: string;
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

/** Hierarchical syllabus progress status (sub-unit level). */
export type SyllabusSubUnitStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED"
  | "REVISION_REQUIRED";

export interface SyllabusAttachmentRecord {
  url: string;
  name: string;
  mimeType?: string;
  kind?: "FILE" | "IMAGE" | "PDF" | "VIDEO" | "LINK" | "WORD" | "EXCEL" | "POWERPOINT";
}

export interface SyllabusReferencesRecord {
  textbooks: string;
  journal: string;
  whoGuidelines: string;
  internetResources: string;
  freeText: string;
}

export interface AcademicSyllabusSubUnitRecord {
  _id: string;
  syllabusId: string;
  chapterId: string;
  unitId: string;
  /** Parent sub-unit id when nested; empty/undefined for top-level under the unit. */
  parentSubUnitId?: string;
  /** Sibling index under the parent (1, 2, 3…). */
  subUnitNo: number;
  /** Computed hierarchical label e.g. "1.1", "1.1.1", "1.1.1.1". */
  displayNo: string;
  /** Nesting depth under the unit (0 = direct child of unit). */
  depth: number;
  heading: string;
  description: string;
  learningOutcomes: string;
  internalAssessment: string;
  practicalRequired: boolean;
  labName: string;
  requiredEquipment: string;
  hospitalPosting: string;
  clinicalHours: number;
  references: SyllabusReferencesRecord;
  teachingHours: number;
  attachments: SyllabusAttachmentRecord[];
  remarks: string;
  status: SyllabusSubUnitStatus;
  teachingNotes: string;
  teacherAttachments: SyllabusAttachmentRecord[];
  todaysCoverage: string;
  completedPercent: number;
  /** Nested child sub-units (unlimited depth). */
  children: AcademicSyllabusSubUnitRecord[];
}

export interface AcademicSyllabusTopicRecord {
  _id: string;
  syllabusId: string;
  chapterId: string;
  unitNo: number;
  title: string;
  description: string;
  teachingHours: number;
  learningObjective: string;
  references: string;
  remarks: string;
  practicalRequired: boolean;
  /** Top-level sub-units; each may contain nested children. */
  subUnits: AcademicSyllabusSubUnitRecord[];
  completedPercent: number;
  remainingPercent: number;
  completedSubUnits: number;
  remainingSubUnits: number;
  totalSubUnits: number;
}

/** Optional syllabus section type: Chapter OR Part (not both). NONE = no grouping. */
export type SyllabusSectionKind = "NONE" | "CHAPTER" | "PART";

export interface AcademicSyllabusChapterRecord {
  _id: string;
  syllabusId: string;
  chapterNo: number;
  /** NONE | CHAPTER | PART — only one kind; optional. */
  sectionKind: SyllabusSectionKind;
  title: string;
  description: string;
  estimatedHours: number;
  weightagePercent: number;
  references: string;
  remarks: string;
  tentativeCompletionMonth: string;
  units: AcademicSyllabusTopicRecord[];
  completedPercent: number;
  remainingPercent: number;
  completedSubUnits: number;
  remainingSubUnits: number;
  totalSubUnits: number;
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
  subjectCode?: string;
  totalTheoryHours?: number;
  totalPracticalHours?: number;
  creditHours?: number;
  remarks?: string;
  status: AcademicPlanStatus;
  adminRemarks?: string;
  attachmentUrl?: string;
  /** Hierarchical chapters → units → sub-units. */
  chapters: AcademicSyllabusChapterRecord[];
  /**
   * Legacy flat units derived from hierarchy (or original rows before migration).
   * Kept for Session Plan import and older clients.
   */
  units: AcademicSyllabusUnitRecord[];
  completedPercent: number;
  remainingPercent: number;
  completedUnits: number;
  remainingUnits: number;
  completedSubUnits: number;
  remainingSubUnits: number;
  totalSubUnits: number;
  totalChapters: number;
  totalTopics: number;
  theoryHoursCovered: number;
  practicalHoursCovered: number;
  teachingHoursCovered: number;
  remainingTeachingHours: number;
  audit: AcademicAuditTrail;
  subject?: { _id: string; name: string; code: string };
  teacher?: { _id: string; teacherCode: string; user?: { fullName: string } };
}

/** Aggregate progress report row for hierarchical syllabus. */
export interface SyllabusHierarchyProgressReport {
  title: string;
  rows: Array<Record<string, unknown>>;
  summary: {
    totalSubjects: number;
    totalChapters: number;
    totalUnits: number;
    totalSubUnits: number;
    completedSubUnits: number;
    pendingSubUnits: number;
    completionPercent: number;
    theoryHours: number;
    practicalHours: number;
    teachingHoursCovered: number;
    remainingHours: number;
  };
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
  /** Hierarchical syllabus links (Subject → Chapter → Unit → Sub Unit → Child…). */
  syllabusId?: string;
  syllabusChapterId?: string;
  syllabusUnitId?: string;
  syllabusSubUnitId?: string;
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
    | "_id"
    | "unitNo"
    | "chapterName"
    | "topicsCovered"
    | "startDateBs"
    | "endDateBs"
    | "syllabusId"
    | "syllabusChapterId"
    | "syllabusUnitId"
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
  /** @deprecated Prefer teachingDateBs. */
  month: string;
  /** Single teaching day (BS YYYY-MM-DD). One lesson plan = one teaching day. */
  teachingDateBs?: string;
  /** @deprecated Use teachingDateBs — kept for backward compatibility. */
  startDateBs?: string;
  /** @deprecated Use teachingDateBs — kept for backward compatibility. */
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
  syllabusId?: string;
  syllabusChapterId?: string;
  syllabusUnitId?: string;
  syllabusSubUnitId?: string;
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
  /** What the teacher intended to achieve during that lesson. */
  objectives: string;
  teachingMethod: string;
  /** @deprecated Replaced by objectives in the Log Book form. */
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