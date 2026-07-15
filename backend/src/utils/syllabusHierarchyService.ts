import type { ClientSession } from "mongoose";
import type {
  AcademicSyllabusChapterInput,
  AcademicSyllabusChapterRecord,
  AcademicSyllabusSubUnitRecord,
  AcademicSyllabusTopicRecord,
  AcademicSyllabusUnitRecord,
  SyllabusSubUnitStatus
} from "@phit-erp/shared";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusChapter } from "../models/AcademicSyllabusChapter.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";

type LegacyUnitLike = {
  unitNo: number;
  chapterName: string;
  estimatedTeachingHours?: number;
  learningOutcomes?: string;
  topicsCovered?: string;
  references?: string;
  practicalRequired?: boolean;
  internalAssessment?: string;
  tentativeCompletionMonth?: string;
  startDateBs?: string;
  endDateBs?: string;
  status?: string;
  attachmentUrl?: string | null;
};

const emptyRefs = () => ({
  textbooks: "",
  journal: "",
  whoGuidelines: "",
  internetResources: "",
  freeText: ""
});

export const parseTopicLines = (topicsCovered?: string): string[] => {
  if (!topicsCovered?.trim()) return [];
  return topicsCovered
    .split(/[\n;|]+/)
    .flatMap((part) => part.split(/,(?=\s)/))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
};

const mapLegacyStatus = (status?: string): SyllabusSubUnitStatus => {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "DELAYED":
      return "REVISION_REQUIRED";
    default:
      return "NOT_STARTED";
  }
};

const subUnitDone = (status: SyllabusSubUnitStatus): boolean =>
  status === "COMPLETED" || status === "SKIPPED";

const mapToLegacyUnitStatus = (
  status: SyllabusSubUnitStatus
): "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED" => {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "REVISION_REQUIRED":
      return "DELAYED";
    default:
      return "PENDING";
  }
};

/** Convert legacy flat units into hierarchical chapter input (in-memory). */
export const legacyUnitsToChapters = (units: LegacyUnitLike[]): AcademicSyllabusChapterInput[] => {
  if (!units.length) {
    return [
      {
        chapterNo: 1,
        title: "Chapter 1",
        description: "",
        estimatedHours: 0,
        weightagePercent: 0,
        references: "",
        remarks: "",
        tentativeCompletionMonth: "",
        units: [
          {
            unitNo: 1,
            title: "Unit 1",
            description: "",
            teachingHours: 0,
            learningObjective: "",
            references: "",
            remarks: "",
            subUnits: [
              {
                subUnitNo: 1,
                heading: "Topic 1",
                description: "",
                learningOutcomes: "",
                internalAssessment: "",
                practicalRequired: false,
                labName: "",
                requiredEquipment: "",
                hospitalPosting: "",
                clinicalHours: 0,
                references: emptyRefs(),
                teachingHours: 0,
                attachments: [],
                remarks: "",
                status: "NOT_STARTED",
                teachingNotes: "",
                teacherAttachments: [],
                todaysCoverage: ""
              }
            ]
          }
        ]
      }
    ];
  }

  return units.map((unit, index) => {
    const chapterNo = unit.unitNo || index + 1;
    const topics = parseTopicLines(unit.topicsCovered);
    const subUnits =
      topics.length > 0
        ? topics.map((heading, subIndex) => ({
            subUnitNo: subIndex + 1,
            heading,
            description: "",
            learningOutcomes: unit.learningOutcomes || "",
            internalAssessment: unit.internalAssessment || "",
            practicalRequired: Boolean(unit.practicalRequired),
            labName: "",
            requiredEquipment: "",
            hospitalPosting: "",
            clinicalHours: 0,
            references: { ...emptyRefs(), freeText: unit.references || "" },
            teachingHours:
              topics.length > 0
                ? Math.round(((unit.estimatedTeachingHours ?? 0) / topics.length) * 100) / 100
                : unit.estimatedTeachingHours ?? 0,
            attachments: unit.attachmentUrl
              ? [{ url: unit.attachmentUrl, name: "Attachment" as const }]
              : [],
            remarks: "",
            status: mapLegacyStatus(unit.status),
            teachingNotes: "",
            teacherAttachments: [],
            todaysCoverage: ""
          }))
        : [
            {
              subUnitNo: 1,
              heading: unit.chapterName || `Topic ${chapterNo}`,
              description: unit.topicsCovered || "",
              learningOutcomes: unit.learningOutcomes || "",
              internalAssessment: unit.internalAssessment || "",
              practicalRequired: Boolean(unit.practicalRequired),
              labName: "",
              requiredEquipment: "",
              hospitalPosting: "",
              clinicalHours: 0,
              references: { ...emptyRefs(), freeText: unit.references || "" },
              teachingHours: unit.estimatedTeachingHours ?? 0,
              attachments: unit.attachmentUrl
                ? [{ url: unit.attachmentUrl, name: "Attachment" as const }]
                : [],
              remarks: "",
              status: mapLegacyStatus(unit.status),
              teachingNotes: "",
              teacherAttachments: [],
              todaysCoverage: ""
            }
          ];

    return {
      chapterNo,
      title: unit.chapterName || `Chapter ${chapterNo}`,
      description: "",
      estimatedHours: unit.estimatedTeachingHours ?? 0,
      weightagePercent: 0,
      references: unit.references || "",
      remarks: "",
      tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
      units: [
        {
          unitNo: 1,
          title: unit.chapterName || `Unit 1`,
          description: unit.topicsCovered || "",
          teachingHours: unit.estimatedTeachingHours ?? 0,
          learningObjective: unit.learningOutcomes || "",
          references: unit.references || "",
          remarks: "",
          subUnits
        }
      ]
    };
  });
};

