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
/**
 * Staff-side evaluator for confidential-marking exams: anyone who is not an
 * institution administrator (teachers, principals, dual-role staff) — they
 * must never see which student a confidential code belongs to. Students and
 * parents only ever see their own published results and are not evaluators.
 */
export const isConfidentialEvaluator = (req: Request): boolean => {
  const role = String(req.user?.role ?? "").toUpperCase();
  if (!role || role === "STUDENT" || role === "PARENT") return false;
  return !hasInstitutionAccess(role);
};
