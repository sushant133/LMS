import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  SalarySheetResponse,
  SalarySheetRow,
  SchoolSettingsRecord,
} from "@phit-erp/shared";
import {
  formatNrsAmountInWords,
  PAYMENT_METHODS,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import {
  AlertTriangle,
  Banknote,
  FileDown,
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
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";

type EditableRow = SalarySheetRow & {
  /** local edits */
  dirty?: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const calcLine = (
  row: Pick<
    EditableRow,
    | "monthlySalaryNpr"
    | "presentDays"
    | "absentDays"
    | "extraDuty"
    | "workingDaysInMonth"
    | "extraAmountNpr"
  >,
  preferExtraDuty = true,
): Pick<
  EditableRow,
  | "absentDeductionNpr"
  | "extraAmountNpr"
  | "salaryAmountNpr"
  | "tax1PercentNpr"
  | "netSalaryNpr"
> => {
  const days = Math.max(1, row.workingDaysInMonth || 30);
  const monthly = Math.max(0, Number(row.monthlySalaryNpr) || 0);
  const absent = Math.max(0, Number(row.absentDays) || 0);
  const extraDuty = Math.max(0, Number(row.extraDuty) || 0);
  const perDay = monthly / days;
  const absentDeductionNpr = round2(perDay * absent);
  const extraAmountNpr =
    preferExtraDuty || extraDuty > 0
      ? round2(perDay * extraDuty)
      : round2(Math.max(0, Number(row.extraAmountNpr) || 0));
  const salaryAmountNpr = round2(
    Math.max(0, monthly - absentDeductionNpr + extraAmountNpr),
  );
  const tax1PercentNpr = round2(salaryAmountNpr * 0.01);
  const netSalaryNpr = round2(Math.max(0, salaryAmountNpr - tax1PercentNpr));
  return {
    absentDeductionNpr,
    extraAmountNpr,
    salaryAmountNpr,
    tax1PercentNpr,
    netSalaryNpr,
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
  presentDays: "0",
  absentDays: "0",
  extraDuty: "0",
  remarks: "",
  attendanceManualOverride: false,
});

const employeeKeyOf = (r: {
  employeeType: string;
  teacherId?: string;
  staffId?: string;
}) =>
  r.employeeType === "TEACHER"
    ? `TEACHER:${r.teacherId ?? ""}`
    : `STAFF:${r.staffId ?? ""}`;

export const SalaryPaymentRecordsPanel = () => {
  const canManualAttendance = useIsTenantAdmin();
  const [monthBs, setMonthBs] = useState(currentBsMonth);
  /** Sheet filter (table view only) */
  const [listSearch, setListSearch] = useState("");
  const [listDept, setListDept] = useState("");
  const [listType, setListType] = useState("");
  /** Employees already on this month's sheet (added one-by-one or previously saved) */
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [status, setStatus] = useState<"DRAFT" | "PROCESSED" | "PAID">("DRAFT");
  const [paidDateBs, setPaidDateBs] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>("BANK_TRANSFER");
  /** Signatories for print / Excel (avoid window.prompt — it breaks pop-up print) */
  const [accountantName, setAccountantName] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [chairmanName, setChairmanName] = useState("");
  /** One-by-one entry form */
  const [entry, setEntry] = useState(emptyEntryForm);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  /** Full employee catalog + attendance for the month (picker source — not the table) */
  const sheetQuery = useQuery({
    queryKey: ["accounting-salary-sheet", monthBs],
    queryFn: () =>
      unwrap<SalarySheetResponse>(
        api.get("/accounting/salary-sheet", {
          params: { monthBs },
        }),
      ),
    enabled: Boolean(monthBs && /^\d{4}-\d{2}$/.test(monthBs)),
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
    // Only pre-load employees already saved for this month — not the full staff list
    const saved = sheetQuery.data.rows
      .filter((r) => Boolean(r.salaryPaymentId))
      .map((r, i) => ({ ...r, sn: i + 1 }));
    setRows(saved);
    setEditingKey(null);
    setEntry(emptyEntryForm());
  }, [sheetQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.post("/accounting/salary-sheet/save", body)),
    onSuccess: async () => {
      toast.success("Salary sheet saved — payroll records updated");
      await sheetQuery.refetch();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

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
    const monthly = Number(entry.monthlySalaryNpr) || 0;
    const presentDays = Number(entry.presentDays) || 0;
    const absentDays = Number(entry.absentDays) || 0;
    const extraDuty = Number(entry.extraDuty) || 0;
    return calcLine({
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      extraDuty,
      workingDaysInMonth,
      extraAmountNpr: 0,
    });
  }, [entry, workingDaysInMonth]);

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
      presentDays: String(src.presentDays ?? 0),
      absentDays: String(src.absentDays ?? 0),
      extraDuty: String(src.extraDuty ?? 0),
      remarks: src.remarks ?? "",
      attendanceManualOverride: Boolean(src.attendanceManualOverride),
    });
  };

  const renumber = (list: EditableRow[]): EditableRow[] =>
    list.map((r, i) => ({ ...r, sn: i + 1 }));

  const addOrUpdateEntry = () => {
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
    const monthly = Number(entry.monthlySalaryNpr) || 0;
    if (monthly <= 0) {
      toast.error("Enter monthly salary");
      return;
    }
    const presentDays = Number(entry.presentDays) || 0;
    const absentDays = Number(entry.absentDays) || 0;
    const extraDuty = Number(entry.extraDuty) || 0;
    const calc = calcLine({
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      extraDuty,
      workingDaysInMonth,
      extraAmountNpr: 0,
    });
    const nextRow: EditableRow = {
      ...src,
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      extraDuty,
      ...calc,
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
    const key = employeeKeyOf(row);
    setEditingKey(key);
    setEntry({
      employeeType: row.employeeType,
      employeeKey: key,
      monthlySalaryNpr: String(row.monthlySalaryNpr ?? 0),
      presentDays: String(row.presentDays ?? 0),
      absentDays: String(row.absentDays ?? 0),
      extraDuty: String(row.extraDuty ?? 0),
      remarks: row.remarks ?? "",
      attendanceManualOverride: Boolean(row.attendanceManualOverride),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeRow = (row: EditableRow) => {
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

  const getSignatories = (): {
    accountantName: string;
    directorName: string;
    chairmanName: string;
  } | null => {
    if (!accountantName.trim() || !directorName.trim() || !chairmanName.trim()) {
      toast.error(
        "Enter Accountant, Director, and Chairman names in the signature section before printing or exporting.",
      );
      return null;
    }
    return {
      accountantName: accountantName.trim(),
      directorName: directorName.trim(),
      chairmanName: chairmanName.trim(),
    };
  };

  /** Sheet body only — used with html2pdf (no browser date/title headers). */
  const buildSheetBodyHtml = (sign: {
    accountantName: string;
    directorName: string;
    chairmanName: string;
  }) => {
    const bodyRows = rows
      .map(
        (r) => `
      <tr>
        <td class="c">${r.sn}</td>
        <td>${escapeHtml(r.employeeName)}</td>
        <td class="n">${formatCurrencyNpr(r.monthlySalaryNpr)}</td>
        <td class="c">${r.presentDays}</td>
        <td class="c">${r.absentDays}</td>
        <td class="c">${r.extraDuty}</td>
        <td class="n">${formatCurrencyNpr(r.absentDeductionNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.extraAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.salaryAmountNpr)}</td>
        <td class="n">${formatCurrencyNpr(r.tax1PercentNpr)}</td>
        <td class="n"><strong>${formatCurrencyNpr(r.netSalaryNpr)}</strong></td>
        <td></td>
        <td>${escapeHtml(r.remarks || "")}</td>
      </tr>`,
      )
      .join("");

    return `
<div class="salary-sheet-pdf" style="font-family: 'Times New Roman', Georgia, serif; font-size: 11px; color: #111; background: #fff; width: 100%; box-sizing: border-box;">
  <style>
    .salary-sheet-pdf .sheet-header { text-align: center; margin-bottom: 14px; border-bottom: 2px solid #111; padding-bottom: 10px; }
    .salary-sheet-pdf .sheet-header .college-name { font-size: 18px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; margin: 0 0 4px; }
    .salary-sheet-pdf .sheet-header .college-name-np { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
    .salary-sheet-pdf .sheet-header .college-address { font-size: 11px; margin: 0 0 8px; color: #222; }
    .salary-sheet-pdf .sheet-header .sheet-title { font-size: 14px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.04em; }
    .salary-sheet-pdf table { width: 100%; border-collapse: collapse; }
    .salary-sheet-pdf th, .salary-sheet-pdf td { border: 1px solid #222; padding: 4px 5px; vertical-align: middle; }
    .salary-sheet-pdf th { background: #f3f4f6; font-size: 10px; text-align: center; }
    .salary-sheet-pdf td.c { text-align: center; }
    .salary-sheet-pdf td.n { text-align: right; white-space: nowrap; }
    .salary-sheet-pdf tfoot td { font-weight: 700; background: #fafafa; }
    .salary-sheet-pdf .words { margin-top: 10px; font-size: 12px; }
    .salary-sheet-pdf .sign-row { display: flex; justify-content: space-between; margin-top: 36px; gap: 24px; }
    .salary-sheet-pdf .sign { flex: 1; text-align: center; }
    .salary-sheet-pdf .sign .line { border-top: 1px solid #222; margin: 40px 12px 6px; }
    .salary-sheet-pdf .sign .role { font-weight: 700; font-size: 11px; }
    .salary-sheet-pdf .sign .name { font-size: 11px; margin-top: 2px; }
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
  </div>
  <table>
    <thead>
      <tr>
        <th>S.N.</th>
        <th>Employee Name</th>
        <th>Monthly Salary</th>
        <th>Present Days</th>
        <th>Absent Days</th>
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
        <td colspan="3"></td>
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
  <div class="sign-row">
    <div class="sign">
      <div class="line"></div>
      <div class="role">Accountant</div>
      <div class="name">${escapeHtml(sign.accountantName)}</div>
    </div>
    <div class="sign">
      <div class="line"></div>
      <div class="role">Director</div>
      <div class="name">${escapeHtml(sign.directorName)}</div>
    </div>
    <div class="sign">
      <div class="line"></div>
      <div class="role">Chairman</div>
      <div class="name">${escapeHtml(sign.chairmanName)}</div>
    </div>
  </div>
</div>`;
  };

  const exportPdf = async () => {
    if (rows.length === 0) {
      toast.error("No salary rows to export — add at least one employee first");
      return;
    }
    const sign = getSignatories();
    if (!sign) return;

    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-12000px";
    host.style.top = "0";
    host.style.width = "1100px";
    host.style.background = "#ffffff";
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
            allowTaint: false,
            backgroundColor: "#ffffff",
            logging: false,
            windowWidth: 1100,
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

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success("PDF downloaded (no browser date header)");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "PDF generation failed");
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
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
        "Monthly Salary": r.monthlySalaryNpr,
        "Present Days": r.presentDays,
        "Absent Days": r.absentDays,
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
        "Monthly Salary": totals.totalMonthlySalaryNpr,
        "Present Days": "",
        "Absent Days": "",
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
        "Monthly Salary": totals.totalNetSalaryInWords,
        "Present Days": "",
        "Absent Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      },
      {
        "S.N.": "",
        "Employee Name": "Accountant",
        "Monthly Salary": sign.accountantName,
        "Present Days": "",
        "Absent Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      },
      {
        "S.N.": "",
        "Employee Name": "Director",
        "Monthly Salary": sign.directorName,
        "Present Days": "",
        "Absent Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      },
      {
        "S.N.": "",
        "Employee Name": "Chairman",
        "Monthly Salary": sign.chairmanName,
        "Present Days": "",
        "Absent Days": "",
        "Extra Duty": "",
        "Absent Deduction": "",
        "Extra Amount": "",
        "Salary Amount": "",
        "1% Tax": "",
        "Net Salary": "",
        Signature: "",
        Remarks: "",
      },
    ]);
    toast.success("Excel salary sheet exported");
  };

  const saveSheet = () => {
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
        presentDays: r.presentDays,
        absentDays: r.absentDays,
        extraDuty: r.extraDuty,
        extraAmountNpr: r.extraAmountNpr,
        remarks: r.remarks,
        attendanceManualOverride: r.attendanceManualOverride,
        salaryPaymentId: r.salaryPaymentId,
      })),
    });
  };

  if (!monthBs) {
    return (
      <EmptyState
        title="Select payroll month"
        description="Enter a BS month (YYYY-MM) to load the salary sheet."
      />
    );
  }

  if (sheetQuery.isLoading) return <LoadingState />;

  if (sheetQuery.isError) {
    return (
      <EmptyState
        title="Could not load salary sheet"
        description={parseErrorMessage(sheetQuery.error)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-brand-600" />
              Salary Sheet / Payroll
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Add employees <strong>one by one</strong>. Present/absent days load from
              attendance for the payroll month. The table only shows people you have
              already added — not the full staff list for mass entry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportPdf}
              disabled={rows.length === 0}
            >
              <Printer className="mr-1 h-4 w-4" />
              Download PDF
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportExcel}
              disabled={rows.length === 0}
            >
              <FileDown className="mr-1 h-4 w-4" />
              Excel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending || rows.length === 0}
              onClick={saveSheet}
            >
              <Save className="mr-1 h-4 w-4" />
              {saveMutation.isPending ? "Saving…" : "Save payroll"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Payroll month (BS) *">
              <Input
                placeholder="YYYY-MM e.g. 2082-01"
                value={monthBs}
                onChange={(e) => setMonthBs(e.target.value.trim())}
              />
            </FormField>
            <FormField label="Save status">
              <Select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "DRAFT" | "PROCESSED" | "PAID")
                }
              >
                <option value="DRAFT">Draft</option>
                <option value="PROCESSED">Processed</option>
                <option value="PAID">Paid</option>
              </Select>
            </FormField>
            <FormField label="Payment method">
              <Select
                value={paymentMethod}
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
            {status === "PAID" ? (
              <FormField label="Paid date (BS) *">
                <NepaliDateField value={paidDateBs} onChange={setPaidDateBs} />
              </FormField>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            Working days in month (BS): <strong>{workingDaysInMonth}</strong>
            {sheetQuery.data
              ? ` · Attendance days on register: ${sheetQuery.data.attendanceCoverageDays}`
              : ""}
            {" · "}
            {rows.length} on sheet · {availableCatalog.length} not yet added
          </p>
        </CardContent>
      </Card>

      {sheetQuery.data?.attendanceWarning ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Attendance notice</p>
            <p className="text-amber-900/90">{sheetQuery.data.attendanceWarning}</p>
            {canManualAttendance ? (
              <p className="mt-1 text-xs">
                As Super Admin / College Admin you may correct Present/Absent days when
                adding an employee.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ─── One-by-one entry ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-brand-600" />
            {editingKey ? "Edit employee on sheet" : "Add employee (one by one)"}
          </CardTitle>
          <p className="text-sm text-slate-500">
            Select one employee, review auto-filled attendance, adjust if needed, then
            add them to the salary sheet below.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
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
                    presentDays: "0",
                    absentDays: "0",
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
            <FormField label="Monthly salary (NPR) *">
              <NumberInput
                min={0}
                value={entry.monthlySalaryNpr}
                onChange={(e) =>
                  setEntry((f) => ({ ...f, monthlySalaryNpr: e.target.value }))
                }
              />
            </FormField>
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
            <FormField label="Extra duty (days)">
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
                    Attendance incomplete for this employee — verify days before adding
                  </Badge>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
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
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-brand-600" />
            Salary sheet — {monthBs}
          </CardTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Filter sheet by name">
              <Input
                placeholder="Search added employees…"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
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
          </div>
        </CardHeader>
        <CardContent>
          {/* On-screen header matching PDF */}
          <div className="mb-4 border-b-2 border-slate-800 pb-3 text-center">
            <p className="text-lg font-bold uppercase tracking-wide text-slate-900">
              {collegeName}
            </p>
            {collegeNameNp ? (
              <p className="text-base font-semibold text-slate-800">
                {collegeNameNp}
              </p>
            ) : null}
            {collegeAddress ? (
              <p className="mt-1 text-sm text-slate-600">{collegeAddress}</p>
            ) : null}
            <p className="mt-2 text-base font-bold uppercase tracking-wide text-slate-900">
              Salary Sheet of {monthLabel}
            </p>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No employees on the sheet yet"
              description="Use “Add employee (one by one)” above. The table only lists people you add — not the full staff roster."
            />
          ) : displayedRows.length === 0 ? (
            <EmptyState
              title="No matches"
              description="No added employees match the sheet filters."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHead>
                  <tr className="bg-slate-50 text-xs">
                    <Th className="w-12 text-center">S.N.</Th>
                    <Th>Employee Name</Th>
                    <Th className="text-right">Monthly Salary</Th>
                    <Th className="text-center">Present Days</Th>
                    <Th className="text-center">Absent Days</Th>
                    <Th className="text-center">Extra Duty</Th>
                    <Th className="text-right">Absent Deduction</Th>
                    <Th className="text-right">Extra Amount</Th>
                    <Th className="text-right">Salary Amount</Th>
                    <Th className="text-right">1% Tax</Th>
                    <Th className="text-right">Net Salary</Th>
                    <Th className="text-center">Signature</Th>
                    <Th>Remarks</Th>
                    <Th>Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {displayedRows.map((row) => (
                    <tr
                      key={`${row.employeeType}-${row.teacherId || row.staffId}`}
                      className={
                        row.attendanceIncomplete ? "bg-amber-50/40" : undefined
                      }
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
                        {row.attendanceIncomplete ? (
                          <Badge className="mt-1 bg-amber-100 text-amber-900">
                            Attendance incomplete
                          </Badge>
                        ) : null}
                        {row.attendanceManualOverride ? (
                          <Badge className="mt-1 bg-sky-100 text-sky-900">
                            Manual attendance
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatCurrencyNpr(row.monthlySalaryNpr)}
                      </Td>
                      <Td className="text-center tabular-nums">{row.presentDays}</Td>
                      <Td className="text-center tabular-nums">{row.absentDays}</Td>
                      <Td className="text-center tabular-nums">{row.extraDuty}</Td>
                      <Td className="text-right tabular-nums text-rose-700">
                        {formatCurrencyNpr(row.absentDeductionNpr)}
                      </Td>
                      <Td className="text-right tabular-nums text-emerald-700">
                        {formatCurrencyNpr(row.extraAmountNpr)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatCurrencyNpr(row.salaryAmountNpr)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatCurrencyNpr(row.tax1PercentNpr)}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold text-slate-900">
                        {formatCurrencyNpr(row.netSalaryNpr)}
                      </Td>
                      <Td className="min-w-[4rem] border-b border-dashed border-slate-300" />
                      <Td className="max-w-[10rem] truncate text-sm text-slate-600">
                        {row.remarks || "—"}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
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
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <Td colSpan={2} className="text-center">
                      TOTAL ({rows.length})
                    </Td>
                    <Td className="text-right">
                      {formatCurrencyNpr(totals.totalMonthlySalaryNpr)}
                    </Td>
                    <Td colSpan={3} />
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
                    <Td colSpan={3} />
                  </tr>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                className={`rounded-xl border px-4 py-3 ${
                  item.emphasize
                    ? "border-brand-200 bg-brand-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-xs text-slate-500">{item.label}</p>
                <p
                  className={`text-lg font-semibold ${
                    item.emphasize ? "text-brand-900" : "text-slate-900"
                  }`}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
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

          {/* Signature names — required before Print/PDF or Excel */}
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-slate-800">
              Signature names (required for PDF and Excel)
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Accountant *">
                <Input
                  value={accountantName}
                  onChange={(e) => setAccountantName(e.target.value)}
                  placeholder="Full name"
                />
              </FormField>
              <FormField label="Director *">
                <Input
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Full name"
                />
              </FormField>
              <FormField label="Chairman *">
                <Input
                  value={chairmanName}
                  onChange={(e) => setChairmanName(e.target.value)}
                  placeholder="Full name"
                />
              </FormField>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {(
                [
                  ["Accountant", accountantName],
                  ["Director", directorName],
                  ["Chairman", chairmanName],
                ] as const
              ).map(([role, name]) => (
                <div key={role} className="text-center">
                  <div className="mx-8 mb-2 border-t border-slate-400 pt-2" />
                  <p className="text-sm font-semibold text-slate-800">{role}</p>
                  <p className="text-xs text-slate-600">
                    {name.trim() || "—"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={exportPdf}
                disabled={rows.length === 0}
              >
                <Printer className="mr-1 h-4 w-4" />
                Download PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={exportExcel}
                disabled={rows.length === 0}
              >
                <FileDown className="mr-1 h-4 w-4" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
