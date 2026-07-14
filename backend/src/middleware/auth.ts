import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isCollegeViewer, normalizeUserRole, type UserRole } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { enforceInstitutionReadOnly } from "./readOnlyGuard.js";
import { enforceModuleAccess } from "./moduleAccessGuard.js";
import { ApiError } from "../utils/apiError.js";
import { getUserSecondaryRoles } from "../utils/moduleAccessService.js";

interface JwtPayload {
  userId: string;
  role: UserRole;
  email: string;
  schoolId?: string | null;
}

/**
 * Cookie JWT auth.
 * Verifies token, then reloads isActive/role/schoolId from DB so deactivation
 * and role demotion take effect immediately (not only after token expiry).
 */
export const protect = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.[env.COOKIE_NAME] as string | undefined;

  if (!token) {
    return next(new ApiError(401, "Authentication required"));
  }

  void (async () => {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;

      const dbUser = await User.findById(decoded.userId)
        .select("isActive role email schoolId")
        .lean();

      if (!dbUser || !dbUser.isActive) {
        return next(new ApiError(401, "Invalid or expired session"));
      }

      // Prefer live DB role/school over JWT claims so admin changes apply immediately
      req.user = {
        userId: decoded.userId,
        role: normalizeUserRole(dbUser.role as string),
        email: dbUser.email || decoded.email,
        schoolId: dbUser.schoolId ? dbUser.schoolId.toString() : null
      };

      return enforceInstitutionReadOnly(req, _res, (err?: unknown) => {
        if (err) return next(err);
        void enforceModuleAccess(req, _res, next);
      });
    } catch {
      return next(new ApiError(401, "Invalid or expired session"));
    }
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

    // Multi-role: check secondary responsibilities asynchronously
    void (async () => {
      try {
        const secondary = await getUserSecondaryRoles(req.user!.userId);
        const hasSecondary = secondary.some((role) => roles.includes(normalizeUserRole(role)));
        if (hasSecondary) {
          return next();
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
