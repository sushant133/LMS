import type { Request } from "express";
import mongoose from "mongoose";
import { Section } from "../models/Section.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { tenantObjectId } from "./tenant.js";

export interface TeacherScope {
  teacherId: string;
  subjectIds: string[];
  classIds: string[];
  sectionIds: string[];
  batchIds: string[];
  yearIds: string[];
}

const toIdStrings = (values: mongoose.Types.ObjectId[] | undefined): string[] =>
  (values ?? []).map((value) => value.toString());

export const getTeacherScope = async (req: Request): Promise<TeacherScope | null> => {
  if (!req.user || req.user.role !== "TEACHER") {
    return null;
  }

  const teacher = await Teacher.findOne({
    schoolId: tenantObjectId(req),
    user: req.user.userId
  }).lean();

  if (!teacher) {
    return null;
  }

  return {
    teacherId: teacher._id.toString(),
    subjectIds: toIdStrings(teacher.subjects as mongoose.Types.ObjectId[]),
    classIds: toIdStrings(teacher.assignedClassIds as mongoose.Types.ObjectId[]),
    sectionIds: toIdStrings(teacher.assignedSectionIds as mongoose.Types.ObjectId[]),
    batchIds: toIdStrings(teacher.assignedBatchIds as mongoose.Types.ObjectId[]),
    yearIds: toIdStrings(teacher.assignedYearIds as mongoose.Types.ObjectId[])
  };
};

export const requireTeacherScope = async (req: Request): Promise<TeacherScope> => {
  const scope = await getTeacherScope(req);
  if (!scope) {
    throw new ApiError(403, "Teacher profile not found for this account");
  }
  return scope;
};

export const assertTeacherClassSection = async (req: Request, classId: string, sectionId: string): Promise<TeacherScope> => {
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

export const assertTeacherBatchYear = async (req: Request, batchId: string, yearId: string): Promise<TeacherScope> => {
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

export const assertTeacherSubject = async (req: Request, subjectId: string): Promise<TeacherScope> => {
  const scope = await requireTeacherScope(req);

  if (!scope.subjectIds.includes(subjectId)) {
    throw new ApiError(403, "You are not assigned to this subject");
  }

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    teacherIds: scope.teacherId
  }).lean();

  if (!subject) {
    throw new ApiError(403, "You are not assigned to teach this subject");
  }

  return scope;
};

export const assertTeacherSubjectClassSection = async (
  req: Request,
  subjectId: string,
  classId: string,
  sectionId: string
): Promise<TeacherScope> => {
  const scope = await assertTeacherClassSection(req, classId, sectionId);
  await assertTeacherSubject(req, subjectId);

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    classIds: classId,
    teacherIds: scope.teacherId
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
  const scope = await assertTeacherBatchYear(req, batchId, yearId);
  await assertTeacherSubject(req, subjectId);

  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    yearIds: yearId,
    teacherIds: scope.teacherId
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