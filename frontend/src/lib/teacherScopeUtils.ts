export {
  filterSectionsByClass,
  filterYearsByBatch,
  filterSubjectsByClass,
  filterSubjectsByYear,
  type AcademicScopeOption as ScopeOption
} from "./academicStructureUtils";

export const hasSingleOption = <T extends { _id: string }>(items: T[]): boolean => items.length === 1;