import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  canAccessModule,
  canWriteModule,
  isCollegeViewer,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeUserRole,
  type UserRole
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { enforceInstitutionReadOnly } from "./readOnlyGuard.js";
import { enforceModuleAccess } from "./moduleAccessGuard.js";
import { ApiError } from "../utils/apiError.js";
import {
  getUserModuleAccessMap,
  getUserSecondaryRoles,
  resolveModuleForRequest
} from "../utils/moduleAccessService.js";

interface JwtPayload {
  userId: string;
  role: UserRole;
  email: string;
  schoolId?: string | null;
}

/**
 * Attach req.user from the session cookie when present and valid.
 * Returns false when there is no usable session (missing/invalid/inactive).
 */
const loadUserFromCookie = async (req: Request): Promise<boolean> => {
  const token = req.cookies?.[env.COOKIE_NAME] as string | undefined;
  if (!token) return false;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;

    const dbUser = await User.findById(decoded.userId)
      .select("isActive role email schoolId isDeleted")
      .lean();

    // Soft-deleted accounts cannot use the app (plugin also hides them from find)
    if (!dbUser || !dbUser.isActive || (dbUser as { isDeleted?: boolean }).isDeleted) {
      return false;
    }

    // Prefer live DB role/school over JWT claims so admin changes apply immediately
    req.user = {
      userId: decoded.userId,
      role: normalizeUserRole(dbUser.role as string),
      email: dbUser.email || decoded.email,
      schoolId: dbUser.schoolId ? dbUser.schoolId.toString() : null
    };
    return true;
  } catch {
    return false;
  }
};

/**
 * Cookie JWT auth.
 * Verifies token, then reloads isActive/role/schoolId from DB so deactivation
 * and role demotion take effect immediately (not only after token expiry).
 */
export const protect = (req: Request, _res: Response, next: NextFunction): void => {
  void (async () => {
    const ok = await loadUserFromCookie(req);
    if (!ok) {
      return next(new ApiError(401, "Authentication required"));
    }

    return enforceInstitutionReadOnly(req, _res, (err?: unknown) => {
      if (err) return next(err);
      void enforceModuleAccess(req, _res, next);
    });
  })();
};

/**
 * Optional session for bootstrap routes like GET /auth/me.
 * Never 401s — attaches req.user only when a valid cookie exists.
 * Stops red console noise for logged-out visitors while keeping protect() strict elsewhere.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  void (async () => {
    await loadUserFromCookie(req);
    next();
  })();
};

/**
 * Role gate supporting multi-responsibility accounts.
 * User matches if primary role OR any secondaryRoles is allowed.
 * SUPER_ADMIN always passes. COLLEGE_VIEWER may GET as COLLEGE_ADMIN.
 */
export const authorize =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const normalizedRole = normalizeUserRole(req.user.role);

    // System Administrator inherits every College Administrator permission plus system-level access.
    if (normalizedRole === "SUPER_ADMIN") {
      return next();
    }

    if (isCollegeViewer(normalizedRole) && roles.includes("COLLEGE_ADMIN")) {
      const readMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (readMethod) {
        return next();
      }
    }

    if (roles.includes(normalizedRole)) {
      return next();
    }

    // Multi-role + module-grant: check secondary roles and department access
    void (async () => {
      try {
        const secondary = await getUserSecondaryRoles(req.user!.userId);
        const hasSecondary = secondary.some((role) => roles.includes(normalizeUserRole(role)));
        if (hasSecondary) {
          return next();
        }

        /**
         * Module Access grants: staff/teachers assigned a department may use its APIs
         * even when their primary role is not in the route's role list.
         * READ_ONLY → GET only; WRITE → full methods (moduleAccessGuard still enforces).
         */
        const moduleKey = resolveModuleForRequest(req);
        const accessMap = await getUserModuleAccessMap(req.user!.userId);
        const isRead = ["GET", "HEAD", "OPTIONS"].includes(req.method);

        // Accounts staff need student + academic batch/year lists for fee/refund pickers
        // (same dependency as moduleAccessGuard accounts→students/academics).
        if (
          isRead &&
          (moduleKey === "students" || moduleKey === "academics") &&
          canAccessModule(accessMap, "accounts")
        ) {
          return next();
        }

        if (moduleKey) {
          if (canAccessModule(accessMap, moduleKey)) {
            if (isRead || canWriteModule(accessMap, moduleKey)) {
              return next();
            }
            return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
          }
        }

        return next(new ApiError(403, "You do not have permission to perform this action"));
      } catch (error) {
        return next(error);
      }
    })();
  };

/** Full Administrator and System Administrator operational write access. */
export const authorizeInstitutionAdmin = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");

/** Administrator or System Administrator — for user management screens. */
export const authorizeInstitutionManager = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");

/** Restricts access to the System Administrator only (Super Admin bypass does not apply). */
export const requireSystemAdministrator = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }

  if (req.user.role !== "SUPER_ADMIN") {
    return next(new ApiError(403, "System Administrator access required"));
  }

  next();
};
