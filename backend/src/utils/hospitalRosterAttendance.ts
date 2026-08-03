/**
 * Bridge Hospital Roster (monthly student × day grid) → Field Duty attendance.
 * When a matching roster exists for the posting's batch/year/hospital/month,
 * attendance is driven by that day's assignments.
 */
import type { FieldDutyShift, FieldDutyStudentStatus } from "@phit-erp/shared";
import { DutyShift } from "../models/DutyShift.js";
import { FieldHospital } from "../models/FieldHospital.js";
import { HospitalDepartment } from "../models/HospitalDepartment.js";
import { HospitalRoster } from "../models/HospitalRoster.js";
import { Student } from "../models/Student.js";
import { compareBsDates, countInclusiveBsDays } from "./nepaliDate.js";

export type HospitalRosterDutyAssignment = {
  studentId: string;
  fullName: string;
  admissionNumber?: string;
  rollNumber?: number;
  day: number;
  /** Mapped field-duty shift used for attendance registers. */
  fieldShift: FieldDutyShift;
  shiftId?: string;
  shiftCode?: string;
  shiftName?: string;
  departmentId?: string;
  departmentCode?: string;
  departmentName?: string;
  code?: string;
  remarks?: string;
  /** Pre-fill status when roster cell is Leave (etc.). */
  suggestedStatus?: FieldDutyStudentStatus;
  /** false for Off days — not on duty. */
  onDuty: boolean;
};

export type HospitalRosterAttendanceContext = {
  rosterId: string;
  rosterName: string;
  hospitalName?: string;
  monthBs: string;
  day: number;
  status: string;
  /** All duty assignments for the day (including leave; excluding pure Off). */
  assignments: HospitalRosterDutyAssignment[];
  /** Student ids on duty for the requested field shift (or all if no shift filter). */
  onDutyStudentIds: string[];
  /** Suggested attendance status by student id. */
  suggestedStatusByStudent: Record<string, FieldDutyStudentStatus>;
  /** Department / shift labels by student for UI. */
  assignmentMetaByStudent: Record<
    string,
    {
      departmentCode?: string;
      departmentName?: string;
      shiftCode?: string;
      shiftName?: string;
      fieldShift: FieldDutyShift;
      code?: string;
    }
  >;
};

const toId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "object" && value && "toString" in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value);
};

/** Map hospital DutyShift short codes / names → field attendance shift buckets. */
export const mapDutyShiftToFieldShift = (
  shortCode?: string,
  name?: string,
): FieldDutyShift => {
  const c = String(shortCode || "")
    .trim()
    .toUpperCase();
  const n = String(name || "")
    .trim()
    .toUpperCase();
  const blob = `${c} ${n}`;

  if (
    c === "M" ||
    c === "MORNING" ||
    n.includes("MORNING") ||
    blob.includes("MORNING")
  ) {
    return "MORNING";
  }
  if (
    c === "E" ||
    c === "EVENING" ||
    n.includes("EVENING") ||
    blob.includes("EVENING")
  ) {
    return "EVENING";
  }
  if (c === "N" || c === "NIGHT" || n.includes("NIGHT") || blob.includes("NIGHT")) {
    return "NIGHT";
  }
  if (
    c === "FULL" ||
    c === "FULL_DAY" ||
    c === "FD" ||
    n.includes("FULL") ||
    blob.includes("FULL DAY")
  ) {
    return "FULL_DAY";
  }
  // OD / OPD / Ward / EMG / default ward duty → DAY register sheet
  return "DAY";
};

const normalizeSite = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Day index within a roster for a BS date.
 * New rosters: 1-based offset from startDateBs.
 * Legacy month-only: calendar day-of-month.
 */
const dayIndexForRoster = (
  roster: Record<string, unknown>,
  dateBs: string,
): number | null => {
  const start = String(roster.startDateBs || "").trim();
  const end = String(roster.endDateBs || "").trim();
  if (start && end) {
    try {
      if (compareBsDates(dateBs, start) < 0 || compareBsDates(dateBs, end) > 0) {
        return null;
      }
      return countInclusiveBsDays(start, dateBs);
    } catch {
      return null;
    }
  }
  const day = Number(dateBs.split("-")[2]);
  if (!Number.isFinite(day) || day < 1) return null;
  const max = Number(roster.daysInMonth) || 32;
  if (day > max) return null;
  return day;
};

