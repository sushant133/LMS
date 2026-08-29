import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ACCOUNTING_ACCESS_ROLES,
  ACCOUNTING_APPROVER_ROLES,
  ACCOUNTING_MANAGER_ROLES,
  hasAccountingPermission,
  isInstitutionAdmin,
  normalizeUserRole,
  EXPENSE_CATEGORIES,
  FEE_TYPES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PURCHASE_CATEGORIES,
  accountantSchema,
  accountingExpenseSchema,
  accountingIncomeSchema,
  accountingPurchaseSchema,
  accountingSettingsSchema,
  cashBookEntrySchema,
  enhancedFeeCollectionSchema,
  extendedFeeStructureSchema,
  salaryPaymentSchema,
  type AccountantInput,
  type AccountantRecord,
  type AuditLogRecord,
  type AccountingDashboardResponse,
  type FinancialSummaryReport,
  type AccountingExpenseInput,
  type AccountingExpenseRecord,
  type AccountingIncomeInput,
  type AccountingIncomeRecord,
  type AccountingPurchaseInput,
  type AccountingPurchaseRecord,
  type AccountingSettingsInput,
  type BatchRecord,
  type CashBookEntryInput,
  type CashBookEntryRecord,
  type ClassRecord,
  type EnhancedFeeCollectionInput,
  type EnhancedFeeCollectionRecord,
  type ExtendedFeeStructureInput,
  type FeeStructureRecord,
  type SalaryPaymentInput,
  type SalaryPaymentRecord,
  type StudentAccountSummary,
  type StudentRecord,
  type SalaryEmployeesResponse,
  type TeacherRecord,
  type YearRecord,
} from "@phit-erp/shared";
import {
  Banknote,
  BarChart3,
  BookMarked,
  Building2,
  FileText,
  Landmark,
  LayoutDashboard,
  Printer,
  RotateCcw,
  Receipt,
  Shield,
  ShoppingCart,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { LoadingState } from "components/shared/LoadingState";
import {
  DualBsAdDateField,
  NepaliDateField,
} from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useIsCollege } from "hooks/useInstitutionType";
import { getAcademicLabels } from "lib/academicStructureUtils";
import {
  FINANCIAL_SUMMARY_SECTIONS,
  REPORT_COLUMNS,
  bsDateToAdString,
  getReportCellValue,
  downloadFinancialSummaryExcel,
  downloadReportExcel,
  getReportRows,
  matchesStudentAccountSearch,
  matchesStudentSearch,
  reportUsesMonthFilter,
} from "./accountingUtils";
import {
  emptyIdsToUndefined,
  getSalaryEmployeeLabel,
} from "./accountingFormUtils";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import { BudgetPanel } from "./BudgetPanel";
import { ChartOfAccountsPanel } from "./ChartOfAccountsPanel";
import { FixedAssetsPanel } from "./FixedAssetsPanel";
import { JournalEntriesPanel } from "./JournalEntriesPanel";
import { LedgerPanel } from "./LedgerPanel";
import { StudentFeeRecordsPanel } from "./StudentFeeRecordsPanel";
import { SecurityDepositRecordsPanel } from "./SecurityDepositRecordsPanel";
import { SalaryPaymentRecordsPanel } from "./SalaryPaymentRecordsPanel";
import { RefundRecordsPanel } from "./RefundRecordsPanel";
import { printRegisterVoucher, printSimpleDocument } from "./voucherPrint";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { useCanAccessModule, useCanWriteModule } from "hooks/useModuleAccess";

import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";

type Tab =
  | "dashboard"
  | "fee-records"
  | "deposit-records"
  | "salary-records"
  | "refund-records"
  | "purchases"
  | "expenses"
  | "income"
  | "ledger"
  | "chart-of-accounts"
  | "fixed-assets"
  | "bank-reconciliation"
  | "budget"
  | "journal-entries"
  | "reports";

const accountingTabs: Tab[] = [
  "dashboard",
  "fee-records",
  "deposit-records",
  "salary-records",
  "refund-records",
  "purchases",
  "expenses",
  "income",
  "ledger",
  "chart-of-accounts",
  "fixed-assets",
  "bank-reconciliation",
  "budget",
  "journal-entries",
  "reports",
];

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "fee-records", label: "Student Fee Records", icon: Receipt },
  { id: "deposit-records", label: "Security Deposits", icon: Shield },
  { id: "salary-records", label: "Salary Sheet / Payroll", icon: Banknote },
  { id: "refund-records", label: "Refund Records", icon: RotateCcw },
  { id: "purchases", label: "Purchases", icon: ShoppingCart },
  { id: "expenses", label: "Expenses", icon: TrendingDown },
  { id: "income", label: "Income", icon: TrendingUp },
  { id: "ledger", label: "Ledger", icon: BookMarked },
  { id: "chart-of-accounts", label: "Chart of Accounts", icon: Landmark },
  { id: "fixed-assets", label: "Fixed Assets & Depreciation", icon: Building2 },
  { id: "bank-reconciliation", label: "Bank Reconciliation", icon: Wallet },
  { id: "budget", label: "Budget vs Actual", icon: Target },
  {
    id: "journal-entries",
    label: "Journal Entries (गोश्वारा भौचर)",
    icon: FileText,
  },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

/** Practical college reports — one Reports module (filters + export) */
const reportTypes = [
  { id: "ledger", label: "Ledger Report" },
  // Statutory statements — served by /accounting/ledger-reports/:reportType
  { id: "trial-balance", label: "Trial Balance", ledger: true },
  { id: "balance-sheet", label: "Balance Sheet", ledger: true },
  { id: "income-expenditure", label: "Income & Expenditure", ledger: true },
  { id: "cash-flow", label: "Cash Flow Statement", ledger: true },
  { id: "receivables-aging", label: "Receivables Aging", ledger: true },
  { id: "daily-fee-collection", label: "Student Fee Report (Daily)" },
  { id: "monthly-fee-collection", label: "Student Fee Report (Monthly)" },
  { id: "salary-payments", label: "Salary Report" },
  { id: "refunds", label: "Refund Report" },
  { id: "purchases", label: "Purchase Report" },
  { id: "expenses", label: "Expense Report" },
  { id: "income", label: "Income Report" },
  { id: "journal", label: "Journal Report" },
  { id: "financial-summary", label: "Monthly Financial Summary" },
  { id: "student-ledger", label: "Student Ledger", ledger: true },
  { id: "day-book", label: "Day Book", ledger: true },
  {
    id: "fee-collection-summary",
    label: "Fee Collection Summary",
    ledger: true,
  },
  { id: "scholarship-report", label: "Scholarship Report", ledger: true },
] as const;

const defaultStructure: ExtendedFeeStructureInput = {
  title: "",
  classIds: [],
  batchIds: [],
  yearIds: [],
  feeType: "MONTHLY",
  frequency: "MONTHLY",
  academicYearBs: "2083/2084",
  amountNpr: 0,
  isOptional: false,
  status: "ACTIVE",
  version: 1,
};

const defaultCollection: EnhancedFeeCollectionInput = {
  studentId: "",
  feeStructureId: "",
  paidDateBs: "",
  currentChargesNpr: 0,
  amountPaidNpr: 0,
  discountNpr: 0,
  scholarshipNpr: 0,
  scholarshipType: "NONE",
  lateFeeNpr: 0,
  advancePaymentNpr: 0,
  paymentMethod: "CASH",
  feeBreakdown: [],
  attachments: [],
  isInstallment: false,
  notes: "",
};

const defaultExpense: AccountingExpenseInput = {
  category: "Office",
  vendor: "",
  dateBs: "",
  amountNpr: 0,
  paymentMethod: "CASH",
  description: "",
  voucherNumber: "",
  approvedBy: "",
  attachmentUrl: "",
};

const defaultPurchase: AccountingPurchaseInput = {
  category: "Books",
  vendor: "",
  purchaseDateBs: "",
  invoiceNumber: "",
  item: "",
  quantity: 1,
  unitPriceNpr: 0,
  paymentStatus: "PAID",
  paymentMethod: "CASH",
  description: "",
  voucherNumber: "",
  attachmentUrl: "",
};

const defaultIncome: AccountingIncomeInput = {
  category: "Donation",
  source: "",
  dateBs: "",
  amountNpr: 0,
  paymentMethod: "CASH",
  description: "",
  receiptNumber: "",
  voucherNumber: "",
};

/** `GET /accounting/income/overview` — fee receipts + non-fee register combined. */
type IncomeOverviewRow = {
  id: string;
  kind: "FEE" | "OTHER";
  dateBs: string;
  receiptNumber: string;
  category: string;
  source: string;
  description: string;
  paymentMethod: string;
  amountNpr: number;
};

type IncomeOverviewResponse = {
  fromDateBs: string | null;
  toDateBs: string | null;
  totals: {
    studentFeeNpr: number;
    otherIncomeNpr: number;
    totalIncomeNpr: number;
    securityDepositCollectedNpr: number;
    feeReceiptCount: number;
    otherIncomeCount: number;
  };
  byCategory: Array<{ label: string; amountNpr: number; kind: "FEE" | "OTHER" }>;
  byMonth: Array<{ label: string; amountNpr: number }>;
  rowCount: number;
  rows: IncomeOverviewRow[];
};

const defaultSalary: SalaryPaymentInput = {
  employeeType: "TEACHER",
  teacherId: "",
  staffId: "",
  staffName: "",
  monthBs: "2082-01",
  basicSalaryNpr: 0,
  allowancesNpr: 0,
  bonusNpr: 0,
  advanceSalaryNpr: 0,
  loanDeductionNpr: 0,
  taxNpr: 0,
  otherDeductionsNpr: 0,
  presentDays: 0,
  absentDays: 0,
  leaveDays: 0,
  extraDuty: 0,
  absentDeductionNpr: 0,
  extraAmountNpr: 0,
  salaryAmountNpr: 0,
  attendanceIncomplete: false,
  attendanceManualOverride: false,
  valuesManualOverride: false,
  status: "DRAFT",
  paidDateBs: "",
  paymentMethod: "BANK_TRANSFER",
  attachments: [],
};

const defaultCashEntry: CashBookEntryInput = {
  dateBs: "",
  entryType: "CREDIT",
  category: "",
  description: "",
  amountNpr: 0,
  paymentMethod: "CASH",
};

const defaultSettings: AccountingSettingsInput = {
  lateFinePercent: 0,
  lateFineGraceDays: 0,
  receiptPrefix: "RCPT",
  autoReceiptNumber: true,
  defaultPaymentMethod: "CASH",
  voucherPrefix: "JV",
  approvalThresholdNpr: 25000,
  tdsEnabled: false,
};

const defaultAccountant: AccountantInput = {
  fullName: "",
  email: "",
  phone: "",
  employeeId: "",
  gender: "Male",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: "",
  },
  joinedDateBs: "",
  status: "ACTIVE",
};

