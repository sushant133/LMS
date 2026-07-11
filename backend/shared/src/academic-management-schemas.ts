import { z } from "zod";

const scopeSchema = z.object({
  classId: z.string().optional(),
  sectionId: z.string().optional(),
  batchId: z.string().optional(),
  yearId: z.string().optional()
});

export const academicSessionPlanUnitSchema = z.object({
  unitNo: z.coerce.number().int().min(1),
  chapterName: z.string().min(1),
  estimatedTeachingHours: z.coerce.number().min(0).default(0),
  learningOutcomes: z.string().default(""),
  topicsCovered: z.string().default(""),
  references: z.string().default(""),
  practicalRequired: z.boolean().default(false),
  internalAssessment: z.string().default(""),
  tentativeCompletionMonth: z.string().default(""),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"]).default("PENDING"),
  attachmentUrl: z.string().optional()
});

export const academicSessionPlanSchema = scopeSchema.extend({
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  teacherId: z.string().min(1),
  attachmentUrl: z.string().optional(),
  units: z.array(academicSessionPlanUnitSchema).min(1)
});

export const academicLessonPlanItemSchema = z.object({
  serialNo: z.coerce.number().int().min(1),
  /** Required: every lesson plan topic must map to a Session Plan unit. */
  sessionPlanUnitId: z.string().min(1, "Select a unit from the Session Plan"),
  subjectLabel: z.string().default(""),
  plannedTopic: z.string().min(1),
  description: z.string().default(""),
  learningObjectives: z.string().default(""),
  teachingMethod: z.string().default(""),
  teachingAids: z.string().default(""),
  assessmentMethod: z.string().default(""),
  deadline: z.string().default(""),
  estimatedClasses: z.coerce.number().int().min(1).default(1),
  remarks: z.string().default("")
});

export const academicLessonPlanSchema = scopeSchema.extend({
  /** Required: Lesson Plans must be created from a Session Plan (draft or approved). */
  sessionPlanId: z.string().min(1, "A Session Plan is required"),
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  teacherId: z.string().min(1),
  month: z.string().min(1),
  /** Optional free-text monthly description for the whole plan. */
  monthlyDescription: z.string().default(""),
  items: z.array(academicLessonPlanItemSchema).min(1)
});

export const academicLogBookEntrySchema = scopeSchema.extend({
  lessonPlanId: z.string().optional(),
  /** Required: Log Book must reference a Lesson Plan topic. */
  lessonPlanItemId: z.string().min(1, "Select a planned topic from the monthly Lesson Plan"),
  sessionPlanUnitId: z.string().optional(),
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  teacherId: z.string().min(1),
  timetableSlotId: z.string().optional(),
  dateBs: z.string().min(1),
  unit: z.string().default(""),
  topicCovered: z.string().min(1),
  objectives: z.string().default(""),
  teachingMethod: z.string().default(""),
  teachingAids: z.string().default(""),
  theoryPractical: z.enum(["THEORY", "PRACTICAL", "BOTH"]).default("THEORY"),
  periodNumber: z.coerce.number().int().min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  homeworkGiven: z.string().default(""),
  assignment: z.string().default(""),
  feedback: z.string().default(""),
  difficultiesFaced: z.string().default(""),
  nextClassPlan: z.string().default(""),
  attachmentUrl: z.string().optional()
});

export const academicApprovalActionSchema = z.object({
  remarks: z.string().optional()
});

export const academicRejectActionSchema = z.object({
  remarks: z.string().min(1, "Rejection remarks are required")
});

export const academicCommentSchema = z.object({
  entityType: z.enum(["SESSION_PLAN", "LESSON_PLAN", "LOG_BOOK_ENTRY"]),
  entityId: z.string().min(1),
  comment: z.string().min(1)
});

export const academicLogBookReviewSchema = z.object({
  reviewStatus: z.enum(["REVIEWED", "APPROVED", "NEEDS_IMPROVEMENT"]),
  adminRemarks: z.string().optional(),
  adminSignature: z.string().optional()
});

export type AcademicSessionPlanInput = z.infer<typeof academicSessionPlanSchema>;
export type AcademicLessonPlanInput = z.infer<typeof academicLessonPlanSchema>;
export type AcademicLogBookEntryInput = z.infer<typeof academicLogBookEntrySchema>;