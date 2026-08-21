/**
 * Client-side salary sheet builder used when GET /accounting/salary-sheet is
 * unavailable (e.g. production not yet redeployed). Uses existing salaries +
 * employees + employee-attendance APIs.
 */
import type {
  SalaryPaymentRecord,
  SalarySheetMonthSummary,
  SalarySheetResponse,
  SalarySheetRow,
} from "@phit-erp/shared";
import { formatNrsAmountInWords, HOLIDAY_EVENT_TYPES } from "@phit-erp/shared";
import { getDaysInBsMonth } from "@munatech/nepali-datepicker";
import { isSaturdayBs } from "features/academic-calendar/academicCalendarUtils";
import { api, unwrap } from "lib/api";

const holidayEventTypes = HOLIDAY_EVENT_TYPES as readonly string[];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Exact BS month length (28–32). */
const daysInBsMonth = (monthBs: string): number => {
  const [y, m] = monthBs.split("-").map(Number);
  if (!y || !m) return 30;
  try {
    return getDaysInBsMonth(y, m) || 30;
  } catch {
    return 30;
  }
};

type CalendarEventRow = {
  dateBs?: string;
  startDateBs?: string;
  endDateBs?: string;
  eventType?: string;
  isHoliday?: boolean;
  isWorkingDayOverride?: boolean;
  status?: string;
};

type MonthHolidayBreakdown = {
  holidayDates: Set<string>;
  saturdayDates: Set<string>;
  otherHolidayDates: Set<string>;
};

/**
 * Holiday dates in a BS month — mirrors the server's resolveMonthHolidayDates:
 * a WORKING_DAY override wins, then stored holiday events, then Saturdays,
 * then legacy settings holidays. Saturdays are kept disjoint from other holidays.
 */
const resolveMonthHolidays = async (
  monthBs: string,
  calendarDays: number,
): Promise<MonthHolidayBreakdown> => {
  const dateOf = (day: number) =>
    `${monthBs}-${String(day).padStart(2, "0")}`;

  const [events, settings] = await Promise.all([
    unwrap<CalendarEventRow[]>(
      api.get("/academic-calendar/events", { params: { monthBs } }),
    ).catch(() => [] as CalendarEventRow[]),
    unwrap<{ holidays?: Array<{ dateBs?: string }> }>(api.get("/settings")).catch(
      () => null,
    ),
  ]);

  const overrides = new Set<string>();
  const eventHolidays = new Set<string>();
  for (const event of events ?? []) {
    if (String(event.status || "") === "INACTIVE") continue;
    const start = event.startDateBs || event.dateBs || "";
    const end = event.endDateBs || event.dateBs || start;
    if (!start) continue;
    const isOverride =
      event.eventType === "WORKING_DAY" || Boolean(event.isWorkingDayOverride);
    const isHoliday =
      !isOverride &&
      (Boolean(event.isHoliday) ||
        holidayEventTypes.includes(String(event.eventType || "")));
    if (!isOverride && !isHoliday) continue;
    for (let day = 1; day <= calendarDays; day += 1) {
      const dateBs = dateOf(day);
      if (dateBs < start || dateBs > end) continue;
      if (isOverride) overrides.add(dateBs);
      else eventHolidays.add(dateBs);
    }
  }

  const legacyHolidays = new Set(
    (settings?.holidays ?? [])
      .map((item) => String(item.dateBs || ""))
      .filter((dateBs) => dateBs.startsWith(monthBs)),
  );

  const saturdayDates = new Set<string>();
  const otherHolidayDates = new Set<string>();
  const holidayDates = new Set<string>();
  for (let day = 1; day <= calendarDays; day += 1) {
    const dateBs = dateOf(day);
    if (overrides.has(dateBs)) continue;
    let saturday = false;
    try {
      saturday = isSaturdayBs(dateBs);
    } catch {
      saturday = false;
    }
    const other =
      eventHolidays.has(dateBs) || legacyHolidays.has(dateBs);
    if (saturday) {
      saturdayDates.add(dateBs);
      holidayDates.add(dateBs);
    } else if (other) {
      otherHolidayDates.add(dateBs);
      holidayDates.add(dateBs);
    }
  }
  return { holidayDates, saturdayDates, otherHolidayDates };
};

