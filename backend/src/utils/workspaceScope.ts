import type { Request } from "express";
import {
  canManageInstitution,
  canUseAcademicManagementAdminHub,
  canWriteModule,
  hasExtraAdminModuleGrants,
  TEACHER_BASELINE_MODULE_KEYS,
  type ErpModuleKey,
  type ModuleAccessMap
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { getUserModuleAccessMap, getUserSecondaryRoles } from "./moduleAccessService.js";

export const wantsAdminWorkspaceScope = (req: Request): boolean => {
  const raw = String(req.query.adminScope ?? req.query.workspace ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "admin";
};

const extraAdminGrantsCache = new WeakMap<Request, boolean>();

/**
 * True when this login has extra Administration modules (not teaching tools).
 * Principal / Vice Principal / Coordinator teachers use this with `adminScope=1`
 * so institution Academic Management and Student Management stay separate from
 * My Work (own subjects / own students).
 */
export const actorHasExtraAdminGrants = async (req: Request): Promise<boolean> => {
  if (!req.user) return false;
  const cached = extraAdminGrantsCache.get(req);
  if (cached !== undefined) return cached;

  const map = (await getUserModuleAccessMap(req.user.userId)) as ModuleAccessMap;
  const allowed = hasExtraAdminModuleGrants(map);
  extraAdminGrantsCache.set(req, allowed);
  return allowed;
};

export const actorMayUseAdminWorkspaceScope = async (req: Request): Promise<boolean> => {
  if (!wantsAdminWorkspaceScope(req)) return false;
  if (await actorHasExtraAdminGrants(req)) return true;
  return actorHasAcademicManagementAdminHub(req);
};

const academicHubCache = new WeakMap<Request, boolean>();

/** Vice Principal / granted Academic Management staff: college-wide AM hub. */
export const actorHasAcademicManagementAdminHub = async (
  req: Request
): Promise<boolean> => {
  if (!req.user) return false;
  const cached = academicHubCache.get(req);
  if (cached !== undefined) return cached;

  const user = await User.findById(req.user.userId)
    .select("role designation secondaryRoles moduleAccess")
    .lean();
  const map = (await getUserModuleAccessMap(req.user.userId)) as ModuleAccessMap;
  const allowed = canUseAcademicManagementAdminHub({
    role: req.user.role,
    secondaryRoles: (user?.secondaryRoles as string[] | undefined) ?? [],
    designation: user?.designation,
    moduleAccess: map
  });
  academicHubCache.set(req, allowed);
  return allowed;
};

const actorIsTeacher = async (req: Request): Promise<boolean> => {
  if (!req.user) return false;
  if (req.user.role === "TEACHER") return true;
  const secondary = await getUserSecondaryRoles(req.user.userId);
  return secondary.includes("TEACHER");
};

/**
 * True when this login may use Administration controls for a department:
 * institution Administrator, staff with Manage on that module, or a dual-role
 * teacher (extra admin grants). Teaching baseline WRITE is not enough on its own.
 */
export const actorCanAdministerModule = async (
  req: Request,
  moduleKey: ErpModuleKey
): Promise<boolean> => {
  if (!req.user) return false;
  if (canManageInstitution(req.user.role)) return true;

  const map = (await getUserModuleAccessMap(req.user.userId)) as ModuleAccessMap;
  if (!canWriteModule(map, moduleKey)) return false;

  if (!(await actorIsTeacher(req))) return true;

  if ((TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(moduleKey)) {
    if (moduleKey === "academic-management") {
      return actorHasAcademicManagementAdminHub(req);
    }
    return hasExtraAdminModuleGrants(map);
  }
  return true;
};
