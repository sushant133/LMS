/**
 * Legacy Preeti/Kantipur ASCII → Unicode Devanagari.
 *
 * CRITICAL RULES:
 * 1. Never touch text that already contains Devanagari (Unicode Nepali).
 * 2. Never run conversion on paste of Word/Docs Unicode — use native paste.
 * 3. Convert only clear Preeti ASCII (e.g. g]kfnL → नेपाली) on blur/save.
 * 4. Database must always store Unicode only.
 */

const CHAR_MAP: Record<string, string> = {
  _: ")",
  "-": "(",
  ",": ",",
  ";": "\u0938",
  ":": "\u0938\u094d",
  "!": "\u0967",
  "\u00a1": "\u091c\u094d\u091e\u094d",
  "?": "\u0930\u0941",
  "\u00bf": "\u0930\u0942",
  ".": "\u0964",
  "\u2026": "\u2018",
  "'": "\u0941",
  "\u2018": "\u0945",
  "\u2039": "\u0919\u094d\u0918",
  "\u203a": "\u0926\u094d\u0930",
  '"': "\u0942",
  "\u201e": "\u0927\u094d\u0930",
  "\u00ab": "\u094d\u0930",
  "(": "\u096f",
  ")": "\u0966",
  "[": "\u0943",
  "]": "\u0947",
  "}": "\u0948",
  "\u00a7": "\u091f\u094d\u091f",
  "\u00b6": "\u0920\u094d\u0920",
  "@": "\u0968",
  "*": "\u096e",
  "/": "\u0930",
  "\\": "\u094d",
  "&": "\u096d",
  "#": "\u0969",
  "%": "\u096b",
  "\u2030": "\u091d\u094d",
  "\u2022": "\u0921\u094d\u0921",
  "`": "\u091e",
  "\u00b4": "\u091d",
  "\u02dc": "\u093d",
  "^": "\u096c",
  "\u02c6": "\u092b\u094d",
  "\u00b0": "\u0919\u094d\u0922",
  "\u00a9": "\u0930",
  "+": "\u0902",
  "\u00b1": "+",
  "\u00f7": "/",
  "\u00d7": "\u00d7",
  "<": "?",
  "=": ".",
  ">": "\u0936\u094d\u0930",
  "|": "\u094d\u0930",
  "~": "\u091e\u094d",
  "\u00a4": "\u091d\u094d",
  "\u00a2": "\u0926\u094d\u0918",
  $: "\u096a",
  "\u00a3": "\u0918\u094d",
  "\u00a5": "\u0930\u094d\u200d",
  "0": "\u0923\u094d",
  "1": "\u091c\u094d\u091e",
  "2": "\u0926\u094d\u0926",
  "3": "\u0918",
  "4": "\u0926\u094d\u0927",
  "5": "\u091b",
  "6": "\u091f",
  "7": "\u0920",
  "8": "\u0921",
  "9": "\u0922",
  a: "\u092c",
  A: "\u092c\u094d",
  "\u00aa": "\u0919",
  "\u00e5": "\u0926\u094d\u0935",
  "\u00c5": "\u0939\u0943",
  "\u00e6": "\u201c",
  "\u00c6": "\u201d",
  b: "\u0926",
  B: "\u0926\u094d\u092f",
  c: "\u0905",
  C: "\u090b",
  "\u00e7": "\u0950",
  d: "\u092e",
  D: "\u092e\u094d",
  e: "\u092d",
  E: "\u092d\u094d",
  "\u00cb": "\u0919\u094d\u0917",
  f: "\u093e",
  F: "\u0901",
  g: "\u0928",
  G: "\u0928\u094d",
  h: "\u091c",
  H: "\u091c\u094d",
  i: "\u0937\u094d",
  I: "\u0915\u094d\u0937\u094d",
  "\u00cd": "\u0919\u094d\u0915",
  "\u00cc": "\u0928\u094d\u0928",
  "\u00ce": "\u0919\u094d\u0916",
  j: "\u0935",
  J: "\u0935\u094d",
  k: "\u092a",
  K: "\u092a\u094d",
  l: "\u093f",
  L: "\u0940",
  M: "\u0903",
  n: "\u0932",
  N: "\u0932\u094d",
  o: "\u092f",
  O: "\u0907",
  "\u00d2": "\u00a8",
  "\u00d6": "=",
  "\u00d8": "\u094d\u092f",
  p: "\u0909",
  P: "\u090f",
  q: "\u0924\u094d\u0930",
  Q: "\u0924\u094d\u0924",
  r: "\u091a",
  R: "\u091a\u094d",
  s: "\u0915",
  S: "\u0915\u094d",
  "\u00df": "\u0926\u094d\u092e",
  t: "\u0924",
  T: "\u0924\u094d",
  u: "\u0917",
  U: "\u0917\u094d",
  "\u00da": "\u2019",
  "\u00d9": ";",
  "\u00db": "!",
  "\u00dc": "%",
  v: "\u0916",
  V: "\u0916\u094d",
  w: "\u0927",
  W: "\u0927\u094d",
  x: "\u0939",
  X: "\u0939\u094d",
  y: "\u0925",
  Y: "\u0925\u094d",
  "\u00dd": "\u091f\u094d\u0920",
  z: "\u0936",
  Z: "\u0936\u094d",
};

