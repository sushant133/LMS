import type { ClientSession, Types } from "mongoose";
import mongoose from "mongoose";
import type {
  ScopeMode,
  SubjectAssignmentType,
  SubjectAssignmentCreateInput,
  SubjectAssignmentBulkInput,
  SubjectAssignmentUpdateInput,
  SubjectAssignmentEndInput,
  SubjectAssignmentReassignInput,
  SubjectAssignmentCopyYearInput
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Subject } from "../models/Subject.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { ensureValidBsDate, getTodayBs } from "./nepaliDate.js";
import { getSessionOption, withTransaction } from "./transaction.js";
import type { Request } from "express";

type ObjectId = Types.ObjectId;

export interface GroupKeys {
  classId?: string | null;
  sectionId?: string | null;
  batchId?: string | null;
  yearId?: string | null;
}

export interface DraftAssignmentRow {
  _id?: string;
  teacherId: string;
  subjectId: string;
  assignmentType: SubjectAssignmentType;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
  classId?: string | null;
  sectionId?: string | null;
  batchId?: string | null;
  yearId?: string | null;
}

const toObjectId = (value: string | ObjectId | null | undefined): ObjectId | null => {
  if (value == null || value === "") return null;
  return typeof value === "string" ? new mongoose.Types.ObjectId(value) : value;
};

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

export const getAcademicYearBs = async (schoolId: ObjectId | string): Promise<string> => {
  const setting = await Setting.findOne({ schoolId }).select("academicYearBs").lean();
  if (!setting?.academicYearBs) {
    throw new ApiError(400, "Academic year is not configured in Settings");
  }
  return setting.academicYearBs;
};

export const getScopeMode = async (schoolId: ObjectId | string): Promise<ScopeMode> => {
  const setting = await Setting.findOne({ schoolId }).select("subjectAssignmentScopeMode").lean();
  const override = setting?.subjectAssignmentScopeMode as ScopeMode | undefined | null;
  if (override === "legacy" || override === "dual" || override === "assignment") {
    return override;
  }
  return env.SUBJECT_ASSIGNMENT_SCOPE_DEFAULT ?? "legacy";
};

export const isTimetableAssignmentLinkRequired = async (schoolId: ObjectId | string): Promise<boolean> => {
  const setting = await Setting.findOne({ schoolId }).select("subjectAssignmentTimetableRequired").lean();
  if (typeof setting?.subjectAssignmentTimetableRequired === "boolean") {
    return setting.subjectAssignmentTimetableRequired;
  }
  return env.SUBJECT_ASSIGNMENT_TIMETABLE_REQUIRE_LINK;
};

const normalizeGroupKeys = (group: GroupKeys, college: boolean): GroupKeys => {
  if (college) {
    return {
      classId: null,
      sectionId: null,
      batchId: group.batchId ?? null,
      yearId: group.yearId ?? null
    };
  }
  return {
    classId: group.classId ?? null,
    sectionId: group.sectionId ?? null,
    batchId: null,
    yearId: null
  };
};

const groupFilter = (group: GroupKeys, college: boolean): Record<string, unknown> => {
  const normalized = normalizeGroupKeys(group, college);
  if (college) {
    return {
      batchId: toObjectId(normalized.batchId),
      yearId: toObjectId(normalized.yearId),
      classId: null,
      sectionId: null
    };
  }
  return {
    classId: toObjectId(normalized.classId),
    sectionId: toObjectId(normalized.sectionId),
    batchId: null,
    yearId: null
  };
};

