import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { teacherSchema } from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { validateCollegeTeacherScope } from "../utils/academicValidation.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { updatePortalUser } from "../utils/userPassword.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption
} from "../utils/transaction.js";

const validateCollegeTeacherSubjects = async (
  schoolId: mongoose.Types.ObjectId,
  subjectIds: string[],
  yearIds: string[]
): Promise<void> => {
  if (!subjectIds.length) {
    return;
  }

  const subjects = await Subject.find({ _id: { $in: subjectIds }, schoolId }).lean();
  if (subjects.length !== subjectIds.length) {
    throw new ApiError(400, "One or more selected subjects are invalid for this institution");
  }

  if (!yearIds.length) {
    return;
  }

  const yearIdSet = new Set(yearIds);
  const invalidSubject = subjects.find(
    (subject) => !(subject.yearIds ?? []).some((yearId) => yearIdSet.has(yearId.toString()))
  );

  if (invalidSubject) {
    throw new ApiError(400, "Selected subjects must belong to the assigned years");
  }
};

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
    throw new ApiError(400, "One or more selected subjects are invalid for this college");
  }

  if (classesCount !== classIds.length) {
    throw new ApiError(400, "One or more selected classes are invalid for this college");
  }

  if (sections.length !== sectionIds.length) {
    throw new ApiError(400, "One or more selected sections are invalid for this college");
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

const validateTeacherScope = async (
  req: Request,
  schoolId: mongoose.Types.ObjectId,
  payload: {
    subjects: string[];
    assignedClassIds: string[];
    assignedSectionIds: string[];
    assignedBatchIds: string[];
    assignedYearIds: string[];
  }
): Promise<void> => {
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    if (payload.assignedClassIds.length > 0 || payload.assignedSectionIds.length > 0) {
      throw new ApiError(400, "Class and section assignments are not used for college institutions");
    }

    await validateTeacherAssignments(schoolId, payload.subjects, [], []);
    await validateCollegeTeacherScope(schoolId, payload.assignedBatchIds, payload.assignedYearIds);
    await validateCollegeTeacherSubjects(schoolId, payload.subjects, payload.assignedYearIds);
    return;
  }

  if (payload.assignedBatchIds.length > 0 || payload.assignedYearIds.length > 0) {
    throw new ApiError(400, "Batch and year assignments are not used for class & section programs");
  }

  await validateTeacherAssignments(schoolId, payload.subjects, payload.assignedClassIds, payload.assignedSectionIds);
};

const buildTeacherAssignmentFields = (
  institutionType: Awaited<ReturnType<typeof getInstitutionType>>,
  payload: {
    subjects: string[];
    assignedClassIds: string[];
    assignedSectionIds: string[];
    assignedBatchIds: string[];
    assignedYearIds: string[];
    teacherCode: string;
    qualification: string;
    joinedDateBs: string;
    address: (typeof teacherSchema)["_output"]["address"];
    basicSalaryNpr: number;
  }
) => ({
  teacherCode: payload.teacherCode,
  qualification: payload.qualification,
  joinedDateBs: payload.joinedDateBs,
  address: payload.address,
  subjects: payload.subjects,
  basicSalaryNpr: payload.basicSalaryNpr,
  ...(isCollege(institutionType)
    ? {
        assignedBatchIds: payload.assignedBatchIds,
        assignedYearIds: payload.assignedYearIds,
        assignedClassIds: [],
        assignedSectionIds: []
      }
    : {
        assignedClassIds: payload.assignedClassIds,
        assignedSectionIds: payload.assignedSectionIds,
        assignedBatchIds: [],
        assignedYearIds: []
      })
});

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
  const institutionType = await getInstitutionType(req);
  await validateTeacherScope(req, schoolId, payload);

  const loginEmail = payload.email;
  const existingUser = await User.findOne({ email: loginEmail });
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const session = await createSession();
  const portalPassword = payload.password?.trim() || env.DEFAULT_USER_PASSWORD;

  try {
    const createdUsers = await User.create(
      [
        {
          schoolId,
          fullName: payload.fullName,
          email: loginEmail,
          phone: payload.phone,
          password: portalPassword,
          role: "TEACHER",
          mustChangePassword: !payload.password?.trim()
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
          ...buildTeacherAssignmentFields(institutionType, payload)
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
        loginEmail,
        defaultPassword: portalPassword
      },
      201
    );
  } catch (error) {
    await abortTransaction(session);
    throwIfDuplicateKey(error);
    throw error;
  } finally {
    await endSession(session);
  }
});

export const updateTeacher = asyncHandler(async (req: Request, res: Response) => {
  const payload = teacherSchema.parse(req.body);
  ensureValidBsDate(payload.joinedDateBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateTeacherScope(req, schoolId, payload);

  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const loginEmail = payload.email;
  const currentUser = await User.findById(teacher.user).select("email").lean();

  if (loginEmail !== currentUser?.email) {
    const duplicate = await User.findOne({ email: loginEmail, _id: { $ne: teacher.user } });
    if (duplicate) {
      throw new ApiError(409, "A user with this login ID already exists");
    }
  }

  await updatePortalUser(teacher.user, {
    fullName: payload.fullName,
    email: loginEmail,
    phone: payload.phone,
    password: payload.password
  });

  const previousSubjectIds = (teacher.subjects ?? []).map((id) => id.toString());
  const nextSubjectIds = payload.subjects;
  const addedSubjectIds = nextSubjectIds.filter((id) => !previousSubjectIds.includes(id));
  const removedSubjectIds = previousSubjectIds.filter((id) => !nextSubjectIds.includes(id));

  Object.assign(teacher, buildTeacherAssignmentFields(institutionType, payload));
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
