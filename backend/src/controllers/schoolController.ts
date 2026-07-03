import type { Request, Response } from "express";
import { createSchoolSchema, updateSchoolSchema } from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { deleteSchoolCascade } from "../utils/deleteSchoolCascade.js";
import { buildSchoolSettingsPayload } from "../utils/schoolDefaults.js";
import { sendSuccess } from "../utils/response.js";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption,
  withTransaction
} from "../utils/transaction.js";

export const listPublicSchools = asyncHandler(async (_req: Request, res: Response) => {
  const schools = await School.find({ isActive: true }).sort({ name: 1 }).lean();
  return sendSuccess(res, "Public colleges fetched", schools);
});

export const listSchools = asyncHandler(async (_req: Request, res: Response) => {
  const schools = await School.find().sort({ createdAt: -1 }).lean();
  return sendSuccess(res, "Colleges fetched", schools);
});

export const listAccessibleSchools = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  const schools =
    req.user.role === "SUPER_ADMIN"
      ? await School.find().sort({ name: 1 }).lean()
      : await School.find({ _id: req.user.schoolId }).sort({ name: 1 }).lean();

  return sendSuccess(res, "Accessible colleges fetched", schools);
});

export const createSchool = asyncHandler(async (req: Request, res: Response) => {
  const payload = createSchoolSchema.parse(req.body);

  const [existingSchoolCode, existingAdminEmail] = await Promise.all([
    School.findOne({ code: payload.code.toUpperCase() }),
    User.findOne({ email: payload.adminEmail })
  ]);

  if (existingSchoolCode) {
    throw new ApiError(409, "A college with this code already exists");
  }

  if (existingAdminEmail) {
    throw new ApiError(409, "A user with the college admin email already exists");
  }

  const session = await createSession();

  try {
    const createdSchools = await School.create(
      [
        {
          name: payload.name,
          nameNp: payload.nameNp,
          code: payload.code,
          email: payload.email,
          phone: payload.phone,
          principalName: payload.principalName,
          academicYearBs: payload.academicYearBs,
          institutionType: payload.institutionType,
          address: payload.address,
          isActive: payload.isActive
        }
      ],
      getSessionOption(session)
    );
    const school = createdSchools[0]!;

    const createdAdminUsers = await User.create(
      [
        {
          schoolId: school._id,
          fullName: payload.adminFullName,
          email: payload.adminEmail,
          phone: payload.adminPhone,
          password: env.DEFAULT_USER_PASSWORD,
          role: "COLLEGE_ADMIN",
          mustChangePassword: true
        }
      ],
      getSessionOption(session)
    );
    const adminUser = createdAdminUsers[0]!;

    await Setting.create(
      [
        {
          schoolId: school._id,
          ...buildSchoolSettingsPayload({
            name: school.name,
            nameNp: school.nameNp,
            principalName: school.principalName,
            academicYearBs: school.academicYearBs,
            email: school.email,
            phone: school.phone,
            address: school.address
          })
        }
      ],
      getSessionOption(session)
    );

    await commitTransaction(session);

    return sendSuccess(
      res,
      "College created successfully",
      {
        school,
        schoolAdmin: {
          _id: adminUser._id,
          fullName: adminUser.fullName,
          email: adminUser.email,
          role: adminUser.role,
          mustChangePassword: adminUser.mustChangePassword
        },
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

export const updateSchool = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = String(req.params.id);
  const payload = updateSchoolSchema.parse(req.body);

  const school = await School.findById(schoolId);
  if (!school) {
    throw new ApiError(404, "College not found");
  }

  const nextCode = payload.code.toUpperCase();
  if (nextCode !== school.code) {
    const existingSchoolCode = await School.findOne({ code: nextCode });
    if (existingSchoolCode) {
      throw new ApiError(409, "A college with this code already exists");
    }
  }

  school.set({
    name: payload.name,
    nameNp: payload.nameNp,
    code: nextCode,
    email: payload.email,
    phone: payload.phone,
    principalName: payload.principalName,
    academicYearBs: payload.academicYearBs,
    institutionType: payload.institutionType,
    address: payload.address,
    isActive: payload.isActive
  });
  await school.save();

  await Setting.findOneAndUpdate(
    { schoolId: school._id },
    {
      $set: buildSchoolSettingsPayload({
        name: school.name,
        nameNp: school.nameNp,
        principalName: school.principalName,
        academicYearBs: school.academicYearBs,
        email: school.email,
        phone: school.phone,
        address: school.address
      })
    }
  );

  return sendSuccess(res, "College updated successfully", school);
});

export const deleteSchool = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = String(req.params.id);
  const school = await School.findById(schoolId);

  if (!school) {
    throw new ApiError(404, "College not found");
  }

  await withTransaction(async (session) => {
    await deleteSchoolCascade(school._id, session);
  });

  return sendSuccess(res, "College and all associated data deleted permanently");
});