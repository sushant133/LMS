import { DEFAULT_ACADEMIC_YEAR_BS } from "@phit-erp/shared";

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