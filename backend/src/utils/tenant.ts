import type { Request } from "express";
import mongoose from "mongoose";
import { ApiError } from "./apiError.js";

export const getTenantSchoolId = (req: Request): string => {
  if (!req.tenantSchoolId) {
    throw new ApiError(400, "Tenant school context is missing");
  }

  return req.tenantSchoolId;
};

export const tenantObjectId = (req: Request): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(getTenantSchoolId(req));

export const withTenantScope = <T extends Record<string, unknown>>(req: Request, query: T = {} as T): T & { schoolId: mongoose.Types.ObjectId } => ({
  ...query,
  schoolId: tenantObjectId(req)
});
