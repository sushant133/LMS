import type { NextFunction, Request, Response } from "express";
import {
  canAccessModule,
  canManageInstitution,
  canWriteModule,
  hasModuleAction,
  inferActionFromApiPath,
  MODULE_ACCESS_DENIED_MESSAGE,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeModuleAccessMode,
  type ModuleAccessMode
} from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { isAssignedFieldCoordinator } from "../utils/fieldDutyService.js";
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

    const originalPath = (req.originalUrl || req.path || "").split("?")[0] ?? "";
    // Self-service: any linked teacher/staff may read own attendance + permission flags
    if (
      READ_METHODS.has(req.method) &&
      (/\/api\/employee-attendance\/me$/.test(originalPath) ||
        /\/api\/employee-attendance\/permissions$/.test(originalPath))
    ) {
      return next();
    }
    // Teacher + Staff attendance share /api/employee-attendance — allow if either
    // category module (or legacy "attendance") is granted. Category-level checks
    // run inside the employee attendance controller.
    if (/\/api\/employee-attendance(\/|$)/.test(originalPath)) {
      const [accessMap] = await Promise.all([getUserModuleAccessMap(req.user.userId)]);
      const canTeacher =
        canAccessModule(accessMap, "teacher-attendance") ||
        canAccessModule(accessMap, "attendance");
      const canStaff =
        canAccessModule(accessMap, "staff-attendance") ||
        canAccessModule(accessMap, "attendance");
      // TEACHER / COLLEGE_STAFF roles may always open read-only self endpoints (handled above);
      // for admin sheets they need explicit module grants (or legacy empty matrix → WRITE).
      if (!canTeacher && !canStaff) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      if (!READ_METHODS.has(req.method)) {
        const canWrite =
          canWriteModule(accessMap, "teacher-attendance") ||
          canWriteModule(accessMap, "staff-attendance") ||
          canWriteModule(accessMap, "attendance");
        if (!canWrite) {
          return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
        }
      }
      return next();
    }

    /**
     * Field Management (/api/field-duty):
     * - Student/parent portals: allow (route authorize enforces role)
     * - Module "field-duty" grant: allow
     * - Assigned primary/assistant field coordinators: allow even without module matrix
     *   (schedule-level checks still apply in controllers)
     */
    if (/\/api\/field-duty(\/|$)/.test(originalPath)) {
      const role = req.user.role;
      if (role === "STUDENT" || role === "PARENT") {
        return next();
      }
      // Access probe must work so the client can show/hide nav before module grants exist
      if (READ_METHODS.has(req.method) && /\/api\/field-duty\/me\/access$/.test(originalPath)) {
        return next();
      }
      const accessMap = await getUserModuleAccessMap(req.user.userId);
      if (canAccessModule(accessMap, "field-duty")) {
        if (!READ_METHODS.has(req.method) && !canWriteModule(accessMap, "field-duty")) {
          // Coordinators still need to submit attendance when module is READ_ONLY
          const isCoord = await isAssignedFieldCoordinator(req);
          if (!isCoord) {
            return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
          }
        }
        return next();
      }
      const isCoord = await isAssignedFieldCoordinator(req);
      if (isCoord) {
        return next();
      }
      return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
    }

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
