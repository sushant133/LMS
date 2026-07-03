import type { InstitutionType } from "@nepal-school-erp/shared";
import type { Request } from "express";
import { School } from "../models/School.js";
import { ApiError } from "./apiError.js";
import { tenantObjectId } from "./tenant.js";

export const isCollege = (institutionType?: InstitutionType | null): boolean => institutionType === "COLLEGE";

export const getInstitutionType = async (req: Request): Promise<InstitutionType> => {
  const schoolId = tenantObjectId(req);
  const school = await School.findById(schoolId).select("institutionType").lean();

  if (!school) {
    throw new ApiError(404, "College not found");
  }

  return (school.institutionType as InstitutionType) ?? "SCHOOL";
};

export const requireSchoolInstitution = async (req: Request): Promise<void> => {
  const type = await getInstitutionType(req);
  if (isCollege(type)) {
    throw new ApiError(400, "This action is only available for class & section programs");
  }
};

export const requireCollegeInstitution = async (req: Request): Promise<void> => {
  const type = await getInstitutionType(req);
  if (!isCollege(type)) {
    throw new ApiError(400, "This action is only available for college institutions");
  }
};