export const validateMergedActiveSet = (
  merged: DraftAssignmentRow[],
  opts: { maxUnit: number; allowExceedMaxUnit: boolean }
): string[] => {
  if (merged.length === 0) {
    return [];
  }

  const teacherIds = merged.map((r) => r.teacherId);
  if (new Set(teacherIds).size !== teacherIds.length) {
    throw new ApiError(400, "Duplicate teacher in assignment set");
  }

  const types = new Set(merged.map((r) => r.assignmentType));

  if (types.has("FULL")) {
    if (merged.length !== 1 || merged[0]!.assignmentType !== "FULL") {
      throw new ApiError(400, "FULL assignment must be the only active row for this subject and group");
    }
    return [];
  }

  if (types.has("UNIT") && types.has("PERCENTAGE")) {
    throw new ApiError(400, "Cannot mix UNIT and PERCENTAGE assignments");
  }

  if (types.has("UNIT")) {
    const ranges = merged
      .map((r) => ({ from: r.unitFrom!, to: r.unitTo!, teacherId: r.teacherId }))
      .sort((a, b) => a.from - b.from);
    for (const r of ranges) {
      if (r.from == null || r.to == null) {
        throw new ApiError(400, "unitFrom and unitTo are required for UNIT assignments");
      }
      if (r.from > r.to) throw new ApiError(400, "unitFrom must be ≤ unitTo");
      if (r.to > opts.maxUnit && !opts.allowExceedMaxUnit) {
        throw new ApiError(
          400,
          `unitTo exceeds maximum ${opts.maxUnit} (session plan max or default 50); provide remarks to override as admin`
        );
      }
    }
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i]!.from <= ranges[i - 1]!.to) {
        throw new ApiError(400, "Unit ranges overlap");
      }
    }
  }

  const warnings: string[] = [];
  if (types.has("PERCENTAGE")) {
    for (const r of merged) {
      if (r.assignedPercentage === 100) {
        throw new ApiError(400, "Use assignmentType FULL instead of 100%");
      }
      if (!r.assignedPercentage || r.assignedPercentage < 1 || r.assignedPercentage > 99) {
        throw new ApiError(400, "assignedPercentage must be 1–99");
      }
    }
    const sum = merged.reduce((s, r) => s + (r.assignedPercentage ?? 0), 0);
    if (sum > 100) throw new ApiError(400, "Assigned percentage exceeds 100%");
    if (sum < 100) {
      warnings.push(`Percentage coverage is ${sum}% (timetable slots blocked until total is 100%)`);
    }
  }

  return warnings;
};

const resolveMaxUnit = async (
  schoolId: ObjectId,
  academicYearBs: string,
  subjectId: string,
  group: GroupKeys,
  college: boolean
): Promise<number> => {
  const planFilter: Record<string, unknown> = {
    schoolId,
    academicYearBs,
    subjectId,
    isDeleted: { $ne: true }
  };
  if (college) {
    planFilter.batchId = group.batchId;
    planFilter.yearId = group.yearId;
  } else {
    planFilter.classId = group.classId;
    planFilter.sectionId = group.sectionId;
  }

  const plans = await AcademicSessionPlan.find(planFilter).select("_id").lean();
  if (!plans.length) {
    return 50;
  }

  const units = await AcademicSessionPlanUnit.find({
    schoolId,
    sessionPlanId: { $in: plans.map((p) => p._id) }
  })
    .select("unitNo")
    .lean();

  if (!units.length) {
    return 50;
  }

  return Math.max(...units.map((u) => u.unitNo ?? 0), 1);
};

const assertMembership = async (
  schoolId: ObjectId,
  subjectId: string,
  group: GroupKeys,
  college: boolean
): Promise<void> => {
  const subject = await Subject.findOne({ _id: subjectId, schoolId }).lean();
  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  if (college) {
    if (!group.batchId || !group.yearId) {
      throw new ApiError(400, "Batch and year are required for college assignments");
    }
    if (group.classId || group.sectionId) {
      throw new ApiError(400, "Class and section are not used for college institutions");
    }
    const year = await Year.findOne({ _id: group.yearId, schoolId, batchId: group.batchId }).lean();
    if (!year) {
      throw new ApiError(400, "Year was not found in this batch");
    }
    const yearIds = (subject.yearIds ?? []).map((id) => id.toString());
    if (!yearIds.includes(group.yearId)) {
      throw new ApiError(400, "Subject is not provisioned for this year");
    }
    return;
  }

  if (!group.classId || !group.sectionId) {
    throw new ApiError(400, "Class and section are required for school assignments");
  }
  if (group.batchId || group.yearId) {
    throw new ApiError(400, "Batch and year are not used for class & section programs");
  }
  const section = await Section.findOne({ _id: group.sectionId, schoolId, classId: group.classId }).lean();
  if (!section) {
    throw new ApiError(400, "Section was not found in this class");
  }
  const classIds = (subject.classIds ?? []).map((id) => id.toString());
  if (!classIds.includes(group.classId)) {
    throw new ApiError(400, "Subject is not assigned to this class");
  }
};

const assertTeacherExists = async (schoolId: ObjectId, teacherId: string): Promise<void> => {
  const teacher = await Teacher.findOne({ _id: teacherId, schoolId }).lean();
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
};

