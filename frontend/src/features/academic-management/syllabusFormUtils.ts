import type {
  AcademicSyllabusChapterInput,
  AcademicSyllabusInput,
  AcademicSyllabusRecord,
  AcademicSyllabusSubUnitInput,
  AcademicSyllabusTopicInput,
  AcademicManagementFilters,
  SyllabusSubUnitStatus,
} from "@phit-erp/shared";
import { ensureUnicodeNepali } from "lib/preetiToUnicode";

/**
 * Text normalize for payload. When nepaliMode is false, return text unchanged
 * (other subjects must not run Preeti conversion).
 */
const textForPayload = (
  text: string | undefined | null,
  nepaliMode: boolean,
): string => {
  const raw = text || "";
  return nepaliMode ? ensureUnicodeNepali(raw) : raw;
};

export type SubUnitDraft = AcademicSyllabusSubUnitInput & {
  clientKey: string;
  children: SubUnitDraft[];
};
export type UnitDraft = Omit<AcademicSyllabusTopicInput, "subUnits"> & {
  clientKey: string;
  subUnits: SubUnitDraft[];
};
export type ChapterDraft = Omit<AcademicSyllabusChapterInput, "units"> & {
  clientKey: string;
  units: UnitDraft[];
};

export type SyllabusFormState = Omit<AcademicSyllabusInput, "chapters" | "units"> & {
  chapters: ChapterDraft[];
};

let keySeq = 0;
export const nextClientKey = (prefix = "k") => `${prefix}-${Date.now()}-${++keySeq}`;

export const emptyReferences = () => ({
  textbooks: "",
  journal: "",
  whoGuidelines: "",
  internetResources: "",
  freeText: "",
});

export const emptySubUnit = (subUnitNo = 1): SubUnitDraft => ({
  clientKey: nextClientKey("sub"),
  subUnitNo,
  heading: "",
  description: "",
  learningOutcomes: "",
  internalAssessment: "",
  practicalRequired: false,
  labName: "",
  requiredEquipment: "",
  hospitalPosting: "",
  clinicalHours: 0,
  references: emptyReferences(),
  teachingHours: 0,
  attachments: [],
  remarks: "",
  status: "NOT_STARTED",
  teachingNotes: "",
  teacherAttachments: [],
  todaysCoverage: "",
  children: [],
});

export const emptyUnit = (unitNo = 1): UnitDraft => ({
  clientKey: nextClientKey("unit"),
  unitNo,
  title: "",
  description: "",
  teachingHours: 0,
  learningObjective: "",
  references: "",
  remarks: "",
  practicalRequired: false,
  /** Sub-units are optional — start empty; user can add headings when needed. */
  subUnits: [],
});

export type SectionKind = "NONE" | "CHAPTER" | "PART";

export const emptyChapter = (
  chapterNo = 1,
  sectionKind: SectionKind = "NONE",
): ChapterDraft => ({
  clientKey: nextClientKey("ch"),
  chapterNo,
  sectionKind,
  title: "",
  description: "",
  estimatedHours: 0,
  weightagePercent: 0,
  references: "",
  remarks: "",
  tentativeCompletionMonth: "",
  units: [emptyUnit(1)],
});

/** Display label for optional Chapter or Part (never both). */
export const formatSectionLabel = (
  kind: SectionKind | string | undefined,
  no: number,
  title?: string,
  nepali = false,
): string => {
  const t = (title || "").trim();
  if (kind === "CHAPTER") {
    if (nepali) {
      const digits = "०१२३४५६७८९";
      const n = String(no)
        .split("")
        .map((d) => digits[Number(d)] ?? d)
        .join("");
      return t ? `अध्याय ${n}: ${t}` : `अध्याय ${n}`;
    }
    return t ? `Chapter ${no}: ${t}` : `Chapter ${no}`;
  }
  if (kind === "PART") {
    if (nepali) {
      const digits = "०१२३४५६७८९";
      const n = String(no)
        .split("")
        .map((d) => digits[Number(d)] ?? d)
        .join("");
      return t ? `भाग ${n}: ${t}` : `भाग ${n}`;
    }
    return t ? `Part ${no}: ${t}` : `Part ${no}`;
  }
  if (nepali) {
    return t || "एकाइहरू (अध्याय / भाग बिना)";
  }
  return t || "Units (no Chapter / Part)";
};

