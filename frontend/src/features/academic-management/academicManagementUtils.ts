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
  filters: AcademicManagementFilters,
): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = String(value);
  });
  return params;
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
 * Deduplicate curriculum subjects that appear once per batch (same name/code/master).
 * Keeps the first occurrence for select lists.
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
): T[] => {
  const seen = new Map<string, T>();
  for (const subject of subjects) {
    const key = (
      subject.masterSubjectId ||
      subject.code ||
      subject.name ||
      subject._id
    )
      .toString()
      .trim()
      .toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, subject);
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
});

export const remainingPercentOf = (completedPercent: number): number =>
  Math.max(0, 100 - Math.min(100, completedPercent));

const exportUnitBasedPlansExcel = (
  plans: AcademicSessionPlanRecord[] | AcademicSyllabusRecord[],
  filename: string,
  sheetName: string,
) => {
  const rows = plans.flatMap((plan) =>
    plan.units.map((unit) => ({
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
    })),
  );
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
