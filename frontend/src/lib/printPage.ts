/**
 * Page setup shared by every generated print document.
 *
 * - `@page { margin: 0 }` leaves the browser no room for its own header and
 *   footer (date, page title, URL, "1/2"), so they never print.
 * - The white margin moves onto <body> with `box-decoration-break: clone`, which
 *   repeats the padding on every printed page (Chrome 130+, Firefox), not just
 *   the first and last.
 * - Tables repeat their heading row on each page, rows are never split across
 *   pages, and long unbroken text wraps instead of running off the paper.
 *
 * Append it last inside the document's <style> so it wins over earlier rules.
 */
export type PrintPageSize = "A4 portrait" | "A4 landscape";

export const printPageCss = (
  size: PrintPageSize,
  /** White space kept around the content on every page (CSS padding shorthand). */
  margin = "8mm 6mm",
): string => `
  @page { size: ${size}; margin: 0; }
  html { margin: 0 !important; padding: 0 !important; background: #ffffff; }
  body {
    margin: 0 !important;
    padding: ${margin} !important;
    box-sizing: border-box;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr, img, svg { page-break-inside: avoid; break-inside: avoid; }
  th, td { overflow-wrap: break-word; }
`;

/** Escape text before placing it in generated print HTML. */
export const escapePrintText = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
