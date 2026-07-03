import type { AccountingReportType, StudentAccountSummary, StudentRecord } from "@nepal-school-erp/shared";
import { formatCurrencyNpr } from "lib/utils";

export interface ReportColumn {
  key: string;
  label: string;
  format?: "currency" | "text";
}

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

export const REPORT_COLUMNS: Record<AccountingReportType, ReportColumn[]> = {
  "daily-fee-collection": [
    { key: "receiptNumber", label: "Receipt" },
    { key: "paidDateBs", label: "Date" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "amountPaidNpr", label: "Paid", format: "currency" },
    { key: "remainingDueNpr", label: "Remaining", format: "currency" },
    { key: "paymentMethod", label: "Method" }
  ],
  "monthly-fee-collection": [
    { key: "receiptNumber", label: "Receipt" },
    { key: "paidDateBs", label: "Date" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "amountPaidNpr", label: "Paid", format: "currency" },
    { key: "paymentMethod", label: "Method" }
  ],
  "pending-fees": [
    { key: "user.fullName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "rollNumber", label: "Roll" },
    { key: "feesDueNpr", label: "Due", format: "currency" }
  ],
  "fee-defaulters": [
    { key: "user.fullName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "rollNumber", label: "Roll" },
    { key: "feesDueNpr", label: "Due", format: "currency" }
  ],
  "salary-payments": [
    { key: "monthBs", label: "Month" },
    { key: "teacherId.user.fullName", label: "Employee" },
    { key: "staffName", label: "Staff" },
    { key: "netSalaryNpr", label: "Net Salary", format: "currency" },
    { key: "status", label: "Status" }
  ],
  expenses: [
    { key: "dateBs", label: "Date" },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Method" }
  ],
  purchases: [
    { key: "purchaseDateBs", label: "Date" },
    { key: "category", label: "Category" },
    { key: "invoiceNumber", label: "Invoice" },
    { key: "totalAmountNpr", label: "Total", format: "currency" },
    { key: "paymentStatus", label: "Status" }
  ],
  income: [
    { key: "dateBs", label: "Date" },
    { key: "category", label: "Category" },
    { key: "source", label: "Source" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Method" }
  ],
  "cash-summary": [
    { key: "dateBs", label: "Date" },
    { key: "entryType", label: "Type" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "balanceAfterNpr", label: "Balance", format: "currency" }
  ]
};

export const formatReportCell = (value: unknown, format?: ReportColumn["format"]): string => {
  if (value === null || value === undefined) {
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
  rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : {}));

export const getReportCellValue = (row: Record<string, unknown>, column: ReportColumn): string =>
  formatReportCell(getNestedValue(row, column.key), column.format);

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