export const blankSyllabusForm = (
  filters: AcademicManagementFilters,
): SyllabusFormState => ({
  academicYearBs: filters.academicYearBs || "2082/083",
  session: filters.session || filters.academicYearBs || "2082/083",
  faculty: filters.faculty || "",
  semesterBs: filters.semesterBs || "",
  classId: filters.classId,
  sectionId: filters.sectionId,
  batchId: filters.batchId,
  yearId: filters.yearId,
  subjectId: filters.subjectId || "",
  teacherId: filters.teacherId || "",
  subjectCode: "",
  totalTheoryHours: 0,
  totalPracticalHours: 0,
  creditHours: 0,
  remarks: "",
  attachmentUrl: "",
  chapters: [emptyChapter(1)],
});

/** Flatten nested sub-units depth-first. */
export const flattenSubUnitDrafts = (subs: SubUnitDraft[]): SubUnitDraft[] => {
  const out: SubUnitDraft[] = [];
  const walk = (nodes: SubUnitDraft[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(subs);
  return out;
};

/** Count all sub-units including nested children. */
export const countSubUnits = (subs: SubUnitDraft[]): number =>
  flattenSubUnitDrafts(subs).length;

/** Auto-number siblings (and nested children) after reorder. */
const renumberSubTree = (subs: SubUnitDraft[]): SubUnitDraft[] =>
  subs.map((sub, index) => ({
    ...sub,
    subUnitNo: index + 1,
    children: renumberSubTree(sub.children ?? []),
  }));

/**
 * Renumber chapters 1..N and units continuously across the whole syllabus:
 * Chapter 1 → units 1..5, Chapter 2 → units 6..10, etc.
 * Sub-unit sibling numbers stay local under each unit (1.1, 6.1, …).
 */
export const renumberChapters = (chapters: ChapterDraft[]): ChapterDraft[] => {
  let unitSeq = 0;
  return chapters.map((chapter, cIndex) => {
    const kind = (chapter.sectionKind as SectionKind) || "NONE";
    return {
      ...chapter,
      chapterNo: cIndex + 1,
      sectionKind: kind,
      // Clear title when grouping is skipped
      title: kind === "NONE" ? "" : chapter.title || "",
      units: chapter.units.map((unit) => {
        unitSeq += 1;
        return {
          ...unit,
          unitNo: unitSeq,
          subUnits: renumberSubTree(unit.subUnits ?? []),
        };
      }),
    };
  });
};

/** Build display number for a sub-unit path under a unit (e.g. 1.2.1). */
export const displayNoForPath = (unitNo: number, path: number[]): string => {
  const parts = path.map((i) => i + 1);
  return [unitNo, ...parts].join(".");
};

/** Update a nested sub-unit by index path. */
export const updateSubAtPath = (
  subs: SubUnitDraft[],
  path: number[],
  patch: Partial<SubUnitDraft> | ((sub: SubUnitDraft) => SubUnitDraft),
): SubUnitDraft[] => {
  if (path.length === 0) return subs;
  const [head, ...rest] = path;
  return subs.map((sub, index) => {
    if (index !== head) return sub;
    if (rest.length === 0) {
      return typeof patch === "function" ? patch(sub) : { ...sub, ...patch };
    }
    return {
      ...sub,
      children: updateSubAtPath(sub.children ?? [], rest, patch),
    };
  });
};

/** Remove a nested sub-unit by index path. */
export const removeSubAtPath = (subs: SubUnitDraft[], path: number[]): SubUnitDraft[] => {
  if (path.length === 0) return subs;
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return subs.filter((_, i) => i !== head);
  }
  return subs.map((sub, index) => {
    if (index !== head) return sub;
    return {
      ...sub,
      children: removeSubAtPath(sub.children ?? [], rest),
    };
  });
};

/** Move sibling at path up/down. */
export const moveSubAtPath = (
  subs: SubUnitDraft[],
  path: number[],
  direction: -1 | 1,
): SubUnitDraft[] => {
  if (path.length === 0) return subs;
  const head = path[0];
  if (head === undefined) return subs;
  const rest = path.slice(1);
  if (rest.length === 0) {
    return moveItem(subs, head, head + direction);
  }
  return subs.map((sub, index) => {
    if (index !== head) return sub;
    return {
      ...sub,
      children: moveSubAtPath(sub.children ?? [], rest, direction),
    };
  });
};

/** Add a child under the node at path (empty path = top-level list). */
export const addChildAtPath = (
  subs: SubUnitDraft[],
  path: number[],
  child: SubUnitDraft,
): SubUnitDraft[] => {
  if (path.length === 0) {
    return [...subs, child];
  }
  const head = path[0];
  if (head === undefined) return subs;
  const rest = path.slice(1);
  return subs.map((sub, index) => {
    if (index !== head) return sub;
    if (rest.length === 0) {
      return {
        ...sub,
        children: [...(sub.children ?? []), child],
      };
    }
    return {
      ...sub,
      children: addChildAtPath(sub.children ?? [], rest, child),
    };
  });
};

/**
 * Insert a sibling after the node at path (same nesting level).
 * e.g. path of 1.1.1 → insert 1.1.2 after it.
 */
export const addSiblingAfterPath = (
  subs: SubUnitDraft[],
  path: number[],
  sibling: SubUnitDraft,
): SubUnitDraft[] => {
  if (path.length === 0) {
    return [...subs, sibling];
  }
  if (path.length === 1) {
    const idx = path[0];
    if (idx === undefined) return [...subs, sibling];
    const next = [...subs];
    next.splice(idx + 1, 0, sibling);
    return next;
  }
  const head = path[0];
  if (head === undefined) return subs;
  const rest = path.slice(1);
  return subs.map((sub, index) => {
    if (index !== head) return sub;
    return {
      ...sub,
      children: addSiblingAfterPath(sub.children ?? [], rest, sibling),
    };
  });
};

/** Append a top-level sub-unit under the unit (1.1, 1.2, …). */
export const appendTopLevelSub = (
  subs: SubUnitDraft[],
  child?: SubUnitDraft,
): SubUnitDraft[] => [...subs, child ?? emptySubUnit(subs.length + 1)];

type RecordSubLike = {
  _id?: string;
  subUnitNo: number;
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
    textbooks?: string;
    journal?: string;
    whoGuidelines?: string;
    internetResources?: string;
    freeText?: string;
  };
  teachingHours?: number;
  attachments?: SubUnitDraft["attachments"];
  remarks?: string;
  status?: SyllabusSubUnitStatus;
  teachingNotes?: string;
  teacherAttachments?: SubUnitDraft["teacherAttachments"];
  todaysCoverage?: string;
  children?: RecordSubLike[];
};