/** Flatten hierarchy into legacy unit rows (for Session Plan import / old clients). */
export const chaptersToLegacyUnits = (
  chapters: AcademicSyllabusChapterInput[],
  syllabusId: string
): Omit<AcademicSyllabusUnitRecord, "_id">[] => {
  return chapters.map((chapter, index) => {
    const chapterNo = chapter.chapterNo || index + 1;
    const allSubUnits = (chapter.units ?? []).flatMap((unit) => unit.subUnits ?? []);
    const topicsCovered = allSubUnits.map((s) => s.heading).filter(Boolean).join("\n");
    const learningOutcomes =
      (chapter.units ?? [])
        .map((u) => u.learningObjective)
        .filter(Boolean)
        .join("\n") ||
      allSubUnits
        .map((s) => s.learningOutcomes)
        .filter(Boolean)
        .join("\n");
    const estimatedTeachingHours =
      chapter.estimatedHours ||
      (chapter.units ?? []).reduce(
        (sum, u) =>
          sum +
          (u.teachingHours ||
            (u.subUnits ?? []).reduce((s, su) => s + (su.teachingHours || 0), 0)),
        0
      );
    const practicalRequired = allSubUnits.some((s) => s.practicalRequired);
    const statuses = allSubUnits.map((s) => s.status || "NOT_STARTED");
    let status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED" = "PENDING";
    if (statuses.length > 0 && statuses.every((s) => s === "COMPLETED" || s === "SKIPPED")) {
      status = "COMPLETED";
    } else if (statuses.some((s) => s === "IN_PROGRESS" || s === "COMPLETED")) {
      status = "IN_PROGRESS";
    } else if (statuses.some((s) => s === "REVISION_REQUIRED")) {
      status = "DELAYED";
    }

    return {
      syllabusId,
      unitNo: chapterNo,
      chapterName: chapter.title,
      estimatedTeachingHours,
      learningOutcomes,
      topicsCovered,
      references: chapter.references || "",
      practicalRequired,
      internalAssessment: allSubUnits.map((s) => s.internalAssessment).filter(Boolean).join("; "),
      tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
      startDateBs: "",
      endDateBs: "",
      status
    };
  });
};

export const deleteSyllabusHierarchy = async (
  syllabusId: string,
  session?: ClientSession
) => {
  const opts = session ? { session } : {};
  await AcademicSyllabusSubUnit.deleteMany({ syllabusId }, opts);
  await AcademicSyllabusTopic.deleteMany({ syllabusId }, opts);
  await AcademicSyllabusChapter.deleteMany({ syllabusId }, opts);
};

