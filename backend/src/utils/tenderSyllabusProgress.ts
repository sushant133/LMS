import type { Types } from "mongoose";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const subUnitDone = (status: string): boolean =>
  status === "COMPLETED" || status === "SKIPPED";

type AssignmentLean = {
  teacherId?: unknown;
  subjectId?: unknown;
  assignmentType?: string;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
  handoverBaselinePercent?: number | null;
  yearId?: unknown;
  classId?: unknown;
  batchId?: unknown;
  academicYearBs?: string;
};

type SyllabusLean = {
  _id: Types.ObjectId;
  subjectId?: unknown;
  yearId?: unknown;
  classId?: unknown;
  batchId?: unknown;
};

type Leaf = {
  syllabusId: string;
  subjectId: string;
  yearId: string;
  classId: string;
  batchId: string;
  unitNo: number;
  leafId: string;
  completed: boolean;
};

export type TenderSyllabusProgress = {
  /** teacherId:subjectId → allotted-portion completion 0–100 */
  percentByTeacherSubject: Map<string, number>;
  /** teacherId:subjectId → "units 1–5" / "allotted 40%" */
  detailByTeacherSubject: Map<string, string>;
  /** teacherId → allotted subject ids */
  assignedSubjectsByTeacher: Map<string, string[]>;
};

const assignmentDetail = (asg: AssignmentLean): string => {
  const type = String(asg.assignmentType || "FULL").toUpperCase();
  if (type === "UNIT") {
    const from = Number(asg.unitFrom) || 1;
    const to = Number(asg.unitTo) || from;
    return from === to ? `unit ${from}` : `units ${Math.min(from, to)}–${Math.max(from, to)}`;
  }
  if (type === "PERCENTAGE") {
    const pct = Number(asg.assignedPercentage) || 0;
    return pct > 0 ? `allotted ${pct}%` : "allotted share";
  }
  return "full subject";
};

export const filterLeavesForAssignment = (
  leaves: Leaf[],
  asg: AssignmentLean
): Leaf[] => {
  const type = String(asg.assignmentType || "FULL").toUpperCase();
  if (type !== "UNIT") return leaves;
  const from = Number(asg.unitFrom) || 1;
  const to = Number(asg.unitTo) || from;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return leaves.filter((leaf) => leaf.unitNo >= lo && leaf.unitNo <= hi);
};

export const percentFromLeaves = (leaves: Leaf[]): number | null => {
  if (leaves.length === 0) return null;
  const done = leaves.filter((leaf) => leaf.completed).length;
  return round2((done / leaves.length) * 100);
};

const groupMatchScore = (syl: SyllabusLean, asg: AssignmentLean): number => {
  const asgYear = idStr(asg.yearId);
  const asgClass = idStr(asg.classId);
  const asgBatch = idStr(asg.batchId);
  const sylYear = idStr(syl.yearId);
  const sylClass = idStr(syl.classId);
  const sylBatch = idStr(syl.batchId);
  let score = 0;
  if (asgYear && sylYear && asgYear === sylYear) score += 4;
  if (asgClass && sylClass && asgClass === sylClass) score += 4;
  if (asgBatch && sylBatch && asgBatch === sylBatch) score += 2;
  if (!sylYear && !sylClass) score += 1;
  return score;
};

const pickSyllabiForAssignment = (
  syllabi: SyllabusLean[],
  asg: AssignmentLean
): SyllabusLean[] => {
  const subjectId = idStr(asg.subjectId);
  const sameSubject = syllabi.filter((s) => idStr(s.subjectId) === subjectId);
  if (sameSubject.length === 0) return [];
  let best = 0;
  const scored = sameSubject.map((s) => {
    const score = groupMatchScore(s, asg);
    if (score > best) best = score;
    return { s, score };
  });
  const matched = scored.filter((row) => row.score === best && best > 0).map((row) => row.s);
  return matched.length > 0 ? matched : sameSubject;
};

/**
 * Completion % of the official subject syllabus for the portion each teacher
 * is allotted (FULL subject, UNIT range, or PERCENTAGE share).
 */
