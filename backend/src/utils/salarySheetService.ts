import type { Types } from "mongoose";
import {
  calculateSalarySheetLine,
  calculateTenderProgress,
  formatNrsAmountInWords,
  formatTenderPayBreakdown,
  normalizeTeacherPaymentType,
  paidPresentDays,
  sumTeacherTenderAmountNpr,
  type TeacherPaymentType
} from "@phit-erp/shared";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { School } from "../models/School.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import {
  lookupFamilyValue,
  loadTenderSyllabusProgress
} from "./tenderSyllabusProgress.js";

export {
  calculateSalarySheetLine,
  calculateTenderProgress,
  calculateTenderThisMonthNpr,
  deductedAttendanceDays,
  paidPresentDays
} from "@phit-erp/shared";

const round2 = (n: number): number => Math.round(n * 100) / 100;

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

/** Nepal academic year YYYY/YYYY is typically Shrawan (04) through Ashadh (03). */
const monthInAcademicYear = (monthBs: string, academicYearBs: string): boolean => {
  const parts = academicYearBs.split("/");
  if (parts.length !== 2) return true;
  const startY = Number(parts[0]);
  const endY = Number(parts[1]);
  const [yStr, mStr] = monthBs.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || !startY || !endY) return true;
  if (m >= 4) return y === startY;
  return y === endY;
};

type TeacherPayFacts = {
  periodsByTeacher: Map<string, number>;
  progressByTeacherSubject: Map<string, number>;
  progressDetailByTeacherSubject: Map<string, string>;
  assignedSubjectsByTeacher: Map<string, string[]>;
  tenderPaidByTeacher: Map<string, number>;
  tenderPaidPercentByTeacher: Map<string, number>;
  subjectNameById: Map<string, string>;
  subjectFamilyById: Map<string, string[]>;
  academicYearBs: string;
};

