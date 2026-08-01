/**
 * Convert amounts to English words for official payroll (e.g. NRs. … Only).
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety"
] as const;

const twoDigits = (n: number): string => {
  if (n < 20) return ONES[n] ?? "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t] ?? ""}${o ? `-${ONES[o]}` : ""}`;
};

const threeDigits = (n: number): string => {
  if (n === 0) return "";
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[h]} Hundred${rest ? ` ${twoDigits(rest)}` : ""}`;
};

/** Indian numbering: crore / lakh / thousand (common for NPR payroll). */
export const amountToWordsEnglish = (amount: number): string => {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(" ").replace(/\s+/g, " ").trim();
};

/** e.g. NRs. Sixty-Six Thousand Six Hundred Twenty-Seven Only. */
export const formatNrsAmountInWords = (amount: number): string => {
  const words = amountToWordsEnglish(amount);
  return `NRs. ${words} Only.`;
};