/** Persist full hierarchy and keep legacy AcademicSyllabusUnit in sync. */
export const saveSyllabusHierarchy = async (
  params: {
    schoolId: string;
    syllabusId: string;
    chapters: AcademicSyllabusChapterInput[];
  },
  session?: ClientSession
) => {
  const { schoolId, syllabusId, chapters } = params;
  const opts = session ? { session } : {};

  await deleteSyllabusHierarchy(syllabusId, session);

  const chapterDocs: Array<{ _id: unknown; chapterNo: number }> = [];
  for (let cIndex = 0; cIndex < chapters.length; cIndex++) {
    const chapter = chapters[cIndex]!;
    const chapterNo = chapter.chapterNo || cIndex + 1;
    const [chapterDoc] = await AcademicSyllabusChapter.create(
      [
        {
          schoolId,
          syllabusId,
          chapterNo,
          title: chapter.title.trim(),
          description: chapter.description || "",
          estimatedHours: chapter.estimatedHours ?? 0,
          weightagePercent: chapter.weightagePercent ?? 0,
          references: chapter.references || "",
          remarks: chapter.remarks || "",
          tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
          sortOrder: cIndex
        }
      ],
      opts
    );
    if (!chapterDoc) continue;
    chapterDocs.push({ _id: chapterDoc._id, chapterNo });

    const units = chapter.units ?? [];
    for (let uIndex = 0; uIndex < units.length; uIndex++) {
      const unit = units[uIndex]!;
      const unitNo = unit.unitNo || uIndex + 1;
      const [unitDoc] = await AcademicSyllabusTopic.create(
        [
          {
            schoolId,
            syllabusId,
            chapterId: chapterDoc._id,
            unitNo,
            title: unit.title.trim(),
            description: unit.description || "",
            teachingHours: unit.teachingHours ?? 0,
            learningObjective: unit.learningObjective || "",
            references: unit.references || "",
            remarks: unit.remarks || "",
            sortOrder: uIndex
          }
        ],
        opts
      );
      if (!unitDoc) continue;

      const subUnits = unit.subUnits ?? [];
      if (subUnits.length === 0) continue;

      await AcademicSyllabusSubUnit.insertMany(
        subUnits.map((sub, sIndex) => ({
          schoolId,
          syllabusId,
          chapterId: chapterDoc._id,
          unitId: unitDoc._id,
          subUnitNo: sub.subUnitNo || sIndex + 1,
          heading: sub.heading.trim(),
          description: sub.description || "",
          learningOutcomes: sub.learningOutcomes || "",
          internalAssessment: sub.internalAssessment || "",
          practicalRequired: Boolean(sub.practicalRequired),
          labName: sub.labName || "",
          requiredEquipment: sub.requiredEquipment || "",
          hospitalPosting: sub.hospitalPosting || "",
          clinicalHours: sub.clinicalHours ?? 0,
          references: {
            ...emptyRefs(),
            ...(sub.references ?? {})
          },
          teachingHours: sub.teachingHours ?? 0,
          attachments: sub.attachments ?? [],
          remarks: sub.remarks || "",
          status: sub.status || "NOT_STARTED",
          teachingNotes: sub.teachingNotes || "",
          teacherAttachments: sub.teacherAttachments ?? [],
          todaysCoverage: sub.todaysCoverage || "",
          sortOrder: sIndex
        })),
        opts
      );
    }
  }

  // Keep legacy flat units synced for Session Plan + older clients
  const legacyUnits = chaptersToLegacyUnits(chapters, syllabusId);
  await AcademicSyllabusUnit.deleteMany({ syllabusId }, opts);
  if (legacyUnits.length > 0) {
    await AcademicSyllabusUnit.insertMany(
      legacyUnits.map((unit) => ({
        ...unit,
        schoolId,
        syllabusId
      })),
      opts
    );
  }

  await AcademicSyllabus.updateOne(
    { _id: syllabusId },
    { $set: { hierarchyMigratedAt: new Date() } },
    opts
  );
};

