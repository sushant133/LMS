import type { Request } from "express";
import mongoose from "mongoose";
import { ApiError } from "./apiError.js";

/** Non-empty string school id from request sources (cookie / header / query / body). */
export const pickNonEmptySchoolId = (
  ...candidates: Array<string | undefined | null>
): string | undefined => {
  for (const value of candidates) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
};

/** True when value is a 24-char hex ObjectId (avoids Mongoose CastError on findById). */
export const isValidObjectIdString = (value: string | undefined | null): value is string => {
  if (!value || typeof value !== "string") return false;
  return /^[a-fA-F0-9]{24}$/.test(value.trim());
};

/**
 * Resolve the active institution (school) id for the request.
 * Prefers tenantGuard-set value, then falls back to the authenticated user's school.
 *
 * SUPER_ADMIN has no schoolId on the user document — tenantGuard must set
 * req.tenantSchoolId before controllers run.
 */
export const getTenantSchoolId = (req: Request): string => {
  const fromGuard = pickNonEmptySchoolId(req.tenantSchoolId);
  if (fromGuard && isValidObjectIdString(fromGuard)) {
    return fromGuard;
  }

  // Defense-in-depth: college-scoped users work even if a route forgot tenantGuard.
  const fromUser = pickNonEmptySchoolId(req.user?.schoolId ?? undefined);
  if (fromUser && isValidObjectIdString(fromUser)) {
    req.tenantSchoolId = fromUser;
    return fromUser;
  }

  throw new ApiError(400, "Institution context is missing");
};

export const tenantObjectId = (req: Request): mongoose.Types.ObjectId =>
  new mongoose.Types.ObjectId(getTenantSchoolId(req));

export const withTenantScope = <T extends Record<string, unknown>>(
  req: Request,
  query: T = {} as T
): T & { schoolId: mongoose.Types.ObjectId } => ({
  ...query,
  schoolId: tenantObjectId(req)
});
