export const filterSectionsByClass = (sections, classId) => classId ? sections.filter((section) => section.classId === classId) : [];
export const filterSubjectsByClass = (subjects, classId) => classId ? subjects.filter((subject) => (subject.classIds ?? []).includes(classId)) : [];
export const hasSingleOption = (items) => items.length === 1;
