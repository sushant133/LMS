import type {
  AcademicLessonPlanRecord,
  AcademicLogBookEntryRecord,
  AcademicManagementFilters,
  AcademicSessionPlanRecord,
  AcademicSyllabusRecord,
} from "@phit-erp/shared";
import * as XLSX from "xlsx";

export const defaultAcademicFilters = (): AcademicManagementFilters => ({
  academicYearBs: "",
  session: "",
  faculty: "",
  semesterBs: "",
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  subjectId: "",
  teacherId: "",
  month: "",
  dateFrom: "",
  dateTo: "",
  status: undefined,
  keyword: "",
});

export const filtersToParams = (
  filters: AcademicManagementFilters | Record<string, string | undefined | null>,
): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = String(value);
  });
  return params;
};

/**
 * Params for Academic Management list APIs (syllabus, session plan, lesson plan, log book).
 * Curriculum plans are shared across batches of the same year level — do not filter by
 * batchId (or college yearId Mongo id) on the server, or valid rows disappear.
 */
export const academicListApiParams = (
  filters: AcademicManagementFilters,
  options?: { isCollege?: boolean },
): Record<string, string> => {
  const params = filtersToParams(filters);
  delete params.batchId;
  // Session often mirrors academic year with spacing differences and hides valid rows.
  // Academic year is the canonical period filter; session is display-only for plans.
  delete params.session;
  if (options?.isCollege !== false) {
    // College: year level filtering is client-side via hierarchy tree
    delete params.yearId;
  }
  return params;
};

/**
 * Ensure the selected subject instance appears in a year-filtered dropdown
 * even when curriculum dedupe keeps a different sibling subject _id.
 */
export const ensureSubjectInOptions = <
  T extends { _id: string; subjectIds?: string[] },
>(
  options: T[],
  selectedId: string | undefined,
  allSubjects: T[],
): T[] => {
  if (!selectedId) return options;
  const listed = options.some(
    (s) => s._id === selectedId || (s.subjectIds ?? []).includes(selectedId),
  );
  if (listed) return options;
  const raw = allSubjects.find((s) => s._id === selectedId);
  if (!raw) return options;
  return [{ ...raw, subjectIds: (raw as T).subjectIds ?? [raw._id] }, ...options];
};

export const resolveSubjectSelectValue = <
  T extends { _id: string; subjectIds?: string[] },
>(
  options: T[],
  selectedId: string | undefined,
): string => {
  if (!selectedId) return "";
  const match = options.find(
    (s) => s._id === selectedId || (s.subjectIds ?? []).includes(selectedId),
  );
  return match?._id ?? selectedId;
};

