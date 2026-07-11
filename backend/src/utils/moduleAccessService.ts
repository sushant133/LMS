import type { Request } from "express";
import {
  canManageInstitution,
  expandModuleAccessMap,
  MODULE_ACCESS_DISABLED_MESSAGE,
  resolveModuleFromApiPath,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";
import { recordAudit } from "./audit.js";

const mapFromUserDoc = (raw: unknown): ModuleAccessMap => {
  if (!raw) return {};
  if (raw instanceof Map) {
    return Object.fromEntries(raw.entries()) as ModuleAccessMap;
  }
  if (typeof raw === "object") {
    return { ...(raw as ModuleAccessMap) };
  }
  return {};
};

export const getUserModuleAccessMap = async (userId: string): Promise<ModuleAccessMap> => {
  const user = await User.findById(userId).select("moduleAccess role").lean();
  if (!user) return {};
  // Institution admins always have full write at resolution time
  if (canManageInstitution(user.role)) {
    return expandModuleAccessMap({});
  }
  return mapFromUserDoc(user.moduleAccess);
};

export const getExpandedModuleAccessForUser = async (
  userId: string,
  role?: string
): Promise<Record<ErpModuleKey, ModuleAccessMode>> => {
  if (role && canManageInstitution(role)) {
    return expandModuleAccessMap({});
  }
  const map = await getUserModuleAccessMap(userId);
  return expandModuleAccessMap(map);
};

export const assertModuleWriteAccess = async (
  req: Request,
  moduleKey: ErpModuleKey
): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (canManageInstitution(req.user.role)) return;

  const map = await getUserModuleAccessMap(req.user.userId);
  if (map[moduleKey] === "READ_ONLY") {
    throw new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE);
  }
};

export const updateUserModuleAccess = async (
  req: Request,
  userId: string,
  nextAccess: ModuleAccessMap
): Promise<Record<ErpModuleKey, ModuleAccessMode>> => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  // Scope: same school (super admin can edit anyone)
  if (req.user?.role !== "SUPER_ADMIN") {
    const tenantId = req.tenantSchoolId ?? req.user?.schoolId;
    if (!user.schoolId || user.schoolId.toString() !== String(tenantId)) {
      throw new ApiError(403, "You can only manage module access for users in your institution");
    }
  }

  // Never lock out institution admins via module access
  if (canManageInstitution(user.role)) {
    throw new ApiError(400, "Module access cannot be restricted for institution administrators");
  }

  const previous = mapFromUserDoc(user.moduleAccess);
  // Store as plain object; Mongoose Map accepts object assignment
  user.set("moduleAccess", nextAccess);
  user.markModified("moduleAccess");
  await user.save();

  await recordAudit(req, {
    action: "user.module_access.update",
    entity: "USER",
    entityId: userId,
    before: { moduleAccess: previous },
    after: {
      moduleAccess: nextAccess,
      fullName: user.fullName,
      employeeId: user.employeeId,
      email: user.email
    }
  });

  return expandModuleAccessMap(nextAccess);
};

/** Paths that remain allowed even when modules are read-only (self-service). */
export const isModuleAccessBypassPath = (method: string, originalUrl: string): boolean => {
  const path = originalUrl.split("?")[0] ?? originalUrl;
  if (method === "POST" && /\/api\/auth\/logout$/.test(path)) return true;
  if (method === "PUT" && /\/api\/auth\/profile$/.test(path)) return true;
  if (method === "POST" && /\/api\/auth\/change-password$/.test(path)) return true;
  // Module-access admin endpoints
  if (/\/api\/users\/[^/]+\/module-access$/.test(path)) return true;
  return false;
};

export const resolveModuleForRequest = (req: Request): ErpModuleKey | null =>
  resolveModuleFromApiPath(req.originalUrl || req.path || "");
