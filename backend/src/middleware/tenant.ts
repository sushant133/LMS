import type { NextFunction, Request, Response } from "express";
import { normalizeUserRole } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { School } from "../models/School.js";
import { ApiError } from "../utils/apiError.js";
import { resolveInstitutionSchoolId } from "../utils/institutionSchool.js";
import { isValidObjectIdString, pickNonEmptySchoolId } from "../utils/tenant.js";

/**
 * Load an active school by id. Returns null for invalid ids (no CastError).
 */
const findActiveSchoolById = async (schoolId: string | undefined) => {
  if (!schoolId || !isValidObjectIdString(schoolId)) return null;
  const school = await School.findById(schoolId).select("_id isActive").lean();
  if (!school || !school.isActive) return null;
  return school;
};

/**
 * Sets req.tenantSchoolId for multi-tenant data isolation.
 * Must run after `protect` so req.user is available.
 *
 * SUPER_ADMIN has null user.schoolId — always resolve active/default institution.
 * Invalid or stale active-school cookies fall back to the institution school
 * instead of failing every tenant-scoped API with 400.
 */
export const tenantGuard = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const role = normalizeUserRole(req.user.role);

    if (role === "SUPER_ADMIN") {
      const candidates = [
        pickNonEmptySchoolId(req.cookies?.[env.ACTIVE_SCHOOL_COOKIE_NAME] as string | undefined),
        pickNonEmptySchoolId(req.headers["x-school-id"] as string | undefined),
        pickNonEmptySchoolId(typeof req.query.schoolId === "string" ? req.query.schoolId : undefined),
        pickNonEmptySchoolId(typeof req.body?.schoolId === "string" ? req.body.schoolId : undefined)
      ];

      let school: { _id: { toString(): string }; isActive?: boolean } | null = null;
      for (const candidate of candidates) {
        school = await findActiveSchoolById(candidate);
        if (school) break;
      }

      if (!school) {
        const fallbackId = await resolveInstitutionSchoolId();
        school = await findActiveSchoolById(fallbackId);
      }

      if (!school) {
        return next(new ApiError(404, "Institution context is invalid"));
      }

      req.tenantSchoolId = school._id.toString();
      return next();
    }

    // College admin / staff / student / parent — prefer user.schoolId
    let userSchoolId = pickNonEmptySchoolId(req.user.schoolId ?? undefined);
    let school = await findActiveSchoolById(userSchoolId);

    // Single-tenant recovery: broken user docs without schoolId still resolve default institution
    if (!school) {
      try {
        const fallbackId = await resolveInstitutionSchoolId();
        school = await findActiveSchoolById(fallbackId);
        if (school) {
          userSchoolId = school._id.toString();
        }
      } catch {
        // fall through to error below
      }
    }

    if (!school || !userSchoolId) {
      return next(new ApiError(400, "No college is assigned to this user"));
    }

    req.tenantSchoolId = school._id.toString();
    return next();
  } catch (error) {
    return next(error);
  }
};