const serializeAssignment = (doc: Record<string, unknown> | null | undefined) => {
  if (!doc) return null;
  return {
    ...doc,
    _id: idStr(doc._id),
    schoolId: idStr(doc.schoolId),
    subjectId: doc.subjectId,
    teacherId: doc.teacherId,
    classId: doc.classId ? idStr(doc.classId) : null,
    sectionId: doc.sectionId ? idStr(doc.sectionId) : null,
    batchId: doc.batchId ? idStr(doc.batchId) : null,
    yearId: doc.yearId ? idStr(doc.yearId) : null
  };
};

const addTeacherToSubjectCache = async (
  schoolId: ObjectId,
  subjectId: string | ObjectId,
  teacherId: string | ObjectId,
  session: ClientSession | null
): Promise<void> => {
  await Subject.updateOne(
    { _id: subjectId, schoolId },
    { $addToSet: { teacherIds: teacherId } },
    getSessionOption(session)
  );
};

const pullTeacherFromSubjectCacheIfUnused = async (
  schoolId: ObjectId,
  subjectId: string | ObjectId,
  teacherId: string | ObjectId,
  session: ClientSession | null
): Promise<void> => {
  const remaining = await SubjectAssignment.countDocuments({
    schoolId,
    subjectId,
    teacherId,
    status: "ACTIVE"
  }).session(session);
  if (remaining === 0) {
    await Subject.updateOne(
      { _id: subjectId, schoolId },
      { $pull: { teacherIds: teacherId } },
      getSessionOption(session)
    );
  }
};

const loadActiveSet = async (
  schoolId: ObjectId,
  academicYearBs: string,
  subjectId: string,
  group: GroupKeys,
  college: boolean,
  session: ClientSession | null
) => {
  return SubjectAssignment.find({
    schoolId,
    academicYearBs,
    subjectId,
    status: "ACTIVE",
    ...groupFilter(group, college)
  }).session(session);
};

const toDraft = (row: {
  _id?: { toString(): string };
  teacherId: { toString(): string };
  subjectId: { toString(): string };
  assignmentType: SubjectAssignmentType;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
  classId?: { toString(): string } | null;
  sectionId?: { toString(): string } | null;
  batchId?: { toString(): string } | null;
  yearId?: { toString(): string } | null;
}): DraftAssignmentRow => ({
  _id: row._id?.toString(),
  teacherId: row.teacherId.toString(),
  subjectId: row.subjectId.toString(),
  assignmentType: row.assignmentType,
  unitFrom: row.unitFrom ?? null,
  unitTo: row.unitTo ?? null,
  assignedPercentage: row.assignedPercentage ?? null,
  classId: row.classId?.toString() ?? null,
  sectionId: row.sectionId?.toString() ?? null,
  batchId: row.batchId?.toString() ?? null,
  yearId: row.yearId?.toString() ?? null
});

export const createSubjectAssignment = async (
  req: Request,
  payload: SubjectAssignmentCreateInput
): Promise<{ row: Record<string, unknown>; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  ensureValidBsDate(payload.effectiveFromBs);
  if (payload.effectiveToBs) ensureValidBsDate(payload.effectiveToBs);

  const group = normalizeGroupKeys(payload, college);
  await assertMembership(schoolId, payload.subjectId, group, college);
  await assertTeacherExists(schoolId, payload.teacherId);

  const maxUnit = await resolveMaxUnit(schoolId, payload.academicYearBs, payload.subjectId, group, college);
  const allowExceed = Boolean(payload.remarks?.trim());

  return withTransaction(async (session) => {
    const existing = await loadActiveSet(schoolId, payload.academicYearBs, payload.subjectId, group, college, session);
    const merged: DraftAssignmentRow[] = [
      ...existing.map(toDraft),
      {
        teacherId: payload.teacherId,
        subjectId: payload.subjectId,
        assignmentType: payload.assignmentType,
        unitFrom: payload.unitFrom ?? null,
        unitTo: payload.unitTo ?? null,
        assignedPercentage: payload.assignedPercentage ?? null,
        ...group
      }
    ];
    const warnings = validateMergedActiveSet(merged, { maxUnit, allowExceedMaxUnit: allowExceed });

    const [created] = await SubjectAssignment.create(
      [
        {
          schoolId,
          academicYearBs: payload.academicYearBs,
          faculty: payload.faculty ?? null,
          semesterBs: payload.semesterBs ?? null,
          ...groupFilter(group, college),
          subjectId: payload.subjectId,
          teacherId: payload.teacherId,
          assignmentType: payload.assignmentType,
          unitFrom: payload.assignmentType === "UNIT" ? payload.unitFrom : null,
          unitTo: payload.assignmentType === "UNIT" ? payload.unitTo : null,
          assignedPercentage: payload.assignmentType === "PERCENTAGE" ? payload.assignedPercentage : null,
          effectiveFromBs: payload.effectiveFromBs,
          effectiveToBs: payload.effectiveToBs ?? null,
          status: "ACTIVE",
          remarks: payload.remarks ?? "",
          createdBy: userId
        }
      ],
      getSessionOption(session)
    );

    await addTeacherToSubjectCache(schoolId, payload.subjectId, payload.teacherId, session);

    const populated = await SubjectAssignment.findById(created!._id)
      .populate("subjectId", "name code")
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
      .session(session)
      .lean();

    return { row: serializeAssignment(populated as Record<string, unknown>)!, warnings };
  });
};

