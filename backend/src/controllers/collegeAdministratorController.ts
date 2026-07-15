import type { Request, Response } from "express";
import type { Types } from "mongoose";
import {
  collegeAdministratorSchema,
  collegeAdministratorUpdateSchema,
  adminPasswordResetSchema,
  sanitizeUserDisplayName,
  type CollegeAdministratorRecord
} from "@phit-erp/shared";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildCollegeViewerListFilter,
  fromDeletedAdminEmail,
  isSoftDeletedAdminEmail,
  restoreDeletedAdminEmail,
  toDeletedAdminEmail
} from "../utils/collegeViewerAccount.js";
import { recordAudit } from "../utils/audit.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { resolveInstitutionSchoolId } from "../utils/institutionSchool.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

type UserLean = {
  _id: Types.ObjectId;
  schoolId?: Types.ObjectId | null;
  fullName: string;
  email: string;
  phone?: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  profilePhotoUrl?: string;
  role: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

const serializeCollegeAdministrator = (user: UserLean): CollegeAdministratorRecord => {
  const isDeleted = isSoftDeletedAdminEmail(user.email);
  const loginEmail = isDeleted ? fromDeletedAdminEmail(user.email) : user.email;

  return {
    _id: user._id.toString(),
    schoolId: user.schoolId?.toString(),
    fullName: sanitizeUserDisplayName(user.fullName),
    email: loginEmail,
    loginEmail,
    phone: user.phone,
    employeeId: user.employeeId,
    designation: user.designation,
    department: user.department,
    profilePhotoUrl: user.profilePhotoUrl,
    role: user.role as CollegeAdministratorRecord["role"],
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
    throw new ApiError(403, "College Administrator management is limited to the institution context");
  }

  return schoolId;
};

const findManagedCollegeAdministrator = async (req: Request, adminId: string) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const admin = await User.findOne({
    _id: adminId,
    schoolId,
    role: "COLLEGE_VIEWER"
  });

  if (!admin) {
    throw new ApiError(404, "College Administrator account not found");
  }

  return admin;
};

const ensureNotDeleted = (admin: { email: string }) => {
  if (isSoftDeletedAdminEmail(admin.email)) {
    throw new ApiError(400, "This College Administrator account has been deleted");
  }
};

export const listCollegeAdministrators = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const includeDeleted = req.query.includeDeleted === "true";

  const admins = await User.find(buildCollegeViewerListFilter(schoolId, includeDeleted))
    .select("-password")
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(
    res,
    "College Administrator accounts fetched",
    (admins as UserLean[]).map(serializeCollegeAdministrator)
  );
});

export const getCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  return sendSuccess(res, "College Administrator account fetched", serializeCollegeAdministrator(admin as UserLean));
});

export const createCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeAdministratorSchema.parse(req.body);
  const schoolId = await getInstitutionSchoolObjectId(req);
  const email = payload.email.toLowerCase().trim();

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(409, "An account with this login ID already exists");
  }

  const { password } = resolvePortalPassword(payload.password);

  try {
    const admin = await User.create({
      schoolId,
      fullName: payload.fullName,
      email,
      phone: payload.phone,
      employeeId: payload.employeeId,
      designation: payload.designation,
      department: payload.department,
      profilePhotoUrl: payload.profilePhotoUrl || undefined,
      password,
      role: "COLLEGE_VIEWER",
      isActive: true,
      mustChangePassword: true
    });

    await recordAudit(req, {
      action: "college_administrator.create",
      entity: "User",
      entityId: admin._id.toString(),
      after: serializeCollegeAdministrator(admin as UserLean)
    });

    const credentialsEmail = await notifyAccountCredentials({
      userId: admin._id.toString(),
      fullName: payload.fullName,
      email,
      password,
      schoolId: schoolId.toString(),
      req,
      accountKind: "ADMIN"
    });

    return sendSuccess(
      res,
      buildCredentialsAdminMessage(credentialsEmail),
      {
        admin: serializeCollegeAdministrator(admin as UserLean),
        loginEmail: email,
        defaultPassword: password,
        credentialsEmail
      },
      201
    );
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }
});

