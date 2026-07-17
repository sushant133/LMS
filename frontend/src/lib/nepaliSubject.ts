/**
 * Nepali-subject helpers — ONLY applied when isNepaliSubject() is true.
 * English and all other subjects must not use these labels/numbering.
 */

/** Detect Nepali subject by name/code (not other subjects). */
export const isNepaliSubject = (
  subject?: { name?: string | null; code?: string | null } | null,
): boolean => {
  if (!subject) return false;
  const name = (subject.name || "").trim();
  const code = (subject.code || "").trim();
  if (!name && !code) return false;

  if (/नेपाली/.test(name)) return true;

  const nameL = name.toLowerCase();
  const codeL = code.toLowerCase();

  if (/\bnepali\b/.test(nameL)) return true;

  if (/^nep($|[-_\s.]|[a-z]?\d)/i.test(codeL)) return true;
  if (/^ne($|[-_\s.]|\d)/i.test(codeL) && !/^net|new|neu|nee/i.test(codeL)) {
    return true;
  }

  return false;
};

/**
 * Unicode Devanagari font class — attach only when nepaliText is true.
 * Uses .font-nepali in index.css (full OpenType shaping, no letter-spacing).
 * tracking-normal ensures Tailwind does not add letter-spacing that breaks matras.
 */
export const nepaliTextClass = "font-nepali tracking-normal";

/** UI labels for Nepali subject only (schema/DB keys stay English). */
export const nepaliStructuralLabels = {
  unit: "एकाइ",
  units: "एकाइहरू",
  subUnit: "उप–एकाइ",
  chapter: "अध्याय",
  part: "भाग",
  unitNumber: "एकाइ नम्बर",
  unitTitle: "एकाइ शीर्षक",
  teachingHours: "शिक्षण घण्टा",
  description: "विवरण",
  learningOutcomes: "सिकाइ उपलब्धि",
  references: "सन्दर्भ सामग्री",
  assessment: "मूल्याङ्कन",
  practicalRequired: "प्रयोगात्मक आवश्यक",
  totalTheoryHours: "जम्मा थ्योरी घण्टा",
  totalPracticalHours: "जम्मा प्रयोगात्मक घण्टा",
  creditHours: "क्रेडिट घण्टा",
  remarks: "टिप्पणी",
  hoursPerWeekHint: "घण्टा / हप्ता",
  hierarchy: "पाठ्यक्रम संरचना",
} as const;

/** Western 0–9 → Devanagari digits ०–९ */
const NEPALI_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"] as const;

/** Sequential consonants for sub-unit letters: क. ख. ग. घ. ङ. च. … */
const NEPALI_LETTERS = [
  "क",
  "ख",
  "ग",
  "घ",
  "ङ",
  "च",
  "छ",
  "ज",
  "झ",
  "ञ",
  "ट",
  "ठ",
  "ड",
  "ढ",
  "ण",
  "त",
  "थ",
  "द",
  "ध",
  "न",
  "प",
  "फ",
  "ब",
  "भ",
  "म",
  "य",
  "र",
  "ल",
  "व",
  "श",
  "ष",
  "स",
  "ह",
] as const;

export const toNepaliDigits = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.trunc(Math.abs(n)))
    .split("")
    .map((d) => NEPALI_DIGITS[Number(d)] ?? d)
    .join("");
};

/** 0-based index → क, ख, ग, … (wraps with digit suffix if > 33) */
export const toNepaliLetter = (zeroBasedIndex: number): string => {
  const i = Math.max(0, Math.floor(zeroBasedIndex));
  if (i < NEPALI_LETTERS.length) return NEPALI_LETTERS[i]!;
  const cycle = i % NEPALI_LETTERS.length;
  const round = Math.floor(i / NEPALI_LETTERS.length) + 1;
  return `${NEPALI_LETTERS[cycle]}${toNepaliDigits(round)}`;
};

/**
 * Unit display: "Unit 1" | "एकाइ १"
 * DB still stores unitNo as number.
 */
