import type { Request } from "express";
import mongoose from "mongoose";
import type { ScopeMode, TeacherAssignmentPair, TeacherScopeV2 } from "@phit-erp/shared";
import { Section } from "../models/Section.js";
import { Subject } from "../models/Subject.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { getAcademicYearBs, getScopeMode } from "./subjectAssignmentService.js";
import { tenantObjectId } from "./tenant.js";

/** Stable V2 shape — always returned by getTeacherScope */
export type TeacherScope = TeacherScopeV2;

export type { TeacherAssignmentPair, TeacherScopeV2 };

const toIdStrings = (values: mongoose.Types.ObjectId[] | undefined): string[] =>
  (values ?? []).map((value) => value.toString());

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const pairMatchesGroup = (
  pair: TeacherAssignmentPair,
  group: { classId?: string; sectionId?: string; batchId?: string; yearId?: string },
  college: boolean
): boolean => {
  if (college) {
    return pair.batchId === group.batchId && pair.yearId === group.yearId;
  }
  return pair.classId === group.classId && pair.sectionId === group.sectionId;
};

const buildScopeFromAssignments = (
  teacherId: string,
  academicYearBs: string,
  rows: Array<{
    _id: { toString(): string };
    subjectId: { toString(): string };
    classId?: { toString(): string } | null;
    sectionId?: { toString(): string } | null;
    batchId?: { toString(): string } | null;
    yearId?: { toString(): string } | null;
    assignmentType: TeacherAssignmentPair["assignmentType"];
    unitFrom?: number | null;
    unitTo?: number | null;
    assignedPercentage?: number | null;
  }>
): TeacherScope => {
  const assignments: TeacherAssignmentPair[] = rows.map((row) => ({
    subjectId: row.subjectId.toString(),
    classId: row.classId?.toString(),
    sectionId: row.sectionId?.toString(),
    batchId: row.batchId?.toString(),
    yearId: row.yearId?.toString(),
    assignmentId: row._id.toString(),
    assignmentType: row.assignmentType,
    unitFrom: row.unitFrom ?? null,
    unitTo: row.unitTo ?? null,
    assignedPercentage: row.assignedPercentage ?? null
  }));

  return {
    teacherId,
    subjectIds: unique(assignments.map((a) => a.subjectId)),
    classIds: unique(assignments.map((a) => a.classId).filter(Boolean) as string[]),
    sectionIds: unique(assignments.map((a) => a.sectionId).filter(Boolean) as string[]),
    batchIds: unique(assignments.map((a) => a.batchId).filter(Boolean) as string[]),
    yearIds: unique(assignments.map((a) => a.yearId).filter(Boolean) as string[]),
    assignments,
    academicYearBs,
    scopeSource: "assignment"
  };
};

const buildLegacyScope = (
  teacher: {
    _id: { toString(): string };
    subjects?: mongoose.Types.ObjectId[];
    assignedClassIds?: mongoose.Types.ObjectId[];
    assignedSectionIds?: mongoose.Types.ObjectId[];
    assignedBatchIds?: mongoose.Types.ObjectId[];
    assignedYearIds?: mongoose.Types.ObjectId[];
  },
  academicYearBs: string
): TeacherScope => ({
  teacherId: teacher._id.toString(),
  subjectIds: toIdStrings(teacher.subjects),
  classIds: toIdStrings(teacher.assignedClassIds),
  sectionIds: toIdStrings(teacher.assignedSectionIds),
  batchIds: toIdStrings(teacher.assignedBatchIds),
  yearIds: toIdStrings(teacher.assignedYearIds),
  assignments: [],
  academicYearBs,
  scopeSource: "legacy"
});

/**
 * Dual-mode precedence:
 * - legacy mode → always legacy arrays
 * - assignment mode → always ACTIVE SubjectAssignment for current AY
 * - dual + PENDING|NEEDS_REVIEW|missing → legacy
 * - dual + ACCEPTED|NA → assignments
 */
const resolveScopeSource = (
  mode: ScopeMode,
  migrationStatus: string | undefined | null
): "legacy" | "assignment" => {
  const status = migrationStatus ?? "PENDING";

  if (mode === "legacy") return "legacy";
  if (mode === "assignment") return "assignment";

  // dual
  if (status === "NEEDS_REVIEW" || status === "PENDING") return "legacy";
  if (status === "ACCEPTED" || status === "NA") return "assignment";
  return "legacy";
};

