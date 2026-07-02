import type { Request, Response } from "express";
import {
  activeSchoolSchema,
  loginSchema,
  registerSchema,
  type AuthResponse,
  type SchoolRecord,
  type UserRole
} from "@nepal-school-erp/shared";
import { env } from "../config/env";
import { School } from "../models/School";
import { User } from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { clearActiveSchoolCookie, clearAuthCookie, setActiveSchoolCookie, setAuthCookie, signJwt } from "../utils/jwt";
import { sendSuccess } from "../utils/response";

const getRedirectPath = (role: UserRole): string => {
  switch (role) {
    case "SUPER_ADMIN":
      return "/dashboard/super_admin";
    case "SCHOOL_ADMIN":
      return "/dashboard/school_admin";
    case "TEACHER":
      return "/dashboard/teacher";
    case "STUDENT":
      return "/my-subjects";
    case "LIBRARY_STAFF":
      return "/library";
    case "LABORATORY_STAFF":
      return "/laboratory";
    case "ACCOUNTANT":
      return "/accounting";
    case "PARENT":
    default:
      return "/dashboard/parent";
  }
};

const getAccessibleSchools = async (user: { role: UserRole; schoolId?: unknown }): Promise<SchoolRecord[]> => {
  if (user.role === "SUPER_ADMIN") {
    return (await School.find().sort({ name: 1 }).lean()) as unknown as SchoolRecord[];
  }

  if (!user.schoolId) {
    return [];
  }

  const school = await School.findById(user.schoolId).lean();
  return school ? ([school] as unknown as SchoolRecord[]) : [];
};

const getSafeUser = async (userId: string) => {
  const user = await User.findById(userId).select("-password").populate("schoolId").lean();

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const populatedSchool =
    user.schoolId && typeof user.schoolId === "object" && "_id" in user.schoolId
      ? (user.schoolId as unknown as SchoolRecord)
      : null;

  return {
    _id: user._id.toString(),
    schoolId: populatedSchool?._id?.toString() ?? (user.schoolId ? String(user.schoolId) : undefined),
    school: populatedSchool,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    phone: user.phone,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword
  };
};

const buildAuthResponse = async (userId: string, activeSchoolId?: string | null): Promise<AuthResponse> => {
  const safeUser = await getSafeUser(userId);
  const availableSchools = await getAccessibleSchools(safeUser);
  const resolvedActiveSchoolId = activeSchoolId ?? (safeUser.schoolId ? String(safeUser.schoolId) : null);

  return {
    user: safeUser,
    redirectTo: getRedirectPath(safeUser.role),
    activeSchoolId: resolvedActiveSchoolId,
    availableSchools
  };
};

export const register = asyncHandler(async (req: Request, res: Response) => {
  const payload = registerSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const [existingUser, school] = await Promise.all([User.findOne({ email }), School.findById(payload.schoolId)]);

  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists");
  }

  if (!school || !school.isActive) {
    throw new ApiError(404, "Selected school is not available for registration");
  }

  const user = await User.create({
    schoolId: school._id,
    fullName: payload.fullName,
    email,
    password: payload.password,
    phone: payload.phone,
    role: payload.role
  });

  const token = signJwt({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
    schoolId: school._id.toString()
  });

  setAuthCookie(res, token);
  setActiveSchoolCookie(res, school._id.toString());

  return sendSuccess(res, "Registration successful", await buildAuthResponse(user._id.toString(), school._id.toString()), 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const payload = loginSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const user = await User.findOne({ email });

  if (!user || !(await user.comparePassword(payload.password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (!user.isActive) {
    throw new ApiError(403, "This account is disabled");
  }

  if (user.role !== "SUPER_ADMIN") {
    const school = await School.findById(user.schoolId);
    if (!school || !school.isActive) {
      throw new ApiError(403, "This school is inactive");
    }
    setActiveSchoolCookie(res, school._id.toString());
  } else {
    clearActiveSchoolCookie(res);
  }

  const token = signJwt({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
    schoolId: user.schoolId ? user.schoolId.toString() : null
  });

  setAuthCookie(res, token);

  return sendSuccess(
    res,
    "Login successful",
    await buildAuthResponse(user._id.toString(), user.role === "SUPER_ADMIN" ? null : user.schoolId?.toString() ?? null)
  );
});

export const switchActiveSchool = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  if (req.user.role !== "SUPER_ADMIN") {
    if (!req.user.schoolId) {
      throw new ApiError(400, "No school assigned to this account");
    }

    setActiveSchoolCookie(res, req.user.schoolId);
    const school = await School.findById(req.user.schoolId).lean();
    return sendSuccess(res, "Active school set", {
      activeSchoolId: req.user.schoolId,
      school
    });
  }

  const payload = activeSchoolSchema.parse(req.body);
  const school = await School.findById(payload.schoolId).lean();

  if (!school || !school.isActive) {
    throw new ApiError(404, "Selected school was not found");
  }

  setActiveSchoolCookie(res, school._id.toString());

  return sendSuccess(res, "Active school set", {
    activeSchoolId: school._id.toString(),
    school
  });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  clearActiveSchoolCookie(res);
  return sendSuccess(res, "Logged out successfully");
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const activeSchoolId =
    req.user.role === "SUPER_ADMIN"
      ? ((req.cookies?.[env.ACTIVE_SCHOOL_COOKIE_NAME] as string | undefined) ?? null)
      : (req.user.schoolId ?? null);

  return sendSuccess(res, "Current user fetched", await buildAuthResponse(req.user.userId, activeSchoolId));
});
