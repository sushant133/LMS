import type { Request, Response } from "express";
import { classSchema, sectionSchema, subjectSchema } from "@nepal-school-erp/shared";
import { SchoolClass } from "../models/SchoolClass";
import { Section } from "../models/Section";
import { Subject } from "../models/Subject";
import { Teacher } from "../models/Teacher";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { getStudentProfile } from "../utils/studentScope";
import { getTeacherScope } from "../utils/teacherScope";
import { sendSuccess } from "../utils/response";
import { tenantObjectId, withTenantScope } from "../utils/tenant";

export const listClasses = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    Object.assign(filter, { _id: { $in: teacherScope.classIds } });
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    Object.assign(filter, { _id: studentProfile.classId });
  }

  const classes = await SchoolClass.find(filter).sort({ level: 1, name: 1 });
  return sendSuccess(res, "Classes fetched", classes);
});

export const createClass = asyncHandler(async (req: Request, res: Response) => {
  const payload = classSchema.parse(req.body);
  const schoolClass = await SchoolClass.create({
    ...payload,
    schoolId: tenantObjectId(req),
    coordinatorId: payload.coordinatorId || undefined
  });
  return sendSuccess(res, "Class created successfully", schoolClass, 201);
});

export const updateClass = asyncHandler(async (req: Request, res: Response) => {
  const payload = classSchema.parse(req.body);
  const schoolClass = await SchoolClass.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      coordinatorId: payload.coordinatorId || undefined
    },
    { new: true }
  );

  if (!schoolClass) {
    throw new ApiError(404, "Class not found");
  }

  return sendSuccess(res, "Class updated successfully", schoolClass);
});

export const deleteClass = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!schoolClass) {
    throw new ApiError(404, "Class not found");
  }

  await Section.deleteMany({ classId: schoolClass._id, schoolId });

  return sendSuccess(res, "Class deleted successfully");
});

export const listSections = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = withTenantScope(req);

  if (typeof req.query.classId === "string") {
    query.classId = req.query.classId;
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    query._id = { $in: teacherScope.sectionIds };
    if (typeof req.query.classId === "string") {
      query.classId = req.query.classId;
    }
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    query._id = studentProfile.sectionId;
    query.classId = studentProfile.classId;
  }

  const sections = await Section.find(query).sort({ name: 1 });
  return sendSuccess(res, "Sections fetched", sections);
});

export const createSection = asyncHandler(async (req: Request, res: Response) => {
  const payload = sectionSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOne({ _id: payload.classId, schoolId });

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this school");
  }

  const section = await Section.create({
    ...payload,
    schoolId,
    classTeacherId: payload.classTeacherId || undefined
  });
  return sendSuccess(res, "Section created successfully", section, 201);
});

export const updateSection = asyncHandler(async (req: Request, res: Response) => {
  const payload = sectionSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOne({ _id: payload.classId, schoolId });

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this school");
  }

  const section = await Section.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      classTeacherId: payload.classTeacherId || undefined
    },
    { new: true }
  );

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  return sendSuccess(res, "Section updated successfully", section);
});

export const deleteSection = asyncHandler(async (req: Request, res: Response) => {
  const section = await Section.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  return sendSuccess(res, "Section deleted successfully");
});

export const listSubjects = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    filter._id = { $in: teacherScope.subjectIds };
    filter.teacherIds = teacherScope.teacherId;
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    filter.classIds = studentProfile.classId;
  }

  const subjects = await Subject.find(filter).sort({ name: 1 });
  return sendSuccess(res, "Subjects fetched", subjects);
});

const syncTeacherSubjects = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  subjectId: string,
  teacherIds: string[]
): Promise<void> => {
  if (teacherIds.length === 0) {
    return;
  }

  await Teacher.updateMany({ _id: { $in: teacherIds }, schoolId }, { $addToSet: { subjects: subjectId } });
};

const removeSubjectFromTeachers = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  subjectId: string,
  teacherIds?: string[]
): Promise<void> => {
  const filter: Record<string, unknown> = { schoolId };
  if (teacherIds && teacherIds.length > 0) {
    filter._id = { $in: teacherIds };
  } else {
    filter.subjects = subjectId;
  }

  await Teacher.updateMany(filter, { $pull: { subjects: subjectId } });
};

export const createSubject = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const subject = await Subject.create({
    ...payload,
    schoolId
  });

  await syncTeacherSubjects(schoolId, subject._id.toString(), payload.teacherIds ?? []);

  return sendSuccess(res, "Subject created successfully", subject, 201);
});

export const updateSubject = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const existing = await Subject.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!existing) {
    throw new ApiError(404, "Subject not found");
  }

  const subject = await Subject.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    payload,
    { new: true }
  );

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  const previousTeacherIds = (existing.teacherIds ?? []).map((id) => id.toString());
  const nextTeacherIds = payload.teacherIds ?? [];
  const addedTeacherIds = nextTeacherIds.filter((id) => !previousTeacherIds.includes(id));
  const removedTeacherIds = previousTeacherIds.filter((id) => !nextTeacherIds.includes(id));
  const subjectId = subject._id.toString();

  await Promise.all([
    syncTeacherSubjects(schoolId, subjectId, addedTeacherIds),
    removeSubjectFromTeachers(schoolId, subjectId, removedTeacherIds)
  ]);

  return sendSuccess(res, "Subject updated successfully", subject);
});

export const deleteSubject = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const subject = await Subject.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  await removeSubjectFromTeachers(schoolId, subject._id.toString());

  return sendSuccess(res, "Subject deleted successfully");
});