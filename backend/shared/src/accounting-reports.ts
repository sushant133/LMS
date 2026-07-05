import type { AccountingReportType } from "./accounting-types.js";

export interface ReportColumn {
  key: string;
  label: string;
  format?: "currency" | "text";
}

export const REPORT_COLUMNS: Record<AccountingReportType, ReportColumn[]> = {
  "daily-fee-collection": [
    { key: "receiptNumber", label: "Receipt No." },
    { key: "paidDateBs", label: "Paid Date (BS)" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "studentId.admissionNumber", label: "Admission No." },
    { key: "currentChargesNpr", label: "Current Charges", format: "currency" },
    { key: "discountNpr", label: "Discount", format: "currency" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "lateFeeNpr", label: "Late Fine", format: "currency" },
    { key: "amountPaidNpr", label: "Amount Paid", format: "currency" },
    { key: "remainingDueNpr", label: "Remaining Due", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "accountantName", label: "Collected By" },
    { key: "notes", label: "Notes" }
  ],
  "monthly-fee-collection": [
    { key: "receiptNumber", label: "Receipt No." },
    { key: "paidDateBs", label: "Paid Date (BS)" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "studentId.admissionNumber", label: "Admission No." },
    { key: "currentChargesNpr", label: "Current Charges", format: "currency" },
    { key: "discountNpr", label: "Discount", format: "currency" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "lateFeeNpr", label: "Late Fine", format: "currency" },
    { key: "amountPaidNpr", label: "Amount Paid", format: "currency" },
    { key: "remainingDueNpr", label: "Remaining Due", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "accountantName", label: "Collected By" }
  ],
  "pending-fees": [
    { key: "user.fullName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "rollNumber", label: "Roll No." },
    { key: "user.phone", label: "Phone" },
    { key: "feesDueNpr", label: "Outstanding Due", format: "currency" }
  ],
  "fee-defaulters": [
    { key: "user.fullName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "rollNumber", label: "Roll No." },
    { key: "user.phone", label: "Phone" },
    { key: "feesDueNpr", label: "Outstanding Due", format: "currency" }
  ],
  "salary-payments": [
    { key: "monthBs", label: "Month (BS)" },
    { key: "employeeType", label: "Type" },
    { key: "employeeName", label: "Employee" },
    { key: "basicSalaryNpr", label: "Basic Salary", format: "currency" },
    { key: "allowancesNpr", label: "Allowances", format: "currency" },
    { key: "bonusNpr", label: "Bonus", format: "currency" },
    { key: "loanDeductionNpr", label: "Loan Deduction", format: "currency" },
    { key: "taxNpr", label: "Tax", format: "currency" },
    { key: "otherDeductionsNpr", label: "Other Deductions", format: "currency" },
    { key: "netSalaryNpr", label: "Net Salary", format: "currency" },
    { key: "status", label: "Status" },
    { key: "paidDateBs", label: "Paid Date (BS)" },
    { key: "paymentMethod", label: "Payment Method" }
  ],
  expenses: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" }
  ],
  purchases: [
    { key: "purchaseDateBs", label: "Date (BS)" },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "invoiceNumber", label: "Invoice No." },
    { key: "quantity", label: "Qty" },
    { key: "unitPriceNpr", label: "Unit Price", format: "currency" },
    { key: "totalAmountNpr", label: "Total Amount", format: "currency" },
    { key: "paymentStatus", label: "Payment Status" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "description", label: "Description" }
  ],
  income: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "category", label: "Category" },
    { key: "source", label: "Source" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" }
  ],
  "cash-summary": [
    { key: "dateBs", label: "Date (BS)" },
    { key: "entryType", label: "Entry Type" },
    { key: "category", label: "Category" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "balanceAfterNpr", label: "Balance After", format: "currency" }
  ],
  "financial-summary": [
    { key: "category", label: "Category" },
    { key: "transactions", label: "Transactions" },
    { key: "totalNpr", label: "Total (NPR)", format: "currency" }
  ],
  "trial-balance": [
    { key: "accountCode", label: "Code" },
    { key: "accountName", label: "Account" },
    { key: "accountType", label: "Type" },
    { key: "debitNpr", label: "Debit", format: "currency" },
    { key: "creditNpr", label: "Credit", format: "currency" }
  ],
  "balance-sheet": [
    { key: "accountCode", label: "Code" },
    { key: "accountName", label: "Account" },
    { key: "balanceNpr", label: "Balance", format: "currency" }
  ],
  "income-expenditure": [
    { key: "accountName", label: "Account" },
    { key: "amountNpr", label: "Amount", format: "currency" }
  ],
  "cash-flow": [
    { key: "cashInflowNpr", label: "Cash Inflow", format: "currency" },
    { key: "cashOutflowNpr", label: "Cash Outflow", format: "currency" },
    { key: "netCashFlowNpr", label: "Net Cash Flow", format: "currency" }
  ],
  "student-ledger": [
    { key: "admissionNumber", label: "Admission No." },
    { key: "fullName", label: "Student" },
    { key: "batchName", label: "Batch" },
    { key: "totalPaidNpr", label: "Total Paid", format: "currency" },
    { key: "outstandingBalanceNpr", label: "Outstanding", format: "currency" }
  ],
  "student-due": [
    { key: "admissionNumber", label: "Admission No." },
    { key: "fullName", label: "Student" },
    { key: "outstandingBalanceNpr", label: "Outstanding", format: "currency" }
  ],
  "bank-book": [
    { key: "dateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher" },
    { key: "debitNpr", label: "Debit", format: "currency" },
    { key: "creditNpr", label: "Credit", format: "currency" },
    { key: "balanceNpr", label: "Balance", format: "currency" }
  ],
  "day-book": [
    { key: "dateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher" },
    { key: "narration", label: "Narration" },
    { key: "totalDebitNpr", label: "Debit", format: "currency" },
    { key: "totalCreditNpr", label: "Credit", format: "currency" }
  ],
  "fee-collection-summary": [
    { key: "feeType", label: "Fee Type" },
    { key: "count", label: "Transactions" },
    { key: "totalNpr", label: "Total", format: "currency" }
  ],
  "scholarship-report": [
    { key: "paidDateBs", label: "Date (BS)" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" }
  ],
  "vendor-ledger": [
    { key: "vendor", label: "Vendor" },
    { key: "amountNpr", label: "Amount", format: "currency" }
  ]
};