/** Auto-migrate legacy flat units into hierarchy when chapters are missing. */
export const ensureSyllabusHierarchy = async (syllabusId: string, schoolId: string) => {
  const chapterCount = await AcademicSyllabusChapter.countDocuments({ syllabusId });
  if (chapterCount > 0) return false;

  const legacyUnits = await AcademicSyllabusUnit.find({ syllabusId }).sort({ unitNo: 1 }).lean();
  if (legacyUnits.length === 0) return false;

  const chapters = legacyUnitsToChapters(
    legacyUnits.map((u) => ({
      unitNo: u.unitNo,
      chapterName: u.chapterName,
      estimatedTeachingHours: u.estimatedTeachingHours,
      learningOutcomes: u.learningOutcomes,
      topicsCovered: u.topicsCovered,
      references: u.references,
      practicalRequired: u.practicalRequired,
      internalAssessment: u.internalAssessment,
      tentativeCompletionMonth: u.tentativeCompletionMonth,
      status: u.status,
      attachmentUrl: u.attachmentUrl
    }))
  );

  await saveSyllabusHierarchy({ schoolId, syllabusId, chapters });
  return true;
};

export const loadSyllabusHierarchy = async (
  syllabusId: string
): Promise<AcademicSyllabusChapterRecord[]> => {
  const chapters = await AcademicSyllabusChapter.find({ syllabusId })
    .sort({ sortOrder: 1, chapterNo: 1 })
    .lean();
  if (chapters.length === 0) return [];

  const chapterIds = chapters.map((c) => c._id);
  const topics = await AcademicSyllabusTopic.find({ chapterId: { $in: chapterIds } })
    .sort({ sortOrder: 1, unitNo: 1 })
    .lean();
  const topicIds = topics.map((t) => t._id);
  const subUnits = topicIds.length
    ? await AcademicSyllabusSubUnit.find({ unitId: { $in: topicIds } })
        .sort({ sortOrder: 1, subUnitNo: 1 })
        .lean()
    : [];

  const subsByUnit = new Map<string, typeof subUnits>();
  for (const sub of subUnits) {
    const key = sub.unitId.toString();
    const list = subsByUnit.get(key) ?? [];
    list.push(sub);
    subsByUnit.set(key, list);
  }

  const topicsByChapter = new Map<string, typeof topics>();
  for (const topic of topics) {
    const key = topic.chapterId.toString();
    const list = topicsByChapter.get(key) ?? [];
    list.push(topic);
    topicsByChapter.set(key, list);
  }

  return chapters.map((chapter) => {
    const chapterTopics = topicsByChapter.get(chapter._id.toString()) ?? [];
    const units: AcademicSyllabusTopicRecord[] = chapterTopics.map((topic) => {
      const topicSubs = subsByUnit.get(topic._id.toString()) ?? [];
      const subRecords: AcademicSyllabusSubUnitRecord[] = topicSubs.map((sub) => {
        const status = (sub.status || "NOT_STARTED") as SyllabusSubUnitStatus;
        return {
          _id: sub._id.toString(),
          syllabusId: sub.syllabusId.toString(),
          chapterId: sub.chapterId.toString(),
          unitId: sub.unitId.toString(),
          subUnitNo: sub.subUnitNo,
          displayNo: `${topic.unitNo}.${sub.subUnitNo}`,
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
            ...emptyRefs(),
            ...(sub.references as object | undefined)
          },
          teachingHours: sub.teachingHours ?? 0,
          attachments: (sub.attachments as AcademicSyllabusSubUnitRecord["attachments"]) ?? [],
          remarks: sub.remarks || "",
          status,
          teachingNotes: sub.teachingNotes || "",
          teacherAttachments:
            (sub.teacherAttachments as AcademicSyllabusSubUnitRecord["teacherAttachments"]) ?? [],
          todaysCoverage: sub.todaysCoverage || "",
          completedPercent: subUnitDone(status) ? 100 : status === "IN_PROGRESS" ? 50 : 0
        };
      });

      const totalSubUnits = subRecords.length;
      const completedSubUnits = subRecords.filter((s) => subUnitDone(s.status)).length;
      const completedPercent =
        totalSubUnits > 0 ? Math.round((completedSubUnits / totalSubUnits) * 100) : 0;

      return {
        _id: topic._id.toString(),
        syllabusId: topic.syllabusId.toString(),
        chapterId: topic.chapterId.toString(),
        unitNo: topic.unitNo,
        title: topic.title,
        description: topic.description || "",
        teachingHours: topic.teachingHours ?? 0,
        learningObjective: topic.learningObjective || "",
        references: topic.references || "",
        remarks: topic.remarks || "",
        subUnits: subRecords,
        completedPercent,
        remainingPercent: Math.max(0, 100 - completedPercent),
        completedSubUnits,
        remainingSubUnits: totalSubUnits - completedSubUnits,
        totalSubUnits
      };
    });

    const totalSubUnits = units.reduce((sum, u) => sum + u.totalSubUnits, 0);
    const completedSubUnits = units.reduce((sum, u) => sum + u.completedSubUnits, 0);
    const completedPercent =
      totalSubUnits > 0 ? Math.round((completedSubUnits / totalSubUnits) * 100) : 0;

    return {
      _id: chapter._id.toString(),
      syllabusId: chapter.syllabusId.toString(),
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      description: chapter.description || "",
      estimatedHours: chapter.estimatedHours ?? 0,
      weightagePercent: chapter.weightagePercent ?? 0,
      references: chapter.references || "",
      remarks: chapter.remarks || "",
      tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
      units,
      completedPercent,
      remainingPercent: Math.max(0, 100 - completedPercent),
      completedSubUnits,
      remainingSubUnits: totalSubUnits - completedSubUnits,
      totalSubUnits
    };
  });
};

