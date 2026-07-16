/**
 * Detect whether a subject should use Nepali (Devanagari) text entry.
 * Matches common English/Nepali names and codes only — not other subjects.
 */
export const isNepaliSubject = (
  subject?: { name?: string | null; code?: string | null } | null,
): boolean => {
  if (!subject) return false;
  const name = (subject.name || "").trim();
  const code = (subject.code || "").trim();
  if (!name && !code) return false;

  // Devanagari name (नेपाली)
  if (/नेपाली/.test(name)) return true;

  const nameL = name.toLowerCase();
  const codeL = code.toLowerCase();

  // "Nepali", "Nepali Language", "Compulsory Nepali", etc.
  if (/\bnepali\b/.test(nameL)) return true;

  // Codes: NEP, NEP101, NEP-I, NE, NE101 (avoid matching unrelated codes)
  if (/^nep($|[-_\s.]|[a-z]?\d)/i.test(codeL)) return true;
  if (/^ne($|[-_\s.]|\d)/i.test(codeL) && !/^net|new|neu|nee/i.test(codeL)) {
    return true;
  }

  return false;
};

/** Tailwind-friendly class for Devanagari-friendly text fields. */
export const nepaliTextClass =
  "font-nepali tracking-normal leading-relaxed";