const mapRecordSub = (sub: RecordSubLike): SubUnitDraft => ({
  clientKey: sub._id || nextClientKey("sub"),
  subUnitNo: sub.subUnitNo,
  heading: sub.heading,
  description: sub.description || "",
  learningOutcomes: sub.learningOutcomes || "",
  internalAssessment: sub.internalAssessment || "",
  practicalRequired: Boolean(sub.practicalRequired),
  labName: sub.labName || "",
  requiredEquipment: sub.requiredEquipment || "",
  hospitalPosting: sub.hospitalPosting || "",
  clinicalHours: sub.clinicalHours ?? 0,
  references: {
    textbooks: sub.references?.textbooks || "",
    journal: sub.references?.journal || "",
    whoGuidelines: sub.references?.whoGuidelines || "",
    internetResources: sub.references?.internetResources || "",
    freeText: sub.references?.freeText || "",
  },
  teachingHours: sub.teachingHours ?? 0,
  attachments: sub.attachments ?? [],
  remarks: sub.remarks || "",
  status: sub.status || "NOT_STARTED",
  teachingNotes: sub.teachingNotes || "",
  teacherAttachments: sub.teacherAttachments ?? [],
  todaysCoverage: sub.todaysCoverage || "",
  children: (sub.children ?? []).map(mapRecordSub),
});

/** Strip "Unit 3 : " / "Unit 3 - " prefixes from legacy headings for cleaner re-edit. */
const stripLegacyUnitPrefix = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^unit\s*\d+\s*[:\-–—.]?\s*/i, "").trim() || trimmed;
};