export const bulkCreateSubjectAssignments = async (
  req: Request,
  payload: SubjectAssignmentBulkInput
): Promise<{ rows: Record<string, unknown>[]; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  ensureValidBsDate(payload.effectiveFromBs);
  const group = normalizeGroupKeys(payload, college);
  await assertMembership(schoolId, payload.subjectId, group, college);

  for (const row of payload.teachers) {
    await assertTeacherExists(schoolId, row.teacherId);
  }

  const maxUnit = await resolveMaxUnit(schoolId, payload.academicYearBs, payload.subjectId, group, college);
  const allowExceed = payload.teachers.some((t) => Boolean(t.remarks?.trim()));

  return withTransaction(async (session) => {
    const existing = await loadActiveSet(schoolId, payload.academicYearBs, payload.subjectId, group, college, session);
    const proposed: DraftAssignmentRow[] = payload.teachers.map((t) => ({
      teacherId: t.teacherId,
      subjectId: payload.subjectId,
      assignmentType: t.assignmentType,
      unitFrom: t.unitFrom ?? null,
      unitTo: t.unitTo ?? null,
      assignedPercentage: t.assignedPercentage ?? null,
      ...group
    }));

    // Replace existing set for same teachers if re-posting; merge with other teachers
    const proposedTeacherIds = new Set(proposed.map((p) => p.teacherId));
    const kept = existing.map(toDraft).filter((r) => !proposedTeacherIds.has(r.teacherId));
    const merged = [...kept, ...proposed];
    const warnings = validateMergedActiveSet(merged, { maxUnit, allowExceedMaxUnit: allowExceed });

    // End superseded rows for teachers being replaced in this bulk
    if (proposedTeacherIds.size) {
      await SubjectAssignment.updateMany(
        {
          schoolId,
          academicYearBs: payload.academicYearBs,
          subjectId: payload.subjectId,
          status: "ACTIVE",
          teacherId: { $in: [...proposedTeacherIds] },
          ...groupFilter(group, college)
        },
        {
          $set: {
            status: "SUPERSEDED",
            effectiveToBs: payload.effectiveFromBs,
            endedBy: userId,
            endReason: "Replaced by bulk create",
            updatedBy: userId
          }
        },
        getSessionOption(session)
      );
    }

    const docs = payload.teachers.map((t) => ({
      schoolId,
      academicYearBs: payload.academicYearBs,
      faculty: payload.faculty ?? null,
      semesterBs: payload.semesterBs ?? null,
      ...groupFilter(group, college),
      subjectId: payload.subjectId,
      teacherId: t.teacherId,
      assignmentType: t.assignmentType,
      unitFrom: t.assignmentType === "UNIT" ? t.unitFrom : null,
      unitTo: t.assignmentType === "UNIT" ? t.unitTo : null,
      assignedPercentage: t.assignmentType === "PERCENTAGE" ? t.assignedPercentage : null,
      effectiveFromBs: payload.effectiveFromBs,
      status: "ACTIVE" as const,
      remarks: t.remarks ?? "",
      createdBy: userId
    }));

    const created = await SubjectAssignment.insertMany(docs, { ...getSessionOption(session), ordered: true });

    for (const t of payload.teachers) {
      await addTeacherToSubjectCache(schoolId, payload.subjectId, t.teacherId, session);
    }

    const ids = created.map((c) => c._id);
    const rows = await SubjectAssignment.find({ _id: { $in: ids } })
      .populate("subjectId", "name code")
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
      .session(session)
      .lean();

    return {
      rows: rows.map((r) => serializeAssignment(r as Record<string, unknown>)!),
      warnings
    };
  });
};

