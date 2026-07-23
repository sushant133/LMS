import { useQuery } from "@tanstack/react-query";
import type {
  BatchRecord,
  ClassRecord,
  SectionRecord,
  StudentRecord,
  SubjectRecord,
  TeacherAssignmentPair,
  YearRecord
} from "@phit-erp/shared";
import { api, unwrap } from "lib/api";

export interface TeacherScopeData {
  scope: {
    teacherId: string;
    subjectIds: string[];
    classIds: string[];
    sectionIds: string[];
    batchIds: string[];
    yearIds: string[];
    assignments: TeacherAssignmentPair[];
    academicYearBs: string;
    scopeSource: "legacy" | "assignment";
  };
  subjects: SubjectRecord[];
  classes: ClassRecord[];
  sections: SectionRecord[];
  batches: BatchRecord[];
  years: YearRecord[];
  students: StudentRecord[];
}

export const useTeacherScope = (enabled = true) =>
  useQuery({
    queryKey: ["teacher-scope"],
    queryFn: () => unwrap<TeacherScopeData>(api.get("/teacher/scope")),
    enabled,
    // Refresh soon after admin assigns a subject so Academic Management updates
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });