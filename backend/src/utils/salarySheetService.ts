import type { Types } from "mongoose";
import { formatNrsAmountInWords } from "@phit-erp/shared";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { Teacher } from "../models/Teacher.js";
import { getDaysInBsMonth } from "./nepaliDate.js";

export type SalarySheetCalcInput = {
  monthlySalaryNpr: number;
  presentDays: number;
  absentDays: number;
  extraDuty: number;
  workingDaysInMonth: number;
  /** When set, use instead of extraDuty * perDay */
  extraAmountOverrideNpr?: number;
};

export type SalarySheetCalcResult = {
  perDaySalaryNpr: number;
  absentDeductionNpr: number;
  extraAmountNpr: number;
  salaryAmountNpr: number;
  tax1PercentNpr: number;
  netSalaryNpr: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const calculateSalarySheetLine = (
  input: SalarySheetCalcInput
): SalarySheetCalcResult => {
  const days = Math.max(1, Number(input.workingDaysInMonth) || 30);
  const monthly = Math.max(0, Number(input.monthlySalaryNpr) || 0);
  const absent = Math.max(0, Number(input.absentDays) || 0);
  const extraDuty = Math.max(0, Number(input.extraDuty) || 0);
  const perDay = monthly / days;
  const absentDeductionNpr = round2(perDay * absent);
  const extraAmountNpr =
    input.extraAmountOverrideNpr !== undefined && input.extraAmountOverrideNpr !== null
      ? round2(Math.max(0, Number(input.extraAmountOverrideNpr) || 0))
      : round2(perDay * extraDuty);
  const salaryAmountNpr = round2(
    Math.max(0, monthly - absentDeductionNpr + extraAmountNpr)
  );
  const tax1PercentNpr = round2(salaryAmountNpr * 0.01);
  const netSalaryNpr = round2(Math.max(0, salaryAmountNpr - tax1PercentNpr));
  return {
    perDaySalaryNpr: round2(perDay),
    absentDeductionNpr,
    extraAmountNpr,
    salaryAmountNpr,
    tax1PercentNpr,
    netSalaryNpr
  };
};

type AttendanceBucket = {
  presentDays: number;
  absentDays: number;
  daysRecorded: number;
};

const emptyBucket = (): AttendanceBucket => ({
  presentDays: 0,
  absentDays: 0,
  daysRecorded: 0
});

/** PRESENT-like statuses count as present; ABSENT/LEAVE as absent. */
const applyStatus = (bucket: AttendanceBucket, status: string): void => {
  bucket.daysRecorded += 1;
  switch (status) {
    case "PRESENT":
    case "LATE":
    case "OFFICIAL_DUTY":
      bucket.presentDays += 1;
      break;
    case "HALF_DAY":
      bucket.presentDays += 0.5;
      bucket.absentDays += 0.5;
      break;
    case "ABSENT":
    case "LEAVE":
      bucket.absentDays += 1;
      break;
    case "HOLIDAY":
      // neither present nor absent for payroll deduction
      break;
    default:
      break;
  }
};

export const aggregateEmployeeAttendanceForMonth = async (
  schoolId: Types.ObjectId,
  monthBs: string
): Promise<{
  byTeacherId: Map<string, AttendanceBucket>;
  byStaffId: Map<string, AttendanceBucket>;
  coverageDays: number;
  workingDaysInMonth: number;
}> => {
  const [yearStr, monthStr] = monthBs.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const workingDaysInMonth =
    year && month ? getDaysInBsMonth(year, month) : 30;

  const sheets = await EmployeeAttendance.find({
    schoolId,
    isDeleted: false,
    dateBs: { $regex: `^${monthBs}` }
  })
    .select("category dateBs entries")
    .lean();

  const dateSet = new Set<string>();
  const byTeacherId = new Map<string, AttendanceBucket>();
  const byStaffId = new Map<string, AttendanceBucket>();

  for (const sheet of sheets) {
    dateSet.add(sheet.dateBs);
    for (const entry of sheet.entries ?? []) {
      const status = String(entry.status || "");
      if (entry.teacherId) {
        const key = String(entry.teacherId);
        const bucket = byTeacherId.get(key) ?? emptyBucket();
        applyStatus(bucket, status);
        byTeacherId.set(key, bucket);
      }
      if (entry.staffId) {
        const key = String(entry.staffId);
        const bucket = byStaffId.get(key) ?? emptyBucket();
        applyStatus(bucket, status);
        byStaffId.set(key, bucket);
      }
    }
  }

  return {
    byTeacherId,
    byStaffId,
    coverageDays: dateSet.size,
    workingDaysInMonth
  };
};

export type BuildSalarySheetOptions = {
  schoolId: Types.ObjectId;
  monthBs: string;
  department?: string;
  employeeType?: "TEACHER" | "STAFF" | "";
  employeeId?: string;
  search?: string;
};

/** Normalize ObjectId / populated ref / string for map keys. */
const idKey = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null) {
    if ("_id" in value && (value as { _id?: unknown })._id != null) {
      return String((value as { _id: unknown })._id);
    }
  }
  return String(value);
};

