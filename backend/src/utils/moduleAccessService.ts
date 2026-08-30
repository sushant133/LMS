import type { Request } from "express";
import {
  applyFinanceRoleBaseline,
  applyTeacherRoleBaseline,
  expandModuleAccessMap,
  expandModuleActionsMap,
  hasConfiguredModuleAccess,
  isInstitutionAdmin,
  isSystemAdministrator,
  MODULE_ACCESS_DENIED_MESSAGE,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeModuleAccessMode,
  normalizeUserRole,
  resolveModuleAccessMode,
  resolveModuleFromApiPath,
  userHasFinanceRole,
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

const userHasTeacherRole = (
  role: string | undefined,
  secondaryRoles?: UserRole[] | string[] | null
): boolean => {
  if (role === "TEACHER") return true;
  return (secondaryRoles ?? []).some((r) => r === "TEACHER");
};

/**
 * Super Admin + College Admin bypass the module-access matrix for their tenant.
 * (College Admin is still tenant-scoped; Super Admin remains system-wide.)
 * Prevents 403s on core lists (batches/years/students) when a matrix is incomplete.
 */
const isModuleAccessUnrestricted = (role: string | undefined): boolean => {
  const n = normalizeUserRole(role ?? "");
  return isSystemAdministrator(n) || isInstitutionAdmin(n);
};

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

/**
 * Fields every permission lookup needs, cached briefly per user.
 *
 * `protect` → `enforceModuleAccess` → `authorize` each used to re-read the same
 * User document, so a single authenticated request issued four to six identical
 * findById queries before the controller ran. That is pure amplification: it
 * multiplies database load per request and makes the app easier to overwhelm.
 *
 * The TTL is deliberately tiny (one second) so it only ever collapses the
 * lookups *within* one request, and every write path calls
 * `invalidatePermissionCache` so an admin's permission change still takes
 * effect on the user's very next request.
 */
interface PermissionUserFields {
  role?: string;
  moduleAccess?: unknown;
  moduleActions?: unknown;
  secondaryRoles?: UserRole[];
}

const PERMISSION_CACHE_TTL_MS = 1000;
const permissionCache = new Map<string, { expiresAt: number; value: PermissionUserFields | null }>();

/** Drop a user's cached permission fields (call after any permission write). */
export const invalidatePermissionCache = (userId?: string | null): void => {
  if (!userId) {
    permissionCache.clear();
    return;
  }
  permissionCache.delete(String(userId));
};

const loadPermissionUser = async (userId: string): Promise<PermissionUserFields | null> => {
  const key = String(userId);
  const now = Date.now();
  const hit = permissionCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const user = (await User.findById(userId)
    .select("moduleAccess moduleActions role secondaryRoles")
    .lean()) as PermissionUserFields | null;

  // Keep the map from growing without bound on long-lived processes.
  if (permissionCache.size > 5000) {
    for (const [cachedKey, cached] of permissionCache) {
      if (cached.expiresAt <= now) permissionCache.delete(cachedKey);
    }
  }

  permissionCache.set(key, { expiresAt: now + PERMISSION_CACHE_TTL_MS, value: user });
  return user;
};

export const getUserModuleAccessMap = async (userId: string): Promise<ModuleAccessMap> => {
  const user = await loadPermissionUser(userId);
  if (!user) return {};
  // Super Admin: unrestricted (empty map → legacy full WRITE via resolveModuleAccessMode)
  if (isModuleAccessUnrestricted(user.role as string)) {
    return {};
  }
  let map = mapFromUserDoc(user.moduleAccess);
  const secondary = user.secondaryRoles as UserRole[] | undefined;
  // Teachers keep syllabus/plans/attendance tools even after an admin saves
  // module access (e.g. Principal designation + admin sections).
  if (userHasTeacherRole(user.role, secondary) && hasConfiguredModuleAccess(map)) {
    map = applyTeacherRoleBaseline(map);
  }
  // Accountants / cashiers / auditors / principals keep Accounts when matrix was saved
  if (userHasFinanceRole(user.role as string, secondary) && hasConfiguredModuleAccess(map)) {
    map = applyFinanceRoleBaseline(map, [user.role as string, ...(secondary ?? [])]);
  }
  return map;
};

export const getUserModuleActionsMap = async (userId: string): Promise<ModuleActionsMap> => {
  const user = await loadPermissionUser(userId);
  if (!user) return {};
  if (isModuleAccessUnrestricted(user.role as string)) return {};
  return actionsFromUserDoc(user.moduleActions);
};

export const getUserSecondaryRoles = async (userId: string): Promise<UserRole[]> => {
  const user = await loadPermissionUser(userId);
  if (!user?.secondaryRoles?.length) return [];
  return user.secondaryRoles as UserRole[];
};

export const getExpandedModuleAccessForUser = async (
  userId: string,
  role?: string
): Promise<Record<ErpModuleKey, ModuleAccessMode>> => {
  if (role && isModuleAccessUnrestricted(role)) {
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

  const effectiveRole = role ?? user.role;
  if (isModuleAccessUnrestricted(effectiveRole)) {
    return {
      moduleAccess: expandModuleAccessMap({}),
      moduleActions: expandModuleActionsMap({}, {}),
      secondaryRoles: (user.secondaryRoles as UserRole[]) ?? [],
      designation: user.designation
    };
  }

  let map = mapFromUserDoc(user.moduleAccess);
  const secondary = (user.secondaryRoles as UserRole[]) ?? [];
  if (
    userHasTeacherRole(effectiveRole, secondary) &&
    hasConfiguredModuleAccess(map)
  ) {
    map = applyTeacherRoleBaseline(map);
  }
  if (
    userHasFinanceRole(effectiveRole as string, secondary) &&
    hasConfiguredModuleAccess(map)
  ) {
    map = applyFinanceRoleBaseline(map, [effectiveRole as string, ...secondary]);
  }
  const actions = actionsFromUserDoc(user.moduleActions);
  return {
    moduleAccess: expandModuleAccessMap(map),
    moduleActions: expandModuleActionsMap(map, actions),
    secondaryRoles: secondary,
    designation: user.designation
  };
};

export const assertModuleWriteAccess = async (
  req: Request,
  moduleKey: ErpModuleKey
): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (isModuleAccessUnrestricted(req.user.role)) return;

  const map = await getUserModuleAccessMap(req.user.userId);
  const mode = resolveModuleAccessMode(map, moduleKey);
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

  const targetRole = normalizeUserRole(user.role as string);

  // System Administrator accounts always keep full access
  if (isSystemAdministrator(targetRole)) {
    throw new ApiError(400, "Module access cannot be restricted for System Administrator accounts");
  }

  /**
   * No self-granting. "User Management" WRITE is a delegated grant, so without
   * this a staff account holding it could PUT its own id and switch every
   * module to WRITE — turning one delegated permission into full ERP access.
   * Administrators pass authorize() on role alone and manage other accounts,
   * so nothing legitimate needs to edit its own permission matrix here.
   */
  if (req.user?.userId && String(req.user.userId) === String(user._id)) {
    throw new ApiError(
      403,
      "You cannot change your own department access. Ask an Administrator to make this change."
    );
  }

  // Only Super Admin may assign module access to Administrator (COLLEGE_ADMIN) accounts
  if (targetRole === "COLLEGE_ADMIN") {
    if (req.user?.role !== "SUPER_ADMIN") {
      throw new ApiError(
        403,
        "Only Super Admin can assign module access to Administrator accounts"
      );
    }
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

  // Persist teacher baseline so saved maps don't hide teaching tools
  const finalSecondary = (user.secondaryRoles as UserRole[]) ?? [];
  if (userHasTeacherRole(user.role, finalSecondary)) {
    const withBaseline = applyTeacherRoleBaseline(
      mapFromUserDoc(user.moduleAccess)
    );
    user.set("moduleAccess", withBaseline);
    user.markModified("moduleAccess");
  }

  await user.save();
  // Permission fields just changed — drop the short-lived read cache so the
  // very next request for this account sees the new matrix.
  invalidatePermissionCache(userId);

  let afterAccess = mapFromUserDoc(user.moduleAccess);
  const afterActions = actionsFromUserDoc(user.moduleActions);
  const afterSecondary = (user.secondaryRoles as UserRole[]) ?? [];
  if (userHasTeacherRole(user.role, afterSecondary)) {
    afterAccess = applyTeacherRoleBaseline(afterAccess);
  }

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

/**
 * Normalize Express path for module-access checks.
 * Prefers originalUrl; falls back to baseUrl+url when mounted routers only expose a relative path.
 */
export const resolveRequestPath = (
  _method: string,
  originalUrl?: string,
  baseUrl?: string,
  url?: string,
  pathOnly?: string
): string => {
  const raw =
    (originalUrl && originalUrl.length > 0 ? originalUrl : null) ||
    `${baseUrl || ""}${url || pathOnly || ""}` ||
    pathOnly ||
    "";
  let path = (raw.split("?")[0] ?? raw) || "";
  if (path && !path.startsWith("/")) path = `/${path}`;
  // Collapse accidental double slashes (//api/…)
  path = path.replace(/\/{2,}/g, "/");
  return path;
};

/**
 * Shared academic structure lists (batches/years/classes/sections/subjects/master-subjects).
 * Used as filters across Exams, Attendance, Academic Management, Accounting, etc.
 * Subject-assignment admin APIs are excluded (separate module).
 */
export const isSharedAcademicsReadPath = (path: string): boolean => {
  if (!path) return false;
  if (/subject-assignments/i.test(path)) return false;
  return (
    /(?:^|\/)api\/academics(\/|$)/i.test(path) ||
    /(?:^|\/)academics(\/|$)/i.test(path) ||
    /(?:^|\/)(batches|years|subjects|classes|sections|master-subjects)(\/|$)/i.test(path)
  );
};

/** Paths that remain allowed even when modules are restricted (self-service). */
export const isModuleAccessBypassPath = (method: string, originalUrl: string): boolean => {
  const path = resolveRequestPath(method, originalUrl);
  const upper = method.toUpperCase();
  if (upper === "POST" && /\/api\/auth\/logout$/i.test(path)) return true;
  if (upper === "PUT" && /\/api\/auth\/profile$/i.test(path)) return true;
  if (upper === "POST" && /\/api\/auth\/change-password$/i.test(path)) return true;
  if (upper === "GET" && /\/api\/auth\/me$/i.test(path)) return true;
  if (/\/api\/users\/me\/module-access$/i.test(path)) return true;
  if (/\/api\/users\/[^/]+\/module-access$/i.test(path)) return true;
  if (upper === "GET" && /\/api\/users\/modules$/i.test(path)) return true;
  // Teacher self-scope (subjects, batches, years, students for mark entry)
  if (upper === "GET" && /(?:^|\/)api\/teacher(\/|$)/i.test(path)) return true;
  // Notifications always available
  if (/\/api\/notifications/i.test(path)) return true;
  // Authenticated file downloads (tenant isolation enforced in serveProtectedUpload)
  if (upper === "GET" && (/\/api\/uploads\//i.test(path) || /^\/uploads\//i.test(path))) {
    return true;
  }
  /**
   * Shared academic structure (batches/years/classes/sections/subjects) is reference data.
   * Always allow GET for any authenticated user — never block via module matrix.
   */
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") {
    if (isSharedAcademicsReadPath(path)) return true;
    // Institution profile (name, academic year, holidays, branding) is used by
    // AppLayout and many modules. PUT /settings stays admin-gated in the route.
    // Match GET /api/settings only — not /api/accounting/settings.
    if (/(?:^|\/)api\/settings\/?$/i.test(path)) {
      return true;
    }
  }
  return false;
};

export const resolveModuleForRequest = (req: Request): ErpModuleKey | null =>
  resolveModuleFromApiPath(req.originalUrl || req.path || "");