/**
 * Find the best HospitalRoster for a field posting on a given BS date.
 * Prefer From–To range match; fall back to monthBs + day-of-month (legacy).
 * Prefer hospital name match, prefer LOCKED/PUBLISHED.
 */
export const findMatchingHospitalRoster = async (opts: {
  schoolId: unknown;
  batchId: string;
  yearId: string;
  dateBs: string;
  siteName?: string;
}): Promise<{
  roster: Record<string, unknown> & { _id: { toString(): string } };
  day: number;
  monthBs: string;
} | null> => {
  const dateBs = opts.dateBs.trim();
  const parts = dateBs.split("-");
  if (parts.length < 3) return null;
  const year = parts[0];
  const month = parts[1];
  if (!year || !month) return null;
  const monthBs = `${year}-${month.padStart(2, "0")}`;

  // Load candidate rosters for batch/year (active period or same month)
  let rows = await HospitalRoster.find({
    schoolId: opts.schoolId,
    batchId: opts.batchId,
    yearId: opts.yearId,
    isDeleted: false,
    $or: [
      { startDateBs: { $lte: dateBs }, endDateBs: { $gte: dateBs } },
      {
        $or: [{ startDateBs: { $in: ["", null] } }, { startDateBs: { $exists: false } }],
        monthBs,
      },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!rows.length) {
    // Broader fallback: same month only
    rows = await HospitalRoster.find({
      schoolId: opts.schoolId,
      batchId: opts.batchId,
      yearId: opts.yearId,
      monthBs,
      isDeleted: false,
    })
      .sort({ updatedAt: -1 })
      .lean();
  }

  if (!rows.length) return null;

  // Keep only rows that resolve a valid day index for this date
  rows = rows.filter((r) => dayIndexForRoster(r as Record<string, unknown>, dateBs) != null);
  if (!rows.length) return null;

  const site = normalizeSite(opts.siteName || "");
  if (site) {
    const hospitals = await FieldHospital.find({
      schoolId: opts.schoolId,
      isDeleted: false,
    })
      .select("_id name")
      .lean();
    const matchingHospitalIds = new Set(
      hospitals
        .filter((h) => {
          const n = normalizeSite(h.name || "");
          return n === site || n.includes(site) || site.includes(n);
        })
        .map((h) => h._id.toString()),
    );

    const byHospital = rows.filter((r) =>
      matchingHospitalIds.has(toId(r.hospitalId)),
    );
    if (byHospital.length) rows = byHospital;
  }

  const rank = (status: string) => {
    if (status === "LOCKED") return 0;
    if (status === "PUBLISHED") return 1;
    return 2;
  };
  rows.sort(
    (a, b) =>
      rank(String(a.status || "DRAFT")) - rank(String(b.status || "DRAFT")),
  );

  const best = rows[0];
  if (!best) return null;
  const day = dayIndexForRoster(best as Record<string, unknown>, dateBs);
  if (day == null) return null;
  return {
    roster: best as Record<string, unknown> & { _id: { toString(): string } },
    day,
    monthBs: String(best.monthBs || monthBs),
  };
};

/** Build attendance context from a hospital roster for one BS day (+ optional field shift filter). */
export const buildHospitalRosterAttendanceContext = async (opts: {
  schoolId: unknown;
  batchId: string;
  yearId: string;
  dateBs: string;
  siteName?: string;
  /** When set, only students whose mapped field shift matches. */
  fieldShift?: string;
}): Promise<HospitalRosterAttendanceContext | null> => {
  const match = await findMatchingHospitalRoster(opts);
  if (!match) return null;

  const { roster, day, monthBs } = match;
  const schoolId = opts.schoolId;
  const studentIds = ((roster.studentIds as unknown[]) ?? []).map(toId).filter(Boolean);
  const cells = ((roster.cells as Array<Record<string, unknown>>) ?? []).filter(
    (c) => Number(c.day) === day,
  );

  const [shifts, departments, students] = await Promise.all([
    DutyShift.find({ schoolId, isDeleted: false }).lean(),
    HospitalDepartment.find({ schoolId, isDeleted: false }).lean(),
    studentIds.length
      ? Student.find({ schoolId, _id: { $in: studentIds } })
          .populate("user", "fullName")
          .lean()
      : Promise.resolve([]),
  ]);

  const shiftById = new Map(shifts.map((s) => [s._id.toString(), s]));
  const deptById = new Map(departments.map((d) => [d._id.toString(), d]));
  const studentMap = new Map(
    students.map((s) => {
      const user = s.user as unknown as { fullName?: string } | null;
      return [
        s._id.toString(),
        {
          fullName: user?.fullName ?? "Student",
          admissionNumber: s.admissionNumber as string | undefined,
          rollNumber: s.rollNumber as number | undefined,
        },
      ] as const;
    }),
  );

  const hospital = roster.hospitalId
    ? await FieldHospital.findById(toId(roster.hospitalId)).select("name").lean()
    : null;

  const assignments: HospitalRosterDutyAssignment[] = [];

  for (const cell of cells) {
    const studentId = toId(cell.studentId);
    if (!studentId) continue;
    const code = String(cell.code || "").trim();
    const codeLower = code.toLowerCase();
    const shiftId = cell.shiftId ? toId(cell.shiftId) : undefined;
    const departmentId = cell.departmentId ? toId(cell.departmentId) : undefined;
    // Empty cell
    if (!shiftId && !departmentId && !code) continue;

    const sh = shiftId ? shiftById.get(shiftId) : undefined;
    const dep = departmentId ? deptById.get(departmentId) : undefined;
    const st = studentMap.get(studentId);

    // Off day — not on duty for attendance
    if (codeLower === "off") {
      continue;
    }

    const fieldShift = mapDutyShiftToFieldShift(sh?.shortCode, sh?.name);
    let suggestedStatus: FieldDutyStudentStatus | undefined;
    let onDuty = true;

    if (codeLower === "leave") {
      suggestedStatus = "LEAVE";
    }

    assignments.push({
      studentId,
      fullName: st?.fullName ?? "Student",
      admissionNumber: st?.admissionNumber,
      rollNumber: st?.rollNumber,
      day,
      fieldShift,
      shiftId,
      shiftCode: sh?.shortCode,
      shiftName: sh?.name,
      departmentId,
      departmentCode: dep?.shortCode,
      departmentName: dep?.name,
      code: code || undefined,
      remarks: String(cell.remarks || "").trim() || undefined,
      suggestedStatus,
      onDuty,
    });
  }

  const wantShift = opts.fieldShift
    ? String(opts.fieldShift).toUpperCase()
    : undefined;

  // Filter by field shift when requested. Cells with only department (no shift)
  // count toward DAY so coordinators still get a sheet.
  const forShift = wantShift
    ? assignments.filter((a) => {
        if (a.fieldShift === wantShift) return true;
        // Department-only / free-code cells without a duty shift → DAY bucket
        if (!a.shiftId && wantShift === "DAY") return true;
        return false;
      })
    : assignments;

  const onDutyStudentIds = forShift.filter((a) => a.onDuty).map((a) => a.studentId);

  const suggestedStatusByStudent: Record<string, FieldDutyStudentStatus> = {};
  const assignmentMetaByStudent: HospitalRosterAttendanceContext["assignmentMetaByStudent"] =
    {};

  for (const a of forShift) {
    if (a.suggestedStatus) {
      suggestedStatusByStudent[a.studentId] = a.suggestedStatus;
    }
    assignmentMetaByStudent[a.studentId] = {
      departmentCode: a.departmentCode,
      departmentName: a.departmentName,
      shiftCode: a.shiftCode,
      shiftName: a.shiftName,
      fieldShift: a.fieldShift,
      code: a.code,
    };
  }

  return {
    rosterId: roster._id.toString(),
    rosterName: String(roster.name || "Hospital roster"),
    hospitalName: hospital?.name || undefined,
    monthBs,
    day,
    status: String(roster.status || "DRAFT"),
    assignments: forShift,
    onDutyStudentIds,
    suggestedStatusByStudent,
    assignmentMetaByStudent,
  };
};