export const FINANCIAL_SUMMARY_SECTIONS: Array<{
  key: keyof FinancialSummarySections;
  label: string;
  reportType: AccountingReportType;
}> = [
  { key: "fees", label: "Fee Collections", reportType: "monthly-fee-collection" },
  { key: "income", label: "Income", reportType: "income" },
  { key: "expenses", label: "Expenses", reportType: "expenses" },
  { key: "purchases", label: "Purchases", reportType: "purchases" },
  { key: "salaries", label: "Salary Payments", reportType: "salary-payments" }
];

export interface FinancialSummaryTotals {
  feeCollectionNpr: number;
  incomeNpr: number;
  expenseNpr: number;
  purchaseNpr: number;
  salaryNpr: number;
  pendingFeesNpr: number;
  netSurplusNpr: number;
}

export interface FinancialSummarySections {
  fees: unknown[];
  income: unknown[];
  expenses: unknown[];
  purchases: unknown[];
  salaries: unknown[];
}

export interface FinancialSummaryReport {
  reportType: "financial-summary";
  period: { monthBs: string; label: string };
  totals: FinancialSummaryTotals;
  sections: FinancialSummarySections;
  data: Array<{ category: string; transactions: number; totalNpr: number }>;
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

export const enrichReportRow = (
  reportType: AccountingReportType,
  row: Record<string, unknown>
): Record<string, unknown> => {
  if (reportType === "salary-payments") {
    const teacherRef = row.teacherId;
    const staffRef = row.staffId;
    let employeeName = row.staffName ?? "—";

    if (teacherRef && typeof teacherRef === "object") {
      const user = (teacherRef as { user?: { fullName?: string } }).user;
      if (user?.fullName) {
        employeeName = user.fullName;
      }
    } else if (staffRef && typeof staffRef === "object" && "fullName" in staffRef) {
      employeeName = String((staffRef as { fullName?: string }).fullName ?? employeeName);
    }

    return { ...row, employeeName };
  }

  return row;
};

export const formatReportCell = (value: unknown, format?: ReportColumn["format"]): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (format === "currency" && typeof value === "number") {
    return `NPR ${value.toLocaleString("en-NP")}`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value).replace(/_/g, " ");
};

