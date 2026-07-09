import type { Types } from "mongoose";
import { DEFAULT_ACADEMIC_YEAR_BS } from "@phit-erp/shared";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { FiscalYear } from "../models/FiscalYear.js";
import { ApiError } from "./apiError.js";
import { compareBsDates } from "./nepaliDate.js";

/** Derive BS fiscal year label from a BS date (YYYY-MM-DD). Nepal FY runs Shrawan–Ashadh. */
export const getFiscalYearFromBsDate = (dateBs: string, fallback = DEFAULT_ACADEMIC_YEAR_BS): string => {
  const match = dateBs.match(/^(\d{4})-(\d{2})-/);
  if (!match) return fallback;

  const year = Number(match[1]);
  const month = Number(match[2]);
  // BS months 04+ (Shrawan onwards) belong to FY starting that year
  if (month >= 4) {
    return `${year}/${year + 1}`;
  }
  return `${year - 1}/${year}`;
};

export const getDefaultFiscalYearDates = (yearBs: string): { startDateBs: string; endDateBs: string } => {
  const [startYearRaw] = yearBs.split("/");
  const startYear = Number(startYearRaw) || 2083;
  return {
    startDateBs: `${startYear}-04-01`,
    endDateBs: `${startYear + 1}-03-32`
  };
};

/**
 * Block posting/voiding when date is on or before audit lock, or falls in a closed fiscal year.
 */
export const assertFiscalPeriodOpen = async (
  schoolId: Types.ObjectId | string,
  dateBs: string
): Promise<void> => {
  const settings = await AccountingSettings.findOne({ schoolId }).lean();
  if (settings?.auditLockDateBs && compareBsDates(dateBs, settings.auditLockDateBs) <= 0) {
    throw new ApiError(403, "This fiscal period is audit-locked. Cannot post or modify transactions.");
  }

  const fiscalYearBs = getFiscalYearFromBsDate(dateBs, settings?.currentFiscalYearBs);
  const closedYear = await FiscalYear.findOne({ schoolId, yearBs: fiscalYearBs, isClosed: true }).lean();
  if (closedYear) {
    throw new ApiError(403, `Fiscal year ${fiscalYearBs} is closed. Cannot post or modify transactions.`);
  }
};