export const loadTenderSyllabusProgress = async (opts: {
  schoolId: Types.ObjectId;
  teacherIds: Types.ObjectId[];
  academicYearBs: string;
  /** Extra subject ids from teacher tenders (may not have an assignment row). */
  tenderSubjectIdsByTeacher: Map<string, string[]>;
}): Promise<TenderSyllabusProgress> => {
  const empty: TenderSyllabusProgress = {
    percentByTeacherSubject: new Map(),
    detailByTeacherSubject: new Map(),
    assignedSubjectsByTeacher: new Map()
  };
  if (opts.teacherIds.length === 0) return empty;

  const ay = opts.academicYearBs.trim();
  const assignmentFilter: Record<string, unknown> = {
    schoolId: opts.schoolId,
    teacherId: { $in: opts.teacherIds },
    status: "ACTIVE"
  };
  if (ay) assignmentFilter.academicYearBs = ay;

  const assignments = (await SubjectAssignment.find(assignmentFilter)
    .select(
      "teacherId subjectId assignmentType unitFrom unitTo assignedPercentage handoverBaselinePercent yearId classId batchId academicYearBs"
    )
    .lean()) as AssignmentLean[];

  const assignedSubjectsByTeacher = new Map<string, string[]>();
  const subjectIdSet = new Set<string>();
  for (const asg of assignments) {
    const teacherId = idStr(asg.teacherId);
    const subjectId = idStr(asg.subjectId);
    if (!teacherId || !subjectId) continue;
    subjectIdSet.add(subjectId);
    const list = assignedSubjectsByTeacher.get(teacherId) ?? [];
    if (!list.includes(subjectId)) list.push(subjectId);
    assignedSubjectsByTeacher.set(teacherId, list);
  }
  for (const subjectIds of opts.tenderSubjectIdsByTeacher.values()) {
    for (const subjectId of subjectIds) {
      if (subjectId) subjectIdSet.add(subjectId);
    }
  }

  const subjectIds = [...subjectIdSet];
  if (subjectIds.length === 0) {
    return { ...empty, assignedSubjectsByTeacher };
  }

  const syllabusFilter: Record<string, unknown> = {
    schoolId: opts.schoolId,
    isDeleted: false,
    subjectId: { $in: subjectIds }
  };
  if (ay) syllabusFilter.academicYearBs = ay;

  const syllabi = (await AcademicSyllabus.find(syllabusFilter)
    .select("_id subjectId yearId classId batchId")
    .lean()) as SyllabusLean[];

  const leavesBySyllabus = new Map<string, Leaf[]>();
  if (syllabi.length > 0) {
    const syllabusIds = syllabi.map((s) => s._id);
    const syllabusMeta = new Map(
      syllabi.map((s) => [
        String(s._id),
        {
          subjectId: idStr(s.subjectId),
          yearId: idStr(s.yearId),
          classId: idStr(s.classId),
          batchId: idStr(s.batchId)
        }
      ])
    );

    const [topics, subUnits, legacyUnits] = await Promise.all([
      AcademicSyllabusTopic.find({ syllabusId: { $in: syllabusIds } })
        .select("_id syllabusId unitNo")
        .lean(),
      AcademicSyllabusSubUnit.find({ syllabusId: { $in: syllabusIds } })
        .select("_id syllabusId unitId parentSubUnitId status")
        .lean(),
      AcademicSyllabusUnit.find({ syllabusId: { $in: syllabusIds } })
        .select("_id syllabusId unitNo status")
        .lean()
    ]);

    const unitNoById = new Map<string, number>();
    const hierarchySyllabusIds = new Set<string>();
    for (const topic of topics) {
      unitNoById.set(String(topic._id), Number(topic.unitNo) || 0);
      hierarchySyllabusIds.add(String(topic.syllabusId));
    }
    const unitsWithSubs = new Set(subUnits.map((s) => String(s.unitId)));

    const parentIds = new Set(
      subUnits
        .map((s) => (s.parentSubUnitId ? String(s.parentSubUnitId) : ""))
        .filter(Boolean)
    );

    for (const sub of subUnits) {
      const sid = String(sub.syllabusId);
      const meta = syllabusMeta.get(sid);
      if (!meta) continue;
      const id = String(sub._id);
      if (parentIds.has(id)) continue;
      const unitNo = unitNoById.get(String(sub.unitId)) || 0;
      const list = leavesBySyllabus.get(sid) ?? [];
      list.push({
        syllabusId: sid,
        subjectId: meta.subjectId,
        yearId: meta.yearId,
        classId: meta.classId,
        batchId: meta.batchId,
        unitNo,
        leafId: id,
        completed: subUnitDone(String(sub.status || ""))
      });
      leavesBySyllabus.set(sid, list);
    }

    // Units with no sub-units still count as incomplete items on the allotted portion.
    for (const topic of topics) {
      const tid = String(topic._id);
      if (unitsWithSubs.has(tid)) continue;
      const sid = String(topic.syllabusId);
      const meta = syllabusMeta.get(sid);
      if (!meta) continue;
      const list = leavesBySyllabus.get(sid) ?? [];
      list.push({
        syllabusId: sid,
        subjectId: meta.subjectId,
        yearId: meta.yearId,
        classId: meta.classId,
        batchId: meta.batchId,
        unitNo: Number(topic.unitNo) || 0,
        leafId: `topic:${tid}`,
        completed: false
      });
      leavesBySyllabus.set(sid, list);
    }

    // Legacy flat units when this syllabus has no hierarchical topics.
    for (const unit of legacyUnits) {
      const sid = String(unit.syllabusId);
      if (hierarchySyllabusIds.has(sid)) continue;
      const meta = syllabusMeta.get(sid);
      if (!meta) continue;
      const list = leavesBySyllabus.get(sid) ?? [];
      list.push({
        syllabusId: sid,
        subjectId: meta.subjectId,
        yearId: meta.yearId,
        classId: meta.classId,
        batchId: meta.batchId,
        unitNo: Number(unit.unitNo) || 0,
        leafId: `legacy:${String(unit._id)}`,
        completed: String(unit.status || "") === "COMPLETED"
      });
      leavesBySyllabus.set(sid, list);
    }
  }

  const buckets = new Map<string, { leafIds: Set<string>; completed: number; details: Set<string> }>();
  const baselineByKey = new Map<string, number>();

  const addLeaves = (teacherId: string, subjectId: string, leaves: Leaf[], detail: string) => {
    if (!teacherId || !subjectId || leaves.length === 0) return;
    const key = `${teacherId}:${subjectId}`;
    const bucket = buckets.get(key) ?? {
      leafIds: new Set<string>(),
      completed: 0,
      details: new Set<string>()
    };
    for (const leaf of leaves) {
      const lid = `${leaf.syllabusId}:${leaf.leafId}`;
      if (bucket.leafIds.has(lid)) continue;
      bucket.leafIds.add(lid);
      if (leaf.completed) bucket.completed += 1;
    }
    if (detail) bucket.details.add(detail);
    buckets.set(key, bucket);
  };

  for (const asg of assignments) {
    const teacherId = idStr(asg.teacherId);
    const subjectId = idStr(asg.subjectId);
    const matched = pickSyllabiForAssignment(syllabi, asg);
    const detail = assignmentDetail(asg);
    const baseline = Number(asg.handoverBaselinePercent);
    if (
      Number.isFinite(baseline) &&
      baseline > 0 &&
      String(asg.assignmentType || "").toUpperCase() !== "UNIT"
    ) {
      const key = `${idStr(asg.teacherId)}:${idStr(asg.subjectId)}`;
      baselineByKey.set(key, Math.max(baselineByKey.get(key) ?? 0, baseline));
    }
    for (const syl of matched) {
      const leaves = filterLeavesForAssignment(
        leavesBySyllabus.get(String(syl._id)) ?? [],
        asg
      );
      addLeaves(teacherId, subjectId, leaves, detail);
    }
  }

  // Tender subjects with no allotment row: whole subject syllabus.
  for (const [teacherId, subjectIdsForTeacher] of opts.tenderSubjectIdsByTeacher) {
    for (const subjectId of subjectIdsForTeacher) {
      const key = `${teacherId}:${subjectId}`;
      if (buckets.has(key)) continue;
      const dummy: AssignmentLean = { subjectId, assignmentType: "FULL" };
      const matched = pickSyllabiForAssignment(syllabi, dummy);
      for (const syl of matched) {
        addLeaves(
          teacherId,
          subjectId,
          leavesBySyllabus.get(String(syl._id)) ?? [],
          "full subject"
        );
      }
    }
  }

  const percentByTeacherSubject = new Map<string, number>();
  const detailByTeacherSubject = new Map<string, string>();
  for (const [key, bucket] of buckets) {
    const total = bucket.leafIds.size;
    if (total === 0) continue;
    let pct = round2((bucket.completed / total) * 100);
    const baseline = baselineByKey.get(key) ?? 0;
    if (baseline > 0) {
      pct = round2(Math.max(0, pct - baseline));
    }
    percentByTeacherSubject.set(key, pct);
    detailByTeacherSubject.set(
      key,
      baseline > 0
        ? `${[...bucket.details].join(", ")} (continues leftover from ${baseline}%)`
        : [...bucket.details].join(", ")
    );
  }

  return {
    percentByTeacherSubject,
    detailByTeacherSubject,
    assignedSubjectsByTeacher
  };
};