export const buildSalarySheet = async (options: BuildSalarySheetOptions) => {
  const { schoolId, monthBs } = options;
  const dept = options.department?.trim().toLowerCase() || "";
  const search = options.search?.trim().toLowerCase() || "";
  const employeeType = options.employeeType || "";
  const employeeId = options.employeeId?.trim() || "";

  // Include inactive roster members so existing payroll rows still surface
  const [attendance, teachers, staff, existingSalariesRaw] = await Promise.all([
    aggregateEmployeeAttendanceForMonth(schoolId, monthBs),
    Teacher.find({ schoolId })
      .select("teacherCode basicSalaryNpr user status")
      .populate({ path: "user", select: "fullName designation isActive" })
      .lean(),
    CollegeStaff.find({ schoolId })
      .select("fullName staffId department designation basicSalaryNpr status")
      .lean(),
    // Exact month + loose prefix (legacy "2083-4" style) so saved rows always load
    SalaryPayment.find({
      schoolId,
      isDeleted: false,
      $or: [{ monthBs }, { monthBs: { $regex: `^${monthBs}` } }]
    }).lean()
  ]);

  // Prefer exact monthBs match when both exact and prefix hits exist
  const existingSalaries = existingSalariesRaw.filter((s) => {
    const m = String(s.monthBs || "").trim();
    return m === monthBs || m.startsWith(`${monthBs}`);
  });

  const salaryByTeacher = new Map(
    existingSalaries
      .filter((s) => s.teacherId)
      .map((s) => [idKey(s.teacherId), s] as const)
  );
  const salaryByStaff = new Map(
    existingSalaries
      .filter((s) => s.staffId)
      .map((s) => [idKey(s.staffId), s] as const)
  );

  type DraftRow = {
    employeeType: "TEACHER" | "STAFF";
    teacherId?: string;
    staffId?: string;
    employeeName: string;
    department: string;
    designation: string;
    monthlySalaryNpr: number;
    presentDays: number;
    absentDays: number;
    extraDuty: number;
    remarks: string;
    attendanceIncomplete: boolean;
    attendanceManualOverride: boolean;
    valuesManualOverride: boolean;
    attendanceDaysRecorded: number;
    salaryPaymentId?: string;
    status?: string;
    extraAmountOverrideNpr?: number;
    /** Saved money when valuesManualOverride is true */
    savedAbsentDeductionNpr?: number;
    savedExtraAmountNpr?: number;
    savedSalaryAmountNpr?: number;
    savedTax1PercentNpr?: number;
    savedNetSalaryNpr?: number;
  };

  const drafts: DraftRow[] = [];

  if (!employeeType || employeeType === "TEACHER") {
    for (const t of teachers) {
      const user = t.user as
        | { fullName?: string; designation?: string; isActive?: boolean }
        | null
        | undefined;
      const id = idKey(t._id);
      const saved = salaryByTeacher.get(id);
      // Skip inactive teachers only when they have no payroll row for this month
      if (
        !saved &&
        (String(t.status || "").toUpperCase() === "INACTIVE" ||
          user?.isActive === false)
      ) {
        continue;
      }
      if (employeeId && employeeId !== id) continue;
      const name = user?.fullName?.trim() || "—";
      const designation = user?.designation?.trim() || "";
      if (search && !name.toLowerCase().includes(search) && !designation.toLowerCase().includes(search)) {
        continue;
      }
      // Teachers: department filter only applies if they match "Teaching" / empty dept
      // Always keep teachers who already have a saved payroll row for this month.
      if (
        !saved &&
        dept &&
        dept !== "teaching" &&
        dept !== "teacher" &&
        dept !== "teachers"
      ) {
        continue;
      }
      const att = attendance.byTeacherId.get(id);
      const incomplete = !att || att.daysRecorded === 0;
      const manual = Boolean(saved?.attendanceManualOverride);
      const valuesManual = Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride
      );
      drafts.push({
        employeeType: "TEACHER",
        teacherId: id,
        employeeName: name,
        department: "Teaching",
        designation,
        monthlySalaryNpr: Number(saved?.basicSalaryNpr ?? t.basicSalaryNpr ?? 0),
        presentDays: manual
          ? Number(saved?.presentDays ?? 0)
          : incomplete
            ? Number(saved?.presentDays ?? 0)
            : Number(att?.presentDays ?? 0),
        absentDays: manual
          ? Number(saved?.absentDays ?? 0)
          : incomplete
            ? Number(saved?.absentDays ?? 0)
            : Number(att?.absentDays ?? 0),
        extraDuty: Number(saved?.extraDuty ?? 0),
        remarks: String(saved?.notes ?? ""),
        attendanceIncomplete: incomplete && !manual,
        attendanceManualOverride: manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: att?.daysRecorded ?? 0,
        salaryPaymentId: saved ? String(saved._id) : undefined,
        status: saved?.status,
        extraAmountOverrideNpr:
          !valuesManual &&
          saved?.extraAmountNpr !== undefined &&
          saved?.extraDuty !== undefined &&
          Number(saved.extraDuty) === 0 &&
          Number(saved.extraAmountNpr) > 0
            ? Number(saved.extraAmountNpr)
            : undefined,
        savedAbsentDeductionNpr: valuesManual
          ? Number(saved?.absentDeductionNpr ?? 0)
          : undefined,
        savedExtraAmountNpr: valuesManual
          ? Number(saved?.extraAmountNpr ?? 0)
          : undefined,
        savedSalaryAmountNpr: valuesManual
          ? Number(saved?.salaryAmountNpr ?? 0)
          : undefined,
        savedTax1PercentNpr: valuesManual
          ? Number(saved?.taxNpr ?? 0)
          : undefined,
        savedNetSalaryNpr: valuesManual
          ? Number(saved?.netSalaryNpr ?? 0)
          : undefined
      });
    }
  }

  if (!employeeType || employeeType === "STAFF") {
    for (const s of staff) {
      const id = idKey(s._id);
      const saved = salaryByStaff.get(id);
      // Skip inactive staff only when they have no payroll row for this month
      if (!saved && String(s.status || "").toUpperCase() === "INACTIVE") {
        continue;
      }
      if (employeeId && employeeId !== id) continue;
      const name = s.fullName?.trim() || "—";
      const department = s.department?.trim() || "";
      const designation = s.designation?.trim() || "";
      if (!saved && dept && department.toLowerCase() !== dept) continue;
      if (
        !saved &&
        search &&
        !name.toLowerCase().includes(search) &&
        !department.toLowerCase().includes(search) &&
        !designation.toLowerCase().includes(search)
      ) {
        continue;
      }
      const att = attendance.byStaffId.get(id);
      const incomplete = !att || att.daysRecorded === 0;
      const manual = Boolean(saved?.attendanceManualOverride);
      const valuesManual = Boolean(
        (saved as { valuesManualOverride?: boolean } | undefined)
          ?.valuesManualOverride
      );
      drafts.push({
        employeeType: "STAFF",
        staffId: id,
        employeeName: name,
        department,
        designation,
        monthlySalaryNpr: Number(saved?.basicSalaryNpr ?? s.basicSalaryNpr ?? 0),
        presentDays: manual
          ? Number(saved?.presentDays ?? 0)
          : incomplete
            ? Number(saved?.presentDays ?? 0)
            : Number(att?.presentDays ?? 0),
        absentDays: manual
          ? Number(saved?.absentDays ?? 0)
          : incomplete
            ? Number(saved?.absentDays ?? 0)
            : Number(att?.absentDays ?? 0),
        extraDuty: Number(saved?.extraDuty ?? 0),
        remarks: String(saved?.notes ?? ""),
        attendanceIncomplete: incomplete && !manual,
        attendanceManualOverride: manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: att?.daysRecorded ?? 0,
        salaryPaymentId: saved ? String(saved._id) : undefined,
        status: saved?.status,
        extraAmountOverrideNpr:
          !valuesManual &&
          saved?.extraAmountNpr !== undefined &&
          Number(saved.extraDuty) === 0 &&
          Number(saved.extraAmountNpr) > 0
            ? Number(saved.extraAmountNpr)
            : undefined,
        savedAbsentDeductionNpr: valuesManual
          ? Number(saved?.absentDeductionNpr ?? 0)
          : undefined,
        savedExtraAmountNpr: valuesManual
          ? Number(saved?.extraAmountNpr ?? 0)
          : undefined,
        savedSalaryAmountNpr: valuesManual
          ? Number(saved?.salaryAmountNpr ?? 0)
          : undefined,
        savedTax1PercentNpr: valuesManual
          ? Number(saved?.taxNpr ?? 0)
          : undefined,
        savedNetSalaryNpr: valuesManual
          ? Number(saved?.netSalaryNpr ?? 0)
          : undefined
      });
    }
  }

  // Orphan payroll rows: saved payments whose employee is missing from roster queries
  // (deleted profile, broken link, etc.) — still show so "already entered" data is visible
  const coveredTeachers = new Set(
    drafts.filter((d) => d.teacherId).map((d) => String(d.teacherId))
  );
  const coveredStaff = new Set(
    drafts.filter((d) => d.staffId).map((d) => String(d.staffId))
  );

  for (const s of existingSalaries) {
    const tid = idKey(s.teacherId);
    const sid = idKey(s.staffId);
    const valuesManual = Boolean(
      (s as { valuesManualOverride?: boolean }).valuesManualOverride
    );
    const manual = Boolean(s.attendanceManualOverride);

    if (tid && !coveredTeachers.has(tid)) {
      if (employeeType && employeeType !== "TEACHER") continue;
      if (employeeId && employeeId !== tid) continue;
      const name =
        String(s.staffName || "").trim() ||
        "Teacher (saved payroll)";
      drafts.push({
        employeeType: "TEACHER",
        teacherId: tid,
        employeeName: name,
        department: "Teaching",
        designation: "",
        monthlySalaryNpr: Number(s.basicSalaryNpr ?? 0),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: 0,
        salaryPaymentId: String(s._id),
        status: s.status,
        extraAmountOverrideNpr: undefined,
        savedAbsentDeductionNpr: Number(s.absentDeductionNpr ?? 0),
        savedExtraAmountNpr: Number(s.extraAmountNpr ?? 0),
        savedSalaryAmountNpr: Number(s.salaryAmountNpr ?? 0),
        savedTax1PercentNpr: Number(s.taxNpr ?? 0),
        savedNetSalaryNpr: Number(s.netSalaryNpr ?? 0)
      });
      // Prefer saved money when reconstructing orphans
      if (!valuesManual) {
        const last = drafts[drafts.length - 1];
        if (last) {
          last.valuesManualOverride = true;
          last.savedAbsentDeductionNpr = Number(s.absentDeductionNpr ?? 0);
          last.savedExtraAmountNpr = Number(s.extraAmountNpr ?? 0);
          last.savedSalaryAmountNpr = Number(s.salaryAmountNpr ?? 0);
          last.savedTax1PercentNpr = Number(s.taxNpr ?? 0);
          last.savedNetSalaryNpr = Number(s.netSalaryNpr ?? 0);
        }
      }
      coveredTeachers.add(tid);
    }

    if (sid && !coveredStaff.has(sid)) {
      if (employeeType && employeeType !== "STAFF") continue;
      if (employeeId && employeeId !== sid) continue;
      drafts.push({
        employeeType: "STAFF",
        staffId: sid,
        employeeName: String(s.staffName || "").trim() || "Staff (saved payroll)",
        department: "",
        designation: "",
        monthlySalaryNpr: Number(s.basicSalaryNpr ?? 0),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: manual,
        valuesManualOverride: true,
        attendanceDaysRecorded: 0,
        salaryPaymentId: String(s._id),
        status: s.status,
        extraAmountOverrideNpr: undefined,
        savedAbsentDeductionNpr: Number(s.absentDeductionNpr ?? 0),
        savedExtraAmountNpr: Number(s.extraAmountNpr ?? 0),
        savedSalaryAmountNpr: Number(s.salaryAmountNpr ?? 0),
        savedTax1PercentNpr: Number(s.taxNpr ?? 0),
        savedNetSalaryNpr: Number(s.netSalaryNpr ?? 0)
      });
      coveredStaff.add(sid);
    }
  }

  drafts.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const workingDaysInMonth = attendance.workingDaysInMonth;
  const rows = drafts.map((d, index) => {
    const calc = calculateSalarySheetLine({
      monthlySalaryNpr: d.monthlySalaryNpr,
      presentDays: d.presentDays,
      absentDays: d.absentDays,
      extraDuty: d.extraDuty,
      workingDaysInMonth,
      extraAmountOverrideNpr: d.extraAmountOverrideNpr
    });
    const useManualMoney = Boolean(d.valuesManualOverride);
    return {
      sn: index + 1,
      employeeType: d.employeeType,
      teacherId: d.teacherId,
      staffId: d.staffId,
      employeeName: d.employeeName,
      department: d.department,
      designation: d.designation,
      monthlySalaryNpr: d.monthlySalaryNpr,
      presentDays: d.presentDays,
      absentDays: d.absentDays,
      extraDuty: d.extraDuty,
      absentDeductionNpr: useManualMoney
        ? Number(d.savedAbsentDeductionNpr ?? 0)
        : calc.absentDeductionNpr,
      extraAmountNpr: useManualMoney
        ? Number(d.savedExtraAmountNpr ?? 0)
        : calc.extraAmountNpr,
      salaryAmountNpr: useManualMoney
        ? Number(d.savedSalaryAmountNpr ?? 0)
        : calc.salaryAmountNpr,
      tax1PercentNpr: useManualMoney
        ? Number(d.savedTax1PercentNpr ?? 0)
        : calc.tax1PercentNpr,
      netSalaryNpr: useManualMoney
        ? Number(d.savedNetSalaryNpr ?? 0)
        : calc.netSalaryNpr,
      remarks: d.remarks,
      attendanceIncomplete: d.attendanceIncomplete,
      attendanceManualOverride: d.attendanceManualOverride,
      valuesManualOverride: useManualMoney,
      attendanceDaysRecorded: d.attendanceDaysRecorded,
      workingDaysInMonth,
      salaryPaymentId: d.salaryPaymentId,
      status: d.status as "DRAFT" | "PROCESSED" | "PAID" | undefined
    };
  });

  const totals = {
    totalMonthlySalaryNpr: round2(rows.reduce((s, r) => s + r.monthlySalaryNpr, 0)),
    totalAbsentDeductionNpr: round2(rows.reduce((s, r) => s + r.absentDeductionNpr, 0)),
    totalExtraAmountNpr: round2(rows.reduce((s, r) => s + r.extraAmountNpr, 0)),
    totalSalaryAmountNpr: round2(rows.reduce((s, r) => s + r.salaryAmountNpr, 0)),
    totalTax1PercentNpr: round2(rows.reduce((s, r) => s + r.tax1PercentNpr, 0)),
    totalNetSalaryNpr: round2(rows.reduce((s, r) => s + r.netSalaryNpr, 0)),
    totalNetSalaryInWords: formatNrsAmountInWords(
      rows.reduce((s, r) => s + r.netSalaryNpr, 0)
    )
  };

  const anyIncomplete = rows.some((r) => r.attendanceIncomplete);
  const coverageDays = attendance.coverageDays;
  const attendanceWarning =
    coverageDays === 0
      ? `No staff/teacher attendance records found for ${monthBs}. Present/absent days are empty — authorized users may enter them manually.`
      : anyIncomplete
        ? `Attendance is incomplete for some employees in ${monthBs} (${coverageDays} day(s) recorded). Missing rows show a warning; authorized users can correct present/absent days.`
        : undefined;

  return {
    monthBs,
    workingDaysInMonth,
    attendanceCoverageDays: coverageDays,
    attendanceIncomplete: anyIncomplete || coverageDays === 0,
    attendanceWarning,
    rows,
    totals
  };
};
