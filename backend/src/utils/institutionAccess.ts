import { canManageInstitution, hasInstitutionAccess } from "@phit-erp/shared";
import type { Request } from "express";
import { ApiError } from "./apiError.js";

export const assertInstitutionWrite = (
  req: Request,
  message = "You do not have permission to perform this action"
): void => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, message);
  }
};

export const assertInstitutionRead = (
  req: Request,
  message = "You do not have permission to view this data"
): void => {
  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, message);
  }
};

export const hasInstitutionReadAccess = (req: Request): boolean => hasInstitutionAccess(req.user?.role ?? "");