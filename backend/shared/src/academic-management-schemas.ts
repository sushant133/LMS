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

/** Coerce hours; treat NaN / null / empty as 0 so form clear does not fail validation. */
const teachingHoursSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  },
  z.number().min(0).default(0)
);

export const academicSessionPlanUnitSchema = z.object({
  unitNo: z.coerce.number().int().min(1),
  /** Unit heading only (e.g. "Unit 1 : Introduction to Human Anatomy"). Sub-units are not listed. */
  chapterName: z.string().min(1),
  estimatedTeachingHours: teachingHoursSchema,
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
  /** Optional link back to hierarchical syllabus unit (import source). */
  syllabusId: z.string().optional().default(""),
  syllabusChapterId: z.string().optional().default(""),
  syllabusUnitId: z.string().optional().default("")
});

/**
 * Syllabus legacy flat unit — titles are fully optional so partial drafts can save
 * (blank unit title + sub-units only, etc.). Session-plan units stay required separately.
 * Use omit+extend so session-plan's chapterName.min(1) never applies to syllabus.
 */
export const academicSyllabusUnitSchema = academicSessionPlanUnitSchema
  .omit({ chapterName: true })
  .extend({
    chapterName: z.preprocess(
      (v) => (v === undefined || v === null ? "" : String(v)),
      z.string().default("")
    )
  });

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

/** Sub Unit fields shared by all nesting levels (unlimited child depth). */
const academicSyllabusSubUnitBaseFields = {
  /** Client temp id or existing Mongo id (optional on create). */
  clientKey: z.string().optional(),
  /** Empty/0 → undefined; server renumbers siblings. */
  subUnitNo: z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
  }, z.number().int().min(1).optional()),
  /** Optional — blank heading is allowed (draft / partial syllabus). */
  heading: z.string().default(""),
  description: z.string().default(""),
  learningOutcomes: z.string().default(""),
  internalAssessment: z.string().default(""),
  practicalRequired: z.boolean().default(false),
  labName: z.string().default(""),
  requiredEquipment: z.string().default(""),
  hospitalPosting: z.string().default(""),
  /** Coerce NaN/empty so partial drafts never fail validation. */
  clinicalHours: teachingHoursSchema,
  references: syllabusReferencesSchema.optional().default({
    textbooks: "",
    journal: "",
    whoGuidelines: "",
    internetResources: "",
    freeText: ""
  }),
  /** Coerce NaN/empty so partial drafts never fail validation. */
  teachingHours: teachingHoursSchema,
  attachments: z.array(syllabusAttachmentSchema).default([]),
  remarks: z.string().default(""),
  status: syllabusSubUnitStatusSchema.default("NOT_STARTED"),
  teachingNotes: z.string().default(""),
  teacherAttachments: z.array(syllabusAttachmentSchema).default([]),
  todaysCoverage: z.string().default("")
};

/**
 * Sub Unit (sub-topic) under a Unit — supports unlimited nesting via `children`.
 * Numbering is auto-generated as 1.1, 1.1.1, 1.1.1.1, …
 */
export type AcademicSyllabusSubUnitInputShape = {
  clientKey?: string;
  subUnitNo?: number;
  heading: string;
  description?: string;
  learningOutcomes?: string;
  internalAssessment?: string;
  practicalRequired?: boolean;
  labName?: string;
  requiredEquipment?: string;
  hospitalPosting?: string;
  clinicalHours?: number;
  references?: {
    textbooks: string;
    journal: string;
    whoGuidelines: string;
    internetResources: string;
    freeText: string;
  };
  teachingHours?: number;
  attachments?: Array<{
    url: string;
    name: string;
    mimeType?: string;
    kind?: "FILE" | "IMAGE" | "PDF" | "VIDEO" | "LINK" | "WORD" | "EXCEL" | "POWERPOINT";
  }>;
  remarks?: string;
  status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "REVISION_REQUIRED";
  teachingNotes?: string;
  teacherAttachments?: Array<{
    url: string;
    name: string;
    mimeType?: string;
    kind?: "FILE" | "IMAGE" | "PDF" | "VIDEO" | "LINK" | "WORD" | "EXCEL" | "POWERPOINT";
  }>;
  todaysCoverage?: string;
  children?: AcademicSyllabusSubUnitInputShape[];
};

export const academicSyllabusSubUnitSchema: z.ZodType<AcademicSyllabusSubUnitInputShape> = z.lazy(() =>
  z.object({
    ...academicSyllabusSubUnitBaseFields,
    children: z.array(academicSyllabusSubUnitSchema).default([])
  })
);

/** Unit (topic) under a Chapter (or subject when chapter is optional). */
export const academicSyllabusTopicSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const u = raw as Record<string, unknown>;
    // Normalize alternate client field names into `title`
    const titleSrc =
      u.title ?? u.chapterName ?? u.name ?? u.heading ?? u.unitTitle ?? u.unitName;
    return {
      ...u,
      title: titleSrc === undefined || titleSrc === null ? u.title : String(titleSrc)
    };
  },
  z.object({
    clientKey: z.string().optional(),
    /** Empty/0 from forms → undefined; server renumbers continuously. */
    unitNo: z.preprocess((v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
    }, z.number().int().min(1).optional()),
    /** Optional — blank unit title is allowed and stored as empty string. */
    title: z.preprocess(
      (v) => (v === undefined || v === null ? "" : String(v)),
      z.string().trim().default("")
    ),
    description: z.string().default(""),
    /** Coerce NaN/empty from number inputs so save does not fail spuriously. */
    teachingHours: teachingHoursSchema,
    learningObjective: z.string().default(""),
    references: z.string().default(""),
    remarks: z.string().default(""),
    /** Unit-level practical flag (also tracked on sub-units when needed). */
    practicalRequired: z.boolean().default(false),
    subUnits: z.array(academicSyllabusSubUnitSchema).default([])
  })
);

