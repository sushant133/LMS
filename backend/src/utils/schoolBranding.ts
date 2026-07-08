import { COLLEGE_LOGO_URL } from "@phit-erp/shared";
import type { Types } from "mongoose";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { formatAddressLine } from "./formatAddress.js";

export interface SchoolBranding {
  collegeName: string;
  collegeNameNp?: string;
  principalName?: string;
  collegeAddress?: string;
  collegeLogoUrl?: string;
}

export const resolveSchoolBranding = async (schoolId: Types.ObjectId): Promise<SchoolBranding> => {
  const [school, settings] = await Promise.all([
    School.findById(schoolId).lean(),
    Setting.findOne({ schoolId }).lean()
  ]);

  const address = settings?.address ?? school?.address;

  return {
    collegeName: settings?.schoolName ?? school?.name ?? "College",
    collegeNameNp: settings?.schoolNameNp ?? school?.nameNp,
    principalName: settings?.principalName ?? school?.principalName,
    collegeAddress: formatAddressLine(address),
    collegeLogoUrl: COLLEGE_LOGO_URL
  };
};