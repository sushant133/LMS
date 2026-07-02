import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { studentSchema } from "@nepal-school-erp/shared";
import { env } from "../config/env";
import { SchoolClass } from "../models/SchoolClass";
import { Section } from "../models/Section";
import { Student } from "../models/Student";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { ensureValidBsDate } from "../utils/nepaliDate";
import { getStudentScopeFilter } from "../utils/parentScope";
import { getTeacherStudentFilter, getTeacherScope } from "../utils/teacherScope";
import { sendSuccess } from "../utils/response";
import { tenantObjectId, withTenantScope } from "../utils/tenant";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption
} from "../utils/transaction";

const validateStudentScope = async (schoolId: mongoose.Types.ObjectId, classId: string, sectionId: string): Promise<void> => {
  const [schoolClass, section] = await Promise.all([
    SchoolClass.findOne({ _id: classId, schoolId }),
    Section.findOne({ _id: sectionId, classId, schoolId })
  ]);

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this school");
  }

  if (!section) {
    throw new ApiError(404, "Selected section was not found in this school");
  }
};

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
  await validateStudentScope(schoolId, payload.classId, payload.sectionId);

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
          role: "STUDENT",
          mustChangePassword: true
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
          classId: payload.classId,
          sectionId: payload.sectionId,
          admissionDateBs: payload.admissionDateBs,
          dateOfBirthBs: payload.dateOfBirthBs,
          gender: payload.gender,
          bloodGroup: payload.bloodGroup,
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

export const updateStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentSchema.parse(req.body);
  ensureValidBsDate(payload.admissionDateBs);
  ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  await validateStudentScope(schoolId, payload.classId, payload.sectionId);

  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  await User.findOneAndUpdate(
    { _id: student.user, schoolId },
    {
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone
    }
  );

  Object.assign(student, {
    admissionNumber: payload.admissionNumber,
    rollNumber: payload.rollNumber,
    classId: payload.classId,
    sectionId: payload.sectionId,
    admissionDateBs: payload.admissionDateBs,
    dateOfBirthBs: payload.dateOfBirthBs,
    gender: payload.gender,
    bloodGroup: payload.bloodGroup,
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