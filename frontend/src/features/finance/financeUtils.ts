import {
  FINANCE_EXPENSE_TYPE_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_TRANSACTION_TYPE_LABELS,
  type FinanceAttachment,
  type FinanceReportResponse,
  type FinanceTransactionRecord,
} from "@phit-erp/shared";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import { api, resolveMediaUrl, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";

export const formatFinanceAmount = (amount: number) => formatCurrencyNpr(amount);

export const transactionTypeLabel = (type: string) =>
  FINANCE_TRANSACTION_TYPE_LABELS[
    type as keyof typeof FINANCE_TRANSACTION_TYPE_LABELS
  ] ?? type;

export const expenseTypeLabel = (type?: string) =>
  type
    ? (FINANCE_EXPENSE_TYPE_LABELS[
        type as keyof typeof FINANCE_EXPENSE_TYPE_LABELS
      ] ?? type)
    : "—";

export const paymentMethodLabel = (method: string) =>
  FINANCE_PAYMENT_METHOD_LABELS[
    method as keyof typeof FINANCE_PAYMENT_METHOD_LABELS
  ] ?? method;

export const attachmentStatusLabel = (count: number) =>
  count > 0 ? `${count} file${count === 1 ? "" : "s"}` : "None";

export async function uploadFinanceAttachments(
  files: FileList | File[],
): Promise<FinanceAttachment[]> {
  const list = Array.from(files);
  if (list.length === 0) return [];

  const formData = new FormData();
  for (const file of list) {
    formData.append("files", file);
  }

  const result = await unwrap<{
    files: Array<{
      url: string;
      path?: string;
      originalName: string;
      mimeType: string;
      size: number;
      kind?: string;
      uploadedAt?: string;
      uploadedBy?: string;
    }>;
  }>(
    api.post("/uploads/finance", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  );

  return (result.files ?? []).map((f) => ({
    url: f.url,
    path: f.path,
    originalName: f.originalName,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    uploadedAt: f.uploadedAt,
    uploadedBy: f.uploadedBy,
  }));
}

export const mediaHref = (url?: string) => resolveMediaUrl(url) ?? "#";

export const isImageAttachment = (mime?: string, name?: string) => {
  if (mime?.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(name ?? "");
};

export const isPdfAttachment = (mime?: string, name?: string) => {
  if (mime === "application/pdf") return true;
  return /\.pdf$/i.test(name ?? "");
};

export function exportFinanceReportExcel(report: FinanceReportResponse) {
  const rows = report.rows.map((r) => ({
    Date: r.dateBs,
    Type: transactionTypeLabel(r.transactionType),
    Category: r.categoryName,
    Title: r.title,
    Amount: r.amountNpr,
    "Payment method": paymentMethodLabel(r.paymentMethod),
    Reference: r.referenceNumber ?? "",
    "Vendor / Source": r.vendorPayee ?? r.incomeSource ?? "",
    Attachments: r.attachmentCount,
    "Created by": r.createdByName ?? "",
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Finance");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `finance-report-${report.reportType.toLowerCase()}-${Date.now()}.xlsx`,
  );
}

export function exportTransactionsExcel(rows: FinanceTransactionRecord[]) {
  const data = rows.map((r) => ({
    Date: r.dateBs,
    Type: transactionTypeLabel(r.transactionType),
    Category: r.categoryName ?? "",
    Title: r.title,
    Amount: r.amountNpr,
    "Payment method": paymentMethodLabel(r.paymentMethod),
    Reference: r.referenceNumber ?? "",
    "Vendor / Payee": r.vendorPayee ?? "",
    "Income source": r.incomeSource ?? "",
    Attachments: r.attachments?.length ?? 0,
    "Created by": r.createdByName ?? "",
    Updated: r.updatedAt ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Transactions");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `finance-transactions-${Date.now()}.xlsx`,
  );
}

/** One ledger line: income = credit, expense = debit, with running balance. */
export type FinanceLedgerLine = {
  dateBs: string;
  particulars: string;
  category: string;
  reference: string;
  paymentMethod: string;
  debitNpr: number;
  creditNpr: number;
  balanceNpr: number;
  type: string;
};

export type FinanceLedgerMeta = {
  title?: string;
  institutionName?: string;
  fromDateBs?: string;
  toDateBs?: string;
  generatedAt?: string;
};

/**
 * Sort chronologically and build debit/credit ledger lines with running balance.
 * Convention: Income (credit) increases balance; Expense (debit) decreases balance.
 */
export function buildFinanceLedger(
  rows: FinanceTransactionRecord[],
): {
  lines: FinanceLedgerLine[];
  totalDebitNpr: number;
  totalCreditNpr: number;
  closingBalanceNpr: number;
} {
  const sorted = [...rows].sort((a, b) => {
    const byDate = a.dateBs.localeCompare(b.dateBs);
    if (byDate !== 0) return byDate;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });

  let balance = 0;
  let totalDebitNpr = 0;
  let totalCreditNpr = 0;
  const lines: FinanceLedgerLine[] = sorted.map((r) => {
    const isIncome = r.transactionType === "INCOME";
    const debitNpr = isIncome ? 0 : r.amountNpr;
    const creditNpr = isIncome ? r.amountNpr : 0;
    totalDebitNpr += debitNpr;
    totalCreditNpr += creditNpr;
    balance += creditNpr - debitNpr;

    const party = isIncome
      ? r.incomeSource?.trim() || r.vendorPayee?.trim() || ""
      : r.vendorPayee?.trim() || "";
    const particulars = party ? `${r.title} — ${party}` : r.title;

    return {
      dateBs: r.dateBs,
      particulars,
      category: r.categoryName ?? "—",
      reference: r.referenceNumber?.trim() || "—",
      paymentMethod: paymentMethodLabel(r.paymentMethod),
      debitNpr,
      creditNpr,
      balanceNpr: balance,
      type: transactionTypeLabel(r.transactionType),
    };
  });

  return {
    lines,
    totalDebitNpr,
    totalCreditNpr,
    closingBalanceNpr: balance,
  };
}

const ledgerPeriodLabel = (meta?: FinanceLedgerMeta) => {
  if (meta?.fromDateBs && meta?.toDateBs) {
    return `${meta.fromDateBs} to ${meta.toDateBs}`;
  }
  if (meta?.fromDateBs) return `From ${meta.fromDateBs}`;
  if (meta?.toDateBs) return `Until ${meta.toDateBs}`;
  return "All dates";
};

/** Export filtered transactions as a formal ledger workbook (Excel). */
export function exportTransactionsLedgerExcel(
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
) {
  const { lines, totalDebitNpr, totalCreditNpr, closingBalanceNpr } =
    buildFinanceLedger(rows);

  const headerBlock = [
    [meta?.institutionName || "Institution"],
    [meta?.title || "Finance Management — Transaction Ledger"],
    [`Period: ${ledgerPeriodLabel(meta)}`],
    [
      `Generated: ${meta?.generatedAt || new Date().toLocaleString()} · ${lines.length} entr${lines.length === 1 ? "y" : "ies"}`,
    ],
    [],
    [
      "Date (BS)",
      "Particulars",
      "Category",
      "Reference",
      "Payment method",
      "Debit (NPR)",
      "Credit (NPR)",
      "Balance (NPR)",
    ],
  ];

  const body = lines.map((line) => [
    line.dateBs,
    line.particulars,
    line.category,
    line.reference,
    line.paymentMethod,
    line.debitNpr || "",
    line.creditNpr || "",
    line.balanceNpr,
  ]);

  const footer = [
    [],
    [
      "",
      "TOTAL",
      "",
      "",
      "",
      totalDebitNpr,
      totalCreditNpr,
      closingBalanceNpr,
    ],
    [],
    ["Note: Debit = Expense · Credit = Income · Balance = cumulative Credit − Debit"],
  ];

  const aoa = [...headerBlock, ...body, ...footer];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  sheet["!cols"] = [
    { wch: 12 },
    { wch: 40 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Ledger");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `finance-ledger-${Date.now()}.xlsx`,
  );
}

const buildLedgerHtml = (
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
): string => {
  const { lines, totalDebitNpr, totalCreditNpr, closingBalanceNpr } =
    buildFinanceLedger(rows);

  const rowsHtml = lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.dateBs)}</td>
        <td>${escapeHtml(line.particulars)}</td>
        <td>${escapeHtml(line.category)}</td>
        <td>${escapeHtml(line.reference)}</td>
        <td>${escapeHtml(line.paymentMethod)}</td>
        <td class="num">${line.debitNpr ? formatFinanceAmount(line.debitNpr) : "—"}</td>
        <td class="num">${line.creditNpr ? formatFinanceAmount(line.creditNpr) : "—"}</td>
        <td class="num">${formatFinanceAmount(line.balanceNpr)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(meta?.title || "Finance Ledger")}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "IBM Plex Sans", system-ui, sans-serif; color: #0f172a; padding: 28px; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 12px; margin: 0 0 4px; }
    .meta { color: #475569; font-size: 12px; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; text-align: left; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    tfoot td { font-weight: 700; background: #f8fafc; }
    .note { margin-top: 14px; font-size: 11px; color: #64748b; }
    .summary { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px; }
    .summary div { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
    .summary strong { display: block; font-size: 14px; margin-top: 4px; }
    @media print {
      body { padding: 12px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(meta?.title || "Finance Management — Transaction Ledger")}</h1>
  ${meta?.institutionName ? `<p class="sub">${escapeHtml(meta.institutionName)}</p>` : ""}
  <p class="meta">
    Period: ${escapeHtml(ledgerPeriodLabel(meta))} ·
    Generated: ${escapeHtml(meta?.generatedAt || new Date().toLocaleString())} ·
    ${lines.length} entr${lines.length === 1 ? "y" : "ies"}
  </p>
  <table>
    <thead>
      <tr>
        <th>Date (BS)</th>
        <th>Particulars</th>
        <th>Category</th>
        <th>Reference</th>
        <th>Payment</th>
        <th class="num">Debit (NPR)</th>
        <th class="num">Credit (NPR)</th>
        <th class="num">Balance (NPR)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#64748b">No transactions</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5">TOTAL</td>
        <td class="num">${formatFinanceAmount(totalDebitNpr)}</td>
        <td class="num">${formatFinanceAmount(totalCreditNpr)}</td>
        <td class="num">${formatFinanceAmount(closingBalanceNpr)}</td>
      </tr>
    </tfoot>
  </table>
  <div class="summary">
    <div>Total Debit (Expenses)<strong>${formatFinanceAmount(totalDebitNpr)}</strong></div>
    <div>Total Credit (Income)<strong>${formatFinanceAmount(totalCreditNpr)}</strong></div>
    <div>Closing Balance<strong>${formatFinanceAmount(closingBalanceNpr)}</strong></div>
  </div>
  <p class="note">Debit = Expense · Credit = Income · Balance = cumulative Credit − Debit. This ledger is independent of the Accounting module.</p>
</body>
</html>`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Open printable ledger (browser Print → Save as PDF). */
export function printTransactionsLedger(
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
  if (!win) return;
  win.document.write(buildLedgerHtml(rows, meta));
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    win.print();
  }, 250);
}

/** Download ledger as PDF file via html2pdf. */
export async function exportTransactionsLedgerPdf(
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
): Promise<void> {
  const html = buildLedgerHtml(rows, meta);
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "1024px";
  container.style.background = "#fff";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const html2pdf = (await import("html2pdf.js")).default;
    await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename: `finance-ledger-${Date.now()}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

export function printFinanceReport(report: FinanceReportResponse) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!win) return;

  const rowsHtml = report.rows
    .map(
      (r) => `<tr>
        <td>${r.dateBs}</td>
        <td>${transactionTypeLabel(r.transactionType)}</td>
        <td>${r.categoryName}</td>
        <td>${r.title}</td>
        <td style="text-align:right">${formatFinanceAmount(r.amountNpr)}</td>
        <td>${paymentMethodLabel(r.paymentMethod)}</td>
        <td>${r.referenceNumber ?? "—"}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!doctype html><html><head><title>${report.title}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 4px}
      p{color:#64748b;margin:0 0 16px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
      th{background:#f8fafc}
      .totals{margin-top:16px;font-size:13px}
    </style></head><body>
    <h1>${report.title}</h1>
    <p>Generated ${new Date(report.generatedAt).toLocaleString()} · ${report.totals.count} row(s)</p>
    <table><thead><tr>
      <th>Date</th><th>Type</th><th>Category</th><th>Title</th><th>Amount</th><th>Payment</th><th>Ref</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>
    <div class="totals">
      <div>Total expenses: ${formatFinanceAmount(report.totals.expenseNpr)}</div>
      <div>Total income: ${formatFinanceAmount(report.totals.incomeNpr)}</div>
      <div>Net: ${formatFinanceAmount(report.totals.netNpr)}</div>
    </div>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`);
  win.document.close();
}

/** Report rows → ledger Excel (same debit/credit layout). */
export function exportFinanceReportLedgerExcel(
  report: FinanceReportResponse,
  meta?: FinanceLedgerMeta,
) {
  const asTx: FinanceTransactionRecord[] = report.rows.map((r, index) => ({
    _id: `report-${index}`,
    schoolId: "",
    transactionType: r.transactionType,
    dateBs: r.dateBs,
    title: r.title,
    categoryId: "",
    categoryName: r.categoryName,
    expenseType: r.expenseType,
    incomeSource: r.incomeSource,
    vendorPayee: r.vendorPayee,
    amountNpr: r.amountNpr,
    paymentMethod: r.paymentMethod,
    referenceNumber: r.referenceNumber,
    attachments: [],
    createdBy: "",
    createdByName: r.createdByName,
  }));

  exportTransactionsLedgerExcel(asTx, {
    title: meta?.title || `${report.title} — Ledger`,
    institutionName: meta?.institutionName,
    fromDateBs: meta?.fromDateBs || report.filters.fromDateBs,
    toDateBs: meta?.toDateBs || report.filters.toDateBs,
    generatedAt: meta?.generatedAt || new Date(report.generatedAt).toLocaleString(),
  });
}

export async function exportFinanceReportLedgerPdf(
  report: FinanceReportResponse,
  meta?: FinanceLedgerMeta,
) {
  const asTx: FinanceTransactionRecord[] = report.rows.map((r, index) => ({
    _id: `report-${index}`,
    schoolId: "",
    transactionType: r.transactionType,
    dateBs: r.dateBs,
    title: r.title,
    categoryId: "",
    categoryName: r.categoryName,
    expenseType: r.expenseType,
    incomeSource: r.incomeSource,
    vendorPayee: r.vendorPayee,
    amountNpr: r.amountNpr,
    paymentMethod: r.paymentMethod,
    referenceNumber: r.referenceNumber,
    attachments: [],
    createdBy: "",
    createdByName: r.createdByName,
  }));

  await exportTransactionsLedgerPdf(asTx, {
    title: meta?.title || `${report.title} — Ledger`,
    institutionName: meta?.institutionName,
    fromDateBs: meta?.fromDateBs || report.filters.fromDateBs,
    toDateBs: meta?.toDateBs || report.filters.toDateBs,
    generatedAt: meta?.generatedAt || new Date(report.generatedAt).toLocaleString(),
  });
}
