import type { Request } from "express";
import {
  canManageInstitution,
  expandModuleAccessMap,
  expandModuleActionsMap,
  MODULE_ACCESS_DENIED_MESSAGE,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeModuleAccessMode,
  resolveModuleFromApiPath,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode,
  type ModuleActionsMap,
  type ModulePermissionAction,
  type UserRole
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";
import { recordAudit } from "./audit.js";

const mapFromUserDoc = (raw: unknown): ModuleAccessMap => {
  if (!raw) return {};
  if (raw instanceof Map) {
    const out: ModuleAccessMap = {};
    for (const [key, value] of raw.entries()) {
      out[key as ErpModuleKey] = normalizeModuleAccessMode(value);
    }
    return out;
  }
  if (typeof raw === "object") {
    const out: ModuleAccessMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      out[key as ErpModuleKey] = normalizeModuleAccessMode(value);
    }
    return out;
  }
  return {};
};

const actionsFromUserDoc = (raw: unknown): ModuleActionsMap => {
  if (!raw) return {};
  if (raw instanceof Map) {
    return Object.fromEntries(raw.entries()) as ModuleActionsMap;
  }
  if (typeof raw === "object") {
    return { ...(raw as ModuleActionsMap) };
  }
  return {};
};

export const getUserModuleAccessMap = async (userId: string): Promise<ModuleAccessMap> => {
  const user = await User.findById(userId).select("moduleAccess role").lean();
  if (!user) return {};
  if (canManageInstitution(user.role)) {
    return expandModuleAccessMap({});
  }
  return mapFromUserDoc(user.moduleAccess);
};

export const getUserModuleActionsMap = async (userId: string): Promise<ModuleActionsMap> => {
  const user = await User.findById(userId).select("moduleActions role").lean();
  if (!user) return {};
  if (canManageInstitution(user.role)) return {};
  return actionsFromUserDoc(user.moduleActions);
};

export const getUserSecondaryRoles = async (userId: string): Promise<UserRole[]> => {
  const user = await User.findById(userId).select("secondaryRoles").lean();
  if (!user?.secondaryRoles?.length) return [];
  return user.secondaryRoles as UserRole[];
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

export const getFullPermissionStateForUser = async (
  userId: string,
  role?: string
): Promise<{
  moduleAccess: Record<ErpModuleKey, ModuleAccessMode>;
  moduleActions: Record<ErpModuleKey, ModulePermissionAction[]>;
  secondaryRoles: UserRole[];
  designation?: string;
}> => {
  const user = await User.findById(userId)
    .select("moduleAccess moduleActions secondaryRoles designation role")
    .lean();

  if (!user) {
    return {
      moduleAccess: expandModuleAccessMap({}),
      moduleActions: expandModuleActionsMap({}, {}),
      secondaryRoles: []
    };
  }

  if (canManageInstitution(role ?? user.role)) {
    return {
      moduleAccess: expandModuleAccessMap({}),
      moduleActions: expandModuleActionsMap({}, {}),
      secondaryRoles: (user.secondaryRoles as UserRole[]) ?? [],
      designation: user.designation
    };
  }

  const map = mapFromUserDoc(user.moduleAccess);
  const actions = actionsFromUserDoc(user.moduleActions);
  return {
    moduleAccess: expandModuleAccessMap(map),
    moduleActions: expandModuleActionsMap(map, actions),
    secondaryRoles: (user.secondaryRoles as UserRole[]) ?? [],
    designation: user.designation
  };
};

export const assertModuleWriteAccess = async (
  req: Request,
  moduleKey: ErpModuleKey
): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (canManageInstitution(req.user.role)) return;

  const map = await getUserModuleAccessMap(req.user.userId);
  const mode = map[moduleKey] ?? "WRITE";
  if (mode === "NONE") {
    throw new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE);
  }
  if (mode === "READ_ONLY") {
    throw new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE);
  }
};

