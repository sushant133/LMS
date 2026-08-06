/**
 * Simple professional print for Purchase / Expense / Income vouchers
 * and ledger reports — matches ERP print style (A4, clean table).
 *
 * Uses a hidden iframe (not window.open + noopener) so print works
 * without popup blockers and without a null window handle.
 */

import {
  getPrintInstitutionBranding,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Print a full HTML document string via hidden iframe.
 * Prefer this over `window.open(..., "noopener")` + document.write (returns null in Chrome).
 */
export const printHtmlViaIframe = (html: string): void => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error("Could not open print preview");
  }

  // Blank title so browser print header does not show page title / date labels
  const htmlForPrint = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>\u200B</title>",
  );

  doc.open();
  doc.write(htmlForPrint);
  doc.close();

  const previousTitle = document.title;
  document.title = "\u200B";

  const cleanup = () => {
    document.title = previousTitle;
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  window.setTimeout(() => {
    try {
      doc.title = "\u200B";
      win.document.title = "\u200B";
      win.focus();
      win.print();
    } catch {
      cleanup();
      throw new Error("Print failed");
    }
    // Keep iframe alive until the print dialog is done
    win.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 60_000);
  }, 350);
};

export const printSimpleDocument = (opts: {
  title: string;
  bodyHtml: string;
  subtitle?: string;
}): void => {
  const branding = getPrintInstitutionBranding();
  const college = branding.name || "Institution";
  const addressLine = branding.address
    ? `<p class="header-address">${escapeHtml(branding.address)}</p>`
    : "";
  const nameNp = branding.nameNp
    ? `<p class="header-np">${escapeHtml(branding.nameNp)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif;
      margin: 0;
      padding: 16mm 14mm;
      color: #0f172a;
      font-size: 13px;
      background: #fff;
    }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 18px; letter-spacing: 0.02em; text-transform: uppercase; }
    .header-np { margin: 4px 0 0; font-size: 13px; color: #334155; }
    .header-address { margin: 4px 0 0; font-size: 12px; color: #475569; line-height: 1.35; }
    .header h2 { margin: 8px 0 0; font-size: 15px; font-weight: 600; }
    .header p.subtitle { margin: 4px 0 0; font-size: 12px; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-size: 12px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 12px 0; }
    .meta div { font-size: 13px; }
    .meta strong { display: inline-block; min-width: 120px; color: #334155; }
    .amount { font-size: 16px; font-weight: 700; margin-top: 8px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 48px; }
    .signatures div { text-align: center; min-width: 140px; border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 12px; }
    .footer { margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
    @page { size: A4 portrait; margin: 10mm; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    ${PRINT_INSTITUTION_HEADER_CSS}
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(college)}</h1>
    ${nameNp}
    ${addressLine}
    <h2>${escapeHtml(opts.title)}</h2>
    ${opts.subtitle ? `<p class="subtitle">${escapeHtml(opts.subtitle)}</p>` : ""}
  </div>
  ${opts.bodyHtml}
  <div class="footer">Generated from ${escapeHtml(college)} Accounting · ${escapeHtml(new Date().toLocaleString())}</div>
</body>
</html>`;

  printHtmlViaIframe(html);
};

export const printRegisterVoucher = (opts: {
  kind: "Purchase" | "Expense" | "Income";
  voucherNumber?: string;
  dateBs: string;
  fields: Array<{ label: string; value: string }>;
  amountNpr: number;
  narration?: string;
}): void => {
  const metaRows = opts.fields
    .map(
      (f) =>
        `<div><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value || "—")}</div>`,
    )
    .join("");

  printSimpleDocument({
    title: `${opts.kind} Voucher`,
    subtitle: opts.voucherNumber
      ? `Voucher No. ${opts.voucherNumber}`
      : undefined,
    bodyHtml: `
      <div class="meta">
        <div><strong>Date (BS):</strong> ${escapeHtml(opts.dateBs)}</div>
        <div><strong>Voucher:</strong> ${escapeHtml(opts.voucherNumber || "—")}</div>
        ${metaRows}
      </div>
      ${
        opts.narration
          ? `<p><strong>Particulars:</strong> ${escapeHtml(opts.narration)}</p>`
          : ""
      }
      <p class="amount">Amount: NPR ${opts.amountNpr.toLocaleString("en-NP", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</p>
      <div class="signatures">
        <div>Prepared By</div>
        <div>Checked By</div>
        <div>Approved By</div>
      </div>
    `,
  });
};
