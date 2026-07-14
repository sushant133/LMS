import type { NextFunction, Request, Response } from "express";
import {
  canManageInstitution,
  hasModuleAction,
  inferActionFromApiPath,
  MODULE_ACCESS_DENIED_MESSAGE,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeModuleAccessMode,
  type ModuleAccessMode
} from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  getUserModuleAccessMap,
  getUserModuleActionsMap,
  isModuleAccessBypassPath,
  resolveModuleForRequest
} from "../utils/moduleAccessService.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Enforces per-user Module Access Control on all requests.
 * - NONE: block read and write
 * - READ_ONLY: allow GET; block mutating methods
 * - WRITE: allow, subject to granular actions when configured
 * Login and self-service profile/password remain available.
 * Must run after `protect` so `req.user` is set.
 */
export const enforceModuleAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) return next();
    if (canManageInstitution(req.user.role)) return next();
    if (isModuleAccessBypassPath(req.method, req.originalUrl || req.path || "")) return next();

    const moduleKey = resolveModuleForRequest(req);
    if (!moduleKey) return next();

    const [accessMap, actionsMap] = await Promise.all([
      getUserModuleAccessMap(req.user.userId),
      getUserModuleActionsMap(req.user.userId)
    ]);

    const mode: ModuleAccessMode = normalizeModuleAccessMode(accessMap[moduleKey]);

    if (mode === "NONE") {
      void recordAudit(req, {
        action: "module_access.blocked",
        entity: "MODULE_ACCESS",
        entityId: moduleKey,
        after: {
          method: req.method,
          path: req.originalUrl,
          moduleKey,
          mode: "NONE"
        }
      });
      return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
    }

    if (READ_METHODS.has(req.method)) {
      // View allowed for READ_ONLY and WRITE
      if (!hasModuleAction(accessMap, actionsMap, moduleKey, "view")) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      return next();
    }

    // Mutating request
    if (mode === "READ_ONLY") {
      void recordAudit(req, {
        action: "module_access.blocked_write",
        entity: "MODULE_ACCESS",
        entityId: moduleKey,
        after: {
          method: req.method,
          path: req.originalUrl,
          moduleKey,
          mode: "READ_ONLY"
        }
      });
      return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
    }

    const requiredAction = inferActionFromApiPath(req.method, req.originalUrl || req.path || "");
    if (!hasModuleAction(accessMap, actionsMap, moduleKey, requiredAction)) {
      // Fall back: WRITE mode without granular deny still allows create/edit/delete
      const hasAnyGranular = Boolean(actionsMap[moduleKey]?.length);
      if (hasAnyGranular) {
        void recordAudit(req, {
          action: "module_access.blocked_action",
          entity: "MODULE_ACCESS",
          entityId: moduleKey,
          after: {
            method: req.method,
            path: req.originalUrl,
            moduleKey,
            requiredAction
          }
        });
        return next(
          new ApiError(
            403,
            `You do not have "${requiredAction}" permission for this department. Contact the Administrator.`
          )
        );
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
