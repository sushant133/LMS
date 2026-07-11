import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  activeSchoolSchema,
  expandModuleAccessMap,
  getInstitutionPermissions,
  loginSchema,
  normalizeUserRole,
  parentSelfRegisterSchema,
  sanitizeUserDisplayName,
  selfPasswordChangeSchema,
  selfProfileUpdateSchema,
  type AuthResponse,
  type ModuleAccessMap,
  type SchoolRecord,
  type UserRole
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { School } from "../models/School.js";
import { Student } from "../models/Student.js";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { resolveInstitutionSchool, resolveInstitutionSchoolId } from "../utils/institutionSchool.js";
import { clearActiveSchoolCookie, clearAuthCookie, setActiveSchoolCookie, setAuthCookie, signJwt } from "../utils/jwt.js";
import { sendSuccess } from "../utils/response.js";

const getRedirectPath = (role: UserRole | string): string => {
  switch (normalizeUserRole(role)) {
    case "SUPER_ADMIN":
      return "/dashboard/super_admin";
    case "COLLEGE_ADMIN":
    case "COLLEGE_VIEWER":
      return "/dashboard/college_admin";
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
    case "COLLEGE_STAFF":
      return "/dashboard/college_staff";
    case "PARENT":
    default:
      return "/dashboard/parent";
  }
};

const getAccessibleSchools = async (user: { role: UserRole; schoolId?: unknown }): Promise<SchoolRecord[]> => {
  if (user.role === "SUPER_ADMIN") {
    const school = await resolveInstitutionSchool();
    return school ? ([school] as unknown as SchoolRecord[]) : [];
  }

  if (!user.schoolId) {
    return [];
  }

  const school = await School.findById(user.schoolId).lean();
  return school ? ([school] as unknown as SchoolRecord[]) : [];
};

const mapModuleAccess = (raw: unknown): ModuleAccessMap => {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries()) as ModuleAccessMap;
  if (typeof raw === "object") return { ...(raw as ModuleAccessMap) };
  return {};
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

  const moduleAccess = expandModuleAccessMap(mapModuleAccess((user as { moduleAccess?: unknown }).moduleAccess));

  return {
    _id: user._id.toString(),
    schoolId: populatedSchool?._id?.toString() ?? (user.schoolId ? String(user.schoolId) : undefined),
    school: populatedSchool,
    fullName: sanitizeUserDisplayName(user.fullName),
    email: user.email,
    role: normalizeUserRole(user.role as string),
    phone: user.phone,
    employeeId: user.employeeId,
    designation: user.designation,
    department: user.department,
    profilePhotoUrl: user.profilePhotoUrl,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    moduleAccess
  };
};

const buildAuthResponse = async (userId: string, activeSchoolId?: string | null): Promise<AuthResponse> => {
  const safeUser = await getSafeUser(userId);
  const availableSchools = await getAccessibleSchools(safeUser);
  const resolvedActiveSchoolId =
    safeUser.role === "SUPER_ADMIN"
      ? (activeSchoolId ?? (await resolveInstitutionSchoolId()))
      : (activeSchoolId ?? (safeUser.schoolId ? String(safeUser.schoolId) : null));

  return {
    user: safeUser,
    permissions: getInstitutionPermissions(safeUser.role),
    moduleAccess: safeUser.moduleAccess,
    redirectTo: getRedirectPath(safeUser.role),
    activeSchoolId: resolvedActiveSchoolId,
    availableSchools
  };
};

