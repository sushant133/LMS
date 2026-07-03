import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { studentSchema } from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { getStudentScopeFilter } from "../utils/parentScope.js";
import { getTeacherStudentFilter, getTeacherScope } from "../utils/teacherScope.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { updatePortalUser } from "../utils/userPassword.js";
import { validateStudentAdmissionScope } from "../utils/academicValidation.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption
} from "../utils/transaction.js";

const getReadableStudentFilter = async (req: Request): Promise<Record<string, unknown>> => {
  if (req.user?.role === "TEACHER") {
    return getTeacherStudentFilter(req);
  }
  return getStudentScopeFilter(req);
};

export const listStudents = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const students = await Student.find(filter).populate("user", "-password").sort({ createdAt: -1 });
  return sendSuccess(res, "Students fetched", students);
});

export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const student = await Student.findOne({ ...filter, _id: req.params.id }).populate("user", "-password");

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  return sendSuccess(res, "Student fetched", student);
});

export const createStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentSchema.parse(req.body);
  ensureValidBsDate(payload.admissionDateBs);
  ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateStudentAdmissionScope(institutionType, schoolId, payload);

  const loginEmail = payload.email;
  const existingUser = await User.findOne({ email: loginEmail });
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const session = await createSession();

  try {
    const portalPassword = payload.password?.trim() || env.DEFAULT_USER_PASSWORD;

    const createdUsers = await User.create(
      [
        {
          schoolId,
          fullName: payload.fullName,
          email: loginEmail,
          phone: payload.phone,
          password: portalPassword,
          role: "STUDENT",
          mustChangePassword: !payload.password?.trim()
        }
      ],
      getSessionOption(session)
    );
    const user = createdUsers[0]!;

    const createdStudents = await Student.create(
      [
        {
          schoolId,
          user: user._id,
          admissionNumber: payload.admissionNumber,
          rollNumber: payload.rollNumber,
          ...(isCollege(institutionType)
            ? { batchId: payload.batchId, yearId: payload.yearId }
            : { classId: payload.classId, sectionId: payload.sectionId }),
          admissionDateBs: payload.admissionDateBs,
          dateOfBirthBs: payload.dateOfBirthBs,
          gender: payload.gender,
          bloodGroup: payload.bloodGroup,
          disabilityCategory: payload.disabilityCategory,
          ethnicityCategory: payload.ethnicityCategory,
          address: payload.address,
          fatherName: payload.fatherName,
          motherName: payload.motherName,
          guardianName: payload.guardianName,
          guardianPhone: payload.guardianPhone,
          feesDueNpr: payload.feesDueNpr,
          remarks: payload.remarks
        }
      ],
      getSessionOption(session)
    );
    const student = createdStudents[0]!;

    await commitTransaction(session);
    await student.populate("user", "-password");

    return sendSuccess(
      res,
      "Student created successfully",
      {
        student,
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

export const updateStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentSchema.parse(req.body);
  ensureValidBsDate(payload.admissionDateBs);
  ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateStudentAdmissionScope(institutionType, schoolId, payload);

  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const loginEmail = payload.email;
  const currentUser = await User.findById(student.user).select("email").lean();

  if (loginEmail !== currentUser?.email) {
    const duplicate = await User.findOne({ email: loginEmail, _id: { $ne: student.user } });
    if (duplicate) {
      throw new ApiError(409, "A user with this login ID already exists");
    }
  }

  await updatePortalUser(student.user, {
    fullName: payload.fullName,
    email: loginEmail,
    phone: payload.phone,
    password: payload.password
  });

  Object.assign(student, {
    admissionNumber: payload.admissionNumber,
    rollNumber: payload.rollNumber,
    ...(isCollege(institutionType)
      ? { batchId: payload.batchId, yearId: payload.yearId, classId: undefined, sectionId: undefined }
      : { classId: payload.classId, sectionId: payload.sectionId, batchId: undefined, yearId: undefined }),
    admissionDateBs: payload.admissionDateBs,
    dateOfBirthBs: payload.dateOfBirthBs,
    gender: payload.gender,
    bloodGroup: payload.bloodGroup,
    disabilityCategory: payload.disabilityCategory,
    ethnicityCategory: payload.ethnicityCategory,
    address: payload.address,
    fatherName: payload.fatherName,
    motherName: payload.motherName,
    guardianName: payload.guardianName,
    guardianPhone: payload.guardianPhone,
    feesDueNpr: payload.feesDueNpr,
    remarks: payload.remarks
  });

  await student.save();
  await student.populate("user", "-password");

  return sendSuccess(res, "Student updated successfully", student);
});

export const deleteStudent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  await User.findOneAndDelete({ _id: student.user, schoolId });
  await student.deleteOne();

  return sendSuccess(res, "Student deleted successfully");
});