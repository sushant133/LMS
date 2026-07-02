import type { Request, Response } from "express";
import { settingsSchema } from "@nepal-school-erp/shared";
import { School } from "../models/School";
import { Setting } from "../models/Setting";
import { asyncHandler } from "../utils/asyncHandler";
import { ensureValidBsDate } from "../utils/nepaliDate";
import { sendSuccess } from "../utils/response";
import { buildDefaultSchoolPayload, buildSchoolSettingsPayload } from "../utils/schoolDefaults";
import { tenantObjectId, withTenantScope } from "../utils/tenant";

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  let settings = await Setting.findOne(withTenantScope(req));

  if (!settings) {
    const school = await School.findById(tenantObjectId(req));
    const defaults = school
      ? buildSchoolSettingsPayload({
          name: school.name,
          nameNp: school.nameNp,
          principalName: school.principalName,
          academicYearBs: school.academicYearBs,
          email: school.email,
          phone: school.phone,
          address: school.address
        })
      : buildSchoolSettingsPayload(buildDefaultSchoolPayload());

    settings = await Setting.create({
      schoolId: tenantObjectId(req),
      ...defaults
    });
  }

  return sendSuccess(res, "Settings fetched", settings);
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const payload = settingsSchema.parse(req.body);
  payload.holidays.forEach((holiday) => ensureValidBsDate(holiday.dateBs));

  const schoolId = tenantObjectId(req);
  const settings = await Setting.findOneAndUpdate(
    { schoolId },
    {
      schoolId,
      ...payload
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  await School.findByIdAndUpdate(schoolId, {
    name: payload.schoolName,
    nameNp: payload.schoolNameNp,
    academicYearBs: payload.academicYearBs,
    principalName: payload.principalName,
    email: payload.contactEmail,
    phone: payload.contactPhone,
    address: payload.address
  });

  return sendSuccess(res, "Settings updated successfully", settings);
});