const POST_RULES: Array<[RegExp, string]> = [
  [/\u094d\u093e/g, ""],
  [/(\u0924\u094d\u0930|\u0924\u094d\u0924)([^\u0909\u092d\u092a]+?)m/g, "$1m$2"],
  [/\u0924\u094d\u0930m/g, "\u0915\u094d\u0930"],
  [/\u0924\u094d\u0924m/g, "\u0915\u094d\u0924"],
  [/([^\u0909\u092d\u092a]+?)m/g, "m$1"],
  [/\u0909m/g, "\u090a"],
  [/\u092dm/g, "\u091d"],
  [/\u092am/g, "\u092b"],
  [/\u0907{/g, "\u0908"],
  [/\u093f((.\u094d)*[^\u094d])/g, "$1\u093f"],
  [/(.[\u093e\u093f\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u0902\u0903\u0901]*?){/g, "{$1"],
  [/((.\u094d)*){/g, "{$1"],
  [/{/g, "\u0930\u094d"],
  [/([\u093e\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u0902\u0903\u0901]+?)(\u094d(.\u094d)*[^\u094d])/g, "$2$1"],
  [/\u094d([\u093e\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u0902\u0903\u0901]+?)((.\u094d)*[^\u094d])/g, "\u094d$2$1"],
  [/([\u0902\u0901])([\u093e\u093f\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u0903]*)/g, "$2$1"],
  [/\u0901\u0901/g, "\u0901"],
  [/\u0902\u0902/g, "\u0902"],
  [/\u0947\u0947/g, "\u0947"],
  [/\u0948\u0948/g, "\u0948"],
  [/\u0941\u0941/g, "\u0941"],
  [/\u0942\u0942/g, "\u0942"],
  [/^\u0903/g, ":"],
  [/\u091f\u0943/g, "\u091f\u094d\u091f"],
  [/\u0947\u093e/g, "\u093e\u0947"],
  [/\u0948\u093e/g, "\u093e\u0948"],
  [/\u0905\u093e\u0947/g, "\u0913"],
  [/\u0905\u093e\u0948/g, "\u0914"],
  [/\u0905\u093e/g, "\u0906"],
  [/\u090f\u0947/g, "\u0910"],
  [/\u093e\u0947/g, "\u094b"],
  [/\u093e\u0948/g, "\u094c"],
];

/** True if text already contains Unicode Devanagari (must never convert). */
export const hasDevanagari = (text: string): boolean =>
  /[\u0900-\u097F]/.test(text);

/**
 * Strong Preeti signals only — brackets, ampersand combos, letter+digit glue
 * typical of Preeti (e.g. g]kfnL, sf7df08"). Plain English is never matched.
 */
const PREETI_STRONG =
  /[[\]{}|\\~`^&]|[a-zA-Z][/)]|[/)][a-zA-Z]|[a-zA-Z]&|&[a-zA-Z]|[a-zA-Z][0-9]|[0-9][a-zA-Z]|[a-zA-Z]["']|["'][a-zA-Z]/;

/**
 * True only for clear Preeti/Kantipur ASCII — never for Unicode or English prose.
 */
export const looksLikeLegacyNepaliFont = (text: string): boolean => {
  const t = text.trim();
  if (!t) return false;
  // CRITICAL: any Devanagari → not Preeti
  if (hasDevanagari(t)) return false;
  // Must have Latin letters (Preeti stores as ASCII letters)
  if (!/[a-zA-Z]/.test(t)) return false;
  // Require strong Preeti signals — avoids "Total hours", "hello world"
  return PREETI_STRONG.test(t);
};

export const preetiToUnicode = (text: string): string => {
  if (!text) return text;
  // Absolute guard: never rewrite Unicode
  if (hasDevanagari(text)) return text;

  let output = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    output += CHAR_MAP[ch] ?? ch;
  }
  for (const [re, rep] of POST_RULES) {
    output = output.replace(re, rep);
  }
  return output;
};

/**
 * Safe text normalize for Nepali content fields (blur / save only):
 * - NFC normalize (safe for all scripts)
 * - Keep pure Unicode Devanagari unchanged
 * - Convert clear Preeti ASCII → Unicode
 * - Leave English / mixed Latin alone
 *
 * Do NOT call this on every keystroke or as a destructive paste rewrite.
 */
export const ensureUnicodeNepali = (text: string): string => {
  if (!text) return text;
  // Preserve all Unicode including । , ; : ? ! ( ) etc.
  const nfc = text.normalize("NFC");
  if (hasDevanagari(nfc)) return nfc;
  if (looksLikeLegacyNepaliFont(nfc)) return preetiToUnicode(nfc);
  return nfc;
};

/**
 * @deprecated Prefer ensureUnicodeNepali. Kept for call-sites that expected paste API.
 * Always preserves Unicode; only converts clear Preeti.
 */
export const normalizeNepaliPaste = (text: string): string =>
  ensureUnicodeNepali(text);
