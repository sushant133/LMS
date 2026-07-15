import type {
  AcademicSyllabusChapterInput,
  AcademicSyllabusInput,
  AcademicSyllabusRecord,
  AcademicSyllabusSubUnitInput,
  AcademicSyllabusTopicInput,
  AcademicManagementFilters,
  SyllabusSubUnitStatus,
} from "@phit-erp/shared";

export type ChapterDraft = AcademicSyllabusChapterInput & { clientKey: string };
export type UnitDraft = AcademicSyllabusTopicInput & { clientKey: string };
export type SubUnitDraft = AcademicSyllabusSubUnitInput & { clientKey: string };

export type SyllabusFormState = Omit<AcademicSyllabusInput, "chapters" | "units"> & {
  chapters: ChapterDraft[];
};

let keySeq = 0;
export const nextClientKey = (prefix = "k") => `${prefix}-${Date.now()}-${++keySeq}`;

export const emptyReferences = () => ({
  textbooks: "",
  journal: "",
  whoGuidelines: "",
  internetResources: "",
  freeText: "",
});

export const emptySubUnit = (subUnitNo = 1): SubUnitDraft => ({
  clientKey: nextClientKey("sub"),
  subUnitNo,
  heading: "",
  description: "",
  learningOutcomes: "",
  internalAssessment: "",
  practicalRequired: false,
  labName: "",
  requiredEquipment: "",
  hospitalPosting: "",
  clinicalHours: 0,
  references: emptyReferences(),
  teachingHours: 0,
  attachments: [],
  remarks: "",
  status: "NOT_STARTED",
  teachingNotes: "",
  teacherAttachments: [],
  todaysCoverage: "",
});

export const emptyUnit = (unitNo = 1): UnitDraft => ({
  clientKey: nextClientKey("unit"),
  unitNo,
  title: "",
  description: "",
  teachingHours: 0,
  learningObjective: "",
  references: "",
  remarks: "",
  subUnits: [emptySubUnit(1)],
});

export const emptyChapter = (chapterNo = 1): ChapterDraft => ({
  clientKey: nextClientKey("ch"),
  chapterNo,
  title: "",
  description: "",
  estimatedHours: 0,
  weightagePercent: 0,
  references: "",
  remarks: "",
  tentativeCompletionMonth: "",
  units: [emptyUnit(1)],
});

export const blankSyllabusForm = (
  filters: AcademicManagementFilters,
): SyllabusFormState => ({
  academicYearBs: filters.academicYearBs || "2082/083",
  session: filters.session || filters.academicYearBs || "2082/083",
  faculty: filters.faculty || "",
  semesterBs: filters.semesterBs || "",
  classId: filters.classId,
  sectionId: filters.sectionId,
  batchId: filters.batchId,
  yearId: filters.yearId,
  subjectId: filters.subjectId || "",
  teacherId: filters.teacherId || "",
  subjectCode: "",
  totalTheoryHours: 0,
  totalPracticalHours: 0,
  creditHours: 0,
  remarks: "",
  attachmentUrl: "",
  chapters: [emptyChapter(1)],
});

export const renumberChapters = (chapters: ChapterDraft[]): ChapterDraft[] =>
  chapters.map((chapter, cIndex) => ({
    ...chapter,
    chapterNo: cIndex + 1,
    units: (chapter.units as UnitDraft[]).map((unit, uIndex) => ({
      ...unit,
      unitNo: uIndex + 1,
      subUnits: (unit.subUnits as SubUnitDraft[]).map((sub, sIndex) => ({
        ...sub,
        subUnitNo: sIndex + 1,
      })),
    })),
  }));

