import {
  FINANCE_EXPENSE_TYPE_LABELS,
  FINANCE_OWNER_SCOPE_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_TRANSACTION_TYPE_LABELS,
  type FinanceAttachment,
  type FinanceOwnerScope,
  type FinanceReportResponse,
  type FinanceTransactionRecord,
} from "@phit-erp/shared";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { api, resolveMediaUrl, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";

type SheetCell = string | number | null;

/** Build a clean rectangular sheet (headers + rows) with column widths. */
const buildAlignedSheet = (
  title: string,
  subtitle: string,
  headers: string[],
  body: SheetCell[][],
  footerRows: SheetCell[][] = [],
  colWidths: number[] = [],
): XLSX.WorkSheet => {
  const aoa: SheetCell[][] = [
    [title],
    [subtitle],
    [],
    headers,
    ...body,
  ];

  if (footerRows.length) {
    aoa.push([]);
    for (const row of footerRows) aoa.push(row);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  // Mark amount-like columns as numbers when values are numeric
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
        cell.t = "n";
        cell.z = "#,##0.00";
      } else if (cell.v === null || cell.v === undefined) {
        cell.v = "";
        cell.t = "s";
      } else {
        cell.t = "s";
        cell.v = String(cell.v);
      }
    }
  }

  sheet["!cols"] = headers.map((_, i) => ({
    wch: colWidths[i] ?? Math.max(12, String(headers[i]).length + 2),
  }));

  // Freeze panes so the table header stays visible while scrolling (Excel)
  (sheet as XLSX.WorkSheet & { "!views"?: unknown[] })["!views"] = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: 4,
      topLeftCell: "A5",
      activePane: "bottomLeft",
    },
  ];

  return sheet;
};