export const formatUnitLabel = (
  unitNo: number,
  options?: { title?: string; nepali?: boolean },
): string => {
  if (!options?.nepali) {
    const base = `Unit ${unitNo}`;
    const title = (options?.title || "").trim();
    return title ? `${base}: ${title}` : base;
  }
  const base = `${nepaliStructuralLabels.unit} ${toNepaliDigits(unitNo)}`;
  const title = (options?.title || "").trim();
  return title ? `${base}: ${title}` : base;
};

export const formatChapterLabel = (
  chapterNo: number,
  options?: { title?: string; nepali?: boolean },
): string => {
  if (!options?.nepali) {
    const base = `Chapter ${chapterNo}`;
    const title = (options?.title || "").trim();
    return title ? `${base}: ${title}` : base;
  }
  const base = `${nepaliStructuralLabels.chapter} ${toNepaliDigits(chapterNo)}`;
  const title = (options?.title || "").trim();
  return title ? `${base}: ${title}` : base;
};

export const formatPartLabel = (
  partNo: number,
  options?: { title?: string; nepali?: boolean },
): string => {
  if (!options?.nepali) {
    const base = `Part ${partNo}`;
    const title = (options?.title || "").trim();
    return title ? `${base}: ${title}` : base;
  }
  const base = `${nepaliStructuralLabels.part} ${toNepaliDigits(partNo)}`;
  const title = (options?.title || "").trim();
  return title ? `${base}: ${title}` : base;
};

/**
 * Sub-unit display numbering (display only — DB keeps numeric subUnitNo / displayNo).
 *
 * English: 1.1, 1.1.1
 * Nepali:  क. , ख. , ग.  then nested क.१ , क.२
 *
 * @param path 0-based index path under the unit (not including unit number)
 */
export const formatSubUnitDisplayNo = (
  unitNo: number,
  path: number[],
  nepali = false,
): string => {
  if (!nepali) {
    const parts = path.map((i) => i + 1);
    return [unitNo, ...parts].join(".");
  }
  if (path.length === 0) {
    return `${nepaliStructuralLabels.unit} ${toNepaliDigits(unitNo)}`;
  }
  const letter = toNepaliLetter(path[0] ?? 0);
  if (path.length === 1) {
    return `${letter}.`;
  }
  const rest = path
    .slice(1)
    .map((i) => toNepaliDigits(i + 1))
    .join(".");
  return `${letter}.${rest}`;
};

/**
 * Preview for next sibling / nest buttons in Nepali mode.
 */
export const formatSubUnitSiblingPreview = (
  unitNo: number,
  path: number[],
  nepali: boolean,
  kind: "nextSibling" | "firstChild",
): string => {
  if (!nepali) {
    const displayNo = formatSubUnitDisplayNo(unitNo, path, false);
    if (kind === "firstChild") return `${displayNo}.1`;
    const parts = displayNo.split(".");
    const last = Number(parts[parts.length - 1] || 1);
    parts[parts.length - 1] = String(last + 1);
    return parts.join(".");
  }
  if (kind === "firstChild") {
    return formatSubUnitDisplayNo(unitNo, [...path, 0], true);
  }
  const nextPath = [...path];
  const last = nextPath[nextPath.length - 1] ?? 0;
  nextPath[nextPath.length - 1] = last + 1;
  return formatSubUnitDisplayNo(unitNo, nextPath, true);
};

/**
 * Convert stored English displayNo ("1.2.1") to Nepali display ("ख.१") for UI only.
 * When not Nepali, returns displayNo unchanged.
 */
export const formatStoredSubUnitDisplayNo = (
  displayNo: string | undefined,
  unitNo: number,
  nepali = false,
): string => {
  const raw = (displayNo || "").trim();
  if (!nepali) return raw;
  if (!raw) return "";
  const parts = raw
    .split(".")
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return raw;
  // Stored form is unitNo.sub.sub… — drop unit segment for letter path
  const pathParts =
    parts[0] === unitNo || parts.length > 1 ? parts.slice(1) : parts;
  if (pathParts.length === 0) {
    return formatUnitLabel(unitNo, { nepali: true });
  }
  const path = pathParts.map((n) => n - 1);
  return formatSubUnitDisplayNo(unitNo, path, true);
};