export const recordToForm = (plan: AcademicSyllabusRecord): SyllabusFormState => {
  if (plan.chapters && plan.chapters.length > 0) {
    return {
      academicYearBs: plan.academicYearBs,
      session: plan.session || plan.academicYearBs,
      faculty: plan.faculty || "",
      semesterBs: plan.semesterBs || "",
      classId: plan.classId,
      sectionId: plan.sectionId,
      batchId: plan.batchId,
      yearId: plan.yearId,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId || "",
      subjectCode: plan.subjectCode || plan.subject?.code || "",
      totalTheoryHours: plan.totalTheoryHours ?? 0,
      totalPracticalHours: plan.totalPracticalHours ?? 0,
      creditHours: plan.creditHours ?? 0,
      remarks: plan.remarks || "",
      attachmentUrl: plan.attachmentUrl || "",
      chapters: renumberChapters(
        plan.chapters.map((chapter) => {
          const kind =
            chapter.sectionKind === "CHAPTER" || chapter.sectionKind === "PART"
              ? chapter.sectionKind
              : chapter.title
                ? ("CHAPTER" as const)
                : ("NONE" as const);
          const units = Array.isArray(chapter.units) ? chapter.units : [];
          return {
            clientKey: chapter._id || nextClientKey("ch"),
            chapterNo: chapter.chapterNo,
            sectionKind: kind,
            title: kind === "NONE" ? "" : chapter.title,
            description: chapter.description || "",
            estimatedHours: chapter.estimatedHours ?? 0,
            weightagePercent: chapter.weightagePercent ?? 0,
            references: chapter.references || "",
            remarks: chapter.remarks || "",
            tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
            // Keep at least one unit row so user can always continue typing
            units:
              units.length > 0
                ? units.map((unit) => ({
                    clientKey: unit._id || nextClientKey("unit"),
                    unitNo: unit.unitNo,
                    title: unit.title || "",
                    description: unit.description || "",
                    teachingHours: unit.teachingHours ?? 0,
                    learningObjective: unit.learningObjective || "",
                    references: unit.references || "",
                    remarks: unit.remarks || "",
                    practicalRequired: Boolean(unit.practicalRequired),
                    subUnits: (unit.subUnits ?? []).map(mapRecordSub),
                  }))
                : [emptyUnit(1)],
          };
        }),
      ),
    };
  }

  // Fallback: legacy flat units → ONE "units only" section (not one section per unit).
  // One-section-per-unit looked like duplicate/broken UI when reopening a draft.
  const legacyUnits = Array.isArray(plan.units) ? plan.units : [];
  const chapters: ChapterDraft[] =
    legacyUnits.length > 0
      ? [
          {
            clientKey: nextClientKey("ch"),
            chapterNo: 1,
            sectionKind: "NONE" as const,
            title: "",
            description: "",
            estimatedHours: 0,
            weightagePercent: 0,
            references: "",
            remarks: "",
            tentativeCompletionMonth: "",
            units: legacyUnits.map((unit, index) => {
              const topics = (unit.topicsCovered || "")
                .split(/[\n;|]+/)
                .map((t) => t.trim())
                .filter(Boolean);
              const cleanTitle = stripLegacyUnitPrefix(
                unit.chapterName || `Unit ${unit.unitNo || index + 1}`,
              );
              return {
                clientKey: unit._id || nextClientKey("unit"),
                unitNo: unit.unitNo || index + 1,
                title: cleanTitle,
                description: unit.topicsCovered || "",
                teachingHours: unit.estimatedTeachingHours ?? 0,
                learningObjective: unit.learningOutcomes || "",
                references: unit.references || "",
                remarks: "",
                practicalRequired: Boolean(unit.practicalRequired),
                // Do not invent placeholder sub-units — they are optional
                subUnits:
                  topics.length > 0
                    ? topics.map((heading, sIndex) => ({
                        ...emptySubUnit(sIndex + 1),
                        heading,
                        learningOutcomes: unit.learningOutcomes || "",
                        practicalRequired: Boolean(unit.practicalRequired),
                        internalAssessment: unit.internalAssessment || "",
                        references: {
                          ...emptyReferences(),
                          freeText: unit.references || "",
                        },
                      }))
                    : [],
              };
            }),
          },
        ]
      : [emptyChapter(1)];

  return {
    academicYearBs: plan.academicYearBs,
    session: plan.session || plan.academicYearBs,
    faculty: plan.faculty || "",
    semesterBs: plan.semesterBs || "",
    classId: plan.classId,
    sectionId: plan.sectionId,
    batchId: plan.batchId,
    yearId: plan.yearId,
    subjectId: plan.subjectId,
    teacherId: plan.teacherId || "",
    subjectCode: plan.subjectCode || plan.subject?.code || "",
    totalTheoryHours: plan.totalTheoryHours ?? 0,
    totalPracticalHours: plan.totalPracticalHours ?? 0,
    creditHours: plan.creditHours ?? 0,
    remarks: plan.remarks || "",
    attachmentUrl: plan.attachmentUrl || "",
    chapters: renumberChapters(chapters),
  };
};