/**
 * Optional grouping under a Subject syllabus.
 * Choose at most one kind: Chapter OR Part (never both). Use NONE to skip grouping.
 */
export const syllabusSectionKindSchema = z.enum(["NONE", "CHAPTER", "PART"]);

export const academicSyllabusChapterSchema = z.object({
  clientKey: z.string().optional(),
  /** Empty/0 from forms → undefined; server renumbers 1..N. */
  chapterNo: z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
  }, z.number().int().min(1).optional()),
  /** NONE = ungrouped units; CHAPTER or PART = optional heading type (pick one). */
  sectionKind: syllabusSectionKindSchema.default("NONE"),
  title: z.string().default(""),
  description: z.string().default(""),
  estimatedHours: teachingHoursSchema,
  weightagePercent: z.coerce.number().min(0).max(100).default(0),
  references: z.string().default(""),
  remarks: z.string().default(""),
  tentativeCompletionMonth: z.string().default(""),
  units: z.array(academicSyllabusTopicSchema).default([])
});

/**
 * Count units present in the payload (titles may be blank — still counted).
 * Used for diagnostics / UI hints only; blank unit titles are valid.
 */
export const countTitledSyllabusUnits = (data: {
  chapters?: Array<{
    title?: string;
    sectionKind?: string;
    units?: Array<Record<string, unknown>>;
  }>;
  units?: unknown[];
}): number => {
  const fromChapters = (data.chapters ?? []).reduce((sum, chapter) => {
    const unitCount = (chapter.units ?? []).length;
    // Chapter/part heading can stand in as one unit when nested units are empty
    if (
      unitCount === 0 &&
      String(chapter.title ?? "").trim() &&
      (chapter.sectionKind === "CHAPTER" ||
        chapter.sectionKind === "PART" ||
        String(chapter.title ?? "").trim().length > 0)
    ) {
      return sum + 1;
    }
    return sum + unitCount;
  }, 0);
  const fromLegacy = Array.isArray(data.units) ? data.units.length : 0;
  return fromChapters + fromLegacy;
};

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
  totalTheoryHours: teachingHoursSchema.optional().default(0),
  totalPracticalHours: teachingHoursSchema.optional().default(0),
  creditHours: teachingHoursSchema.optional().default(0),
  remarks: z.string().optional().default(""),
  attachmentUrl: z.string().optional(),
  /** Preferred hierarchical structure. */
  chapters: z.array(academicSyllabusChapterSchema).optional(),
  /** Legacy flat units — still accepted and auto-migrated into hierarchy. */
  units: z.array(academicSyllabusUnitSchema).optional()
});

/**
 * Syllabus content (unit titles, chapter titles, sub-units) is fully optional.
 * Admins can save drafts with blank unit titles and fill them later.
 */
export const academicSyllabusSchema = academicSyllabusBaseSchema;

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
  /** Optional hierarchical syllabus links (Chapter → Unit → Sub Unit → Child…). */
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

const bsDateRequired = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD BS");

/**
 * One Lesson Plan = one teaching day.
 * Prefer `teachingDateBs`; legacy clients may still send startDateBs/endDateBs
 * (normalized to the same teaching date on the server).
 */
export const academicLessonPlanSchema = scopeSchema
  .extend({
    /** Required: Lesson Plans must be created from a Session Plan (draft or approved). */
    sessionPlanId: z.string().min(1, "A Session Plan is required"),
    academicYearBs: z.string().min(1),
    session: z.string().min(1),
    faculty: z.string().optional(),
    semesterBs: z.string().optional(),
    subjectId: z.string().min(1),
    teacherId: z.string().min(1),
    /** @deprecated Prefer teachingDateBs — kept for older clients. */
    month: z.string().default(""),
    /** Single teaching day (BS). Preferred over start/end range. */
    teachingDateBs: bsDateRequired.or(z.literal("")).optional().default(""),
    /** @deprecated Use teachingDateBs — kept for backward compatibility. */
    startDateBs: bsDateRequired.or(z.literal("")).optional().default(""),
    /** @deprecated Use teachingDateBs — kept for backward compatibility. */
    endDateBs: bsDateRequired.or(z.literal("")).optional().default(""),
    /** Optional free-text description for the plan period. */
    monthlyDescription: z.string().default(""),
    items: z.array(academicLessonPlanItemSchema).min(1)
  })
  .superRefine((data, ctx) => {
    const teachingDate = (data.teachingDateBs || data.startDateBs || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(teachingDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Teaching date (BS) is required",
        path: ["teachingDateBs"]
      });
    }
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
  /** What the teacher intended to achieve during that lesson. */
  objectives: z.string().default(""),
  teachingMethod: z.string().default(""),
  /**
   * @deprecated Replaced by `objectives` in the Log Book form.
   * Kept for backward compatibility with existing records.
   */
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