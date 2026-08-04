export {
  filterSectionsByClass,
  filterYearsByBatch,
  filterSubjectsByClass,
  filterSubjectsByYear,
  type AcademicScopeOption as ScopeOption
} from "./academicStructureUtils";
import {
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  type AcademicScopeOption
} from "./academicStructureUtils";
import type { TeacherAssignmentPair } from "@phit-erp/shared";

export const hasSingleOption = <T extends { _id: string }>(items: T[]): boolean => items.length === 1;

const idStr = (v: unknown) => (v == null ? "" : String(v));

/**
 * Subjects a teacher may post homework/notes for or mark attendance/exams on
 * for a selected cohort. Prefer SubjectAssignment pairs so curriculum siblings
 * that would 403 on the API never appear in the dropdown.
 */
export const filterSubjectsForTeacherCohort = <T extends AcademicScopeOption>(
  subjects: T[],
  options: {
    isCollege: boolean;
    batchId?: string;
    yearId?: string;
    classId?: string;
    sectionId?: string;
    assignments?: TeacherAssignmentPair[];
    assignedSubjectIds?: string[];
  },
): T[] => {
  const {
    isCollege,
    batchId = "",
    yearId = "",
    classId = "",
    sectionId = "",
    assignments = [],
    assignedSubjectIds = [],
  } = options;

  const cohortReady = isCollege
    ? Boolean(batchId && yearId)
    : Boolean(classId && sectionId);
  if (!cohortReady) return [];

  const pairIds = new Set(
    assignments
      .filter((a) =>
        isCollege
          ? idStr(a.batchId) === idStr(batchId) &&
            idStr(a.yearId) === idStr(yearId)
          : idStr(a.classId) === idStr(classId) &&
            idStr(a.sectionId) === idStr(sectionId),
      )
      .map((a) => idStr(a.subjectId))
      .filter(Boolean),
  );

  if (pairIds.size > 0) {
    const fromPairs = subjects.filter((s) => pairIds.has(idStr(s._id)));
    if (fromPairs.length > 0) return fromPairs;
  }

  const byStructure = (
    isCollege
      ? filterSubjectsByYear(subjects, yearId)
      : filterSubjectsByClass(subjects, classId)
  ) as T[];

  const allowed = new Set(
    (assignedSubjectIds.length
      ? assignedSubjectIds
      : subjects.map((s) => idStr(s._id))
    ).map(idStr),
  );
  let filtered = byStructure.filter((s) => allowed.has(idStr(s._id)));
  if (filtered.length === 0) {
    filtered = subjects.filter((s) => allowed.has(idStr(s._id)));
  }
  return filtered;
};

/** Years for a batch limited to assignment pairs and/or student roster when available. */
export const filterYearsForTeacherBatch = <
  T extends AcademicScopeOption & { batchId?: string },
>(
  years: T[],
  batchId: string,
  options?: {
    assignments?: TeacherAssignmentPair[];
    studentYearIds?: string[];
  },
): T[] => {
  const byBatch = filterYearsByBatch(years, batchId) as T[];
  if (!batchId) return byBatch;

  const allowed = new Set<string>();
  for (const yid of options?.studentYearIds ?? []) {
    if (yid) allowed.add(idStr(yid));
  }
  for (const a of options?.assignments ?? []) {
    if (idStr(a.batchId) === idStr(batchId) && a.yearId) {
      allowed.add(idStr(a.yearId));
    }
  }
  if (allowed.size === 0) return byBatch;
  const scoped = byBatch.filter((y) => allowed.has(idStr(y._id)));
  return scoped.length > 0 ? scoped : byBatch;
};