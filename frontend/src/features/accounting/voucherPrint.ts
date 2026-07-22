/**
 * Simple professional print for Purchase / Expense / Income vouchers
 * and ledger reports — matches ERP print style (A4, clean table).
 */
export const printSimpleDocument = (opts: {
  title: string;
  bodyHtml: string;
  subtitle?: string;
}): void => {
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) return;

  const college =
    (document.querySelector("[data-college-name]") as HTMLElement | null)
      ?.dataset.collegeName || "PHIT COLLEGE";

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${opts.title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif;
      margin: 0;
      padding: 16mm 14mm;
      color: #0f172a;
      font-size: 13px;
    }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 18px; letter-spacing: 0.02em; }
    .header h2 { margin: 6px 0 0; font-size: 15px; font-weight: 600; }
    .header p { margin: 4px 0 0; font-size: 12px; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-size: 12px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 12px 0; }
    .meta div { font-size: 13px; }
    .meta strong { display: inline-block; min-width: 120px; color: #334155; }
    .amount { font-size: 16px; font-weight: 700; margin-top: 8px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 48px; }
    .signatures div { text-align: center; min-width: 140px; border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 12px; }
    .footer { margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
    @media print {
      body { padding: 8mm 10mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${college}</h1>
    <h2>${opts.title}</h2>
    ${opts.subtitle ? `<p>${opts.subtitle}</p>` : ""}
  </div>
  ${opts.bodyHtml}
  <div class="footer">Generated from PHIT COLLEGE Accounting · ${new Date().toLocaleString()}</div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  w.document.close();
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
        `<div><strong>${f.label}:</strong> ${escapeHtml(f.value || "—")}</div>`,
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
