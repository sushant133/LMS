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

export const filterSectionsByClass = (sections: AcademicScopeOption[], classId: string): AcademicScopeOption[] =>
  classId ? sections.filter((section) => section.classId === classId) : [];

export const filterYearsByBatch = (years: AcademicScopeOption[], batchId: string): AcademicScopeOption[] =>
  batchId ? years.filter((year) => year.batchId === batchId) : [];

export const filterSubjectsByClass = (subjects: AcademicScopeOption[], classId: string): AcademicScopeOption[] =>
  classId ? subjects.filter((subject) => (subject.classIds ?? []).includes(classId)) : [];

export const filterSubjectsByYear = (subjects: AcademicScopeOption[], yearId: string): AcademicScopeOption[] =>
  yearId
    ? subjects.filter((subject) => (subject.yearIds ?? []).includes(yearId) && subject.isActive !== false)
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