export const getTeacherScope = async (req: Request): Promise<TeacherScope | null> => {
  if (!req.user || req.user.role !== "TEACHER") {
    return null;
  }

  const schoolId = tenantObjectId(req);
  const teacher = await Teacher.findOne({
    schoolId,
    user: req.user.userId
  }).lean();

  if (!teacher) {
    return null;
  }

  let academicYearBs = "";
  try {
    academicYearBs = await getAcademicYearBs(schoolId);
  } catch {
    academicYearBs = "";
  }

  const mode = await getScopeMode(schoolId);
  const source = resolveScopeSource(mode, teacher.assignmentMigrationStatus);

  if (source === "legacy") {
    return buildLegacyScope(teacher, academicYearBs);
  }

  // assignment source
  const rows = academicYearBs
    ? await SubjectAssignment.find({
        schoolId,
        teacherId: teacher._id,
        academicYearBs,
        status: "ACTIVE"
      }).lean()
    : [];

  return buildScopeFromAssignments(teacher._id.toString(), academicYearBs, rows);
};

export const requireTeacherScope = async (req: Request): Promise<TeacherScope> => {
  const scope = await getTeacherScope(req);
  if (!scope) {
    throw new ApiError(403, "Teacher profile not found for this account");
  }
  return scope;
};

export const assertTeacherClassSection = async (
  req: Request,
  classId: string,
  sectionId: string
): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  if (!scope.classIds.includes(classId) || !scope.sectionIds.includes(sectionId)) {
    throw new ApiError(403, "You are not assigned to this class or section");
  }

  const section = await Section.findOne({
    _id: sectionId,
    classId,
    schoolId: tenantObjectId(req)
  }).lean();

  if (!section) {
    throw new ApiError(404, "Section was not found in this class");
  }

  return scope;
};

export const assertTeacherBatchYear = async (
  req: Request,
  batchId: string,
  yearId: string
): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  if (!scope.batchIds.includes(batchId) || !scope.yearIds.includes(yearId)) {
    throw new ApiError(403, "You are not assigned to this batch or year");
  }

  const year = await Year.findOne({
    _id: yearId,
    batchId,
    schoolId: tenantObjectId(req)
  }).lean();

  if (!year) {
    throw new ApiError(404, "Year was not found in this batch");
  }

  return scope;
};

export const assertTeacherAcademicScope = async (
  req: Request,
  payload: { classId?: string; sectionId?: string; batchId?: string; yearId?: string }
): Promise<TeacherScope> => {
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    if (!payload.batchId || !payload.yearId) {
      throw new ApiError(400, "Batch and year are required");
    }
    return assertTeacherBatchYear(req, payload.batchId, payload.yearId);
  }

  if (!payload.classId || !payload.sectionId) {
    throw new ApiError(400, "Class and section are required");
  }
  return assertTeacherClassSection(req, payload.classId, payload.sectionId);
};

/**
 * Subject membership via scope.subjectIds only.
 * Subject.teacherIds is a non-authoritative cache — not used for authZ.
 */
export const assertTeacherSubject = async (req: Request, subjectId: string): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  if (!scope.subjectIds.includes(subjectId)) {
    throw new ApiError(403, "You are not assigned to this subject");
  }

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req)
  }).lean();

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  return scope;
};

export const assertTeacherSubjectClassSection = async (
  req: Request,
  subjectId: string,
  classId: string,
  sectionId: string
): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  // Matrix path when assignment-sourced (even if empty — do not fall back to legacy arrays)
  if (scope.scopeSource === "assignment") {
    const match = scope.assignments.find(
      (pair) =>
        pair.subjectId === subjectId && pair.classId === classId && pair.sectionId === sectionId
    );
    if (!match) {
      throw new ApiError(403, "You are not assigned to teach this subject for this class/section");
    }
  } else {
    // Legacy: set membership (no teacherIds check)
    if (!scope.classIds.includes(classId) || !scope.sectionIds.includes(sectionId)) {
      throw new ApiError(403, "You are not assigned to this class or section");
    }
    if (!scope.subjectIds.includes(subjectId)) {
      throw new ApiError(403, "You are not assigned to this subject");
    }
  }

  const section = await Section.findOne({
    _id: sectionId,
    classId,
    schoolId: tenantObjectId(req)
  }).lean();
  if (!section) {
    throw new ApiError(404, "Section was not found in this class");
  }

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    classIds: classId
  }).lean();

  if (!subject) {
    throw new ApiError(403, "This subject is not assigned to your class");
  }

  return scope;
};

