import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  SalaryPaymentStatus,
  SalarySheetRow,
  SchoolSettingsRecord,
  TeacherPaymentType,
} from "@phit-erp/shared";
import {
  calculateSalarySheetLine,
  calculateTenderProgress,
  formatNrsAmountInWords,
  formatTenderPayBreakdown,
  normalizeTeacherPaymentType,
  PAYMENT_METHODS,
  TEACHER_PAYMENT_TYPE_LABELS,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronUp,
  FileDown,
  History,
  Pencil,
  Plus,
  Printer,
  Save,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { canManageInstitution, normalizeUserRole } from "lib/roles";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";
import {
  approveSalarySheetClient,
  deleteSalarySheetMonthClient,
  fetchSalarySheet,
  fetchSalarySheetMonths,
  rejectSalarySheetClient,
  saveSalarySheetClient,
  submitSalarySheetClient,
} from "./salarySheetClient";
import { printHtmlViaIframe } from "./voucherPrint";

type EditableRow = SalarySheetRow & {
  /** local edits */
  dirty?: boolean;
  /** Admin typed money columns by hand (skip auto re-calc until Recalculate) */
  valuesManualOverride?: boolean;
};

/** One signature block: custom position + name (only shown when both filled). */
type SheetSignatory = {
  id: string;
  position: string;
  name: string;
};

const newSignatoryId = () =>
  `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Default slots — user can change labels (e.g. Prepared by / Checked by). */
const defaultSignatories = (): SheetSignatory[] => [
  { id: newSignatoryId(), position: "Prepared by", name: "" },
  { id: newSignatoryId(), position: "Checked by", name: "" },
  { id: newSignatoryId(), position: "Approved by", name: "" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

const calcLine = (
  row: Pick<
    EditableRow,
    | "monthlySalaryNpr"
    | "presentDays"
    | "absentDays"
    | "leaveDays"
    | "extraDuty"
    | "workingDaysInMonth"
    | "extraAmountNpr"
    | "paymentType"
    | "periodRateNpr"
    | "periodsAttended"
    | "tenderAmountNpr"
    | "syllabusCompletedPercent"
    | "syllabusAlreadyPaidPercent"
    | "tenderAlreadyPaidNpr"
    | "tenderThisMonthNpr"
  >,
  preferExtraDuty = true,
): Pick<
  EditableRow,
  | "absentDeductionNpr"
  | "extraAmountNpr"
  | "salaryAmountNpr"
  | "tax1PercentNpr"
  | "netSalaryNpr"
  | "tenderThisMonthNpr"
  | "syllabusAlreadyPaidPercent"
  | "syllabusThisMonthPercent"
  | "syllabusRemainingPercent"
  | "tenderAlreadyPaidNpr"
> => {
  const paymentType = normalizeTeacherPaymentType(row.paymentType);
  const extraDuty = Math.max(0, Number(row.extraDuty) || 0);
  const extraOverride =
    !preferExtraDuty && extraDuty === 0
      ? Number(row.extraAmountNpr) || 0
      : undefined;
  const contract = Number(row.tenderAmountNpr ?? row.monthlySalaryNpr ?? 0);
  const tenderProgress =
    paymentType === "TENDER"
      ? calculateTenderProgress({
          tenderAmountNpr: contract,
          syllabusCompletedPercent: Number(row.syllabusCompletedPercent ?? 0),
          syllabusAlreadyPaidPercent: Number(row.syllabusAlreadyPaidPercent ?? 0),
        })
      : null;
  const tenderThisMonthNpr =
    paymentType === "TENDER"
      ? tenderProgress!.tenderThisMonthNpr
      : Number(row.tenderThisMonthNpr ?? 0);
  const calc = calculateSalarySheetLine({
    paymentType,
    monthlySalaryNpr: Number(row.monthlySalaryNpr) || 0,
    presentDays: Number(row.presentDays) || 0,
    absentDays: Number(row.absentDays) || 0,
    leaveDays: Number(row.leaveDays) || 0,
    extraDuty,
    workingDaysInMonth: row.workingDaysInMonth || 30,
    extraAmountOverrideNpr: extraOverride,
    periodRateNpr: Number(row.periodRateNpr ?? row.monthlySalaryNpr) || 0,
    periodsAttended: Number(row.periodsAttended) || 0,
    tenderThisMonthNpr,
  });
  return {
    ...calc,
    tenderThisMonthNpr,
    syllabusAlreadyPaidPercent:
      tenderProgress?.syllabusAlreadyPaidPercent ??
      Number(row.syllabusAlreadyPaidPercent ?? 0),
    syllabusThisMonthPercent: tenderProgress?.syllabusThisMonthPercent ?? 0,
    syllabusRemainingPercent: tenderProgress?.syllabusRemainingPercent ?? 100,
    tenderAlreadyPaidNpr:
      tenderProgress?.tenderAlreadyPaidNpr ??
      Number(row.tenderAlreadyPaidNpr ?? 0),
  };
};

const currentBsMonth = (): string => {
  try {
    const t = getTodayBs();
    return `${t.year}-${String(t.month).padStart(2, "0")}`;
  } catch {
    return "";
  }
};

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatCollegeAddress = (
  address?: SchoolSettingsRecord["address"] | null,
): string => {
  if (!address) return "";
  return [
    address.streetAddress,
    address.ward ? `Ward ${address.ward}` : "",
    address.municipality,
    address.district,
    address.province,
  ]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(", ");
};

/** e.g. 2083-04 → Shrawan 2083 (BS month label when known) */
const BS_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

const formatPayrollMonthLabel = (monthBs: string): string => {
  const m = monthBs.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return m || "—";
  const year = match[1]!;
  const monthNum = Number(match[2]);
  const name =
    monthNum >= 1 && monthNum <= 12 ? BS_MONTH_NAMES[monthNum - 1] : match[2];
  return `${name} ${year}`;
};

const emptyEntryForm = () => ({
  employeeType: "TEACHER" as "TEACHER" | "STAFF",
  employeeKey: "",
  monthlySalaryNpr: "0",
  periodsAttended: "0",
  syllabusCompletedPercent: "0",
  presentDays: "0",
  absentDays: "0",
  leaveDays: "0",
  extraDuty: "0",
  remarks: "",
  attendanceManualOverride: false,
});

const payTypeOf = (row?: { paymentType?: string } | null): TeacherPaymentType =>
  normalizeTeacherPaymentType(row?.paymentType);

const rateColumnLabel = (type: TeacherPaymentType): string => {
  if (type === "PERIOD") return "Rate / period (NPR)";
  if (type === "TENDER") return "Tender amount (NPR)";
  return "Monthly salary (NPR)";
};

const employeeKeyOf = (r: {
  employeeType: string;
  teacherId?: string;
  staffId?: string;
}) =>
  r.employeeType === "TEACHER"
    ? `TEACHER:${r.teacherId ?? ""}`
    : `STAFF:${r.staffId ?? ""}`;

type SalaryPaymentRecordsPanelProps = {
  /** From Accounting dashboard — open this payroll month (BS YYYY-MM) */
  focusMonthBs?: string;
  /** Optional employee name filter when opening from a recent entry */
  focusEmployeeName?: string;
  /** Changes every click so the same month can be re-opened */
  focusKey?: number;
};

export const SalaryPaymentRecordsPanel = ({
  focusMonthBs,
  focusEmployeeName,
  focusKey,
}: SalaryPaymentRecordsPanelProps = {}) => {
  const { user } = useAuth();
  const allRoles = useMemo(() => {
    if (!user) return [] as string[];
    return [user.role, ...(user.secondaryRoles ?? [])]
      .filter(Boolean)
      .map((role) => normalizeUserRole(String(role)));
  }, [user]);
  const isSuperAdmin = allRoles.includes("SUPER_ADMIN");
  const isCollegeAdmin = allRoles.includes("COLLEGE_ADMIN");
  const isAdmin = useMemo(
    () =>
      isSuperAdmin ||
      isCollegeAdmin ||
      allRoles.some((role) => canManageInstitution(role)),
    [allRoles, isSuperAdmin, isCollegeAdmin],
  );
  const isAccountant = allRoles.includes("ACCOUNTANT");
  const canPrepareSheet = isAdmin || isAccountant;
  /** Same gate — delete saved months / rows */
  const canDeleteMonth = isAdmin;
  /** prepare = working sheet; history = saved months archive */
  const [viewMode, setViewMode] = useState<"prepare" | "history">("prepare");
  const [monthBs, setMonthBs] = useState(() => {
    const m = focusMonthBs?.trim();
    if (m && /^\d{4}-\d{2}$/.test(m)) return m;
    return currentBsMonth();
  });
  /** Sheet filter (table view only) */
  const [listSearch, setListSearch] = useState("");
  const [listDept, setListDept] = useState("");
  const [listType, setListType] = useState("");
  /** Employees already on this month's sheet (added one-by-one or previously saved) */
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [status, setStatus] = useState<SalaryPaymentStatus>("DRAFT");
  const [paidDateBs, setPaidDateBs] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>("BANK_TRANSFER");
  /**
   * Signatories for print / PDF / Excel — position + name both manual.
   * Only slots with both fields filled appear under the table (1–4 blocks).
   */
  const [signatories, setSignatories] =
    useState<SheetSignatory[]>(defaultSignatories);
  /** One-by-one entry form */
  const [entry, setEntry] = useState(emptyEntryForm);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  /** UI sections (layout only — does not change payroll logic) */
  const [addSectionOpen, setAddSectionOpen] = useState(true);
  const [signSectionOpen, setSignSectionOpen] = useState(true);
  const [highlightEmployee, setHighlightEmployee] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  // Open the payroll month (and focus employee) when arriving from dashboard
  useEffect(() => {
    const m = focusMonthBs?.trim();
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      setMonthBs(m);
      setViewMode("prepare");
      setAddSectionOpen(false);
      setSignSectionOpen(false);
    }
    const name = focusEmployeeName?.trim() ?? "";
    if (name) {
      setListSearch(name);
      setHighlightEmployee(name);
    } else {
      setHighlightEmployee("");
    }
  }, [focusMonthBs, focusEmployeeName, focusKey]);

  /** Full employee catalog + attendance for the month (picker source — not the table) */
  const sheetQuery = useQuery({
    queryKey: ["accounting-salary-sheet", monthBs],
    queryFn: () => fetchSalarySheet(monthBs),
    enabled:
      viewMode === "prepare" &&
      Boolean(monthBs && /^\d{4}-\d{2}$/.test(monthBs)),
    retry: 1,
  });

  /** Saved payroll months archive */
  const monthsQuery = useQuery({
    queryKey: ["accounting-salary-sheet-months"],
    queryFn: () => fetchSalarySheetMonths(),
    enabled: viewMode === "history",
    staleTime: 30_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["settings", "salary-sheet-header"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
  });

  const collegeName =
    settingsQuery.data?.schoolName?.trim() ||
    (document.querySelector("[data-college-name]") as HTMLElement | null)
      ?.dataset.collegeName ||
    "College";
  const collegeNameNp = settingsQuery.data?.schoolNameNp?.trim() || "";
  const collegeAddress = formatCollegeAddress(settingsQuery.data?.address);
  const monthLabel = formatPayrollMonthLabel(monthBs);

  /** Catalog of all employees with attendance-derived figures for the month */
  const catalog = sheetQuery.data?.rows ?? [];

  useEffect(() => {
    if (!sheetQuery.data?.rows) return;
    // Pre-load every employee who already has a payroll record for this month
    const saved = sheetQuery.data.rows
      .filter((r) => Boolean(r.salaryPaymentId))
      .map((r, i) => ({
        ...r,
        sn: i + 1,
        leaveDays: r.leaveDays ?? 0,
        salaryPaymentId: r.salaryPaymentId
          ? String(r.salaryPaymentId)
          : undefined,
        valuesManualOverride: Boolean(
          (r as EditableRow).valuesManualOverride,
        ),
      }));
    setRows(saved);
    setEditingKey(null);
    setEntry(emptyEntryForm());

    // Align sheet status with saved payroll rows for this month
    if (saved.length > 0) {
      const statuses = saved.map((r) => r.status).filter(Boolean) as SalaryPaymentStatus[];
      if (statuses.includes("PAID")) setStatus("PAID");
      else if (statuses.includes("APPROVED")) setStatus("APPROVED");
      else if (statuses.includes("PENDING_APPROVAL")) setStatus("PENDING_APPROVAL");
      else if (statuses.includes("PROCESSED")) setStatus("PROCESSED");
      else setStatus("DRAFT");
    }
  }, [sheetQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (body: {
      monthBs: string;
      status: SalaryPaymentStatus;
      paidDateBs?: string;
      paymentMethod: string;
      rows: Array<{
        employeeType: "TEACHER" | "STAFF";
        teacherId?: string;
        staffId?: string;
        employeeName?: string;
        monthlySalaryNpr: number;
        presentDays: number;
        absentDays: number;
        leaveDays?: number;
        extraDuty: number;
        extraAmountNpr?: number;
        absentDeductionNpr?: number;
        salaryAmountNpr?: number;
        tax1PercentNpr?: number;
        netSalaryNpr?: number;
        remarks?: string;
        attendanceManualOverride?: boolean;
        valuesManualOverride?: boolean;
        salaryPaymentId?: string;
      }>;
    }) => saveSalarySheetClient(body),
    onSuccess: async () => {
      toast.success("Saved");
      await sheetQuery.refetch();
      void monthsQuery.refetch();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const approval = sheetQuery.data?.approval;
  const canEditSheet =
    canPrepareSheet && (status === "DRAFT" || status === "PROCESSED");
  const canWritePayroll = canEditSheet;
  const canManualAttendance = canEditSheet;
  /** Salary / net columns: admin may type or clear-and-write. Accountant uses HR rates. */
  const canEditAmounts = isAdmin && canEditSheet;
  /** Row Edit / Remove: admin only. Accountant prepares by adding, then submits. */
  const canManageRows = isAdmin && canEditSheet;
  const canSaveSheet =
    canEditSheet || (isAdmin && (status === "APPROVED" || status === "PAID"));
  const canSubmitSheet =
    canPrepareSheet &&
    rows.length > 0 &&
    (status === "DRAFT" || status === "PROCESSED");
  const canApproveSheet =
    isAdmin &&
    status === "PENDING_APPROVAL" &&
    ((isCollegeAdmin && !approval?.collegeAdminApproved) ||
      (isSuperAdmin && !approval?.superAdminApproved));
  const canReturnForCorrection =
    isAdmin && (status === "PENDING_APPROVAL" || status === "APPROVED");

  const refreshSheet = async () => {
    await sheetQuery.refetch();
    void monthsQuery.refetch();
  };

  const submitMutation = useMutation({
    mutationFn: () => submitSalarySheetClient(monthBs),
    onSuccess: async () => {
      toast.success("Submitted");
      await refreshSheet();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveSalarySheetClient(monthBs),
    onSuccess: async () => {
      toast.success("Approved");
      await refreshSheet();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectSalarySheetClient(monthBs),
    onSuccess: async () => {
      toast.success("Returned for correction — accountant can update the sheet");
      await refreshSheet();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteMonthMutation = useMutation({
    mutationFn: (targetMonth: string) =>
      deleteSalarySheetMonthClient(
        targetMonth,
        `Deleted entire salary sheet for ${targetMonth} by administrator`,
      ),
    onSuccess: async (_data, targetMonth) => {
      toast.success(`Salary sheet for ${targetMonth} deleted`);
      await monthsQuery.refetch();
      // If the open working month was deleted, clear local rows after refetch
      if (targetMonth === monthBs) {
        await sheetQuery.refetch();
      }
      try {
        const { invalidateAccountingQueries } = await import(
          "./invalidateAccountingQueries"
        );
        await invalidateAccountingQueries();
      } catch {
        /* non-fatal */
      }
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const openSavedMonth = (targetMonth: string) => {
    setMonthBs(targetMonth);
    setListSearch("");
    setHighlightEmployee("");
    setAddSectionOpen(false);
    setSignSectionOpen(false);
    setViewMode("prepare");
    toast.message(`Opened ${formatPayrollMonthLabel(targetMonth)}`);
  };

  const filteredHistoryMonths = useMemo(() => {
    const all = monthsQuery.data ?? [];
    const q = historySearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) => {
      const label = formatPayrollMonthLabel(m.monthBs).toLowerCase();
      return (
        m.monthBs.includes(q) ||
        label.includes(q) ||
        String(m.status).toLowerCase().includes(q)
      );
    });
  }, [monthsQuery.data, historySearch]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const r of catalog) {
      if (r.department?.trim()) set.add(r.department.trim());
    }
    for (const r of rows) {
      if (r.department?.trim()) set.add(r.department.trim());
    }
    set.add("Teaching");
    return [...set].sort();
  }, [catalog, rows]);

  const workingDaysInMonth =
    sheetQuery.data?.workingDaysInMonth ??
    rows[0]?.workingDaysInMonth ??
    30;

  const calendarDaysInMonth =
    sheetQuery.data?.calendarDaysInMonth ?? workingDaysInMonth;
  const saturdayDaysInMonth = sheetQuery.data?.saturdayDaysInMonth ?? 0;
  const otherHolidayDaysInMonth =
    sheetQuery.data?.otherHolidayDaysInMonth ?? 0;
  const holidayDaysInMonth =
    sheetQuery.data?.holidayDaysInMonth ??
    (saturdayDaysInMonth + otherHolidayDaysInMonth ||
      Math.max(0, calendarDaysInMonth - workingDaysInMonth));

  /** Employees missing from one or more day sheets this month. */
  const incompleteAttendanceCount = useMemo(
    () => catalog.filter((c) => c.attendanceIncomplete).length,
    [catalog],
  );

  /** Employees not yet on the sheet (available to add) */
  const availableCatalog = useMemo(() => {
    const onSheet = new Set(rows.map((r) => employeeKeyOf(r)));
    return catalog.filter((c) => {
      const key = employeeKeyOf(c);
      if (editingKey && key === editingKey) return true;
      return !onSheet.has(key);
    });
  }, [catalog, rows, editingKey]);

  const pickerEmployees = useMemo(() => {
    return availableCatalog.filter((c) => c.employeeType === entry.employeeType);
  }, [availableCatalog, entry.employeeType]);

  const selectedCatalogRow = useMemo(() => {
    if (!entry.employeeKey) return null;
    return (
      catalog.find((c) => employeeKeyOf(c) === entry.employeeKey) ??
      rows.find((r) => employeeKeyOf(r) === entry.employeeKey) ??
      null
    );
  }, [catalog, rows, entry.employeeKey]);

  const entryPreview = useMemo(() => {
    const src = selectedCatalogRow;
    const monthly = Number(entry.monthlySalaryNpr) || 0;
    const presentDays = Number(entry.presentDays) || 0;
    const absentDays = Number(entry.absentDays) || 0;
    const leaveDays = Number(entry.leaveDays) || 0;
    const extraDuty = Number(entry.extraDuty) || 0;
    return calcLine({
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      leaveDays,
      extraDuty,
      workingDaysInMonth,
      extraAmountNpr: 0,
      paymentType: src?.paymentType,
      periodRateNpr: src?.periodRateNpr ?? monthly,
      periodsAttended: Number(entry.periodsAttended) || src?.periodsAttended || 0,
      tenderAmountNpr: src?.tenderAmountNpr ?? monthly,
      syllabusCompletedPercent:
        Number(entry.syllabusCompletedPercent) ||
        src?.syllabusCompletedPercent ||
        0,
      syllabusAlreadyPaidPercent: src?.syllabusAlreadyPaidPercent ?? 0,
      tenderAlreadyPaidNpr: src?.tenderAlreadyPaidNpr ?? 0,
      tenderThisMonthNpr: src?.tenderThisMonthNpr ?? 0,
    });
  }, [entry, workingDaysInMonth, selectedCatalogRow]);

  const fillEntryFromCatalog = (key: string) => {
    const src =
      catalog.find((c) => employeeKeyOf(c) === key) ??
      rows.find((r) => employeeKeyOf(r) === key);
    if (!src) {
      setEntry((f) => ({ ...f, employeeKey: key }));
      return;
    }
    setEntry({
      employeeType: src.employeeType,
      employeeKey: key,
      monthlySalaryNpr: String(src.monthlySalaryNpr ?? 0),
      periodsAttended: String(src.periodsAttended ?? 0),
      syllabusCompletedPercent: String(src.syllabusCompletedPercent ?? 0),
      presentDays: String(src.presentDays ?? 0),
      absentDays: String(src.absentDays ?? 0),
      leaveDays: String(src.leaveDays ?? 0),
      extraDuty: String(src.extraDuty ?? 0),
      remarks: src.remarks ?? "",
      attendanceManualOverride: Boolean(src.attendanceManualOverride),
    });
  };

  const renumber = (list: EditableRow[]): EditableRow[] =>
    list.map((r, i) => ({ ...r, sn: i + 1 }));

  const addOrUpdateEntry = () => {
    if (!canWritePayroll) {
      toast.error("Cannot edit");
      return;
    }
    if (!entry.employeeKey) {
      toast.error("Select an employee");
      return;
    }
    const src =
      catalog.find((c) => employeeKeyOf(c) === entry.employeeKey) ??
      rows.find((r) => employeeKeyOf(r) === entry.employeeKey);
    if (!src) {
      toast.error("Employee not found");
      return;
    }
    const monthly = canEditAmounts
      ? Number(entry.monthlySalaryNpr) || 0
      : Number(src.monthlySalaryNpr) || 0;
    const payType = payTypeOf(src);
    if (payType !== "TENDER" && monthly <= 0) {
      toast.error(
        payType === "PERIOD"
          ? "Rate per period is not set on this employee record"
          : "Monthly salary is not set on this employee record (admin)",
      );
      return;
    }
    const presentDays = Number(entry.presentDays) || 0;
    const absentDays = Number(entry.absentDays) || 0;
    const leaveDays = Number(entry.leaveDays) || 0;
    const extraDuty = Number(entry.extraDuty) || 0;
    const periodsAttended =
      Number(entry.periodsAttended) || src.periodsAttended || 0;
    const syllabusCompletedPercent =
      Number(entry.syllabusCompletedPercent) ||
      src.syllabusCompletedPercent ||
      0;
    const calc = calcLine({
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      leaveDays,
      extraDuty,
      workingDaysInMonth,
      extraAmountNpr: 0,
      paymentType: src.paymentType,
      periodRateNpr: payType === "PERIOD" ? monthly : src.periodRateNpr,
      periodsAttended,
      tenderAmountNpr: payType === "TENDER" ? monthly : src.tenderAmountNpr,
      syllabusCompletedPercent,
      syllabusAlreadyPaidPercent: src.syllabusAlreadyPaidPercent,
      tenderAlreadyPaidNpr: src.tenderAlreadyPaidNpr,
      tenderThisMonthNpr: src.tenderThisMonthNpr,
    });
    const nextRow: EditableRow = {
      ...src,
      monthlySalaryNpr: monthly,
      periodRateNpr: payType === "PERIOD" ? monthly : src.periodRateNpr,
      periodsAttended,
      tenderAmountNpr: payType === "TENDER" ? monthly : src.tenderAmountNpr,
      syllabusCompletedPercent,
      presentDays,
      absentDays,
      leaveDays,
      extraDuty,
      ...(src.valuesManualOverride && !canEditAmounts
        ? {
            absentDeductionNpr: src.absentDeductionNpr,
            extraAmountNpr: src.extraAmountNpr,
            salaryAmountNpr: src.salaryAmountNpr,
            tax1PercentNpr: src.tax1PercentNpr,
            netSalaryNpr: src.netSalaryNpr,
            valuesManualOverride: true,
          }
        : calc),
      remarks: entry.remarks,
      attendanceManualOverride:
        entry.attendanceManualOverride || Boolean(src.attendanceManualOverride),
      attendanceIncomplete: entry.attendanceManualOverride
        ? false
        : src.attendanceIncomplete,
      workingDaysInMonth,
      dirty: true,
      sn: 0,
    };

    setRows((prev) => {
      const key = employeeKeyOf(nextRow);
      const exists = prev.some((r) => employeeKeyOf(r) === key);
      if (exists) {
        return renumber(
          prev.map((r) => (employeeKeyOf(r) === key ? { ...nextRow } : r)),
        );
      }
      return renumber([...prev, nextRow]);
    });

    toast.success(
      editingKey
        ? `${src.employeeName} updated on salary sheet`
        : `${src.employeeName} added to salary sheet`,
    );
    setEditingKey(null);
    setEntry(emptyEntryForm());
  };

  const startEditRow = (row: EditableRow) => {
    if (!canManageRows) {
      toast.error("Only Super Admin or College Admin can edit a salary sheet row");
      return;
    }
    const key = employeeKeyOf(row);
    setEditingKey(key);
    setAddSectionOpen(true);
    setEntry({
      employeeType: row.employeeType,
      employeeKey: key,
      monthlySalaryNpr: String(row.monthlySalaryNpr ?? 0),
      periodsAttended: String(row.periodsAttended ?? 0),
      syllabusCompletedPercent: String(row.syllabusCompletedPercent ?? 0),
      presentDays: String(row.presentDays ?? 0),
      absentDays: String(row.absentDays ?? 0),
      leaveDays: String(row.leaveDays ?? 0),
      extraDuty: String(row.extraDuty ?? 0),
      remarks: row.remarks ?? "",
      attendanceManualOverride: Boolean(row.attendanceManualOverride),
    });
    // Do not scroll the page — stays on the table row the user was editing
  };

  const removeRow = (row: EditableRow) => {
    if (!canManageRows) {
      toast.error("Only Super Admin or College Admin can remove a salary sheet row");
      return;
    }
    const key = employeeKeyOf(row);
    if (
      !window.confirm(
        `Remove ${row.employeeName} from this month's salary sheet? (Save payroll to persist.)`,
      )
    ) {
      return;
    }
    setRows((prev) => renumber(prev.filter((r) => employeeKeyOf(r) !== key)));
    if (editingKey === key) {
      setEditingKey(null);
      setEntry(emptyEntryForm());
    }
  };

  /**
   * Super Admin / College Admin: edit a cell on the generated sheet.
   * - Present / absent / leave → freeze attendance and re-calc money
   * - Monthly salary / extra duty → re-calc money without freezing attendance
   * - Money columns → mark valuesManualOverride (keep typed amounts)
   */
  const patchRow = (
    rowKey: string,
    patch: Partial<EditableRow>,
    mode: "days" | "rate" | "money" | "meta" | "units" = "meta",
  ) => {
    if (!canEditSheet) return;
    if (mode === "money" && !canEditAmounts) return;
    if (
      mode === "rate" &&
      !canEditAmounts &&
      (patch.monthlySalaryNpr !== undefined ||
        patch.periodRateNpr !== undefined ||
        patch.tenderAmountNpr !== undefined)
    ) {
      return;
    }
    setRows((prev) =>
      renumber(
        prev.map((r) => {
          if (employeeKeyOf(r) !== rowKey) return r;
          const next: EditableRow = {
            ...r,
            ...patch,
            dirty: true,
          };
          if (mode === "days") {
            next.attendanceManualOverride = true;
            next.attendanceIncomplete = false;
            const wd = next.workingDaysInMonth || workingDaysInMonth;
            if (patch.absentDays !== undefined || patch.leaveDays !== undefined) {
              next.presentDays = round2(
                Math.max(
                  0,
                  wd -
                    Math.max(0, Number(next.absentDays) || 0) -
                    Math.max(0, Number(next.leaveDays) || 0),
                ),
              );
            }
          }
          if (mode === "rate" && next.paymentType === "PERIOD") {
            next.periodRateNpr = Number(next.monthlySalaryNpr) || 0;
          }
          if (mode === "rate" && next.paymentType === "TENDER") {
            next.tenderAmountNpr = Number(next.monthlySalaryNpr) || 0;
          }
          if (mode === "units") {
            next.attendanceManualOverride = true;
            next.attendanceIncomplete = false;
          }
          if (mode === "days" || mode === "rate" || mode === "units") {
            if (!next.valuesManualOverride) {
              Object.assign(
                next,
                calcLine({
                  monthlySalaryNpr: next.monthlySalaryNpr,
                  presentDays: next.presentDays,
                  absentDays: next.absentDays,
                  leaveDays: next.leaveDays,
                  extraDuty: next.extraDuty,
                  workingDaysInMonth:
                    next.workingDaysInMonth || workingDaysInMonth,
                  extraAmountNpr: next.extraAmountNpr,
                  paymentType: next.paymentType,
                  periodRateNpr: next.periodRateNpr,
                  periodsAttended: next.periodsAttended,
                  tenderAmountNpr: next.tenderAmountNpr,
                  syllabusCompletedPercent: next.syllabusCompletedPercent,
                  tenderAlreadyPaidNpr: next.tenderAlreadyPaidNpr,
                  tenderThisMonthNpr: next.tenderThisMonthNpr,
                }),
              );
              const type = payTypeOf(next);
              if (type === "PERIOD") {
                const rate = Number(next.periodRateNpr ?? next.monthlySalaryNpr) || 0;
                next.payBreakdown = `${Number(next.periodsAttended) || 0} period(s) × Rs ${rate.toLocaleString("en-NP")}`;
              } else if (type === "TENDER") {
                next.payBreakdown = formatTenderPayBreakdown({
                  syllabusCompletedPercent: Number(next.syllabusCompletedPercent) || 0,
                  syllabusAlreadyPaidPercent: Number(next.syllabusAlreadyPaidPercent) || 0,
                  syllabusThisMonthPercent: Number(next.syllabusThisMonthPercent) || 0,
                  syllabusRemainingPercent: Number(next.syllabusRemainingPercent) || 0,
                  tenderAlreadyPaidNpr: Number(next.tenderAlreadyPaidNpr) || 0,
                  tenderThisMonthNpr: Number(next.tenderThisMonthNpr) || 0,
                });
              }
            }
          } else if (mode === "money") {
            next.valuesManualOverride = true;
            next.attendanceIncomplete = false;
          }
          return next;
        }),
      ),
    );
  };

  /** Admin: clear money override and recompute from days + monthly salary */
  const recalculateRowFromDays = (row: EditableRow) => {
    if (!canEditAmounts) return;
    const key = employeeKeyOf(row);
    setRows((prev) =>
      renumber(
        prev.map((r) => {
          if (employeeKeyOf(r) !== key) return r;
          const calc = calcLine({
            monthlySalaryNpr: r.monthlySalaryNpr,
            presentDays: r.presentDays,
            absentDays: r.absentDays,
            leaveDays: r.leaveDays,
            extraDuty: r.extraDuty,
            workingDaysInMonth: r.workingDaysInMonth || workingDaysInMonth,
            extraAmountNpr: 0,
            paymentType: r.paymentType,
            periodRateNpr: r.periodRateNpr,
            periodsAttended: r.periodsAttended,
            tenderAmountNpr: r.tenderAmountNpr,
            syllabusCompletedPercent: r.syllabusCompletedPercent,
            tenderAlreadyPaidNpr: r.tenderAlreadyPaidNpr,
            tenderThisMonthNpr: r.tenderThisMonthNpr,
          });
          return {
            ...r,
            ...calc,
            valuesManualOverride: false,
            attendanceManualOverride: true,
            attendanceIncomplete: false,
            dirty: true,
          };
        }),
      ),
    );
    toast.success(`Recalculated ${row.employeeName} from days`);
  };

  const cancelEntry = () => {
    setEditingKey(null);
    setEntry(emptyEntryForm());
  };

  const displayedRows = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (listType && r.employeeType !== listType) return false;
      if (listDept && (r.department || "").toLowerCase() !== listDept.toLowerCase()) {
        return false;
      }
      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.designation || "").toLowerCase().includes(q)
      );
    });
  }, [rows, listSearch, listDept, listType]);

  const totals = useMemo(() => {
    const totalMonthlySalaryNpr = round2(
      rows.reduce((s, r) => s + (r.monthlySalaryNpr || 0), 0),
    );
    const totalAbsentDeductionNpr = round2(
      rows.reduce((s, r) => s + (r.absentDeductionNpr || 0), 0),
    );
    const totalExtraAmountNpr = round2(
      rows.reduce((s, r) => s + (r.extraAmountNpr || 0), 0),
    );
    const totalSalaryAmountNpr = round2(
      rows.reduce((s, r) => s + (r.salaryAmountNpr || 0), 0),
    );
    const totalTax1PercentNpr = round2(
      rows.reduce((s, r) => s + (r.tax1PercentNpr || 0), 0),
    );
    const totalNetSalaryNpr = round2(
      rows.reduce((s, r) => s + (r.netSalaryNpr || 0), 0),
    );
    return {
      totalMonthlySalaryNpr,
      totalAbsentDeductionNpr,
      totalExtraAmountNpr,
      totalSalaryAmountNpr,
      totalTax1PercentNpr,
      totalNetSalaryNpr,
      totalNetSalaryInWords: formatNrsAmountInWords(totalNetSalaryNpr),
    };
  }, [rows]);

  /** Active signatories = both position and name filled (order preserved). */
  const filledSignatories = useMemo(
    () =>
      signatories
        .map((s) => ({
          position: s.position.trim(),
          name: s.name.trim(),
        }))
        .filter((s) => s.position && s.name),
    [signatories],
  );

  const getSignatories = (): Array<{
    position: string;
    name: string;
  }> | null => {
    if (filledSignatories.length === 0) {
      toast.error(
        "Enter at least one signature with both Position and Name before printing or exporting.",
      );
      return null;
    }
    return filledSignatories;
  };

  const updateSignatory = (
    id: string,
    field: "position" | "name",
    value: string,
  ) => {
    setSignatories((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    );
  };

  const addSignatorySlot = () => {
    if (signatories.length >= 4) {
      toast.error("Maximum 4 signature blocks");
      return;
    }
    setSignatories((prev) => [
      ...prev,
      { id: newSignatoryId(), position: "", name: "" },
    ]);
  };

  const removeSignatorySlot = (id: string) => {
    if (signatories.length <= 1) {
      toast.error("Keep at least one signature slot");
      return;
    }
    setSignatories((prev) => prev.filter((s) => s.id !== id));
  };

  /** Sheet body only — used with html2pdf (no browser date/title headers). */
  const buildSheetBodyHtml = (
    signs: Array<{ position: string; name: string }>,
  ) => {
    const bodyRows = rows
      .map(
        (r) => `
      <tr>
        <td class="c">${r.sn}</td>
        <td class="name-cell">${escapeHtml(r.employeeName)}${
          r.employeeType === "TEACHER"
            ? `<div class="pay-meta">${escapeHtml(
                TEACHER_PAYMENT_TYPE_LABELS[payTypeOf(r)],
              )}${r.payBreakdown ? ` · ${escapeHtml(r.payBreakdown)}` : ""}</div>`
            : ""
        }</td>
        <td class="n">${formatCurrencyNpr(r.monthlySalaryNpr)}</td>
        <td class="c">${r.presentDays}</td>
        <td class="c">${r.absentDays}</td>
        <td class="c">${r.leaveDays ?? 0}</td>
        <td class="c">${r.extraDuty}</td>
        <td class="n">${formatCurrencyNpr(r.absentDeductionNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.extraAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.salaryAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.tax1PercentNpr)}</td>
        <td class="n"><strong>${formatCurrencyNpr(r.netSalaryNpr)}</strong></td>
        <td></td>
        <td class="name-cell">${escapeHtml(r.remarks || "")}</td>
      </tr>`,
      )
      .join("");

    // Signatures use a plain TABLE (not flex) — html2canvas often garbles
    // text inside flex children. Only filled position+name slots are rendered.
    const signCount = Math.max(1, signs.length);
    const colPct = (100 / signCount).toFixed(2);
    const signCell = (position: string, name: string) => `
      <td class="sign-cell" style="width:${colPct}%">
        <div class="sign-line-wrap"><div class="sign-line"></div></div>
        <div class="sign-role">${escapeHtml(position)}</div>
        <div class="sign-name">${escapeHtml(name)}</div>
      </td>`;

    return `
<div class="salary-sheet-pdf">
  <style>
    .salary-sheet-pdf {
      font-family: Arial, Helvetica, "Noto Sans Devanagari", "Nirmala UI", sans-serif;
      font-size: 11px;
      color: #000000;
      background: #ffffff;
      width: 100%;
      box-sizing: border-box;
      padding: 4px;
    }
    .salary-sheet-pdf * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .salary-sheet-pdf .sheet-header {
      text-align: center;
      margin-bottom: 12px;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
    }
    .salary-sheet-pdf .sheet-header .college-name {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      margin: 0 0 3px;
      color: #000;
    }
    .salary-sheet-pdf .sheet-header .college-name-np {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 3px;
      color: #000;
      font-family: "Noto Sans Devanagari", "Nirmala UI", "Mangal", Arial, sans-serif;
    }
    .salary-sheet-pdf .sheet-header .college-address {
      font-size: 10px;
      margin: 0 0 6px;
      color: #222;
    }
    .salary-sheet-pdf .sheet-header .sheet-title {
      font-size: 13px;
      font-weight: 700;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #000;
    }
    .salary-sheet-pdf table.data {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .salary-sheet-pdf table.data th,
    .salary-sheet-pdf table.data td {
      border: 1px solid #000;
      padding: 4px 4px;
      vertical-align: middle;
      color: #000;
    }
    .salary-sheet-pdf table.data th {
      background: #e8e8e8;
      font-size: 9px;
      text-align: center;
      font-weight: 700;
    }
    .salary-sheet-pdf td.c { text-align: center; }
    .salary-sheet-pdf td.n {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .salary-sheet-pdf td.name-cell {
      text-align: left;
      font-weight: 600;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
      line-height: 1.25;
    }
    .salary-sheet-pdf .pay-meta {
      font-weight: 400;
      font-size: 9px;
      color: #334155;
      margin-top: 2px;
    }
    .salary-sheet-pdf tfoot td {
      font-weight: 700;
      background: #f3f3f3;
    }
    .salary-sheet-pdf .words {
      margin-top: 10px;
      font-size: 11px;
      color: #000;
      line-height: 1.4;
    }
    /* Compact signature block — short line; only filled slots rendered */
    .salary-sheet-pdf table.sign-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 22px;
      table-layout: fixed;
    }
    .salary-sheet-pdf table.sign-table td.sign-cell {
      border: none !important;
      text-align: center;
      vertical-align: top;
      padding: 0 10px;
      color: #000;
    }
    .salary-sheet-pdf .sign-line-wrap {
      padding-top: 18px;
      margin-bottom: 5px;
    }
    .salary-sheet-pdf .sign-line {
      border: none;
      border-top: 1px solid #000;
      height: 0;
      width: 52%;
      max-width: 120px;
      margin: 0 auto;
      padding: 0;
    }
    .salary-sheet-pdf .sign-role {
      font-weight: 700;
      font-size: 10px;
      color: #000;
      margin: 0 0 2px;
      line-height: 1.25;
    }
    .salary-sheet-pdf .sign-name {
      font-size: 11px;
      font-weight: 600;
      color: #000;
      margin: 0;
      line-height: 1.3;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
    }
  </style>
  <div class="sheet-header">
    <p class="college-name">${escapeHtml(collegeName)}</p>
    ${
      collegeNameNp
        ? `<p class="college-name-np">${escapeHtml(collegeNameNp)}</p>`
        : ""
    }
    ${
      collegeAddress
        ? `<p class="college-address">${escapeHtml(collegeAddress)}</p>`
        : ""
    }
    <p class="sheet-title">Salary Sheet of ${escapeHtml(monthLabel)}</p>
    <p class="college-address">
      Month days ${calendarDaysInMonth} − Saturdays ${saturdayDaysInMonth} − other holidays ${otherHolidayDaysInMonth} = ${workingDaysInMonth} working days
      · monthly: per-day = monthly ÷ ${workingDaysInMonth}, leave/absence deduct
      · tender: paid from syllabus completed · period: rate × periods taught
    </p>
  </div>
  <table class="data">
    <colgroup>
      <col style="width:4%" />
      <col style="width:11%" />
      <col style="width:9%" />
      <col style="width:7%" />
      <col style="width:6%" />
      <col style="width:6%" />
      <col style="width:6%" />
      <col style="width:9%" />
      <col style="width:8%" />
      <col style="width:9%" />
      <col style="width:7%" />
      <col style="width:9%" />
      <col style="width:6%" />
      <col style="width:7%" />
    </colgroup>
    <thead>
      <tr>
        <th>S.N.</th>
        <th>Employee Name</th>
        <th>Salary / Rate / Contract</th>
        <th>Present Days</th>
        <th>Absent Days</th>
        <th>Leave Days</th>
        <th>Extra Duty</th>
        <th>Absent Deduction</th>
        <th>Extra Amount</th>
        <th>Salary Amount</th>
        <th>1% Tax</th>
        <th>Net Salary</th>
        <th>Signature</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" class="c">TOTAL</td>
        <td class="n">${formatCurrencyNpr(totals.totalMonthlySalaryNpr)}</td>
        <td colspan="4"></td>
        <td class="n">${formatCurrencyNpr(totals.totalAbsentDeductionNpr)}</td>
        <td class="n">${formatCurrencyNpr(totals.totalExtraAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(totals.totalSalaryAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(totals.totalTax1PercentNpr)}</td>
        <td class="n">${formatCurrencyNpr(totals.totalNetSalaryNpr)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <p class="words"><strong>Total Net Salary:</strong> ${formatCurrencyNpr(totals.totalNetSalaryNpr)}
    <br/><strong>In words:</strong> ${escapeHtml(totals.totalNetSalaryInWords)}</p>
  <table class="sign-table">
    <tr>
      ${signs.map((s) => signCell(s.position, s.name)).join("")}
    </tr>
  </table>
</div>`;
  };

  const exportPdf = async () => {
    if (rows.length === 0) {
      toast.error("No salary rows to export — add at least one employee first");
      return;
    }
    const sign = getSignatories();
    if (!sign) return;

    // Keep on-screen (opacity 0) so fonts layout correctly; off-screen
    // left:-12000px can yield broken / empty text in html2canvas.
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "1100px";
    host.style.background = "#ffffff";
    host.style.opacity = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = "-1";
    host.innerHTML = buildSheetBodyHtml(sign);
    document.body.appendChild(host);

    const target = host.querySelector(".salary-sheet-pdf") as HTMLElement | null;
    if (!target) {
      document.body.removeChild(host);
      toast.error("Could not build salary sheet for PDF");
      return;
    }

    try {
      toast.message("Generating PDF…");
      // Wait a frame so fonts + table layout settle before rasterize
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      if (document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise<void>((r) => window.setTimeout(r, 1500)),
        ]);
      }

      const { default: html2pdf } = await import("html2pdf.js");
      const filename = `Salary_Sheet_${monthBs || "payroll"}.pdf`;
      const blob = (await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#ffffff",
            logging: false,
            windowWidth: 1100,
            scrollX: 0,
            scrollY: 0,
          },
          jsPDF: {
            unit: "mm",
            format: "a4",
            orientation: "landscape",
          },
          pagebreak: { mode: ["css", "legacy"] },
        } as never)
        .from(target)
        .outputPdf("blob")) as Blob;

      if (!blob || blob.size < 100) {
        throw new Error("PDF was empty — try again");
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "PDF generation failed");
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
    }
  };

  /** Open browser print dialog for the salary sheet (Save as PDF also available there). */
  const printSheet = () => {
    if (rows.length === 0) {
      toast.error("No salary rows to print — add at least one employee first");
      return;
    }
    const sign = getSignatories();
    if (!sign) return;

    try {
      const body = buildSheetBodyHtml(sign);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>&#8203;</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
    }
    body { padding: 8mm 6mm; }
    @page { size: A4 landscape; margin: 8mm 6mm; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
      printHtmlViaIframe(html);
      toast.success("Print dialog opened");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not open print preview",
      );
    }
  };

  const exportExcel = () => {
    if (rows.length === 0) {
      toast.error("No salary rows to export — add at least one employee first");
      return;
    }
    const sign = getSignatories();
    if (!sign) return;
    downloadRecordsExcel(`Salary_Sheet_${monthBs}`, [
      ...rows.map((r) => ({
        "S.N.": r.sn,
        "Employee Name": r.employeeName,
        "Pay type":
          r.employeeType === "TEACHER"
            ? TEACHER_PAYMENT_TYPE_LABELS[payTypeOf(r)]
            : "Monthly salary",
        "Pay units":
          payTypeOf(r) === "PERIOD"
            ? `${r.periodsAttended ?? 0} periods`
            : payTypeOf(r) === "TENDER"
              ? `${r.syllabusThisMonthPercent ?? 0}% this month (${r.syllabusCompletedPercent ?? 0}% complete − ${r.syllabusAlreadyPaidPercent ?? 0}% paid, ${r.syllabusRemainingPercent ?? 0}% left)`
              : "",
        "Breakdown": r.payBreakdown || "",
        "Monthly Salary": r.monthlySalaryNpr,
        "Working Days": r.workingDaysInMonth || workingDaysInMonth,
        "Saturdays": saturdayDaysInMonth,
        "Other Holidays": otherHolidayDaysInMonth,
        "Register sheets": `${Number(r.attendanceDaysRecorded) || 0} / ${Number(r.attendanceExpectedDays) || 0}`,
        "Present Days": r.presentDays,
        "Absent Days": r.absentDays,
        "Leave Days": r.leaveDays ?? 0,
        "Extra Duty": r.extraDuty,
        "Absent Deduction": r.absentDeductionNpr,
        "Extra Amount": r.extraAmountNpr,
        "Salary Amount": r.salaryAmountNpr,
        "1% Tax": r.tax1PercentNpr,
        "Net Salary": r.netSalaryNpr,
        Signature: "",
        Remarks: r.remarks || "",
      })),
      {
        "S.N.": "",
        "Employee Name": "TOTAL",
        "Pay type": "",
        "Pay units": "",
        "Breakdown": "",
        "Monthly Salary": totals.totalMonthlySalaryNpr,
        "Working Days": "",
        "Saturdays": "",
        "Other Holidays": "",
        "Register sheets": "",
        "Present Days": "",
        "Absent Days": "",
        "Leave Days": "",
        "Extra Duty": "",
        "Absent Deduction": totals.totalAbsentDeductionNpr,
        "Extra Amount": totals.totalExtraAmountNpr,
        "Salary Amount": totals.totalSalaryAmountNpr,
        "1% Tax": totals.totalTax1PercentNpr,
        "Net Salary": totals.totalNetSalaryNpr,
        Signature: "",
        Remarks: "",
      },
      {
        "S.N.": "",
        "Employee Name": "Total Net in words",
        "Pay type": "",
        "Pay units": "",
        "Breakdown": "",
        "Monthly Salary": totals.totalNetSalaryInWords,
        "Working Days": "",
        "Saturdays": "",
        "Other Holidays": "",
        "Register sheets": "",
        "Present Days": "",
        "Absent Days": "",
        "Leave Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      },
      ...sign.map((s) => ({
        "S.N.": "",
        "Employee Name": s.position,
        "Pay type": "",
        "Pay units": "",
        "Breakdown": "",
        "Monthly Salary": s.name,
        "Working Days": "",
        "Saturdays": "",
        "Other Holidays": "",
        "Register sheets": "",
        "Present Days": "",
        "Absent Days": "",
        "Leave Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      })),
    ]);
    toast.success("Excel salary sheet exported");
  };

  const saveSheet = () => {
    if (!canSaveSheet) {
      toast.error("Cannot save");
      return;
    }
    if (!monthBs || !/^\d{4}-\d{2}$/.test(monthBs)) {
      toast.error("Select payroll month (BS YYYY-MM)");
      return;
    }
    if (rows.length === 0) {
      toast.error("No employees on the salary sheet");
      return;
    }
    if (status === "PAID" && !paidDateBs) {
      toast.error("Paid date (BS) is required when marking Paid");
      return;
    }
    saveMutation.mutate({
      monthBs,
      status,
      paidDateBs: paidDateBs || undefined,
      paymentMethod,
      rows: rows.map((r) => ({
        employeeType: r.employeeType,
        teacherId: r.teacherId,
        staffId: r.staffId,
        employeeName: r.employeeName,
        monthlySalaryNpr: r.monthlySalaryNpr,
        paymentType: r.paymentType,
        periodRateNpr: r.periodRateNpr,
        periodsAttended: r.periodsAttended,
        tenderAmountNpr: r.tenderAmountNpr,
        syllabusCompletedPercent: r.syllabusCompletedPercent,
        syllabusAlreadyPaidPercent: r.syllabusAlreadyPaidPercent,
        syllabusThisMonthPercent: r.syllabusThisMonthPercent,
        syllabusRemainingPercent: r.syllabusRemainingPercent,
        tenderAlreadyPaidNpr: r.tenderAlreadyPaidNpr,
        tenderThisMonthNpr: r.tenderThisMonthNpr,
        payBreakdown: r.payBreakdown,
        presentDays: r.presentDays,
        absentDays: r.absentDays,
        leaveDays: r.leaveDays ?? 0,
        extraDuty: r.extraDuty,
        extraAmountNpr: r.extraAmountNpr,
        absentDeductionNpr: r.absentDeductionNpr,
        salaryAmountNpr: r.salaryAmountNpr,
        tax1PercentNpr: r.tax1PercentNpr,
        netSalaryNpr: r.netSalaryNpr,
        remarks: r.remarks,
        attendanceManualOverride: r.attendanceManualOverride,
        valuesManualOverride: Boolean(r.valuesManualOverride),
        salaryPaymentId: r.salaryPaymentId,
      })),
    });
  };

  const viewModeToggle = (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
          viewMode === "prepare"
            ? "bg-brand-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-50",
        )}
        onClick={() => setViewMode("prepare")}
      >
        <Banknote className="h-3.5 w-3.5" />
        Prepare sheet
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
          viewMode === "history"
            ? "bg-brand-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-50",
        )}
        onClick={() => setViewMode("history")}
      >
        <History className="h-3.5 w-3.5" />
        Saved months
      </button>
    </div>
  );

  if (viewMode === "history") {
    return (
      <div className="space-y-4">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
                    <History className="h-5 w-5" />
                  </span>
                  Saved salary months
                </CardTitle>
              </div>
              {viewModeToggle}
            </div>
          </div>
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-sm flex-1">
                <FormField label="Search months">
                  <Input
                    placeholder="e.g. 2083-04, Shrawan, PAID…"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </FormField>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void monthsQuery.refetch()}
                disabled={monthsQuery.isFetching}
              >
                {monthsQuery.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
            </div>

            {monthsQuery.isLoading ? <LoadingState /> : null}

            {monthsQuery.isError ? (
              <EmptyState
                title="Could not load saved months"
                description={parseErrorMessage(monthsQuery.error)}
              />
            ) : null}

            {!monthsQuery.isLoading &&
            !monthsQuery.isError &&
            filteredHistoryMonths.length === 0 ? (
              <EmptyState
                title={
                  historySearch.trim()
                    ? "No months match your search"
                    : "No saved salary sheets yet"
                }
                description={
                  historySearch.trim()
                    ? "Try a different month or status."
                    : "Save a payroll month from Prepare sheet — it will appear here."
                }
              />
            ) : null}

            {!monthsQuery.isLoading &&
            !monthsQuery.isError &&
            filteredHistoryMonths.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Month (BS)</Th>
                      <Th className="text-right">Employees</Th>
                      <Th className="text-right">Total net</Th>
                      <Th>Status</Th>
                      <Th>Paid date</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredHistoryMonths.map((m) => {
                      const isCurrent = m.monthBs === monthBs;
                      const statusLabel =
                        m.status === "MIXED"
                          ? `Mixed (${m.paidCount} paid · ${m.processedCount} proc. · ${m.draftCount} draft)`
                          : m.status === "PENDING_APPROVAL"
                            ? "Pending"
                            : m.status === "APPROVED"
                              ? "Approved"
                              : m.status;
                      const statusClass =
                        m.status === "PAID"
                          ? "bg-emerald-100 text-emerald-800"
                          : m.status === "APPROVED"
                            ? "bg-emerald-50 text-emerald-800"
                            : m.status === "PENDING_APPROVAL"
                              ? "bg-amber-100 text-amber-900"
                              : m.status === "PROCESSED"
                            ? "bg-sky-100 text-sky-800"
                            : m.status === "MIXED"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-slate-100 text-slate-700";
                      return (
                        <tr
                          key={m.monthBs}
                          className={cn(
                            "border-t border-slate-100",
                            isCurrent && "bg-brand-50/50",
                          )}
                        >
                          <Td>
                            <div className="font-medium text-slate-900">
                              {formatPayrollMonthLabel(m.monthBs)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {m.monthBs}
                              {isCurrent ? (
                                <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800">
                                  open
                                </span>
                              ) : null}
                            </div>
                          </Td>
                          <Td className="text-right tabular-nums">
                            {m.employeeCount}
                          </Td>
                          <Td className="text-right font-semibold tabular-nums text-emerald-800">
                            {formatCurrencyNpr(m.totalNetSalaryNpr)}
                          </Td>
                          <Td>
                            <span
                              className={cn(
                                "inline-flex max-w-[14rem] rounded-full px-2 py-0.5 text-[11px] font-medium",
                                statusClass,
                              )}
                              title={statusLabel}
                            >
                              {statusLabel}
                            </span>
                          </Td>
                          <Td className="text-sm text-slate-600">
                            {m.paidDateBs || "—"}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openSavedMonth(m.monthBs)}
                              >
                                Open
                              </Button>
                              {canDeleteMonth ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                  title="Delete"
                                  disabled={deleteMonthMutation.isPending}
                                  onClick={() => {
                                    const label = `${formatPayrollMonthLabel(m.monthBs)} (${m.monthBs}) · ${m.employeeCount} employee(s) · ${formatCurrencyNpr(m.totalNetSalaryNpr)}`;
                                    if (
                                      !window.confirm(
                                        `Delete entire salary sheet?\n\n${label}\n\nAll employee rows for this month will be removed. If any were Paid, journal and cash book entries are reversed.`,
                                      )
                                    ) {
                                      return;
                                    }
                                    void deleteMonthMutation.mutateAsync(
                                      m.monthBs,
                                    );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
              <span>
                {(monthsQuery.data ?? []).length} saved month
                {(monthsQuery.data ?? []).length === 1 ? "" : "s"}
                {historySearch.trim() && filteredHistoryMonths.length !== (monthsQuery.data ?? []).length
                  ? ` · showing ${filteredHistoryMonths.length}`
                  : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setViewMode("prepare")}
              >
                Back to prepare sheet
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!monthBs) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{viewModeToggle}</div>
        <EmptyState
          title="Select payroll month"
          description="Enter a BS month (YYYY-MM) to load the salary sheet."
        />
      </div>
    );
  }

  if (sheetQuery.isLoading) return <LoadingState />;

  if (sheetQuery.isError) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{viewModeToggle}</div>
        <EmptyState
          title="Could not load salary sheet"
          description={parseErrorMessage(sheetQuery.error)}
        />
      </div>
    );
  }

  const exportDisabled = rows.length === 0;
  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={printSheet}
        disabled={exportDisabled}
        title="Print salary sheet (or Save as PDF from the print dialog)"
      >
        <Printer className="mr-1 h-4 w-4" />
        Print
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void exportPdf()}
        disabled={exportDisabled}
      >
        <FileDown className="mr-1 h-4 w-4" />
        PDF
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={exportExcel}
        disabled={exportDisabled}
      >
        <FileDown className="mr-1 h-4 w-4" />
        Excel
      </Button>
      {canSaveSheet ? (
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending || exportDisabled}
          onClick={saveSheet}
        >
          <Save className="mr-1 h-4 w-4" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      ) : null}
      {canSubmitSheet ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={submitMutation.isPending || saveMutation.isPending}
          onClick={() => {
            const persistThenSubmit = async () => {
              if (rows.some((r) => r.dirty || !r.salaryPaymentId)) {
                await saveMutation.mutateAsync({
                  monthBs,
                  status: "DRAFT",
                  paidDateBs: paidDateBs || undefined,
                  paymentMethod,
                  rows: rows.map((r) => ({
                    employeeType: r.employeeType,
                    teacherId: r.teacherId,
                    staffId: r.staffId,
                    employeeName: r.employeeName,
                    monthlySalaryNpr: r.monthlySalaryNpr,
                    presentDays: r.presentDays,
                    absentDays: r.absentDays,
                    leaveDays: r.leaveDays ?? 0,
                    extraDuty: r.extraDuty,
                    extraAmountNpr: r.extraAmountNpr,
                    absentDeductionNpr: r.absentDeductionNpr,
                    salaryAmountNpr: r.salaryAmountNpr,
                    tax1PercentNpr: r.tax1PercentNpr,
                    netSalaryNpr: r.netSalaryNpr,
                    remarks: r.remarks,
                    attendanceManualOverride: r.attendanceManualOverride,
                    valuesManualOverride: Boolean(r.valuesManualOverride),
                    salaryPaymentId: r.salaryPaymentId,
                  })),
                });
              }
              submitMutation.mutate();
            };
            void persistThenSubmit();
          }}
        >
          {submitMutation.isPending ? "Submitting…" : "Submit"}
        </Button>
      ) : null}
      {canApproveSheet ? (
        <Button
          type="button"
          size="sm"
          disabled={approveMutation.isPending}
          onClick={() => approveMutation.mutate()}
        >
          {approveMutation.isPending ? "Approving…" : "Approve"}
        </Button>
      ) : null}
      {canReturnForCorrection ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-amber-800"
          disabled={rejectMutation.isPending}
          onClick={() => {
            if (
              !window.confirm(
                "Return this salary sheet to the accountant for correction? They can update it and submit again.",
              )
            ) {
              return;
            }
            rejectMutation.mutate();
          }}
        >
          {rejectMutation.isPending ? "Returning…" : "Return for correction"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ─── 1. Header + payroll controls ─── */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
                  <Banknote className="h-5 w-5" />
                </span>
                Salary Sheet / Payroll
              </CardTitle>
              <div className="mt-3">{viewModeToggle}</div>
            </div>
            {toolbarActions}
          </div>
        </div>
        <CardContent className="space-y-3 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            1 · Period &amp; status
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Payroll month (BS) *">
              <Input
                placeholder="YYYY-MM e.g. 2082-01"
                value={monthBs}
                onChange={(e) => setMonthBs(e.target.value.trim())}
              />
            </FormField>
            <FormField label="Status">
              {isAdmin && status === "APPROVED" ? (
                <Select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as SalaryPaymentStatus)
                  }
                >
                  <option value="APPROVED">Approved</option>
                  <option value="PAID">Paid</option>
                </Select>
              ) : (
                <Input
                  value={
                    status === "PENDING_APPROVAL"
                      ? "Pending"
                      : status === "APPROVED"
                        ? "Approved"
                        : status === "PAID"
                          ? "Paid"
                          : status === "PROCESSED"
                            ? "Processed"
                            : "Draft"
                  }
                  disabled
                  readOnly
                />
              )}
            </FormField>
            <FormField label="Payment method">
              <Select
                value={paymentMethod}
                disabled={!canWritePayroll}
                onChange={(e) =>
                  setPaymentMethod(
                    e.target.value as (typeof PAYMENT_METHODS)[number],
                  )
                }
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </FormField>
            {status === "PENDING_APPROVAL" ||
            status === "APPROVED" ||
            approval?.collegeAdminApproved ||
            approval?.superAdminApproved ? (
              <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1">
                <span
                  className={cn(
                    "rounded-full px-2 py-1 text-xs font-medium",
                    approval?.collegeAdminApproved
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  Admin{approval?.collegeAdminApproved ? " ✓" : ""}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-1 text-xs font-medium",
                    approval?.superAdminApproved
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  Super Admin{approval?.superAdminApproved ? " ✓" : ""}
                </span>
              </div>
            ) : null}
            {status === "PAID" ? (
              <FormField label="Paid date (BS) *">
                {canWritePayroll ? (
                  <NepaliDateField value={paidDateBs} onChange={setPaidDateBs} />
                ) : (
                  <Input value={paidDateBs || "—"} disabled readOnly />
                )}
              </FormField>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
            <span title="Calendar days in this Bikram Sambat month">
              Month days:{" "}
              <strong className="text-slate-900">
                {calendarDaysInMonth}
              </strong>
            </span>
            <span title="Saturday weekly offs. A WORKING_DAY override on the academic calendar keeps that Saturday as a working day.">
              Saturdays:{" "}
              <strong className="text-slate-900">
                −{saturdayDaysInMonth}
              </strong>
            </span>
            <span title="Public holidays, vacations and other calendar holidays that are not Saturdays. These never count as absence.">
              Other holidays:{" "}
              <strong className="text-slate-900">
                −{otherHolidayDaysInMonth}
              </strong>
            </span>
            <span title="Working days = month days − Saturdays − other holidays. Per-day salary = monthly salary ÷ working days. Leave and absence deduct against this.">
              Working days:{" "}
              <strong className="text-slate-900">{workingDaysInMonth}</strong>
              <span className="text-slate-500">
                {" "}
                ({calendarDaysInMonth} − {saturdayDaysInMonth} − {otherHolidayDaysInMonth}
                {holidayDaysInMonth !== saturdayDaysInMonth + otherHolidayDaysInMonth
                  ? `, total off ${holidayDaysInMonth}`
                  : ""}
                )
              </span>
            </span>
            {sheetQuery.data ? (
              <span
                title="Working days that have a teacher / staff attendance register. Registers taken on a holiday are ignored."
                className={cn(
                  sheetQuery.data.attendanceCoverageDays < workingDaysInMonth &&
                    "text-amber-700",
                )}
              >
                Attendance taken:{" "}
                <strong
                  className={cn(
                    sheetQuery.data.attendanceCoverageDays < workingDaysInMonth
                      ? "text-amber-900"
                      : "text-slate-900",
                  )}
                >
                  {sheetQuery.data.attendanceCoverageDays} / {workingDaysInMonth}
                </strong>
                {sheetQuery.data.attendanceCoverageDaysTeacher !== undefined &&
                sheetQuery.data.attendanceCoverageDaysStaff !== undefined ? (
                  <span className="text-slate-500">
                    {" "}
                    (teachers {sheetQuery.data.attendanceCoverageDaysTeacher} ·
                    staff {sheetQuery.data.attendanceCoverageDaysStaff})
                  </span>
                ) : null}
              </span>
            ) : null}
            {incompleteAttendanceCount > 0 ? (
              <span
                className="text-amber-700"
                title="These employees are missing from some day sheets — the unrecorded days are paid as present"
              >
                Incomplete attendance:{" "}
                <strong className="text-amber-900">
                  {incompleteAttendanceCount}
                </strong>
              </span>
            ) : null}
            <span title="Employees with a saved payroll row for this month">
              On sheet:{" "}
              <strong className="text-slate-900">{rows.length}</strong>
            </span>
            <span title="Employees in the roster who are not on this month's sheet yet">
              Not yet added:{" "}
              <strong className="text-slate-900">{availableCatalog.length}</strong>
            </span>
            <span>
              Month:{" "}
              <strong className="text-slate-900">{monthLabel}</strong>
            </span>
            <span className="basis-full text-[11px] text-slate-500">
              Monthly teachers: Present + Absent + Leave = working days; leave
              and absence deduct (monthly ÷ working days × days). Tender
              teachers: paid from syllabus completed this year minus already
              paid. Period teachers: rate × periods taught (log book). Saturdays
              and holidays are not working days.
            </span>
          </div>
        </CardContent>
      </Card>

      {isAccountant && !isAdmin ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {status === "PENDING_APPROVAL" ? (
            <p>
              This sheet is submitted and waiting for admin approval. You cannot
              edit it until an admin uses <strong>Return for correction</strong>.
            </p>
          ) : status === "APPROVED" || status === "PAID" ? (
            <p>This salary sheet is locked. Amounts are set by admin.</p>
          ) : (
            <p>
              Prepare the sheet (add employees and attendance), then{" "}
              <strong>Submit</strong> for admin approval. Salary / net amounts
              are fixed from employee records — only admin can change them or
              remove rows.
            </p>
          )}
        </div>
      ) : null}

      {sheetQuery.data?.attendanceWarning ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-amber-900/90">{sheetQuery.data.attendanceWarning}</p>
          </div>
        </div>
      ) : null}

      {/* ─── 2. Add employee (accountant prepares; admin may also edit amounts) ─── */}
      {canWritePayroll ? (
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5"
          onClick={() => setAddSectionOpen((o) => !o)}
          aria-expanded={addSectionOpen}
        >
          <div className="flex min-w-0 items-center gap-2">
            <UserPlus className="h-4 w-4 shrink-0 text-brand-600" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                2 · Add employees
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {editingKey
                  ? "Edit employee on sheet"
                  : "Add employee (one by one)"}
              </p>
            </div>
            {editingKey ? (
              <Badge className="bg-sky-100 text-sky-900">Editing</Badge>
            ) : null}
          </div>
          {addSectionOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          )}
        </button>
        {addSectionOpen ? (
        <CardContent className="space-y-4 pt-4">
          <p className="text-sm text-slate-500">
            Select one employee, review auto-filled attendance, adjust if needed, then
            add them to the salary sheet below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Employee type *">
              <Select
                value={entry.employeeType}
                disabled={Boolean(editingKey)}
                onChange={(e) =>
                  setEntry((f) => ({
                    ...f,
                    employeeType: e.target.value as "TEACHER" | "STAFF",
                    employeeKey: "",
                    monthlySalaryNpr: "0",
                    periodsAttended: "0",
                    syllabusCompletedPercent: "0",
                    presentDays: "0",
                    absentDays: "0",
                    leaveDays: "0",
                    extraDuty: "0",
                    remarks: "",
                    attendanceManualOverride: false,
                  }))
                }
              >
                <option value="TEACHER">Teacher</option>
                <option value="STAFF">Staff</option>
              </Select>
            </FormField>
            <FormField label="Employee *">
              <Select
                value={entry.employeeKey}
                disabled={Boolean(editingKey)}
                onChange={(e) => fillEntryFromCatalog(e.target.value)}
              >
                <option value="">
                  {pickerEmployees.length === 0
                    ? "No more employees to add"
                    : "Select employee"}
                </option>
                {pickerEmployees.map((c) => (
                  <option key={employeeKeyOf(c)} value={employeeKeyOf(c)}>
                    {c.employeeName}
                    {c.designation ? ` — ${c.designation}` : ""}
                    {c.department ? ` (${c.department})` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label={`${rateColumnLabel(payTypeOf(selectedCatalogRow))} *`}
            >
              <NumberInput
                min={0}
                value={entry.monthlySalaryNpr}
                disabled={!canEditAmounts}
                title={
                  canEditAmounts
                    ? undefined
                    : "Salary / tender / period rate is set by admin and cannot be changed here"
                }
                onChange={(e) =>
                  setEntry((f) => ({ ...f, monthlySalaryNpr: e.target.value }))
                }
              />
              {!canEditAmounts ? (
                <p className="text-[11px] leading-snug text-slate-500">
                  Amount is fixed from the employee record (admin). Accountant
                  prepares the sheet, then submits for approval.
                </p>
              ) : null}
            </FormField>
            {payTypeOf(selectedCatalogRow) === "PERIOD" ? (
              <FormField label="Periods taught">
                <NumberInput
                  min={0}
                  step={1}
                  value={entry.periodsAttended}
                  onChange={(e) =>
                    setEntry((f) => ({
                      ...f,
                      periodsAttended: e.target.value,
                      attendanceManualOverride: true,
                    }))
                  }
                />
              </FormField>
            ) : null}
            {payTypeOf(selectedCatalogRow) === "TENDER" ? (
              <FormField label="Syllabus completed (%)">
                <NumberInput
                  min={0}
                  max={100}
                  value={entry.syllabusCompletedPercent}
                  title={
                    selectedCatalogRow?.payBreakdown ||
                    "Auto-filled from the allotted subject syllabus. Change only to override."
                  }
                  onChange={(e) =>
                    setEntry((f) => ({
                      ...f,
                      syllabusCompletedPercent: e.target.value,
                      attendanceManualOverride: true,
                    }))
                  }
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  {selectedCatalogRow?.payBreakdown ||
                    "Auto-filled from the allotted subject syllabus."}
                </p>
              </FormField>
            ) : null}
            <FormField label="Present days">
              <NumberInput
                min={0}
                step={0.5}
                value={entry.presentDays}
                disabled={!canManualAttendance && !entry.attendanceManualOverride}
                onChange={(e) =>
                  setEntry((f) => ({
                    ...f,
                    presentDays: e.target.value,
                    attendanceManualOverride: true,
                  }))
                }
              />
            </FormField>
            <FormField label="Absent days">
              <NumberInput
                min={0}
                step={0.5}
                value={entry.absentDays}
                disabled={!canManualAttendance && !entry.attendanceManualOverride}
                onChange={(e) =>
                  setEntry((f) => ({
                    ...f,
                    absentDays: e.target.value,
                    attendanceManualOverride: true,
                  }))
                }
              />
            </FormField>
            <FormField label="Leave days">
              <NumberInput
                min={0}
                step={0.5}
                value={entry.leaveDays}
                disabled={!canManualAttendance && !entry.attendanceManualOverride}
                onChange={(e) =>
                  setEntry((f) => ({
                    ...f,
                    leaveDays: e.target.value,
                    attendanceManualOverride: true,
                  }))
                }
              />
            </FormField>
            <FormField
              label={
                payTypeOf(selectedCatalogRow) === "PERIOD"
                  ? "Extra periods"
                  : "Extra duty (days)"
              }
            >
              <NumberInput
                min={0}
                step={0.5}
                value={entry.extraDuty}
                onChange={(e) =>
                  setEntry((f) => ({ ...f, extraDuty: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Remarks">
              <Input
                value={entry.remarks}
                onChange={(e) =>
                  setEntry((f) => ({ ...f, remarks: e.target.value }))
                }
                placeholder="Optional"
              />
            </FormField>
          </div>

          {selectedCatalogRow ? (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500">Absent deduction</p>
                <p className="font-medium text-rose-700">
                  {formatCurrencyNpr(entryPreview.absentDeductionNpr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Extra amount</p>
                <p className="font-medium text-emerald-700">
                  {formatCurrencyNpr(entryPreview.extraAmountNpr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Salary amount</p>
                <p className="font-medium">
                  {formatCurrencyNpr(entryPreview.salaryAmountNpr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">1% tax</p>
                <p className="font-medium">
                  {formatCurrencyNpr(entryPreview.tax1PercentNpr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Net salary</p>
                <p className="font-semibold text-brand-800">
                  {formatCurrencyNpr(entryPreview.netSalaryNpr)}
                </p>
              </div>
              {selectedCatalogRow.attendanceIncomplete ? (
                <div className="sm:col-span-2 lg:col-span-5">
                  <Badge className="bg-amber-100 text-amber-900">
                    Attendance incomplete for this employee
                    {selectedCatalogRow.attendanceExpectedDays
                      ? ` — recorded on ${selectedCatalogRow.attendanceDaysRecorded} of ${selectedCatalogRow.attendanceExpectedDays} day sheet(s)`
                      : ""}
                    {" "}— verify days before adding
                  </Badge>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {editingKey ? (
              <Button type="button" variant="outline" onClick={cancelEntry}>
                Cancel edit
              </Button>
            ) : null}
            <Button type="button" onClick={addOrUpdateEntry}>
              {editingKey ? (
                <>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Update on sheet
                </>
              ) : (
                <>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add to salary sheet
                </>
              )}
            </Button>
          </div>
        </CardContent>
        ) : null}
      </Card>
      ) : null}

      {/* ─── 3. Sheet table ─── */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="space-y-3 border-b border-slate-100 bg-slate-50/40 pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {canWritePayroll ? "3 · Salary sheet" : "2 · Salary sheet"}
              </p>
              <CardTitle className="mt-0.5 flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-brand-600" />
                {monthLabel}
                <span className="font-normal text-slate-400">·</span>
                <span className="font-mono text-sm font-normal text-slate-500">
                  {monthBs}
                </span>
              </CardTitle>
            </div>
            <Badge
              className={cn(
                "w-fit shrink-0",
                status === "PAID"
                  ? "bg-emerald-100 text-emerald-900"
                  : status === "APPROVED"
                    ? "bg-emerald-50 text-emerald-900"
                    : status === "PENDING_APPROVAL"
                      ? "bg-amber-100 text-amber-900"
                  : status === "PROCESSED"
                    ? "bg-sky-100 text-sky-900"
                    : "bg-slate-100 text-slate-700",
              )}
            >
              {status === "PENDING_APPROVAL"
                ? "Pending"
                : status === "APPROVED"
                  ? "Approved"
                  : status === "PAID"
                    ? "Paid"
                    : status === "PROCESSED"
                      ? "Processed"
                      : "Draft"}
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <FormField label="Search on sheet">
              <Input
                placeholder="Name, department…"
                value={listSearch}
                onChange={(e) => {
                  setListSearch(e.target.value);
                  if (!e.target.value.trim()) setHighlightEmployee("");
                }}
              />
            </FormField>
            <FormField label="Type">
              <Select value={listType} onChange={(e) => setListType(e.target.value)}>
                <option value="">All</option>
                <option value="TEACHER">Teacher</option>
                <option value="STAFF">Staff</option>
              </Select>
            </FormField>
            <FormField label="Department">
              <Select value={listDept} onChange={(e) => setListDept(e.target.value)}>
                <option value="">All</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </FormField>
            {(listSearch || listType || listDept) ? (
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setListSearch("");
                    setListType("");
                    setListDept("");
                    setHighlightEmployee("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : null}
          </div>
          {rows.length > 0 ? (
            <p className="text-xs text-slate-500">
              Showing {displayedRows.length} of {rows.length} saved employee
              {rows.length === 1 ? "" : "s"} for {monthBs}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="pt-4">
          {/* On-screen header matching PDF */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-center">
            <p className="text-base font-bold uppercase tracking-wide text-slate-900">
              {collegeName}
            </p>
            {collegeNameNp ? (
              <p className="text-sm font-semibold text-slate-800">
                {collegeNameNp}
              </p>
            ) : null}
            {collegeAddress ? (
              <p className="mt-0.5 text-xs text-slate-600">{collegeAddress}</p>
            ) : null}
            <p className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-800">
              Salary Sheet of {monthLabel}
            </p>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No employees on the sheet yet"
              description="Use “Add employee (one by one)” above. Saved payroll for this month should appear automatically after load — check the payroll month (BS YYYY-MM)."
            />
          ) : displayedRows.length === 0 ? (
            <div className="space-y-3">
              <EmptyState
                title="No matches for current filters"
                description={`${rows.length} employee(s) are on this month’s sheet, but none match the search / type / department filters.`}
              />
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setListSearch("");
                    setListType("");
                    setListDept("");
                    setHighlightEmployee("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHead>
                  <tr className="bg-slate-50 text-xs">
                    <Th className="w-12 text-center">S.N.</Th>
                    <Th>Employee Name</Th>
                    <Th className="text-right">Salary / Rate / Contract</Th>
                    <Th className="text-center">Pay units</Th>
                    <Th className="text-center">Register</Th>
                    <Th className="text-center">Present Days</Th>
                    <Th className="text-center">Absent Days</Th>
                    <Th className="text-center">Leave Days</Th>
                    <Th className="text-center">Extra Duty</Th>
                    <Th className="text-right">Absent Deduction</Th>
                    <Th className="text-right">Extra Amount</Th>
                    <Th className="text-right">Salary Amount</Th>
                    <Th className="text-right">1% Tax</Th>
                    <Th className="text-right">Net Salary</Th>
                    <Th className="text-center">Signature</Th>
                    <Th>Remarks</Th>
                    {canManageRows ? <Th>Actions</Th> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {displayedRows.map((row) => {
                    const rowKey = employeeKeyOf(row);
                    const cellInput =
                      "h-8 min-w-[4.5rem] border-slate-200 bg-white px-1.5 text-right text-xs tabular-nums";
                    const rowRecordedDays = Number(row.attendanceDaysRecorded) || 0;
                    const rowExpectedSheets = Number(row.attendanceExpectedDays) || 0;
                    const rowMonthDays = row.workingDaysInMonth || workingDaysInMonth;
                    const rowUnrecordedDays =
                      row.unrecordedDays ??
                      Math.max(0, rowMonthDays - rowRecordedDays);
                    const rowLeaveDays = Number(row.leaveDays) || 0;
                    const daysSum =
                      Number(row.presentDays || 0) +
                      Number(row.absentDays || 0) +
                      rowLeaveDays;
                    const daysReconcile = Math.abs(daysSum - rowMonthDays) < 0.01;
                    return (
                    <tr
                      key={`${row.employeeType}-${row.teacherId || row.staffId}`}
                      className={cn(
                        row.attendanceIncomplete && "bg-amber-50/40",
                        row.valuesManualOverride && "bg-violet-50/30",
                        row.dirty && "ring-1 ring-inset ring-brand-200",
                        highlightEmployee &&
                          row.employeeName
                            .toLowerCase()
                            .includes(highlightEmployee.toLowerCase()) &&
                          "bg-brand-50 ring-2 ring-inset ring-brand-400",
                      )}
                    >
                      <Td className="text-center tabular-nums text-slate-500">
                        {row.sn}
                      </Td>
                      <Td>
                        <div className="font-medium text-slate-900">
                          {row.employeeName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.designation || row.employeeType}
                          {row.department ? ` · ${row.department}` : ""}
                        </div>
                        {row.employeeType === "TEACHER" ? (
                          <Badge className="mt-1 bg-slate-100 text-slate-800">
                            {TEACHER_PAYMENT_TYPE_LABELS[payTypeOf(row)]}
                          </Badge>
                        ) : null}
                        {row.payBreakdown ? (
                          <div className="mt-1 max-w-[16rem] text-[11px] leading-snug text-slate-600">
                            {row.payBreakdown}
                          </div>
                        ) : null}
                        {row.attendanceIncomplete ? (
                          <Badge
                            className="mt-1 bg-amber-100 text-amber-900"
                            title={`Attendance recorded on ${row.attendanceDaysRecorded} of ${row.attendanceExpectedDays ?? 0} day sheet(s) this month. Unrecorded working days are paid as present. Saturdays and calendar holidays are excluded from working days.`}
                          >
                            {payTypeOf(row) === "PERIOD"
                              ? "No periods recorded"
                              : payTypeOf(row) === "TENDER"
                                ? "No subject tender"
                                : "Attendance incomplete"}
                            {payTypeOf(row) === "MONTHLY" &&
                            row.attendanceExpectedDays
                              ? ` (${row.attendanceDaysRecorded}/${row.attendanceExpectedDays} days)`
                              : ""}
                          </Badge>
                        ) : null}
                        {row.attendanceManualOverride ? (
                          <Badge className="mt-1 bg-sky-100 text-sky-900">
                            Manual days
                          </Badge>
                        ) : null}
                        {row.valuesManualOverride ? (
                          <Badge className="mt-1 bg-violet-100 text-violet-900">
                            Manual amounts
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-right">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cellInput}
                            value={row.monthlySalaryNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { monthlySalaryNpr: v ?? 0 },
                                "rate",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.monthlySalaryNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-center">
                        {payTypeOf(row) === "PERIOD" ? (
                          canEditSheet ? (
                            <NumberInput
                              min={0}
                              className={cn(cellInput, "text-center")}
                              value={row.periodsAttended ?? 0}
                              // Auto-filled from the Teacher Attendance Period Log;
                              // editing here overrides it for this month only.
                              title={
                                row.payBreakdown ||
                                "Periods taught this month. Recorded in Attendance → Teacher Attendance → Period Log."
                              }
                              onValueChange={(v) =>
                                patchRow(
                                  rowKey,
                                  { periodsAttended: v ?? 0 },
                                  "units",
                                )
                              }
                            />
                          ) : (
                            <span
                              className="tabular-nums"
                              title={row.payBreakdown || undefined}
                            >
                              {row.periodsAttended ?? 0}
                            </span>
                          )
                        ) : payTypeOf(row) === "TENDER" ? (
                          canEditSheet ? (
                            <NumberInput
                              min={0}
                              max={100}
                              className={cn(cellInput, "text-center")}
                              value={row.syllabusCompletedPercent ?? 0}
                              title={
                                row.payBreakdown ||
                                "Current syllabus complete %. This month pays only the increase since last paid month."
                              }
                              onValueChange={(v) =>
                                patchRow(
                                  rowKey,
                                  { syllabusCompletedPercent: v ?? 0 },
                                  "units",
                                )
                              }
                            />
                          ) : (
                            <span
                              className="tabular-nums"
                              title={row.payBreakdown || undefined}
                            >
                              {row.syllabusCompletedPercent ?? 0}%
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {payTypeOf(row) === "PERIOD" ? (
                          <div className="text-[10px] text-slate-500">
                            periods
                          </div>
                        ) : payTypeOf(row) === "TENDER" ? (
                          <div className="text-[10px] leading-snug text-slate-500">
                            <div>
                              this month{" "}
                              <span className="font-semibold text-slate-700">
                                {row.syllabusThisMonthPercent ?? 0}%
                              </span>
                            </div>
                            <div>
                              paid {row.syllabusAlreadyPaidPercent ?? 0}% · left{" "}
                              {row.syllabusRemainingPercent ?? 0}%
                            </div>
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-center">
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            rowUnrecordedDays > 0
                              ? "text-amber-700"
                              : "text-slate-700",
                          )}
                          title={
                            row.attendanceManualOverride
                              ? "Days were entered manually."
                              : rowExpectedSheets > 0
                                ? `On ${rowRecordedDays} of ${rowExpectedSheets} ${row.employeeType === "TEACHER" ? "teacher" : "staff"} register(s). ${rowUnrecordedDays} working day(s) had no mark and are paid as present.`
                                : "No attendance register this month — working days are paid as present."
                          }
                        >
                          {row.attendanceManualOverride
                            ? "Manual"
                            : rowExpectedSheets > 0
                              ? `${rowRecordedDays} / ${rowExpectedSheets}`
                              : "—"}
                        </span>
                        <div
                          className={cn(
                            "text-[10px] leading-tight",
                            daysReconcile ? "text-slate-500" : "text-amber-600",
                          )}
                          title={`Present ${row.presentDays} + Absent ${row.absentDays} + Leave ${rowLeaveDays} should equal ${rowMonthDays} working days`}
                        >
                          {daysReconcile
                            ? `= ${rowMonthDays} working`
                            : `${daysSum} ≠ ${rowMonthDays} working`}
                        </div>
                        {rowUnrecordedDays > 0 && !row.attendanceManualOverride ? (
                          <div className="text-[10px] leading-tight text-amber-600">
                            {rowUnrecordedDays} unrecorded (paid)
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-center">
                        {canEditSheet ? (
                          <NumberInput
                            min={0}
                            step={0.5}
                            className={cn(cellInput, "text-center")}
                            value={row.presentDays}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { presentDays: v ?? 0 },
                                "days",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{row.presentDays}</span>
                        )}
                      </Td>
                      <Td className="text-center">
                        {canEditSheet ? (
                          <NumberInput
                            min={0}
                            step={0.5}
                            className={cn(cellInput, "text-center")}
                            value={row.absentDays}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { absentDays: v ?? 0 },
                                "days",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{row.absentDays}</span>
                        )}
                      </Td>
                      <Td className="text-center">
                        {canEditSheet ? (
                          <NumberInput
                            min={0}
                            step={0.5}
                            className={cn(cellInput, "text-center")}
                            value={row.leaveDays ?? 0}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { leaveDays: v ?? 0 },
                                "days",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{row.leaveDays ?? 0}</span>
                        )}
                      </Td>
                      <Td className="text-center">
                        {canEditSheet ? (
                          <NumberInput
                            min={0}
                            step={0.5}
                            className={cn(cellInput, "text-center")}
                            value={row.extraDuty}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { extraDuty: v ?? 0 },
                                "rate",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{row.extraDuty}</span>
                        )}
                      </Td>
                      <Td className="text-right text-rose-700">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cn(cellInput, "text-rose-800")}
                            value={row.absentDeductionNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { absentDeductionNpr: v ?? 0 },
                                "money",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.absentDeductionNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right text-emerald-700">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cn(cellInput, "text-emerald-800")}
                            value={row.extraAmountNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { extraAmountNpr: v ?? 0 },
                                "money",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.extraAmountNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right font-medium">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cellInput}
                            value={row.salaryAmountNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { salaryAmountNpr: v ?? 0 },
                                "money",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.salaryAmountNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cellInput}
                            value={row.tax1PercentNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { tax1PercentNpr: v ?? 0 },
                                "money",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.tax1PercentNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right font-semibold text-slate-900">
                        {canEditAmounts ? (
                          <NumberInput
                            min={0}
                            className={cn(cellInput, "font-semibold")}
                            value={row.netSalaryNpr}
                            onValueChange={(v) =>
                              patchRow(
                                rowKey,
                                { netSalaryNpr: v ?? 0 },
                                "money",
                              )
                            }
                          />
                        ) : (
                          <span className="tabular-nums">
                            {formatCurrencyNpr(row.netSalaryNpr)}
                          </span>
                        )}
                      </Td>
                      <Td className="min-w-[4rem] border-b border-dashed border-slate-300" />
                      <Td className="max-w-[10rem] text-sm text-slate-600">
                        {canEditSheet ? (
                          <Input
                            className="h-8 min-w-[6rem] text-xs"
                            value={row.remarks || ""}
                            onChange={(e) =>
                              patchRow(
                                rowKey,
                                { remarks: e.target.value },
                                "meta",
                              )
                            }
                            placeholder="—"
                          />
                        ) : (
                          <span className="truncate">{row.remarks || "—"}</span>
                        )}
                      </Td>
                      {canManageRows ? (
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {row.valuesManualOverride ? (
                              <Button
                                size="sm"
                                variant="outline"
                                title="Recalculate money from days and monthly salary"
                                onClick={() => recalculateRowFromDays(row)}
                              >
                                Recalc
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEditRow(row)}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => removeRow(row)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-semibold">
                    <Td colSpan={2} className="text-center">
                      TOTAL ({rows.length})
                    </Td>
                    <Td className="text-right">
                      {formatCurrencyNpr(totals.totalMonthlySalaryNpr)}
                    </Td>
                    {/* Pay units / Register / Present / Absent / Leave / Extra duty */}
                    <Td colSpan={6} />
                    <Td className="text-right text-rose-800">
                      {formatCurrencyNpr(totals.totalAbsentDeductionNpr)}
                    </Td>
                    <Td className="text-right text-emerald-800">
                      {formatCurrencyNpr(totals.totalExtraAmountNpr)}
                    </Td>
                    <Td className="text-right">
                      {formatCurrencyNpr(totals.totalSalaryAmountNpr)}
                    </Td>
                    <Td className="text-right">
                      {formatCurrencyNpr(totals.totalTax1PercentNpr)}
                    </Td>
                    <Td className="text-right text-brand-800">
                      {formatCurrencyNpr(totals.totalNetSalaryNpr)}
                    </Td>
                    {/* Signature + Remarks (+ Actions when admin) */}
                    <Td colSpan={canManageRows ? 3 : 2} />
                  </tr>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 4. Totals ─── */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            4 · Totals
          </p>
          <CardTitle className="text-base">Payroll summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: "Total Monthly Salary",
                value: formatCurrencyNpr(totals.totalMonthlySalaryNpr),
              },
              {
                label: "Total Absent Deduction",
                value: formatCurrencyNpr(totals.totalAbsentDeductionNpr),
              },
              {
                label: "Total Extra Amount",
                value: formatCurrencyNpr(totals.totalExtraAmountNpr),
              },
              {
                label: "Total Salary Amount",
                value: formatCurrencyNpr(totals.totalSalaryAmountNpr),
              },
              {
                label: "Total 1% Tax",
                value: formatCurrencyNpr(totals.totalTax1PercentNpr),
              },
              {
                label: "Total Net Salary",
                value: formatCurrencyNpr(totals.totalNetSalaryNpr),
                emphasize: true,
              },
            ].map((item) => (
              <div
                key={item.label}
                className={cn(
                  "rounded-xl border px-4 py-3",
                  item.emphasize
                    ? "border-brand-200 bg-brand-50"
                    : "border-slate-200 bg-white",
                )}
              >
                <p className="text-xs text-slate-500">{item.label}</p>
                <p
                  className={cn(
                    "text-lg font-semibold",
                    item.emphasize ? "text-brand-900" : "text-slate-900",
                  )}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p>
              <span className="font-medium text-slate-700">
                Total Net Salary (figures):
              </span>{" "}
              {formatCurrencyNpr(totals.totalNetSalaryNpr)}
            </p>
            <p className="mt-1">
              <span className="font-medium text-slate-700">In words:</span>{" "}
              {totals.totalNetSalaryInWords}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── 5. Signatures + export ─── */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5"
          onClick={() => setSignSectionOpen((o) => !o)}
          aria-expanded={signSectionOpen}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              5 · Signatures &amp; export
            </p>
            <p className="text-sm font-semibold text-slate-900">
              Position &amp; name for print / PDF / Excel
              {filledSignatories.length > 0
                ? ` · ${filledSignatories.length} ready`
                : ""}
            </p>
          </div>
          {signSectionOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          )}
        </button>
        {signSectionOpen ? (
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="max-w-xl text-xs text-slate-500">
                Enter <strong>Position</strong> (Prepared by, Checked by, …) and{" "}
                <strong>Name</strong>. Only slots with both filled appear under the
                printed sheet.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={signatories.length >= 4}
                onClick={addSignatorySlot}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add signature
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {signatories.map((s, index) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Signature {index + 1}
                    </p>
                    {signatories.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700"
                        onClick={() => removeSignatorySlot(s.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <FormField label="Position">
                      <Input
                        value={s.position}
                        onChange={(e) =>
                          updateSignatory(s.id, "position", e.target.value)
                        }
                        placeholder="e.g. Prepared by, Checked by"
                        autoComplete="off"
                        list="salary-sign-positions"
                      />
                    </FormField>
                    <FormField label="Name">
                      <Input
                        value={s.name}
                        onChange={(e) =>
                          updateSignatory(s.id, "name", e.target.value)
                        }
                        placeholder="Full name"
                        autoComplete="off"
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
            <datalist id="salary-sign-positions">
              <option value="Prepared by" />
              <option value="Checked by" />
              <option value="Approved by" />
              <option value="Accountant" />
              <option value="Director" />
              <option value="Chairman" />
              <option value="Principal" />
              <option value="Campus Chief" />
            </datalist>

            <div
              className={cn(
                "rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4",
                "grid gap-4",
                filledSignatories.length <= 1 && "sm:grid-cols-1",
                filledSignatories.length === 2 && "sm:grid-cols-2",
                filledSignatories.length >= 3 && "sm:grid-cols-3",
              )}
            >
              {filledSignatories.length === 0 ? (
                <p className="text-center text-xs text-slate-400">
                  Preview appears when you fill a position and name.
                </p>
              ) : (
                filledSignatories.map((s) => (
                  <div key={`${s.position}-${s.name}`} className="text-center">
                    <div className="mx-auto mb-2 w-[52%] max-w-[7.5rem] border-t border-slate-500 pt-2" />
                    <p className="text-sm font-semibold text-slate-800">
                      {s.position}
                    </p>
                    <p className="text-xs text-slate-600">{s.name}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">
                Save payroll first if you changed the sheet, then export.
              </p>
              {toolbarActions}
            </div>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
};
