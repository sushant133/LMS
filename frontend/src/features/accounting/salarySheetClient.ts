/**
 * Client-side salary sheet builder used when GET /accounting/salary-sheet is
 * unavailable (e.g. production not yet redeployed). Uses existing salaries +
 * employees + employee-attendance APIs.
 */
import type {
  SalaryPaymentRecord,
  SalarySheetResponse,
  SalarySheetRow,
} from "@phit-erp/shared";
import { formatNrsAmountInWords } from "@phit-erp/shared";
import { api, unwrap } from "lib/api";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Approximate BS month length when server helper is unavailable (28–32). */
const daysInBsMonthApprox = (monthBs: string): number => {
  const parts = monthBs.split("-").map(Number);
  const m = parts[1] ?? 1;
  // Common Bikram Sambat lengths (approx; server uses exact tables when available)
  const lengths = [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 30];
  return lengths[Math.max(0, Math.min(11, m - 1))] ?? 30;
};

const calcLine = (
  monthly: number,
  absentDays: number,
  extraDuty: number,
  workingDays: number,
) => {
  const days = Math.max(1, workingDays);
  const perDay = Math.max(0, monthly) / days;
  const absentDeductionNpr = round2(perDay * Math.max(0, absentDays));
  const extraAmountNpr = round2(perDay * Math.max(0, extraDuty));
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

type AttendanceBucket = { present: number; absent: number; recorded: number };

const emptyBucket = (): AttendanceBucket => ({
  present: 0,
  absent: 0,
  recorded: 0,
});

const applyStatus = (b: AttendanceBucket, status: string) => {
  b.recorded += 1;
  switch (status) {
    case "PRESENT":
    case "LATE":
    case "OFFICIAL_DUTY":
      b.present += 1;
      break;
    case "HALF_DAY":
      b.present += 0.5;
      b.absent += 0.5;
      break;
    case "ABSENT":
    case "LEAVE":
      b.absent += 1;
      break;
    default:
      break;
  }
};

type SalaryEmployeesResponse = {
  teachers: Array<{
    _id: string;
    basicSalaryNpr?: number;
    teacherCode?: string;
    designation?: string;
    user?: { fullName?: string; designation?: string };
  }>;
  collegeStaff: Array<{
    _id: string;
    fullName: string;
    staffId?: string;
    department?: string;
    designation?: string;
    basicSalaryNpr?: number;
  }>;
};

type AttendanceListRow = {
  dateBs?: string;
  entries?: Array<{
    teacherId?: string;
    staffId?: string;
    status?: string;
  }>;
};

const lastDayOfMonthBs = (monthBs: string, workingDays: number): string => {
  const [y, m] = monthBs.split("-");
  return `${y}-${m}-${String(workingDays).padStart(2, "0")}`;
};

/**
 * Build a full salary sheet without the dedicated /salary-sheet endpoint.
 */
export const fetchSalarySheetClientFallback = async (
  monthBs: string,
): Promise<SalarySheetResponse> => {
  const workingDaysInMonth = daysInBsMonthApprox(monthBs);
  const fromDateBs = `${monthBs}-01`;
  const toDateBs = lastDayOfMonthBs(monthBs, workingDaysInMonth);

  const [employees, salaries, teacherAtt, staffAtt] = await Promise.all([
    unwrap<SalaryEmployeesResponse>(api.get("/accounting/salary-employees")),
    unwrap<SalaryPaymentRecord[]>(api.get("/accounting/salaries")),
    unwrap<AttendanceListRow[]>(
      api.get("/employee-attendance", {
        params: {
          category: "TEACHER",
          fromDateBs,
          toDateBs,
        },
      }),
    ).catch(() => [] as AttendanceListRow[]),
    unwrap<AttendanceListRow[]>(
      api.get("/employee-attendance", {
        params: {
          category: "STAFF",
          fromDateBs,
          toDateBs,
        },
      }),
    ).catch(() => [] as AttendanceListRow[]),
  ]);

  const byTeacher = new Map<string, AttendanceBucket>();
  const byStaff = new Map<string, AttendanceBucket>();
  const dateSet = new Set<string>();

  for (const sheet of [...(teacherAtt ?? []), ...(staffAtt ?? [])]) {
    if (sheet.dateBs && String(sheet.dateBs).startsWith(monthBs)) {
      dateSet.add(String(sheet.dateBs));
    }
    for (const e of sheet.entries ?? []) {
      if (!String(sheet.dateBs || "").startsWith(monthBs)) continue;
      const status = String(e.status || "");
      if (e.teacherId) {
        const key = String(e.teacherId);
        const b = byTeacher.get(key) ?? emptyBucket();
        applyStatus(b, status);
        byTeacher.set(key, b);
      }
      if (e.staffId) {
        const key = String(e.staffId);
        const b = byStaff.get(key) ?? emptyBucket();
        applyStatus(b, status);
        byStaff.set(key, b);
      }
    }
  }

  const monthSalaries = (salaries ?? []).filter(
    (s) => s.monthBs === monthBs || String(s.monthBs).startsWith(monthBs),
  );
  const salaryByTeacher = new Map(
    monthSalaries
      .filter((s) => s.teacherId)
      .map((s) => [String(s.teacherId), s] as const),
  );
  const salaryByStaff = new Map(
    monthSalaries
      .filter((s) => s.staffId)
      .map((s) => [String(s.staffId), s] as const),
  );

  const drafts: Omit<SalarySheetRow, "sn">[] = [];

  for (const t of employees.teachers ?? []) {
    const id = String(t._id);
    const saved = salaryByTeacher.get(id);
    const att = byTeacher.get(id);
    const incomplete = !att || att.recorded === 0;
    const manual = Boolean(saved?.attendanceManualOverride);
    const monthly = Number(
      saved?.basicSalaryNpr ?? t.basicSalaryNpr ?? 0,
    );
    const presentDays = manual
      ? Number(saved?.presentDays ?? 0)
      : incomplete
        ? Number(saved?.presentDays ?? 0)
        : Number(att?.present ?? 0);
    const absentDays = manual
      ? Number(saved?.absentDays ?? 0)
      : incomplete
        ? Number(saved?.absentDays ?? 0)
        : Number(att?.absent ?? 0);
    const extraDuty = Number(saved?.extraDuty ?? 0);
    const calc = calcLine(monthly, absentDays, extraDuty, workingDaysInMonth);
    drafts.push({
      employeeType: "TEACHER",
      teacherId: id,
      employeeName: t.user?.fullName?.trim() || "—",
      department: "Teaching",
      designation: t.user?.designation || t.designation || "",
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      extraDuty,
      ...calc,
      remarks: String(saved?.notes ?? ""),
      attendanceIncomplete: incomplete && !manual,
      attendanceManualOverride: manual,
      valuesManualOverride: Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride,
      ),
      attendanceDaysRecorded: att?.recorded ?? 0,
      workingDaysInMonth,
      salaryPaymentId: saved?._id,
      status: saved?.status,
    });
  }

  for (const s of employees.collegeStaff ?? []) {
    const id = String(s._id);
    const saved = salaryByStaff.get(id);
    const att = byStaff.get(id);
    const incomplete = !att || att.recorded === 0;
    const manual = Boolean(saved?.attendanceManualOverride);
    const monthly = Number(
      saved?.basicSalaryNpr ?? s.basicSalaryNpr ?? 0,
    );
    const presentDays = manual
      ? Number(saved?.presentDays ?? 0)
      : incomplete
        ? Number(saved?.presentDays ?? 0)
        : Number(att?.present ?? 0);
    const absentDays = manual
      ? Number(saved?.absentDays ?? 0)
      : incomplete
        ? Number(saved?.absentDays ?? 0)
        : Number(att?.absent ?? 0);
    const extraDuty = Number(saved?.extraDuty ?? 0);
    const calc = calcLine(monthly, absentDays, extraDuty, workingDaysInMonth);
    drafts.push({
      employeeType: "STAFF",
      staffId: id,
      employeeName: s.fullName?.trim() || "—",
      department: s.department || "",
      designation: s.designation || "",
      monthlySalaryNpr: monthly,
      presentDays,
      absentDays,
      extraDuty,
      ...calc,
      remarks: String(saved?.notes ?? ""),
      attendanceIncomplete: incomplete && !manual,
      attendanceManualOverride: manual,
      valuesManualOverride: Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride,
      ),
      attendanceDaysRecorded: att?.recorded ?? 0,
      workingDaysInMonth,
      salaryPaymentId: saved?._id,
      status: saved?.status,
    });
  }

  drafts.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const rows: SalarySheetRow[] = drafts.map((d, i) => ({ ...d, sn: i + 1 }));

  const totals = {
    totalMonthlySalaryNpr: round2(
      rows.reduce((s, r) => s + r.monthlySalaryNpr, 0),
    ),
    totalAbsentDeductionNpr: round2(
      rows.reduce((s, r) => s + r.absentDeductionNpr, 0),
    ),
    totalExtraAmountNpr: round2(
      rows.reduce((s, r) => s + r.extraAmountNpr, 0),
    ),
    totalSalaryAmountNpr: round2(
      rows.reduce((s, r) => s + r.salaryAmountNpr, 0),
    ),
    totalTax1PercentNpr: round2(
      rows.reduce((s, r) => s + r.tax1PercentNpr, 0),
    ),
    totalNetSalaryNpr: round2(rows.reduce((s, r) => s + r.netSalaryNpr, 0)),
    totalNetSalaryInWords: formatNrsAmountInWords(
      rows.reduce((s, r) => s + r.netSalaryNpr, 0),
    ),
  };

  const coverageDays = dateSet.size;
  const anyIncomplete = rows.some((r) => r.attendanceIncomplete);

  return {
    monthBs,
    workingDaysInMonth,
    attendanceCoverageDays: coverageDays,
    attendanceIncomplete: anyIncomplete || coverageDays === 0,
    attendanceWarning:
      coverageDays === 0
        ? `No staff/teacher attendance records found for ${monthBs}. Present/absent days are empty — authorized users may enter them manually.`
        : anyIncomplete
          ? `Attendance is incomplete for some employees in ${monthBs}.`
          : undefined,
    rows,
    totals,
  };
};

