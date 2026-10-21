import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";
import { curriculumSubjectsMatch } from "./academicHierarchyUtils";
import { expandYearIdsForSelection } from "./academicManagementUtils";

/** A syllabus / session plan already made (any teacher), from GET /existing. */
export interface ExistingAcademicRecord {
  _id: string;
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  masterSubjectId?: string;
  yearId?: string;
  yearName?: string;
  yearLevel?: number;
  batchId?: string;
  classId?: string;
  sectionId?: string;
  status: string;
  teacherId?: string;
  teacherName?: string;
}

export type ExistingAcademicKind = "syllabus" | "session-plan";

export const useExistingAcademicRecords = (
  kind: ExistingAcademicKind,
  academicYearBs: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["academic-management", "existing", kind, academicYearBs],
    queryFn: () =>
      unwrap<ExistingAcademicRecord[]>(
        api.get("/academic-management/existing", {
          params: { kind, academicYearBs },
        }),
      ),
    enabled: enabled && Boolean(academicYearBs?.trim()),
  });

type SubjectLike = {
  _id: string;
  name?: string;
  code?: string;
  masterSubjectId?: string | null;
  subjectIds?: string[];
};

type YearLike = { _id: string; name: string; level?: number; isActive?: boolean };

export interface ExistingScope {
  yearId?: string;
  batchId?: string;
  classId?: string;
  sectionId?: string;
}

/** Same or unset on the stored record — the rule the server uses on save. */
const sameOrUnset = (wanted?: string, stored?: string) =>
  !wanted || !stored || wanted === stored;

/**
 * Records that would block creating `subject` in this scope. Mirrors the
 * server check: same curriculum subject (any batch copy), same academic year,
 * same year level (any batch), and batch / class / section equal or unset.
 */
export const findExistingForSubject = (params: {
  records: ExistingAcademicRecord[];
  subject: SubjectLike;
  scope: ExistingScope;
  years: YearLike[];
  /** Session plans also compare batch and section; syllabi do not. */
  kind: ExistingAcademicKind;
  excludeId?: string | null;
}): ExistingAcademicRecord | undefined => {
  const { records, subject, scope, years, kind, excludeId } = params;
  const subjectIds = new Set([subject._id, ...(subject.subjectIds ?? [])]);
  const levelYearIds = scope.yearId
    ? new Set(expandYearIdsForSelection(years, scope.yearId))
    : null;

  return records.find((record) => {
    if (excludeId && record._id === excludeId) return false;
    const sameSubject =
      subjectIds.has(record.subjectId) ||
      curriculumSubjectsMatch(subject, {
        _id: record.subjectId,
        name: record.subjectName,
        code: record.subjectCode,
        masterSubjectId: record.masterSubjectId,
      });
    if (!sameSubject) return false;
    if (levelYearIds && record.yearId && !levelYearIds.has(record.yearId)) {
      return false;
    }
    if (!sameOrUnset(scope.classId, record.classId)) return false;
    if (kind === "session-plan") {
      if (!sameOrUnset(scope.batchId, record.batchId)) return false;
      if (!sameOrUnset(scope.sectionId, record.sectionId)) return false;
    }
    return true;
  });
};

export const existingStatusLabel = (status: string) =>
  status.replace(/_/g, " ").toLowerCase();