const loadTeacherPayFacts = async (
  schoolId: Types.ObjectId,
  monthBs: string,
  teacherIds: Types.ObjectId[],
  tenderSubjectIdsByTeacher: Map<string, string[]>
): Promise<TeacherPayFacts> => {
  const empty: TeacherPayFacts = {
    periodsByTeacher: new Map(),
    progressByTeacherSubject: new Map(),
    progressDetailByTeacherSubject: new Map(),
    assignedSubjectsByTeacher: new Map(),
    tenderPaidByTeacher: new Map(),
    tenderPaidPercentByTeacher: new Map(),
    subjectNameById: new Map(),
    subjectFamilyById: new Map(),
    academicYearBs: ""
  };
  if (teacherIds.length === 0) return empty;

  const school = await School.findById(schoolId).select("academicYearBs").lean();
  const academicYearBs = String(school?.academicYearBs || "").trim();

  const [logCounts, progressRows, paidRows, subjects, syllabusProgress] = await Promise.all([
    AcademicLogBookEntry.aggregate<{ _id: Types.ObjectId; periods: number }>([
      {
        $match: {
          schoolId,
          teacherId: { $in: teacherIds },
          isDeleted: false,
          dateBs: { $regex: `^${monthBs}` }
        }
      },
      { $group: { _id: "$teacherId", periods: { $sum: 1 } } }
    ]),
    AcademicProgress.find({ schoolId, teacherId: { $in: teacherIds } })
      .select("teacherId subjectId completedPercent academicYearBs")
      .lean(),
    SalaryPayment.find({
      schoolId,
      isDeleted: false,
      status: "PAID",
      teacherId: { $in: teacherIds },
      monthBs: { $ne: monthBs }
    })
      .select(
        "teacherId monthBs paymentType tenderThisMonthNpr tenderAmountNpr basicSalaryNpr syllabusCompletedPercent syllabusAlreadyPaidPercent syllabusThisMonthPercent academicYearBs"
      )
      .lean(),
    Subject.find({ schoolId }).select("name code masterSubjectId").lean(),
    loadTenderSyllabusProgress({
      schoolId,
      teacherIds,
      academicYearBs,
      tenderSubjectIdsByTeacher
    })
  ]);

  const periodsByTeacher = new Map<string, number>();
  for (const row of logCounts) {
    periodsByTeacher.set(String(row._id), Number(row.periods) || 0);
  }

  const pushProgress = (rows: typeof progressRows, requireAy: boolean) => {
    const buckets = new Map<string, number[]>();
    for (const row of rows) {
      const rowAy = String(row.academicYearBs || "").trim();
      if (requireAy && academicYearBs && rowAy && rowAy !== academicYearBs) continue;
      const key = `${idKey(row.teacherId)}:${idKey(row.subjectId)}`;
      const list = buckets.get(key) ?? [];
      list.push(Number(row.completedPercent) || 0);
      buckets.set(key, list);
    }
    return buckets;
  };
  let progressBuckets = pushProgress(progressRows, true);
  if (progressBuckets.size === 0) progressBuckets = pushProgress(progressRows, false);

  const progressByTeacherSubject = new Map<string, number>();
  for (const [key, values] of progressBuckets) {
    const avg = values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
    progressByTeacherSubject.set(key, round2(avg));
  }
  // Official syllabus wins when it reflects taught work. Keep session-plan %
  // when syllabus leaves are unmarked so Academic Management completion is paid.
  for (const [key, percent] of syllabusProgress.percentByTeacherSubject) {
    const existing = progressByTeacherSubject.get(key) ?? 0;
    progressByTeacherSubject.set(key, round2(Math.max(percent, existing)));
  }

  const inheritFamilyProgress = (teacherId: string, subjectId: string) => {
    const key = `${teacherId}:${subjectId}`;
    if ((progressByTeacherSubject.get(key) ?? 0) > 0) return;
    const inherited = lookupFamilyValue(
      progressByTeacherSubject,
      teacherId,
      subjectId,
      syllabusProgress.subjectFamilyById,
      (n) => n > 0
    );
    if (inherited && inherited > 0) progressByTeacherSubject.set(key, inherited);
    const inheritedDetail = lookupFamilyValue(
      syllabusProgress.detailByTeacherSubject,
      teacherId,
      subjectId,
      syllabusProgress.subjectFamilyById,
      (s) => Boolean(s)
    );
    if (inheritedDetail && !syllabusProgress.detailByTeacherSubject.has(key)) {
      syllabusProgress.detailByTeacherSubject.set(key, inheritedDetail);
    }
  };
  for (const [teacherId, subjectIds] of tenderSubjectIdsByTeacher) {
    for (const subjectId of subjectIds) inheritFamilyProgress(teacherId, subjectId);
  }
  for (const [teacherId, subjectIds] of syllabusProgress.assignedSubjectsByTeacher) {
    for (const subjectId of subjectIds) inheritFamilyProgress(teacherId, subjectId);
  }

  const tenderPaidByTeacher = new Map<string, number>();
  const tenderPaidPercentByTeacher = new Map<string, number>();
  const paidPercentSumByTeacher = new Map<string, number>();
  const paidContractByTeacher = new Map<string, number>();
  for (const row of paidRows) {
    const isTender =
      normalizeTeacherPaymentType(row.paymentType) === "TENDER" ||
      Number(row.tenderThisMonthNpr) > 0;
    if (!isTender) continue;
    const ay = String(row.academicYearBs || "").trim();
    if (academicYearBs) {
      if (ay) {
        if (ay !== academicYearBs) continue;
      } else if (!monthInAcademicYear(String(row.monthBs || ""), academicYearBs)) {
        continue;
      }
    }
    const key = String(row.teacherId);
    const paidNpr = Number(row.tenderThisMonthNpr) || 0;
    tenderPaidByTeacher.set(key, round2((tenderPaidByTeacher.get(key) ?? 0) + paidNpr));
    const contract = Math.max(
      0,
      Number(row.tenderAmountNpr ?? row.basicSalaryNpr) || 0
    );
    if (contract > 0) paidContractByTeacher.set(key, contract);

    const completedAtPay = Number(row.syllabusCompletedPercent) || 0;
    const alreadyThen = Number(row.syllabusAlreadyPaidPercent) || 0;
    const thisThen = Number(row.syllabusThisMonthPercent) || 0;
    const milestone = Math.max(completedAtPay, alreadyThen + thisThen);
    tenderPaidPercentByTeacher.set(
      key,
      round2(Math.max(tenderPaidPercentByTeacher.get(key) ?? 0, milestone))
    );
    if (thisThen > 0) {
      paidPercentSumByTeacher.set(
        key,
        round2((paidPercentSumByTeacher.get(key) ?? 0) + thisThen)
      );
    }
  }
  for (const [key, sumPct] of paidPercentSumByTeacher) {
    tenderPaidPercentByTeacher.set(
      key,
      round2(Math.max(tenderPaidPercentByTeacher.get(key) ?? 0, sumPct))
    );
  }
  for (const [key, paidNpr] of tenderPaidByTeacher) {
    if ((tenderPaidPercentByTeacher.get(key) ?? 0) > 0) continue;
    const contract = paidContractByTeacher.get(key) ?? 0;
    if (contract > 0 && paidNpr > 0) {
      tenderPaidPercentByTeacher.set(
        key,
        round2(Math.min(100, (paidNpr / contract) * 100))
      );
    }
  }

  const subjectNameById = new Map<string, string>();
  for (const subject of subjects) {
    const name = String(subject.name || "").trim() || "Subject";
    const code = String(subject.code || "").trim();
    subjectNameById.set(String(subject._id), code ? `${name} (${code})` : name);
  }

  return {
    periodsByTeacher,
    progressByTeacherSubject,
    progressDetailByTeacherSubject: syllabusProgress.detailByTeacherSubject,
    assignedSubjectsByTeacher: syllabusProgress.assignedSubjectsByTeacher,
    tenderPaidByTeacher,
    tenderPaidPercentByTeacher,
    subjectNameById,
    subjectFamilyById: syllabusProgress.subjectFamilyById,
    academicYearBs
  };
};

