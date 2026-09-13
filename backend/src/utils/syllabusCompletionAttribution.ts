import mongoose, { type Types } from "mongoose";
import type { SyllabusCompletionSource } from "@phit-erp/shared";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";

export const isAdministrationCompletion = (
  source?: string | null,
  countsTowardSalary?: boolean | null
): boolean =>
  String(source || "").toUpperCase() === "ADMINISTRATION" || countsTowardSalary === false;

/**
 * A completed syllabus leaf counts toward this teacher's tender/salary only when
 * it was attributed to them (or legacy unmarked completions). Administration
 * extra lectures stay on the official syllabus but never on that teacher's pay.
 */
export const leafCountsTowardTeacherSalary = (
  leaf: {
    completed: boolean;
    completionSource?: string | null;
    countsTowardSalary?: boolean | null;
    completedByTeacherId?: string | null;
  },
  teacherId: string
): boolean => {
  if (!leaf.completed) return false;
  if (leaf.countsTowardSalary === false) return false;
  if (String(leaf.completionSource || "").toUpperCase() === "ADMINISTRATION") return false;
  const by = String(leaf.completedByTeacherId || "").trim();
  if (by && teacherId && by !== teacherId) return false;
  return true;
};

export const clearSubUnitAttributionSet = (): Record<string, unknown> => ({
  completionNote: "",
  deliveredByName: "",
  countsTowardSalary: true
});

export const clearSubUnitAttributionUnset = (): Record<string, 1> => ({
  completionSource: 1,
  completedByTeacherId: 1,
  completedByUserId: 1,
  completedAt: 1
});

type MarkParams = {
  schoolId: Types.ObjectId | string;
  subUnitIds: string[];
  source: SyllabusCompletionSource;
  teacherId?: string;
  userId: string;
  note?: string;
  deliveredByName?: string;
  todaysCoverage?: string;
  /** BS date the topic was actually taught (not when the record was saved). */
  taughtDateBs?: string;
  /** Admin oversight overwrites prior attribution. Teacher log book does not steal admin leaves. */
  overwriteAttribution?: boolean;
};

const validIds = (ids: string[]): Types.ObjectId[] =>
  ids
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

/**
 * Mark syllabus leaves complete and stamp who taught them.
 * Teacher log-book writes skip leaves already completed by administration.
 */
export const markSubUnitsCompleted = async (params: MarkParams): Promise<string[]> => {
  const ids = validIds(params.subUnitIds);
  if (ids.length === 0) return [];

  const schoolId = new mongoose.Types.ObjectId(String(params.schoolId));
  const countsTowardSalary = params.source === "TEACHER";
  const teacherOid =
    params.teacherId && mongoose.Types.ObjectId.isValid(params.teacherId)
      ? new mongoose.Types.ObjectId(params.teacherId)
      : undefined;
  const userOid = mongoose.Types.ObjectId.isValid(params.userId)
    ? new mongoose.Types.ObjectId(params.userId)
    : undefined;

  const attribution = {
    status: "COMPLETED" as const,
    todaysCoverage: params.todaysCoverage || "",
    completionSource: params.source,
    completedByTeacherId: countsTowardSalary ? teacherOid : undefined,
    completedByUserId: userOid,
    completedAt: new Date(),
    taughtDateBs: (params.taughtDateBs || "").trim(),
    completionNote: (params.note || "").trim(),
    countsTowardSalary,
    deliveredByName: (params.deliveredByName || "").trim()
  };

  const baseFilter: Record<string, unknown> = {
    _id: { $in: ids },
    schoolId
  };

  if (params.overwriteAttribution) {
    await AcademicSyllabusSubUnit.updateMany(baseFilter, { $set: attribution });
  } else {
    await AcademicSyllabusSubUnit.updateMany(
      {
        ...baseFilter,
        completionSource: "ADMINISTRATION"
      },
      {
        $set: {
          status: "COMPLETED",
          todaysCoverage: params.todaysCoverage || "",
          ...(params.taughtDateBs ? { taughtDateBs: params.taughtDateBs.trim() } : {})
        }
      }
    );
    await AcademicSyllabusSubUnit.updateMany(
      {
        ...baseFilter,
        completionSource: { $ne: "ADMINISTRATION" }
      },
      { $set: attribution }
    );
  }

  const marked = await AcademicSyllabusSubUnit.find({
    _id: { $in: ids },
    schoolId
  })
    .select("_id unitId")
    .lean();

  const unitIds = [
    ...new Set(marked.map((row) => (row.unitId ? String(row.unitId) : "")).filter(Boolean))
  ];
  for (const unitId of unitIds) {
    await syncLegacyUnitStatusForTopic(schoolId, unitId);
  }
  return marked.map((row) => String(row._id));
};

const syncLegacyUnitStatusForTopic = async (
  schoolId: Types.ObjectId,
  topicId: string
): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(topicId)) return;
  const topic = await AcademicSyllabusTopic.findById(topicId).select("syllabusId unitNo").lean();
  if (!topic) return;
  const unitSubs = await AcademicSyllabusSubUnit.find({
    schoolId,
    unitId: topic._id
  })
    .select("status parentSubUnitId")
    .lean();
  const parentIds = new Set(
    unitSubs
      .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
      .filter(Boolean)
  );
  const leaves = unitSubs.filter((row) => !parentIds.has(String(row._id)));
  const pool = leaves.length > 0 ? leaves : unitSubs;
  const allDone =
    pool.length > 0 &&
    pool.every((row) => row.status === "COMPLETED" || row.status === "SKIPPED");
  const anyProgress = pool.some(
    (row) =>
      row.status === "IN_PROGRESS" || row.status === "COMPLETED" || row.status === "SKIPPED"
  );
  const legacyStatus = allDone ? "COMPLETED" : anyProgress ? "IN_PROGRESS" : "PENDING";
  await AcademicSyllabusUnit.updateOne(
    { syllabusId: topic.syllabusId, unitNo: topic.unitNo },
    { $set: { status: legacyStatus } }
  );
};

export type AttributionSnapshot = {
  completionSource?: string | null;
  completedByTeacherId?: unknown;
  completedByUserId?: unknown;
  completedAt?: Date | null;
  taughtDateBs?: string;
  completionNote?: string;
  countsTowardSalary?: boolean;
  deliveredByName?: string;
};

export const snapshotSubUnitAttribution = (
  rows: Array<{ _id?: unknown } & AttributionSnapshot>
): Map<string, AttributionSnapshot> => {
  const map = new Map<string, AttributionSnapshot>();
  for (const row of rows) {
    const id = row._id != null ? String(row._id) : "";
    if (!id) continue;
    if (
      !row.completionSource &&
      !row.completedByTeacherId &&
      row.countsTowardSalary !== false &&
      !row.deliveredByName &&
      !row.taughtDateBs
    ) {
      continue;
    }
    map.set(id, {
      completionSource: row.completionSource ?? null,
      completedByTeacherId: row.completedByTeacherId ?? null,
      completedByUserId: row.completedByUserId ?? null,
      completedAt: row.completedAt ?? null,
      taughtDateBs: row.taughtDateBs || "",
      completionNote: row.completionNote || "",
      countsTowardSalary: row.countsTowardSalary !== false,
      deliveredByName: row.deliveredByName || ""
    });
  }
  return map;
};
