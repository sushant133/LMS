import type { InstitutionType } from "@phit-erp/shared";

export interface AcademicScopeOption {
  _id: string;
  name: string;
  code?: string;
  classId?: string;
  batchId?: string;
  classIds?: string[];
  yearIds?: string[];
  isActive?: boolean;
}

export const isCollegeInstitution = (institutionType: InstitutionType): boolean => institutionType === "COLLEGE";

const idEq = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b);

const idIn = (list: unknown[] | undefined, id: unknown): boolean =>
  (list ?? []).some((item) => idEq(item, id));

export const filterSectionsByClass = (sections: AcademicScopeOption[], classId: string): AcademicScopeOption[] =>
  classId ? sections.filter((section) => idEq(section.classId, classId)) : [];

export const filterYearsByBatch = (years: AcademicScopeOption[], batchId: string): AcademicScopeOption[] =>
  batchId ? years.filter((year) => idEq(year.batchId, batchId)) : [];

export const filterSubjectsByClass = (subjects: AcademicScopeOption[], classId: string): AcademicScopeOption[] =>
  classId ? subjects.filter((subject) => idIn(subject.classIds, classId)) : [];

export const filterSubjectsByYear = (subjects: AcademicScopeOption[], yearId: string): AcademicScopeOption[] =>
  yearId
    ? subjects.filter(
        (subject) => idIn(subject.yearIds, yearId) && subject.isActive !== false,
      )
    : [];

export const getAcademicLabels = (institutionType: InstitutionType) =>
  isCollegeInstitution(institutionType)
    ? {
        primary: "Batch",
        secondary: "Year",
        primaryPlural: "Batches",
        secondaryPlural: "Years",
        groupLabel: "Batch / Year"
      }
    : {
        primary: "Class",
        secondary: "Section",
        primaryPlural: "Classes",
        secondaryPlural: "Sections",
        groupLabel: "Class / Section"
      };