export const updateSubjectAssignment = async (
  req: Request,
  id: string,
  payload: SubjectAssignmentUpdateInput
): Promise<{ row: Record<string, unknown>; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);

  return withTransaction(async (session) => {
    const existing = await SubjectAssignment.findOne({ _id: id, schoolId, status: "ACTIVE" }).session(session);
    if (!existing) {
      throw new ApiError(404, "Active assignment not found");
    }

    const institutionType = await getInstitutionType(req);
    const college = isCollege(institutionType);
    const group: GroupKeys = {
      classId: existing.classId?.toString() ?? null,
      sectionId: existing.sectionId?.toString() ?? null,
      batchId: existing.batchId?.toString() ?? null,
      yearId: existing.yearId?.toString() ?? null
    };

    const nextType = payload.assignmentType ?? existing.assignmentType;
    const draft: DraftAssignmentRow = {
      _id: existing._id.toString(),
      teacherId: existing.teacherId.toString(),
      subjectId: existing.subjectId.toString(),
      assignmentType: nextType,
      unitFrom: payload.unitFrom !== undefined ? payload.unitFrom : existing.unitFrom,
      unitTo: payload.unitTo !== undefined ? payload.unitTo : existing.unitTo,
      assignedPercentage:
        payload.assignedPercentage !== undefined ? payload.assignedPercentage : existing.assignedPercentage,
      ...group
    };

    if (nextType !== "UNIT") {
      draft.unitFrom = null;
      draft.unitTo = null;
    }
    if (nextType !== "PERCENTAGE") {
      draft.assignedPercentage = null;
    }

    const siblings = await loadActiveSet(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college,
      session
    );
    const merged = siblings.map(toDraft).map((r) => (r._id === draft._id ? draft : r));
    const maxUnit = await resolveMaxUnit(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college
    );
    const remarks = payload.remarks !== undefined ? payload.remarks : existing.remarks;
    const warnings = validateMergedActiveSet(merged, {
      maxUnit,
      allowExceedMaxUnit: Boolean(remarks?.trim())
    });

    if (payload.faculty !== undefined) existing.set("faculty", payload.faculty);
    if (payload.semesterBs !== undefined) existing.set("semesterBs", payload.semesterBs);
    if (payload.assignmentType) existing.assignmentType = payload.assignmentType;
    if (payload.effectiveFromBs) {
      ensureValidBsDate(payload.effectiveFromBs);
      existing.effectiveFromBs = payload.effectiveFromBs;
    }
    if (payload.remarks !== undefined) existing.remarks = payload.remarks;
    existing.set("unitFrom", draft.unitFrom ?? null);
    existing.set("unitTo", draft.unitTo ?? null);
    existing.set("assignedPercentage", draft.assignedPercentage ?? null);
    existing.updatedBy = userId;
    await existing.save({ ...getSessionOption(session) });

    const populated = await SubjectAssignment.findById(existing._id)
      .populate("subjectId", "name code")
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
      .session(session)
      .lean();

    return { row: serializeAssignment(populated as Record<string, unknown>)!, warnings };
  });
};

export const endSubjectAssignment = async (
  req: Request,
  id: string,
  payload: SubjectAssignmentEndInput
): Promise<{ row: Record<string, unknown>; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);
  ensureValidBsDate(payload.effectiveToBs);

  return withTransaction(async (session) => {
    const existing = await SubjectAssignment.findOne({ _id: id, schoolId, status: "ACTIVE" }).session(session);
    if (!existing) {
      throw new ApiError(404, "Active assignment not found");
    }

    const institutionType = await getInstitutionType(req);
    const college = isCollege(institutionType);
    const group: GroupKeys = {
      classId: existing.classId?.toString() ?? null,
      sectionId: existing.sectionId?.toString() ?? null,
      batchId: existing.batchId?.toString() ?? null,
      yearId: existing.yearId?.toString() ?? null
    };

    const siblings = await loadActiveSet(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college,
      session
    );
    const merged = siblings.map(toDraft).filter((r) => r._id !== existing._id.toString());
    const maxUnit = await resolveMaxUnit(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college
    );
    const warnings = validateMergedActiveSet(merged, { maxUnit, allowExceedMaxUnit: true });

    existing.status = "ENDED";
    existing.effectiveToBs = payload.effectiveToBs;
    existing.endedBy = userId;
    existing.endReason = payload.endReason || "Ended by admin";
    existing.updatedBy = userId;
    await existing.save({ ...getSessionOption(session) });

    await pullTeacherFromSubjectCacheIfUnused(schoolId, existing.subjectId, existing.teacherId, session);

    const populated = await SubjectAssignment.findById(existing._id)
      .populate("subjectId", "name code")
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
      .session(session)
      .lean();

    return { row: serializeAssignment(populated as Record<string, unknown>)!, warnings };
  });
};

