/**
 * Normalize machine user IDs for matching against LMS codes.
 * Example: "HA-357-083" / "ha 357 083" / "HA357083" → "HA357083"
 */
export const normalizeBiometricCode = (code: string): string =>
  code.trim().toUpperCase().replace(/[\s\-_./\\]+/g, "");

/** Distinct lookup variants (exact + common device formats). */
export const biometricCodeVariants = (code: string): string[] => {
  const raw = code.trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  const noSep = normalizeBiometricCode(raw);
  const set = new Set<string>([raw, upper, raw.toLowerCase(), noSep]);
  return [...set].filter(Boolean);
};

export const codesMatchBiometric = (stored: string, incoming: string): boolean =>
  normalizeBiometricCode(stored) === normalizeBiometricCode(incoming);
