import type { AccountingReportType } from "./accounting-types.js";

export interface ReportColumn {
  key: string;
  label: string;
  format?: "currency" | "text";
  /** Leave this amount column out of the TOTAL row (e.g. unit price). */
  noTotal?: boolean;
  /** Add this count column into the TOTAL row too (amount columns are always summed). */
  sum?: boolean;
}

export const REPORT_COLUMNS: Record<AccountingReportType, ReportColumn[]> = {
  "daily-fee-collection": [
    { key: "receiptNumber", label: "Receipt No." },
    { key: "paidDateBs", label: "Paid Date (BS)" },
    { key: "paidDateAd", label: "Paid Date (AD)" },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "studentId.admissionNumber", label: "Admission No." },
    { key: "currentChargesNpr", label: "Current Charges", format: "currency" },
    { key: "discountNpr", label: "Discount", format: "currency" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "lateFeeNpr", label: "Late Fine", format: "currency" },
    { key: "amountPaidNpr", label: "Fee Paid", format: "currency" },
    { key: "securityDepositPaidNpr", label: "Security Deposit", format: "currency" },
    { key: "totalReceivedNpr", label: "Total Received", format: "currency" },
    { key: "remainingDueNpr", label: "Remaining Due", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "receivedByName", label: "Received By" },
    { key: "paidByName", label: "Paid By / Depositor" },
    { key: "accountantName", label: "Collected By" },
    { key: "notes", label: "Notes" }
  ],
  /** One row per BS month. */
  "monthly-fee-collection": [
    { key: "monthBs", label: "Month (BS)" },
    { key: "receipts", label: "No. of Receipts", sum: true },
    { key: "amountPaidNpr", label: "Fee Paid", format: "currency" },
    { key: "discountNpr", label: "Discount", format: "currency" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "lateFeeNpr", label: "Late Fine", format: "currency" },
    { key: "securityDepositPaidNpr", label: "Security Deposit", format: "currency" },
    { key: "totalReceivedNpr", label: "Total Received", format: "currency" }
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
    { key: "extraAmountNpr", label: "Extra Amount", format: "currency" },
    { key: "absentDeductionNpr", label: "Absent Deduction", format: "currency" },
    { key: "advanceSalaryNpr", label: "Advance Salary", format: "currency" },
    { key: "loanDeductionNpr", label: "Loan Deduction", format: "currency" },
    { key: "taxNpr", label: "Tax", format: "currency" },
    { key: "otherDeductionsNpr", label: "Other Deductions", format: "currency" },
    { key: "roundingNpr", label: "Rounding", format: "currency" },
    { key: "netSalaryNpr", label: "Net Salary", format: "currency" },
    { key: "status", label: "Status" },
    { key: "paidDateBs", label: "Paid Date (BS)" },
    { key: "paymentMethod", label: "Payment Method" }
  ],
  expenses: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher No." },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "approvedBy", label: "Approved By" }
  ],
  purchases: [
    { key: "purchaseDateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher No." },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "invoiceNumber", label: "Bill No." },
    { key: "item", label: "Item" },
    { key: "quantity", label: "Qty", sum: true },
    { key: "unitPriceNpr", label: "Unit Price", format: "currency", noTotal: true },
    { key: "totalAmountNpr", label: "Total Amount", format: "currency" },
    { key: "paymentStatus", label: "Payment Status" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "description", label: "Remarks" }
  ],
  income: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "receiptNumber", label: "Receipt No." },
    { key: "category", label: "Income Type" },
    { key: "source", label: "Source" },
    { key: "description", label: "Description" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Mode" }
  ],
  refunds: [
    { key: "refundNumber", label: "Refund No." },
    { key: "dateBs", label: "Date (BS)" },
    { key: "studentName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "refundType", label: "Type" },
    { key: "reason", label: "Reason" },
    { key: "amountNpr", label: "Amount", format: "currency" },
    { key: "paymentMethod", label: "Payment Method" },
    { key: "approvedByName", label: "Approved By" }
  ],
  /** One row per voucher line (account-wise Dr / Cr), voucher details on its first line. */
  journal: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher No." },
    { key: "voucherType", label: "Type" },
    { key: "accountCode", label: "Code" },
    { key: "accountName", label: "Account" },
    { key: "particulars", label: "Particulars" },
    { key: "debitNpr", label: "Debit", format: "currency" },
    { key: "creditNpr", label: "Credit", format: "currency" },
    { key: "sourceLabel", label: "Source" }
  ],
  ledger: [
    { key: "dateBs", label: "Date (BS)" },
    { key: "voucherNumber", label: "Voucher No." },
    { key: "accountCode", label: "Account Code" },
    { key: "accountName", label: "Account" },
    { key: "narration", label: "Particulars" },
    { key: "debitNpr", label: "Debit", format: "currency" },
    { key: "creditNpr", label: "Credit", format: "currency" },
    { key: "runningBalanceNpr", label: "Balance", format: "currency" },
    { key: "balanceSide", label: "Dr/Cr" }
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
    { key: "accountCode", label: "Code" },
    { key: "accountName", label: "Account" },
    { key: "amountNpr", label: "Amount", format: "currency" }
  ],
  "cash-flow": [
    { key: "particulars", label: "Particulars" },
    { key: "amountNpr", label: "Amount", format: "currency" }
  ],
  "receivables-aging": [
    { key: "studentName", label: "Student" },
    { key: "admissionNumber", label: "Admission No." },
    { key: "phone", label: "Phone" },
    { key: "lastPaymentDateBs", label: "Last Paid (BS)" },
    { key: "daysOutstanding", label: "Days" },
    { key: "current", label: "0–30", format: "currency" },
    { key: "days31to60", label: "31–60", format: "currency" },
    { key: "days61to90", label: "61–90", format: "currency" },
    { key: "over90", label: "90+", format: "currency" },
    { key: "outstandingNpr", label: "Total Due", format: "currency" }
  ],
  /**
   * All students: one line each (Receipt / Ref = admission no.). One student: fee charged, each
   * receipt, scholarship awards and refunds with a running balance. Advance and Refunds are
   * shown for information; the balance is fee charged − paid − discount − scholarship.
   */
  "student-ledger": [
    { key: "dateBs", label: "Date (BS)" },
    { key: "refNo", label: "Receipt / Ref" },
    { key: "particulars", label: "Particulars" },
    { key: "debitNpr", label: "Charges", format: "currency" },
    { key: "creditNpr", label: "Paid", format: "currency" },
    { key: "discountNpr", label: "Discount", format: "currency" },
    { key: "scholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "fineNpr", label: "Fine", format: "currency" },
    { key: "advanceNpr", label: "Advance", format: "currency" },
    { key: "refundNpr", label: "Refunds", format: "currency" },
    { key: "balanceNpr", label: "Balance Due", format: "currency" }
  ],
  /** One line per student. */
  "student-due": [
    { key: "admissionNumber", label: "Admission No." },
    { key: "fullName", label: "Student" },
    { key: "batchName", label: "Batch" },
    { key: "yearName", label: "Year" },
    { key: "totalPayableNpr", label: "Total Payable", format: "currency" },
    { key: "totalDiscountNpr", label: "Discount", format: "currency" },
    { key: "totalScholarshipNpr", label: "Scholarship", format: "currency" },
    { key: "totalFineNpr", label: "Fine", format: "currency" },
    { key: "totalPaidNpr", label: "Total Paid", format: "currency" },
    { key: "advanceBalanceNpr", label: "of which Advance", format: "currency" },
    { key: "totalRefundsNpr", label: "Refunds", format: "currency" },
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
    { key: "voucherType", label: "Type" },
    { key: "sourceLabel", label: "Source" },
    { key: "narration", label: "Narration" },
    { key: "totalDebitNpr", label: "Debit", format: "currency" },
    { key: "totalCreditNpr", label: "Credit", format: "currency" }
  ],
  "fee-collection-summary": [
    { key: "feeType", label: "Fee Type" },
    { key: "count", label: "Receipts" },
    { key: "totalNpr", label: "Total", format: "currency" }
  ],
  "scholarship-report": [
    { key: "paidDateBs", label: "Date (BS)" },
    { key: "receiptNumber", label: "Receipt No." },
    { key: "studentId.user.fullName", label: "Student" },
    { key: "studentId.admissionNumber", label: "Admission No." },
    { key: "scholarshipType", label: "Scholarship Type" },
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
  { key: "fees", label: "Fee Collections", reportType: "daily-fee-collection" },
  { key: "income", label: "Other Income", reportType: "income" },
  { key: "expenses", label: "Indirect Expenses", reportType: "expenses" },
  { key: "purchases", label: "Direct Expense", reportType: "purchases" },
  { key: "salaries", label: "Salary Payments", reportType: "salary-payments" },
  { key: "refunds", label: "Refunds", reportType: "refunds" }
];

export interface FinancialSummaryTotals {
  feeCollectionNpr: number;
  incomeNpr: number;
  expenseNpr: number;
  purchaseNpr: number;
  salaryNpr: number;
  /** Fee / deposit refunds paid out in the period (cash outflow). */
  refundNpr?: number;
  pendingFeesNpr: number;
  netSurplusNpr: number;
}

export interface FinancialSummarySections {
  fees: unknown[];
  income: unknown[];
  expenses: unknown[];
  purchases: unknown[];
  salaries: unknown[];
  refunds?: unknown[];
}

export interface FinancialSummaryReport {
  reportType: "financial-summary";
  period: { monthBs: string; label: string };
  totals: FinancialSummaryTotals;
  sections: FinancialSummarySections;
  data: Array<{ category: string; transactions: number | null; totalNpr: number; rowKind?: string }>;
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

/** Readable source for a journal voucher's referenceType. */
export const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  FeeCollection: "Student Fee",
  FeeRefund: "Refund",
  SalaryPayment: "Salary",
  AccountingExpense: "Indirect Expense",
  AccountingPurchase: "Direct Expense",
  AccountingIncome: "Other Income",
  GoshwaraVoucher: "Journal Voucher",
  CashBookEntry: "Cash Book",
  Manual: "Manual"
};

const FEE_RECEIPT_REPORTS = new Set<AccountingReportType>([
  "daily-fee-collection",
  "scholarship-report"
]);

export const enrichReportRow = (
  reportType: AccountingReportType,
  row: Record<string, unknown>
): Record<string, unknown> => {
  if (row.rowKind) {
    return row;
  }

  if (FEE_RECEIPT_REPORTS.has(reportType)) {
    const paid = Number(row.amountPaidNpr) || 0;
    const deposit = Number(row.securityDepositPaidNpr) || 0;
    const scholarshipType = String(row.scholarshipType ?? "");
    return {
      ...row,
      securityDepositPaidNpr: deposit,
      totalReceivedNpr: paid + deposit,
      // A scholarship amount saved without a type shows "—" (unknown), never "NONE".
      scholarshipType: !scholarshipType || scholarshipType === "NONE" ? "" : scholarshipType
    };
  }

  if (reportType === "journal" && !row.voucherNumber) {
    // Continuation line of a voucher: no source label repeated.
    return row;
  }

  if (reportType === "journal" || reportType === "day-book") {
    const ref = String(row.referenceType ?? "");
    const isContra = row.voucherType === "CONTRA";
    return {
      ...row,
      sourceLabel: isContra ? "Cash/Bank Transfer" : JOURNAL_SOURCE_LABELS[ref] ?? (ref || "Manual")
    };
  }

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

    // Salary-sheet rows store the month's earned salary (basic − absent + extra); period and
    // tender rows earn per period / per syllabus. Basic is shown as the earned basic so the
    // row adds up: Basic + Allowances + Bonus + Extra − Absent − Advance − Loan − Tax − Other = Net.
    const earned = Number(row.salaryAmountNpr) || 0;
    const basicSalaryNpr =
      earned > 0
        ? round2(earned - (Number(row.extraAmountNpr) || 0) + (Number(row.absentDeductionNpr) || 0))
        : row.basicSalaryNpr;
    // Net is paid in whole rupees; Rounding is what is left so the row adds up exactly.
    const num = (key: string) => Number(row[key]) || 0;
    const beforeRounding =
      (Number(basicSalaryNpr) || 0) + num("allowancesNpr") + num("bonusNpr") + num("extraAmountNpr") -
      num("absentDeductionNpr") - num("advanceSalaryNpr") - num("loanDeductionNpr") - num("taxNpr") -
      num("otherDeductionsNpr");
    const roundingNpr = round2(num("netSalaryNpr") - beforeRounding);
    return { ...row, employeeName, basicSalaryNpr, roundingNpr };
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

/**
 * Transaction lists that end with a TOTAL row of their amount columns. Statements
 * (trial balance, balance sheet, …) and the ledger build their own totals server-side.
 */
export const REPORTS_WITH_TOTAL_ROW = new Set<AccountingReportType>([
  "daily-fee-collection",
  "monthly-fee-collection",
  "pending-fees",
  "fee-defaulters",
  "salary-payments",
  "expenses",
  "purchases",
  "income",
  "refunds",
  "journal",
  "day-book",
  "scholarship-report",
  "student-due"
]);

/** Reports with more than one TOTAL row (salary: paid, and not yet paid, totalled apart). */
const TOTAL_ROW_FILTERS: Partial<
  Record<AccountingReportType, Array<{ include: (row: Record<string, unknown>) => boolean; label: string; always?: boolean }>>
> = {
  "salary-payments": [
    { include: (row) => row.status === "PAID", label: "TOTAL PAID", always: true },
    { include: (row) => row.status !== "PAID", label: "TOTAL NOT PAID (DRAFT / APPROVED / PENDING)" }
  ]
};

const setNestedValue = (row: Record<string, unknown>, key: string, value: unknown) => {
  const parts = key.split(".");
  let current = row;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
  current[parts[parts.length - 1]!] = value;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * TOTAL row(s) for a transaction list: sums every currency column (and count columns marked
 * `sum`). Heading / subtotal rows are not counted, so a grand total never double-counts.
 */
export const buildReportTotalRows = (
  reportType: AccountingReportType,
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => {
  if (!REPORTS_WITH_TOTAL_ROW.has(reportType)) return [];
  const dataRows = rows.filter((row) => !row.rowKind);
  if (dataRows.length === 0) return [];
  const columns = REPORT_COLUMNS[reportType];
  const labelColumn = columns.find((column) => column.format !== "currency" && !column.sum);
  const filters = TOTAL_ROW_FILTERS[reportType] ?? [{ include: () => true, label: "TOTAL", always: true }];
  return filters.flatMap((filter) => {
    const counted = dataRows.filter(filter.include);
    if (!counted.length && !filter.always) return [];
    const total: Record<string, unknown> = { rowKind: "total" };
    if (labelColumn) setNestedValue(total, labelColumn.key, `${filter.label} (${counted.length})`);
    for (const column of columns) {
      if (!column.sum && (column.format !== "currency" || column.noTotal)) continue;
      const sum = counted.reduce((acc, row) => {
        const value = getNestedValue(row, column.key);
        return acc + (typeof value === "number" ? value : 0);
      }, 0);
      setNestedValue(total, column.key, round2(sum));
    }
    return [total];
  });
};

/** Report rows ready to render/export: enriched, plus a TOTAL row where it applies. */
export const getReportRows = (
  reportType: AccountingReportType,
  rows: unknown[]
): Array<Record<string, unknown>> => {
  const enriched = rows.map((row) => {
    if (!row || typeof row !== "object") {
      return {};
    }
    return enrichReportRow(reportType, row as Record<string, unknown>);
  });
  return [...enriched, ...buildReportTotalRows(reportType, enriched)];
};

/** Heading and total rows of a statement leave their empty cells blank (not "—"). */
export const isReportStructureRow = (row: Record<string, unknown>): boolean =>
  row.rowKind === "heading" || row.rowKind === "subtotal" || row.rowKind === "total";

export const getReportRawValue = (row: Record<string, unknown>, column: ReportColumn): unknown =>
  getNestedValue(row, column.key);

export const getReportCellValue = (row: Record<string, unknown>, column: ReportColumn): string => {
  const value = getNestedValue(row, column.key);
  if (isReportStructureRow(row) && (value === null || value === undefined || value === "")) {
    return "";
  }
  return formatReportCell(value, column.format);
};

export const buildReportCsv = (reportType: AccountingReportType, rows: unknown[]): string => {
  const columns = REPORT_COLUMNS[reportType];
  const enrichedRows = getReportRows(reportType, rows);
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = columns.map((column) => escape(column.label)).join(",");
  const body = enrichedRows
    .map((row) => columns.map((column) => escape(getReportCellValue(row, column))).join(","))
    .join("\r\n");

  // An empty period still exports the column headings.
  return body ? `${header}\r\n${body}` : header;
};

export const buildFinancialSummaryCsv = (report: FinancialSummaryReport): string => {
  const lines: string[] = [
    "PHIT LMS — Financial Summary",
    `Period,${report.period.label}`,
    "",
    "Category,Transactions,Total (NPR)",
    ...report.data.map((row) => `${row.category},${row.transactions ?? ""},${row.totalNpr}`),
    "",
    "Totals",
    `Fee Collections,,${report.totals.feeCollectionNpr}`,
    `Other Income,,${report.totals.incomeNpr}`,
    `Indirect Expenses,,${report.totals.expenseNpr}`,
    `Direct Expense,,${report.totals.purchaseNpr}`,
    `Salaries,,${report.totals.salaryNpr}`,
    `Refunds,,${report.totals.refundNpr ?? 0}`,
    `Net Surplus,,${report.totals.netSurplusNpr}`
  ];

  for (const section of FINANCIAL_SUMMARY_SECTIONS) {
    const rows = report.sections[section.key] ?? [];
    if (rows.length === 0) {
      continue;
    }

    lines.push("", section.label, buildReportCsv(section.reportType, rows));
  }

  return lines.join("\r\n");
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
  counts: {
    fees: number;
    income: number;
    expenses: number;
    purchases: number;
    salaries: number;
    refunds?: number;
    pendingStudents: number;
  }
): FinancialSummaryReport["data"] => [
  { category: "Fee Collections", transactions: counts.fees, totalNpr: totals.feeCollectionNpr },
  { category: "Other Income", transactions: counts.income, totalNpr: totals.incomeNpr },
  { category: "Indirect Expenses", transactions: counts.expenses, totalNpr: totals.expenseNpr },
  { category: "Direct Expense (paid)", transactions: counts.purchases, totalNpr: totals.purchaseNpr },
  { category: "Salary Payments", transactions: counts.salaries, totalNpr: totals.salaryNpr },
  { category: "Refunds", transactions: counts.refunds ?? 0, totalNpr: totals.refundNpr ?? 0 },
  { category: "Net Surplus (Inflow − Outflow)", transactions: null, totalNpr: totals.netSurplusNpr, rowKind: "total" }
];