/** Keep clientKey (existing Mongo id) so updates preserve hierarchy links. */
const subToPayload = (
  sub: SubUnitDraft,
  nepaliMode: boolean,
): AcademicSyllabusSubUnitInput => {
  const children = (sub.children ?? []) as SubUnitDraft[];
  const refs = sub.references;
  const t = (s: string | undefined | null) => textForPayload(s, nepaliMode);
  return {
    clientKey: sub.clientKey,
    subUnitNo: sub.subUnitNo,
    heading: t(sub.heading).trim(),
    description: t(sub.description),
    learningOutcomes: t(sub.learningOutcomes),
    internalAssessment: t(sub.internalAssessment),
    practicalRequired: Boolean(sub.practicalRequired),
    labName: t(sub.labName),
    requiredEquipment: t(sub.requiredEquipment),
    hospitalPosting: t(sub.hospitalPosting),
    clinicalHours: sub.clinicalHours ?? 0,
    references: refs
      ? {
          textbooks: t(refs.textbooks),
          journal: t(refs.journal),
          whoGuidelines: t(refs.whoGuidelines),
          internetResources: t(refs.internetResources),
          freeText: t(refs.freeText),
        }
      : refs,
    teachingHours: sub.teachingHours ?? 0,
    attachments: sub.attachments ?? [],
    remarks: t(sub.remarks),
    status: sub.status || "NOT_STARTED",
    teachingNotes: t(sub.teachingNotes),
    teacherAttachments: sub.teacherAttachments ?? [],
    todaysCoverage: t(sub.todaysCoverage),
    children: children.map((c) => subToPayload(c, nepaliMode)),
  };
};

/** True if every *filled* sub-unit has a heading; empty draft rows are ignored. */
export const allSubHeadingsFilled = (subs: SubUnitDraft[]): boolean => {
  for (const sub of subs) {
    const hasHeading = Boolean(sub.heading?.trim());
    const hasChildren = Boolean(sub.children?.length);
    // Empty placeholder row (no heading, no children) is OK — stripped on save
    if (!hasHeading && !hasChildren) continue;
    if (!hasHeading) return false;
    if (hasChildren && !allSubHeadingsFilled(sub.children as SubUnitDraft[])) {
      return false;
    }
  }
  return true;
};

/** Drop empty draft sub-units (no heading and no children). */
export const pruneEmptySubUnits = (subs: SubUnitDraft[]): SubUnitDraft[] =>
  renumberSubTree(
    subs
      .map((sub) => ({
        ...sub,
        children: pruneEmptySubUnits((sub.children ?? []) as SubUnitDraft[]),
      }))
      .filter(
        (sub) =>
          Boolean(sub.heading?.trim()) ||
          (sub.children && sub.children.length > 0),
      ),
  );

