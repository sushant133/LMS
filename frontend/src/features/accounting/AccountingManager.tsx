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
  FileText,
  Landmark,
  LayoutDashboard,
  Printer,
  RotateCcw,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useIsCollege } from "hooks/useInstitutionType";
import { getAcademicLabels } from "lib/academicStructureUtils";
import {
  FINANCIAL_SUMMARY_SECTIONS,
  REPORT_COLUMNS,
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
import { ChartOfAccountsPanel } from "./ChartOfAccountsPanel";
import { JournalEntriesPanel } from "./JournalEntriesPanel";
import { LedgerPanel } from "./LedgerPanel";
import { StudentFeeRecordsPanel } from "./StudentFeeRecordsPanel";
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

import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";

type Tab =
  | "dashboard"
  | "fee-records"
  | "salary-records"
  | "refund-records"
  | "purchases"
  | "expenses"
  | "income"
  | "ledger"
  | "chart-of-accounts"
  | "journal-entries"
  | "reports";

const accountingTabs: Tab[] = [
  "dashboard",
  "fee-records",
  "salary-records",
  "refund-records",
  "purchases",
  "expenses",
  "income",
  "ledger",
  "chart-of-accounts",
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
  { id: "salary-records", label: "Salary Payment Records", icon: Banknote },
  { id: "refund-records", label: "Refund Records", icon: RotateCcw },
  { id: "purchases", label: "Purchases", icon: ShoppingCart },
  { id: "expenses", label: "Expenses", icon: TrendingDown },
  { id: "income", label: "Income", icon: TrendingUp },
  { id: "ledger", label: "Ledger", icon: BookMarked },
  { id: "chart-of-accounts", label: "Chart of Accounts", icon: Landmark },
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
  lateFeeNpr: 0,
  advancePaymentNpr: 0,
  paymentMethod: "CASH",
  feeBreakdown: [],
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
  status: "DRAFT",
  paidDateBs: "",
  paymentMethod: "BANK_TRANSFER",
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
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const normalizedRole = normalizeUserRole(user?.role ?? "");
  const isAdmin = isInstitutionAdmin(normalizedRole);
  const isAuditor = normalizedRole === "AUDITOR";
  const isPrincipal = normalizedRole === "PRINCIPAL";
  const isCashier = normalizedRole === "CASHIER";
  const isReadOnlyCollegeAdmin = normalizedRole === "COLLEGE_VIEWER";
  const canWrite = !isAuditor && !isPrincipal && !isReadOnlyCollegeAdmin;
  const canApprove = ACCOUNTING_APPROVER_ROLES.includes(normalizedRole);
  const canViewAudit = hasAccountingPermission(normalizedRole, "view_audit");
  const canReverse = hasAccountingPermission(
    normalizedRole,
    "reverse_transaction",
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [studentSearch, setStudentSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [editingStructure, setEditingStructure] =
    useState<FeeStructureRecord | null>(null);
  const [accountantPassword, setAccountantPassword] = useState("");
  const [structureForm, setStructureForm] = useState(defaultStructure);
  const [collectionForm, setCollectionForm] = useState(defaultCollection);
  const [expenseForm, setExpenseForm] = useState(defaultExpense);
  const [purchaseForm, setPurchaseForm] = useState(defaultPurchase);
  const [incomeForm, setIncomeForm] = useState(defaultIncome);
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
  const [reportMonth, setReportMonth] = useState("2081-09");
  const [reportDate, setReportDate] = useState("2081-09-01");
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

  const structuresQuery = useQuery({
    queryKey: ["accounting-structures"],
    queryFn: () =>
      unwrap<FeeStructureRecord[]>(api.get("/accounting/structures")),
  });

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
  });

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: !isCollege,
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isCollege,
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isCollege,
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

  const reportQuery = useQuery({
    queryKey: ["accounting-report", selectedReport, reportMonth, reportDate],
    queryFn: () =>
      unwrap<FinancialSummaryReport | { data: unknown[] }>(
        api.get(`/accounting/reports/${selectedReport}`, {
          params: {
            monthBs: reportUsesMonthFilter(selectedReport)
              ? reportMonth
              : undefined,
            dateBs:
              selectedReport === "daily-fee-collection"
                ? reportDate
                : undefined,
          },
        }),
      ),
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
      setExpenseForm(defaultExpense);
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

  const deleteIncome = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/accounting/income/${id}`)),
    onSuccess: async () => {
      toast.success("Income deleted");
      await invalidateAccounting();
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
      setExpenseForm(defaultExpense);
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

  if (!user || !ACCOUNTING_ACCESS_ROLES.includes(user.role)) {
    return null;
  }

  const isInitialLoading =
    studentsQuery.isLoading ||
    structuresQuery.isLoading ||
    (isCollege
      ? batchesQuery.isLoading || yearsQuery.isLoading
      : classesQuery.isLoading);

  if (isInitialLoading) {
    return <LoadingState />;
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
    if (reportUsesMonthFilter(selectedReport))
      params.set("monthBs", reportMonth);
    if (selectedReport === "daily-fee-collection")
      params.set("dateBs", reportDate);
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
                <Card key={stat.label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-500">
                      {stat.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "text-2xl font-semibold",
                      stat.label.includes("Expense") && "text-rose-700",
                      stat.label.includes("Income") && "text-emerald-700",
                      stat.label.includes("Cash") && "text-brand-700",
                      stat.label.includes("Collection") && "text-brand-800",
                    )}
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
                    title: "Recent Fee Collections",
                    items: dashboardQuery.data?.recentFees ?? [],
                    amountClass: "text-brand-700",
                  },
                  {
                    title: "Recent Salary Payments",
                    items: dashboardQuery.data?.recentSalaries ?? [],
                    amountClass: "text-emerald-800",
                  },
                  {
                    title: "Recent Purchases",
                    items: dashboardQuery.data?.recentPurchases ?? [],
                    amountClass: "text-indigo-800",
                  },
                  {
                    title: "Recent Expenses",
                    items: dashboardQuery.data?.recentExpenseItems ?? [],
                    amountClass: "text-rose-700",
                  },
                  {
                    title: "Recent Refunds",
                    items: dashboardQuery.data?.recentRefunds ?? [],
                    amountClass: "text-violet-800",
                  },
                ] as const
              ).map((section) => (
                <Card key={section.title}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {section.items.length === 0 ? (
                      <p className="text-sm text-slate-500">No records yet.</p>
                    ) : (
                      section.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white p-3 text-left text-sm transition hover:border-brand-200 hover:bg-brand-50/40"
                          onClick={() => {
                            if (item.linkTab) setTab(item.linkTab as Tab);
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {item.party}
                            </div>
                            <div className="text-xs text-slate-500">
                              {item.dateBs} · {item.voucherNo}
                              {item.status ? (
                                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                                  {String(item.status).replace(/_/g, " ")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div
                            className={cn(
                              "shrink-0 font-semibold",
                              section.amountClass,
                            )}
                          >
                            {formatCurrencyNpr(item.amountNpr)}
                          </div>
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )
      ) : null}

      {tab === "fee-records" ? <StudentFeeRecordsPanel /> : null}
      {tab === "salary-records" ? <SalaryPaymentRecordsPanel /> : null}
      {tab === "refund-records" ? <RefundRecordsPanel /> : null}
      {tab === "ledger" ? <LedgerPanel /> : null}

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
                      const suggestedLateFine =
                        account &&
                        account.remainingDueNpr > 0 &&
                        settingsForm.lateFinePercent > 0
                          ? Math.round(
                              (account.remainingDueNpr *
                                settingsForm.lateFinePercent) /
                                100,
                            )
                          : 0;
                      setCollectionForm((c) => ({
                        ...c,
                        studentId,
                        currentChargesNpr:
                          structure?.amountNpr ?? c.currentChargesNpr,
                        lateFeeNpr: suggestedLateFine,
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
                    value={collectionForm.paidDateBs}
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
                <FormField label="Late Fine">
                  <NumberInput
                    value={collectionForm.lateFeeNpr}
                    onChange={(e) =>
                      setCollectionForm((c) => ({
                        ...c,
                        lateFeeNpr: e.target.valueAsNumber,
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
                      setSalaryForm((current) => ({
                        ...current,
                        teacherId: e.target.value,
                        basicSalaryNpr:
                          teacher?.basicSalaryNpr ?? current.basicSalaryNpr,
                      }));
                    }}
                  >
                    <option value="">Select teacher</option>
                    {(salaryEmployeesQuery.data?.teachers ?? []).map(
                      (teacher) => (
                        <option key={teacher._id} value={teacher._id}>
                          {teacher.user.fullName}
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
                                status: row.status,
                                paidDateBs: row.paidDateBs ?? "",
                                paymentMethod: row.paymentMethod,
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
                  value={expenseForm.approvedBy ?? ""}
                  onChange={(e) =>
                    setExpenseForm((c) => ({
                      ...c,
                      approvedBy: e.target.value,
                    }))
                  }
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
                      setExpenseForm(defaultExpense);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    const parsed =
                      accountingExpenseSchema.safeParse(expenseForm);
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
                          {isAdmin ? (
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
                          {isAdmin ? (
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
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingIncome ? "Edit Income" : "Other Income Register"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Non-fee income (donation, certificate, form sales, fine,
                interest). Auto journal + ledger.
              </p>
            </CardHeader>
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
              <FormField label="Receipt Number (optional)">
                <Input
                  value={incomeForm.receiptNumber ?? ""}
                  placeholder="Auto if blank"
                  onChange={(e) =>
                    setIncomeForm((c) => ({
                      ...c,
                      receiptNumber: e.target.value,
                    }))
                  }
                />
              </FormField>
              <div className="flex gap-2">
                {editingIncome ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingIncome(null);
                      setIncomeForm(defaultIncome);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
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
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Income Records</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Receipt</Th>
                    <Th>Type</Th>
                    <Th>Source</Th>
                    <Th>Amount</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(incomeQuery.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{row.dateBs}</Td>
                      <Td className="font-mono text-xs">
                        {row.receiptNumber ?? row.voucherNumber ?? "—"}
                      </Td>
                      <Td>{row.category}</Td>
                      <Td>{row.source}</Td>
                      <Td>{formatCurrencyNpr(row.amountNpr)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              printRegisterVoucher({
                                kind: "Income",
                                voucherNumber:
                                  row.receiptNumber || row.voucherNumber,
                                dateBs: row.dateBs,
                                amountNpr: row.amountNpr,
                                narration: row.description,
                                fields: [
                                  { label: "Income Type", value: row.category },
                                  { label: "Source", value: row.source },
                                  {
                                    label: "Payment Mode",
                                    value: row.paymentMethod.replace(/_/g, " "),
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
                              setEditingIncome(row);
                              setIncomeForm({
                                category:
                                  row.category as AccountingIncomeInput["category"],
                                source: row.source,
                                dateBs: row.dateBs,
                                amountNpr: row.amountNpr,
                                paymentMethod: row.paymentMethod,
                                description: row.description ?? "",
                                receiptNumber: row.receiptNumber ?? "",
                                voucherNumber: row.voucherNumber ?? "",
                              });
                            }}
                          >
                            Edit
                          </Button>
                          {isAdmin ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                void deleteIncome.mutateAsync(row._id)
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
            <div className="flex flex-wrap gap-3">
              <Select
                value={selectedReport}
                onChange={(e) =>
                  setSelectedReport(e.target.value as typeof selectedReport)
                }
              >
                {reportTypes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              {selectedReport === "daily-fee-collection" ? (
                <div className="min-w-[220px]">
                  <NepaliDateField
                    value={reportDate}
                    onChange={setReportDate}
                  />
                </div>
              ) : null}
              {reportUsesMonthFilter(selectedReport) ? (
                <Input
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  placeholder="YYYY-MM (BS month)"
                />
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  const printRoot = document.getElementById(
                    "accounting-report-print",
                  );
                  if (!printRoot) {
                    toast.error("Nothing to print");
                    return;
                  }
                  printSimpleDocument({
                    title:
                      reportTypes.find((r) => r.id === selectedReport)?.label ??
                      "Report",
                    subtitle: reportUsesMonthFilter(selectedReport)
                      ? `Period: ${reportMonth}`
                      : undefined,
                    bodyHtml: printRoot.innerHTML,
                  });
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
            {reportQuery.isLoading ? (
              <LoadingState />
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
                    </tr>
                  </TableHead>
                  <TableBody>
                    {standardReportRows.length === 0 ? (
                      <tr>
                        <Td colSpan={REPORT_COLUMNS[selectedReport].length}>
                          No report data for the selected filters.
                        </Td>
                      </tr>
                    ) : (
                      getReportRows(selectedReport, standardReportRows).map(
                        (row, index) => (
                          <tr key={index}>
                            {REPORT_COLUMNS[selectedReport].map((column) => (
                              <Td key={column.key}>
                                {getReportCellValue(row, column)}
                              </Td>
                            ))}
                          </tr>
                        ),
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
      {tab === "journal-entries" ? (
        <JournalEntriesPanel canWrite={canWrite && !isCashier} />
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
                      { fullName?: string } | string | undefined;
                    const actorName =
                      typeof actor === "object"
                        ? (actor?.fullName ?? log.actorRole)
                        : log.actorRole;
                    const hasChange = log.before != null || log.after != null;
                    return (
                      <tr key={log._id}>
                        <Td>
                          {log.createdAt
                            ? new Date(log.createdAt).toLocaleString()
                            : "—"}
                        </Td>
                        <Td>{actorName}</Td>
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
