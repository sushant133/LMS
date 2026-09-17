/**
 * Devanagari characters that the Windows / macOS Nepali keyboard layouts either
 * hide behind AltGr combinations or do not expose at all — ऋ, ं (अनुस्वार),
 * ः (विसर्ग), ँ (चन्द्रबिन्दु) and friends. Typing works fine for everything
 * else, so this palette only has to cover what a layout cannot reach.
 *
 * Stored text is always plain Unicode; nothing here is a legacy Preeti mapping.
 */
export type NepaliCharGroup = {
  /** Devanagari heading shown above the row. */
  label: string;
  /** English hint for non-Nepali admins. */
  hint: string;
  chars: string[];
};

/** अं / अः are shown as अ + mark so the row reads like a स्वर chart. */
export const NEPALI_CHAR_GROUPS: NepaliCharGroup[] = [
  {
    label: "स्वर",
    hint: "Vowels",
    chars: [
      "\u0905", // अ
      "\u0906", // आ
      "\u0907", // इ
      "\u0908", // ई
      "\u0909", // उ
      "\u090a", // ऊ
      "\u090b", // ऋ
      "\u0960", // ॠ
      "\u090f", // ए
      "\u0910", // ऐ
      "\u0913", // ओ
      "\u0914", // औ
      "\u0905\u0902", // अं
      "\u0905\u0903" // अः
    ]
  },
  {
    label: "मात्रा र चिन्ह",
    hint: "Matras and signs",
    chars: [
      "\u093e", // ा
      "\u093f", // ि
      "\u0940", // ी
      "\u0941", // ु
      "\u0942", // ू
      "\u0943", // ृ
      "\u0944", // ॄ
      "\u0947", // े
      "\u0948", // ै
      "\u094b", // ो
      "\u094c", // ौ
      "\u0902", // ं
      "\u0903", // ः
      "\u0901", // ँ
      "\u094d", // ् (हलन्त)
      "\u093c", // ़ (नुक्ता)
      "\u093d", // ऽ
      "\u0950" // ॐ
    ]
  },
  {
    label: "अङ्क र विराम",
    hint: "Digits and punctuation",
    chars: [
      "\u0966",
      "\u0967",
      "\u0968",
      "\u0969",
      "\u096a",
      "\u096b",
      "\u096c",
      "\u096d",
      "\u096e",
      "\u096f",
      "\u0964", // ।
      "\u0965" // ॥
    ]
  }
];

/** Marks render as a dotted circle on their own — pair them with ◌ for the button face. */
export const nepaliCharLabel = (char: string): string =>
  /^[\u0900-\u0903\u093a-\u094d\u0951-\u0957\u0962\u0963]+$/.test(char)
    ? `\u25cc${char}`
    : char;
