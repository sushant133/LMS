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
  attachmentUrl: z.string().optional(),
  /** Optional link back to hierarchical syllabus chapter. */
  syllabusId: z.string().optional().default(""),
  syllabusChapterId: z.string().optional().default("")
});

/** Syllabus unit box — same structure as session-plan units (legacy flat shape; still accepted). */
export const academicSyllabusUnitSchema = academicSessionPlanUnitSchema;

/** Hierarchical syllabus progress status (sub-unit level). */
export const syllabusSubUnitStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "REVISION_REQUIRED"
]);

const syllabusAttachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().default(""),
  mimeType: z.string().optional(),
  kind: z.enum(["FILE", "IMAGE", "PDF", "VIDEO", "LINK", "WORD", "EXCEL", "POWERPOINT"]).optional()
});

const syllabusReferencesSchema = z.object({
  textbooks: z.string().default(""),
  journal: z.string().default(""),
  whoGuidelines: z.string().default(""),
  internetResources: z.string().default(""),
  freeText: z.string().default("")
});

/** Sub Unit (sub-topic) under a Unit. */
export const academicSyllabusSubUnitSchema = z.object({
  /** Client temp id or existing Mongo id (optional on create). */
  clientKey: z.string().optional(),
  subUnitNo: z.coerce.number().int().min(1).optional(),
  heading: z.string().min(1),
  description: z.string().default(""),
  learningOutcomes: z.string().default(""),
  internalAssessment: z.string().default(""),
  practicalRequired: z.boolean().default(false),
  labName: z.string().default(""),
  requiredEquipment: z.string().default(""),
  hospitalPosting: z.string().default(""),
  clinicalHours: z.coerce.number().min(0).default(0),
  references: syllabusReferencesSchema.optional().default({
    textbooks: "",
    journal: "",
    whoGuidelines: "",
    internetResources: "",
    freeText: ""
  }),
  teachingHours: z.coerce.number().min(0).default(0),
  attachments: z.array(syllabusAttachmentSchema).default([]),
  remarks: z.string().default(""),
  status: syllabusSubUnitStatusSchema.default("NOT_STARTED"),
  teachingNotes: z.string().default(""),
  teacherAttachments: z.array(syllabusAttachmentSchema).default([]),
  todaysCoverage: z.string().default("")
});

/** Unit (topic) under a Chapter. */
export const academicSyllabusTopicSchema = z.object({
  clientKey: z.string().optional(),
  unitNo: z.coerce.number().int().min(1).optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  teachingHours: z.coerce.number().min(0).default(0),
  learningObjective: z.string().default(""),
  references: z.string().default(""),
  remarks: z.string().default(""),
  subUnits: z.array(academicSyllabusSubUnitSchema).default([])
});

/** Chapter under a Subject syllabus. */
export const academicSyllabusChapterSchema = z.object({
  clientKey: z.string().optional(),
  chapterNo: z.coerce.number().int().min(1).optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  estimatedHours: z.coerce.number().min(0).default(0),
  weightagePercent: z.coerce.number().min(0).max(100).default(0),
  references: z.string().default(""),
  remarks: z.string().default(""),
  tentativeCompletionMonth: z.string().default(""),
  units: z.array(academicSyllabusTopicSchema).default([])
});

/** Base shape (supports .partial() for updates). */
export const academicSyllabusBaseSchema = scopeSchema.extend({
  academicYearBs: z.string().min(1),
  session: z.string().min(1),
  faculty: z.string().optional(),
  semesterBs: z.string().optional(),
  subjectId: z.string().min(1),
  /** Optional — syllabus is subject-level; teachers access via subject assignment. */
  teacherId: z.string().optional().default(""),
  /** Optional display code; falls back to subject code when empty. */
  subjectCode: z.string().optional().default(""),
  totalTheoryHours: z.coerce.number().min(0).optional().default(0),
  totalPracticalHours: z.coerce.number().min(0).optional().default(0),
  creditHours: z.coerce.number().min(0).optional().default(0),
  remarks: z.string().optional().default(""),
  attachmentUrl: z.string().optional(),
  /** Preferred hierarchical structure. */
  chapters: z.array(academicSyllabusChapterSchema).optional(),
  /** Legacy flat units — still accepted and auto-migrated into hierarchy. */
  units: z.array(academicSyllabusUnitSchema).optional()
});

export const academicSyllabusSchema = academicSyllabusBaseSchema.superRefine((data, ctx) => {
  const hasChapters = Array.isArray(data.chapters) && data.chapters.length > 0;
  const hasUnits = Array.isArray(data.units) && data.units.length > 0;
  if (!hasChapters && !hasUnits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one chapter or unit is required",
      path: ["chapters"]
    });
  }
});

/** Partial update schema (header and/or hierarchy). */
export const academicSyllabusUpdateSchema = academicSyllabusBaseSchema.partial();

/** Teacher-only progress update on a sub-unit (no structure changes). */
export const academicSyllabusSubUnitProgressSchema = z.object({
  status: syllabusSubUnitStatusSchema.optional(),
  teachingNotes: z.string().optional(),
  teacherAttachments: z.array(syllabusAttachmentSchema).optional(),
  todaysCoverage: z.string().optional(),
  remarks: z.string().optional()
});

/** Reorder payload for chapters / units / sub-units within a syllabus. */
export const academicSyllabusReorderSchema = z.object({
  /** Ordered chapter ids (full list for the syllabus). */
  chapterIds: z.array(z.string()).optional(),
  /** chapterId → ordered unit ids */
  unitIdsByChapter: z.record(z.string(), z.array(z.string())).optional(),
  /** unitId → ordered sub-unit ids */
  subUnitIdsByUnit: z.record(z.string(), z.array(z.string())).optional()
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
  /** Optional hierarchical syllabus links. */
  syllabusId: z.string().optional().default(""),
  syllabusChapterId: z.string().optional().default(""),
  syllabusUnitId: z.string().optional().default(""),
  syllabusSubUnitId: z.string().optional().default(""),
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
  /** Optional hierarchical syllabus links for coverage tracking. */
  syllabusId: z.string().optional().default(""),
  syllabusChapterId: z.string().optional().default(""),
  syllabusUnitId: z.string().optional().default(""),
  syllabusSubUnitId: z.string().optional().default(""),
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
export type AcademicSyllabusChapterInput = z.infer<typeof academicSyllabusChapterSchema>;
export type AcademicSyllabusTopicInput = z.infer<typeof academicSyllabusTopicSchema>;
export type AcademicSyllabusSubUnitInput = z.infer<typeof academicSyllabusSubUnitSchema>;
export type AcademicSyllabusSubUnitProgressInput = z.infer<typeof academicSyllabusSubUnitProgressSchema>;
export type AcademicSyllabusReorderInput = z.infer<typeof academicSyllabusReorderSchema>;
export type AcademicSessionPlanInput = z.infer<typeof academicSessionPlanSchema>;
export type AcademicLessonPlanInput = z.infer<typeof academicLessonPlanSchema>;
export type AcademicLogBookEntryInput = z.infer<typeof academicLogBookEntrySchema>;