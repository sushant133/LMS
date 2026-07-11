import type { NextFunction, Request, Response } from "express";
import { canManageInstitution, MODULE_ACCESS_DISABLED_MESSAGE } from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  getUserModuleAccessMap,
  isModuleAccessBypassPath,
  resolveModuleForRequest
} from "../utils/moduleAccessService.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Enforces per-user Module Access Control on write requests.
 * When a module is READ_ONLY for the user, POST/PUT/PATCH/DELETE are blocked.
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
    if (READ_METHODS.has(req.method)) return next();
    if (isModuleAccessBypassPath(req.method, req.originalUrl || req.path || "")) return next();

    const moduleKey = resolveModuleForRequest(req);
    if (!moduleKey) return next();

    const access = await getUserModuleAccessMap(req.user.userId);
    if (access[moduleKey] !== "READ_ONLY") return next();

    void recordAudit(req, {
      action: "module_access.blocked_write",
      entity: "MODULE_ACCESS",
      entityId: moduleKey,
      after: {
        method: req.method,
        path: req.originalUrl,
        moduleKey
      }
    });

    return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
  } catch (error) {
    return next(error);
  }
};
