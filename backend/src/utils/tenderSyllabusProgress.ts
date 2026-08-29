import type { Types } from "mongoose";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { Subject } from "../models/Subject.js";
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

const PRACTICAL_TOKEN_RE = /\b(practical|prac\.?|lab|laboratory|प्रयोगात्मक)\b/gi;
const THEORY_TOKEN_RE = /\b(theory|theo\.?|सैद्धान्तिक)\b/gi;
const PRACTICAL_NAME_RE = /\b(practical|prac\.?|lab|laboratory|प्रयोगात्मक)\b/i;

export const subjectFamilyStem = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .replace(PRACTICAL_TOKEN_RE, " ")
    .replace(THEORY_TOKEN_RE, " ")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isPracticalSubjectName = (name: string): boolean =>
  PRACTICAL_NAME_RE.test(name.trim());

export type SubjectFamilyRow = {
  _id?: unknown;
  name?: string;
  code?: string;
  masterSubjectId?: unknown;
};

/**
 * Curriculum siblings (same master / code / name) plus theory/practical pairs
 * ("Botany" ↔ "Botany Practical").
 */
export const buildSubjectFamilyMap = (
  subjects: SubjectFamilyRow[]
): Map<string, string[]> => {
  const groups = new Map<string, Set<string>>();
  const add = (key: string, id: string) => {
    if (!key || !id) return;
    const set = groups.get(key) ?? new Set<string>();
    set.add(id);
    groups.set(key, set);
  };

  const rows = subjects
    .map((s) => ({
      id: idStr(s._id),
      name: String(s.name || "").trim(),
      code: String(s.code || "").trim().toLowerCase(),
      master: idStr(s.masterSubjectId)
    }))
    .filter((s) => s.id);

  for (const s of rows) {
    add(`id:${s.id}`, s.id);
    if (s.master) add(`master:${s.master}`, s.id);
    if (s.code) add(`code:${s.code}`, s.id);
    const name = s.name.toLowerCase().replace(/\s+/g, " ");
    if (name) add(`name:${name}`, s.id);
    const stem = subjectFamilyStem(s.name);
    if (stem) add(`stem:${stem}`, s.id);
  }

  const family = new Map<string, string[]>();
  for (const s of rows) {
    const related = new Set<string>([s.id]);
    const keys = [`id:${s.id}`];
    if (s.master) keys.push(`master:${s.master}`);
    if (s.code) keys.push(`code:${s.code}`);
    const name = s.name.toLowerCase().replace(/\s+/g, " ");
    if (name) keys.push(`name:${name}`);
    const stem = subjectFamilyStem(s.name);
    if (stem) keys.push(`stem:${stem}`);
    for (const key of keys) {
      for (const other of groups.get(key) ?? []) related.add(other);
    }
    family.set(s.id, [...related]);
  }
  return family;
};

export const lookupFamilyValue = <T>(
  map: Map<string, T>,
  teacherId: string,
  subjectId: string,
  family: Map<string, string[]>,
  isPresent?: (value: T) => boolean
): T | undefined => {
  const exactKey = `${teacherId}:${subjectId}`;
  const exact = map.get(exactKey);
  if (exact !== undefined && (!isPresent || isPresent(exact))) return exact;
  for (const sib of family.get(subjectId) ?? []) {
    if (sib === subjectId) continue;
    const val = map.get(`${teacherId}:${sib}`);
    if (val !== undefined && (!isPresent || isPresent(val))) return val;
  }
  return exact;
};

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
  practicalRequired?: boolean;
};