export const register = asyncHandler(async (req: Request, res: Response) => {
  const payload = parentSelfRegisterSchema.parse(req.body);
  const loginId = payload.email.toLowerCase().trim();
  const [existingUser, school, student] = await Promise.all([
    User.findOne({ email: loginId }),
    School.findById(payload.schoolId),
    Student.findOne({
      schoolId: payload.schoolId,
      admissionNumber: {
        $regex: new RegExp(`^${payload.studentRegistrationNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      }
    })
      .populate("user", "fullName")
      .lean()
  ]);

  if (!school || !school.isActive) {
    throw new ApiError(404, "Selected college is not available for registration");
  }

  if (!student) {
    throw new ApiError(404, "No student found with this registration number. Please verify and try again.");
  }

  if (existingUser) {
    if (existingUser.isActive) {
      throw new ApiError(409, "An account with this login ID already exists. Please sign in or use a different login ID.");
    }

    const pendingLink = await ParentChildLink.findOne({
      schoolId: school._id,
      parentUserId: existingUser._id,
      status: "PENDING"
    }).lean();

    if (pendingLink) {
      throw new ApiError(409, "A registration with this login ID is already pending admin approval.");
    }
  }

  const existingPendingForStudent = await ParentChildLink.findOne({
    schoolId: school._id,
    studentId: student._id,
    relationship: payload.relationship,
    status: "PENDING"
  }).lean();

  if (existingPendingForStudent) {
    throw new ApiError(409, "A parent registration for this student and relationship is already pending approval.");
  }

  const approvedDuplicate = await ParentChildLink.findOne({
    schoolId: school._id,
    studentId: student._id,
    relationship: payload.relationship,
    status: "APPROVED"
  }).lean();

  if (approvedDuplicate) {
    throw new ApiError(409, "A parent is already linked for this student with the selected relationship.");
  }

  const user =
    existingUser ??
    (await User.create({
      schoolId: school._id,
      fullName: payload.fullName,
      email: loginId,
      password: payload.password,
      phone: payload.phone,
      role: "PARENT",
      isActive: false
    }));

  if (existingUser) {
    existingUser.fullName = payload.fullName;
    existingUser.phone = payload.phone;
    existingUser.password = payload.password;
    existingUser.isActive = false;
    await existingUser.save();
  }

  await ParentChildLink.create({
    schoolId: school._id,
    parentUserId: user._id,
    studentId: student._id,
    relationship: payload.relationship,
    isPrimary: payload.relationship === "GUARDIAN",
    status: "PENDING",
    studentRegistrationNumber: payload.studentRegistrationNumber
  });

  return sendSuccess(
    res,
    "Registration submitted for admin approval",
    {
      pending: true,
      message:
        "Your parent account has been created and is pending verification. You can sign in after the college administrator approves your registration in Parent Links.",
      redirectTo: "/login",
      studentRegistrationNumber: payload.studentRegistrationNumber,
      studentName: (student.user as { fullName?: string } | undefined)?.fullName ?? ""
    },
    201
  );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const payload = loginSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const user = await User.findOne({ email });

  if (!user || !(await user.comparePassword(payload.password))) {
    // Constant-looking message; never reveal whether the email exists
    await recordAudit(req, {
      action: "auth.login_failed",
      entity: "USER",
      entityId: user?._id?.toString() ?? "unknown",
      after: { email }
    }).catch(() => undefined);
    throw new ApiError(401, "Invalid login ID or password");
  }

  if (!user.isActive) {
    if (normalizeUserRole(user.role as string) === "PARENT") {
      const pendingLink = await ParentChildLink.findOne({
        schoolId: user.schoolId,
        parentUserId: user._id,
        status: "PENDING"
      }).lean();

      if (pendingLink) {
        throw new ApiError(
          403,
          "Your parent registration is pending admin approval. Please wait until the college administrator approves your account."
        );
      }

      const rejectedLink = await ParentChildLink.findOne({
        schoolId: user.schoolId,
        parentUserId: user._id,
        status: "REJECTED"
      })
        .sort({ reviewedAt: -1 })
        .lean();

      if (rejectedLink) {
        throw new ApiError(
          403,
          rejectedLink.rejectionReason
            ? `Your parent registration was not approved: ${rejectedLink.rejectionReason}`
            : "Your parent registration was not approved. Please contact the college administration."
        );
      }
    }

    throw new ApiError(403, "This account is disabled");
  }

  if ((user.role as string) === "SCHOOL_ADMIN") {
    user.role = "COLLEGE_ADMIN";
    await user.save();
  }

  const normalizedRole = normalizeUserRole(user.role as string);

  if (normalizedRole !== "SUPER_ADMIN") {
    const school = await School.findById(user.schoolId);
    if (!school || !school.isActive) {
      throw new ApiError(403, "This college is inactive");
    }
    setActiveSchoolCookie(res, school._id.toString());
  } else {
    const institutionSchoolId = await resolveInstitutionSchoolId();
    setActiveSchoolCookie(res, institutionSchoolId);
  }

  const token = signJwt({
    userId: user._id.toString(),
    role: normalizedRole,
    email: user.email,
    schoolId: user.schoolId ? user.schoolId.toString() : null
  });

  setAuthCookie(res, token);

  if (user.schoolId) {
    await AuditLog.create({
      schoolId: user.schoolId,
      actorUserId: user._id,
      actorRole: normalizedRole,
      action: "auth.login",
      entity: "User",
      entityId: user._id.toString(),
      after: { email: user.email },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || ""
    });
  }

  return sendSuccess(
    res,
    "Login successful",
    await buildAuthResponse(
      user._id.toString(),
      normalizedRole === "SUPER_ADMIN" ? await resolveInstitutionSchoolId() : (user.schoolId?.toString() ?? null)
    )
  );
});

export const switchActiveSchool = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  if (req.user.role !== "SUPER_ADMIN") {
    if (!req.user.schoolId) {
      throw new ApiError(400, "No college assigned to this account");
    }

    setActiveSchoolCookie(res, req.user.schoolId);
    const school = await School.findById(req.user.schoolId).lean();
    return sendSuccess(res, "Active college set", {
      activeSchoolId: req.user.schoolId,
      school
    });
  }

  activeSchoolSchema.parse(req.body);
  const institutionSchoolId = await resolveInstitutionSchoolId();
  const school = await School.findById(institutionSchoolId).lean();

  if (!school || !school.isActive) {
    throw new ApiError(404, "Institution was not found");
  }

  setActiveSchoolCookie(res, institutionSchoolId);

  return sendSuccess(res, "Active college set", {
    activeSchoolId: institutionSchoolId,
    school
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[env.COOKIE_NAME] as string | undefined;

  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; role: string; schoolId?: string | null };
      if (decoded.schoolId) {
        await AuditLog.create({
          schoolId: decoded.schoolId,
          actorUserId: decoded.userId,
          actorRole: decoded.role,
          action: "auth.logout",
          entity: "User",
          entityId: decoded.userId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent") || ""
        }).catch(() => undefined);
      }
    } catch {
      // Ignore invalid/expired tokens during logout.
    }
  }

  clearAuthCookie(res);
  clearActiveSchoolCookie(res);
  return sendSuccess(res, "Logged out successfully");
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const payload = selfProfileUpdateSchema.parse(req.body);
  const user = await User.findById(req.user.userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (payload.fullName) user.fullName = payload.fullName;
  if (payload.phone) user.phone = payload.phone;
  if (payload.profilePhotoUrl !== undefined) {
    user.profilePhotoUrl = payload.profilePhotoUrl || undefined;
  }

  await user.save();
  await recordAudit(req, {
    action: "auth.profile_update",
    entity: "User",
    entityId: user._id.toString(),
    after: { fullName: user.fullName, phone: user.phone, profilePhotoUrl: user.profilePhotoUrl }
  });

  return sendSuccess(res, "Profile updated", await buildAuthResponse(user._id.toString(), req.user.schoolId ?? null));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const payload = selfPasswordChangeSchema.parse(req.body);
  const user = await User.findById(req.user.userId);

  if (!user || !(await user.comparePassword(payload.currentPassword))) {
    throw new ApiError(401, "Current password is incorrect");
  }

  user.password = payload.newPassword;
  user.mustChangePassword = false;
  await user.save();

  await recordAudit(req, {
    action: "auth.password_change",
    entity: "User",
    entityId: user._id.toString()
  });

  return sendSuccess(res, "Password changed successfully");
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const activeSchoolId =
    req.user.role === "SUPER_ADMIN"
      ? ((req.cookies?.[env.ACTIVE_SCHOOL_COOKIE_NAME] as string | undefined) ??
        (await resolveInstitutionSchoolId()))
      : (req.user.schoolId ?? null);

  return sendSuccess(res, "Current user fetched", await buildAuthResponse(req.user.userId, activeSchoolId));
});
