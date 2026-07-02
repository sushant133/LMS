import type { Request } from "express";
import mongoose from "mongoose";
import { Section } from "../models/Section";
import { Subject } from "../models/Subject";
import { Teacher } from "../models/Teacher";
import { ApiError } from "./apiError";
import { tenantObjectId } from "./tenant";

export interface TeacherScope {
  teacherId: string;
  subjectIds: string[];
  classIds: string[];
  sectionIds: string[];
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
    sectionIds: toIdStrings(teacher.assignedSectionIds as mongoose.Types.ObjectId[])
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

export const applyTeacherReadFilter = async (
  req: Request,
  filter: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const scope = await getTeacherScope(req);
  if (!scope) {
    return filter;
  }

  return {
    ...filter,
    $or: [
      { teacherId: scope.teacherId },
      { classId: { $in: scope.classIds }, sectionId: { $in: scope.sectionIds } },
      { subjectId: { $in: scope.subjectIds } },
      { classIds: { $in: scope.classIds } },
      { "marks.subjectId": { $in: scope.subjectIds } }
    ]
  };
};

export const getTeacherStudentFilter = async (req: Request): Promise<Record<string, unknown>> => {
  const scope = await requireTeacherScope(req);
  return {
    schoolId: tenantObjectId(req),
    classId: { $in: scope.classIds },
    sectionId: { $in: scope.sectionIds }
  };
};

export const assertTeacherQueryScope = (
  scope: TeacherScope,
  classId?: string,
  sectionId?: string,
  subjectId?: string
): void => {
  if (classId && !scope.classIds.includes(classId)) {
    throw new ApiError(403, "You are not assigned to this class");
  }
  if (sectionId && !scope.sectionIds.includes(sectionId)) {
    throw new ApiError(403, "You are not assigned to this section");
  }
  if (subjectId && !scope.subjectIds.includes(subjectId)) {
    throw new ApiError(403, "You are not assigned to this subject");
  }
};