/** Reliable browser download for Excel workbooks. */
const downloadWorkbook = (book: XLSX.WorkBook, filename: string) => {
  const safeName = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  try {
    XLSX.writeFile(book, safeName, { bookType: "xlsx", compression: true });
    return;
  } catch {
    const raw = XLSX.write(book, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    }) as ArrayBuffer | Uint8Array | number[];
    const bytes =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : raw instanceof Uint8Array
          ? raw
          : new Uint8Array(raw);
    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

const formatNprPlain = (amount: number) =>
  Number(amount || 0).toLocaleString("en-NP", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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

export const ownerScopeLabel = (scope?: string) =>
  scope
    ? (FINANCE_OWNER_SCOPE_LABELS[scope as FinanceOwnerScope] ?? scope)
    : FINANCE_OWNER_SCOPE_LABELS.INSTITUTION;

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

/** Sum income, expenses, and net for the current (filtered) transaction list. */
export function summarizeTransactionTotals(rows: FinanceTransactionRecord[]) {
  let totalIncomeNpr = 0;
  let totalExpensesNpr = 0;
  for (const r of rows) {
    if (r.transactionType === "INCOME") totalIncomeNpr += Number(r.amountNpr) || 0;
    else totalExpensesNpr += Number(r.amountNpr) || 0;
  }
  return {
    totalIncomeNpr,
    totalExpensesNpr,
    /** Net = income − expenses */
    totalAmountNpr: totalIncomeNpr - totalExpensesNpr,
    count: rows.length,
  };
}

export function exportFinanceReportExcel(report: FinanceReportResponse) {
  const headers = [
    "S.N.",
    "Date (BS)",
    "Type",
    "Category",
    "Title",
    "Vendor / Source",
    "Amount (NPR)",
    "Payment method",
    "Reference",
    "Record source",
    "Attachments",
    "Created by",
  ];

  const body: SheetCell[][] = report.rows.map((r, index) => [
    index + 1,
    r.dateBs,
    transactionTypeLabel(r.transactionType),
    r.categoryName ?? "",
    r.title,
    r.vendorPayee ?? r.incomeSource ?? "",
    Number(r.amountNpr) || 0,
    paymentMethodLabel(r.paymentMethod),
    r.referenceNumber ?? "",
    ownerScopeLabel(r.ownerScope),
    r.attachmentCount ?? 0,
    r.createdByName ?? "",
  ]);

  const empty = Array(headers.length).fill("") as SheetCell[];
  const totalRow = (label: string, amount: number): SheetCell[] => {
    const row = [...empty];
    row[4] = label;
    row[6] = amount;
    return row;
  };

  const footer = [
    totalRow("TOTAL INCOME", report.totals.incomeNpr),
    totalRow("TOTAL EXPENSES", report.totals.expenseNpr),
    totalRow("TOTAL AMOUNT (NET)", report.totals.netNpr),
  ];

  const sheet = buildAlignedSheet(
    report.title || "Finance report",
    `Generated: ${new Date(report.generatedAt).toLocaleString()} · ${report.totals.count} row(s)`,
    headers,
    body,
    footer,
    [6, 12, 10, 18, 28, 18, 14, 14, 14, 18, 12, 16],
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Finance");
  downloadWorkbook(
    book,
    `finance-report-${report.reportType.toLowerCase()}-${Date.now()}.xlsx`,
  );
}

export function exportTransactionsExcel(rows: FinanceTransactionRecord[]) {
  if (!rows.length) {
    throw new Error("No transactions to export");
  }

  const totals = summarizeTransactionTotals(rows);
  const headers = [
    "S.N.",
    "Date (BS)",
    "Type",
    "Category",
    "Title",
    "Vendor / Payee",
    "Income source",
    "Amount (NPR)",
    "Payment method",
    "Reference",
    "Record source",
    "Attachments",
    "Created by",
  ];

  const body: SheetCell[][] = rows.map((r, index) => [
    index + 1,
    r.dateBs,
    transactionTypeLabel(r.transactionType),
    r.categoryName ?? "",
    r.title,
    r.vendorPayee ?? "",
    r.incomeSource ?? "",
    Number(r.amountNpr) || 0,
    paymentMethodLabel(r.paymentMethod),
    r.referenceNumber ?? "",
    ownerScopeLabel(r.ownerScope),
    r.attachments?.length ?? 0,
    r.createdByName ?? "",
  ]);

  const empty = Array(headers.length).fill("") as SheetCell[];
  const totalRow = (label: string, amount: number): SheetCell[] => {
    const row = [...empty];
    row[4] = label;
    row[7] = amount;
    return row;
  };

  const footer = [
    totalRow("TOTAL INCOME", totals.totalIncomeNpr),
    totalRow("TOTAL EXPENSES", totals.totalExpensesNpr),
    totalRow("TOTAL AMOUNT (NET)", totals.totalAmountNpr),
  ];

  const sheet = buildAlignedSheet(
    "Finance Management — All Transactions",
    `Generated: ${new Date().toLocaleString()} · ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`,
    headers,
    body,
    footer,
    [6, 12, 10, 18, 28, 18, 16, 14, 14, 14, 18, 12, 16],
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Transactions");
  downloadWorkbook(book, `finance-transactions-${Date.now()}.xlsx`);
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
  if (!rows.length) {
    throw new Error("No transactions to export");
  }

  const { lines, totalDebitNpr, totalCreditNpr, closingBalanceNpr } =
    buildFinanceLedger(rows);
  const totals = summarizeTransactionTotals(rows);

  const headers = [
    "S.N.",
    "Date (BS)",
    "Particulars",
    "Category",
    "Reference",
    "Payment method",
    "Debit (NPR)",
    "Credit (NPR)",
    "Balance (NPR)",
  ];

  const body: SheetCell[][] = lines.map((line, index) => [
    index + 1,
    line.dateBs,
    line.particulars,
    line.category,
    line.reference,
    line.paymentMethod,
    line.debitNpr ? line.debitNpr : null,
    line.creditNpr ? line.creditNpr : null,
    line.balanceNpr,
  ]);

  const empty = Array(headers.length).fill("") as SheetCell[];
  const totalLine = [...empty];
  totalLine[2] = "TOTAL";
  totalLine[6] = totalDebitNpr;
  totalLine[7] = totalCreditNpr;
  totalLine[8] = closingBalanceNpr;

  const summary = (label: string, amount: number): SheetCell[] => {
    const row = [...empty];
    row[2] = label;
    row[8] = amount;
    return row;
  };

  const footer = [
    totalLine,
    summary("TOTAL INCOME", totals.totalIncomeNpr),
    summary("TOTAL EXPENSES", totals.totalExpensesNpr),
    summary("TOTAL AMOUNT (NET)", totals.totalAmountNpr),
  ];

  const sheet = buildAlignedSheet(
    meta?.title || "Finance Management — Transaction Ledger",
    `${meta?.institutionName ? `${meta.institutionName} · ` : ""}Period: ${ledgerPeriodLabel(meta)} · Generated: ${meta?.generatedAt || new Date().toLocaleString()} · ${lines.length} entr${lines.length === 1 ? "y" : "ies"}`,
    headers,
    body,
    footer,
    [6, 12, 40, 18, 14, 14, 14, 14, 14],
  );

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Ledger");
  downloadWorkbook(book, `finance-ledger-${Date.now()}.xlsx`);
}

const buildLedgerHtml = (
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
): string => {
  const { lines, totalDebitNpr, totalCreditNpr, closingBalanceNpr } =
    buildFinanceLedger(rows);
  const totals = summarizeTransactionTotals(rows);

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
    body { font-family: "IBM Plex Sans", system-ui, sans-serif; color: #0f172a; padding: 28px; margin: 0; background: #fff; }
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
    <div>Total income<strong>${formatFinanceAmount(totals.totalIncomeNpr)}</strong></div>
    <div>Total expenses<strong>${formatFinanceAmount(totals.totalExpensesNpr)}</strong></div>
    <div>Total amount (net)<strong>${formatFinanceAmount(totals.totalAmountNpr)}</strong></div>
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

/**
 * Open a print window. Do NOT use `noopener` — it makes window.open return null
 * in modern browsers, so print would silently fail.
 */
const openPrintWindow = (html: string, title = "Print"): Window => {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) {
    throw new Error(
      "Pop-up blocked. Allow pop-ups for this site to print or export PDF.",
    );
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  return win;
};

/** Open printable ledger (browser Print → Save as PDF). */
export function printTransactionsLedger(
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
) {
  if (!rows.length) {
    throw new Error("No transactions to print");
  }
  const win = openPrintWindow(
    buildLedgerHtml(rows, meta),
    meta?.title || "Finance Ledger",
  );
  win.focus();
  // Wait for layout/styles before print dialog
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // User can still use browser menu Print
    }
  }, 400);
}

/**
 * Download ledger as a real PDF table (jsPDF text layout).
 * Avoids html2canvas off-screen blank pages.
 */
export async function exportTransactionsLedgerPdf(
  rows: FinanceTransactionRecord[],
  meta?: FinanceLedgerMeta,
): Promise<void> {
  if (!rows.length) {
    throw new Error("No transactions to export");
  }

  const { lines, totalDebitNpr, totalCreditNpr, closingBalanceNpr } =
    buildFinanceLedger(rows);
  const totals = summarizeTransactionTotals(rows);

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginTop = 12;
  const marginBottom = 12;
  const usableWidth = pageWidth - marginX * 2;

  // Column widths (mm) — must sum to usableWidth
  const colWeights = [8, 18, 62, 30, 22, 24, 24, 24, 24];
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colW = colWeights.map((w) => (w / weightSum) * usableWidth);
  const headers = [
    "S.N.",
    "Date",
    "Particulars",
    "Category",
    "Ref",
    "Payment",
    "Debit",
    "Credit",
    "Balance",
  ];

  const colX: number[] = [];
  {
    let x = marginX;
    for (const w of colW) {
      colX.push(x);
      x += w;
    }
  }

  const rowH = 7;
  let y = marginTop;
  let pageNo = 1;

  const drawPageHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(
      meta?.title || "Finance Management — Transaction Ledger",
      marginX,
      y,
    );
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const sub = [
      meta?.institutionName,
      `Period: ${ledgerPeriodLabel(meta)}`,
      `Generated: ${meta?.generatedAt || new Date().toLocaleString()}`,
      `${lines.length} entr${lines.length === 1 ? "y" : "ies"}`,
    ]
      .filter(Boolean)
      .join("  ·  ");
    doc.text(sub, marginX, y);
    y += 5;

    // Table header background
    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y, usableWidth, rowH, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, y, usableWidth, rowH, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    headers.forEach((h, i) => {
      const isNum = i >= 6;
      if (isNum) {
        doc.text(h, colX[i]! + colW[i]! - 1.5, y + 4.6, { align: "right" });
      } else {
        doc.text(h, colX[i]! + 1.2, y + 4.6);
      }
    });
    y += rowH;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - marginBottom) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${pageNo}`, pageWidth - marginX, pageHeight - 6, {
      align: "right",
    });
    doc.addPage();
    pageNo += 1;
    y = marginTop;
    drawPageHeader();
  };

  const drawCellBorders = (height: number) => {
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, y, usableWidth, height, "S");
    let x = marginX;
    for (let i = 0; i < colW.length - 1; i++) {
      x += colW[i]!;
      doc.line(x, y, x, y + height);
    }
  };

  const fitText = (text: string, maxWidth: number) => {
    const t = text || "";
    if (doc.getTextWidth(t) <= maxWidth) return t;
    let out = t;
    while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  };

  drawPageHeader();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);

  lines.forEach((line, index) => {
    ensureSpace(rowH);
    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, usableWidth, rowH, "F");
    }
    drawCellBorders(rowH);

    const cells: Array<string | number> = [
      index + 1,
      line.dateBs,
      line.particulars,
      line.category,
      line.reference,
      line.paymentMethod,
      line.debitNpr ? formatNprPlain(line.debitNpr) : "—",
      line.creditNpr ? formatNprPlain(line.creditNpr) : "—",
      formatNprPlain(line.balanceNpr),
    ];

    cells.forEach((value, i) => {
      const text = String(value ?? "");
      const maxW = colW[i]! - 2.5;
      const isNum = i >= 6 || i === 0;
      if (isNum && i !== 0) {
        doc.text(fitText(text, maxW), colX[i]! + colW[i]! - 1.5, y + 4.6, {
          align: "right",
        });
      } else if (i === 0) {
        doc.text(fitText(text, maxW), colX[i]! + colW[i]! / 2, y + 4.6, {
          align: "center",
        });
      } else {
        doc.text(fitText(text, maxW), colX[i]! + 1.2, y + 4.6);
      }
    });
    y += rowH;
  });

  // Totals row
  ensureSpace(rowH + 2);
  doc.setFillColor(241, 245, 249);
  doc.rect(marginX, y, usableWidth, rowH, "F");
  drawCellBorders(rowH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("TOTAL", colX[2]! + 1.2, y + 4.6);
  doc.text(formatNprPlain(totalDebitNpr), colX[6]! + colW[6]! - 1.5, y + 4.6, {
    align: "right",
  });
  doc.text(formatNprPlain(totalCreditNpr), colX[7]! + colW[7]! - 1.5, y + 4.6, {
    align: "right",
  });
  doc.text(
    formatNprPlain(closingBalanceNpr),
    colX[8]! + colW[8]! - 1.5,
    y + 4.6,
    { align: "right" },
  );
  y += rowH + 6;

  // Summary cards
  ensureSpace(22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", marginX, y);
  y += 5;

  const boxW = (usableWidth - 8) / 3;
  const boxes = [
    { label: "Total income", value: totals.totalIncomeNpr },
    { label: "Total expenses", value: totals.totalExpensesNpr },
    { label: "Total amount (net)", value: totals.totalAmountNpr },
  ];
  boxes.forEach((box, i) => {
    const x = marginX + i * (boxW + 4);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxW, 14, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(box.label, x + 3, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(formatNprPlain(box.value), x + 3, y + 11);
  });
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Debit = Expense · Credit = Income · Balance = cumulative Credit − Debit. Independent of Accounting module.",
    marginX,
    y,
  );

  doc.setFontSize(8);
  doc.text(`Page ${pageNo}`, pageWidth - marginX, pageHeight - 6, {
    align: "right",
  });

  doc.save(`finance-ledger-${Date.now()}.pdf`);
}

export function printFinanceReport(report: FinanceReportResponse) {
  const rowsHtml = report.rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.dateBs)}</td>
        <td>${escapeHtml(transactionTypeLabel(r.transactionType))}</td>
        <td>${escapeHtml(r.categoryName)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td style="text-align:right">${escapeHtml(formatFinanceAmount(r.amountNpr))}</td>
        <td>${escapeHtml(paymentMethodLabel(r.paymentMethod))}</td>
        <td>${escapeHtml(r.referenceNumber ?? "—")}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(report.title)}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 4px}
      p{color:#64748b;margin:0 0 16px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
      th{background:#f8fafc}
      .totals{margin-top:16px;font-size:13px}
    </style></head><body>
    <h1>${escapeHtml(report.title)}</h1>
    <p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())} · ${report.totals.count} row(s)</p>
    <table><thead><tr>
      <th>Date</th><th>Type</th><th>Category</th><th>Title</th><th>Amount</th><th>Payment</th><th>Ref</th>
    </tr></thead><tbody>${rowsHtml || `<tr><td colspan="7">No rows</td></tr>`}</tbody></table>
    <div class="totals">
      <div>Total expenses: ${escapeHtml(formatFinanceAmount(report.totals.expenseNpr))}</div>
      <div>Total income: ${escapeHtml(formatFinanceAmount(report.totals.incomeNpr))}</div>
      <div>Net: ${escapeHtml(formatFinanceAmount(report.totals.netNpr))}</div>
    </div>
    </body></html>`;

  const win = openPrintWindow(html, report.title);
  win.focus();
  window.setTimeout(() => {
    try {
      win.print();
    } catch {
      // ignore
    }
  }, 400);
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
