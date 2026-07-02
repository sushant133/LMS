export interface ScopeOption {
  _id: string;
  name: string;
  code?: string;
  classId?: string;
  classIds?: string[];
}

export const filterSectionsByClass = (sections: ScopeOption[], classId: string): ScopeOption[] =>
  classId ? sections.filter((section) => section.classId === classId) : [];

export const filterSubjectsByClass = (subjects: ScopeOption[], classId: string): ScopeOption[] =>
  classId ? subjects.filter((subject) => (subject.classIds ?? []).includes(classId)) : [];

export const hasSingleOption = (items: ScopeOption[]): boolean => items.length === 1;