import {
  FINANCIAL_SUMMARY_SECTIONS,
  REPORT_COLUMNS,
  getReportRows as getSharedReportRows,
  type AccountingReportType,
  type FinancialSummaryReport,
  type ReportColumn,
  type StudentAccountSummary,
  type StudentRecord
} from "@phit-erp/shared";
import { saveAs } from "file-saver";
import { formatCurrencyNpr } from "lib/utils";
import * as XLSX from "xlsx";

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

export const formatReportCell = (value: unknown, format?: ReportColumn["format"]): string => {
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

export const getReportRows = (reportType: AccountingReportType, rows: unknown[]): Array<Record<string, unknown>> =>
  getSharedReportRows(reportType, rows);

export const getReportCellValue = (row: Record<string, unknown>, column: ReportColumn): string =>
  formatReportCell(getNestedValue(row, column.key), column.format);

const buildSheetData = (reportType: AccountingReportType, rows: unknown[]): string[][] => {
  const columns = REPORT_COLUMNS[reportType];
  const enrichedRows = getReportRows(reportType, rows);
  return [
    columns.map((column) => column.label),
    ...enrichedRows.map((row) => columns.map((column) => getReportCellValue(row, column)))
  ];
};

export const downloadReportExcel = (
  reportType: AccountingReportType,
  reportLabel: string,
  rows: unknown[]
): void => {
  const worksheet = XLSX.utils.aoa_to_sheet(buildSheetData(reportType, rows));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const safeLabel = reportLabel.replace(/[^\w-]+/g, "_").replace(/_+/g, "_");
  saveAs(blob, `${safeLabel}_${reportType}.xlsx`);
};

export const downloadFinancialSummaryExcel = (report: FinancialSummaryReport): void => {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["PHIT LMS — Financial Summary"],
    ["Period", report.period.label],
    [],
    ["Category", "Transactions", "Total (NPR)"],
    ...report.data.map((row) => [row.category, row.transactions, row.totalNpr]),
    [],
    ["Total Fee Collections", "", report.totals.feeCollectionNpr],
    ["Total Income", "", report.totals.incomeNpr],
    ["Total Expenses", "", report.totals.expenseNpr],
    ["Total Purchases", "", report.totals.purchaseNpr],
    ["Total Salaries", "", report.totals.salaryNpr],
    ["Pending Student Fees", "", report.totals.pendingFeesNpr],
    ["Net Surplus", "", report.totals.netSurplusNpr]
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  for (const section of FINANCIAL_SUMMARY_SECTIONS) {
    const rows = report.sections[section.key] ?? [];
    const sheet = XLSX.utils.aoa_to_sheet(
      rows.length > 0
        ? buildSheetData(section.reportType, rows)
        : [
            REPORT_COLUMNS[section.reportType].map((column) => column.label),
            ["No records for this period"]
          ]
    );
    const safeName = section.label.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, sheet, safeName);
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  saveAs(blob, `Financial_Summary_${report.period.monthBs}.xlsx`);
};

export const reportUsesMonthFilter = (reportType: AccountingReportType): boolean =>
  reportType.includes("monthly") ||
  reportType === "salary-payments" ||
  reportType === "expenses" ||
  reportType === "purchases" ||
  reportType === "income" ||
  reportType === "cash-summary" ||
  reportType === "financial-summary";

export const matchesStudentSearch = (student: StudentRecord, query: string): boolean => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    student.user.fullName.toLowerCase().includes(normalized) ||
    student.user.email.toLowerCase().includes(normalized) ||
    (student.user.phone ?? "").toLowerCase().includes(normalized) ||
    student.admissionNumber.toLowerCase().includes(normalized) ||
    student.guardianPhone.toLowerCase().includes(normalized)
  );
};

export const matchesStudentAccountSearch = (account: StudentAccountSummary, query: string): boolean =>
  matchesStudentSearch(account.student, query);