import type {
  AcademicSyllabusChapterInput,
  AcademicSyllabusInput,
  AcademicSyllabusRecord,
  AcademicSyllabusSubUnitInput,
  AcademicSyllabusTopicInput,
  AcademicManagementFilters,
  SyllabusSubUnitStatus,
} from "@phit-erp/shared";

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
): string => {
  const t = (title || "").trim();
  if (kind === "CHAPTER") {
    return t ? `Chapter ${no}: ${t}` : `Chapter ${no}`;
  }
  if (kind === "PART") {
    return t ? `Part ${no}: ${t}` : `Part ${no}`;
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

export const renumberChapters = (chapters: ChapterDraft[]): ChapterDraft[] =>
  chapters.map((chapter, cIndex) => {
    const kind = (chapter.sectionKind as SectionKind) || "NONE";
    return {
      ...chapter,
      chapterNo: cIndex + 1,
      sectionKind: kind,
      // Clear title when grouping is skipped
      title: kind === "NONE" ? "" : chapter.title || "",
      units: chapter.units.map((unit, uIndex) => ({
        ...unit,
        unitNo: uIndex + 1,
        subUnits: renumberSubTree(unit.subUnits ?? []),
      })),
    };
  });

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
            units: chapter.units.map((unit) => ({
              clientKey: unit._id || nextClientKey("unit"),
              unitNo: unit.unitNo,
              title: unit.title,
              description: unit.description || "",
              teachingHours: unit.teachingHours ?? 0,
              learningObjective: unit.learningObjective || "",
              references: unit.references || "",
              remarks: unit.remarks || "",
              practicalRequired: Boolean(unit.practicalRequired),
              subUnits: unit.subUnits.map(mapRecordSub),
            })),
          };
        }),
      ),
    };
  }

  // Fallback: legacy flat units → one chapter container with one unit each
  const chapters: ChapterDraft[] =
    plan.units.length > 0
      ? plan.units.map((unit, index) => {
          const topics = (unit.topicsCovered || "")
            .split(/[\n;|]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          return {
            clientKey: unit._id || nextClientKey("ch"),
            chapterNo: index + 1,
            sectionKind: "NONE" as const,
            title: "",
            description: "",
            estimatedHours: unit.estimatedTeachingHours ?? 0,
            weightagePercent: 0,
            references: unit.references || "",
            remarks: "",
            tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
            units: [
              {
                clientKey: nextClientKey("unit"),
                unitNo: unit.unitNo || index + 1,
                title: unit.chapterName || "Unit 1",
                description: unit.topicsCovered || "",
                teachingHours: unit.estimatedTeachingHours ?? 0,
                learningObjective: unit.learningOutcomes || "",
                references: unit.references || "",
                remarks: "",
                practicalRequired: Boolean(unit.practicalRequired),
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
                    : [
                        {
                          ...emptySubUnit(1),
                          heading: unit.chapterName || "Topic 1",
                          description: unit.topicsCovered || "",
                          learningOutcomes: unit.learningOutcomes || "",
                          practicalRequired: Boolean(unit.practicalRequired),
                          internalAssessment: unit.internalAssessment || "",
                          teachingHours: unit.estimatedTeachingHours ?? 0,
                          references: {
                            ...emptyReferences(),
                            freeText: unit.references || "",
                          },
                        },
                      ],
              },
            ],
          };
        })
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
const subToPayload = (sub: SubUnitDraft): AcademicSyllabusSubUnitInput => {
  const children = (sub.children ?? []) as SubUnitDraft[];
  return {
    clientKey: sub.clientKey,
    subUnitNo: sub.subUnitNo,
    heading: sub.heading.trim(),
    description: sub.description || "",
    learningOutcomes: sub.learningOutcomes || "",
    internalAssessment: sub.internalAssessment || "",
    practicalRequired: Boolean(sub.practicalRequired),
    labName: sub.labName || "",
    requiredEquipment: sub.requiredEquipment || "",
    hospitalPosting: sub.hospitalPosting || "",
    clinicalHours: sub.clinicalHours ?? 0,
    references: sub.references,
    teachingHours: sub.teachingHours ?? 0,
    attachments: sub.attachments ?? [],
    remarks: sub.remarks || "",
    status: sub.status || "NOT_STARTED",
    teachingNotes: sub.teachingNotes || "",
    teacherAttachments: sub.teacherAttachments ?? [],
    todaysCoverage: sub.todaysCoverage || "",
    children: children.map(subToPayload),
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

export const formToPayload = (form: SyllabusFormState): AcademicSyllabusInput => {
  const chapters = renumberChapters(form.chapters)
    .map((chapter) => {
      const kind = (chapter.sectionKind as SectionKind) || "NONE";
      const units = chapter.units
        .filter((unit) => unit.title.trim())
        .map((unit) => ({
          clientKey: unit.clientKey,
          unitNo: unit.unitNo,
          title: unit.title.trim(),
          description: unit.description || "",
          teachingHours: unit.teachingHours ?? 0,
          learningObjective: unit.learningObjective || "",
          references: unit.references || "",
          remarks: unit.remarks || "",
          practicalRequired: Boolean(unit.practicalRequired),
          subUnits: pruneEmptySubUnits(unit.subUnits ?? []).map(subToPayload),
        }));
      return {
        clientKey: chapter.clientKey,
        chapterNo: chapter.chapterNo,
        sectionKind: kind,
        title: kind === "NONE" ? "" : (chapter.title || "").trim(),
        description: chapter.description || "",
        estimatedHours: chapter.estimatedHours ?? 0,
        weightagePercent: chapter.weightagePercent ?? 0,
        references: chapter.references || "",
        remarks: chapter.remarks || "",
        tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
        units,
      };
    })
    .filter((chapter) => chapter.units.length > 0);

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
    remarks: form.remarks || "",
    attachmentUrl: form.attachmentUrl,
    chapters,
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
