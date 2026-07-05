import type { Request, Response } from "express";
import type { Types } from "mongoose";
import {
  adminAccountSchema,
  adminAccountUpdateSchema,
  adminPasswordResetSchema,
  sanitizeUserDisplayName,
  type AdminAccountRecord,
  type AuthResponse
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildAdminListFilter,
  fromDeletedAdminEmail,
  isSoftDeletedAdminEmail,
  restoreDeletedAdminEmail,
  toDeletedAdminEmail
} from "../utils/adminAccount.js";
import { recordAudit } from "../utils/audit.js";
import { resolveInstitutionSchoolId } from "../utils/institutionSchool.js";
import { setActiveSchoolCookie, setAuthCookie, signJwt } from "../utils/jwt.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

type UserLean = {
  _id: Types.ObjectId;
  schoolId?: Types.ObjectId | null;
  fullName: string;
  email: string;
  phone?: string;
  role: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

const serializeAdmin = (user: UserLean): AdminAccountRecord => {
  const isDeleted = isSoftDeletedAdminEmail(user.email);
  const loginEmail = isDeleted ? fromDeletedAdminEmail(user.email) : user.email;

  return {
    _id: user._id.toString(),
    schoolId: user.schoolId?.toString(),
    fullName: sanitizeUserDisplayName(user.fullName),
    email: loginEmail,
    loginEmail,
    phone: user.phone,
    role: user.role as AdminAccountRecord["role"],
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    isDeleted,
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString()
  };
};

const getInstitutionSchoolObjectId = async (req: Request) => {
  const schoolId = tenantObjectId(req);
  const institutionSchoolId = await resolveInstitutionSchoolId();

  if (schoolId.toString() !== institutionSchoolId) {
    throw new ApiError(403, "Admin management is limited to the institution context");
  }

  return schoolId;
};

const findManagedAdmin = async (req: Request, adminId: string) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const admin = await User.findOne({
    _id: adminId,
    schoolId,
    role: "COLLEGE_ADMIN"
  });

  if (!admin) {
    throw new ApiError(404, "College Administrator account not found");
  }

  return admin;
};

const ensureNotDeleted = (admin: { email: string }) => {
  if (isSoftDeletedAdminEmail(admin.email)) {
    throw new ApiError(400, "This administrator account has been deleted");
  }
};

const getRedirectPath = (): string => "/dashboard/college_admin";

export const listAdmins = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const includeDeleted = req.query.includeDeleted === "true";

  const admins = await User.find(buildAdminListFilter(schoolId, includeDeleted))
    .select("-password")
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(
    res,
    "College Administrator accounts fetched",
    (admins as UserLean[]).map(serializeAdmin)
  );
});

export const getAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  return sendSuccess(res, "College Administrator account fetched", serializeAdmin(admin as UserLean));
});

export const createAdmin = asyncHandler(async (req: Request, res: Response) => {
  const payload = adminAccountSchema.parse(req.body);
  const schoolId = await getInstitutionSchoolObjectId(req);
  const email = payload.email.toLowerCase().trim();

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(409, "An account with this login ID already exists");
  }

  const password = payload.password ?? env.DEFAULT_USER_PASSWORD;

  try {
    const admin = await User.create({
      schoolId,
      fullName: payload.fullName,
      email,
      phone: payload.phone,
      password,
      role: "COLLEGE_ADMIN",
      isActive: true,
      mustChangePassword: true
    });

    await recordAudit(req, {
      action: "admin.create",
      entity: "User",
      entityId: admin._id.toString(),
      after: serializeAdmin(admin as UserLean)
    });

    return sendSuccess(
      res,
      "College Administrator account created",
      {
        admin: serializeAdmin(admin as UserLean),
        loginEmail: email,
        defaultPassword: password
      },
      201
    );
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }
});

export const updateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const payload = adminAccountUpdateSchema.parse(req.body);
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);

  if (payload.email) {
    const nextEmail = payload.email.toLowerCase().trim();
    const duplicate = await User.findOne({ email: nextEmail, _id: { $ne: admin._id } });
    if (duplicate) {
      throw new ApiError(409, "An account with this login ID already exists");
    }
    admin.email = nextEmail;
  }

  if (payload.fullName) {
    admin.fullName = payload.fullName;
  }

  if (payload.phone !== undefined) {
    admin.phone = payload.phone;
  }

  if (payload.password) {
    admin.password = payload.password;
    admin.mustChangePassword = false;
  }

  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.update",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account updated", after);
});

export const activateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.isActive = true;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.activate",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account activated", after);
});

export const deactivateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.isActive = false;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.deactivate",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account deactivated", after);
});

export const lockAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.isActive = false;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.lock",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account locked", after);
});

export const unlockAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.isActive = true;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.unlock",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account unlocked", after);
});

export const resetAdminPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = adminPasswordResetSchema.parse(req.body);
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.password = payload.password;
  admin.mustChangePassword = payload.mustChangePassword;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.reset_password",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after: { ...after, password: "[redacted]" }
  });

  return sendSuccess(res, "College Administrator password reset", {
    admin: after,
    loginEmail: after.email
  });
});

export const softDeleteAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeAdmin(admin as UserLean);
  admin.email = toDeletedAdminEmail(admin._id, admin.email);
  admin.isActive = false;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.soft_delete",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account deleted", after);
});

export const getAdminActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  const schoolId = await getInstitutionSchoolObjectId(req);

  const logs = await AuditLog.find({
    schoolId,
    $or: [{ actorUserId: admin._id }, { entity: "User", entityId: admin._id.toString() }]
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return sendSuccess(
    res,
    "Administrator activity logs fetched",
    logs.map((entry) => ({
      _id: entry._id.toString(),
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      actorRole: entry.actorRole,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt?.toISOString() ?? new Date().toISOString()
    }))
  );
});

export const restoreAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));

  if (!isSoftDeletedAdminEmail(admin.email)) {
    throw new ApiError(400, "This administrator account is not deleted");
  }

  const before = serializeAdmin(admin as UserLean);
  const restoredEmail = restoreDeletedAdminEmail(admin.email);
  const duplicate = await User.findOne({ email: restoredEmail, _id: { $ne: admin._id } });
  if (duplicate) {
    throw new ApiError(409, "Another account already uses this login ID");
  }

  admin.email = restoredEmail;
  admin.isActive = true;
  await admin.save();

  const after = serializeAdmin(admin as UserLean);
  await recordAudit(req, {
    action: "admin.restore",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account restored", after);
});

export const impersonateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedAdmin(req, String(req.params.id));
  ensureNotDeleted(admin);

  if (!admin.isActive) {
    throw new ApiError(400, "Cannot impersonate an inactive administrator account");
  }

  const token = signJwt({
    userId: admin._id.toString(),
    role: "COLLEGE_ADMIN",
    email: admin.email,
    schoolId: admin.schoolId?.toString() ?? null
  });

  setAuthCookie(res, token);
  if (admin.schoolId) {
    setActiveSchoolCookie(res, admin.schoolId.toString());
  }

  await recordAudit(req, {
    action: "admin.impersonate",
    entity: "User",
    entityId: admin._id.toString(),
    after: {
      impersonatedAdminId: admin._id.toString(),
      impersonatedAdminEmail: fromDeletedAdminEmail(admin.email)
    }
  });

  const response: AuthResponse = {
    user: serializeAdmin(admin as UserLean),
    redirectTo: getRedirectPath(),
    activeSchoolId: admin.schoolId?.toString() ?? null,
    availableSchools: []
  };

  return sendSuccess(res, "Impersonation session started", response);
});