export const AccountingManager = () => {
  const { user } = useAuth();
  /** Logged-in name for expense “Approved by” and other actor labels */
  const currentUserName = user?.fullName?.trim() || "";
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const canAccessAccounts = useCanAccessModule("accounts");
  const canWriteAccounts = useCanWriteModule("accounts");
  const secondaryRoles = (user?.secondaryRoles ?? []).map((r) =>
    normalizeUserRole(r),
  );
  const allRoles = [
    normalizeUserRole(user?.role ?? ""),
    ...secondaryRoles,
  ].filter(Boolean);
  /** Effective finance role: primary, secondary, or module-grant fallback. */
  const normalizedRole = (() => {
    const primary = normalizeUserRole(user?.role ?? "");
    if (ACCOUNTING_ACCESS_ROLES.includes(primary)) return primary;
    const secondaryFinance = secondaryRoles.find((r) =>
      ACCOUNTING_ACCESS_ROLES.includes(r),
    );
    if (secondaryFinance) return secondaryFinance;
    // Module-only staff / College Administrator with Accounts access act as accountant for UI caps
    if (canAccessAccounts) return "ACCOUNTANT" as const;
    return primary;
  })();
  /**
   * Institution admin from primary or secondary roles — never demote Super Admin /
   * College Admin just because finance "normalizedRole" resolved to ACCOUNTANT.
   */
  const primaryRole = normalizeUserRole(user?.role ?? "");
  const isAdmin =
    primaryRole === "SUPER_ADMIN" ||
    primaryRole === "COLLEGE_ADMIN" ||
    isInstitutionAdmin(primaryRole) ||
    allRoles.some(
      (r) =>
        r === "SUPER_ADMIN" ||
        r === "COLLEGE_ADMIN" ||
        isInstitutionAdmin(r),
    );
  const isAuditor = normalizedRole === "AUDITOR" || allRoles.includes("AUDITOR");
  const isPrincipal =
    normalizedRole === "PRINCIPAL" || allRoles.includes("PRINCIPAL");
  const isCashier = normalizedRole === "CASHIER" && !allRoles.includes("ACCOUNTANT");
  /**
   * College Administrator (COLLEGE_VIEWER) write rights come from Module Access → Accounts WRITE.
   * Global role-based read-only is no longer applied.
   */
  const isReadOnlyCollegeAdmin =
    !isAdmin &&
    primaryRole === "COLLEGE_VIEWER" &&
    !canWriteAccounts;
  const canWrite =
    isAdmin ||
    canWriteAccounts ||
    (!isAuditor && !isPrincipal && !isReadOnlyCollegeAdmin);
  /**
   * Delete / reverse of posted accounting records:
   * Super Admin + College Admin only (not Accountant / Cashier / others).
   */
  const canDelete = isAdmin;
  const canApprove =
    ACCOUNTING_APPROVER_ROLES.some((r) => allRoles.includes(r)) ||
    allRoles.some(isInstitutionAdmin);
  const canViewAudit =
    hasAccountingPermission(normalizedRole, "view_audit") ||
    allRoles.some((r) => hasAccountingPermission(r, "view_audit"));
  /** Same gate as canDelete — reverse is a form of delete for posted books */
  const canReverse = isAdmin;
  const [tab, setTab] = useState<Tab>("dashboard");
  /** Hand off payroll month (+ optional employee) when opening Salary Sheet from dashboard */
  const [salarySheetFocus, setSalarySheetFocus] = useState<{
    monthBs: string;
    employeeName?: string;
    focusKey?: number;
  } | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [editingStructure, setEditingStructure] =
    useState<FeeStructureRecord | null>(null);
  const [accountantPassword, setAccountantPassword] = useState("");
  const [structureForm, setStructureForm] = useState(defaultStructure);
  const [collectionForm, setCollectionForm] = useState(defaultCollection);
  const freshExpenseForm = (): AccountingExpenseInput => ({
    ...defaultExpense,
    approvedBy: currentUserName,
  });
  const [expenseForm, setExpenseForm] = useState<AccountingExpenseInput>(
    freshExpenseForm,
  );
  const [purchaseForm, setPurchaseForm] = useState(defaultPurchase);
  const [incomeForm, setIncomeForm] = useState(defaultIncome);
  /** Income tab filters (BS date range + source + free text). */
  const [incomeFromBs, setIncomeFromBs] = useState("");
  const [incomeToBs, setIncomeToBs] = useState("");
  const [incomeKind, setIncomeKind] = useState<"ALL" | "FEE" | "OTHER">("ALL");
  const [incomeSearch, setIncomeSearch] = useState("");
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [salaryForm, setSalaryForm] = useState(defaultSalary);
  const [cashForm, setCashForm] = useState(defaultCashEntry);
  const [settingsForm, setSettingsForm] = useState(defaultSettings);
  const [accountantForm, setAccountantForm] = useState(defaultAccountant);
  const [editingAccountant, setEditingAccountant] =
    useState<AccountantRecord | null>(null);
  const [editingExpense, setEditingExpense] =
    useState<AccountingExpenseRecord | null>(null);
  const [editingPurchase, setEditingPurchase] =
    useState<AccountingPurchaseRecord | null>(null);
  const [editingIncome, setEditingIncome] =
    useState<AccountingIncomeRecord | null>(null);
  const [editingSalary, setEditingSalary] =
    useState<SalaryPaymentRecord | null>(null);
  const [selectedReport, setSelectedReport] = useState<
    (typeof reportTypes)[number]["id"]
  >("ledger");
  /** From–To date range (BS stored; AD mirrors via DualBsAdDateField). */
  const [reportFromBs, setReportFromBs] = useState("");
  const [reportToBs, setReportToBs] = useState("");
  const [summarySection, setSummarySection] =
    useState<(typeof FINANCIAL_SUMMARY_SECTIONS)[number]["key"]>("fees");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const studentIdParam = searchParams.get("studentId");
    if (tabParam && accountingTabs.includes(tabParam as Tab)) {
      setTab(tabParam as Tab);
    }
    if (studentIdParam) {
      setSelectedStudentId(studentIdParam);
      setCollectionForm((current) => ({
        ...current,
        studentId: studentIdParam,
      }));
      if (!tabParam) {
        setTab("fee-records");
      }
    }
  }, [searchParams]);

  const cashierTabs: Tab[] = [
    "dashboard",
    "fee-records",
    "refund-records",
    "reports",
  ];
  const visibleTabs = tabs
    .filter((item) => !isCashier || cashierTabs.includes(item.id))
    .filter(
      (item) =>
        !isPrincipal ||
        [
          "dashboard",
          "reports",
          "fee-records",
          "salary-records",
          "refund-records",
          "ledger",
          "journal-entries",
        ].includes(item.id),
    );

  const dashboardQuery = useQuery({
    queryKey: ["accounting-dashboard"],
    queryFn: () =>
      unwrap<AccountingDashboardResponse>(api.get("/accounting/dashboard")),
    enabled: tab === "dashboard",
  });

  // Structures / students / academics only needed by legacy forms (disabled).
  // Live panels load their own data — do not block the whole Accounting page.
  const structuresQuery = useQuery({
    queryKey: ["accounting-structures"],
    queryFn: () =>
      unwrap<FeeStructureRecord[]>(api.get("/accounting/structures")),
    enabled: false,
  });

  const studentsQuery = useQuery({
    // Exclude disabled login accounts from fee collection pickers
    queryKey: ["students", "login-active"],
    queryFn: () =>
      unwrap<StudentRecord[]>(
        api.get("/students", { params: { loginActive: "1" } }),
      ),
    enabled: false,
  });

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: false,
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: false,
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: false,
  });

  const receiptsQuery = useQuery({
    queryKey: ["accounting-receipts"],
    queryFn: () =>
      unwrap<EnhancedFeeCollectionRecord[]>(api.get("/accounting/receipts")),
    enabled: false,
  });

  const studentAccountsQuery = useQuery({
    queryKey: ["accounting-student-accounts"],
    queryFn: () =>
      unwrap<StudentAccountSummary[]>(api.get("/accounting/student-accounts")),
    enabled: false,
  });

  const expensesQuery = useQuery({
    queryKey: ["accounting-expenses"],
    queryFn: () =>
      unwrap<AccountingExpenseRecord[]>(api.get("/accounting/expenses")),
    enabled: tab === "expenses",
  });

  const purchasesQuery = useQuery({
    queryKey: ["accounting-purchases"],
    queryFn: () =>
      unwrap<AccountingPurchaseRecord[]>(api.get("/accounting/purchases")),
    enabled: tab === "purchases",
  });

  const incomeQuery = useQuery({
    queryKey: ["accounting-income"],
    queryFn: () =>
      unwrap<AccountingIncomeRecord[]>(api.get("/accounting/income")),
    enabled: tab === "income",
  });

  /**
   * Full income picture = student fee receipts + the non-fee register.
   * Fees are posted from Student Fee Records, so the register alone never shows them.
   */
  const incomeOverviewQuery = useQuery({
    queryKey: ["accounting-income-overview", incomeFromBs, incomeToBs],
    queryFn: () =>
      unwrap<IncomeOverviewResponse>(
        api.get("/accounting/income/overview", {
          params: {
            ...(incomeFromBs ? { fromDateBs: incomeFromBs } : {}),
            ...(incomeToBs ? { toDateBs: incomeToBs } : {}),
          },
        }),
      ),
    enabled: tab === "income",
  });

  const incomeOverview = incomeOverviewQuery.data;

  const incomeRows = useMemo(() => {
    const rows = incomeOverview?.rows ?? [];
    const q = incomeSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (incomeKind !== "ALL" && row.kind !== incomeKind) return false;
      if (!q) return true;
      return (
        row.source.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q) ||
        row.receiptNumber.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q)
      );
    });
  }, [incomeOverview, incomeKind, incomeSearch]);

  /** Non-fee register rows keyed by id — edit/void needs the original record. */
  const incomeRecordsById = useMemo(
    () => new Map((incomeQuery.data ?? []).map((row) => [row._id, row])),
    [incomeQuery.data],
  );

  const salariesQuery = useQuery({
    queryKey: ["accounting-salaries"],
    queryFn: () =>
      unwrap<SalaryPaymentRecord[]>(api.get("/accounting/salaries")),
    enabled: false,
  });

  const salaryEmployeesQuery = useQuery({
    queryKey: ["accounting-salary-employees"],
    queryFn: () =>
      unwrap<SalaryEmployeesResponse>(api.get("/accounting/salary-employees")),
    enabled: false,
  });

  const cashBookQuery = useQuery({
    queryKey: ["accounting-cash-book"],
    queryFn: () =>
      unwrap<CashBookEntryRecord[]>(api.get("/accounting/cash-book")),
    enabled: false,
  });

  const settingsQuery = useQuery({
    queryKey: ["accounting-settings"],
    queryFn: () =>
      unwrap<AccountingSettingsInput & { _id: string }>(
        api.get("/accounting/settings"),
      ),
    enabled: false,
  });

  const accountantsQuery = useQuery({
    queryKey: ["accounting-accountants"],
    queryFn: () =>
      unwrap<AccountantRecord[]>(api.get("/accounting/accountants")),
    enabled: false,
  });

  const auditLogsQuery = useQuery({
    queryKey: ["accounting-audit-logs"],
    queryFn: () => unwrap<AuditLogRecord[]>(api.get("/accounting/audit-logs")),
    enabled: false,
  });

  const reverseCollection = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap<{ message?: string }>(
        api.post(`/accounting/collections/${id}/reverse`, { reason }),
      ),
    onSuccess: (data) => {
      toast.success(data?.message ?? "Reversal processed");
      void invalidateAccounting();
    },
    onError: (error: Error) => toast.error(parseErrorMessage(error)),
  });

  /** Month derived from From date for reports that still key on YYYY-MM. */
  const reportMonthFromRange = reportFromBs.trim().slice(0, 7);
  const reportUsesDateRange =
    reportUsesMonthFilter(selectedReport) ||
    selectedReport === "daily-fee-collection" ||
    selectedReport === "day-book" ||
    selectedReport === "student-ledger" ||
    selectedReport === "fee-collection-summary" ||
    selectedReport === "scholarship-report";

  const reportQuery = useQuery({
    queryKey: [
      "accounting-report",
      selectedReport,
      reportFromBs,
      reportToBs,
      reportMonthFromRange,
    ],
    queryFn: () => {
      const reportMeta = reportTypes.find((item) => item.id === selectedReport);
      const isLedgerReport =
        reportMeta && "ledger" in reportMeta && Boolean(reportMeta.ledger);
      const path = isLedgerReport
        ? `/accounting/ledger-reports/${selectedReport}`
        : `/accounting/reports/${selectedReport}`;
      const from = reportFromBs.trim() || undefined;
      const to = reportToBs.trim() || undefined;
      return unwrap<FinancialSummaryReport | { data: unknown[] }>(
        api.get(path, {
          params: {
            fromDateBs: from,
            toDateBs: to,
            // Compatibility for APIs that still expect month/day
            monthBs:
              reportUsesMonthFilter(selectedReport) && reportMonthFromRange
                ? reportMonthFromRange
                : undefined,
            dateBs:
              selectedReport === "daily-fee-collection"
                ? from || to
                : undefined,
          },
        }),
      );
    },
    enabled: tab === "reports",
  });

  const financialSummary =
    selectedReport === "financial-summary" &&
    reportQuery.data &&
    "sections" in reportQuery.data
      ? reportQuery.data
      : null;
  const standardReportRows =
    selectedReport !== "financial-summary" &&
    reportQuery.data &&
    "data" in reportQuery.data
      ? (reportQuery.data.data ?? [])
      : (financialSummary?.data ?? []);

  const studentHistoryQuery = useQuery({
    queryKey: ["student-financial-history", selectedStudentId],
    queryFn: () =>
      unwrap<Record<string, unknown>>(
        api.get(
          `/accounting/student-accounts/${selectedStudentId}/financial-history`,
        ),
      ),
    enabled: false,
  });

  const invalidateAccounting = async () => {
    const { invalidateAccountingQueries } = await import(
      "./invalidateAccountingQueries"
    );
    await invalidateAccountingQueries();
  };

  const saveStructure = useMutation({
    mutationFn: (payload: ExtendedFeeStructureInput) =>
      editingStructure
        ? unwrap(
            api.put(`/accounting/structures/${editingStructure._id}`, payload),
          )
        : unwrap(api.post("/accounting/structures", payload)),
    onSuccess: async () => {
      toast.success(
        editingStructure ? "Fee structure updated" : "Fee structure created",
      );
      setStructureForm(defaultStructure);
      setEditingStructure(null);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteStructure = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/structures/${id}`)),
    onSuccess: async () => {
      toast.success("Fee structure deleted");
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const collectFee = useMutation({
    mutationFn: (payload: EnhancedFeeCollectionInput) =>
      unwrap(api.post("/accounting/collections", payload)),
    onSuccess: async () => {
      toast.success("Fee collected successfully");
      setCollectionForm(defaultCollection);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createExpense = useMutation({
    mutationFn: (payload: AccountingExpenseInput) =>
      unwrap(api.post("/accounting/expenses", payload)),
    onSuccess: async () => {
      toast.success("Expense recorded");
      setExpenseForm(freshExpenseForm());
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createPurchase = useMutation({
    mutationFn: (payload: AccountingPurchaseInput) =>
      unwrap(api.post("/accounting/purchases", payload)),
    onSuccess: async () => {
      toast.success("Purchase recorded");
      setPurchaseForm(defaultPurchase);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createIncome = useMutation({
    mutationFn: (payload: AccountingIncomeInput) =>
      unwrap(api.post("/accounting/income", payload)),
    onSuccess: async () => {
      toast.success("Income recorded");
      setIncomeForm(defaultIncome);
      setShowIncomeForm(false);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createSalary = useMutation({
    mutationFn: (payload: SalaryPaymentInput) =>
      unwrap(api.post("/accounting/salaries", payload)),
    onSuccess: async () => {
      toast.success("Salary payment recorded");
      setSalaryForm(defaultSalary);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createCashEntry = useMutation({
    mutationFn: (payload: CashBookEntryInput) =>
      unwrap(api.post("/accounting/cash-book", payload)),
    onSuccess: async () => {
      toast.success("Cash book entry created");
      setCashForm(defaultCashEntry);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const saveSettings = useMutation({
    mutationFn: (payload: AccountingSettingsInput) =>
      unwrap(api.put("/accounting/settings", payload)),
    onSuccess: async () => {
      toast.success("Settings updated");
      await queryClient.invalidateQueries({
        queryKey: ["accounting-settings"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const saveAccountant = useMutation({
    mutationFn: (payload: AccountantInput) =>
      editingAccountant
        ? unwrap(
            api.put(
              `/accounting/accountants/${editingAccountant._id}`,
              payload,
            ),
          )
        : unwrap(api.post("/accounting/accountants", payload)),
    onSuccess: async () => {
      toast.success(
        editingAccountant ? "Accountant updated" : "Accountant created",
      );
      setAccountantForm(defaultAccountant);
      setAccountantPassword("");
      setEditingAccountant(null);
      await queryClient.invalidateQueries({
        queryKey: ["accounting-accountants"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deactivateAccountant = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/accountants/${id}`)),
    onSuccess: async () => {
      toast.success("Accountant deactivated");
      await queryClient.invalidateQueries({
        queryKey: ["accounting-accountants"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/accounting/accountants/${id}/reset-password`, {})),
    onSuccess: () => toast.success("Password reset"),
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/expenses/${id}`)),
    onSuccess: async () => {
      toast.success("Expense deleted");
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deletePurchase = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/purchases/${id}`)),
    onSuccess: async () => {
      toast.success("Purchase deleted");
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  /**
   * Void, not delete: the API reverses the journal and keeps the row for audit.
   * A reason is mandatory — sending no body used to fail validation with a 400.
   */
  const deleteIncome = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.delete(`/accounting/income/${id}`, { data: { reason } })),
    onSuccess: async () => {
      toast.success("Income voided — journal entry reversed");
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const confirmVoidIncome = (row: IncomeOverviewRow) => {
    const reason = window.prompt(
      `Void income entry ${row.receiptNumber || ""} (${formatCurrencyNpr(row.amountNpr)})?\n\nThis reverses the journal and cash book. The record is kept for audit.\n\nReason:`,
      "Entered by mistake",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters");
      return;
    }
    void deleteIncome.mutateAsync({ id: row.id, reason: reason.trim() });
  };

  /** Super Admin / College Admin — remove a salary sheet entry from recent list */
  const deleteSalary = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.delete(`/accounting/salaries/${id}`, {
          data: { reason: "Deleted from accounting dashboard" },
        }),
      ),
    onSuccess: async () => {
      toast.success("Salary entry deleted");
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  /** Delete from Reports: reverse journal (day-book) or reverse fee collection (scholarship). */
  const deleteFromReport = useMutation({
    mutationFn: async ({
      kind,
      id,
    }: {
      kind: "journal" | "fee-collection";
      id: string;
    }) => {
      if (kind === "journal") {
        return unwrap(api.post(`/accounting/journal-entries/${id}/reverse`));
      }
      const reason =
        window.prompt("Reason for deleting this fee payment (required):") ?? "";
      if (reason.trim().length < 3) {
        throw new Error("Reason must be at least 3 characters");
      }
      return unwrap(
        api.post(`/accounting/collections/${id}/reverse`, {
          reason: reason.trim(),
        }),
      );
    },
    onSuccess: async () => {
      toast.success("Record deleted — accounts updated");
      await invalidateAccounting();
      await reportQuery.refetch();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateExpense = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: AccountingExpenseInput;
    }) => unwrap(api.put(`/accounting/expenses/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Expense updated");
      setEditingExpense(null);
      setExpenseForm(freshExpenseForm());
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updatePurchase = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<AccountingPurchaseInput>;
    }) => unwrap(api.put(`/accounting/purchases/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Purchase updated");
      setEditingPurchase(null);
      setPurchaseForm(defaultPurchase);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateIncome = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: AccountingIncomeInput;
    }) => unwrap(api.put(`/accounting/income/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Income updated");
      setEditingIncome(null);
      setIncomeForm(defaultIncome);
      setShowIncomeForm(false);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateSalary = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<SalaryPaymentInput>;
    }) => unwrap(api.put(`/accounting/salaries/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Salary payment updated");
      setEditingSalary(null);
      setSalaryForm(defaultSalary);
      await invalidateAccounting();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsForm({
        lateFinePercent: settingsQuery.data.lateFinePercent,
        lateFineGraceDays: settingsQuery.data.lateFineGraceDays,
        receiptPrefix: settingsQuery.data.receiptPrefix,
        autoReceiptNumber: settingsQuery.data.autoReceiptNumber,
        defaultPaymentMethod: settingsQuery.data.defaultPaymentMethod,
        voucherPrefix: settingsQuery.data.voucherPrefix ?? "JV",
        currentFiscalYearBs: settingsQuery.data.currentFiscalYearBs,
        auditLockDateBs: settingsQuery.data.auditLockDateBs ?? "",
        approvalThresholdNpr: settingsQuery.data.approvalThresholdNpr ?? 25000,
        panNumber: settingsQuery.data.panNumber ?? "",
        vatNumber: settingsQuery.data.vatNumber ?? "",
        tdsEnabled: settingsQuery.data.tdsEnabled ?? false,
        institutionSignatureUrl:
          settingsQuery.data.institutionSignatureUrl ?? "",
      });
      setCollectionForm((current) => ({
        ...current,
        paymentMethod:
          current.paymentMethod ||
          settingsQuery.data.defaultPaymentMethod ||
          "CASH",
      }));
    }
  }, [settingsQuery.data]);

  const filteredCollectionStudents = useMemo(
    () =>
      (studentsQuery.data ?? []).filter((student) =>
        matchesStudentSearch(student, studentSearch),
      ),
    [studentSearch, studentsQuery.data],
  );

  const filteredStudentAccounts = useMemo(
    () =>
      (studentAccountsQuery.data ?? []).filter((account) =>
        matchesStudentAccountSearch(account, accountSearch),
      ),
    [accountSearch, studentAccountsQuery.data],
  );

  const selectedStudentAccount = useMemo(
    () =>
      (studentAccountsQuery.data ?? []).find(
        (item) => item.student._id === collectionForm.studentId,
      ),
    [studentAccountsQuery.data, collectionForm.studentId],
  );

  const selectedStructure = useMemo(
    () =>
      (structuresQuery.data ?? []).find(
        (item) => item._id === collectionForm.feeStructureId,
      ),
    [structuresQuery.data, collectionForm.feeStructureId],
  );

  // Allow primary/secondary finance roles OR Accounts module grant (admin MAC).
  const hasAccountingAccess =
    Boolean(user) &&
    (ACCOUNTING_ACCESS_ROLES.includes(normalizeUserRole(user!.role)) ||
      secondaryRoles.some((r) => ACCOUNTING_ACCESS_ROLES.includes(r)) ||
      canAccessAccounts);

  if (!hasAccountingAccess) {
    return null;
  }

  const downloadReceipt = (id: string) => {
    window.open(
      `${api.defaults.baseURL}/accounting/collections/${id}/receipt`,
      "_blank",
    );
  };

  const exportReport = (format: "csv" | "xlsx") => {
    if (format === "xlsx") {
      if (financialSummary) {
        downloadFinancialSummaryExcel(financialSummary);
        toast.success("Financial summary Excel downloaded");
        return;
      }

      const reportLabel =
        reportTypes.find((item) => item.id === selectedReport)?.label ??
        selectedReport;
      if (standardReportRows.length === 0) {
        toast.error(
          "No report data to export. Adjust filters or wait for the report to load.",
        );
        return;
      }
      downloadReportExcel(selectedReport, reportLabel, standardReportRows);
      toast.success("Excel report downloaded");
      return;
    }

    const params = new URLSearchParams({ format });
    if (reportFromBs.trim()) params.set("fromDateBs", reportFromBs.trim());
    if (reportToBs.trim()) params.set("toDateBs", reportToBs.trim());
    if (reportUsesMonthFilter(selectedReport) && reportMonthFromRange) {
      params.set("monthBs", reportMonthFromRange);
    }
    if (selectedReport === "daily-fee-collection") {
      const day = reportFromBs.trim() || reportToBs.trim();
      if (day) params.set("dateBs", day);
    }
    const reportMeta = reportTypes.find((item) => item.id === selectedReport);
    const basePath =
      reportMeta && "ledger" in reportMeta && reportMeta.ledger
        ? `/accounting/ledger-reports/${selectedReport}`
        : `/accounting/reports/${selectedReport}`;
    window.open(
      `${api.defaults.baseURL}${basePath}?${params.toString()}`,
      "_blank",
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting & Finance"
        description="Nepal college accounting — fee, salary, refunds, purchases, expenses, income, ledger, and गोश्वारा भौचर. Transactions post to the ledger automatically."
      />

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant={tab === item.id ? "default" : "outline"}
              size="sm"
              className={cn(
                tab === item.id && "bg-brand-600 hover:bg-brand-700",
              )}
              onClick={() => setTab(item.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </div>

      {tab === "dashboard" ? (
        dashboardQuery.isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {(
                dashboardQuery.data?.stats ?? [
                  {
                    label: "Today's Collection",
                    value: dashboardQuery.data?.todayCollectionNpr ?? 0,
                  },
                  {
                    label: "Monthly Collection",
                    value: dashboardQuery.data?.monthlyCollectionNpr ?? 0,
                  },
                  {
                    label: "Total Income",
                    value: dashboardQuery.data?.totalIncomeNpr ?? 0,
                  },
                  {
                    label: "Total Expenses",
                    value: dashboardQuery.data?.totalExpensesNpr ?? 0,
                  },
                  {
                    label: "Cash Balance",
                    value: dashboardQuery.data?.cashBalanceNpr ?? 0,
                  },
                ]
              )
                // Outstanding / pending fee cards removed from accounting dashboard
                .filter(
                  (stat) =>
                    !/outstanding|pending\s*fee|fee\s*due/i.test(stat.label),
                )
                .map((stat) => (
                <Card key={stat.label} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="truncate text-sm font-medium text-slate-500">
                      {stat.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "min-w-0 overflow-hidden break-words text-lg font-semibold tabular-nums leading-snug sm:text-xl xl:text-2xl",
                      stat.label.includes("Expense") && "text-rose-700",
                      stat.label.includes("Income") && "text-emerald-700",
                      stat.label.includes("Cash") && "text-brand-700",
                      stat.label.includes("Collection") && "text-brand-800",
                    )}
                    title={formatCurrencyNpr(stat.value)}
                  >
                    {formatCurrencyNpr(stat.value)}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {(
                [
                  {
                    key: "fees",
                    title: "Recent Fee Collections",
                    items: dashboardQuery.data?.recentFees ?? [],
                    amountClass: "text-brand-700",
                  },
                  {
                    key: "deposits",
                    title: "Recent Security Deposits",
                    items: dashboardQuery.data?.recentDeposits ?? [],
                    amountClass: "text-violet-700",
                  },
                  {
                    key: "salaries",
                    title: "Recent Salary Sheet Entries",
                    items: dashboardQuery.data?.recentSalaries ?? [],
                    amountClass: "text-emerald-800",
                  },
                  {
                    key: "purchases",
                    title: "Recent Purchases",
                    items: dashboardQuery.data?.recentPurchases ?? [],
                    amountClass: "text-indigo-800",
                  },
                  {
                    key: "expenses",
                    title: "Recent Expenses",
                    items: dashboardQuery.data?.recentExpenseItems ?? [],
                    amountClass: "text-rose-700",
                  },
                  {
                    key: "refunds",
                    title: "Recent Refunds",
                    items: dashboardQuery.data?.recentRefunds ?? [],
                    amountClass: "text-violet-800",
                  },
                ] as const
              ).map((section) => {
                const isSalary = section.key === "salaries";
                return (
                <Card key={section.key}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-base">{section.title}</CardTitle>
                      {isSalary ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          From Salary Sheet / Payroll (saved employees)
                        </p>
                      ) : null}
                    </div>
                    {isSalary ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => {
                          setSalarySheetFocus(null);
                          setTab("salary-records");
                        }}
                      >
                        Open sheet
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {section.items.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        {isSalary
                          ? "No salary sheet entries yet. Open Salary Sheet / Payroll and save a month."
                          : "No records yet."}
                      </p>
                    ) : (
                      section.items.map((item) => {
                        const salaryItem = item as typeof item & {
                          monthBs?: string;
                          detail?: string;
                          presentDays?: number;
                          absentDays?: number;
                        };
                        // Prefer explicit monthBs; fall back to voucher "Payroll 2083-04"
                        const rawMonth =
                          typeof salaryItem.monthBs === "string"
                            ? salaryItem.monthBs.trim()
                            : "";
                        const fromVoucher = String(item.voucherNo || "").match(
                          /(\d{4}-\d{2})/,
                        );
                        const monthBs =
                          rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)
                            ? rawMonth
                            : fromVoucher?.[1] || "";
                        const openItem = () => {
                          if (isSalary) {
                            if (monthBs && /^\d{4}-\d{2}$/.test(monthBs)) {
                              setSalarySheetFocus({
                                monthBs,
                                employeeName: item.party || undefined,
                                focusKey: Date.now(),
                              });
                            } else {
                              setSalarySheetFocus(null);
                            }
                            setTab("salary-records");
                            return;
                          }
                          if (item.linkTab) setTab(item.linkTab as Tab);
                        };
                        return (
                        <div
                          key={item.id}
                          className="flex w-full min-w-0 items-stretch gap-1 overflow-hidden rounded-xl border border-slate-100 bg-white transition hover:border-brand-200 hover:bg-brand-50/40"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left text-sm"
                            onClick={openItem}
                          >
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="truncate font-medium text-slate-900">
                                {item.party}
                              </div>
                              {isSalary ? (
                                <div className="mt-0.5 space-y-0.5 text-xs text-slate-500">
                                  <div className="truncate">
                                    {item.voucherNo}
                                    {item.dateBs && item.dateBs !== monthBs ? (
                                      <span> · Paid {item.dateBs}</span>
                                    ) : null}
                                  </div>
                                  {salaryItem.detail ? (
                                    <div className="truncate text-[11px] text-slate-400">
                                      {salaryItem.detail}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="truncate text-xs text-slate-500">
                                  {item.dateBs} · {item.voucherNo}
                                  {item.status ? (
                                    <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                                      {String(item.status).replace(/_/g, " ")}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </div>
                            <div
                              className={cn(
                                "max-w-[45%] shrink-0 text-right text-sm font-semibold tabular-nums leading-tight",
                                section.amountClass,
                                String(item.status).includes("DEPOSIT") &&
                                  "text-violet-700",
                              )}
                              title={formatCurrencyNpr(item.amountNpr)}
                            >
                              <span className="block break-all">
                                {formatCurrencyNpr(item.amountNpr)}
                              </span>
                              {isSalary ? (
                                <div className="text-[10px] font-normal text-slate-500">
                                  net salary
                                </div>
                              ) : String(item.status) === "DEPOSIT" ? (
                                <div className="text-[10px] font-normal text-violet-600">
                                  deposit
                                </div>
                              ) : String(item.status) === "FEE+DEPOSIT" ? (
                                <div className="text-[10px] font-normal text-slate-500">
                                  fee + deposit
                                </div>
                              ) : null}
                            </div>
                          </button>
                          {isSalary && canDelete ? (
                            <div className="flex shrink-0 items-center border-l border-slate-100 pr-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                title="Delete this salary entry (Super Admin / College Admin)"
                                disabled={deleteSalary.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const label = [
                                    item.party,
                                    item.voucherNo,
                                    formatCurrencyNpr(item.amountNpr),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ");
                                  if (
                                    !window.confirm(
                                      `Delete salary entry?\n\n${label}\n\nThis removes it from the salary sheet. If it was marked Paid, journal and cash book entries are reversed.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void deleteSalary.mutateAsync(item.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
                );
              })}
            </div>
          </div>
        )
      ) : null}

      {tab === "fee-records" ? <StudentFeeRecordsPanel /> : null}
      {tab === "deposit-records" ? <SecurityDepositRecordsPanel /> : null}
      {tab === "salary-records" ? (
        <SalaryPaymentRecordsPanel
          focusMonthBs={salarySheetFocus?.monthBs}
          focusEmployeeName={salarySheetFocus?.employeeName}
          focusKey={salarySheetFocus?.focusKey}
        />
      ) : null}
      {tab === "refund-records" ? <RefundRecordsPanel /> : null}
      {tab === "ledger" ? <LedgerPanel canDelete={canDelete} /> : null}

      {/* Legacy fee-collection UI disabled — replaced by Student Fee Records */}
      {false && tab === "fee-records" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingStructure ? "Edit Fee Structure" : "Fee Structure"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const parsed =
                      extendedFeeStructureSchema.safeParse(structureForm);
                    if (!parsed.success)
                      return toast.error(
                        parsed.error.issues[0]?.message ?? "Invalid structure",
                      );
                    void saveStructure.mutateAsync(parsed.data);
                  }}
                >
                  <div className="md:col-span-2">
                    <FormField label="Title">
                      <Input
                        value={structureForm.title}
                        onChange={(e) =>
                          setStructureForm((c) => ({
                            ...c,
                            title: e.target.value,
                          }))
                        }
                      />
                    </FormField>
                  </div>
                  <FormField label="Fee Type">
                    <Select
                      value={structureForm.feeType}
                      onChange={(e) =>
                        setStructureForm((c) => ({
                          ...c,
                          feeType: e.target
                            .value as ExtendedFeeStructureInput["feeType"],
                        }))
                      }
                    >
                      {FEE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Frequency">
                    <Select
                      value={structureForm.frequency}
                      onChange={(e) =>
                        setStructureForm((c) => ({
                          ...c,
                          frequency: e.target
                            .value as ExtendedFeeStructureInput["frequency"],
                        }))
                      }
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="ANNUAL">Annual</option>
                      <option value="ONE_TIME">One time</option>
                    </Select>
                  </FormField>
                  <FormField label="Amount (NPR)">
                    <NumberInput
                      value={structureForm.amountNpr}
                      onChange={(e) =>
                        setStructureForm((c) => ({
                          ...c,
                          amountNpr: e.target.valueAsNumber,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Academic Year (BS)">
                    <Input
                      value={structureForm.academicYearBs}
                      onChange={(e) =>
                        setStructureForm((c) => ({
                          ...c,
                          academicYearBs: e.target.value,
                        }))
                      }
                      placeholder="2083/2084"
                    />
                  </FormField>
                  {!isCollege ? (
                    <div className="md:col-span-2">
                      <FormField label="Classes">
                        <Select
                          value={structureForm.classIds[0] ?? ""}
                          onChange={(e) =>
                            setStructureForm((c) => ({
                              ...c,
                              classIds: e.target.value ? [e.target.value] : [],
                            }))
                          }
                        >
                          <option value="">All classes</option>
                          {(classesQuery.data ?? []).map((cls) => (
                            <option key={cls._id} value={cls._id}>
                              {cls.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </div>
                  ) : (
                    <p className="md:col-span-2 text-xs text-slate-500">
                      College fee structures apply to all students unless
                      filtered during collection.
                    </p>
                  )}
                  <div className="md:col-span-2 flex justify-end gap-2">
                    {editingStructure ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingStructure(null);
                          setStructureForm(defaultStructure);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button type="submit" disabled={saveStructure.isPending}>
                      {editingStructure
                        ? "Update Structure"
                        : "Create Structure"}
                    </Button>
                  </div>
                </form>

                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Title</Th>
                        <Th>Type</Th>
                        <Th>Amount</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {(structuresQuery.data ?? []).map((structure) => (
                        <tr key={structure._id}>
                          <Td>{structure.title}</Td>
                          <Td>{structure.feeType}</Td>
                          <Td>{formatCurrencyNpr(structure.amountNpr)}</Td>
                          <Td>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingStructure(structure);
                                  setStructureForm({
                                    title: structure.title,
                                    classIds: structure.classIds ?? [],
                                    batchIds: structure.batchIds ?? [],
                                    yearIds: structure.yearIds ?? [],
                                    faculty: structure.faculty ?? "",
                                    program: structure.program ?? "",
                                    feeType: structure.feeType,
                                    frequency: structure.frequency ?? "MONTHLY",
                                    academicYearBs:
                                      structure.academicYearBs ?? "2083/2084",
                                    semesterBs: structure.semesterBs ?? "",
                                    amountNpr: structure.amountNpr,
                                    installmentCount:
                                      structure.installmentCount,
                                    isOptional: structure.isOptional ?? false,
                                    status: structure.status ?? "ACTIVE",
                                    version: structure.version ?? 1,
                                  });
                                }}
                              >
                                Edit
                              </Button>
                              {canDelete ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() =>
                                    void deleteStructure.mutateAsync(
                                      structure._id,
                                    )
                                  }
                                >
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className={isAdmin ? "" : "xl:col-span-2"}>
            <CardHeader>
              <CardTitle>Collect Fee</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 md:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = enhancedFeeCollectionSchema.safeParse(
                    emptyIdsToUndefined(
                      {
                        ...collectionForm,
                        paymentMethod:
                          collectionForm.paymentMethod ||
                          settingsForm.defaultPaymentMethod ||
                          "CASH",
                      },
                      ["feeStructureId", "studentId"],
                    ),
                  );
                  if (!parsed.success)
                    return toast.error(
                      parsed.error.issues[0]?.message ?? "Invalid collection",
                    );
                  void collectFee.mutateAsync(parsed.data);
                }}
              >
                <div className="md:col-span-2">
                  <FormField label="Search student">
                    <Input
                      placeholder="Name, mobile, login ID, or admission no."
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                    />
                  </FormField>
                </div>
                <FormField label="Student">
                  <Select
                    value={collectionForm.studentId}
                    onChange={(e) => {
                      const studentId = e.target.value;
                      const structure = (structuresQuery.data ?? []).find(
                        (item) => item._id === collectionForm.feeStructureId,
                      );
                      const account = (studentAccountsQuery.data ?? []).find(
                        (item) => item.student._id === studentId,
                      );
                      setCollectionForm((c) => ({
                        ...c,
                        studentId,
                        currentChargesNpr:
                          structure?.amountNpr ?? c.currentChargesNpr,
                        lateFeeNpr: 0,
                      }));
                    }}
                  >
                    <option value="">Select student</option>
                    {filteredCollectionStudents.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.user.fullName} — {s.admissionNumber}
                        {s.user.phone ? ` · ${s.user.phone}` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Fee Structure">
                  <Select
                    value={collectionForm.feeStructureId ?? ""}
                    onChange={(e) => {
                      const structure = (structuresQuery.data ?? []).find(
                        (item) => item._id === e.target.value,
                      );
                      setCollectionForm((c) => ({
                        ...c,
                        feeStructureId: e.target.value,
                        currentChargesNpr: structure?.amountNpr ?? 0,
                      }));
                    }}
                  >
                    <option value="">Select structure</option>
                    {(structuresQuery.data ?? []).map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.title}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {selectedStudentAccount ? (
                  <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                    Previous Due:{" "}
                    <strong>
                      {formatCurrencyNpr(
                        selectedStudentAccount?.remainingDueNpr ?? 0,
                      )}
                    </strong>
                    {selectedStructure ? (
                      <>
                        {" "}
                        · Current Charge:{" "}
                        <strong>
                          {formatCurrencyNpr(selectedStructure?.amountNpr ?? 0)}
                        </strong>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <FormField label="Paid Date (BS)">
                  <NepaliDateField
                    value={collectionForm.paidDateBs ?? ""}
                    onChange={(v) =>
                      setCollectionForm((c) => ({ ...c, paidDateBs: v }))
                    }
                  />
                </FormField>
                <FormField label="Payment Method">
                  <Select
                    value={collectionForm.paymentMethod}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        paymentMethod: e.target
                          .value as EnhancedFeeCollectionInput["paymentMethod"],
                      }))
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Current Charges">
                  <NumberInput
                    value={collectionForm.currentChargesNpr}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        currentChargesNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Amount Paid">
                  <NumberInput
                    value={collectionForm.amountPaidNpr}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        amountPaidNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Discount">
                  <NumberInput
                    value={collectionForm.discountNpr}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        discountNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Scholarship">
                  <NumberInput
                    value={collectionForm.scholarshipNpr}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        scholarshipNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Installment">
                  <Select
                    value={collectionForm.isInstallment ? "yes" : "no"}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        isInstallment: e.target.value === "yes",
                      }))
                    }
                  >
                    <option value="no">Full Payment</option>
                    <option value="yes">Installment</option>
                  </Select>
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Notes (optional)">
                    <Textarea
                      value={collectionForm.notes ?? ""}
                      onChange={(e) =>
                        setCollectionForm((c) => ({
                          ...c,
                          notes: e.target.value,
                        }))
                      }
                      placeholder="Payment remarks, cheque number, scholarship reference, etc."
                    />
                  </FormField>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" disabled={collectFee.isPending}>
                    Collect Fee
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {false ? (
        <Card>
          <CardHeader>
            <CardTitle>Fee Receipts</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {receiptsQuery.isLoading ? (
              <LoadingState />
            ) : (receiptsQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No receipts yet"
                description="Collected fees will appear here with PDF download links."
              />
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <Th>Receipt</Th>
                    <Th>Student</Th>
                    <Th>Date</Th>
                    <Th>Paid</Th>
                    <Th>Remaining</Th>
                    <Th>Method</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(receiptsQuery.data ?? []).map((row) => {
                    const student = row.studentId as unknown as
                      { user?: { fullName?: string } } | string;
                    const studentName =
                      typeof student === "object"
                        ? (student.user?.fullName ?? "—")
                        : "—";
                    return (
                      <tr key={row._id}>
                        <Td>{row.receiptNumber}</Td>
                        <Td>{studentName}</Td>
                        <Td>{row.paidDateBs}</Td>
                        <Td>{formatCurrencyNpr(row.amountPaidNpr)}</Td>
                        <Td>{formatCurrencyNpr(row.remainingDueNpr ?? 0)}</Td>
                        <Td>{row.paymentMethod.replace(/_/g, " ")}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadReceipt(row._id)}
                            >
                              {(row.printCount ?? 0) > 0 ? "Reprint" : "Print"}
                            </Button>
                            {canReverse ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600"
                                disabled={reverseCollection.isPending}
                                onClick={() => {
                                  const reason = window.prompt(
                                    "Reason for reversing this collection (required):",
                                  );
                                  if (reason && reason.length >= 3) {
                                    reverseCollection.mutate({
                                      id: row._id,
                                      reason,
                                    });
                                  }
                                }}
                              >
                                Reverse
                              </Button>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {false ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Student Accounts</CardTitle>
              <p className="text-sm text-slate-500">
                Search by name, mobile, login ID, or admission number.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Search">
                <Input
                  placeholder="Name, mobile, login ID, or admission no."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                />
              </FormField>
              {studentAccountsQuery.isLoading ? (
                <LoadingState />
              ) : filteredStudentAccounts.length === 0 ? (
                <EmptyState
                  title="No matching accounts"
                  description="Try a different search term."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Student</Th>
                        <Th>{labels.groupLabel}</Th>
                        <Th>Due</Th>
                        <Th>Paid</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {filteredStudentAccounts.map((account) => (
                        <tr key={account.student._id}>
                          <Td>
                            <StudentNameLink
                              studentId={account.student._id}
                              name={account.student.user.fullName}
                              subtitle={`${account.student.admissionNumber} · ${account.student.user.email}`}
                            />
                          </Td>
                          <Td>
                            {account.className} {account.sectionName}
                          </Td>
                          <Td>
                            <Badge
                              className={
                                account.remainingDueNpr > 0
                                  ? "bg-rose-100 text-rose-800"
                                  : undefined
                              }
                            >
                              {formatCurrencyNpr(account.remainingDueNpr)}
                            </Badge>
                          </Td>
                          <Td>{formatCurrencyNpr(account.totalPaidNpr)}</Td>
                          <Td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setSelectedStudentId(account.student._id)
                              }
                            >
                              History
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          {selectedStudentId && studentHistoryQuery.data ? (
            <Card>
              <CardHeader>
                <CardTitle>Financial History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    Outstanding:{" "}
                    <strong>
                      {formatCurrencyNpr(
                        Number(studentHistoryQuery.data?.outstandingDueNpr ?? 0),
                      )}
                    </strong>
                  </div>
                  <div>
                    Total Paid:{" "}
                    <strong>
                      {formatCurrencyNpr(
                        Number(studentHistoryQuery.data?.totalPaidNpr ?? 0),
                      )}
                    </strong>
                  </div>
                </div>
                {(
                  ((studentHistoryQuery.data?.collections as Array<
                    Record<string, unknown>
                  >) ?? [])
                ).map((c) => (
                  <div
                    key={String(c._id)}
                    className="rounded-xl border p-3 text-sm"
                  >
                    <div className="font-medium">{String(c.receiptNumber)}</div>
                    <div className="text-slate-500">
                      {String(c.paidDateBs)} ·{" "}
                      {formatCurrencyNpr(Number(c.amountPaidNpr))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {false ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingSalary ? "Edit Salary Payment" : "Pay Salary"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Employee Type">
                <Select
                  value={salaryForm.employeeType}
                  onChange={(e) =>
                    setSalaryForm((current) => ({
                      ...current,
                      employeeType: e.target
                        .value as SalaryPaymentInput["employeeType"],
                      teacherId: "",
                      staffId: "",
                      staffName: "",
                    }))
                  }
                >
                  <option value="TEACHER">Teacher</option>
                  <option value="STAFF">College Staff</option>
                </Select>
              </FormField>
              {salaryForm.employeeType === "TEACHER" ? (
                <FormField label="Teacher">
                  <Select
                    value={salaryForm.teacherId ?? ""}
                    onChange={(e) => {
                      const teacher = (
                        salaryEmployeesQuery.data?.teachers ?? []
                      ).find((item) => item._id === e.target.value);
                      const payType = teacher?.paymentType || "MONTHLY";
                      const contract =
                        payType === "PERIOD"
                          ? Number(teacher?.periodRateNpr ?? 0)
                          : payType === "TENDER"
                            ? (teacher?.tenders ?? []).reduce(
                                (sum, row) =>
                                  sum + (Number(row.tenderAmountNpr) || 0),
                                0,
                              )
                            : Number(teacher?.basicSalaryNpr ?? 0);
                      setSalaryForm((current) => ({
                        ...current,
                        teacherId: e.target.value,
                        basicSalaryNpr: contract || current.basicSalaryNpr,
                      }));
                    }}
                  >
                    <option value="">Select teacher</option>
                    {(salaryEmployeesQuery.data?.teachers ?? []).map(
                      (teacher) => (
                        <option key={teacher._id} value={teacher._id}>
                          {teacher.user.fullName}
                          {teacher.paymentType &&
                          teacher.paymentType !== "MONTHLY"
                            ? ` (${teacher.paymentType === "PERIOD" ? "per period" : "tender"})`
                            : ""}
                        </option>
                      ),
                    )}
                  </Select>
                </FormField>
              ) : (
                <FormField label="College Staff">
                  <Select
                    value={salaryForm.staffId ?? ""}
                    onChange={(e) => {
                      const staff = (
                        salaryEmployeesQuery.data?.collegeStaff ?? []
                      ).find((item) => item._id === e.target.value);
                      setSalaryForm((current) => ({
                        ...current,
                        staffId: e.target.value,
                        staffName: staff?.fullName ?? "",
                        basicSalaryNpr:
                          staff?.basicSalaryNpr ?? current.basicSalaryNpr,
                      }));
                    }}
                  >
                    <option value="">Select staff member</option>
                    {(salaryEmployeesQuery.data?.collegeStaff ?? []).map(
                      (staff) => (
                        <option key={staff._id} value={staff._id}>
                          {staff.fullName} ({staff.staffId})
                        </option>
                      ),
                    )}
                  </Select>
                </FormField>
              )}
              <FormField label="Month">
                <Input
                  value={salaryForm.monthBs}
                  onChange={(e) =>
                    setSalaryForm((c) => ({ ...c, monthBs: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Basic Salary">
                <NumberInput
                  value={salaryForm.basicSalaryNpr}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      basicSalaryNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Allowances">
                <NumberInput
                  value={salaryForm.allowancesNpr}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      allowancesNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Bonus">
                <NumberInput
                  value={salaryForm.bonusNpr}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      bonusNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Loan Deduction">
                <NumberInput
                  value={salaryForm.loanDeductionNpr}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      loanDeductionNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Tax">
                <NumberInput
                  value={salaryForm.taxNpr}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      taxNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Status">
                <Select
                  value={salaryForm.status}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      status: e.target.value as SalaryPaymentInput["status"],
                    }))
                  }
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PROCESSED">Processed</option>
                  <option value="PAID">Paid</option>
                </Select>
              </FormField>
              <FormField label="Paid Date (BS)">
                <NepaliDateField
                  value={salaryForm.paidDateBs ?? ""}
                  onChange={(v) =>
                    setSalaryForm((c) => ({ ...c, paidDateBs: v }))
                  }
                />
              </FormField>
              <FormField label="Payment Method">
                <Select
                  value={salaryForm.paymentMethod}
                  onChange={(e) =>
                    setSalaryForm((c) => ({
                      ...c,
                      paymentMethod: e.target
                        .value as SalaryPaymentInput["paymentMethod"],
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="flex gap-2">
                {editingSalary ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingSalary(null);
                      setSalaryForm(defaultSalary);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    const parsed = salaryPaymentSchema.safeParse(
                      emptyIdsToUndefined(
                        salaryForm as Record<string, unknown>,
                        ["teacherId", "staffId"],
                      ),
                    );
                    if (!parsed.success)
                      return toast.error(
                        parsed.error.issues[0]?.message ??
                          "Invalid salary data",
                      );
                    if (editingSalary) {
                      void updateSalary.mutateAsync({
                        id: editingSalary._id,
                        payload: parsed.data,
                      });
                    } else {
                      void createSalary.mutateAsync(parsed.data);
                    }
                  }}
                >
                  {editingSalary ? "Update Salary" : "Record Salary"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Salary History</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Month</Th>
                    <Th>Employee</Th>
                    <Th>Net Salary</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(salariesQuery.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{row.monthBs}</Td>
                      <Td>{getSalaryEmployeeLabel(row)}</Td>
                      <Td>{formatCurrencyNpr(row.netSalaryNpr)}</Td>
                      <Td>
                        <Badge>{row.status}</Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSalary(row);
                              setSalaryForm({
                                employeeType: row.employeeType,
                                teacherId: row.teacherId ?? "",
                                staffId: row.staffId ?? "",
                                staffName: row.staffName ?? "",
                                monthBs: row.monthBs,
                                basicSalaryNpr: row.basicSalaryNpr,
                                allowancesNpr: row.allowancesNpr,
                                bonusNpr: row.bonusNpr,
                                advanceSalaryNpr: row.advanceSalaryNpr,
                                loanDeductionNpr: row.loanDeductionNpr,
                                taxNpr: row.taxNpr,
                                otherDeductionsNpr: row.otherDeductionsNpr,
                                // Attendance-derived fields must be carried over, or
                                // saving the edit resets them to 0 / drops attachments
                                presentDays: row.presentDays ?? 0,
                                absentDays: row.absentDays ?? 0,
                                leaveDays: row.leaveDays ?? 0,
                                extraDuty: row.extraDuty ?? 0,
                                absentDeductionNpr: row.absentDeductionNpr ?? 0,
                                extraAmountNpr: row.extraAmountNpr ?? 0,
                                salaryAmountNpr: row.salaryAmountNpr ?? 0,
                                attendanceIncomplete:
                                  row.attendanceIncomplete ?? false,
                                attendanceManualOverride:
                                  row.attendanceManualOverride ?? false,
                                valuesManualOverride:
                                  row.valuesManualOverride ?? false,
                                status: row.status,
                                paidDateBs: row.paidDateBs ?? "",
                                paymentMethod: row.paymentMethod,
                                attachments: row.attachments ?? [],
                              });
                            }}
                          >
                            Edit
                          </Button>
                          {row.status !== "PAID" ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                if (!row.paidDateBs) {
                                  toast.error(
                                    "Set paid date (BS) using Edit before marking as paid",
                                  );
                                  return;
                                }
                                void updateSalary.mutateAsync({
                                  id: row._id,
                                  payload: {
                                    status: "PAID",
                                    paidDateBs: row.paidDateBs,
                                  },
                                });
                              }}
                            >
                              Mark Paid
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingExpense ? "Edit Expense" : "Daily Expense Register"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Posts journal (Dr expense · Cr cash/bank) and updates ledger
                automatically.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Date">
                <NepaliDateField
                  value={expenseForm.dateBs}
                  onChange={(v) => setExpenseForm((c) => ({ ...c, dateBs: v }))}
                />
              </FormField>
              <FormField label="Expense Category">
                <Select
                  value={expenseForm.category}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      category: e.target
                        .value as AccountingExpenseInput["category"],
                    }))
                  }
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Description">
                <Textarea
                  value={expenseForm.description}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      description: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Amount">
                <NumberInput
                  value={expenseForm.amountNpr}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      amountNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Payment Method">
                <Select
                  value={expenseForm.paymentMethod}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      paymentMethod: e.target
                        .value as AccountingExpenseInput["paymentMethod"],
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Voucher Number (optional)">
                <Input
                  value={expenseForm.voucherNumber ?? ""}
                  placeholder="Auto if blank"
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      voucherNumber: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Approved By">
                <Input
                  value={expenseForm.approvedBy || currentUserName}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      approvedBy: e.target.value,
                    }))
                  }
                  placeholder="Your account name"
                  title="Defaults to the person entering this expense"
                />
              </FormField>
              <FormField label="Vendor (optional)">
                <Input
                  value={expenseForm.vendor ?? ""}
                  onChange={(e) =>
                    setExpenseForm((c) => ({ ...c, vendor: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Attachment">
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const fd = new FormData();
                      fd.append("files", file);
                      const res = await unwrap<{
                        files: Array<{ url: string }>;
                      }>(
                        api.post("/uploads/accounting", fd, {
                          headers: {
                            "Content-Type": "multipart/form-data",
                          },
                        }),
                      );
                      const url = res.files?.[0]?.url ?? "";
                      setExpenseForm((c) => ({ ...c, attachmentUrl: url }));
                      toast.success("Attachment uploaded");
                    } catch (err) {
                      toast.error(parseErrorMessage(err));
                    }
                  }}
                />
                {expenseForm.attachmentUrl ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    Attached · {expenseForm.attachmentUrl}
                  </p>
                ) : null}
              </FormField>
              <div className="flex gap-2">
                {editingExpense ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingExpense(null);
                      setExpenseForm(freshExpenseForm());
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    const parsed = accountingExpenseSchema.safeParse({
                      ...expenseForm,
                      approvedBy:
                        expenseForm.approvedBy?.trim() || currentUserName,
                    });
                    if (!parsed.success)
                      return toast.error(
                        parsed.error.issues[0]?.message ?? "Invalid expense",
                      );
                    if (editingExpense) {
                      void updateExpense.mutateAsync({
                        id: editingExpense._id,
                        payload: parsed.data,
                      });
                    } else {
                      void createExpense.mutateAsync(parsed.data);
                    }
                  }}
                >
                  {editingExpense ? "Update Expense" : "Save Expense"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expense Records</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Voucher</Th>
                    <Th>Category</Th>
                    <Th>Amount</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(expensesQuery.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{row.dateBs}</Td>
                      <Td className="font-mono text-xs">
                        {row.voucherNumber ?? "—"}
                      </Td>
                      <Td>{row.category}</Td>
                      <Td>{formatCurrencyNpr(row.amountNpr)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              printRegisterVoucher({
                                kind: "Expense",
                                voucherNumber: row.voucherNumber,
                                dateBs: row.dateBs,
                                amountNpr: row.amountNpr,
                                narration: row.description,
                                fields: [
                                  { label: "Category", value: row.category },
                                  { label: "Vendor", value: row.vendor || "—" },
                                  {
                                    label: "Payment",
                                    value: row.paymentMethod.replace(/_/g, " "),
                                  },
                                  {
                                    label: "Approved By",
                                    value: row.approvedBy || "—",
                                  },
                                ],
                              })
                            }
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingExpense(row);
                              setExpenseForm({
                                category:
                                  row.category as AccountingExpenseInput["category"],
                                vendor: row.vendor ?? "",
                                dateBs: row.dateBs,
                                amountNpr: row.amountNpr,
                                paymentMethod: row.paymentMethod,
                                description: row.description,
                                voucherNumber: row.voucherNumber ?? "",
                                approvedBy: row.approvedBy ?? "",
                                attachmentUrl: row.attachmentUrl ?? "",
                              });
                            }}
                          >
                            Edit
                          </Button>
                          {canDelete ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                void deleteExpense.mutateAsync(row._id)
                              }
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "purchases" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingPurchase ? "Edit Purchase" : "Purchase Register"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Auto journal + ledger. Printable purchase voucher available on
                each row.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Purchase Date">
                <NepaliDateField
                  value={purchaseForm.purchaseDateBs}
                  onChange={(v) =>
                    setPurchaseForm((c) => ({ ...c, purchaseDateBs: v }))
                  }
                />
              </FormField>
              <FormField label="Vendor">
                <Input
                  value={purchaseForm.vendor}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({ ...c, vendor: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Bill Number">
                <Input
                  value={purchaseForm.invoiceNumber}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({
                      ...c,
                      invoiceNumber: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Category">
                <Select
                  value={purchaseForm.category}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({
                      ...c,
                      category: e.target
                        .value as AccountingPurchaseInput["category"],
                    }))
                  }
                >
                  {PURCHASE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Item">
                <Input
                  value={purchaseForm.item ?? ""}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({ ...c, item: e.target.value }))
                  }
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Quantity">
                  <NumberInput
                    value={purchaseForm.quantity}
                    onChange={(e) =>
                      setPurchaseForm((c) => ({
                        ...c,
                        quantity: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Unit Price">
                  <NumberInput
                    value={purchaseForm.unitPriceNpr}
                    onChange={(e) =>
                      setPurchaseForm((c) => ({
                        ...c,
                        unitPriceNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
              </div>
              <p className="text-sm text-slate-600">
                Total:{" "}
                <strong>
                  {formatCurrencyNpr(
                    (purchaseForm.quantity || 0) *
                      (purchaseForm.unitPriceNpr || 0),
                  )}
                </strong>
              </p>
              <FormField label="Payment Mode">
                <Select
                  value={purchaseForm.paymentMethod}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({
                      ...c,
                      paymentMethod: e.target
                        .value as AccountingPurchaseInput["paymentMethod"],
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Payment Status">
                <Select
                  value={purchaseForm.paymentStatus}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({
                      ...c,
                      paymentStatus: e.target
                        .value as AccountingPurchaseInput["paymentStatus"],
                    }))
                  }
                >
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Remarks">
                <Textarea
                  value={purchaseForm.description ?? ""}
                  onChange={(e) =>
                    setPurchaseForm((c) => ({
                      ...c,
                      description: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Attachment (Bill PDF/Image)">
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const fd = new FormData();
                      fd.append("files", file);
                      const res = await unwrap<{
                        files: Array<{ url: string }>;
                      }>(
                        api.post("/uploads/accounting", fd, {
                          headers: {
                            "Content-Type": "multipart/form-data",
                          },
                        }),
                      );
                      setPurchaseForm((c) => ({
                        ...c,
                        attachmentUrl: res.files?.[0]?.url ?? "",
                      }));
                      toast.success("Bill attached");
                    } catch (err) {
                      toast.error(parseErrorMessage(err));
                    }
                  }}
                />
                {purchaseForm.attachmentUrl ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    Attached · {purchaseForm.attachmentUrl}
                  </p>
                ) : null}
              </FormField>
              <div className="flex gap-2">
                {editingPurchase ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingPurchase(null);
                      setPurchaseForm(defaultPurchase);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    const parsed =
                      accountingPurchaseSchema.safeParse(purchaseForm);
                    if (!parsed.success)
                      return toast.error(
                        parsed.error.issues[0]?.message ?? "Invalid purchase",
                      );
                    if (editingPurchase) {
                      void updatePurchase.mutateAsync({
                        id: editingPurchase._id,
                        payload: parsed.data,
                      });
                    } else {
                      void createPurchase.mutateAsync(parsed.data);
                    }
                  }}
                >
                  {editingPurchase ? "Update Purchase" : "Save Purchase"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Purchase Records</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Voucher</Th>
                    <Th>Vendor / Item</Th>
                    <Th>Total</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(purchasesQuery.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{row.purchaseDateBs}</Td>
                      <Td className="font-mono text-xs">
                        {row.voucherNumber ?? "—"}
                      </Td>
                      <Td>
                        <div className="font-medium">{row.vendor}</div>
                        <div className="text-xs text-slate-500">
                          {row.item || row.category} · Bill {row.invoiceNumber}
                        </div>
                      </Td>
                      <Td>{formatCurrencyNpr(row.totalAmountNpr)}</Td>
                      <Td>
                        <Badge>{row.paymentStatus}</Badge>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              printRegisterVoucher({
                                kind: "Purchase",
                                voucherNumber: row.voucherNumber,
                                dateBs: row.purchaseDateBs,
                                amountNpr: row.totalAmountNpr,
                                narration: row.description,
                                fields: [
                                  { label: "Vendor", value: row.vendor },
                                  {
                                    label: "Bill Number",
                                    value: row.invoiceNumber,
                                  },
                                  { label: "Category", value: row.category },
                                  { label: "Item", value: row.item || "—" },
                                  {
                                    label: "Qty × Price",
                                    value: `${row.quantity} × ${row.unitPriceNpr}`,
                                  },
                                  {
                                    label: "Payment",
                                    value: `${row.paymentMethod.replace(/_/g, " ")} (${row.paymentStatus})`,
                                  },
                                ],
                              })
                            }
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingPurchase(row);
                              setPurchaseForm({
                                category:
                                  row.category as AccountingPurchaseInput["category"],
                                vendor: row.vendor,
                                purchaseDateBs: row.purchaseDateBs,
                                invoiceNumber: row.invoiceNumber,
                                item: row.item ?? "",
                                quantity: row.quantity,
                                unitPriceNpr: row.unitPriceNpr,
                                paymentStatus: row.paymentStatus,
                                paymentMethod: row.paymentMethod,
                                description: row.description ?? "",
                                voucherNumber: row.voucherNumber ?? "",
                                attachmentUrl: row.attachmentUrl ?? "",
                              });
                            }}
                          >
                            Edit
                          </Button>
                          {row.paymentStatus !== "PAID" ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                void updatePurchase.mutateAsync({
                                  id: row._id,
                                  payload: { paymentStatus: "PAID" },
                                })
                              }
                            >
                              Mark Paid
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                void deletePurchase.mutateAsync(row._id)
                              }
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "income" ? (
        <div className="space-y-6">
          {/* Where income actually comes from — fees are posted from Fee Records */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                {
                  label: "Student fee income",
                  value: incomeOverview?.totals.studentFeeNpr ?? 0,
                  hint: `${incomeOverview?.totals.feeReceiptCount ?? 0} receipt(s) · from Student Fee Records`,
                  tone: "text-brand-700",
                },
                {
                  label: "Other income",
                  value: incomeOverview?.totals.otherIncomeNpr ?? 0,
                  hint: `${incomeOverview?.totals.otherIncomeCount ?? 0} entry(s) · recorded below`,
                  tone: "text-emerald-700",
                },
                {
                  label: "Total income",
                  value: incomeOverview?.totals.totalIncomeNpr ?? 0,
                  hint: "Fees + other income (cash received)",
                  tone: "text-emerald-800",
                },
                {
                  label: "Security deposit (memo)",
                  value: incomeOverview?.totals.securityDepositCollectedNpr ?? 0,
                  hint: "Refundable liability — not counted as income",
                  tone: "text-violet-700",
                },
              ] as const
            ).map((card) => (
              <Card key={card.label} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="truncate text-sm font-medium text-slate-500">
                    {card.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0">
                  <p
                    className={cn(
                      "break-words text-lg font-semibold tabular-nums leading-snug sm:text-xl",
                      card.tone,
                    )}
                    title={formatCurrencyNpr(card.value)}
                  >
                    {formatCurrencyNpr(card.value)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-base">Income</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Every rupee earned: student fees (posted automatically from
                  Student Fee Records) plus non-fee income you record here.
                  Security deposits are excluded — they are refundable.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="From (BS)">
                  <NepaliDateField
                    value={incomeFromBs}
                    onChange={(v) => setIncomeFromBs(v)}
                  />
                </FormField>
                <FormField label="To (BS)">
                  <NepaliDateField
                    value={incomeToBs}
                    onChange={(v) => setIncomeToBs(v)}
                  />
                </FormField>
                <FormField label="Source">
                  <Select
                    value={incomeKind}
                    onChange={(e) =>
                      setIncomeKind(e.target.value as typeof incomeKind)
                    }
                  >
                    <option value="ALL">All income</option>
                    <option value="FEE">Student fees</option>
                    <option value="OTHER">Other income</option>
                  </Select>
                </FormField>
                <FormField label="Search">
                  <Input
                    placeholder="Student, source, receipt…"
                    value={incomeSearch}
                    onChange={(e) => setIncomeSearch(e.target.value)}
                  />
                </FormField>
                {incomeFromBs || incomeToBs || incomeKind !== "ALL" || incomeSearch ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIncomeFromBs("");
                      setIncomeToBs("");
                      setIncomeKind("ALL");
                      setIncomeSearch("");
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            {(incomeOverview?.byCategory.length ?? 0) > 0 ? (
              <CardContent className="pt-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Income by head
                </p>
                <div className="flex flex-wrap gap-2">
                  {(incomeOverview?.byCategory ?? []).map((item) => (
                    <span
                      key={`${item.kind}-${item.label}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                        item.kind === "FEE"
                          ? "border-brand-200 bg-brand-50 text-brand-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800",
                      )}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="tabular-nums">
                        {formatCurrencyNpr(item.amountNpr)}
                      </span>
                    </span>
                  ))}
                </div>
              </CardContent>
            ) : null}
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
          <Card className={cn("xl:col-span-1", !showIncomeForm && !editingIncome && "h-fit")}>
            <CardHeader>
              <CardTitle>
                {editingIncome ? "Edit Income" : "Other Income Register"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Non-fee income only (donation, certificate, form sales, fine,
                interest). Auto journal + ledger. Student fees are collected in
                Student Fee Records — do not re-enter them here or income will be
                counted twice.
              </p>
              {!showIncomeForm && !editingIncome ? (
                <Button
                  className="mt-3 w-fit"
                  variant="outline"
                  onClick={() => setShowIncomeForm(true)}
                >
                  Add other income
                </Button>
              ) : null}
            </CardHeader>
            {showIncomeForm || editingIncome ? (
            <CardContent className="space-y-3">
              <FormField label="Date">
                <NepaliDateField
                  value={incomeForm.dateBs}
                  onChange={(v) => setIncomeForm((c) => ({ ...c, dateBs: v }))}
                />
              </FormField>
              <FormField label="Income Type">
                <Select
                  value={incomeForm.category}
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      category: e.target
                        .value as AccountingIncomeInput["category"],
                    }))
                  }
                >
                  {INCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Source">
                <Input
                  value={incomeForm.source}
                  onChange={(e) =>
                    setIncomeForm((c) => ({ ...c, source: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Description">
                <Textarea
                  value={incomeForm.description ?? ""}
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      description: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Amount">
                <NumberInput
                  value={incomeForm.amountNpr}
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      amountNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Payment Mode">
                <Select
                  value={incomeForm.paymentMethod}
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      paymentMethod: e.target
                        .value as AccountingIncomeInput["paymentMethod"],
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Receipt no.">
                <Input
                  value={incomeForm.receiptNumber ?? ""}
                  placeholder="As printed on the receipt book"
                  autoComplete="off"
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      receiptNumber: e.target.value,
                    }))
                  }
                />
              </FormField>
              <div className="flex gap-2">
                {editingIncome || showIncomeForm ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingIncome(null);
                      setIncomeForm(defaultIncome);
                      setShowIncomeForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    if (!(incomeForm.receiptNumber ?? "").trim()) {
                      return toast.error("Enter receipt number");
                    }
                    const parsed = accountingIncomeSchema.safeParse(incomeForm);
                    if (!parsed.success)
                      return toast.error(
                        parsed.error.issues[0]?.message ?? "Invalid income",
                      );
                    if (editingIncome) {
                      void updateIncome.mutateAsync({
                        id: editingIncome._id,
                        payload: parsed.data,
                      });
                    } else {
                      void createIncome.mutateAsync(parsed.data);
                    }
                  }}
                >
                  {editingIncome ? "Update Income" : "Save Income"}
                </Button>
              </div>
            </CardContent>
            ) : null}
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Income records</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                {incomeRows.length} of {incomeOverview?.rowCount ?? 0} entries
                {(incomeOverview?.rowCount ?? 0) > (incomeOverview?.rows.length ?? 0)
                  ? " (latest 500 shown — totals above cover every entry)"
                  : ""}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {incomeOverviewQuery.isLoading ? (
                <LoadingState />
              ) : incomeRows.length === 0 ? (
                <EmptyState
                  title="No income in this range"
                  description="Collect fees in Student Fee Records or add a non-fee entry in the Other Income Register."
                />
              ) : (
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Receipt</Th>
                      <Th>Source of income</Th>
                      <Th>From</Th>
                      <Th>Mode</Th>
                      <Th>Amount</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {incomeRows.map((row) => {
                      const record =
                        row.kind === "OTHER"
                          ? incomeRecordsById.get(row.id)
                          : undefined;
                      return (
                        <tr key={`${row.kind}-${row.id}`}>
                          <Td className="whitespace-nowrap">{row.dateBs || "—"}</Td>
                          <Td className="font-mono text-xs">
                            {row.receiptNumber || "—"}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                className={cn(
                                  row.kind === "OTHER" &&
                                    "bg-emerald-100 text-emerald-800",
                                )}
                              >
                                {row.kind === "FEE" ? "Student fee" : "Other"}
                              </Badge>
                              <span>{row.category}</span>
                            </div>
                            {row.description ? (
                              <p className="mt-0.5 text-xs text-slate-500">
                                {row.description}
                              </p>
                            ) : null}
                          </Td>
                          <Td>{row.source || "—"}</Td>
                          <Td className="whitespace-nowrap">
                            {row.paymentMethod.replace(/_/g, " ") || "—"}
                          </Td>
                          <Td className="whitespace-nowrap font-semibold tabular-nums">
                            {formatCurrencyNpr(row.amountNpr)}
                          </Td>
                          <Td>
                            {row.kind === "FEE" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setTab("fee-records")}
                                title="Fee receipts are managed in Student Fee Records"
                              >
                                Open in Fee Records
                              </Button>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    printRegisterVoucher({
                                      kind: "Income",
                                      voucherNumber: row.receiptNumber,
                                      dateBs: row.dateBs,
                                      amountNpr: row.amountNpr,
                                      narration: row.description,
                                      fields: [
                                        {
                                          label: "Income Type",
                                          value: row.category,
                                        },
                                        { label: "Source", value: row.source },
                                        {
                                          label: "Payment Mode",
                                          value: row.paymentMethod.replace(
                                            /_/g,
                                            " ",
                                          ),
                                        },
                                      ],
                                    })
                                  }
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                                {record ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setEditingIncome(record);
                                      setShowIncomeForm(true);
                                      setIncomeForm({
                                        category:
                                          record.category as AccountingIncomeInput["category"],
                                        source: record.source,
                                        dateBs: record.dateBs,
                                        amountNpr: record.amountNpr,
                                        paymentMethod: record.paymentMethod,
                                        description: record.description ?? "",
                                        receiptNumber: record.receiptNumber ?? "",
                                        voucherNumber: record.voucherNumber ?? "",
                                      });
                                    }}
                                  >
                                    Edit
                                  </Button>
                                ) : null}
                                {canDelete ? (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => confirmVoidIncome(row)}
                                  >
                                    Void
                                  </Button>
                                ) : null}
                              </div>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      ) : null}

      {false ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Add Cash Entry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Date">
                <NepaliDateField
                  value={cashForm.dateBs}
                  onChange={(v) => setCashForm((c) => ({ ...c, dateBs: v }))}
                />
              </FormField>
              <FormField label="Type">
                <Select
                  value={cashForm.entryType}
                  onChange={(e) =>
                    setCashForm((c) => ({
                      ...c,
                      entryType: e.target
                        .value as CashBookEntryInput["entryType"],
                    }))
                  }
                >
                  <option value="CREDIT">Credit (In)</option>
                  <option value="DEBIT">Debit (Out)</option>
                </Select>
              </FormField>
              <FormField label="Category">
                <Input
                  value={cashForm.category}
                  onChange={(e) =>
                    setCashForm((c) => ({ ...c, category: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Description">
                <Textarea
                  value={cashForm.description}
                  onChange={(e) =>
                    setCashForm((c) => ({ ...c, description: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Amount">
                <NumberInput
                  value={cashForm.amountNpr}
                  onChange={(e) =>
                    setCashForm((c) => ({
                      ...c,
                      amountNpr: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <Button
                onClick={() => {
                  const parsed = cashBookEntrySchema.safeParse(cashForm);
                  if (!parsed.success) return toast.error("Invalid entry");
                  void createCashEntry.mutateAsync(parsed.data);
                }}
              >
                Add Entry
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cash Book</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Type</Th>
                    <Th>Description</Th>
                    <Th>Amount</Th>
                    <Th>Balance</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(cashBookQuery.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{row.dateBs}</Td>
                      <Td>
                        <Badge
                          className={
                            row.entryType === "CREDIT"
                              ? undefined
                              : "bg-rose-100 text-rose-800"
                          }
                        >
                          {row.entryType}
                        </Badge>
                      </Td>
                      <Td>{row.description}</Td>
                      <Td>{formatCurrencyNpr(row.amountNpr)}</Td>
                      <Td>{formatCurrencyNpr(row.balanceAfterNpr)}</Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "reports" ? (
        <Card>
          <CardHeader>
            <CardTitle>Financial Reports</CardTitle>
            <p className="text-sm text-slate-500">
              Ledger, student fees, salary, refunds, purchases, expenses,
              income, journal, and monthly summary — with date filters, print,
              PDF/CSV, and Excel export.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[14rem] flex-1 sm:flex-none sm:w-64">
                  <FormField label="Report type">
                    <Select
                      value={selectedReport}
                      onChange={(e) =>
                        setSelectedReport(
                          e.target.value as typeof selectedReport,
                        )
                      }
                    >
                      {reportTypes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    const printRoot = document.getElementById(
                      "accounting-report-print",
                    );
                    if (!printRoot || !printRoot.innerHTML.trim()) {
                      toast.error(
                        "Nothing to print — generate or wait for report data first",
                      );
                      return;
                    }
                    try {
                      const periodLabel =
                        reportFromBs || reportToBs
                          ? `From ${reportFromBs || "…"} to ${reportToBs || "…"}${
                              reportFromBs
                                ? ` (AD ${bsDateToAdString(reportFromBs) || "—"})`
                                : ""
                            }`
                          : undefined;
                      printSimpleDocument({
                        title:
                          reportTypes.find((r) => r.id === selectedReport)
                            ?.label ?? "Report",
                        subtitle: periodLabel,
                        bodyHtml: printRoot.innerHTML,
                      });
                      toast.success(
                        "Print dialog opening — choose printer or Save as PDF",
                      );
                    } catch (e) {
                      toast.error(
                        parseErrorMessage(e) || "Could not print report",
                      );
                    }
                  }}
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  Print / PDF
                </Button>
                <Button variant="outline" onClick={() => exportReport("csv")}>
                  Export CSV
                </Button>
                <Button variant="outline" onClick={() => exportReport("xlsx")}>
                  Export Excel
                </Button>
              </div>

              {reportUsesDateRange ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="mb-3 text-sm font-medium text-slate-700">
                    Date range (BS and AD — enter either side, the other fills
                    automatically)
                  </p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <FormField label="From date">
                      <DualBsAdDateField
                        valueBs={reportFromBs}
                        onChangeBs={(bs) => {
                          setReportFromBs(bs);
                        }}
                        bsPlaceholder="From date (BS)"
                      />
                    </FormField>
                    <FormField label="To date">
                      <DualBsAdDateField
                        valueBs={reportToBs}
                        onChangeBs={(bs) => {
                          setReportToBs(bs);
                        }}
                        bsPlaceholder="To date (BS)"
                      />
                    </FormField>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReportFromBs("");
                        setReportToBs("");
                      }}
                    >
                      Clear dates
                    </Button>
                    {reportFromBs || reportToBs ? (
                      <p className="text-xs text-slate-500">
                        Filter:{" "}
                        {reportFromBs
                          ? `from BS ${reportFromBs}${
                              bsDateToAdString(reportFromBs)
                                ? ` / AD ${bsDateToAdString(reportFromBs)}`
                                : ""
                            }`
                          : "from start"}{" "}
                        →{" "}
                        {reportToBs
                          ? `to BS ${reportToBs}${
                              bsDateToAdString(reportToBs)
                                ? ` / AD ${bsDateToAdString(reportToBs)}`
                                : ""
                            }`
                          : "to end"}
                        {reportMonthFromRange
                          ? ` · month key ${reportMonthFromRange}`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Leave empty for all dates (where supported). For monthly
                        summary / salary, set at least a From date.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {reportQuery.isLoading ? (
              <LoadingState />
            ) : reportQuery.isError ? (
              <EmptyState
                title="Could not load report"
                description={parseErrorMessage(reportQuery.error)}
              />
            ) : financialSummary ? (
              <div id="accounting-report-print" className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {[
                    {
                      label: "Fee Collections",
                      value: financialSummary.totals.feeCollectionNpr,
                    },
                    {
                      label: "Income",
                      value: financialSummary.totals.incomeNpr,
                    },
                    {
                      label: "Expenses",
                      value: financialSummary.totals.expenseNpr,
                    },
                    {
                      label: "Purchases",
                      value: financialSummary.totals.purchaseNpr,
                    },
                    {
                      label: "Salaries",
                      value: financialSummary.totals.salaryNpr,
                    },
                    {
                      label: "Net Surplus",
                      value: financialSummary.totals.netSurplusNpr,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {item.label}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatCurrencyNpr(item.value)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        {REPORT_COLUMNS["financial-summary"].map((column) => (
                          <Th key={column.key}>{column.label}</Th>
                        ))}
                      </tr>
                    </TableHead>
                    <TableBody>
                      {getReportRows(
                        "financial-summary",
                        financialSummary.data,
                      ).map((row, index) => (
                        <tr key={index}>
                          {REPORT_COLUMNS["financial-summary"].map((column) => (
                            <Td key={column.key}>
                              {getReportCellValue(row, column)}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-700">
                      Detailed breakdown for {financialSummary.period.label}
                    </p>
                    <Select
                      value={summarySection}
                      onChange={(e) =>
                        setSummarySection(
                          e.target.value as typeof summarySection,
                        )
                      }
                    >
                      {FINANCIAL_SUMMARY_SECTIONS.map((section) => (
                        <option key={section.key} value={section.key}>
                          {section.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {(() => {
                    const activeSection = FINANCIAL_SUMMARY_SECTIONS.find(
                      (section) => section.key === summarySection,
                    );
                    const sectionRows =
                      financialSummary.sections[summarySection] ?? [];
                    const sectionReportType =
                      activeSection?.reportType ?? "expenses";

                    return (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHead>
                            <tr>
                              {REPORT_COLUMNS[sectionReportType].map(
                                (column) => (
                                  <Th key={column.key}>{column.label}</Th>
                                ),
                              )}
                            </tr>
                          </TableHead>
                          <TableBody>
                            {sectionRows.length === 0 ? (
                              <tr>
                                <Td
                                  colSpan={
                                    REPORT_COLUMNS[sectionReportType].length
                                  }
                                >
                                  No{" "}
                                  {activeSection?.label.toLowerCase() ??
                                    "records"}{" "}
                                  for the selected month.
                                </Td>
                              </tr>
                            ) : (
                              getReportRows(sectionReportType, sectionRows).map(
                                (row, index) => (
                                  <tr key={index}>
                                    {REPORT_COLUMNS[sectionReportType].map(
                                      (column) => (
                                        <Td key={column.key}>
                                          {getReportCellValue(row, column)}
                                        </Td>
                                      ),
                                    )}
                                  </tr>
                                ),
                              )
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div id="accounting-report-print" className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      {REPORT_COLUMNS[selectedReport].map((column) => (
                        <Th key={column.key}>{column.label}</Th>
                      ))}
                      {canDelete &&
                      (selectedReport === "day-book" ||
                        selectedReport === "scholarship-report") ? (
                        <Th className="text-right print:hidden">Actions</Th>
                      ) : null}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {standardReportRows.length === 0 ? (
                      <tr>
                        <Td
                          colSpan={
                            REPORT_COLUMNS[selectedReport].length +
                            (canDelete &&
                            (selectedReport === "day-book" ||
                              selectedReport === "scholarship-report")
                              ? 1
                              : 0)
                          }
                        >
                          No report data for the selected filters.
                        </Td>
                      </tr>
                    ) : (
                      getReportRows(selectedReport, standardReportRows).map(
                        (row, index) => {
                          const raw = row as Record<string, unknown>;
                          const rowId = String(raw._id ?? "");
                          const isRev =
                            Boolean(raw.isReversed) || Boolean(raw.isReversal);
                          const showDelete =
                            canDelete &&
                            rowId &&
                            ((selectedReport === "day-book" && !isRev) ||
                              selectedReport === "scholarship-report");
                          return (
                            <tr key={index}>
                              {REPORT_COLUMNS[selectedReport].map((column) => (
                                <Td key={column.key}>
                                  {getReportCellValue(row, column)}
                                </Td>
                              ))}
                              {canDelete &&
                              (selectedReport === "day-book" ||
                                selectedReport === "scholarship-report") ? (
                                <Td className="text-right print:hidden">
                                  {showDelete ? (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="print:hidden"
                                      disabled={deleteFromReport.isPending}
                                      onClick={() => {
                                        if (
                                          !window.confirm(
                                            selectedReport === "day-book"
                                              ? "Delete this day-book voucher (reverse journal)?"
                                              : "Delete this scholarship fee payment?",
                                          )
                                        ) {
                                          return;
                                        }
                                        deleteFromReport.mutate({
                                          kind:
                                            selectedReport === "day-book"
                                              ? "journal"
                                              : "fee-collection",
                                          id: rowId,
                                        });
                                      }}
                                    >
                                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                                      Delete
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      —
                                    </span>
                                  )}
                                </Td>
                              ) : null}
                            </tr>
                          );
                        },
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "chart-of-accounts" ? (
        <ChartOfAccountsPanel isAdmin={isAdmin} />
      ) : null}
      {tab === "fixed-assets" ? (
        <FixedAssetsPanel canWrite={canWrite && !isCashier} isAdmin={isAdmin} />
      ) : null}
      {tab === "bank-reconciliation" ? (
        <BankReconciliationPanel canWrite={canWrite && !isCashier} />
      ) : null}
      {tab === "budget" ? <BudgetPanel isAdmin={isAdmin} /> : null}
      {tab === "journal-entries" ? (
        <JournalEntriesPanel
          canWrite={canWrite && !isCashier}
          canDelete={canDelete}
        />
      ) : null}

      {false ? (
        <Card>
          <CardHeader>
            <CardTitle>Accounting Settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {settingsQuery.isLoading ? (
              <LoadingState />
            ) : settingsQuery.data ? (
              <>
                <FormField label="Late Fine %">
                  <NumberInput
                    value={settingsForm.lateFinePercent}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        lateFinePercent: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Grace Days">
                  <NumberInput
                    value={settingsForm.lateFineGraceDays}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        lateFineGraceDays: e.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Receipt Prefix">
                  <Input
                    value={settingsForm.receiptPrefix}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        receiptPrefix: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Default Payment Method">
                  <Select
                    value={settingsForm.defaultPaymentMethod}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        defaultPaymentMethod: e.target
                          .value as AccountingSettingsInput["defaultPaymentMethod"],
                      }))
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Auto Receipt Number">
                  <Select
                    value={settingsForm.autoReceiptNumber ? "yes" : "no"}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        autoReceiptNumber: e.target.value === "yes",
                      }))
                    }
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </Select>
                </FormField>
                <FormField label="Approval Threshold (NPR)">
                  <NumberInput
                    value={settingsForm.approvalThresholdNpr}
                    onChange={(e) =>
                      setSettingsForm((c) => ({
                        ...c,
                        approvalThresholdNpr: e.target.valueAsNumber,
                      }))
                    }
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Reverse/void requests at or above this amount need
                    principal/admin approval.
                  </p>
                </FormField>
                <div className="md:col-span-2">
                  <Button
                    onClick={() => {
                      const parsed =
                        accountingSettingsSchema.safeParse(settingsForm);
                      if (!parsed.success)
                        return toast.error("Invalid settings");
                      void saveSettings.mutateAsync(parsed.data);
                    }}
                  >
                    Save Settings
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {false ? (
        <div />
      ) : null}

      {false ? (
        <Card>
          <CardHeader>
            <CardTitle>Accounting Audit Trail</CardTitle>
            <p className="text-sm text-slate-500">
              Print, reprint, reverse, approval, and mutation events with user,
              timestamp, and device info.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {auditLogsQuery.isLoading ? (
              <LoadingState />
            ) : (auditLogsQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No audit entries yet"
                description="Financial actions will be logged here automatically."
              />
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <Th>When</Th>
                    <Th>User</Th>
                    <Th>Action</Th>
                    <Th>Entity</Th>
                    <Th>IP</Th>
                    <Th>Changes</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(auditLogsQuery.data ?? []).map((log) => {
                    const actor = log.actorUserId as
                      | { fullName?: string; email?: string }
                      | string
                      | undefined;
                    const roleLabel =
                      log.actorRole === "COLLEGE_VIEWER"
                        ? "College Administrator"
                        : log.actorRole === "COLLEGE_ADMIN"
                          ? "Administrator"
                          : log.actorRole === "SUPER_ADMIN"
                            ? "System Administrator"
                            : log.actorRole === "ACCOUNTANT"
                              ? "Accountant"
                              : log.actorRole;
                    const actorName =
                      typeof actor === "object" && actor
                        ? actor.fullName?.trim() ||
                          actor.email?.trim() ||
                          roleLabel
                        : roleLabel;
                    const hasChange = log.before != null || log.after != null;
                    return (
                      <tr key={log._id}>
                        <Td>
                          {log.createdAt
                            ? new Date(log.createdAt).toLocaleString()
                            : "—"}
                        </Td>
                        <Td>
                          <div className="font-medium text-slate-900">
                            {actorName}
                          </div>
                          {typeof actor === "object" &&
                          actor?.fullName?.trim() &&
                          roleLabel ? (
                            <div className="text-xs text-slate-500">
                              {roleLabel}
                            </div>
                          ) : null}
                        </Td>
                        <Td>{log.action.replace(/\./g, " · ")}</Td>
                        <Td>{log.entity}</Td>
                        <Td className="font-mono text-xs">
                          {log.ipAddress ?? "—"}
                        </Td>
                        <Td className="text-xs text-slate-600">
                          {hasChange ? "Before/after recorded" : "—"}
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {false ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingAccountant ? "Edit Accountant" : "Add Accountant"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Full Name">
                <Input
                  value={accountantForm.fullName}
                  onChange={(e) =>
                    setAccountantForm((c) => ({
                      ...c,
                      fullName: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Employee ID">
                <Input
                  value={accountantForm.employeeId}
                  onChange={(e) =>
                    setAccountantForm((c) => ({
                      ...c,
                      employeeId: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Login ID">
                <Input
                  value={accountantForm.email}
                  onChange={(e) =>
                    setAccountantForm((c) => ({ ...c, email: e.target.value }))
                  }
                  placeholder="accountant01 or name@college.com"
                />
              </FormField>
              <FormField label="Phone">
                <Input
                  value={accountantForm.phone ?? ""}
                  onChange={(e) =>
                    setAccountantForm((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </FormField>
              {!editingAccountant ? (
                <FormField label="Password">
                  <Input
                    type="password"
                    value={accountantPassword}
                    placeholder="Leave blank for default password"
                    onChange={(e) => setAccountantPassword(e.target.value)}
                  />
                </FormField>
              ) : null}
              <FormField label="Gender">
                <Select
                  value={accountantForm.gender}
                  onChange={(e) =>
                    setAccountantForm((c) => ({ ...c, gender: e.target.value }))
                  }
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </Select>
              </FormField>
              <FormField label="Joining Date">
                <NepaliDateField
                  value={accountantForm.joinedDateBs}
                  onChange={(v) =>
                    setAccountantForm((c) => ({ ...c, joinedDateBs: v }))
                  }
                />
              </FormField>
              <AddressFields
                value={accountantForm.address}
                onChange={(address) =>
                  setAccountantForm((c) => ({ ...c, address }))
                }
              />
              <Button
                onClick={() => {
                  const parsed = accountantSchema.safeParse({
                    ...accountantForm,
                    password: accountantPassword.trim() || undefined,
                  });
                  if (!parsed.success)
                    return toast.error(
                      parsed.error.issues[0]?.message ?? "Invalid accountant",
                    );
                  void saveAccountant.mutateAsync(parsed.data);
                }}
              >
                {editingAccountant ? "Update" : "Create"} Accountant
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Accountants</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>ID</Th>
                    <Th>Email</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(accountantsQuery.data ?? []).map((accountant) => (
                    <tr key={accountant._id}>
                      <Td>{accountant.user.fullName}</Td>
                      <Td>{accountant.employeeId}</Td>
                      <Td>{accountant.user.email}</Td>
                      <Td>
                        <Badge>{accountant.status}</Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingAccountant(accountant);
                              setAccountantForm({
                                fullName: accountant.user.fullName,
                                email: accountant.user.email,
                                phone: accountant.user.phone ?? "",
                                employeeId: accountant.employeeId,
                                gender: accountant.gender,
                                address: accountant.address,
                                joinedDateBs: accountant.joinedDateBs,
                                photoUrl: accountant.photoUrl ?? "",
                                status: accountant.status,
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void resetPassword.mutateAsync(accountant._id)
                            }
                          >
                            Reset PW
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              void deactivateAccountant.mutateAsync(
                                accountant._id,
                              )
                            }
                          >
                            Deactivate
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};
