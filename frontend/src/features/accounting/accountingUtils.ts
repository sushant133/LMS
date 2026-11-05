import {
  FINANCIAL_SUMMARY_SECTIONS,
  REPORT_COLUMNS,
  getReportRows as getSharedReportRows,
  isReportStructureRow,
  type AccountingReportType,
  type FinancialSummaryReport,
  type ReportColumn,
  type StudentAccountSummary,
  type StudentRecord,
} from "@phit-erp/shared";
import { adToBs, bsToAd } from "@munatech/nepali-datepicker";
import { saveAs } from "file-saver";
import { api } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
import * as XLSX from "xlsx";

const AD_BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Convert BS YYYY-MM-DD → AD YYYY-MM-DD. Returns "" if invalid. */
export const bsDateToAdString = (dateBs: string): string => {
  const trimmed = dateBs?.trim() ?? "";
  if (!AD_BS_DATE_RE.test(trimmed)) return "";
  try {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (!year || !month || !day) return "";
    const ad = bsToAd(year, month, day);
    return `${ad.year}-${String(ad.month).padStart(2, "0")}-${String(ad.day).padStart(2, "0")}`;
  } catch {
    return "";
  }
};

/** Convert AD YYYY-MM-DD → BS YYYY-MM-DD. Returns "" if invalid. */
export const adDateToBsString = (dateAd: string): string => {
  const trimmed = dateAd?.trim() ?? "";
  if (!AD_BS_DATE_RE.test(trimmed)) return "";
  try {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (!year || !month || !day) return "";
    const bs = adToBs(year, month, day);
    return `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`;
  } catch {
    return "";
  }
};

/**
 * Resolve display pair for a payment/transaction date.
 * Prefer stored values; convert the missing calendar from the other.
 */
export const resolveDualPaymentDates = (input: {
  dateBs?: string | null;
  dateAd?: string | null;
}): { dateBs: string; dateAd: string } => {
  const dateBs = input.dateBs?.trim() || "";
  let dateAd = input.dateAd?.trim() || "";
  if (dateBs && !dateAd) {
    dateAd = bsDateToAdString(dateBs);
  } else if (dateAd && !dateBs) {
    return { dateBs: adDateToBsString(dateAd), dateAd };
  }
  return { dateBs, dateAd };
};

/** Compact dual-date cell: BS + AD lines for tables. */
export const formatDualDateCell = (input: {
  dateBs?: string | null;
  dateAd?: string | null;
}): { primary: string; secondary: string } => {
  const { dateBs, dateAd } = resolveDualPaymentDates(input);
  if (!dateBs && !dateAd) return { primary: "—", secondary: "" };
  if (dateBs && dateAd) {
    return { primary: `BS ${dateBs}`, secondary: `AD ${dateAd}` };
  }
  if (dateBs) return { primary: `BS ${dateBs}`, secondary: "" };
  return { primary: `AD ${dateAd}`, secondary: "" };
};

export { FINANCIAL_SUMMARY_SECTIONS, REPORT_COLUMNS };
export type { ReportColumn };

const getNestedValue = (row: Record<string, unknown>, key: string): unknown => {
  if (key.includes(".")) {
    return key.split(".").reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[part];
    }, row);
  }

  return row[key];
};

export const formatReportCell = (
  value: unknown,
  format?: ReportColumn["format"],
): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (format === "currency" && typeof value === "number") {
    return formatCurrencyNpr(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value).replace(/_/g, " ");
};

export const getReportRows = (
  reportType: AccountingReportType,
  rows: unknown[],
): Array<Record<string, unknown>> => getSharedReportRows(reportType, rows);

export const getReportCellValue = (
  row: Record<string, unknown>,
  column: ReportColumn,
): string => {
  const value = getNestedValue(row, column.key);
  // Statement headings and total lines leave their unused cells blank.
  if (
    isReportStructureRow(row) &&
    (value === null || value === undefined || value === "")
  ) {
    return "";
  }
  return formatReportCell(value, column.format);
};

const buildSheetData = (
  reportType: AccountingReportType,
  rows: unknown[],
): string[][] => {
  const columns = REPORT_COLUMNS[reportType];
  const enrichedRows = getReportRows(reportType, rows);
  return [
    columns.map((column) => column.label),
    ...enrichedRows.map((row) =>
      columns.map((column) => getReportCellValue(row, column)),
    ),
  ];
};

/**
 * Export CSV: the server builds it (same columns as the report table, UTF-8 BOM) and
 * names it "<type>-<from>-<to>.csv".
 */
export const downloadReportCsv = async (
  reportType: AccountingReportType,
  path: string,
  params: { fromDateBs?: string; toDateBs?: string } & Record<string, unknown>,
): Promise<void> => {
  const response = await api.get(path, {
    params: { ...params, format: "csv" },
    responseType: "blob",
  });
  const blob = response.data as Blob;
  if (!String(response.headers["content-type"] ?? "").includes("text/csv")) {
    throw new Error("The server did not return a CSV file");
  }
  const fileName =
    /filename="([^"]+)"/.exec(String(response.headers["content-disposition"] ?? ""))?.[1] ??
    `${[reportType, params.fromDateBs || "start", params.toDateBs || "today"].join("-")}.csv`;
  saveAs(blob, fileName);
};

export const downloadReportExcel = (
  reportType: AccountingReportType,
  reportLabel: string,
  rows: unknown[],
): void => {
  const worksheet = XLSX.utils.aoa_to_sheet(buildSheetData(reportType, rows));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeLabel = reportLabel.replace(/[^\w-]+/g, "_").replace(/_+/g, "_");
  saveAs(blob, `${safeLabel}_${reportType}.xlsx`);
};

