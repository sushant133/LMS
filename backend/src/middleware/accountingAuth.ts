import type { NextFunction, Request, Response } from "express";
import { hasAccountingPermission, normalizeUserRole, type AccountingPermission } from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";

export const requireAccountingPermission =
  (...permissions: AccountingPermission[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const role = normalizeUserRole(req.user.role);
    if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
      return next();
    }

    const allowed = permissions.some((permission) => hasAccountingPermission(role, permission));
    if (!allowed) {
      return next(new ApiError(403, "You do not have permission to perform this accounting action"));
    }

    next();
  };