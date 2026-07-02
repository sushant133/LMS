import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { teacherSchema } from "@nepal-school-erp/shared";
import { env } from "../config/env";
import { SchoolClass } from "../models/SchoolClass";
import { Section } from "../models/Section";
import { Subject } from "../models/Subject";
import { Teacher } from "../models/Teacher";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { ensureValidBsDate } from "../utils/nepaliDate";
import { sendSuccess } from "../utils/response";
import { tenantObjectId, withTenantScope } from "../utils/tenant";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption
} from "../utils/transaction";

const validateTeacherAssignments = async (
  schoolId: mongoose.Types.ObjectId,
  subjectIds: string[],
  classIds: string[],
  sectionIds: string[]
): Promise<void> => {
  const [subjectsCount, classesCount, sections] = await Promise.all([
    Subject.countDocuments({ _id: { $in: subjectIds }, schoolId }),
    SchoolClass.countDocuments({ _id: { $in: classIds }, schoolId }),
    Section.find({ _id: { $in: sectionIds }, schoolId }).lean()
  ]);

  if (subjectsCount !== subjectIds.length) {
    throw new ApiError(400, "One or more selected subjects are invalid for this school");
  }

  if (classesCount !== classIds.length) {
    throw new ApiError(400, "One or more selected classes are invalid for this school");
  }

  if (sections.length !== sectionIds.length) {
    throw new ApiError(400, "One or more selected sections are invalid for this school");
  }

  const classIdSet = new Set(classIds);
  const invalidSection = sections.find((section) => !classIdSet.has(section.classId.toString()));
  if (invalidSection) {
    throw new ApiError(400, "One or more selected sections do not belong to the assigned classes");
  }
};

const syncSubjectTeacherIds = async (
  schoolId: mongoose.Types.ObjectId,
  teacherId: mongoose.Types.ObjectId,
  subjectIds: string[],
  session: mongoose.ClientSession | null = null
): Promise<void> => {
  if (subjectIds.length === 0) {
    return;
  }

  await Subject.updateMany(
    { _id: { $in: subjectIds }, schoolId },
    { $addToSet: { teacherIds: teacherId } },
    getSessionOption(session)
  );
};

const removeTeacherFromSubjects = async (
  schoolId: mongoose.Types.ObjectId,
  teacherId: mongoose.Types.ObjectId,
  subjectIds?: string[],
  session: mongoose.ClientSession | null = null
): Promise<void> => {
  const filter: Record<string, unknown> = { schoolId };
  if (subjectIds && subjectIds.length > 0) {
    filter._id = { $in: subjectIds };
  } else {
    filter.teacherIds = teacherId;
  }

  await Subject.updateMany(filter, { $pull: { teacherIds: teacherId } }, getSessionOption(session));
};

export const listTeachers = asyncHandler(async (req: Request, res: Response) => {
  const teachers = await Teacher.find(withTenantScope(req)).populate("user", "-password").sort({ createdAt: -1 });
  return sendSuccess(res, "Teachers fetched", teachers);
});

export const getTeacherById = asyncHandler(async (req: Request, res: Response) => {
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id })).populate("user", "-password");

  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  return sendSuccess(res, "Teacher fetched", teacher);
});

export const createTeacher = asyncHandler(async (req: Request, res: Response) => {
  const payload = teacherSchema.parse(req.body);
  ensureValidBsDate(payload.joinedDateBs);

  const schoolId = tenantObjectId(req);
  await validateTeacherAssignments(schoolId, payload.subjects, payload.assignedClassIds, payload.assignedSectionIds);

  const existingUser = await User.findOne({ email: payload.email });
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const session = await createSession();

  try {
    const createdUsers = await User.create(
      [
        {
          schoolId,
          fullName: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          password: env.DEFAULT_USER_PASSWORD,
          role: "TEACHER",
          mustChangePassword: true
        }
      ],
      getSessionOption(session)
    );
    const user = createdUsers[0]!;

    const createdTeachers = await Teacher.create(
      [
        {
          schoolId,
          user: user._id,
          teacherCode: payload.teacherCode,
          qualification: payload.qualification,
          joinedDateBs: payload.joinedDateBs,
          address: payload.address,
          subjects: payload.subjects,
          assignedClassIds: payload.assignedClassIds,
          assignedSectionIds: payload.assignedSectionIds,
          basicSalaryNpr: payload.basicSalaryNpr
        }
      ],
      getSessionOption(session)
    );
    const teacher = createdTeachers[0]!;

    await syncSubjectTeacherIds(schoolId, teacher._id, payload.subjects, session);

    await commitTransaction(session);
    await teacher.populate("user", "-password");

    return sendSuccess(
      res,
      "Teacher created successfully",
      {
        teacher,
        defaultPassword: env.DEFAULT_USER_PASSWORD
      },
      201
    );
  } catch (error) {
    await abortTransaction(session);
    throw error;
  } finally {
    await endSession(session);
  }
});

export const updateTeacher = asyncHandler(async (req: Request, res: Response) => {
  const payload = teacherSchema.parse(req.body);
  ensureValidBsDate(payload.joinedDateBs);

  const schoolId = tenantObjectId(req);
  await validateTeacherAssignments(schoolId, payload.subjects, payload.assignedClassIds, payload.assignedSectionIds);

  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  await User.findOneAndUpdate(
    { _id: teacher.user, schoolId },
    {
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone
    }
  );

  const previousSubjectIds = (teacher.subjects ?? []).map((id) => id.toString());
  const nextSubjectIds = payload.subjects;
  const addedSubjectIds = nextSubjectIds.filter((id) => !previousSubjectIds.includes(id));
  const removedSubjectIds = previousSubjectIds.filter((id) => !nextSubjectIds.includes(id));

  Object.assign(teacher, payload);
  await teacher.save();

  await Promise.all([
    syncSubjectTeacherIds(schoolId, teacher._id, addedSubjectIds),
    removeTeacherFromSubjects(schoolId, teacher._id, removedSubjectIds)
  ]);

  await teacher.populate("user", "-password");

  return sendSuccess(res, "Teacher updated successfully", teacher);
});

export const deleteTeacher = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  await removeTeacherFromSubjects(schoolId, teacher._id);
  await User.findOneAndDelete({ _id: teacher.user, schoolId });
  await teacher.deleteOne();

  return sendSuccess(res, "Teacher deleted successfully");
});