export const updateCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeAdministratorUpdateSchema.parse(req.body);
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeCollegeAdministrator(admin as UserLean);

  if (payload.email) {
    const nextEmail = payload.email.toLowerCase().trim();
    const duplicate = await User.findOne({ email: nextEmail, _id: { $ne: admin._id } });
    if (duplicate) {
      throw new ApiError(409, "An account with this login ID already exists");
    }
    admin.email = nextEmail;
  }

  if (payload.fullName) admin.fullName = payload.fullName;
  if (payload.phone) admin.phone = payload.phone;
  if (payload.employeeId) admin.employeeId = payload.employeeId;
  if (payload.designation) admin.designation = payload.designation;
  if (payload.department) admin.department = payload.department;
  const previousPhoto = admin.profilePhotoUrl;
  if (payload.profilePhotoUrl !== undefined) {
    admin.profilePhotoUrl = payload.profilePhotoUrl || undefined;
  }

  if (payload.password) {
    admin.password = payload.password;
    admin.mustChangePassword = false;
  }

  await admin.save();

  if (payload.profilePhotoUrl !== undefined) {
    const { deleteReplacedMedia } = await import("../utils/mediaCleanup.js");
    await deleteReplacedMedia(previousPhoto, admin.profilePhotoUrl);
  }

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.update",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account updated", after);
});

export const activateCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeCollegeAdministrator(admin as UserLean);
  admin.isActive = true;
  await admin.save();

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.activate",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account activated", after);
});

export const deactivateCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeCollegeAdministrator(admin as UserLean);
  admin.isActive = false;
  await admin.save();

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.deactivate",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account deactivated", after);
});

export const resetCollegeAdministratorPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = adminPasswordResetSchema.parse(req.body);
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeCollegeAdministrator(admin as UserLean);
  admin.password = payload.password;
  admin.mustChangePassword = payload.mustChangePassword;
  await admin.save();

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.reset_password",
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

export const softDeleteCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
  ensureNotDeleted(admin);

  const before = serializeCollegeAdministrator(admin as UserLean);
  const photoToDelete = admin.profilePhotoUrl;
  admin.email = toDeletedAdminEmail(admin._id, admin.email);
  admin.isActive = false;
  admin.profilePhotoUrl = undefined;
  await admin.save();

  if (photoToDelete) {
    const { deleteStoredMediaUrl } = await import("../utils/mediaCleanup.js");
    await deleteStoredMediaUrl(photoToDelete);
  }

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.soft_delete",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account deleted", after);
});

export const restoreCollegeAdministrator = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));

  if (!isSoftDeletedAdminEmail(admin.email)) {
    throw new ApiError(400, "This College Administrator account is not deleted");
  }

  const before = serializeCollegeAdministrator(admin as UserLean);
  const restoredEmail = restoreDeletedAdminEmail(admin.email);
  const duplicate = await User.findOne({ email: restoredEmail, _id: { $ne: admin._id } });
  if (duplicate) {
    throw new ApiError(409, "Another account already uses this login ID");
  }

  admin.email = restoredEmail;
  admin.isActive = true;
  await admin.save();

  const after = serializeCollegeAdministrator(admin as UserLean);
  await recordAudit(req, {
    action: "college_administrator.restore",
    entity: "User",
    entityId: admin._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "College Administrator account restored", after);
});

export const getCollegeAdministratorActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  const admin = await findManagedCollegeAdministrator(req, String(req.params.id));
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
    "College Administrator activity logs fetched",
    logs.map((entry) => ({
      _id: entry._id.toString(),
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      actorRole: entry.actorRole,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt?.toISOString() ?? new Date().toISOString()
    }))
  );
});