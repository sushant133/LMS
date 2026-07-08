import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isCollegeViewer, normalizeUserRole, type UserRole } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { enforceInstitutionReadOnly } from "./readOnlyGuard.js";
import { ApiError } from "../utils/apiError.js";

interface JwtPayload {
  userId: string;
  role: UserRole;
  email: string;
  schoolId?: string | null;
}

export const protect = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.[env.COOKIE_NAME] as string | undefined;

  if (!token) {
    return next(new ApiError(401, "Authentication required"));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = { ...decoded, role: normalizeUserRole(decoded.role) };
    return enforceInstitutionReadOnly(req, _res, next);
  } catch {
    next(new ApiError(401, "Invalid or expired session"));
  }
};

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

    if (!roles.includes(normalizedRole)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }

    next();
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