export const assertTeacherSubjectBatchYear = async (
  req: Request,
  subjectId: string,
  batchId: string,
  yearId: string
): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  if (scope.scopeSource === "assignment") {
    const match = scope.assignments.find(
      (pair) => pair.subjectId === subjectId && pair.batchId === batchId && pair.yearId === yearId
    );
    if (!match) {
      throw new ApiError(403, "You are not assigned to teach this subject for this batch/year");
    }
  } else {
    if (!scope.batchIds.includes(batchId) || !scope.yearIds.includes(yearId)) {
      throw new ApiError(403, "You are not assigned to this batch or year");
    }
    if (!scope.subjectIds.includes(subjectId)) {
      throw new ApiError(403, "You are not assigned to this subject");
    }
  }

  const year = await Year.findOne({
    _id: yearId,
    batchId,
    schoolId: tenantObjectId(req)
  }).lean();
  if (!year) {
    throw new ApiError(404, "Year was not found in this batch");
  }

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    yearIds: yearId
  }).lean();

  if (!subject) {
    throw new ApiError(403, "This subject is not assigned to your year");
  }

  return scope;
};

export const assertTeacherSubjectAcademicScope = async (
  req: Request,
  subjectId: string,
  payload: { classId?: string; sectionId?: string; batchId?: string; yearId?: string }
): Promise<TeacherScope> => {
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    if (!payload.batchId || !payload.yearId) {
      throw new ApiError(400, "Batch and year are required");
    }
    return assertTeacherSubjectBatchYear(req, subjectId, payload.batchId, payload.yearId);
  }

  if (!payload.classId || !payload.sectionId) {
    throw new ApiError(400, "Class and section are required");
  }
  return assertTeacherSubjectClassSection(req, subjectId, payload.classId, payload.sectionId);
};

export const getTeacherStudentFilter = async (req: Request): Promise<Record<string, unknown>> => {
  const scope = await requireTeacherScope(req);
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    return {
      schoolId: tenantObjectId(req),
      batchId: { $in: scope.batchIds },
      yearId: { $in: scope.yearIds }
    };
  }

  return {
    schoolId: tenantObjectId(req),
    classId: { $in: scope.classIds },
    sectionId: { $in: scope.sectionIds }
  };
};

export const assertTeacherQueryScope = (
  scope: TeacherScope,
  options: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    subjectId?: string;
    isCollege?: boolean;
  }
): void => {
  // Prefer matrix match when subject + full group present under assignment source
  if (
    scope.scopeSource === "assignment" &&
    scope.assignments.length > 0 &&
    options.subjectId &&
    ((options.isCollege && options.batchId && options.yearId) ||
      (!options.isCollege && options.classId && options.sectionId))
  ) {
    const match = scope.assignments.find((pair) => {
      if (pair.subjectId !== options.subjectId) return false;
      return pairMatchesGroup(
        pair,
        {
          classId: options.classId,
          sectionId: options.sectionId,
          batchId: options.batchId,
          yearId: options.yearId
        },
        Boolean(options.isCollege)
      );
    });
    if (!match) {
      throw new ApiError(403, "You are not assigned to this subject for the selected group");
    }
    return;
  }

  if (options.isCollege) {
    if (options.batchId && !scope.batchIds.includes(options.batchId)) {
      throw new ApiError(403, "You are not assigned to this batch");
    }
    if (options.yearId && !scope.yearIds.includes(options.yearId)) {
      throw new ApiError(403, "You are not assigned to this year");
    }
  } else {
    if (options.classId && !scope.classIds.includes(options.classId)) {
      throw new ApiError(403, "You are not assigned to this class");
    }
    if (options.sectionId && !scope.sectionIds.includes(options.sectionId)) {
      throw new ApiError(403, "You are not assigned to this section");
    }
  }

  if (options.subjectId && !scope.subjectIds.includes(options.subjectId)) {
    throw new ApiError(403, "You are not assigned to this subject");
  }
};
