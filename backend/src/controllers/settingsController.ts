import type { Request, Response } from "express";
import { settingsSchema } from "@phit-erp/shared";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { buildDefaultSchoolPayload, buildSchoolSettingsPayload } from "../utils/schoolDefaults.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

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