export const computeHierarchyStats = (chapters: AcademicSyllabusChapterRecord[]) => {
  const totalChapters = chapters.length;
  const totalTopics = chapters.reduce((sum, c) => sum + c.units.length, 0);
  const totalSubUnits = chapters.reduce((sum, c) => sum + c.totalSubUnits, 0);
  const completedSubUnits = chapters.reduce((sum, c) => sum + c.completedSubUnits, 0);
  const remainingSubUnits = totalSubUnits - completedSubUnits;
  const completedPercent =
    totalSubUnits > 0 ? Math.round((completedSubUnits / totalSubUnits) * 100) : 0;

  let teachingHoursTotal = 0;
  let teachingHoursCovered = 0;
  let theoryHours = 0;
  let practicalHours = 0;
  let theoryHoursCovered = 0;
  let practicalHoursCovered = 0;

  for (const chapter of chapters) {
    for (const unit of chapter.units) {
      for (const sub of unit.subUnits) {
        const hours = sub.teachingHours || 0;
        teachingHoursTotal += hours;
        if (sub.practicalRequired) {
          practicalHours += hours;
          if (subUnitDone(sub.status)) practicalHoursCovered += hours;
        } else {
          theoryHours += hours;
          if (subUnitDone(sub.status)) theoryHoursCovered += hours;
        }
        if (subUnitDone(sub.status)) teachingHoursCovered += hours;
      }
    }
  }

  return {
    totalChapters,
    totalTopics,
    totalSubUnits,
    completedSubUnits,
    remainingSubUnits,
    completedPercent,
    remainingPercent: Math.max(0, 100 - completedPercent),
    teachingHoursTotal,
    teachingHoursCovered,
    remainingTeachingHours: Math.max(0, teachingHoursTotal - teachingHoursCovered),
    theoryHours,
    practicalHours,
    theoryHoursCovered,
    practicalHoursCovered
  };
};

export const renumberAfterReorder = async (syllabusId: string, session?: ClientSession) => {
  const opts = session ? { session } : {};
  const chapters = await AcademicSyllabusChapter.find({ syllabusId })
    .sort({ sortOrder: 1, chapterNo: 1 })
    .session(session ?? null);

  for (let cIndex = 0; cIndex < chapters.length; cIndex++) {
    const chapter = chapters[cIndex]!;
    chapter.chapterNo = cIndex + 1;
    chapter.sortOrder = cIndex;
    await chapter.save(opts);

    const units = await AcademicSyllabusTopic.find({ chapterId: chapter._id })
      .sort({ sortOrder: 1, unitNo: 1 })
      .session(session ?? null);

    for (let uIndex = 0; uIndex < units.length; uIndex++) {
      const unit = units[uIndex]!;
      unit.unitNo = uIndex + 1;
      unit.sortOrder = uIndex;
      await unit.save(opts);

      const subs = await AcademicSyllabusSubUnit.find({ unitId: unit._id })
        .sort({ sortOrder: 1, subUnitNo: 1 })
        .session(session ?? null);

      for (let sIndex = 0; sIndex < subs.length; sIndex++) {
        const sub = subs[sIndex]!;
        sub.subUnitNo = sIndex + 1;
        sub.sortOrder = sIndex;
        await sub.save(opts);
      }
    }
  }
};

export { mapToLegacyUnitStatus };
