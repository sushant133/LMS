import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { collegeStaffSchema, type CollegeStaffCategory } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  abortTransaction,
  commitTransaction,
  createSession,
  endSession,
  getSessionOption
} from "../utils/transaction.js";

type CollegeStaffLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  user?: Types.ObjectId;
  staffId: string;
  fullName: string;
  photoUrl?: string;
  gender: string;
  dateOfBirthBs?: string;
  phone: string;
  email?: string;
  address: {
    province: string;
    district: string;
    municipality: string;
    ward: string;
    streetAddress: string;
  };
  joinedDateBs: string;
  designation: string;
  category: CollegeStaffCategory;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN";
  basicSalaryNpr: number;
  status: "ACTIVE" | "INACTIVE";
  enableLogin: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

const serializeStaff = async (staff: CollegeStaffLean) => {
  const user = staff.user
    ? await User.findById(staff.user).select("-password").lean()
    : null;

  return {
    _id: staff._id.toString(),
    schoolId: staff.schoolId.toString(),
    user: user
      ? {
          _id: user._id.toString(),
          schoolId: user.schoolId?.toString(),
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          phone: user.phone,
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword
        }
      : undefined,
    staffId: staff.staffId,
    fullName: staff.fullName,
    photoUrl: staff.photoUrl,
    gender: staff.gender,
    dateOfBirthBs: staff.dateOfBirthBs,
    phone: staff.phone,
    email: staff.email,
    address: staff.address,
    joinedDateBs: staff.joinedDateBs,
    designation: staff.designation,
    category: staff.category,
    employmentType: staff.employmentType,
    basicSalaryNpr: staff.basicSalaryNpr,
    status: staff.status,
    enableLogin: staff.enableLogin,
    createdAt: staff.createdAt?.toISOString(),
    updatedAt: staff.updatedAt?.toISOString()
  };
};

const enrichStaffList = async (records: CollegeStaffLean[]) => Promise.all(records.map((record) => serializeStaff(record)));

export const listCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as CollegeStaffCategory | undefined;
  const filter: Record<string, unknown> = { isDeleted: false };
  if (category) {
    filter.category = category;
  }

  const staff = await CollegeStaff.find(withTenantScope(req, filter)).sort({ createdAt: -1 }).lean();
  return sendSuccess(res, "College staff fetched", await enrichStaffList(staff as CollegeStaffLean[]));
});

export const createCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeStaffSchema.parse(req.body);
  ensureValidBsDate(payload.joinedDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const session = await createSession();
  try {
    let userId: Types.ObjectId | undefined;
    let loginEmail: string | undefined;
    let defaultPassword: string | undefined;

    if (payload.enableLogin) {
      const email = payload.email!.toLowerCase().trim();
      const existingUser = await User.findOne({ email }).session(session);
      if (existingUser) {
        throw new ApiError(409, "A user with this email already exists");
      }

      defaultPassword = payload.password ?? env.DEFAULT_USER_PASSWORD;
      const user = await User.create(
        [
          {
            schoolId: tenantObjectId(req),
            fullName: payload.fullName,
            email,
            phone: payload.phone,
            password: defaultPassword,
            role: "COLLEGE_STAFF",
            isActive: payload.status === "ACTIVE",
            mustChangePassword: !payload.password
          }
        ],
        getSessionOption(session)
      );
      userId = user[0]!._id;
      loginEmail = email;
    }

    const staff = await CollegeStaff.create(
      [
        {
          schoolId: tenantObjectId(req),
          user: userId,
          staffId: payload.staffId,
          fullName: payload.fullName,
          photoUrl: payload.photoUrl || undefined,
          gender: payload.gender,
          dateOfBirthBs: payload.dateOfBirthBs || undefined,
          phone: payload.phone,
          email: payload.email?.trim() || undefined,
          address: payload.address,
          joinedDateBs: payload.joinedDateBs,
          designation: payload.designation,
          category: payload.category,
          employmentType: payload.employmentType,
          basicSalaryNpr: payload.basicSalaryNpr,
          status: payload.status,
          enableLogin: payload.enableLogin
        }
      ],
      getSessionOption(session)
    );

    await commitTransaction(session);
    const serialized = await serializeStaff(staff[0]!.toObject() as CollegeStaffLean);
    return sendSuccess(
      res,
      "College staff created",
      loginEmail
        ? { staff: serialized, loginEmail, defaultPassword }
        : { staff: serialized },
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

export const updateCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeStaffSchema.partial().parse(req.body);
  if (payload.joinedDateBs) ensureValidBsDate(payload.joinedDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const existing = await CollegeStaff.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!existing) {
    throw new ApiError(404, "College staff not found");
  }

  if (payload.enableLogin === true && !payload.email?.trim() && !existing.email) {
    throw new ApiError(400, "Email is required when login is enabled");
  }

  if (existing.user) {
    const user = await User.findById(existing.user);
    if (user) {
      if (payload.fullName) user.fullName = payload.fullName;
      if (payload.phone) user.phone = payload.phone;
      if (payload.password) {
        user.password = payload.password;
        user.mustChangePassword = false;
      }
      if (payload.email) {
        const email = payload.email.toLowerCase().trim();
        const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
        if (duplicate) throw new ApiError(409, "A user with this email already exists");
        user.email = email;
      }
      if (payload.status) {
        user.isActive = payload.status === "ACTIVE";
      }
      await user.save();
    }
  } else if (payload.enableLogin) {
    const email = (payload.email ?? existing.email)!.toLowerCase().trim();
    const duplicate = await User.findOne({ email });
    if (duplicate) throw new ApiError(409, "A user with this email already exists");

    const user = await User.create({
      schoolId: tenantObjectId(req),
      fullName: payload.fullName ?? existing.fullName,
      email,
      phone: payload.phone ?? existing.phone,
      password: payload.password ?? env.DEFAULT_USER_PASSWORD,
      role: "COLLEGE_STAFF",
      isActive: (payload.status ?? existing.status) === "ACTIVE",
      mustChangePassword: !payload.password
    });
    existing.user = user._id;
    existing.enableLogin = true;
  }

  if (payload.staffId) existing.staffId = payload.staffId;
  if (payload.fullName) existing.fullName = payload.fullName;
  if (payload.photoUrl !== undefined) existing.photoUrl = payload.photoUrl || undefined;
  if (payload.gender) existing.gender = payload.gender;
  if (payload.dateOfBirthBs !== undefined) existing.dateOfBirthBs = payload.dateOfBirthBs || undefined;
  if (payload.phone) existing.phone = payload.phone;
  if (payload.email !== undefined) existing.email = payload.email?.trim() || undefined;
  if (payload.address) existing.address = payload.address;
  if (payload.joinedDateBs) existing.joinedDateBs = payload.joinedDateBs;
  if (payload.designation) existing.designation = payload.designation;
  if (payload.category) existing.category = payload.category;
  if (payload.employmentType) existing.employmentType = payload.employmentType;
  if (payload.basicSalaryNpr !== undefined) existing.basicSalaryNpr = payload.basicSalaryNpr;
  if (payload.status) existing.status = payload.status;
  if (payload.enableLogin !== undefined) existing.enableLogin = payload.enableLogin;

  try {
    await existing.save();
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }

  return sendSuccess(res, "College staff updated", await serializeStaff(existing.toObject() as CollegeStaffLean));
});

export const deleteCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const staff = await CollegeStaff.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }

  staff.isDeleted = true;
  staff.status = "INACTIVE";
  await staff.save();

  if (staff.user) {
    await User.findByIdAndUpdate(staff.user, { isActive: false });
  }

  return sendSuccess(res, "College staff deactivated");
});