export { labelYearsWithBatch } from "lib/academicStructureUtils";

export interface RegisterColumn<T> {
  label: string;
  /** `index` is the row's 0-based position in the export. */
  value: (row: T, index: number) => string | number | null | undefined;
  /** Amount column: NPR formatting and a TOTAL at the bottom. */
  amount?: boolean;
  /** Too narrow for the "TOTAL (n)" label (e.g. S.N), so it goes in the next column. */
  noTotalLabel?: boolean;
}

const escapeHtmlText = (value: string) =>
  value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Register list → Excel file, or → a printable HTML table, with a TOTAL row. */
export const exportRegister = <T,>(opts: {
  title: string;
  columns: Array<RegisterColumn<T>>;
  rows: T[];
  format: "xlsx" | "html";
}): string | void => {
  const totals = opts.columns.map((column) =>
    column.amount
      ? opts.rows.reduce((sum, row, rowIndex) => sum + (Number(column.value(row, rowIndex)) || 0), 0)
      : null,
  );
  const totalLabelIndex = opts.columns.findIndex(
    (column) => !column.amount && !column.noTotalLabel,
  );
  if (opts.format === "xlsx") {
    const sheet = XLSX.utils.aoa_to_sheet([
      opts.columns.map((column) => column.label),
      ...opts.rows.map((row, rowIndex) =>
        opts.columns.map((column) => {
          const value = column.value(row, rowIndex);
          return value === null || value === undefined ? "" : value;
        }),
      ),
      opts.columns.map((_, index) =>
        index === totalLabelIndex
          ? `TOTAL (${opts.rows.length})`
          : (totals[index] ?? ""),
      ),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Register");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${opts.title.replace(/[^\w-]+/g, "_")}.xlsx`,
    );
    return;
  }
  const cell = (column: RegisterColumn<T>, value: unknown) => {
    if (value === null || value === undefined || value === "") return "";
    return column.amount && typeof value === "number"
      ? formatCurrencyNpr(value)
      : escapeHtmlText(String(value));
  };
  const head = opts.columns
    .map((column) => `<th${column.amount ? ' style="text-align:right"' : ""}>${escapeHtmlText(column.label)}</th>`)
    .join("");
  const body = opts.rows
    .map(
      (row, rowIndex) =>
        `<tr>${opts.columns
          .map(
            (column) =>
              `<td${column.amount ? ' style="text-align:right"' : ""}>${cell(column, column.value(row, rowIndex))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const foot = `<tr style="font-weight:700;border-top:2px solid #94a3b8">${opts.columns
    .map((column, index) =>
      index === totalLabelIndex
        ? `<td>TOTAL (${opts.rows.length})</td>`
        : `<td style="text-align:right">${totals[index] !== null ? formatCurrencyNpr(totals[index]!) : ""}</td>`,
    )
    .join("")}</tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
};

/** Generic Excel export for record tables (not typed accounting report columns). */
export const downloadRecordsExcel = (
  filename: string,
  rows: Array<Record<string, unknown>>,
): void => {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map((row) => headers.map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      return v as string | number | boolean;
    })),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Records");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safe = filename.replace(/[^\w-]+/g, "_").replace(/_+/g, "_");
  saveAs(blob, `${safe}.xlsx`);
};

export const downloadFinancialSummaryExcel = (
  report: FinancialSummaryReport,
): void => {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["PHIT LMS — Financial Summary"],
    ["Period", report.period.label],
    [],
    ["Category", "Transactions", "Total (NPR)"],
    ...report.data.map((row) => [row.category, row.transactions ?? "", row.totalNpr]),
    [],
    ["Total Fee Collections", "", report.totals.feeCollectionNpr],
    ["Total Other Income", "", report.totals.incomeNpr],
    ["Total Indirect Expenses", "", report.totals.expenseNpr],
    ["Total Direct Expense (paid)", "", report.totals.purchaseNpr],
    ["Total Salaries", "", report.totals.salaryNpr],
    ["Total Refunds", "", report.totals.refundNpr ?? 0],
    ["Net Surplus", "", report.totals.netSurplusNpr],
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  for (const section of FINANCIAL_SUMMARY_SECTIONS) {
    const rows = report.sections[section.key] ?? [];
    const sheet = XLSX.utils.aoa_to_sheet(
      rows.length > 0
        ? buildSheetData(section.reportType, rows)
        : [
            REPORT_COLUMNS[section.reportType].map((column) => column.label),
            ["No records for this period"],
          ],
    );
    const safeName = section.label.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, sheet, safeName);
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `Financial_Summary_${report.period.label.replace(/[^\w-]+/g, "_")}.xlsx`);
};

export const reportUsesMonthFilter = (
  reportType: AccountingReportType,
): boolean =>
  reportType.includes("monthly") ||
  reportType === "salary-payments" ||
  reportType === "expenses" ||
  reportType === "purchases" ||
  reportType === "income" ||
  reportType === "refunds" ||
  reportType === "journal" ||
  reportType === "ledger" ||
  reportType === "cash-summary" ||
  reportType === "financial-summary";

export const matchesStudentSearch = (
  student: StudentRecord,
  query: string,
): boolean => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    (student.user?.fullName ?? "").toLowerCase().includes(normalized) ||
    (student.user?.email ?? "").toLowerCase().includes(normalized) ||
    (student.user?.phone ?? "").toLowerCase().includes(normalized) ||
    (student.admissionNumber ?? "").toLowerCase().includes(normalized) ||
    (student.guardianPhone ?? "").toLowerCase().includes(normalized)
  );
};

export const matchesStudentAccountSearch = (
  account: StudentAccountSummary,
  query: string,
): boolean => matchesStudentSearch(account.student, query);
