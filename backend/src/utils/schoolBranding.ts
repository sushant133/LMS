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
  /** Nepali address line for Nepal Government format documents (never the English address). */
  collegeAddressNp?: string;
  collegeLogoUrl?: string;
}

/**
 * Nepali-only identity used by Nepal Government format documents
 * (गोश्वारा भौचर etc.). Both values come from Institution Settings —
 * never hardcoded and never filled with the English name/address.
 */
export interface GovernmentDocumentHeader {
  /** College name in Nepali — printed as "{name} कार्यालय" under नेपाल सरकार */
  collegeNameNp: string;
  /** College address in Nepali — printed directly under the college name */
  collegeAddressNp: string;
}

export const resolveGovernmentDocumentHeader = async (
  schoolId: Types.ObjectId
): Promise<GovernmentDocumentHeader> => {
  const [school, settings] = await Promise.all([
    School.findById(schoolId).lean(),
    Setting.findOne({ schoolId }).lean()
  ]);

  return {
    collegeNameNp: (settings?.schoolNameNp || school?.nameNp || "").trim(),
    collegeAddressNp: (settings?.schoolAddressNp || "").trim()
  };
};

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
    collegeAddressNp: settings?.schoolAddressNp?.trim() || undefined,
    collegeLogoUrl: COLLEGE_LOGO_URL
  };
};