const paidPresentDays = (
  workingDays: number,
  absentDays: number,
  leaveDays: number,
) => {
  const days = Math.max(1, workingDays);
  const deducted =
    Math.max(0, absentDays) + Math.max(0, leaveDays);
  return round2(Math.max(0, days - Math.min(deducted, days)));
};

const calcLine = (
  monthly: number,
  absentDays: number,
  leaveDays: number,
  extraDuty: number,
  workingDays: number,
) => {
  const days = Math.max(1, workingDays);
  const deducted = Math.min(
    Math.max(0, absentDays) + Math.max(0, leaveDays),
    days,
  );
  const perDay = Math.max(0, monthly) / days;
  const absentDeductionNpr = round2(perDay * deducted);
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

type AttendanceBucket = {
  present: number;
  absent: number;
  leave: number;
  recorded: number;
};

const emptyBucket = (): AttendanceBucket => ({
  present: 0,
  absent: 0,
  leave: 0,
  recorded: 0,
});

const applyStatus = (b: AttendanceBucket, status: string) => {
  b.recorded += 1;
  switch (status) {
    case "PRESENT":
    case "LATE":
    case "OFFICIAL_DUTY":
    case "HOLIDAY":
      b.present += 1;
      break;
    case "HALF_DAY":
      b.present += 0.5;
      b.absent += 0.5;
      break;
    case "ABSENT":
      b.absent += 1;
      break;
    case "LEAVE":
      b.leave += 1;
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
  const calendarDaysInMonth = daysInBsMonth(monthBs);
  const { holidayDates, saturdayDates, otherHolidayDates } =
    await resolveMonthHolidays(monthBs, calendarDaysInMonth);
  // Working days = month length minus Saturdays / holidays. This is the
  // per-day salary divisor, so it must match the server exactly.
  const workingDaysInMonth = Math.max(
    1,
    calendarDaysInMonth - holidayDates.size,
  );
  const fromDateBs = `${monthBs}-01`;
  const toDateBs = lastDayOfMonthBs(monthBs, calendarDaysInMonth);

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
  const teacherDateSet = new Set<string>();
  const staffDateSet = new Set<string>();

  for (const [category, sheet] of [
    ...(teacherAtt ?? []).map((x) => ["TEACHER", x] as const),
    ...(staffAtt ?? []).map((x) => ["STAFF", x] as const),
  ]) {
    // An empty day sheet is not coverage — it would inflate the expected-days
    // baseline and hide employees genuinely missing from the register.
    const inMonth =
      Boolean(sheet.dateBs) &&
      String(sheet.dateBs).startsWith(monthBs) &&
      // A holiday is nobody's working day: registers opened on a Saturday must
      // never deduct pay or count towards coverage.
      !holidayDates.has(String(sheet.dateBs));
    if (inMonth && (sheet.entries?.length ?? 0) > 0) {
      dateSet.add(String(sheet.dateBs));
      if (category === "TEACHER") teacherDateSet.add(String(sheet.dateBs));
      else staffDateSet.add(String(sheet.dateBs));
    }
    for (const e of sheet.entries ?? []) {
      if (!inMonth) continue;
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

  const monthSalaries = (salaries ?? []).filter((s) => {
    const m = String(s.monthBs || "").trim();
    return m === monthBs || m.startsWith(monthBs);
  });
  const idKey = (v: unknown) => {
    if (v == null) return "";
    if (typeof v === "object" && v !== null && "_id" in v) {
      return String((v as { _id: unknown })._id);
    }
    return String(v);
  };
  const salaryByTeacher = new Map(
    monthSalaries
      .filter((s) => s.teacherId)
      .map((s) => [idKey(s.teacherId), s] as const),
  );
  const salaryByStaff = new Map(
    monthSalaries
      .filter((s) => s.staffId)
      .map((s) => [idKey(s.staffId), s] as const),
  );

  const drafts: Omit<SalarySheetRow, "sn">[] = [];

  const settleDays = (
    att: AttendanceBucket | undefined,
    saved: SalaryPaymentRecord | undefined,
  ) => {
    const daysRecorded = att?.recorded ?? 0;
    const noAttendance = daysRecorded === 0;
    const manual = Boolean(saved?.attendanceManualOverride);
    const savedPresent = Number(saved?.presentDays ?? 0);
    const savedAbsent = Number(saved?.absentDays ?? 0);
    const savedLeave = Number(saved?.leaveDays ?? 0);
    const hasSavedDays =
      savedPresent > 0 || savedAbsent > 0 || savedLeave > 0;
    if (manual || (noAttendance && hasSavedDays)) {
      return {
        presentDays: savedPresent,
        absentDays: savedAbsent,
        leaveDays: savedLeave,
        unrecordedDays: Math.max(0, workingDaysInMonth - daysRecorded),
        daysRecorded,
        noAttendance,
        manual,
      };
    }
    if (noAttendance) {
      return {
        presentDays: paidPresentDays(workingDaysInMonth, 0, 0),
        absentDays: 0,
        leaveDays: 0,
        unrecordedDays: workingDaysInMonth,
        daysRecorded: 0,
        noAttendance: true,
        manual: false,
      };
    }
    const absentDays = Number(att?.absent ?? 0);
    const leaveDays = Number(att?.leave ?? 0);
    return {
      presentDays: paidPresentDays(workingDaysInMonth, absentDays, leaveDays),
      absentDays,
      leaveDays,
      unrecordedDays: Math.max(0, workingDaysInMonth - daysRecorded),
      daysRecorded,
      noAttendance: false,
      manual: false,
    };
  };

  for (const t of employees.teachers ?? []) {
    const id = String(t._id);
    const saved = salaryByTeacher.get(id);
    const settled = settleDays(byTeacher.get(id), saved);
    const expectedDays = teacherDateSet.size;
    const incomplete =
      settled.noAttendance || settled.daysRecorded < expectedDays;
    const monthly = Number(
      saved?.basicSalaryNpr ?? t.basicSalaryNpr ?? 0,
    );
    const extraDuty = Number(saved?.extraDuty ?? 0);
    const calc = calcLine(
      monthly,
      settled.absentDays,
      settled.leaveDays,
      extraDuty,
      workingDaysInMonth,
    );
    drafts.push({
      employeeType: "TEACHER",
      teacherId: id,
      employeeName: t.user?.fullName?.trim() || "—",
      department: "Teaching",
      designation: t.user?.designation || t.designation || "",
      monthlySalaryNpr: monthly,
      presentDays: settled.presentDays,
      absentDays: settled.absentDays,
      leaveDays: settled.leaveDays,
      extraDuty,
      ...calc,
      remarks: String(saved?.notes ?? ""),
      attendanceIncomplete: incomplete && !settled.manual,
      attendanceManualOverride: settled.manual,
      valuesManualOverride: Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride,
      ),
      attendanceDaysRecorded: settled.daysRecorded,
      attendanceExpectedDays: expectedDays,
      unrecordedDays: settled.unrecordedDays,
      workingDaysInMonth,
      salaryPaymentId: saved?._id ? String(saved._id) : undefined,
      status: saved?.status,
    });
  }

  for (const s of employees.collegeStaff ?? []) {
    const id = String(s._id);
    const saved = salaryByStaff.get(id);
    const settled = settleDays(byStaff.get(id), saved);
    const expectedDays = staffDateSet.size;
    const incomplete =
      settled.noAttendance || settled.daysRecorded < expectedDays;
    const monthly = Number(
      saved?.basicSalaryNpr ?? s.basicSalaryNpr ?? 0,
    );
    const extraDuty = Number(saved?.extraDuty ?? 0);
    const calc = calcLine(
      monthly,
      settled.absentDays,
      settled.leaveDays,
      extraDuty,
      workingDaysInMonth,
    );
    drafts.push({
      employeeType: "STAFF",
      staffId: id,
      employeeName: s.fullName?.trim() || "—",
      department: s.department || "",
      designation: s.designation || "",
      monthlySalaryNpr: monthly,
      presentDays: settled.presentDays,
      absentDays: settled.absentDays,
      leaveDays: settled.leaveDays,
      extraDuty,
      ...calc,
      remarks: String(saved?.notes ?? ""),
      attendanceIncomplete: incomplete && !settled.manual,
      attendanceManualOverride: settled.manual,
      valuesManualOverride: Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride,
      ),
      attendanceDaysRecorded: settled.daysRecorded,
      attendanceExpectedDays: expectedDays,
      unrecordedDays: settled.unrecordedDays,
      workingDaysInMonth,
      salaryPaymentId: saved?._id ? String(saved._id) : undefined,
      status: saved?.status,
    });
  }

  // Orphan saved payments not on active employee lists
  const coveredT = new Set(
    drafts.filter((d) => d.teacherId).map((d) => String(d.teacherId)),
  );
  const coveredS = new Set(
    drafts.filter((d) => d.staffId).map((d) => String(d.staffId)),
  );
  for (const s of monthSalaries) {
    const tid = idKey(s.teacherId);
    const sid = idKey(s.staffId);
    if (tid && !coveredT.has(tid)) {
      const calc = calcLine(
        Number(s.basicSalaryNpr ?? 0),
        Number(s.absentDays ?? 0),
        Number(s.leaveDays ?? 0),
        Number(s.extraDuty ?? 0),
        workingDaysInMonth,
      );
      drafts.push({
        employeeType: "TEACHER",
        teacherId: tid,
        employeeName: String(s.staffName || "").trim() || "Teacher (saved)",
        department: "Teaching",
        designation: "",
        monthlySalaryNpr: Number(s.basicSalaryNpr ?? 0),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        leaveDays: Number(s.leaveDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        absentDeductionNpr: Number(s.absentDeductionNpr ?? calc.absentDeductionNpr),
        extraAmountNpr: Number(s.extraAmountNpr ?? calc.extraAmountNpr),
        salaryAmountNpr: Number(s.salaryAmountNpr ?? calc.salaryAmountNpr),
        tax1PercentNpr: Number(s.taxNpr ?? calc.tax1PercentNpr),
        netSalaryNpr: Number(s.netSalaryNpr ?? calc.netSalaryNpr),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: Boolean(s.attendanceManualOverride),
        valuesManualOverride: true,
        attendanceDaysRecorded: 0,
        workingDaysInMonth,
        salaryPaymentId: String(s._id),
        status: s.status,
      });
      coveredT.add(tid);
    }
    if (sid && !coveredS.has(sid)) {
      const calc = calcLine(
        Number(s.basicSalaryNpr ?? 0),
        Number(s.absentDays ?? 0),
        Number(s.leaveDays ?? 0),
        Number(s.extraDuty ?? 0),
        workingDaysInMonth,
      );
      drafts.push({
        employeeType: "STAFF",
        staffId: sid,
        employeeName: String(s.staffName || "").trim() || "Staff (saved)",
        department: "",
        designation: "",
        monthlySalaryNpr: Number(s.basicSalaryNpr ?? 0),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        leaveDays: Number(s.leaveDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        absentDeductionNpr: Number(s.absentDeductionNpr ?? calc.absentDeductionNpr),
        extraAmountNpr: Number(s.extraAmountNpr ?? calc.extraAmountNpr),
        salaryAmountNpr: Number(s.salaryAmountNpr ?? calc.salaryAmountNpr),
        tax1PercentNpr: Number(s.taxNpr ?? calc.tax1PercentNpr),
        netSalaryNpr: Number(s.netSalaryNpr ?? calc.netSalaryNpr),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: Boolean(s.attendanceManualOverride),
        valuesManualOverride: true,
        attendanceDaysRecorded: 0,
        workingDaysInMonth,
        salaryPaymentId: String(s._id),
        status: s.status,
      });
      coveredS.add(sid);
    }
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
  const incompleteCount = rows.filter((r) => r.attendanceIncomplete).length;

  return {
    monthBs,
    workingDaysInMonth,
    calendarDaysInMonth,
    saturdayDaysInMonth: saturdayDates.size,
    otherHolidayDaysInMonth: otherHolidayDates.size,
    holidayDaysInMonth: holidayDates.size,
    attendanceCoverageDays: coverageDays,
    attendanceCoverageDaysTeacher: teacherDateSet.size,
    attendanceCoverageDaysStaff: staffDateSet.size,
    attendanceIncomplete: anyIncomplete || coverageDays === 0,
    attendanceWarning:
      coverageDays === 0
        ? `No staff/teacher attendance records found for ${monthBs}. Every working day is paid as present — authorized users may enter absences and leaves manually.`
        : anyIncomplete
          ? `Attendance is incomplete for ${incompleteCount} of ${rows.length} employee(s) in ${monthBs}. ` +
            `${monthBs} has ${calendarDaysInMonth} calendar days − ${saturdayDates.size} Saturday(s) − ${otherHolidayDates.size} other holiday(s) = ${workingDaysInMonth} working days; ` +
            `registers were taken on ${teacherDateSet.size} teacher day(s) and ${staffDateSet.size} staff day(s). ` +
            `Leave and absence deduct per working day. Saturdays and calendar holidays are excluded from working days. ` +
            `Working days with no attendance record are paid as present — review the flagged rows before submitting.`
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

const httpStatus = (error: unknown): number => {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "status" in error.response
  ) {
    return Number((error.response as { status: number }).status);
  }
  return 0;
};

/** Build month archive from full salaries list (when months endpoint is 404). */
const buildSalarySheetMonthsFromSalaries = (
  salaries: SalaryPaymentRecord[],
): SalarySheetMonthSummary[] => {
  const byMonth = new Map<
    string,
    {
      employeeCount: number;
      totalNetSalaryNpr: number;
      totalSalaryAmountNpr: number;
      draftCount: number;
      processedCount: number;
      paidCount: number;
      paidDates: string[];
      paymentMethod?: string;
      updatedAt?: string;
    }
  >();

  for (const s of salaries ?? []) {
    const monthBs = String(s.monthBs || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthBs)) continue;
    const bucket = byMonth.get(monthBs) ?? {
      employeeCount: 0,
      totalNetSalaryNpr: 0,
      totalSalaryAmountNpr: 0,
      draftCount: 0,
      processedCount: 0,
      paidCount: 0,
      paidDates: [] as string[],
      paymentMethod: undefined as string | undefined,
      updatedAt: undefined as string | undefined,
    };
    bucket.employeeCount += 1;
    bucket.totalNetSalaryNpr += Number(s.netSalaryNpr ?? 0);
    bucket.totalSalaryAmountNpr += Number(s.salaryAmountNpr ?? 0);
    if (s.status === "PAID") bucket.paidCount += 1;
    else if (s.status === "PROCESSED") bucket.processedCount += 1;
    else bucket.draftCount += 1;
    const pd = String(s.paidDateBs || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(pd)) bucket.paidDates.push(pd);
    if (!bucket.paymentMethod && s.paymentMethod) {
      bucket.paymentMethod = String(s.paymentMethod);
    }
    const updated = s.updatedAt ? String(s.updatedAt) : undefined;
    if (
      updated &&
      (!bucket.updatedAt || updated > bucket.updatedAt)
    ) {
      bucket.updatedAt = updated;
    }
    byMonth.set(monthBs, bucket);
  }

  const round2Local = (n: number) => Math.round(n * 100) / 100;

  return [...byMonth.entries()]
    .map(([monthBs, g]) => {
      const distinct = [
        g.draftCount > 0 ? "DRAFT" : null,
        g.processedCount > 0 ? "PROCESSED" : null,
        g.paidCount > 0 ? "PAID" : null,
      ].filter(Boolean) as Array<"DRAFT" | "PROCESSED" | "PAID">;
      const status =
        distinct.length === 1
          ? distinct[0]!
          : distinct.length > 1
            ? ("MIXED" as const)
            : ("DRAFT" as const);
      const paidDateBs = g.paidDates.sort().at(-1);
      return {
        monthBs,
        employeeCount: g.employeeCount,
        totalNetSalaryNpr: round2Local(g.totalNetSalaryNpr),
        totalSalaryAmountNpr: round2Local(g.totalSalaryAmountNpr),
        status,
        draftCount: g.draftCount,
        processedCount: g.processedCount,
        paidCount: g.paidCount,
        paidDateBs,
        paymentMethod: g.paymentMethod as SalarySheetMonthSummary["paymentMethod"],
        updatedAt: g.updatedAt,
      } satisfies SalarySheetMonthSummary;
    })
    .sort((a, b) => b.monthBs.localeCompare(a.monthBs));
};

/**
 * List months that already have saved payroll rows.
 * Falls back to aggregating GET /salaries when the months endpoint is missing.
 */
export const fetchSalarySheetMonths = async (): Promise<
  SalarySheetMonthSummary[]
> => {
  try {
    return await unwrap<SalarySheetMonthSummary[]>(
      api.get("/accounting/salary-sheet/months"),
    );
  } catch (error: unknown) {
    if (httpStatus(error) !== 404) throw error;
    const salaries = await unwrap<SalaryPaymentRecord[]>(
      api.get("/accounting/salaries"),
    );
    return buildSalarySheetMonthsFromSalaries(salaries ?? []);
  }
};

/**
 * Delete an entire payroll month (admin only).
 * Falls back to deleting each salary row when the bulk endpoint is missing.
 */
export const deleteSalarySheetMonthClient = async (
  monthBs: string,
  reason = `Deleted entire salary sheet for ${monthBs} by administrator`,
): Promise<void> => {
  try {
    await unwrap(
      api.delete(`/accounting/salary-sheet/months/${monthBs}`, {
        data: { reason },
      }),
    );
    return;
  } catch (error: unknown) {
    if (httpStatus(error) !== 404) throw error;
  }

  const salaries = await unwrap<SalaryPaymentRecord[]>(
    api.get("/accounting/salaries"),
  );
  const monthRows = (salaries ?? []).filter(
    (s) => String(s.monthBs || "").trim() === monthBs,
  );
  if (monthRows.length === 0) {
    throw new Error(`No salary sheet found for ${monthBs}`);
  }
  for (const row of monthRows) {
    await unwrap(
      api.delete(`/accounting/salaries/${row._id}`, {
        data: { reason },
      }),
    );
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
};

/**
 * Save payroll rows: prefer bulk API, fall back to per-employee create/update.
 */
export const saveSalarySheetClient = async (payload: {
  monthBs: string;
  status: "DRAFT" | "PROCESSED" | "PENDING_APPROVAL" | "APPROVED" | "PAID";
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

  // Fallback: one salary record per employee via existing endpoints.
  // Same divisor as the sheet: month length minus Saturdays / holidays.
  const calendarDays = daysInBsMonth(payload.monthBs);
  const monthHolidays = await resolveMonthHolidays(
    payload.monthBs,
    calendarDays,
  );
  const workingDays = Math.max(1, calendarDays - monthHolidays.holidayDates.size);

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
      leaveDays: row.leaveDays ?? 0,
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
          row.leaveDays ?? 0,
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

export const submitSalarySheetClient = async (monthBs: string) =>
  unwrap(api.post(`/accounting/salary-sheet/${monthBs}/submit`));

export const approveSalarySheetClient = async (monthBs: string) =>
  unwrap(api.post(`/accounting/salary-sheet/${monthBs}/approve`));

export const rejectSalarySheetClient = async (monthBs: string) =>
  unwrap(api.post(`/accounting/salary-sheet/${monthBs}/reject`));
