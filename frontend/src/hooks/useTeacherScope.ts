import { useQuery } from "@tanstack/react-query";
import type { ClassRecord, SectionRecord, StudentRecord, SubjectRecord } from "@nepal-school-erp/shared";
import { api, unwrap } from "lib/api";

export interface TeacherScopeData {
  scope: {
    teacherId: string;
    subjectIds: string[];
    classIds: string[];
    sectionIds: string[];
  };
  subjects: SubjectRecord[];
  classes: ClassRecord[];
  sections: SectionRecord[];
  students: StudentRecord[];
}

export const useTeacherScope = (enabled = true) =>
  useQuery({
    queryKey: ["teacher-scope"],
    queryFn: () => unwrap<TeacherScopeData>(api.get("/teacher/scope")),
    enabled,
    staleTime: 5 * 60 * 1000
  });