export const getReportRows = (
  reportType: AccountingReportType,
  rows: unknown[]
): Array<Record<string, unknown>> =>
  rows.map((row) => {
    if (!row || typeof row !== "object") {
      return {};
    }
    return enrichReportRow(reportType, row as Record<string, unknown>);
  });

export const getReportCellValue = (row: Record<string, unknown>, column: ReportColumn): string =>
  formatReportCell(getNestedValue(row, column.key), column.format);

export const buildReportCsv = (reportType: AccountingReportType, rows: unknown[]): string => {
  const columns = REPORT_COLUMNS[reportType];
  const enrichedRows = getReportRows(reportType, rows);

  if (enrichedRows.length === 0) {
    return "No data";
  }

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = columns.map((column) => escape(column.label)).join(",");
  const body = enrichedRows
    .map((row) => columns.map((column) => escape(getReportCellValue(row, column))).join(","))
    .join("\n");

  return `${header}\n${body}`;
};

export const buildFinancialSummaryCsv = (report: FinancialSummaryReport): string => {
  const lines: string[] = [
    "PHIT ERP — Financial Summary",
    `Period,${report.period.label}`,
    "",
    "Category,Transactions,Total (NPR)",
    ...report.data.map((row) => `${row.category},${row.transactions},${row.totalNpr}`),
    "",
    "Totals",
    `Fee Collections,,${report.totals.feeCollectionNpr}`,
    `Income,,${report.totals.incomeNpr}`,
    `Expenses,,${report.totals.expenseNpr}`,
    `Purchases,,${report.totals.purchaseNpr}`,
    `Salaries,,${report.totals.salaryNpr}`,
    `Pending Student Fees,,${report.totals.pendingFeesNpr}`,
    `Net Surplus,,${report.totals.netSurplusNpr}`
  ];

  for (const section of FINANCIAL_SUMMARY_SECTIONS) {
    const rows = report.sections[section.key] ?? [];
    if (rows.length === 0) {
      continue;
    }

    lines.push("", section.label, buildReportCsv(section.reportType, rows));
  }

  return lines.join("\n");
};

export const sumAmount = (rows: unknown[], field: string): number =>
  rows.reduce<number>((sum, row) => {
    if (!row || typeof row !== "object") {
      return sum;
    }
    const value = (row as Record<string, unknown>)[field];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);

export const buildFinancialSummaryRows = (
  totals: FinancialSummaryTotals,
  counts: { fees: number; income: number; expenses: number; purchases: number; salaries: number; pendingStudents: number }
): FinancialSummaryReport["data"] => [
  { category: "Fee Collections", transactions: counts.fees, totalNpr: totals.feeCollectionNpr },
  { category: "Income", transactions: counts.income, totalNpr: totals.incomeNpr },
  { category: "Expenses", transactions: counts.expenses, totalNpr: totals.expenseNpr },
  { category: "Purchases", transactions: counts.purchases, totalNpr: totals.purchaseNpr },
  { category: "Salary Payments", transactions: counts.salaries, totalNpr: totals.salaryNpr },
  { category: "Pending Student Fees", transactions: counts.pendingStudents, totalNpr: totals.pendingFeesNpr },
  { category: "Net Surplus (Income − Outflow)", transactions: 0, totalNpr: totals.netSurplusNpr }
];