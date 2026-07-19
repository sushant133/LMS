/**
 * Convert numbers / amounts to Nepali (Devanagari) for official vouchers.
 */

const NEPALI_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"] as const;

export const toNepaliDigits = (value: string | number): string =>
  String(value).replace(/\d/g, (d) => NEPALI_DIGITS[Number(d)] ?? d);

/** NPR amount with Nepali digits, e.g. १,०००.५० */
export const formatAmountNepali = (amount: number, decimals = 2): string => {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return toNepaliDigits(formatted);
};

const ONES_NP = [
  "",
  "एक",
  "दुई",
  "तीन",
  "चार",
  "पाँच",
  "छ",
  "सात",
  "आठ",
  "नौ",
  "दश",
  "एघार",
  "बाह्र",
  "तेह्र",
  "चौध",
  "पन्ध्र",
  "सोह्र",
  "सत्र",
  "अठार",
  "उन्नाइस"
] as const;

const TENS_NP = [
  "",
  "",
  "बीस",
  "तीस",
  "चालीस",
  "पचास",
  "साठी",
  "सत्तरी",
  "असी",
  "नब्बे"
] as const;

/** 0–99 in Nepali words */
const twoDigitsNp = (n: number): string => {
  if (n <= 0) return "";
  if (n < 20) return ONES_NP[n] ?? "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return TENS_NP[t] ?? "";
  return `${TENS_NP[t]} ${ONES_NP[o]}`.trim();
};

/** 0–999 in Nepali words */
const threeDigitsNp = (n: number): string => {
  if (n <= 0) return "";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return twoDigitsNp(rest);
  const head = `${ONES_NP[h]} सय`;
  return rest ? `${head} ${twoDigitsNp(rest)}` : head;
};

/**
 * Amount in Nepali words (official style).
 * Example: 1250.50 → "एक हजार दुई सय पचास रूपैयाँ पचास पैसा"
 */
export const amountToWordsNepali = (amount: number): string => {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);

  if (whole === 0 && paise === 0) return "शून्य रूपैयाँ";

  const crore = Math.floor(whole / 1_00_00_000);
  const lakh = Math.floor((whole % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((whole % 1_00_000) / 1_000);
  const hundred = whole % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsNp(crore)} करोड`);
  if (lakh) parts.push(`${threeDigitsNp(lakh)} लाख`);
  if (thousand) parts.push(`${threeDigitsNp(thousand)} हजार`);
  if (hundred) parts.push(threeDigitsNp(hundred));

  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) text = "शून्य";
  text = `${text} रूपैयाँ`;
  if (paise > 0) {
    text += ` ${twoDigitsNp(paise)} पैसा`;
  }
  return text;
};
