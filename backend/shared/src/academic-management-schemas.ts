import { z } from "zod";

const scopeSchema = z.object({
  classId: z.string().optional(),
  sectionId: z.string().optional(),
  batchId: z.string().optional(),
  yearId: z.string().optional()
});

const bsDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD BS")
  .or(z.literal(""))
  .optional()
  .default("");

export const academicSessionPlanUnitSchema = z.object({
  unitNo: z.coerce.number().int().min(1),
  chapterName: z.string().min(1),
  estimatedTeachingHours: z.coerce.number().min(0).default(0),
  learningOutcomes: z.string().default(""),
  /** Free-text topics; each line/semicolon-separated entry is a selectable sub-unit. */
  topicsCovered: z.string().default(""),
  references: z.string().default(""),
  practicalRequired: z.boolean().default(false),
  internalAssessment: z.string().default(""),
  tentativeCompletionMonth: z.string().default(""),
  /** Unit teaching window (BS). */
  startDateBs: bsDateOptional,
  endDateBs: bsDateOptional,
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"]).default("PENDING"),
  attachmentUrl: z.string().optional()
});

/** Syllabus unit box — same structure as session-plan units (add/remove freely). */
export const academicSyllabusUnitSchema = academicSessionPlanUnitSchema;

export const academicSyllabusSchema = scopeSchema.extend({
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  /** Optional — syllabus is subject-level; teachers access via subject assignment. */
  teacherId: z.string().optional().default(""),
  attachmentUrl: z.string().optional(),
  units: z.array(academicSyllabusUnitSchema).min(1)
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
  /** Optional sub-topic from the unit's topics list. */
  subUnitTitle: z.string().default(""),
  subjectLabel: z.string().default(""),
  plannedTopic: z.string().min(1),
  description: z.string().default(""),
  learningObjectives: z.string().default(""),
  teachingMethod: z.string().default(""),
  teachingAids: z.string().default(""),
  assessmentMethod: z.string().default(""),
  deadline: z.string().default(""),
  itemStartDateBs: bsDateOptional,
  itemEndDateBs: bsDateOptional,
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
  /** @deprecated Prefer startDateBs/endDateBs — kept for older clients. */
  month: z.string().default(""),
  startDateBs: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date (BS) is required"),
  endDateBs: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date (BS) is required"),
  /** Optional free-text description for the plan period. */
  monthlyDescription: z.string().default(""),
  items: z.array(academicLessonPlanItemSchema).min(1)
});

export const academicLogBookEntrySchema = scopeSchema.extend({
  lessonPlanId: z.string().optional(),
  /** Preferred: link to a Lesson Plan topic when available. */
  lessonPlanItemId: z.string().optional().default(""),
  sessionPlanUnitId: z.string().min(1, "Select a unit from the Session Plan"),
  subUnitTitle: z.string().default(""),
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  teacherId: z.string().min(1),
  timetableSlotId: z.string().optional(),
  dateBs: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date (BS) is required"),
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
  entityType: z.enum(["SYLLABUS", "SESSION_PLAN", "LESSON_PLAN", "LOG_BOOK_ENTRY"]),
  entityId: z.string().min(1),
  comment: z.string().min(1)
});

export const academicLogBookReviewSchema = z.object({
  reviewStatus: z.enum(["REVIEWED", "APPROVED", "NEEDS_IMPROVEMENT"]),
  adminRemarks: z.string().optional(),
  adminSignature: z.string().optional()
});

export type AcademicSyllabusInput = z.infer<typeof academicSyllabusSchema>;
export type AcademicSessionPlanInput = z.infer<typeof academicSessionPlanSchema>;
export type AcademicLessonPlanInput = z.infer<typeof academicLessonPlanSchema>;
export type AcademicLogBookEntryInput = z.infer<typeof academicLogBookEntrySchema>;