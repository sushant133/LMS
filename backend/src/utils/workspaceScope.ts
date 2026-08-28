import type { Request } from "express";
import { hasExtraAdminModuleGrants, type ModuleAccessMap } from "@phit-erp/shared";
import { getUserModuleAccessMap } from "./moduleAccessService.js";

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