/**
 * Permanently remove a subject assignment row.
 * ACTIVE rows re-validate remaining coverage and refresh Subject.teacherIds cache.
 * ENDED/SUPERSEDED rows are removed for cleanup only.
 */
export const deleteSubjectAssignment = async (
  req: Request,
  id: string
): Promise<{ row: Record<string, unknown>; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));

  return withTransaction(async (session) => {
    const existing = await SubjectAssignment.findOne({ _id: id, schoolId }).session(session);
    if (!existing) {
      throw new ApiError(404, "Subject assignment not found");
    }

    const warnings: string[] = [];
    const wasActive = existing.status === "ACTIVE";
    const subjectId = existing.subjectId;
    const teacherId = existing.teacherId;

    if (wasActive) {
      const institutionType = await getInstitutionType(req);
      const college = isCollege(institutionType);
      const group: GroupKeys = {
        classId: existing.classId?.toString() ?? null,
        sectionId: existing.sectionId?.toString() ?? null,
        batchId: existing.batchId?.toString() ?? null,
        yearId: existing.yearId?.toString() ?? null
      };

      const siblings = await loadActiveSet(
        schoolId,
        existing.academicYearBs,
        existing.subjectId.toString(),
        group,
        college,
        session
      );
      const merged = siblings.map(toDraft).filter((r) => r._id !== existing._id.toString());
      const maxUnit = await resolveMaxUnit(
        schoolId,
        existing.academicYearBs,
        existing.subjectId.toString(),
        group,
        college
      );
      warnings.push(...validateMergedActiveSet(merged, { maxUnit, allowExceedMaxUnit: true }));
    }

    // Clear audit links pointing at this row
    await SubjectAssignment.updateMany(
      { schoolId, supersedesAssignmentId: existing._id },
      { $set: { supersedesAssignmentId: null } },
      getSessionOption(session)
    );
    await SubjectAssignment.updateMany(
      { schoolId, supersededByAssignmentId: existing._id },
      { $set: { supersededByAssignmentId: null } },
      getSessionOption(session)
    );

    const snapshot = serializeAssignment(existing.toObject() as Record<string, unknown>)!;
    await existing.deleteOne(getSessionOption(session));

    if (wasActive) {
      await pullTeacherFromSubjectCacheIfUnused(schoolId, subjectId, teacherId, session);
    }

    return { row: snapshot, warnings };
  });
};

