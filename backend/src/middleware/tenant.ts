import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { School } from "../models/School.js";
import { ApiError } from "../utils/apiError.js";
import { resolveInstitutionSchoolId } from "../utils/institutionSchool.js";

export const tenantGuard = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }

  if (req.user.role === "SUPER_ADMIN") {
    const activeSchoolId =
      (req.cookies?.[env.ACTIVE_SCHOOL_COOKIE_NAME] as string | undefined) ??
      (req.headers["x-school-id"] as string | undefined) ??
      (typeof req.query.schoolId === "string" ? req.query.schoolId : undefined) ??
      (typeof req.body?.schoolId === "string" ? req.body.schoolId : undefined) ??
      (await resolveInstitutionSchoolId());

    const school = await School.findById(activeSchoolId).select("_id isActive");
    if (!school || !school.isActive) {
      return next(new ApiError(404, "Institution context is invalid"));
    }

    req.tenantSchoolId = school._id.toString();
    return next();
  }

  if (!req.user.schoolId) {
    return next(new ApiError(400, "No college is assigned to this user"));
  }

  req.tenantSchoolId = req.user.schoolId;
  next();
};