export const recordToForm = (plan: AcademicSyllabusRecord): SyllabusFormState => {
  if (plan.chapters && plan.chapters.length > 0) {
    return {
      academicYearBs: plan.academicYearBs,
      session: plan.session || plan.academicYearBs,
      faculty: plan.faculty || "",
      semesterBs: plan.semesterBs || "",
      classId: plan.classId,
      sectionId: plan.sectionId,
      batchId: plan.batchId,
      yearId: plan.yearId,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId || "",
      subjectCode: plan.subjectCode || plan.subject?.code || "",
      totalTheoryHours: plan.totalTheoryHours ?? 0,
      totalPracticalHours: plan.totalPracticalHours ?? 0,
      creditHours: plan.creditHours ?? 0,
      remarks: plan.remarks || "",
      attachmentUrl: plan.attachmentUrl || "",
      chapters: renumberChapters(
        plan.chapters.map((chapter) => ({
          clientKey: chapter._id || nextClientKey("ch"),
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          description: chapter.description || "",
          estimatedHours: chapter.estimatedHours ?? 0,
          weightagePercent: chapter.weightagePercent ?? 0,
          references: chapter.references || "",
          remarks: chapter.remarks || "",
          tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
          units: chapter.units.map((unit) => ({
            clientKey: unit._id || nextClientKey("unit"),
            unitNo: unit.unitNo,
            title: unit.title,
            description: unit.description || "",
            teachingHours: unit.teachingHours ?? 0,
            learningObjective: unit.learningObjective || "",
            references: unit.references || "",
            remarks: unit.remarks || "",
            subUnits: unit.subUnits.map((sub) => ({
              clientKey: sub._id || nextClientKey("sub"),
              subUnitNo: sub.subUnitNo,
              heading: sub.heading,
              description: sub.description || "",
              learningOutcomes: sub.learningOutcomes || "",
              internalAssessment: sub.internalAssessment || "",
              practicalRequired: Boolean(sub.practicalRequired),
              labName: sub.labName || "",
              requiredEquipment: sub.requiredEquipment || "",
              hospitalPosting: sub.hospitalPosting || "",
              clinicalHours: sub.clinicalHours ?? 0,
              references: {
                textbooks: sub.references?.textbooks || "",
                journal: sub.references?.journal || "",
                whoGuidelines: sub.references?.whoGuidelines || "",
                internetResources: sub.references?.internetResources || "",
                freeText: sub.references?.freeText || "",
              },
              teachingHours: sub.teachingHours ?? 0,
              attachments: sub.attachments ?? [],
              remarks: sub.remarks || "",
              status: sub.status || "NOT_STARTED",
              teachingNotes: sub.teachingNotes || "",
              teacherAttachments: sub.teacherAttachments ?? [],
              todaysCoverage: sub.todaysCoverage || "",
            })),
          })),
        })),
      ),
    };
  }

  // Fallback: legacy flat units → one chapter each
  const chapters: ChapterDraft[] =
    plan.units.length > 0
      ? plan.units.map((unit, index) => {
          const topics = (unit.topicsCovered || "")
            .split(/[\n;|]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          return {
            clientKey: unit._id || nextClientKey("ch"),
            chapterNo: unit.unitNo || index + 1,
            title: unit.chapterName || `Chapter ${index + 1}`,
            description: "",
            estimatedHours: unit.estimatedTeachingHours ?? 0,
            weightagePercent: 0,
            references: unit.references || "",
            remarks: "",
            tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
            units: [
              {
                clientKey: nextClientKey("unit"),
                unitNo: 1,
                title: unit.chapterName || "Unit 1",
                description: unit.topicsCovered || "",
                teachingHours: unit.estimatedTeachingHours ?? 0,
                learningObjective: unit.learningOutcomes || "",
                references: unit.references || "",
                remarks: "",
                subUnits:
                  topics.length > 0
                    ? topics.map((heading, sIndex) => ({
                        ...emptySubUnit(sIndex + 1),
                        heading,
                        learningOutcomes: unit.learningOutcomes || "",
                        practicalRequired: Boolean(unit.practicalRequired),
                        internalAssessment: unit.internalAssessment || "",
                        references: {
                          ...emptyReferences(),
                          freeText: unit.references || "",
                        },
                      }))
                    : [
                        {
                          ...emptySubUnit(1),
                          heading: unit.chapterName || "Topic 1",
                          description: unit.topicsCovered || "",
                          learningOutcomes: unit.learningOutcomes || "",
                          practicalRequired: Boolean(unit.practicalRequired),
                          internalAssessment: unit.internalAssessment || "",
                          teachingHours: unit.estimatedTeachingHours ?? 0,
                          references: {
                            ...emptyReferences(),
                            freeText: unit.references || "",
                          },
                        },
                      ],
              },
            ],
          };
        })
      : [emptyChapter(1)];

  return {
    academicYearBs: plan.academicYearBs,
    session: plan.session || plan.academicYearBs,
    faculty: plan.faculty || "",
    semesterBs: plan.semesterBs || "",
    classId: plan.classId,
    sectionId: plan.sectionId,
    batchId: plan.batchId,
    yearId: plan.yearId,
    subjectId: plan.subjectId,
    teacherId: plan.teacherId || "",
    subjectCode: plan.subjectCode || plan.subject?.code || "",
    totalTheoryHours: plan.totalTheoryHours ?? 0,
    totalPracticalHours: plan.totalPracticalHours ?? 0,
    creditHours: plan.creditHours ?? 0,
    remarks: plan.remarks || "",
    attachmentUrl: plan.attachmentUrl || "",
    chapters: renumberChapters(chapters),
  };
};

export const formToPayload = (form: SyllabusFormState): AcademicSyllabusInput => {
  const chapters = renumberChapters(form.chapters).map((chapter) => {
    const { clientKey: _ck, ...chapterRest } = chapter;
    return {
      ...chapterRest,
      title: chapter.title.trim(),
      units: (chapter.units as UnitDraft[]).map((unit) => {
        const { clientKey: _uk, ...unitRest } = unit;
        return {
          ...unitRest,
          title: unit.title.trim(),
          subUnits: (unit.subUnits as SubUnitDraft[]).map((sub) => {
            const { clientKey: _sk, ...subRest } = sub;
            return {
              ...subRest,
              heading: sub.heading.trim(),
            };
          }),
        };
      }),
    };
  });

  return {
    academicYearBs: form.academicYearBs,
    session: form.session || form.academicYearBs,
    faculty: form.faculty,
    semesterBs: form.semesterBs,
    classId: form.classId,
    sectionId: form.sectionId,
    batchId: form.batchId,
    yearId: form.yearId,
    subjectId: form.subjectId,
    teacherId: form.teacherId || "",
    subjectCode: form.subjectCode || "",
    totalTheoryHours: form.totalTheoryHours ?? 0,
    totalPracticalHours: form.totalPracticalHours ?? 0,
    creditHours: form.creditHours ?? 0,
    remarks: form.remarks || "",
    attachmentUrl: form.attachmentUrl,
    chapters,
  };
};

export const moveItem = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
};

export const SUB_UNIT_STATUS_OPTIONS: Array<{
  value: SyllabusSubUnitStatus;
  label: string;
}> = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
];

export const subUnitStatusBadgeClass = (status: string): string => {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "IN_PROGRESS":
      return "bg-sky-100 text-sky-800";
    case "SKIPPED":
      return "bg-slate-100 text-slate-700";
    case "REVISION_REQUIRED":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-600";
  }
};