export const reassignSubjectAssignment = async (
  req: Request,
  id: string,
  payload: SubjectAssignmentReassignInput
): Promise<{ row: Record<string, unknown>; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);
  ensureValidBsDate(payload.effectiveFromBs);
  await assertTeacherExists(schoolId, payload.teacherId);

  return withTransaction(async (session) => {
    const existing = await SubjectAssignment.findOne({ _id: id, schoolId, status: "ACTIVE" }).session(session);
    if (!existing) {
      throw new ApiError(404, "Active assignment not found");
    }

    const institutionType = await getInstitutionType(req);
    const college = isCollege(institutionType);
    const group: GroupKeys = {
      classId: existing.classId?.toString() ?? null,
      sectionId: existing.sectionId?.toString() ?? null,
      batchId: existing.batchId?.toString() ?? null,
      yearId: existing.yearId?.toString() ?? null
    };

    const nextType = payload.assignmentType ?? existing.assignmentType;
    const draft: DraftAssignmentRow = {
      teacherId: payload.teacherId,
      subjectId: existing.subjectId.toString(),
      assignmentType: nextType,
      unitFrom: payload.unitFrom !== undefined ? payload.unitFrom : existing.unitFrom,
      unitTo: payload.unitTo !== undefined ? payload.unitTo : existing.unitTo,
      assignedPercentage:
        payload.assignedPercentage !== undefined ? payload.assignedPercentage : existing.assignedPercentage,
      ...group
    };
    if (nextType !== "UNIT") {
      draft.unitFrom = null;
      draft.unitTo = null;
    }
    if (nextType !== "PERCENTAGE") {
      draft.assignedPercentage = null;
    }

    const siblings = await loadActiveSet(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college,
      session
    );
    const merged = siblings
      .map(toDraft)
      .filter((r) => r._id !== existing._id.toString())
      .concat(draft);
    const maxUnit = await resolveMaxUnit(
      schoolId,
      existing.academicYearBs,
      existing.subjectId.toString(),
      group,
      college
    );
    const warnings = validateMergedActiveSet(merged, {
      maxUnit,
      allowExceedMaxUnit: Boolean(payload.remarks?.trim() || existing.remarks?.trim())
    });

    const endDate = payload.effectiveFromBs;
    existing.status = "SUPERSEDED";
    existing.effectiveToBs = endDate;
    existing.endedBy = userId;
    existing.endReason = payload.endReason || "Reassigned to another teacher";
    existing.updatedBy = userId;
    await existing.save({ ...getSessionOption(session) });

    const [created] = await SubjectAssignment.create(
      [
        {
          schoolId,
          academicYearBs: existing.academicYearBs,
          faculty: existing.faculty,
          semesterBs: existing.semesterBs,
          classId: existing.classId,
          sectionId: existing.sectionId,
          batchId: existing.batchId,
          yearId: existing.yearId,
          subjectId: existing.subjectId,
          teacherId: payload.teacherId,
          assignmentType: nextType,
          unitFrom: draft.unitFrom,
          unitTo: draft.unitTo,
          assignedPercentage: draft.assignedPercentage,
          effectiveFromBs: payload.effectiveFromBs,
          effectiveToBs: payload.effectiveToBs ?? null,
          status: "ACTIVE",
          remarks: payload.remarks ?? `Reassigned from ${existing.teacherId.toString()}`,
          supersedesAssignmentId: existing._id,
          createdBy: userId
        }
      ],
      getSessionOption(session)
    );

    existing.supersededByAssignmentId = created!._id;
    await existing.save({ ...getSessionOption(session) });

    await pullTeacherFromSubjectCacheIfUnused(schoolId, existing.subjectId, existing.teacherId, session);
    await addTeacherToSubjectCache(schoolId, existing.subjectId, payload.teacherId, session);

    const populated = await SubjectAssignment.findById(created!._id)
      .populate("subjectId", "name code")
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
      .session(session)
      .lean();

    return { row: serializeAssignment(populated as Record<string, unknown>)!, warnings };
  });
};

export const listSubjectAssignments = async (
  schoolId: ObjectId | string,
  filters: {
    academicYearBs?: string;
    status?: string[];
    subjectId?: string;
    teacherId?: string;
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    faculty?: string;
  }
) => {
  const query: Record<string, unknown> = { schoolId };
  if (filters.academicYearBs) query.academicYearBs = filters.academicYearBs;
  if (filters.status?.length) query.status = { $in: filters.status };
  if (filters.subjectId) query.subjectId = filters.subjectId;
  if (filters.teacherId) query.teacherId = filters.teacherId;
  if (filters.classId) query.classId = filters.classId;
  if (filters.sectionId) query.sectionId = filters.sectionId;
  if (filters.batchId) query.batchId = filters.batchId;
  if (filters.yearId) query.yearId = filters.yearId;
  if (filters.faculty) query.faculty = filters.faculty;

  const rows = await SubjectAssignment.find(query)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
    .sort({ academicYearBs: -1, createdAt: -1 })
    .lean();

  return rows.map((r) => serializeAssignment(r as Record<string, unknown>));
};

export const recomputeSubjectTeacherIds = async (
  schoolId: ObjectId | string,
  subjectId?: string
): Promise<{ subjectsUpdated: number }> => {
  const filter: Record<string, unknown> = { schoolId };
  if (subjectId) filter._id = subjectId;

  const subjects = await Subject.find(filter).select("_id").lean();
  let subjectsUpdated = 0;

  for (const subject of subjects) {
    const teacherIds = await SubjectAssignment.distinct("teacherId", {
      schoolId,
      subjectId: subject._id,
      status: "ACTIVE"
    });
    await Subject.updateOne({ _id: subject._id, schoolId }, { $set: { teacherIds } });
    subjectsUpdated += 1;
  }

  return { subjectsUpdated };
};