export interface UpdateModuleAccessOptions {
  moduleAccess: ModuleAccessMap;
  moduleActions?: ModuleActionsMap;
  secondaryRoles?: UserRole[];
  designation?: string | null;
  reason?: string;
}

export const updateUserModuleAccess = async (
  req: Request,
  userId: string,
  options: UpdateModuleAccessOptions
): Promise<{
  moduleAccess: Record<ErpModuleKey, ModuleAccessMode>;
  moduleActions: Record<ErpModuleKey, ModulePermissionAction[]>;
  secondaryRoles: UserRole[];
  designation?: string;
}> => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

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

  const previousAccess = mapFromUserDoc(user.moduleAccess);
  const previousActions = actionsFromUserDoc(user.moduleActions);
  const previousSecondary = (user.secondaryRoles as UserRole[]) ?? [];
  const previousDesignation = user.designation;

  const nextAccess: ModuleAccessMap = {};
  for (const [key, value] of Object.entries(options.moduleAccess)) {
    nextAccess[key as ErpModuleKey] = normalizeModuleAccessMode(value);
  }

  user.set("moduleAccess", nextAccess);
  user.markModified("moduleAccess");

  if (options.moduleActions !== undefined) {
    user.set("moduleActions", options.moduleActions);
    user.markModified("moduleActions");
  }

  if (options.secondaryRoles !== undefined) {
    // Never allow elevating to SUPER_ADMIN / COLLEGE_ADMIN via secondary roles
    const safe = options.secondaryRoles.filter(
      (role) => role !== "SUPER_ADMIN" && role !== "COLLEGE_ADMIN" && role !== user.role
    );
    user.secondaryRoles = safe;
    user.markModified("secondaryRoles");
  }

  if (options.designation !== undefined) {
    user.designation = options.designation || undefined;
  }

  await user.save();

  const afterAccess = mapFromUserDoc(user.moduleAccess);
  const afterActions = actionsFromUserDoc(user.moduleActions);
  const afterSecondary = (user.secondaryRoles as UserRole[]) ?? [];

  await recordAudit(req, {
    action: "user.module_access.update",
    entity: "USER_PERMISSIONS",
    entityId: userId,
    before: {
      moduleAccess: previousAccess,
      moduleActions: previousActions,
      secondaryRoles: previousSecondary,
      designation: previousDesignation
    },
    after: {
      moduleAccess: afterAccess,
      moduleActions: afterActions,
      secondaryRoles: afterSecondary,
      designation: user.designation,
      fullName: user.fullName,
      employeeId: user.employeeId,
      email: user.email,
      reason: options.reason ?? null
    }
  });

  return {
    moduleAccess: expandModuleAccessMap(afterAccess),
    moduleActions: expandModuleActionsMap(afterAccess, afterActions),
    secondaryRoles: afterSecondary,
    designation: user.designation
  };
};

/** Paths that remain allowed even when modules are restricted (self-service). */
export const isModuleAccessBypassPath = (method: string, originalUrl: string): boolean => {
  const path = originalUrl.split("?")[0] ?? originalUrl;
  if (method === "POST" && /\/api\/auth\/logout$/.test(path)) return true;
  if (method === "PUT" && /\/api\/auth\/profile$/.test(path)) return true;
  if (method === "POST" && /\/api\/auth\/change-password$/.test(path)) return true;
  if (method === "GET" && /\/api\/auth\/me$/.test(path)) return true;
  if (/\/api\/users\/me\/module-access$/.test(path)) return true;
  if (/\/api\/users\/[^/]+\/module-access$/.test(path)) return true;
  if (method === "GET" && /\/api\/users\/modules$/.test(path)) return true;
  // Notifications always available
  if (/\/api\/notifications/.test(path)) return true;
  return false;
};

export const resolveModuleForRequest = (req: Request): ErpModuleKey | null =>
  resolveModuleFromApiPath(req.originalUrl || req.path || "");
