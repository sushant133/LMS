import { useQuery } from "@tanstack/react-query";
import type { BatchRecord, ClassRecord, SectionRecord, StudentRecord, SubjectRecord, YearRecord } from "@phit-erp/shared";
import { api, unwrap } from "lib/api";

export interface TeacherScopeData {
  scope: {
    teacherId: string;
    subjectIds: string[];
    classIds: string[];
    sectionIds: string[];
    batchIds: string[];
    yearIds: string[];
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
    staleTime: 5 * 60 * 1000
  });