export const copyYearAssignments = async (
  req: Request,
  payload: SubjectAssignmentCopyYearInput
): Promise<{ copied: number; skipped: number; warnings: string[] }> => {
  const schoolId = new mongoose.Types.ObjectId(String(req.tenantSchoolId));
  const userId = new mongoose.Types.ObjectId(req.user!.userId);

  if (payload.fromAcademicYearBs === payload.toAcademicYearBs) {
    throw new ApiError(400, "from and to academic years must differ");
  }

  const sourceFilter: Record<string, unknown> = {
    schoolId,
    academicYearBs: payload.fromAcademicYearBs,
    status: "ACTIVE"
  };
  if (payload.teacherIds?.length) {
    sourceFilter.teacherId = { $in: payload.teacherIds };
  }

  const sourceRows = await SubjectAssignment.find(sourceFilter).lean();
  let copied = 0;
  let skipped = 0;
  const warnings: string[] = [];

  // effectiveFromBs for new AY: use today if within range, else AY start heuristic YYYY-04-01
  const [startYear] = payload.toAcademicYearBs.split("/");
  const defaultFromBs = `${startYear}-04-01`;
  const effectiveFromBs = getTodayBs().startsWith(startYear ?? "") ? getTodayBs() : defaultFromBs;

  await withTransaction(async (session) => {
    for (const row of sourceRows) {
      const exists = await SubjectAssignment.findOne({
        schoolId,
        academicYearBs: payload.toAcademicYearBs,
        subjectId: row.subjectId,
        teacherId: row.teacherId,
        classId: row.classId ?? null,
        sectionId: row.sectionId ?? null,
        batchId: row.batchId ?? null,
        yearId: row.yearId ?? null,
        status: "ACTIVE"
      }).session(session);

      if (exists) {
        skipped += 1;
        continue;
      }

      try {
        await SubjectAssignment.create(
          [
            {
              schoolId,
              academicYearBs: payload.toAcademicYearBs,
              faculty: row.faculty,
              semesterBs: row.semesterBs,
              classId: row.classId ?? null,
              sectionId: row.sectionId ?? null,
              batchId: row.batchId ?? null,
              yearId: row.yearId ?? null,
              subjectId: row.subjectId,
              teacherId: row.teacherId,
              assignmentType: row.assignmentType,
              unitFrom: row.unitFrom ?? null,
              unitTo: row.unitTo ?? null,
              assignedPercentage: row.assignedPercentage ?? null,
              effectiveFromBs,
              status: "ACTIVE",
              remarks: `Copied from ${payload.fromAcademicYearBs}`,
              createdBy: userId
            }
          ],
          getSessionOption(session)
        );
        await addTeacherToSubjectCache(schoolId, row.subjectId, row.teacherId, session);
        copied += 1;
      } catch (error) {
        skipped += 1;
        warnings.push(
          `Skipped teacher ${row.teacherId.toString()} / subject ${row.subjectId.toString()}: ${
            error instanceof Error ? error.message : "conflict"
          }`
        );
      }
    }
  });

  return { copied, skipped, warnings };
};

/**
 * Percentage coverage check for timetable create/update.
 * Throws 400 when any ACTIVE PERCENTAGE rows exist for subject+group+AY and sum ≠ 100.
 */
export const assertPercentageCompleteForTimetable = async (
  schoolId: ObjectId | string,
  academicYearBs: string,
  subjectId: string,
  group: GroupKeys,
  college: boolean
): Promise<void> => {
  const rows = await SubjectAssignment.find({
    schoolId,
    academicYearBs,
    subjectId,
    status: "ACTIVE",
    ...groupFilter(group, college)
  }).lean();

  const percentRows = rows.filter((r) => r.assignmentType === "PERCENTAGE");
  if (!percentRows.length) return;

  const sum = percentRows.reduce((s, r) => s + (r.assignedPercentage ?? 0), 0);
  if (sum !== 100) {
    throw new ApiError(
      400,
      `Cannot create timetable: percentage coverage for this subject/group is ${sum}% (must total 100%)`
    );
  }
};

/** Find best matching ACTIVE assignment for teacher+subject+group+AY */
export const findMatchingAssignment = async (
  schoolId: ObjectId | string,
  academicYearBs: string,
  teacherId: string,
  subjectId: string,
  group: GroupKeys,
  college: boolean
) => {
  return SubjectAssignment.findOne({
    schoolId,
    academicYearBs,
    teacherId,
    subjectId,
    status: "ACTIVE",
    ...groupFilter(group, college)
  }).lean();
};