export const statusBadgeClass = (status: string): string => {
  switch (status) {
    case "APPROVED":
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "REJECTED":
    case "NEEDS_IMPROVEMENT":
    case "DELAYED":
      return "bg-rose-100 text-rose-800";
    case "SUBMITTED":
    case "PENDING_APPROVAL":
    case "PENDING":
    case "IN_PROGRESS":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

/**
 * Curriculum identity for a subject instance.
 * College provisions one Subject doc per batch year; HA curriculum is shared —
 * masterSubjectId / code / name collapse those instances to one label.
 */
export const curriculumKeyForSubject = (subject: {
  _id: string;
  name?: string;
  code?: string;
  masterSubjectId?: string | null | { _id?: string };
}): string => {
  const master =
    typeof subject.masterSubjectId === "object" && subject.masterSubjectId
      ? String(
          (subject.masterSubjectId as { _id?: string })._id ??
            subject.masterSubjectId,
        )
      : subject.masterSubjectId
        ? String(subject.masterSubjectId)
        : "";
  if (master && master !== "[object Object]") return `master:${master}`;
  const code = (subject.code ?? "").trim().toLowerCase();
  if (code) return `code:${code}`;
  const name = (subject.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name) return `name:${name}`;
  return `id:${subject._id}`;
};

/**
 * Deduplicate curriculum subjects that appear once per batch (same name/code/master).
 * Keeps the first occurrence for select lists; merges all instance ids onto `subjectIds` when present.
 */
export const dedupeSubjectsForSelect = <
  T extends {
    _id: string;
    name: string;
    code?: string;
    masterSubjectId?: string | null;
  },
>(
  subjects: T[],
): Array<T & { subjectIds?: string[] }> => {
  const seen = new Map<string, T & { subjectIds?: string[] }>();
  for (const subject of subjects) {
    const key = curriculumKeyForSubject(subject);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...subject, subjectIds: [subject._id] });
      continue;
    }
    existing.subjectIds = [
      ...new Set([...(existing.subjectIds ?? [existing._id]), subject._id]),
    ];
    // Prefer a non-empty code / cleaner name
    if (!existing.code && subject.code) {
      existing.code = subject.code;
    }
    if (
      subject.name &&
      (!existing.name || existing.name.length > subject.name.length)
    ) {
      existing.name = subject.name;
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
};

type YearLike = { _id: string; name: string; level?: number; isActive?: boolean };

/** Unique year options for form selects (by level, then name). */
export const dedupeYearsForSelect = (years: YearLike[]): YearLike[] => {
  const seen = new Map<string, YearLike>();
  for (const year of years) {
    if (year.isActive === false) continue;
    const key =
      year.level != null
        ? `level:${year.level}`
        : `name:${year.name.trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, year);
    }
  }
  return [...seen.values()].sort((a, b) => {
    if (a.level != null && b.level != null) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });
};

/**
 * All year document IDs that belong to the same academic level as the selection
 * (covers multi-batch college setups where each batch has its own Year row).
 */
export const expandYearIdsForSelection = (
  years: YearLike[],
  selectedYearId: string,
): string[] => {
  if (!selectedYearId) return [];
  const selected = years.find((year) => year._id === selectedYearId);
  if (!selected) return [selectedYearId];
  return years
    .filter(
      (year) =>
        year._id === selectedYearId ||
        (selected.level != null && year.level === selected.level) ||
        year.name.trim().toLowerCase() === selected.name.trim().toLowerCase(),
    )
    .map((year) => year._id);
};

/**
 * Subjects linked to the selected year (or sibling years of the same level).
 * When no year is selected, returns an empty list so the user picks year first.
 */
export const filterSubjectsByYear = <
  T extends {
    _id: string;
    name: string;
    code?: string;
    masterSubjectId?: string | null;
    yearIds?: string[];
    classIds?: string[];
  },
>(
  subjects: T[],
  years: YearLike[],
  selectedYearId?: string,
): T[] => {
  if (!selectedYearId) return [];
  const yearIds = new Set(expandYearIdsForSelection(years, selectedYearId));
  const filtered = subjects.filter((subject) =>
    (subject.yearIds ?? []).some((id) => yearIds.has(id)),
  );
  return dedupeSubjectsForSelect(filtered);
};

/** Subjects for a school class (when years are not used). */
export const filterSubjectsByClass = <
  T extends {
    _id: string;
    name: string;
    code?: string;
    masterSubjectId?: string | null;
    classIds?: string[];
  },
>(
  subjects: T[],
  selectedClassId?: string,
): T[] => {
  if (!selectedClassId) return [];
  const filtered = subjects.filter((subject) =>
    (subject.classIds ?? []).includes(selectedClassId),
  );
  return dedupeSubjectsForSelect(filtered);
};

/**
 * Parse unit topics into selectable sub-units (one per non-empty line / semicolon / comma).
 */
export const parseSubUnitsFromTopics = (topicsCovered?: string): string[] => {
  if (!topicsCovered?.trim()) return [];
  return topicsCovered
    .split(/[\n;|]+/)
    .flatMap((part) => part.split(/,(?=\s)/))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
};

/** Map syllabus/session unit fields into a session-plan unit draft row. */
export const mapSourceUnitToSessionUnit = (
  unit: {
    unitNo: number;
    chapterName: string;
    estimatedTeachingHours?: number;
    learningOutcomes?: string;
    topicsCovered?: string;
    references?: string;
    practicalRequired?: boolean;
    internalAssessment?: string;
    tentativeCompletionMonth?: string;
    startDateBs?: string;
    endDateBs?: string;
    status?: string;
    syllabusId?: string;
    syllabusChapterId?: string;
    syllabusUnitId?: string;
  },
  index: number,
) => ({
  unitNo: unit.unitNo || index + 1,
  chapterName: unit.chapterName || "",
  estimatedTeachingHours: unit.estimatedTeachingHours ?? 0,
  learningOutcomes: unit.learningOutcomes || "",
  topicsCovered: unit.topicsCovered || "",
  references: unit.references || "",
  practicalRequired: unit.practicalRequired ?? false,
  internalAssessment: unit.internalAssessment || "",
  tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
  startDateBs: unit.startDateBs || "",
  endDateBs: unit.endDateBs || "",
  status: (unit.status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED") || "PENDING",
  syllabusId: unit.syllabusId || "",
  syllabusChapterId: unit.syllabusChapterId || "",
  syllabusUnitId: unit.syllabusUnitId || "",
});

type NestedSubLike = {
  _id: string;
  heading: string;
  learningOutcomes?: string;
  practicalRequired?: boolean;
  internalAssessment?: string;
  teachingHours?: number;
  children?: NestedSubLike[];
};

const flattenNestedSubs = (subs: NestedSubLike[]): NestedSubLike[] => {
  const out: NestedSubLike[] = [];
  const walk = (nodes: NestedSubLike[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(subs);
  return out;
};

const formatSessionUnitHeading = (unitNo: number, title: string): string => {
  const trimmed = (title || "").trim();
  if (!trimmed) return `Unit ${unitNo}`;
  if (/^unit\s*\d+/i.test(trimmed)) return trimmed;
  return `Unit ${unitNo} : ${trimmed}`;
};

/**
 * Import hierarchical syllabus into Session Plan units.
 * Only Unit headings appear (Sub Units are not listed as Session Plan rows).
 * Workflow: Syllabus Units → Session Plan schedule.
 */
export const mapSyllabusHierarchyToSessionUnits = (
  syllabus: {
    _id: string;
    chapters?: Array<{
      _id: string;
      chapterNo: number;
      title: string;
      description?: string;
      estimatedHours?: number;
      references?: string;
      tentativeCompletionMonth?: string;
      units: Array<{
        _id: string;
        unitNo?: number;
        title: string;
        description?: string;
        learningObjective?: string;
        teachingHours?: number;
        practicalRequired?: boolean;
        references?: string;
        subUnits: NestedSubLike[];
      }>;
    }>;
    units?: Array<{
      unitNo: number;
      chapterName: string;
      estimatedTeachingHours?: number;
      learningOutcomes?: string;
      topicsCovered?: string;
      references?: string;
      practicalRequired?: boolean;
      internalAssessment?: string;
      tentativeCompletionMonth?: string;
      status?: string;
    }>;
  },
) => {
  if (syllabus.chapters && syllabus.chapters.length > 0) {
    const rows: Array<ReturnType<typeof mapSourceUnitToSessionUnit> & {
      syllabusUnitId: string;
    }> = [];
    let sequential = 0;

    for (const chapter of syllabus.chapters) {
      for (const unit of chapter.units) {
        sequential += 1;
        const unitNo = unit.unitNo || sequential;
        const allSubs = flattenNestedSubs(unit.subUnits ?? []);
        // Store nested headings for Lesson Plan sub-unit pickers only (not shown as SP rows)
        const topicsCovered = allSubs.map((s) => s.heading).filter(Boolean).join("\n");
        const learningOutcomes =
          unit.learningObjective ||
          allSubs
            .map((s) => s.learningOutcomes)
            .filter(Boolean)
            .join("\n");
        const estimatedTeachingHours =
          unit.teachingHours ||
          allSubs.reduce((sum, su) => sum + (su.teachingHours || 0), 0);
        const practicalRequired =
          Boolean(unit.practicalRequired) ||
          allSubs.some((s) => s.practicalRequired);
        const internalAssessment = allSubs
          .map((s) => s.internalAssessment)
          .filter(Boolean)
          .join("; ");

        rows.push({
          unitNo: sequential,
          chapterName: formatSessionUnitHeading(unitNo, unit.title),
          estimatedTeachingHours,
          learningOutcomes,
          // Keep topics for downstream Lesson Plan pickers; UI shows heading only
          topicsCovered: topicsCovered || unit.description || "",
          references: unit.references || chapter.references || "",
          practicalRequired,
          internalAssessment,
          tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
          startDateBs: "",
          endDateBs: "",
          status: "PENDING" as const,
          syllabusId: syllabus._id,
          syllabusChapterId: chapter._id,
          syllabusUnitId: unit._id,
        });
      }
    }

    return rows.length > 0
      ? rows
      : (syllabus.units ?? []).map((unit, index) =>
          mapSourceUnitToSessionUnit(
            { ...unit, syllabusId: syllabus._id },
            index,
          ),
        );
  }

  // Legacy flat units
  return (syllabus.units ?? []).map((unit, index) =>
    mapSourceUnitToSessionUnit(unit, index),
  );
};

/**
 * Find a syllabus sub-unit matching a topic heading under a chapter/session unit.
 * Walks unlimited nested children.
 */
export const matchSyllabusSubUnit = (
  syllabus: {
    _id?: string;
    chapters?: Array<{
      _id: string;
      units: Array<{
        _id: string;
        subUnits: Array<{
          _id: string;
          heading: string;
          learningOutcomes?: string;
          description?: string;
          children?: Array<{
            _id: string;
            heading: string;
            learningOutcomes?: string;
            description?: string;
            children?: unknown[];
          }>;
        }>;
      }>;
    }>;
  } | null | undefined,
  opts: {
    syllabusChapterId?: string;
    heading?: string;
  },
): {
  syllabusId?: string;
  syllabusChapterId?: string;
  syllabusUnitId?: string;
  syllabusSubUnitId?: string;
  heading?: string;
  learningOutcomes?: string;
  description?: string;
} | null => {
  if (!syllabus?.chapters?.length || !opts.heading?.trim()) return null;
  const needle = opts.heading.trim().toLowerCase();

  type Nested = {
    _id: string;
    heading: string;
    learningOutcomes?: string;
    description?: string;
    children?: Nested[];
  };

  const findInTree = (
    nodes: Nested[],
    chapterId: string,
    unitId: string,
  ): ReturnType<typeof matchSyllabusSubUnit> => {
    for (const sub of nodes) {
      if (sub.heading.trim().toLowerCase() === needle) {
        return {
          syllabusId: syllabus._id,
          syllabusChapterId: chapterId,
          syllabusUnitId: unitId,
          syllabusSubUnitId: sub._id,
          heading: sub.heading,
          learningOutcomes: sub.learningOutcomes,
          description: sub.description,
        };
      }
      if (sub.children?.length) {
        const found = findInTree(sub.children, chapterId, unitId);
        if (found) return found;
      }
    }
    return null;
  };

  for (const chapter of syllabus.chapters) {
    if (opts.syllabusChapterId && chapter._id !== opts.syllabusChapterId) continue;
    for (const unit of chapter.units) {
      const found = findInTree(unit.subUnits as Nested[], chapter._id, unit._id);
      if (found) return found;
    }
  }
  return null;
};

export const remainingPercentOf = (completedPercent: number): number =>
  Math.max(0, 100 - Math.min(100, completedPercent));

const flattenExportSubs = <
  T extends { children?: T[]; displayNo?: string; heading?: string },
>(
  subs: T[],
): T[] => {
  const out: T[] = [];
  const walk = (nodes: T[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(subs);
  return out;
};

const exportUnitBasedPlansExcel = (
  plans: AcademicSessionPlanRecord[] | AcademicSyllabusRecord[],
  filename: string,
  sheetName: string,
) => {
  const rows: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    const syllabus = plan as AcademicSyllabusRecord;
    if (syllabus.chapters && syllabus.chapters.length > 0) {
      for (const chapter of syllabus.chapters) {
        for (const unit of chapter.units) {
          const flatSubs = flattenExportSubs(unit.subUnits ?? []);
          if (flatSubs.length > 0) {
            for (const sub of flatSubs) {
              rows.push({
                "Academic Year": plan.academicYearBs,
                Faculty: plan.faculty ?? "",
                Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
                Subject: plan.subject?.name ?? plan.subjectId,
                "Subject Code":
                  syllabus.subjectCode || plan.subject?.code || "",
                "Approval Status": plan.status,
                "Completion %": plan.completedPercent,
                "Chapter No": chapter.chapterNo,
                "Chapter Title": chapter.title,
                "Unit No": unit.unitNo,
                "Unit Title": unit.title,
                "Sub Unit": sub.displayNo,
                Heading: sub.heading,
                "Teaching Hours": sub.teachingHours,
                "Learning Outcomes": sub.learningOutcomes,
                Practical: sub.practicalRequired ? "Yes" : "No",
                Status: sub.status,
              });
            }
          } else {
            rows.push({
              "Academic Year": plan.academicYearBs,
              Faculty: plan.faculty ?? "",
              Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
              Subject: plan.subject?.name ?? plan.subjectId,
              "Subject Code":
                syllabus.subjectCode || plan.subject?.code || "",
              "Approval Status": plan.status,
              "Completion %": plan.completedPercent,
              "Chapter No": chapter.chapterNo,
              "Chapter Title": chapter.title,
              "Unit No": unit.unitNo,
              "Unit Title": unit.title,
              "Sub Unit": "",
              Heading: "",
              "Teaching Hours": unit.teachingHours,
              "Learning Outcomes": unit.learningObjective,
              Practical: unit.practicalRequired ? "Yes" : "No",
              Status: "",
            });
          }
        }
      }
      continue;
    }
    for (const unit of plan.units) {
      rows.push({
        "Academic Year": plan.academicYearBs,
        Faculty: plan.faculty ?? "",
        Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
        Subject: plan.subject?.name ?? plan.subjectId,
        "Subject Code": plan.subject?.code ?? "",
        "Approval Status": plan.status,
        "Completion %": plan.completedPercent,
        "Unit No": unit.unitNo,
        "Unit Title": unit.chapterName,
        Topics: unit.topicsCovered,
        "Estimated Hours": unit.estimatedTeachingHours,
        "Learning Outcomes": unit.learningOutcomes,
        References: unit.references,
        "Unit Status": unit.status,
      });
    }
  }
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filename);
};

export const exportSessionPlansExcel = (
  plans: AcademicSessionPlanRecord[],
  filename: string,
) => exportUnitBasedPlansExcel(plans, filename, "Session Plans");

export const exportSyllabiExcel = (
  plans: AcademicSyllabusRecord[],
  filename: string,
) => exportUnitBasedPlansExcel(plans, filename, "Syllabus");

export const exportLessonPlansExcel = (
  plans: AcademicLessonPlanRecord[],
  filename: string,
) => {
  const rows = plans.flatMap((plan) =>
    plan.items.map((item) => ({
      "Academic Year": plan.academicYearBs,
      Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
      Subject: plan.subject?.name ?? plan.subjectId,
      Month: plan.month,
      "Monthly Description": plan.monthlyDescription ?? "",
      Topic: item.plannedTopic,
      Unit: item.unit
        ? `U${item.unit.unitNo}: ${item.unit.chapterName}`
        : item.subjectLabel,
      Description: item.description,
      Deadline: item.deadline || "",
      "Est. Classes": item.estimatedClasses,
      Completed: item.completedClasses,
      "Completed %": item.completedPercent,
      "Remaining %":
        item.remainingPercent ?? remainingPercentOf(item.completedPercent),
      "Approval Status": plan.status,
      "Topic Status": item.completionStatus,
      Remarks: item.remarks,
    })),
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Lesson Plans");
  XLSX.writeFile(workbook, filename);
};

export const exportLogBookExcel = (
  entries: AcademicLogBookEntryRecord[],
  filename: string,
) => {
  const rows = entries.map((entry) => ({
    Date: entry.dateBs,
    "Academic Year": entry.academicYearBs,
    Teacher: entry.teacher?.user?.fullName ?? entry.teacherId,
    Subject: entry.subject?.name ?? entry.subjectId,
    Unit: entry.unit,
    Topic: entry.topicCovered,
    Objectives: entry.objectives,
    Method: entry.teachingMethod,
    "Theory/Practical": entry.theoryPractical,
    Period: entry.periodNumber,
    "Start Time": entry.startTime ?? "",
    "End Time": entry.endTime ?? "",
    Feedback: entry.feedback,
    Attendance: `${entry.attendancePercent}%`,
    "Review Status": entry.reviewStatus,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Log Book");
  XLSX.writeFile(workbook, filename);
};

export const NEPALI_MONTHS = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
];