/**
 * Fetch salary sheet: prefer dedicated API, fall back to client build on 404.
 */
export const fetchSalarySheet = async (
  monthBs: string,
): Promise<SalarySheetResponse & { usedFallback?: boolean }> => {
  try {
    const data = await unwrap<SalarySheetResponse>(
      api.get("/accounting/salary-sheet", { params: { monthBs } }),
    );
    return data;
  } catch (error: unknown) {
    const status =
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response
        ? Number((error.response as { status: number }).status)
        : 0;
    if (status === 404) {
      const fallback = await fetchSalarySheetClientFallback(monthBs);
      return { ...fallback, usedFallback: true };
    }
    throw error;
  }
};

type SaveRow = {
  employeeType: "TEACHER" | "STAFF";
  teacherId?: string;
  staffId?: string;
  employeeName?: string;
  monthlySalaryNpr: number;
  presentDays: number;
  absentDays: number;
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
};

/**
 * Save payroll rows: prefer bulk API, fall back to per-employee create/update.
 */
export const saveSalarySheetClient = async (payload: {
  monthBs: string;
  status: "DRAFT" | "PROCESSED" | "PAID";
  paidDateBs?: string;
  paymentMethod: string;
  rows: SaveRow[];
}): Promise<void> => {
  try {
    await unwrap(api.post("/accounting/salary-sheet/save", payload));
    return;
  } catch (error: unknown) {
    const status =
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response
        ? Number((error.response as { status: number }).status)
        : 0;
    if (status !== 404) throw error;
  }

  // Fallback: one salary record per employee via existing endpoints
  for (const row of payload.rows) {
    const body = {
      employeeType: row.employeeType,
      teacherId: row.employeeType === "TEACHER" ? row.teacherId : undefined,
      staffId: row.employeeType === "STAFF" ? row.staffId : undefined,
      staffName: row.employeeName ?? "",
      monthBs: payload.monthBs,
      basicSalaryNpr: row.monthlySalaryNpr,
      allowancesNpr: 0,
      bonusNpr: 0,
      advanceSalaryNpr: 0,
      loanDeductionNpr: 0,
      otherDeductionsNpr: 0,
      presentDays: row.presentDays,
      absentDays: row.absentDays,
      extraDuty: row.extraDuty,
      extraAmountNpr: row.extraAmountNpr ?? 0,
      absentDeductionNpr: row.absentDeductionNpr ?? 0,
      salaryAmountNpr: row.salaryAmountNpr ?? 0,
      taxNpr: 0, // may recompute below
      attendanceManualOverride: Boolean(row.attendanceManualOverride),
      valuesManualOverride: Boolean(row.valuesManualOverride),
      notes: row.remarks ?? "",
      status: payload.status,
      paidDateBs: payload.paidDateBs || undefined,
      paymentMethod: payload.paymentMethod,
    };

    // Recompute tax/net client-side for older API that uses calculateNetSalary
    const workingDays = daysInBsMonthApprox(payload.monthBs);
    const calc = row.valuesManualOverride
      ? {
          absentDeductionNpr: Number(row.absentDeductionNpr ?? 0),
          extraAmountNpr: Number(row.extraAmountNpr ?? 0),
          salaryAmountNpr: Number(row.salaryAmountNpr ?? 0),
          tax1PercentNpr: Number(row.tax1PercentNpr ?? 0),
          netSalaryNpr: Number(row.netSalaryNpr ?? 0),
        }
      : calcLine(
          row.monthlySalaryNpr,
          row.absentDays,
          row.extraDuty,
          workingDays,
        );
    // Map sheet formula into fields the old endpoint understands
    (body as { taxNpr: number }).taxNpr = calc.tax1PercentNpr;
    // Put net into bonus=0 and use tax only; old net = basic + allow + bonus - advance - loan - tax - other
    // For approximate net we set basic = salaryAmount and tax = tax1%
    (body as { basicSalaryNpr: number }).basicSalaryNpr = calc.salaryAmountNpr;

    if (row.salaryPaymentId) {
      await unwrap(api.put(`/accounting/salaries/${row.salaryPaymentId}`, body));
    } else {
      try {
        await unwrap(api.post("/accounting/salaries", body));
      } catch (e: unknown) {
        // Duplicate month — try to find and update
        const status =
          e &&
          typeof e === "object" &&
          "response" in e &&
          e.response &&
          typeof e.response === "object" &&
          "status" in e.response
            ? Number((e.response as { status: number }).status)
            : 0;
        if (status !== 409) throw e;
        const all = await unwrap<SalaryPaymentRecord[]>(
          api.get("/accounting/salaries"),
        );
        const existing = all.find(
          (s) =>
            s.monthBs === payload.monthBs &&
            ((row.teacherId && s.teacherId === row.teacherId) ||
              (row.staffId && s.staffId === row.staffId)),
        );
        if (existing) {
          await unwrap(api.put(`/accounting/salaries/${existing._id}`, body));
        } else {
          throw e;
        }
      }
    }
  }
};
