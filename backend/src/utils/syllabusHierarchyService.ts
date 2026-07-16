import mongoose, { type ClientSession, type Types } from "mongoose";
import type {
  AcademicSyllabusChapterInput,
  AcademicSyllabusChapterRecord,
  AcademicSyllabusSubUnitInputShape,
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

/** Preserve existing Mongo ids from form clientKey when re-saving hierarchy. */
const forcedObjectId = (clientKey?: string): Types.ObjectId | undefined => {
  if (!clientKey || !mongoose.isValidObjectId(clientKey)) return undefined;
  // Ignore temporary client keys like "sub-123-1"
  if (!/^[a-f\d]{24}$/i.test(clientKey)) return undefined;
  return new mongoose.Types.ObjectId(clientKey);
};

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

/** Flatten a nested sub-unit tree depth-first. */
export const flattenSubUnits = <T extends { children?: T[] }>(subs: T[]): T[] => {
  const out: T[] = [];
  const walk = (nodes: T[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(subs);
  return out;
};

/** Format unit heading for Session Plan (Unit Name / Unit Heading only). */
export const formatUnitHeading = (unitNo: number, title: string): string => {
  const trimmed = title.trim();
  if (!trimmed) return `Unit ${unitNo}`;
  // Avoid double "Unit N :" prefix when title already includes it
  if (/^unit\s*\d+/i.test(trimmed)) return trimmed;
  return `Unit ${unitNo} : ${trimmed}`;
};

const blankSubInput = (
  subUnitNo: number,
  heading: string,
  extras: Partial<AcademicSyllabusSubUnitInputShape> = {}
): AcademicSyllabusSubUnitInputShape => ({
  subUnitNo,
  heading,
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
  todaysCoverage: "",
  children: [],
  ...extras
});

/** Convert legacy flat units into hierarchical chapter input (in-memory). */
export const legacyUnitsToChapters = (units: LegacyUnitLike[]): AcademicSyllabusChapterInput[] => {
  if (!units.length) {
    return [
      {
        chapterNo: 1,
        sectionKind: "NONE" as const,
        title: "",
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
            practicalRequired: false,
            subUnits: [blankSubInput(1, "Topic 1")]
          }
        ]
      }
    ];
  }

  // Each legacy row becomes one Unit under an optional Chapter named from chapterName
  return units.map((unit, index) => {
    const unitNo = unit.unitNo || index + 1;
    const topics = parseTopicLines(unit.topicsCovered);
    const subUnits: AcademicSyllabusSubUnitInputShape[] =
      topics.length > 0
        ? topics.map((heading, subIndex) =>
            blankSubInput(subIndex + 1, heading, {
              learningOutcomes: unit.learningOutcomes || "",
              internalAssessment: unit.internalAssessment || "",
              practicalRequired: Boolean(unit.practicalRequired),
              references: { ...emptyRefs(), freeText: unit.references || "" },
              teachingHours:
                topics.length > 0
                  ? Math.round(((unit.estimatedTeachingHours ?? 0) / topics.length) * 100) / 100
                  : unit.estimatedTeachingHours ?? 0,
              attachments: unit.attachmentUrl
                ? [{ url: unit.attachmentUrl, name: "Attachment" as const }]
                : [],
              status: mapLegacyStatus(unit.status)
            })
          )
        : [
            blankSubInput(1, unit.chapterName || `Topic ${unitNo}`, {
              description: unit.topicsCovered || "",
              learningOutcomes: unit.learningOutcomes || "",
              internalAssessment: unit.internalAssessment || "",
              practicalRequired: Boolean(unit.practicalRequired),
              references: { ...emptyRefs(), freeText: unit.references || "" },
              teachingHours: unit.estimatedTeachingHours ?? 0,
              attachments: unit.attachmentUrl
                ? [{ url: unit.attachmentUrl, name: "Attachment" as const }]
                : [],
              status: mapLegacyStatus(unit.status)
            })
          ];

    return {
      chapterNo: index + 1,
      sectionKind: "NONE" as const,
      title: "",
      description: "",
      estimatedHours: unit.estimatedTeachingHours ?? 0,
      weightagePercent: 0,
      references: unit.references || "",
      remarks: "",
      tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
      units: [
        {
          unitNo,
          title: unit.chapterName || `Unit ${unitNo}`,
          description: unit.topicsCovered || "",
          teachingHours: unit.estimatedTeachingHours ?? 0,
          learningObjective: unit.learningOutcomes || "",
          references: unit.references || "",
          remarks: "",
          practicalRequired: Boolean(unit.practicalRequired),
          subUnits
        }
      ]
    };
  });
};

/**
 * Flatten hierarchy into legacy unit rows — one row per Unit (not Chapter).
 * Used for Session Plan import and older clients. Sub-units are not listed as rows.
 */
export const chaptersToLegacyUnits = (
  chapters: AcademicSyllabusChapterInput[],
  syllabusId: string
): Omit<AcademicSyllabusUnitRecord, "_id">[] => {
  const rows: Omit<AcademicSyllabusUnitRecord, "_id">[] = [];
  let sequentialNo = 0;

  for (const chapter of chapters) {
    for (const unit of chapter.units ?? []) {
      sequentialNo += 1;
      const unitNo = unit.unitNo || sequentialNo;
      const allSubUnits = flattenSubUnits(unit.subUnits ?? []);
      const topicsCovered = allSubUnits.map((s) => s.heading).filter(Boolean).join("\n");
      const learningOutcomes =
        unit.learningObjective ||
        allSubUnits
          .map((s) => s.learningOutcomes)
          .filter(Boolean)
          .join("\n");
      const estimatedTeachingHours =
        unit.teachingHours ||
        allSubUnits.reduce((sum, su) => sum + (su.teachingHours || 0), 0);
      const practicalRequired =
        Boolean(unit.practicalRequired) || allSubUnits.some((s) => s.practicalRequired);
      const statuses = allSubUnits.map((s) => s.status || "NOT_STARTED");
      let status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DELAYED" = "PENDING";
      if (statuses.length > 0 && statuses.every((s) => s === "COMPLETED" || s === "SKIPPED")) {
        status = "COMPLETED";
      } else if (statuses.some((s) => s === "IN_PROGRESS" || s === "COMPLETED")) {
        status = "IN_PROGRESS";
      } else if (statuses.some((s) => s === "REVISION_REQUIRED")) {
        status = "DELAYED";
      }

      rows.push({
        syllabusId,
        unitNo: sequentialNo,
        chapterName: formatUnitHeading(unitNo, unit.title || `Unit ${unitNo}`),
        estimatedTeachingHours,
        learningOutcomes,
        topicsCovered,
        references: unit.references || chapter.references || "",
        practicalRequired,
        internalAssessment: allSubUnits.map((s) => s.internalAssessment).filter(Boolean).join("; "),
        tentativeCompletionMonth: chapter.tentativeCompletionMonth || "",
        startDateBs: "",
        endDateBs: "",
        status
      });
    }
  }

  return rows;
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

type SubUnitInput = AcademicSyllabusSubUnitInputShape;

const insertSubUnitTree = async (
  params: {
    schoolId: string;
    syllabusId: string;
    chapterId: Types.ObjectId;
    unitId: Types.ObjectId;
    parentSubUnitId: Types.ObjectId | null;
    subUnits: SubUnitInput[];
  },
  session?: ClientSession
) => {
  const opts = session ? { session } : {};
  const { schoolId, syllabusId, chapterId, unitId, parentSubUnitId, subUnits } = params;

  for (let sIndex = 0; sIndex < subUnits.length; sIndex++) {
    const sub = subUnits[sIndex]!;
    const subUnitNo = sub.subUnitNo || sIndex + 1;
    const forcedId = forcedObjectId(sub.clientKey);
    const [subDoc] = await AcademicSyllabusSubUnit.create(
      [
        {
          ...(forcedId ? { _id: forcedId } : {}),
          schoolId,
          syllabusId,
          chapterId,
          unitId,
          parentSubUnitId,
          subUnitNo,
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
        }
      ],
      opts
    );
    if (!subDoc) continue;

    const children = sub.children ?? [];
    if (children.length > 0) {
      await insertSubUnitTree(
        {
          schoolId,
          syllabusId,
          chapterId,
          unitId,
          parentSubUnitId: subDoc._id as Types.ObjectId,
          subUnits: children
        },
        session
      );
    }
  }
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

  for (let cIndex = 0; cIndex < chapters.length; cIndex++) {
    const chapter = chapters[cIndex]!;
    const chapterNo = chapter.chapterNo || cIndex + 1;
    const sectionKind =
      (chapter as { sectionKind?: string }).sectionKind === "CHAPTER" ||
      (chapter as { sectionKind?: string }).sectionKind === "PART"
        ? (chapter as { sectionKind: "CHAPTER" | "PART" }).sectionKind
        : (chapter.title || "").trim()
          ? "CHAPTER"
          : "NONE";
    const forcedChapterId = forcedObjectId(
      (chapter as { clientKey?: string }).clientKey
    );
    const [chapterDoc] = await AcademicSyllabusChapter.create(
      [
        {
          ...(forcedChapterId ? { _id: forcedChapterId } : {}),
          schoolId,
          syllabusId,
          chapterNo,
          sectionKind,
          title: sectionKind === "NONE" ? "" : (chapter.title || "").trim(),
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

    const units = chapter.units ?? [];
    for (let uIndex = 0; uIndex < units.length; uIndex++) {
      const unit = units[uIndex]!;
      const unitNo = unit.unitNo || uIndex + 1;
      const forcedUnitId = forcedObjectId(
        (unit as { clientKey?: string }).clientKey
      );
      const [unitDoc] = await AcademicSyllabusTopic.create(
        [
          {
            ...(forcedUnitId ? { _id: forcedUnitId } : {}),
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
            practicalRequired: Boolean(unit.practicalRequired),
            sortOrder: uIndex
          }
        ],
        opts
      );
      if (!unitDoc) continue;

      const subUnits = unit.subUnits ?? [];
      if (subUnits.length === 0) continue;

      await insertSubUnitTree(
        {
          schoolId,
          syllabusId,
          chapterId: chapterDoc._id as Types.ObjectId,
          unitId: unitDoc._id as Types.ObjectId,
          parentSubUnitId: null,
          subUnits
        },
        session
      );
    }
  }

  // Keep legacy flat units synced for Session Plan + older clients (one row per Unit)
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

type LeanSub = {
  _id: { toString(): string };
  syllabusId: { toString(): string };
  chapterId: { toString(): string };
  unitId: { toString(): string };
  parentSubUnitId?: { toString(): string } | null;
  subUnitNo: number;
  heading: string;
  description?: string;
  learningOutcomes?: string;
  internalAssessment?: string;
  practicalRequired?: boolean;
  labName?: string;
  requiredEquipment?: string;
  hospitalPosting?: string;
  clinicalHours?: number;
  references?: object;
  teachingHours?: number;
  attachments?: AcademicSyllabusSubUnitRecord["attachments"];
  remarks?: string;
  status?: string;
  teachingNotes?: string;
  teacherAttachments?: AcademicSyllabusSubUnitRecord["teacherAttachments"];
  todaysCoverage?: string;
  sortOrder?: number;
};

const buildSubUnitTree = (
  flatSubs: LeanSub[],
  unitNo: number,
  parentId: string | null = null,
  prefix = String(unitNo),
  depth = 0
): AcademicSyllabusSubUnitRecord[] => {
  const siblings = flatSubs
    .filter((s) => {
      const pid = s.parentSubUnitId?.toString?.() ?? null;
      return parentId === null ? !pid : pid === parentId;
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.subUnitNo - b.subUnitNo);

  return siblings.map((sub, index) => {
    const subUnitNo = sub.subUnitNo || index + 1;
    const displayNo = `${prefix}.${subUnitNo}`;
    const status = (sub.status || "NOT_STARTED") as SyllabusSubUnitStatus;
    const children = buildSubUnitTree(
      flatSubs,
      unitNo,
      sub._id.toString(),
      displayNo,
      depth + 1
    );

    // Aggregate completion from leaves
    const allDescendants = flattenSubUnits([{ children, status } as { children: typeof children; status: SyllabusSubUnitStatus }]);
    const leafStatuses =
      children.length > 0
        ? flattenSubUnits(children).map((c) => c.status)
        : [status];
    const completedLeaf = leafStatuses.filter((s) => subUnitDone(s)).length;
    const completedPercent =
      leafStatuses.length > 0
        ? Math.round((completedLeaf / leafStatuses.length) * 100)
        : subUnitDone(status)
          ? 100
          : status === "IN_PROGRESS"
            ? 50
            : 0;

    void allDescendants;

    return {
      _id: sub._id.toString(),
      syllabusId: sub.syllabusId.toString(),
      chapterId: sub.chapterId.toString(),
      unitId: sub.unitId.toString(),
      parentSubUnitId: sub.parentSubUnitId?.toString?.() || undefined,
      subUnitNo,
      displayNo,
      depth,
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
      completedPercent,
      children
    };
  });
};

const countSubUnitsInTree = (subs: AcademicSyllabusSubUnitRecord[]): { total: number; completed: number } => {
  let total = 0;
  let completed = 0;
  const walk = (nodes: AcademicSyllabusSubUnitRecord[]) => {
    for (const node of nodes) {
      if (node.children.length === 0) {
        total += 1;
        if (subUnitDone(node.status)) completed += 1;
      } else {
        walk(node.children);
      }
    }
  };
  walk(subs);
  // If no leaves exist but nodes do, count nodes themselves
  if (total === 0 && subs.length > 0) {
    const all = flattenSubUnits(subs);
    total = all.length;
    completed = all.filter((s) => subUnitDone(s.status)).length;
  }
  return { total, completed };
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

  const subsByUnit = new Map<string, LeanSub[]>();
  for (const sub of subUnits) {
    const key = sub.unitId.toString();
    const list = subsByUnit.get(key) ?? [];
    list.push(sub as LeanSub);
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
      const subRecords = buildSubUnitTree(topicSubs, topic.unitNo);
      const { total: totalSubUnits, completed: completedSubUnits } =
        countSubUnitsInTree(subRecords);
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
        practicalRequired: Boolean(
          (topic as { practicalRequired?: boolean }).practicalRequired
        ),
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

    const rawKind = (chapter as { sectionKind?: string }).sectionKind;
    const sectionKind =
      rawKind === "CHAPTER" || rawKind === "PART"
        ? rawKind
        : chapter.title
          ? ("CHAPTER" as const)
          : ("NONE" as const);

    return {
      _id: chapter._id.toString(),
      syllabusId: chapter.syllabusId.toString(),
      chapterNo: chapter.chapterNo,
      sectionKind,
      title: chapter.title || "",
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
      const allSubs = flattenSubUnits(unit.subUnits);
      // Prefer leaf hours; if none, use unit hours
      const leaves =
        allSubs.length > 0
          ? allSubs.filter((s) => !s.children?.length)
          : [];
      const hourSources = leaves.length > 0 ? leaves : allSubs;
      if (hourSources.length === 0) {
        teachingHoursTotal += unit.teachingHours || 0;
        continue;
      }
      for (const sub of hourSources) {
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

      // Renumber siblings under each parent (including null = top-level)
      const renumberSiblings = async (parentId: Types.ObjectId | null) => {
        const filter =
          parentId === null
            ? { unitId: unit._id, $or: [{ parentSubUnitId: null }, { parentSubUnitId: { $exists: false } }] }
            : { unitId: unit._id, parentSubUnitId: parentId };
        const subs = await AcademicSyllabusSubUnit.find(filter)
          .sort({ sortOrder: 1, subUnitNo: 1 })
          .session(session ?? null);

        for (let sIndex = 0; sIndex < subs.length; sIndex++) {
          const sub = subs[sIndex]!;
          sub.subUnitNo = sIndex + 1;
          sub.sortOrder = sIndex;
          await sub.save(opts);
          await renumberSiblings(sub._id as Types.ObjectId);
        }
      };

      await renumberSiblings(null);
    }
  }
};

export { mapToLegacyUnitStatus };
