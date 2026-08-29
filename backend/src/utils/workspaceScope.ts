import type { Request } from "express";
import {
  canManageInstitution,
  canWriteModule,
  hasExtraAdminModuleGrants,
  TEACHER_BASELINE_MODULE_KEYS,
  type ErpModuleKey,
  type ModuleAccessMap
} from "@phit-erp/shared";
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
  return actorHasExtraAdminGrants(req);
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
    return hasExtraAdminModuleGrants(map);
  }
  return true;
};