export type TenderSyllabusProgress = {
  /** teacherId:subjectId → allotted-portion completion 0–100 */
  percentByTeacherSubject: Map<string, number>;
  /** teacherId:subjectId → "units 1–5" / "allotted 40%" */
  detailByTeacherSubject: Map<string, string>;
  /** teacherId → allotted subject ids */
  assignedSubjectsByTeacher: Map<string, string[]>;
  /** subjectId → curriculum + theory/practical family ids */
  subjectFamilyById: Map<string, string[]>;
  /** subjectId → display name */
  subjectNameById: Map<string, string>;
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

/** Prefer practical (or theory) leaves when the subject name is a theory/practical pair. */
export const filterLeavesForSubjectKind = (
  leaves: Leaf[],
  subjectName: string,
  familyNames: string[]
): Leaf[] => {
  if (leaves.length === 0) return leaves;
  const practical = isPracticalSubjectName(subjectName);
  const familyHasPractical = familyNames.some((n) => isPracticalSubjectName(n));
  const familyHasTheory = familyNames.some((n) => n.trim() && !isPracticalSubjectName(n));
  if (practical && familyHasTheory) {
    const onlyPrac = leaves.filter((leaf) => leaf.practicalRequired);
    if (onlyPrac.length > 0) return onlyPrac;
  }
  if (!practical && familyHasPractical) {
    const onlyTheory = leaves.filter((leaf) => !leaf.practicalRequired);
    if (onlyTheory.length > 0) return onlyTheory;
  }
  return leaves;
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

const scorePickSyllabi = (pool: SyllabusLean[], asg: AssignmentLean): SyllabusLean[] => {
  if (pool.length === 0) return [];
  let best = 0;
  const scored = pool.map((s) => {
    const score = groupMatchScore(s, asg);
    if (score > best) best = score;
    return { s, score };
  });
  const matched = scored.filter((row) => row.score === best && best > 0).map((row) => row.s);
  return matched.length > 0 ? matched : pool;
};

const pickSyllabiForAssignment = (
  syllabi: SyllabusLean[],
  asg: AssignmentLean,
  familyIds: Set<string>,
  exactOnly: boolean
): SyllabusLean[] => {
  const subjectId = idStr(asg.subjectId);
  const exact = syllabi.filter((s) => idStr(s.subjectId) === subjectId);
  if (exactOnly) return scorePickSyllabi(exact, asg);
  if (exact.length > 0) return scorePickSyllabi(exact, asg);
  const family = syllabi.filter((s) => familyIds.has(idStr(s.subjectId)));
  return scorePickSyllabi(family, asg);
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
    assignedSubjectsByTeacher: new Map(),
    subjectFamilyById: new Map(),
    subjectNameById: new Map()
  };
  if (opts.teacherIds.length === 0) return empty;

  const ay = opts.academicYearBs.trim();
  const assignmentSelect =
    "teacherId subjectId assignmentType unitFrom unitTo assignedPercentage handoverBaselinePercent yearId classId batchId academicYearBs";

  const loadAssignments = async (requireAy: boolean) => {
    const assignmentFilter: Record<string, unknown> = {
      schoolId: opts.schoolId,
      teacherId: { $in: opts.teacherIds },
      status: "ACTIVE"
    };
    if (requireAy && ay) assignmentFilter.academicYearBs = ay;
    return (await SubjectAssignment.find(assignmentFilter)
      .select(assignmentSelect)
      .lean()) as AssignmentLean[];
  };

  let assignments = await loadAssignments(true);
  if (assignments.length === 0 && ay) assignments = await loadAssignments(false);

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

  const allSubjects = (await Subject.find({ schoolId: opts.schoolId })
    .select("_id name code masterSubjectId")
    .lean()) as SubjectFamilyRow[];
  const subjectFamilyById = buildSubjectFamilyMap(allSubjects);
  const subjectNameById = new Map<string, string>();
  for (const s of allSubjects) {
    const id = idStr(s._id);
    if (!id) continue;
    subjectNameById.set(id, String(s.name || "").trim());
  }
  for (const id of [...subjectIdSet]) {
    for (const sib of subjectFamilyById.get(id) ?? []) subjectIdSet.add(sib);
  }

  const subjectIds = [...subjectIdSet];
  if (subjectIds.length === 0) {
    return { ...empty, assignedSubjectsByTeacher, subjectFamilyById, subjectNameById };
  }

  const loadSyllabi = async (requireAy: boolean) => {
    const syllabusFilter: Record<string, unknown> = {
      schoolId: opts.schoolId,
      isDeleted: false,
      subjectId: { $in: subjectIds }
    };
    if (requireAy && ay) syllabusFilter.academicYearBs = ay;
    return (await AcademicSyllabus.find(syllabusFilter)
      .select("_id subjectId yearId classId batchId")
      .lean()) as SyllabusLean[];
  };

  let syllabi = await loadSyllabi(true);
  if (syllabi.length === 0 && ay) syllabi = await loadSyllabi(false);

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
        .select("_id syllabusId unitNo practicalRequired")
        .lean(),
      AcademicSyllabusSubUnit.find({ syllabusId: { $in: syllabusIds } })
        .select("_id syllabusId unitId parentSubUnitId status practicalRequired")
        .lean(),
      AcademicSyllabusUnit.find({ syllabusId: { $in: syllabusIds } })
        .select("_id syllabusId unitNo status practicalRequired")
        .lean()
    ]);

    const unitNoById = new Map<string, number>();
    const hierarchySyllabusIds = new Set<string>();
    const topicPracticalById = new Map<string, boolean>();
    for (const topic of topics) {
      unitNoById.set(String(topic._id), Number(topic.unitNo) || 0);
      hierarchySyllabusIds.add(String(topic.syllabusId));
      topicPracticalById.set(String(topic._id), Boolean(topic.practicalRequired));
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
        completed: subUnitDone(String(sub.status || "")),
        practicalRequired:
          Boolean(sub.practicalRequired) ||
          Boolean(topicPracticalById.get(String(sub.unitId)))
      });
      leavesBySyllabus.set(sid, list);
    }

    const legacyStatusBySyllabusUnitNo = new Map<string, { status: string; practical: boolean }>();
    for (const unit of legacyUnits) {
      legacyStatusBySyllabusUnitNo.set(`${String(unit.syllabusId)}:${Number(unit.unitNo) || 0}`, {
        status: String(unit.status || ""),
        practical: Boolean(unit.practicalRequired)
      });
    }

    // Topics with no sub-units: only count when a legacy unit has a real status.
    // Bare outline topics would otherwise force 0% and hide session-plan progress.
    for (const topic of topics) {
      const tid = String(topic._id);
      if (unitsWithSubs.has(tid)) continue;
      const sid = String(topic.syllabusId);
      const meta = syllabusMeta.get(sid);
      if (!meta) continue;
      const unitNo = Number(topic.unitNo) || 0;
      const legacy = legacyStatusBySyllabusUnitNo.get(`${sid}:${unitNo}`);
      if (!legacy) continue;
      const list = leavesBySyllabus.get(sid) ?? [];
      list.push({
        syllabusId: sid,
        subjectId: meta.subjectId,
        yearId: meta.yearId,
        classId: meta.classId,
        batchId: meta.batchId,
        unitNo,
        leafId: `topic:${tid}`,
        completed: legacy.status === "COMPLETED",
        practicalRequired: Boolean(topic.practicalRequired) || legacy.practical
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
        completed: String(unit.status || "") === "COMPLETED",
        practicalRequired: Boolean(unit.practicalRequired)
      });
      leavesBySyllabus.set(sid, list);
    }
  }

  const buckets = new Map<string, { leafIds: Set<string>; completed: number; details: Set<string> }>();
  const baselineByKey = new Map<string, number>();
  const assignedPctByKey = new Map<string, number | "mixed">();

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

  const leavesFor = (asg: AssignmentLean, sylId: string, subjectId: string): Leaf[] => {
    const familyIds = subjectFamilyById.get(subjectId) ?? [subjectId];
    const familyNames = familyIds.map((id) => subjectNameById.get(id) || "");
    return filterLeavesForSubjectKind(
      filterLeavesForAssignment(leavesBySyllabus.get(sylId) ?? [], asg),
      subjectNameById.get(subjectId) || "",
      familyNames
    );
  };

  const rememberAssignedPct = (key: string, asg: AssignmentLean) => {
    if (String(asg.assignmentType || "").toUpperCase() !== "PERCENTAGE") return;
    const pct = Number(asg.assignedPercentage) || 0;
    if (pct <= 0 || pct >= 100) return;
    const prev = assignedPctByKey.get(key);
    if (prev === undefined) assignedPctByKey.set(key, pct);
    else if (prev !== pct) assignedPctByKey.set(key, "mixed");
  };

  for (const asg of assignments) {
    const teacherId = idStr(asg.teacherId);
    const subjectId = idStr(asg.subjectId);
    if (!teacherId || !subjectId) continue;
    const familyIds = new Set(subjectFamilyById.get(subjectId) ?? [subjectId]);
    const detail = assignmentDetail(asg);
    const key = `${teacherId}:${subjectId}`;
    rememberAssignedPct(key, asg);
    const baseline = Number(asg.handoverBaselinePercent);
    if (
      Number.isFinite(baseline) &&
      baseline > 0 &&
      String(asg.assignmentType || "").toUpperCase() !== "UNIT"
    ) {
      baselineByKey.set(key, Math.max(baselineByKey.get(key) ?? 0, baseline));
    }
    let matched = pickSyllabiForAssignment(syllabi, asg, familyIds, true);
    for (const syl of matched) {
      addLeaves(teacherId, subjectId, leavesFor(asg, String(syl._id), subjectId), detail);
    }
    if (!buckets.has(key)) {
      matched = pickSyllabiForAssignment(syllabi, asg, familyIds, false);
      for (const syl of matched) {
        addLeaves(teacherId, subjectId, leavesFor(asg, String(syl._id), subjectId), detail);
      }
    }
  }

  // Tender subjects with no allotment row: whole subject syllabus (including family).
  for (const [teacherId, subjectIdsForTeacher] of opts.tenderSubjectIdsByTeacher) {
    for (const subjectId of subjectIdsForTeacher) {
      const key = `${teacherId}:${subjectId}`;
      if (buckets.has(key)) continue;
      const dummy: AssignmentLean = { subjectId, assignmentType: "FULL" };
      const familyIds = new Set(subjectFamilyById.get(subjectId) ?? [subjectId]);
      let matched = pickSyllabiForAssignment(syllabi, dummy, familyIds, true);
      for (const syl of matched) {
        addLeaves(teacherId, subjectId, leavesFor(dummy, String(syl._id), subjectId), "full subject");
      }
      if (!buckets.has(key)) {
        matched = pickSyllabiForAssignment(syllabi, dummy, familyIds, false);
        for (const syl of matched) {
          addLeaves(
            teacherId,
            subjectId,
            leavesFor(dummy, String(syl._id), subjectId),
            "full subject"
          );
        }
      }
    }
  }

  const percentByTeacherSubject = new Map<string, number>();
  const detailByTeacherSubject = new Map<string, string>();
  for (const [key, bucket] of buckets) {
    const total = bucket.leafIds.size;
    if (total === 0) continue;
    let pct = round2((bucket.completed / total) * 100);
    const allotted = assignedPctByKey.get(key);
    if (typeof allotted === "number" && allotted > 0 && allotted < 100) {
      pct = round2(Math.min(100, (pct / allotted) * 100));
    }
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
    assignedSubjectsByTeacher,
    subjectFamilyById,
    subjectNameById
  };
};
