import type { InstitutionType } from "@nepal-school-erp/shared";
import type { StudentProfile } from "./studentScope.js";
import type { TeacherScope } from "./teacherScope.js";
import { isCollege } from "./institution.js";

export const buildStudentAcademicFilter = (
  profile: StudentProfile,
  institutionType: InstitutionType
): Record<string, unknown> => {
  if (isCollege(institutionType)) {
    return {
      batchId: profile.batchId,
      yearId: profile.yearId
    };
  }

  return {
    classId: profile.classId,
    sectionId: profile.sectionId
  };
};

export const buildTeacherAcademicFilter = (
  scope: TeacherScope,
  institutionType: InstitutionType,
  options?: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
): Record<string, unknown> => {
  if (isCollege(institutionType)) {
    return {
      batchId: options?.batchId ?? { $in: scope.batchIds },
      yearId: options?.yearId ?? { $in: scope.yearIds }
    };
  }

  return {
    classId: options?.classId ?? { $in: scope.classIds },
    sectionId: options?.sectionId ?? { $in: scope.sectionIds }
  };
};

export const buildSubjectEnrollmentFilter = (
  profile: StudentProfile,
  institutionType: InstitutionType,
  schoolId: unknown
): Record<string, unknown> => {
  const filter: Record<string, unknown> = { schoolId };

  if (isCollege(institutionType) && profile.yearId) {
    filter.yearIds = profile.yearId;
  } else if (profile.classId) {
    filter.classIds = profile.classId;
  }

  return filter;
};