export const formToPayload = (
  form: SyllabusFormState,
  options?: { nepaliMode?: boolean },
): AcademicSyllabusInput => {
  // Preeti → Unicode only for Nepali subject. Other subjects: text stored as typed.
  const nepaliMode = Boolean(options?.nepaliMode);
  const t = (s: string | undefined | null) => textForPayload(s, nepaliMode);

  // Keep all unit rows (including blank titles). Admins can save partial drafts
  // and fill unit titles later; sub-units alone under a blank unit title are valid.
  // Renumber so unit numbers stay continuous across chapters (Ch1: 1–5, Ch2: 6–10, …).
  const chapters = renumberChapters(form.chapters)
    .map((chapter) => {
      const kind = (chapter.sectionKind as SectionKind) || "NONE";
      const units = (chapter.units ?? []).map((unit) => {
        const rawTitle = String(
          (unit as { title?: unknown }).title ??
            (unit as { chapterName?: unknown }).chapterName ??
            (unit as { name?: unknown }).name ??
            "",
        );
        // Blank title is intentional and must be persisted
        const title = t(rawTitle).trim();
        return {
          clientKey: unit.clientKey,
          unitNo: unit.unitNo,
          title,
          description: t(unit.description),
          teachingHours:
            typeof unit.teachingHours === "number" &&
            Number.isFinite(unit.teachingHours)
              ? unit.teachingHours
              : 0,
          learningObjective: t(unit.learningObjective),
          references: t(unit.references),
          remarks: t(unit.remarks),
          practicalRequired: Boolean(unit.practicalRequired),
          // Keep sub-units with content; blank heading-only empty rows still pruned
          subUnits: pruneEmptySubUnits(unit.subUnits ?? []).map((sub) =>
            subToPayload(sub, nepaliMode),
          ),
        };
      });
      // Ensure every section has at least one unit row (blank title OK)
      const ensuredUnits =
        units.length > 0
          ? units
          : [
              {
                clientKey: nextClientKey("unit"),
                unitNo: 1,
                title: "",
                description: "",
                teachingHours: 0,
                learningObjective: "",
                references: "",
                remarks: "",
                practicalRequired: false,
                subUnits: [] as ReturnType<typeof subToPayload>[],
              },
            ];
      return {
        clientKey: chapter.clientKey,
        chapterNo: chapter.chapterNo,
        sectionKind: kind,
        // Chapter/Part titles are optional too
        title: kind === "NONE" ? "" : t(chapter.title).trim(),
        description: t(chapter.description),
        estimatedHours:
          typeof chapter.estimatedHours === "number" &&
          Number.isFinite(chapter.estimatedHours)
            ? chapter.estimatedHours
            : 0,
        weightagePercent:
          typeof chapter.weightagePercent === "number" &&
          Number.isFinite(chapter.weightagePercent)
            ? chapter.weightagePercent
            : 0,
        references: t(chapter.references),
        remarks: t(chapter.remarks),
        tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
        units: ensuredUnits,
      };
    });

  // Legacy flat units (backup path on server if hierarchy shape is dropped)
  let legacyUnitSeq = 0;
  const legacyUnits = chapters.flatMap((chapter) =>
    chapter.units.map((unit) => {
      legacyUnitSeq += 1;
      return {
        unitNo: unit.unitNo || legacyUnitSeq,
        chapterName: unit.title,
        estimatedTeachingHours: unit.teachingHours ?? 0,
        learningOutcomes: unit.learningObjective || "",
        topicsCovered: (unit.subUnits ?? [])
          .map((s) => s.heading)
          .filter(Boolean)
          .join("\n"),
        references: unit.references || "",
        practicalRequired: Boolean(unit.practicalRequired),
        internalAssessment: "",
        tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
        status: "PENDING" as const,
      };
    }),
  );

  // Curriculum-shared syllabus: do not pin to a single batch
  const batchId = form.batchId?.trim() ? form.batchId : undefined;

  return {
    academicYearBs: form.academicYearBs,
    session: form.session || form.academicYearBs,
    faculty: form.faculty,
    semesterBs: form.semesterBs,
    classId: form.classId || undefined,
    sectionId: form.sectionId || undefined,
    batchId,
    yearId: form.yearId || undefined,
    subjectId: form.subjectId,
    teacherId: form.teacherId || "",
    subjectCode: form.subjectCode || "",
    totalTheoryHours: form.totalTheoryHours ?? 0,
    totalPracticalHours: form.totalPracticalHours ?? 0,
    creditHours: form.creditHours ?? 0,
    remarks: t(form.remarks),
    attachmentUrl: form.attachmentUrl,
    chapters,
    // Server prefers chapters; units is a safety net
    units: legacyUnits.length > 0 ? legacyUnits : undefined,
  };
};

export const moveItem = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
};

export const SUB_UNIT_STATUS_OPTIONS: Array<{
  value: SyllabusSubUnitStatus;
  label: string;
}> = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
];

export const subUnitStatusBadgeClass = (status: string): string => {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "IN_PROGRESS":
      return "bg-sky-100 text-sky-800";
    case "SKIPPED":
      return "bg-slate-100 text-slate-700";
    case "REVISION_REQUIRED":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-600";
  }
};
