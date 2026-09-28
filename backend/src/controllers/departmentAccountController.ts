import type { NextFunction, Request, Response } from "express";
import type { Types } from "mongoose";
import {
  DEPARTMENT_ACCOUNT_LABELS,
  departmentAccountPasswordSchema,
  departmentAccountSchema,
  departmentAccountUpdateSchema,
  isDepartmentAccountType,
  sanitizeUserDisplayName,
  type DepartmentAccountRecord
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { isSoftDeletedAdminEmail, toDeletedAdminEmail } from "../utils/adminAccount.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { resolveInstitutionSchoolId } from "../utils/institutionSchool.js";
import { invalidatePermissionCache } from "../utils/moduleAccessService.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

type UserLean = {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  phone?: string;
  departmentAccount?: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

const serializeDepartmentAccount = (user: UserLean): DepartmentAccountRecord => {
  const departmentType = isDepartmentAccountType(user.departmentAccount)
    ? user.departmentAccount
    : "ACADEMICS";
  return {
    _id: user._id.toString(),
    departmentType,
    departmentLabel: DEPARTMENT_ACCOUNT_LABELS[departmentType],
    fullName: sanitizeUserDisplayName(user.fullName),
    email: user.email,
    phone: user.phone || undefined,
    isActive: user.isActive,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString()
  };
};

/** Only the institution Administrator / System Administrator — never another Department Account. */
export const requireDepartmentAccountManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) return next(new ApiError(401, "Authentication required"));
  if (req.user.departmentAccount) {
    return next(new ApiError(403, "Department Accounts cannot manage other accounts"));
  }
  if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "COLLEGE_ADMIN") {
    return next(new ApiError(403, "Administrator access required"));
  }
  next();
};

const getInstitutionSchoolObjectId = async (req: Request) => {
  const schoolId = tenantObjectId(req);
  const institutionSchoolId = await resolveInstitutionSchoolId();

  if (schoolId.toString() !== institutionSchoolId) {
    throw new ApiError(403, "Department Account management is limited to the institution context");
  }

  return schoolId;
};

const findDepartmentAccount = async (req: Request, accountId: string) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const account = await User.findOne({
    _id: accountId,
    schoolId,
    role: "COLLEGE_ADMIN",
    departmentAccount: { $ne: null }
  });

  if (!account || isSoftDeletedAdminEmail(account.email)) {
    throw new ApiError(404, "Department Account not found");
  }

  return account;
};

const ensureLoginIdAvailable = async (email: string, exceptId?: Types.ObjectId) => {
  const duplicate = await User.findOne(exceptId ? { email, _id: { $ne: exceptId } } : { email })
    .select("_id")
    .lean();
  if (duplicate) {
    throw new ApiError(409, "An account with this email / login ID already exists");
  }
};

export const listDepartmentAccounts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = await getInstitutionSchoolObjectId(req);
  const accounts = await User.find({
    schoolId,
    role: "COLLEGE_ADMIN",
    departmentAccount: { $ne: null },
    email: { $not: /^deleted\.[a-f\d]{24}\./i }
  })
    .select("fullName email phone departmentAccount isActive mustChangePassword createdAt updatedAt")
    .sort({ departmentAccount: 1, createdAt: 1 })
    .lean();

  return sendSuccess(
    res,
    "Department accounts fetched",
    (accounts as UserLean[]).map(serializeDepartmentAccount)
  );
});

export const createDepartmentAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = departmentAccountSchema.parse(req.body);
  const schoolId = await getInstitutionSchoolObjectId(req);
  const email = payload.email.toLowerCase().trim();

  await ensureLoginIdAvailable(email);

  try {
    const account = await User.create({
      schoolId,
      fullName: payload.fullName,
      email,
      phone: payload.phone,
      password: payload.password,
      role: "COLLEGE_ADMIN",
      departmentAccount: payload.departmentType,
      isActive: true,
      mustChangePassword: payload.mustChangePassword
    });

    const record = serializeDepartmentAccount(account as unknown as UserLean);
    await recordAudit(req, {
      action: "department_account.create",
      entity: "User",
      entityId: account._id.toString(),
      after: record
    });

    return sendSuccess(res, `${record.departmentLabel} account created`, record, 201);
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }
});

export const updateDepartmentAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = departmentAccountUpdateSchema.parse(req.body);
  const account = await findDepartmentAccount(req, String(req.params.id));
  const before = serializeDepartmentAccount(account as unknown as UserLean);

  if (payload.email) {
    const nextEmail = payload.email.toLowerCase().trim();
    if (nextEmail !== account.email) {
      await ensureLoginIdAvailable(nextEmail, account._id);
      account.email = nextEmail;
    }
  }
  if (payload.fullName) account.fullName = payload.fullName;
  if (payload.phone !== undefined) account.phone = payload.phone || undefined;

  try {
    await account.save();
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }

  const after = serializeDepartmentAccount(account as unknown as UserLean);
  await recordAudit(req, {
    action: "department_account.update",
    entity: "User",
    entityId: account._id.toString(),
    before,
    after
  });

  return sendSuccess(res, "Department account updated", after);
});

export const changeDepartmentAccountPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = departmentAccountPasswordSchema.parse(req.body);
  const account = await findDepartmentAccount(req, String(req.params.id));

  account.password = payload.password;
  account.mustChangePassword = payload.mustChangePassword;
  await account.save();

  const after = serializeDepartmentAccount(account as unknown as UserLean);
  await recordAudit(req, {
    action: "department_account.change_password",
    entity: "User",
    entityId: account._id.toString(),
    after: { ...after, password: "[redacted]" }
  });

  return sendSuccess(res, "Password changed", after);
});

const setDepartmentAccountActive = (isActive: boolean) =>
  asyncHandler(async (req: Request, res: Response) => {
    const account = await findDepartmentAccount(req, String(req.params.id));
    const before = serializeDepartmentAccount(account as unknown as UserLean);

    account.isActive = isActive;
    await account.save();
    invalidatePermissionCache(account._id.toString());

    const after = serializeDepartmentAccount(account as unknown as UserLean);
    await recordAudit(req, {
      action: isActive ? "department_account.activate" : "department_account.deactivate",
      entity: "User",
      entityId: account._id.toString(),
      before,
      after
    });

    return sendSuccess(res, isActive ? "Department account activated" : "Department account deactivated", after);
  });

export const activateDepartmentAccount = setDepartmentAccountActive(true);
export const deactivateDepartmentAccount = setDepartmentAccountActive(false);

export const deleteDepartmentAccount = asyncHandler(async (req: Request, res: Response) => {
  const account = await findDepartmentAccount(req, String(req.params.id));
  const before = serializeDepartmentAccount(account as unknown as UserLean);

  // Soft delete (same as Admin Management): frees the login ID but keeps the
  // user document so vouchers / audit entries it created still show its name.
  account.email = toDeletedAdminEmail(account._id, account.email);
  account.isActive = false;
  await account.save();
  invalidatePermissionCache(account._id.toString());

  await recordAudit(req, {
    action: "department_account.delete",
    entity: "User",
    entityId: account._id.toString(),
    before
  });

  return sendSuccess(res, "Department account deleted", before);
});
