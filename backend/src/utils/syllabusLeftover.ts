import type { Types } from "mongoose";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";

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

export type SyllabusLeftover = {
  hasHierarchy: boolean;
  totalUnits: number;
  completedUnits: number;
  leftoverUnits: number;
  completedPercent: number;
  leftoverPercent: number;
  leftoverFrom: number | null;
  leftoverTo: number | null;
  completedFrom: number | null;
  completedTo: number | null;
  firstIncompleteUnitNo: number | null;
  lastUnitNo: number | null;
};

const emptyLeftover = (): SyllabusLeftover => ({
  hasHierarchy: false,
  totalUnits: 0,
  completedUnits: 0,
  leftoverUnits: 0,
  completedPercent: 0,
  leftoverPercent: 100,
  leftoverFrom: null,
  leftoverTo: null,
  completedFrom: null,
  completedTo: null,
  firstIncompleteUnitNo: null,
  lastUnitNo: null
});

type UnitRow = { unitNo: number; complete: boolean };

export const computeSyllabusLeftover = async (opts: {
  schoolId: Types.ObjectId;
  academicYearBs: string;
  subjectId: string;
  yearId?: string | null;
  classId?: string | null;
  batchId?: string | null;
  assignedUnitFrom?: number | null;
  assignedUnitTo?: number | null;
}): Promise<SyllabusLeftover> => {
  const ay = String(opts.academicYearBs || "").trim();
  const filter: Record<string, unknown> = {
    schoolId: opts.schoolId,
    isDeleted: false,
    subjectId: opts.subjectId
  };
  if (ay) filter.academicYearBs = ay;

  const syllabi = await AcademicSyllabus.find(filter)
    .select("_id subjectId yearId classId batchId")
    .lean();
  if (syllabi.length === 0) return emptyLeftover();

  const score = (syl: (typeof syllabi)[0]): number => {
    let n = 0;
    if (opts.yearId && idStr(syl.yearId) === opts.yearId) n += 4;
    if (opts.classId && idStr(syl.classId) === opts.classId) n += 4;
    if (opts.batchId && idStr(syl.batchId) === opts.batchId) n += 2;
    if (!syl.yearId && !syl.classId) n += 1;
    return n;
  };
  let best = 0;
  for (const s of syllabi) best = Math.max(best, score(s));
  const matched =
    best > 0 ? syllabi.filter((s) => score(s) === best) : syllabi;
  const syllabusIds = matched.map((s) => s._id);

  const [topics, subUnits, legacyUnits] = await Promise.all([
    AcademicSyllabusTopic.find({ syllabusId: { $in: syllabusIds } })
      .select("_id syllabusId unitNo")
      .lean(),
    AcademicSyllabusSubUnit.find({ syllabusId: { $in: syllabusIds } })
      .select("unitId parentSubUnitId status")
      .lean(),
    AcademicSyllabusUnit.find({ syllabusId: { $in: syllabusIds } })
      .select("unitNo status")
      .lean()
  ]);

  const parentIds = new Set(
    subUnits
      .map((s) => (s.parentSubUnitId ? String(s.parentSubUnitId) : ""))
      .filter(Boolean)
  );
  const leavesByUnit = new Map<string, { total: number; done: number }>();
  for (const sub of subUnits) {
    const id = String((sub as { _id?: unknown })._id ?? "");
    if (id && parentIds.has(id)) continue;
    const uid = String(sub.unitId);
    const bucket = leavesByUnit.get(uid) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (subUnitDone(String(sub.status || ""))) bucket.done += 1;
    leavesByUnit.set(uid, bucket);
  }

  const unitMap = new Map<number, { total: number; done: number }>();
  if (topics.length > 0) {
    for (const topic of topics) {
      const no = Number(topic.unitNo) || 0;
      if (no < 1) continue;
      const stats = leavesByUnit.get(String(topic._id)) ?? { total: 0, done: 0 };
      const cur = unitMap.get(no) ?? { total: 0, done: 0 };
      if (stats.total > 0) {
        cur.total += stats.total;
        cur.done += stats.done;
      } else {
        cur.total += 1;
      }
      unitMap.set(no, cur);
    }
  } else {
    for (const unit of legacyUnits) {
      const no = Number(unit.unitNo) || 0;
      if (no < 1) continue;
      const cur = unitMap.get(no) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (String(unit.status || "") === "COMPLETED") cur.done += 1;
      unitMap.set(no, cur);
    }
  }

  let units: UnitRow[] = [...unitMap.entries()]
    .map(([unitNo, stats]) => ({
      unitNo,
      complete: stats.total > 0 && stats.done >= stats.total
    }))
    .sort((a, b) => a.unitNo - b.unitNo);

  const from = Number(opts.assignedUnitFrom) || 0;
  const to = Number(opts.assignedUnitTo) || 0;
  if (from >= 1 && to >= from) {
    units = units.filter((u) => u.unitNo >= from && u.unitNo <= to);
  }

  if (units.length === 0) return emptyLeftover();

  const completedUnits = units.filter((u) => u.complete);
  const leftoverUnits = units.filter((u) => !u.complete);
  const firstIncomplete = leftoverUnits[0] ?? null;
  const last = units[units.length - 1]!;
  const first = units[0]!;
  const lastComplete = [...completedUnits].pop() ?? null;

  const leftoverFrom = firstIncomplete?.unitNo ?? null;
  const leftoverTo = leftoverUnits.length > 0 ? last.unitNo : null;
  const completedFrom = completedUnits.length > 0 ? first.unitNo : null;
  const completedTo =
    leftoverFrom != null && leftoverFrom > first.unitNo
      ? leftoverFrom - 1
      : lastComplete?.unitNo ?? null;

  const completedPercent = Math.round((completedUnits.length / units.length) * 100);

  return {
    hasHierarchy: true,
    totalUnits: units.length,
    completedUnits: completedUnits.length,
    leftoverUnits: leftoverUnits.length,
    completedPercent,
    leftoverPercent: Math.max(0, 100 - completedPercent),
    leftoverFrom,
    leftoverTo,
    completedFrom,
    completedTo: completedUnits.length > 0 ? completedTo : null,
    firstIncompleteUnitNo: firstIncomplete?.unitNo ?? null,
    lastUnitNo: last.unitNo
  };
};
