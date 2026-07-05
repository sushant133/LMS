import { INSTITUTION_NAME, INSTITUTION_SCHOOL_CODES } from "@phit-erp/shared";
import { School } from "../models/School.js";
import { ApiError } from "./apiError.js";

let cachedInstitutionSchoolId: string | null = null;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const resolveInstitutionSchoolId = async (): Promise<string> => {
  if (cachedInstitutionSchoolId) {
    return cachedInstitutionSchoolId;
  }

  for (const code of INSTITUTION_SCHOOL_CODES) {
    const school = await School.findOne({ code, isActive: true }).select("_id").lean();
    if (school) {
      cachedInstitutionSchoolId = school._id.toString();
      return cachedInstitutionSchoolId;
    }
  }

  const byName = await School.findOne({
    name: new RegExp(`^${escapeRegExp(INSTITUTION_NAME)}$`, "i"),
    isActive: true
  })
    .select("_id")
    .lean();

  if (byName) {
    cachedInstitutionSchoolId = byName._id.toString();
    return cachedInstitutionSchoolId;
  }

  const firstActive = await School.findOne({ isActive: true }).sort({ createdAt: 1 }).select("_id").lean();
  if (firstActive) {
    cachedInstitutionSchoolId = firstActive._id.toString();
    return cachedInstitutionSchoolId;
  }

  throw new ApiError(500, "Institution school not found");
};

export const resolveInstitutionSchool = async () => {
  const schoolId = await resolveInstitutionSchoolId();
  return School.findById(schoolId).lean();
};