type AttendanceBucket = {
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  daysRecorded: number;
};

const emptyBucket = (): AttendanceBucket => ({
  presentDays: 0,
  absentDays: 0,
  leaveDays: 0,
  daysRecorded: 0
});

/**
 * Map one register mark. Holiday-dated sheets are skipped by the caller, so a
 * HOLIDAY status on a remaining (working) day is paid as present.
 */
const applyStatus = (bucket: AttendanceBucket, status: string): void => {
  bucket.daysRecorded += 1;
  switch (status) {
    case "PRESENT":
    case "LATE":
    case "OFFICIAL_DUTY":
    case "HOLIDAY":
      bucket.presentDays += 1;
      break;
    case "HALF_DAY":
      bucket.presentDays += 0.5;
      bucket.absentDays += 0.5;
      break;
    case "ABSENT":
      bucket.absentDays += 1;
      break;
    case "LEAVE":
      bucket.leaveDays += 1;
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
  /** Distinct TEACHER sheet dates that actually carry entries. */
  teacherCoverageDays: number;
  /** Distinct STAFF sheet dates that actually carry entries. */
  staffCoverageDays: number;
  /** Every day of the BS month, holidays included. */
  calendarDaysInMonth: number;
  saturdayDaysInMonth: number;
  otherHolidayDaysInMonth: number;
  /** Saturdays + calendar holidays + legacy settings holidays. */
  holidayDaysInMonth: number;
  /** calendarDays - holidays. The payroll per-day divisor. */
  workingDaysInMonth: number;
}> => {
  const { resolveMonthHolidayDates } = await import("./academicCalendarService.js");
  const { calendarDays, holidayDates, saturdayDates, otherHolidayDates, workingDays } =
    await resolveMonthHolidayDates(schoolId, monthBs);

  const sheets = await EmployeeAttendance.find({
    schoolId,
    isDeleted: false,
    dateBs: { $regex: `^${monthBs}` }
  })
    .select("category dateBs entries")
    .lean();

  const dateSet = new Set<string>();
  const teacherDateSet = new Set<string>();
  const staffDateSet = new Set<string>();
  const byTeacherId = new Map<string, AttendanceBucket>();
  const byStaffId = new Map<string, AttendanceBucket>();

  for (const sheet of sheets) {
    // An empty day sheet is not attendance coverage — counting it would inflate
    // the expected-days baseline and hide genuinely missing employees.
    if ((sheet.entries?.length ?? 0) === 0) continue;
    // A holiday is nobody's working day. Registers do get opened on Saturdays,
    // sometimes marking people ABSENT or LEAVE — deducting pay for a public
    // holiday. Skip those sheets entirely so they can neither deduct salary nor
    // count towards attendance coverage.
    if (holidayDates.has(sheet.dateBs)) continue;
    dateSet.add(sheet.dateBs);
    if (sheet.category === "TEACHER") teacherDateSet.add(sheet.dateBs);
    if (sheet.category === "STAFF") staffDateSet.add(sheet.dateBs);
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
    teacherCoverageDays: teacherDateSet.size,
    staffCoverageDays: staffDateSet.size,
    calendarDaysInMonth: calendarDays,
    saturdayDaysInMonth: saturdayDates.size,
    otherHolidayDaysInMonth: otherHolidayDates.size,
    holidayDaysInMonth: holidayDates.size,
    workingDaysInMonth: workingDays
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
      .select("teacherCode basicSalaryNpr user status paymentType periodRateNpr tenders")
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

  const tenderSubjectIdsByTeacher = new Map<string, string[]>();
  for (const t of teachers) {
    const ids = (Array.isArray(t.tenders) ? t.tenders : [])
      .map((row) => idKey((row as { subjectId?: unknown }).subjectId))
      .filter(Boolean);
    if (ids.length > 0) tenderSubjectIdsByTeacher.set(idKey(t._id), ids);
  }

  const payFacts = await loadTeacherPayFacts(
    schoolId,
    monthBs,
    teachers.map((t) => t._id as Types.ObjectId),
    tenderSubjectIdsByTeacher
  );

  type DraftRow = {
    employeeType: "TEACHER" | "STAFF";
    teacherId?: string;
    staffId?: string;
    employeeName: string;
    department: string;
    designation: string;
    monthlySalaryNpr: number;
    paymentType: TeacherPaymentType;
    periodRateNpr: number;
    periodsAttended: number;
    tenderAmountNpr: number;
    syllabusCompletedPercent: number;
    syllabusAlreadyPaidPercent: number;
    syllabusThisMonthPercent: number;
    syllabusRemainingPercent: number;
    tenderAlreadyPaidNpr: number;
    tenderThisMonthNpr: number;
    payBreakdown: string;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    extraDuty: number;
    remarks: string;
    attendanceIncomplete: boolean;
    attendanceManualOverride: boolean;
    valuesManualOverride: boolean;
    attendanceDaysRecorded: number;
    unrecordedDays: number;
    /** Day sheets that exist this month for this employee's category. */
    attendanceExpectedDays: number;
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

  const workingDaysInMonth = attendance.workingDaysInMonth;

  const settleDays = (
    att: AttendanceBucket | undefined,
    saved:
      | {
          presentDays?: number;
          absentDays?: number;
          leaveDays?: number;
          attendanceManualOverride?: boolean;
        }
      | undefined
  ) => {
    const daysRecorded = att?.daysRecorded ?? 0;
    const noAttendance = daysRecorded === 0;
    const manual = Boolean(saved?.attendanceManualOverride);
    const savedPresent = Number(saved?.presentDays ?? 0);
    const savedAbsent = Number(saved?.absentDays ?? 0);
    const savedLeave = Number(saved?.leaveDays ?? 0);
    const hasSavedDays = savedPresent > 0 || savedAbsent > 0 || savedLeave > 0;
    if (manual || (noAttendance && hasSavedDays)) {
      return {
        presentDays: savedPresent,
        absentDays: savedAbsent,
        leaveDays: savedLeave,
        unrecordedDays: Math.max(0, workingDaysInMonth - daysRecorded),
        daysRecorded,
        noAttendance,
        manual
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
        manual: false
      };
    }
    const absentDays = Number(att?.absentDays ?? 0);
    const leaveDays = Number(att?.leaveDays ?? 0);
    return {
      presentDays: paidPresentDays(workingDaysInMonth, absentDays, leaveDays),
      absentDays,
      leaveDays,
      unrecordedDays: Math.max(0, workingDaysInMonth - daysRecorded),
      daysRecorded,
      noAttendance: false,
      manual: false
    };
  };

  const resolveTeacherPay = (
    teacherId: string,
    teacher: {
      basicSalaryNpr?: number;
      paymentType?: string;
      periodRateNpr?: number;
      tenders?: Array<{
        subjectId?: unknown;
        academicYearBs?: string;
        tenderAmountNpr?: number;
      }>;
    },
    saved:
      | {
          paymentType?: string;
          basicSalaryNpr?: number;
          periodRateNpr?: number;
          periodsAttended?: number;
          tenderAmountNpr?: number;
          syllabusCompletedPercent?: number;
          syllabusAlreadyPaidPercent?: number;
          syllabusThisMonthPercent?: number;
          syllabusRemainingPercent?: number;
          tenderAlreadyPaidNpr?: number;
          tenderThisMonthNpr?: number;
          payBreakdown?: string;
          attendanceManualOverride?: boolean;
          status?: string;
        }
      | undefined
  ) => {
    const tenders = Array.isArray(teacher.tenders) ? teacher.tenders : [];
    const ayTenders = payFacts.academicYearBs
      ? tenders.filter(
          (row) =>
            !row.academicYearBs || row.academicYearBs === payFacts.academicYearBs
        )
      : tenders;
    const activeTenders = ayTenders.length > 0 ? ayTenders : tenders;
    const liveTenderAmount = sumTeacherTenderAmountNpr(activeTenders);
    const teacherType = normalizeTeacherPaymentType(teacher.paymentType);
    const savedType = saved?.paymentType
      ? normalizeTeacherPaymentType(saved.paymentType)
      : undefined;
    const savedPaid = String(saved?.status || "").toUpperCase() === "PAID";
    // Draft salary rows default to MONTHLY in the schema. Unpaid sheets must
    // follow the teacher's live tender/period type so Botany tenders aren't 0%.
    const paymentType: TeacherPaymentType = savedPaid
      ? savedType || teacherType
      : teacherType === "TENDER" || (liveTenderAmount > 0 && teacherType !== "PERIOD")
        ? "TENDER"
        : teacherType === "PERIOD"
          ? "PERIOD"
          : savedType || teacherType;
    const periodRateNpr = Math.max(
      0,
      Number(
        saved?.periodRateNpr ??
          teacher.periodRateNpr ??
          (paymentType === "PERIOD" ? teacher.basicSalaryNpr : 0)
      ) || 0
    );

    const livePeriods = payFacts.periodsByTeacher.get(teacherId) ?? 0;
    const alreadyPaidPercentLive =
      payFacts.tenderPaidPercentByTeacher.get(teacherId) ?? 0;
    const manualUnits = Boolean(saved?.attendanceManualOverride);

    let periodsAttended = livePeriods;
    let tenderAmountNpr = liveTenderAmount;
    let syllabusCompletedPercent = 0;
    let syllabusAlreadyPaidPercent = alreadyPaidPercentLive;
    let syllabusThisMonthPercent = 0;
    let syllabusRemainingPercent = 100;
    let tenderAlreadyPaidNpr = 0;
    let tenderThisMonthNpr = 0;
    const parts: string[] = [];

    if (paymentType === "TENDER") {
      const subjectRows: Array<{ subjectId: string; amount: number }> = [];
      if (activeTenders.length > 0) {
        for (const tender of activeTenders) {
          const subjectId = idKey(tender.subjectId);
          if (!subjectId) continue;
          subjectRows.push({
            subjectId,
            amount: Math.max(0, Number(tender.tenderAmountNpr) || 0)
          });
        }
      } else {
        for (const subjectId of payFacts.assignedSubjectsByTeacher.get(teacherId) ?? []) {
          subjectRows.push({ subjectId, amount: 0 });
        }
        if (subjectRows.length > 0) {
          tenderAmountNpr = Math.max(
            0,
            Number(teacher.basicSalaryNpr) || liveTenderAmount || 0
          );
        }
      }

      let weighted = 0;
      let weight = 0;
      for (const row of subjectRows) {
        const percent =
          lookupFamilyValue(
            payFacts.progressByTeacherSubject,
            teacherId,
            row.subjectId,
            payFacts.subjectFamilyById,
            (n) => n > 0
          ) ??
          payFacts.progressByTeacherSubject.get(`${teacherId}:${row.subjectId}`) ??
          0;
        const detail =
          lookupFamilyValue(
            payFacts.progressDetailByTeacherSubject,
            teacherId,
            row.subjectId,
            payFacts.subjectFamilyById,
            (s) => Boolean(s)
          ) ??
          payFacts.progressDetailByTeacherSubject.get(`${teacherId}:${row.subjectId}`) ??
          "";
        const amount = row.amount;
        const rowWeight = amount > 0 ? amount : 1;
        weighted += percent * rowWeight;
        weight += rowWeight;
        const subjectName = payFacts.subjectNameById.get(row.subjectId) || "Subject";
        const portion = detail ? ` · ${detail}` : "";
        if (amount > 0) {
          parts.push(
            `${subjectName}${portion} ${round2(percent)}% of Rs ${amount.toLocaleString("en-NP")}`
          );
        } else {
          parts.push(`${subjectName}${portion} ${round2(percent)}%`);
        }
      }
      syllabusCompletedPercent = weight > 0 ? round2(weighted / weight) : 0;
    }

    if (manualUnits && saved) {
      if (saved.periodsAttended !== undefined) {
        periodsAttended = Math.max(0, Number(saved.periodsAttended) || 0);
      }
      if (saved.tenderAmountNpr !== undefined) {
        tenderAmountNpr = Math.max(0, Number(saved.tenderAmountNpr) || 0);
      }
      if (saved.syllabusCompletedPercent !== undefined) {
        syllabusCompletedPercent = Math.max(
          0,
          Number(saved.syllabusCompletedPercent) || 0
        );
      }
    }

    if (paymentType === "TENDER") {
      if (savedPaid && saved) {
        syllabusCompletedPercent = Math.max(
          0,
          Number(saved.syllabusCompletedPercent ?? syllabusCompletedPercent) || 0
        );
        syllabusAlreadyPaidPercent = Math.max(
          0,
          Number(saved.syllabusAlreadyPaidPercent ?? alreadyPaidPercentLive) || 0
        );
        const locked = calculateTenderProgress({
          tenderAmountNpr,
          syllabusCompletedPercent,
          syllabusAlreadyPaidPercent
        });
        syllabusThisMonthPercent =
          Number(saved.syllabusThisMonthPercent) || locked.syllabusThisMonthPercent;
        syllabusRemainingPercent =
          Number(saved.syllabusRemainingPercent) || locked.syllabusRemainingPercent;
        tenderAlreadyPaidNpr =
          Number(saved.tenderAlreadyPaidNpr) || locked.tenderAlreadyPaidNpr;
        tenderThisMonthNpr =
          Number(saved.tenderThisMonthNpr) || locked.tenderThisMonthNpr;
      } else {
        const progress = calculateTenderProgress({
          tenderAmountNpr,
          syllabusCompletedPercent,
          syllabusAlreadyPaidPercent: alreadyPaidPercentLive
        });
        syllabusCompletedPercent = progress.syllabusCompletedPercent;
        syllabusAlreadyPaidPercent = progress.syllabusAlreadyPaidPercent;
        syllabusThisMonthPercent = progress.syllabusThisMonthPercent;
        syllabusRemainingPercent = progress.syllabusRemainingPercent;
        tenderAlreadyPaidNpr = progress.tenderAlreadyPaidNpr;
        tenderThisMonthNpr = progress.tenderThisMonthNpr;
        parts.push(
          formatTenderPayBreakdown({
            syllabusCompletedPercent,
            syllabusAlreadyPaidPercent,
            syllabusThisMonthPercent,
            syllabusRemainingPercent,
            tenderAlreadyPaidNpr,
            tenderThisMonthNpr
          })
        );
      }
    } else if (paymentType === "PERIOD") {
      parts.push(
        `${periodsAttended} period(s) × Rs ${periodRateNpr.toLocaleString("en-NP")}`
      );
    }

    const monthlySalaryNpr =
      paymentType === "PERIOD"
        ? Number(saved?.basicSalaryNpr ?? periodRateNpr)
        : paymentType === "TENDER"
          ? Number(saved?.basicSalaryNpr ?? tenderAmountNpr)
          : Number(saved?.basicSalaryNpr ?? teacher.basicSalaryNpr ?? 0);

    return {
      paymentType,
      periodRateNpr:
        paymentType === "PERIOD" ? Number(saved?.basicSalaryNpr ?? periodRateNpr) : periodRateNpr,
      periodsAttended,
      tenderAmountNpr,
      syllabusCompletedPercent,
      syllabusAlreadyPaidPercent,
      syllabusThisMonthPercent,
      syllabusRemainingPercent,
      tenderAlreadyPaidNpr,
      tenderThisMonthNpr,
      payBreakdown:
        (savedPaid && saved?.payBreakdown
          ? String(saved.payBreakdown)
          : parts.join(" · ")) || "",
      monthlySalaryNpr
    };
  };

  const emptyPay = (): Pick<
    DraftRow,
    | "paymentType"
    | "periodRateNpr"
    | "periodsAttended"
    | "tenderAmountNpr"
    | "syllabusCompletedPercent"
    | "syllabusAlreadyPaidPercent"
    | "syllabusThisMonthPercent"
    | "syllabusRemainingPercent"
    | "tenderAlreadyPaidNpr"
    | "tenderThisMonthNpr"
    | "payBreakdown"
  > => ({
    paymentType: "MONTHLY",
    periodRateNpr: 0,
    periodsAttended: 0,
    tenderAmountNpr: 0,
    syllabusCompletedPercent: 0,
    syllabusAlreadyPaidPercent: 0,
    syllabusThisMonthPercent: 0,
    syllabusRemainingPercent: 100,
    tenderAlreadyPaidNpr: 0,
    tenderThisMonthNpr: 0,
    payBreakdown: ""
  });

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
      const settled = settleDays(att, saved);
      const expectedDays = attendance.teacherCoverageDays;
      /**
       * Partial coverage still uses the real attendance figures, but must be
       * flagged: unrecorded days are silently paid as present.
       */
      const pay = resolveTeacherPay(id, t, saved);
      const attendanceIncomplete =
        settled.noAttendance || settled.daysRecorded < expectedDays;
      const incomplete =
        pay.paymentType === "PERIOD"
          ? pay.periodsAttended <= 0 && !settled.manual
          : pay.paymentType === "TENDER"
            ? pay.tenderAmountNpr <= 0 && !settled.manual
            : attendanceIncomplete;
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
        monthlySalaryNpr: pay.monthlySalaryNpr,
        paymentType: pay.paymentType,
        periodRateNpr: pay.periodRateNpr,
        periodsAttended: pay.periodsAttended,
        tenderAmountNpr: pay.tenderAmountNpr,
        syllabusCompletedPercent: pay.syllabusCompletedPercent,
        syllabusAlreadyPaidPercent: pay.syllabusAlreadyPaidPercent,
        syllabusThisMonthPercent: pay.syllabusThisMonthPercent,
        syllabusRemainingPercent: pay.syllabusRemainingPercent,
        tenderAlreadyPaidNpr: pay.tenderAlreadyPaidNpr,
        tenderThisMonthNpr: pay.tenderThisMonthNpr,
        payBreakdown: pay.payBreakdown,
        presentDays: settled.presentDays,
        absentDays: settled.absentDays,
        leaveDays: settled.leaveDays,
        extraDuty: Number(saved?.extraDuty ?? 0),
        remarks: String(saved?.notes ?? ""),
        attendanceIncomplete: incomplete && !settled.manual,
        attendanceManualOverride: settled.manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: settled.daysRecorded,
        unrecordedDays: settled.unrecordedDays,
        attendanceExpectedDays: expectedDays,
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
      const settled = settleDays(att, saved);
      const expectedDays = attendance.staffCoverageDays;
      /**
       * Partial coverage still uses the real attendance figures, but must be
       * flagged: unrecorded days are silently paid as present.
       */
      const incomplete =
        settled.noAttendance || settled.daysRecorded < expectedDays;
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
        ...emptyPay(),
        presentDays: settled.presentDays,
        absentDays: settled.absentDays,
        leaveDays: settled.leaveDays,
        extraDuty: Number(saved?.extraDuty ?? 0),
        remarks: String(saved?.notes ?? ""),
        attendanceIncomplete: incomplete && !settled.manual,
        attendanceManualOverride: settled.manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: settled.daysRecorded,
        unrecordedDays: settled.unrecordedDays,
        attendanceExpectedDays: expectedDays,
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
        paymentType: normalizeTeacherPaymentType(
          (s as { paymentType?: string }).paymentType
        ),
        periodRateNpr: Number((s as { periodRateNpr?: number }).periodRateNpr ?? 0),
        periodsAttended: Number((s as { periodsAttended?: number }).periodsAttended ?? 0),
        tenderAmountNpr: Number((s as { tenderAmountNpr?: number }).tenderAmountNpr ?? 0),
        syllabusCompletedPercent: Number(
          (s as { syllabusCompletedPercent?: number }).syllabusCompletedPercent ?? 0
        ),
        syllabusAlreadyPaidPercent: Number(
          (s as { syllabusAlreadyPaidPercent?: number }).syllabusAlreadyPaidPercent ?? 0
        ),
        syllabusThisMonthPercent: Number(
          (s as { syllabusThisMonthPercent?: number }).syllabusThisMonthPercent ?? 0
        ),
        syllabusRemainingPercent: Number(
          (s as { syllabusRemainingPercent?: number }).syllabusRemainingPercent ?? 100
        ),
        tenderAlreadyPaidNpr: Number(
          (s as { tenderAlreadyPaidNpr?: number }).tenderAlreadyPaidNpr ?? 0
        ),
        tenderThisMonthNpr: Number(
          (s as { tenderThisMonthNpr?: number }).tenderThisMonthNpr ?? 0
        ),
        payBreakdown: String((s as { payBreakdown?: string }).payBreakdown ?? ""),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        leaveDays: Number((s as { leaveDays?: number }).leaveDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: manual,
        valuesManualOverride: valuesManual,
        attendanceDaysRecorded: 0,
        unrecordedDays: 0,
        attendanceExpectedDays: 0,
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
        ...emptyPay(),
        presentDays: Number(s.presentDays ?? 0),
        absentDays: Number(s.absentDays ?? 0),
        leaveDays: Number((s as { leaveDays?: number }).leaveDays ?? 0),
        extraDuty: Number(s.extraDuty ?? 0),
        remarks: String(s.notes ?? ""),
        attendanceIncomplete: false,
        attendanceManualOverride: manual,
        valuesManualOverride: true,
        attendanceDaysRecorded: 0,
        unrecordedDays: 0,
        attendanceExpectedDays: 0,
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

  const rows = drafts.map((d, index) => {
    const calc = calculateSalarySheetLine({
      paymentType: d.paymentType,
      monthlySalaryNpr: d.monthlySalaryNpr,
      presentDays: d.presentDays,
      absentDays: d.absentDays,
      leaveDays: d.leaveDays,
      extraDuty: d.extraDuty,
      workingDaysInMonth,
      extraAmountOverrideNpr: d.extraAmountOverrideNpr,
      periodRateNpr: d.periodRateNpr,
      periodsAttended: d.periodsAttended,
      tenderThisMonthNpr: d.tenderThisMonthNpr
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
      paymentType: d.paymentType,
      periodRateNpr: d.periodRateNpr,
      periodsAttended: d.periodsAttended,
      tenderAmountNpr: d.tenderAmountNpr,
      syllabusCompletedPercent: d.syllabusCompletedPercent,
      syllabusAlreadyPaidPercent: d.syllabusAlreadyPaidPercent,
      syllabusThisMonthPercent: d.syllabusThisMonthPercent,
      syllabusRemainingPercent: d.syllabusRemainingPercent,
      tenderAlreadyPaidNpr: d.tenderAlreadyPaidNpr,
      tenderThisMonthNpr: d.tenderThisMonthNpr,
      payBreakdown: d.payBreakdown,
      presentDays: d.presentDays,
      absentDays: d.absentDays,
      leaveDays: d.leaveDays,
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
      attendanceExpectedDays: d.attendanceExpectedDays,
      unrecordedDays: d.unrecordedDays,
      workingDaysInMonth,
      salaryPaymentId: d.salaryPaymentId,
      status: d.status as
        | "DRAFT"
        | "PROCESSED"
        | "PENDING_APPROVAL"
        | "APPROVED"
        | "PAID"
        | undefined
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
  const teacherCoverageDays = attendance.teacherCoverageDays;
  const staffCoverageDays = attendance.staffCoverageDays;
  const calendarDaysInMonth = attendance.calendarDaysInMonth;
  const saturdayDaysInMonth = attendance.saturdayDaysInMonth;
  const otherHolidayDaysInMonth = attendance.otherHolidayDaysInMonth;
  const holidayDaysInMonth = attendance.holidayDaysInMonth;
  const incompleteCount = rows.filter((r) => r.attendanceIncomplete).length;

  const attendanceWarning =
    coverageDays === 0
      ? `No staff/teacher attendance records found for ${monthBs}. Every working day is paid as present — authorized users may enter absences and leaves manually.`
      : anyIncomplete
        ? `Attendance is incomplete for ${incompleteCount} of ${rows.length} employee(s) in ${monthBs}. ` +
          `${monthBs} has ${calendarDaysInMonth} calendar days − ${saturdayDaysInMonth} Saturday(s) − ${otherHolidayDaysInMonth} other holiday(s) = ${workingDaysInMonth} working days; ` +
          `registers were taken on ${teacherCoverageDays} teacher day(s) and ${staffCoverageDays} staff day(s). ` +
          `Leave and absence deduct per working day. Saturdays and calendar holidays are excluded from working days. ` +
          `Working days with no attendance record are paid as present — review the flagged rows before submitting.`
        : undefined;

  return {
    monthBs,
    workingDaysInMonth,
    calendarDaysInMonth,
    saturdayDaysInMonth,
    otherHolidayDaysInMonth,
    holidayDaysInMonth,
    attendanceCoverageDays: coverageDays,
    attendanceCoverageDaysTeacher: teacherCoverageDays,
    attendanceCoverageDaysStaff: staffCoverageDays,
    attendanceIncomplete: anyIncomplete || coverageDays === 0,
    attendanceWarning,
    rows,
    totals
  };
};
