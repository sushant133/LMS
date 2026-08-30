/**
 * Traditional Attendance Register — person × day matrix for a BS month.
 * Read for granted staff; cell edits are Administrator-only.
 */
import type { Request, Response } from "express";
import {
  ATTENDANCE_REGISTER_STATUS_LABELS,
  canAccessModule,
  canApproveRecords,
  DAILY_ATTENDANCE_STATUSES,
  EMPLOYEE_ATTENDANCE_STATUSES,
  hasInstitutionAccess,
  isSystemAdministrator,
  normalizeUserRole,
  toAttendanceRegisterCode,
  type AttendanceRegisterCell,
  type AttendanceRegisterDayMeta,
  type AttendanceRegisterPersonRow,
  type AttendanceRegisterResponse,
  type AttendanceRegisterRowSummary,
  type AttendanceRegisterStats,
  type AttendanceRegisterTab,
  type EmployeeAttendanceStatus,
  type ModuleAccessMap
} from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { FieldDutyAttendance } from "../models/FieldDutyAttendance.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { Setting } from "../models/Setting.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { syncDailyAttendanceToSubject } from "../utils/dailyAttendanceUtils.js";
import {
  ensureValidBsDate,
  getDayOfWeekFromBs,
  getDaysInBsMonth,
  getTodayBs
} from "../utils/nepaliDate.js";
import { getUserModuleAccessMap, getUserSecondaryRoles } from "../utils/moduleAccessService.js";
import { sendSuccess } from "../utils/response.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { tenantObjectId } from "../utils/tenant.js";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

const BS_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Asar",
  "Shrawan",
  "Bhadra",
  "Ashoj",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra"
] as const;

const parseMonthBs = (raw: unknown): { monthBs: string; year: number; month: number } => {
  const monthBs = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(monthBs)) {
    throw new ApiError(400, "monthBs is required (YYYY-MM BS)");
  }
  const [y, m] = monthBs.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new ApiError(400, "Invalid monthBs");
  }
  return { monthBs, year: y, month: m };
};

const emptySummary = (): AttendanceRegisterRowSummary => ({
  present: 0,
  absent: 0,
  leave: 0,
  late: 0,
  holiday: 0,
  halfDay: 0,
  officialDuty: 0,
  fieldDuty: 0,
  other: 0,
  workingDays: 0,
  markedDays: 0,
  percentage: 0
});

const buildSummary = (
  cells: Record<string, AttendanceRegisterCell>,
  days: AttendanceRegisterDayMeta[],
  excludeSaturdayFromPercent = true
): AttendanceRegisterRowSummary => {
  const s = emptySummary();
  for (const day of days) {
    const cell = cells[day.dateBs];
    const status = (cell?.status ?? "").toUpperCase();
    if (!status) continue;
    s.markedDays += 1;

    if (status === "PRESENT") s.present += 1;
    else if (status === "ABSENT") s.absent += 1;
    else if (status === "LEAVE" || status === "MEDICAL_LEAVE") s.leave += 1;
    else if (status === "LATE") s.late += 1;
    else if (status === "HOLIDAY") s.holiday += 1;
    else if (status === "HALF_DAY") s.halfDay += 1;
    else if (status === "OFFICIAL_DUTY") s.officialDuty += 1;
    else if (
      status === "FIELD_DUTY" ||
      status === "EMERGENCY_DUTY" ||
      status === "NIGHT_DUTY" ||
      status === "EVENING_DUTY" ||
      status === "MORNING_DUTY"
    ) {
      s.fieldDuty += 1;
    } else s.other += 1;

    const skipPercent =
      status === "HOLIDAY" || (excludeSaturdayFromPercent && day.isSaturday && status === "HOLIDAY");
    if (!skipPercent && status !== "HOLIDAY") {
      s.workingDays += 1;
    }
  }

  // Present-like: PRESENT, LATE, HALF_DAY, OFFICIAL_DUTY, field duties
  const presentLike =
    s.present + s.late + s.halfDay + s.officialDuty + s.fieldDuty;
  const denom = s.workingDays > 0 ? s.workingDays : s.markedDays;
  s.percentage =
    denom > 0 ? Number(((presentLike / denom) * 100).toFixed(1)) : 0;
  return s;
};

const buildDays = (year: number, month: number): AttendanceRegisterDayMeta[] => {
  const count = getDaysInBsMonth(year, month);
  const days: AttendanceRegisterDayMeta[] = [];
  for (let d = 1; d <= count; d += 1) {
    const dateBs = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayOfWeek = getDayOfWeekFromBs(dateBs);
    days.push({
      dateBs,
      dayOfMonth: d,
      weekday: WEEKDAY_FULL[dayOfWeek] ?? "Sunday",
      weekdayShort: WEEKDAY_SHORT[dayOfWeek] ?? "Sun",
      dayOfWeek,
      isSaturday: dayOfWeek === 6
    });
  }
  return days;
};

const monthLabel = (year: number, month: number): string =>
  `${BS_MONTH_NAMES[month - 1] ?? `Month ${month}`} ${year}`;

const legendFromStatuses = (statuses: string[]) => {
  const seen = new Set<string>();
  const out: AttendanceRegisterResponse["legend"] = [];
  for (const status of statuses) {
    const key = status.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      status: key,
      code: toAttendanceRegisterCode(key) ?? key,
      label: ATTENDANCE_REGISTER_STATUS_LABELS[key] ?? key.replace(/_/g, " ")
    });
  }
  return out;
};

type AccessCtx = {
  adminLike: boolean;
  moduleAccess: ModuleAccessMap;
  canStudentRegister: boolean;
  canTeacherRegister: boolean;
  canStaffRegister: boolean;
};

const resolveAccess = async (req: Request): Promise<AccessCtx> => {
  const role = normalizeUserRole(req.user?.role ?? "");
  const adminLike =
    isSystemAdministrator(role) ||
    hasInstitutionAccess(role) ||
    role === "PRINCIPAL";
  const moduleAccess = req.user?.userId
    ? await getUserModuleAccessMap(req.user.userId)
    : ({} as ModuleAccessMap);

  const canStudentRegister =
    adminLike ||
    canAccessModule(moduleAccess, "daily-attendance") ||
    canAccessModule(moduleAccess, "attendance") ||
    canAccessModule(moduleAccess, "field-duty") ||
    role === "TEACHER" ||
    role === "STUDENT";

  const canTeacherRegister =
    adminLike ||
    canAccessModule(moduleAccess, "teacher-attendance") ||
    canAccessModule(moduleAccess, "attendance") ||
    role === "TEACHER";

  const canStaffRegister =
    adminLike ||
    canAccessModule(moduleAccess, "staff-attendance") ||
    role === "COLLEGE_STAFF";

  return {
    adminLike,
    moduleAccess,
    canStudentRegister,
    canTeacherRegister,
    canStaffRegister
  };
};

const computeStats = (
  rows: AttendanceRegisterPersonRow[],
  todayBs: string
): AttendanceRegisterStats => {
  let presentToday = 0;
  let absentToday = 0;
  let leaveToday = 0;
  let officialDutyToday = 0;
  let fieldDutyToday = 0;
  let markedToday = 0;

  for (const row of rows) {
    const cell = row.cells[todayBs];
    const st = (cell?.status ?? "").toUpperCase();
    if (!st) continue;
    markedToday += 1;
    if (st === "PRESENT" || st === "LATE" || st === "HALF_DAY") presentToday += 1;
    else if (st === "ABSENT") absentToday += 1;
    else if (st === "LEAVE" || st === "MEDICAL_LEAVE") leaveToday += 1;
    else if (st === "OFFICIAL_DUTY") officialDutyToday += 1;
    else if (
      st === "FIELD_DUTY" ||
      st === "EMERGENCY_DUTY" ||
      st === "NIGHT_DUTY" ||
      st === "EVENING_DUTY" ||
      st === "MORNING_DUTY"
    ) {
      fieldDutyToday += 1;
    }
  }

  return {
    totalPeople: rows.length,
    presentToday,
    absentToday,
    leaveToday,
    officialDutyToday,
    fieldDutyToday,
    attendancePercentToday:
      markedToday > 0
        ? Number(
            (
              ((presentToday + officialDutyToday + fieldDutyToday) / markedToday) *
              100
            ).toFixed(1)
          )
        : 0,
    todayBs
  };
};

const q = (req: Request, key: string): string =>
  String(req.query[key] ?? "").trim();

const assertRegisterAdmin = async (req: Request): Promise<void> => {
  const role = normalizeUserRole(req.user?.role ?? "");
  if (canApproveRecords(role)) return;
  const secondary = req.user?.userId ? await getUserSecondaryRoles(req.user.userId) : [];
  if (secondary.some((r) => canApproveRecords(normalizeUserRole(r)))) return;
  throw new ApiError(403, "Only the Administrator can edit the attendance register");
};

const FIELD_ENTRY_STATUSES = ["PRESENT", "ABSENT", "LATE", "LEAVE", "EMERGENCY_DUTY"] as const;
const DAILY_STATUS_SET = new Set<string>(DAILY_ATTENDANCE_STATUSES);
const EMPLOYEE_STATUS_SET = new Set<string>(EMPLOYEE_ATTENDANCE_STATUSES);
const FIELD_STATUS_SET = new Set<string>(FIELD_ENTRY_STATUSES);

const entryStudentId = (raw: unknown): string => {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw && "_id" in raw) {
    return String((raw as { _id: unknown })._id);
  }
  return String(raw);
};

/** GET /api/attendance-register/students */
export const getStudentAttendanceRegister = asyncHandler(
  async (req: Request, res: Response) => {
    const access = await resolveAccess(req);
    if (!access.canStudentRegister) {
      throw new ApiError(403, "You do not have access to the student attendance register");
    }

    const schoolId = tenantObjectId(req);
    const { monthBs, year, month } = parseMonthBs(req.query.monthBs);
    const days = buildDays(year, month);
    const todayBs = getTodayBs();
    const institutionType = await getInstitutionType(req);
    const college = isCollege(institutionType);

    const batchId = q(req, "batchId");
    const yearId = q(req, "yearId");
    const classId = q(req, "classId");
    const sectionId = q(req, "sectionId");
    const academicStatus = q(req, "academicStatus") || "ACTIVE";
    const search = q(req, "search").toLowerCase();

    const studentFilter: Record<string, unknown> = { schoolId };
    if (academicStatus && academicStatus !== "ALL") {
      if (academicStatus === "ACTIVE") {
        studentFilter.$or = [
          { academicStatus: "ACTIVE" },
          { academicStatus: { $exists: false } },
          { academicStatus: null }
        ];
      } else {
        studentFilter.academicStatus = academicStatus;
      }
    }
    if (college) {
      if (batchId) studentFilter.batchId = batchId;
      if (yearId) studentFilter.yearId = yearId;
    } else {
      if (classId) studentFilter.classId = classId;
      if (sectionId) studentFilter.sectionId = sectionId;
    }

    // Teachers: only assigned groups
    const role = normalizeUserRole(req.user?.role ?? "");
    if (role === "TEACHER" && !access.adminLike) {
      const scope = await getTeacherScope(req);
      if (scope) {
        if (college) {
          if (scope.batchIds.length) {
            studentFilter.batchId = batchId
              ? batchId
              : { $in: scope.batchIds };
          }
          if (scope.yearIds.length) {
            studentFilter.yearId = yearId ? yearId : { $in: scope.yearIds };
          }
        } else {
          if (scope.classIds.length) {
            studentFilter.classId = classId
              ? classId
              : { $in: scope.classIds };
          }
          if (scope.sectionIds.length) {
            studentFilter.sectionId = sectionId
              ? sectionId
              : { $in: scope.sectionIds };
          }
        }
      }
    }

    // Students: own row only
    if (role === "STUDENT") {
      const me = await Student.findOne({
        schoolId,
        user: req.user!.userId
      })
        .select("_id")
        .lean();
      if (!me) throw new ApiError(404, "Student profile not found");
      studentFilter._id = me._id;
    }

    let students = await Student.find(studentFilter)
      .populate("user", "fullName profilePhotoUrl")
      .select(
        "user rollNumber admissionNumber batchId yearId classId sectionId academicStatus photoUrl"
      )
      .sort({ rollNumber: 1, createdAt: 1 })
      .limit(2000)
      .lean();

    if (search) {
      students = students.filter((s) => {
        const name = ((s.user as { fullName?: string } | null)?.fullName ?? "").toLowerCase();
        const adm = (s.admissionNumber ?? "").toLowerCase();
        return name.includes(search) || adm.includes(search);
      });
    }

    const [batches, years, classes, sections] = await Promise.all([
      Batch.find({ schoolId }).select("_id name").lean(),
      Year.find({ schoolId }).select("_id name").lean(),
      SchoolClass.find({ schoolId }).select("_id name").lean(),
      Section.find({ schoolId }).select("_id name").lean()
    ]);
    const batchName = new Map(batches.map((b) => [b._id.toString(), b.name]));
    const yearName = new Map(years.map((y) => [y._id.toString(), y.name]));
    const className = new Map(classes.map((c) => [c._id.toString(), c.name]));
    const sectionName = new Map(sections.map((s) => [s._id.toString(), s.name]));

    const attFilter: Record<string, unknown> = {
      schoolId,
      dateBs: { $gte: `${monthBs}-01`, $lt: `${monthBs}-32` },
      status: { $in: ["SUBMITTED", "LOCKED"] }
    };
    if (college) {
      if (batchId) attFilter.batchId = batchId;
      if (yearId) attFilter.yearId = yearId;
    } else {
      if (classId) attFilter.classId = classId;
      if (sectionId) attFilter.sectionId = sectionId;
    }

    const sheets = await DailyAttendance.find(attFilter)
      .select("dateBs entries teacherId createdBy")
      .lean();

    // personId → dateBs → cell (daily sheet: one status per student per day; last wins)
    const byPerson = new Map<string, Map<string, AttendanceRegisterCell>>();
    for (const sheet of sheets) {
      const dateBs = sheet.dateBs;
      for (const entry of sheet.entries ?? []) {
        const sid = entry.studentId?.toString();
        if (!sid) continue;
        if (!byPerson.has(sid)) byPerson.set(sid, new Map());
        byPerson.get(sid)!.set(dateBs, {
          dateBs,
          status: entry.status,
          code: toAttendanceRegisterCode(entry.status),
          remarks: entry.remarks || undefined,
          source: "DAILY_ATTENDANCE",
          attendanceDocId: sheet._id.toString()
        });
      }
    }

    /**
     * Merge Field Management attendance (roster + date-wise marks).
     * Classroom daily sheet wins when already present; otherwise field marks fill the cell.
     * Present / emergency on field → FIELD_DUTY (F) so register distinguishes field duty days.
     */
    const fieldFilter: Record<string, unknown> = {
      schoolId,
      dateBs: { $gte: `${monthBs}-01`, $lt: `${monthBs}-32` },
      status: { $in: ["SUBMITTED", "LOCKED"] },
      isDeleted: { $ne: true }
    };
    if (college) {
      if (batchId) fieldFilter.batchId = batchId;
      if (yearId) fieldFilter.yearId = yearId;
    }
    const fieldSheets = await FieldDutyAttendance.find(fieldFilter)
      .select("dateBs shift siteName hospitalName entries status")
      .lean();

    const mapFieldStatus = (raw: string): string => {
      const st = (raw || "").toUpperCase();
      if (st === "PRESENT" || st === "EMERGENCY_DUTY") return "FIELD_DUTY";
      if (st === "LATE") return "LATE";
      if (st === "LEAVE") return "LEAVE";
      if (st === "ABSENT") return "ABSENT";
      return st || "FIELD_DUTY";
    };

    // Prefer present-like field marks when multiple shifts same day
    const fieldRank = (status: string): number => {
      const s = status.toUpperCase();
      if (s === "FIELD_DUTY" || s === "PRESENT" || s === "EMERGENCY_DUTY") return 4;
      if (s === "LATE") return 3;
      if (s === "LEAVE") return 2;
      if (s === "ABSENT") return 1;
      return 0;
    };

    for (const sheet of fieldSheets) {
      const dateBs = sheet.dateBs;
      const site =
        (sheet.siteName || sheet.hospitalName || "Field").toString().trim() || "Field";
      const shift = (sheet.shift || "DAY").toString();
      for (const entry of sheet.entries ?? []) {
        const sid = entry.studentId?.toString();
        if (!sid) continue;
        if (!byPerson.has(sid)) byPerson.set(sid, new Map());
        const dayMap = byPerson.get(sid)!;
        const existing = dayMap.get(dateBs);
        // Never overwrite classroom daily attendance
        if (existing && existing.source === "DAILY_ATTENDANCE" && existing.status) {
          continue;
        }
        const mapped = mapFieldStatus(entry.status);
        if (existing?.source === "FIELD_DUTY" && existing.status) {
          if (fieldRank(mapped) <= fieldRank(existing.status)) continue;
        }
        dayMap.set(dateBs, {
          dateBs,
          status: mapped,
          code: toAttendanceRegisterCode(mapped),
          remarks: entry.remarks || undefined,
          source: "FIELD_DUTY",
          locationLabel: `${site} · ${shift.replace(/_/g, " ")}`,
          attendanceDocId: sheet._id.toString()
        });
      }
    }

    const rows: AttendanceRegisterPersonRow[] = students.map((student, index) => {
      const id = student._id.toString();
      const user = student.user as {
        fullName?: string;
        profilePhotoUrl?: string;
      } | null;
      const dayMap = byPerson.get(id) ?? new Map();
      const cells: Record<string, AttendanceRegisterCell> = {};
      for (const day of days) {
        cells[day.dateBs] = dayMap.get(day.dateBs) ?? {
          dateBs: day.dateBs,
          status: null,
          code: null
        };
      }
      return {
        personId: id,
        personType: "STUDENT",
        sn: index + 1,
        fullName: user?.fullName ?? "Student",
        code: student.admissionNumber,
        rollNumber: student.rollNumber ?? undefined,
        photoUrl: student.photoUrl || user?.profilePhotoUrl || undefined,
        batchName: student.batchId
          ? batchName.get(student.batchId.toString())
          : undefined,
        yearName: student.yearId
          ? yearName.get(student.yearId.toString())
          : undefined,
        className: student.classId
          ? className.get(student.classId.toString())
          : undefined,
        sectionName: student.sectionId
          ? sectionName.get(student.sectionId.toString())
          : undefined,
        academicStatus: student.academicStatus ?? "ACTIVE",
        cells,
        summary: buildSummary(cells, days)
      };
    });

    const scopeParts = [
      batchId ? batchName.get(batchId) : null,
      yearId ? yearName.get(yearId) : null,
      classId ? className.get(classId) : null,
      sectionId ? sectionName.get(sectionId) : null
    ].filter(Boolean);

    const payload: AttendanceRegisterResponse = {
      tab: "STUDENT",
      monthBs,
      monthLabel: monthLabel(year, month),
      scopeLabel: scopeParts.length ? scopeParts.join(" · ") : "All students",
      days,
      rows,
      stats: computeStats(rows, todayBs),
      legend: legendFromStatuses([
        "PRESENT",
        "ABSENT",
        "LEAVE",
        "LATE",
        "MEDICAL_LEAVE",
        "HOLIDAY",
        "FIELD_DUTY",
        "EMERGENCY_DUTY",
        "NIGHT_DUTY",
        "EVENING_DUTY",
        "MORNING_DUTY"
      ]),
      filtersEcho: {
        monthBs,
        batchId,
        yearId,
        classId,
        sectionId,
        academicStatus,
        search
      },
      generatedAt: new Date().toISOString()
    };

    return sendSuccess(res, "Student attendance register", payload);
  }
);

const loadEmployeeRegister = async (
  req: Request,
  category: "TEACHER" | "STAFF",
  tab: AttendanceRegisterTab
): Promise<AttendanceRegisterResponse> => {
  const access = await resolveAccess(req);
  if (category === "TEACHER" && !access.canTeacherRegister) {
    throw new ApiError(403, "You do not have access to the teacher attendance register");
  }
  if (category === "STAFF" && !access.canStaffRegister) {
    throw new ApiError(403, "You do not have access to the staff attendance register");
  }

  const schoolId = tenantObjectId(req);
  const { monthBs, year, month } = parseMonthBs(req.query.monthBs);
  const days = buildDays(year, month);
  const todayBs = getTodayBs();
  const department = q(req, "department");
  const designation = q(req, "designation");
  const search = q(req, "search").toLowerCase();
  const role = normalizeUserRole(req.user?.role ?? "");

  type Person = {
    id: string;
    fullName: string;
    code: string;
    department: string;
    designation: string;
    photoUrl?: string;
  };

  let people: Person[] = [];

  if (category === "TEACHER") {
    const filter: Record<string, unknown> = {
      schoolId,
      status: { $ne: "INACTIVE" }
    };
    if (role === "TEACHER" && !access.adminLike) {
      const t = await Teacher.findOne({ schoolId, user: req.user!.userId })
        .select("_id")
        .lean();
      if (!t) throw new ApiError(404, "Teacher profile not found");
      filter._id = t._id;
    }
    const teachers = await Teacher.find(filter)
      .populate("user", "fullName profilePhotoUrl designation department")
      .select("user teacherCode qualification photoUrl")
      .sort({ createdAt: 1 })
      .limit(1500)
      .lean();
    people = teachers.map((t) => {
      const u = t.user as {
        fullName?: string;
        profilePhotoUrl?: string;
        designation?: string;
        department?: string;
      } | null;
      return {
        id: t._id.toString(),
        fullName: u?.fullName ?? "Teacher",
        code: t.teacherCode || t._id.toString().slice(-6),
        department: u?.department || "",
        designation: u?.designation || t.qualification || "",
        photoUrl: t.photoUrl || u?.profilePhotoUrl
      };
    });
  } else {
    const filter: Record<string, unknown> = {
      schoolId,
      $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }]
    };
    if (role === "COLLEGE_STAFF" && !access.adminLike) {
      const s = await CollegeStaff.findOne({ schoolId, user: req.user!.userId })
        .select("_id")
        .lean();
      if (!s) throw new ApiError(404, "Staff profile not found");
      filter._id = s._id;
    }
    const staff = await CollegeStaff.find(filter)
      .populate("user", "fullName profilePhotoUrl")
      .select("user staffId department designation photoUrl")
      .sort({ createdAt: 1 })
      .limit(1500)
      .lean();
    people = staff.map((s) => ({
      id: s._id.toString(),
      fullName: (s.user as { fullName?: string } | null)?.fullName ?? "Staff",
      code: s.staffId || s._id.toString().slice(-6),
      department: s.department || "",
      designation: s.designation || "",
      photoUrl:
        s.photoUrl ||
        (s.user as { profilePhotoUrl?: string } | null)?.profilePhotoUrl
    }));
  }

  if (department) {
    people = people.filter(
      (p) => p.department.toLowerCase() === department.toLowerCase()
    );
  }
  if (designation) {
    people = people.filter(
      (p) => p.designation.toLowerCase() === designation.toLowerCase()
    );
  }
  if (search) {
    people = people.filter(
      (p) =>
        p.fullName.toLowerCase().includes(search) ||
        p.code.toLowerCase().includes(search) ||
        p.department.toLowerCase().includes(search)
    );
  }

  const sheets = await EmployeeAttendance.find({
    schoolId,
    category,
    isDeleted: { $ne: true },
    dateBs: { $gte: `${monthBs}-01`, $lt: `${monthBs}-32` },
    status: {
      $in: ["DRAFT", "CHECK_IN_SUBMITTED", "CHECK_OUT_SUBMITTED", "SUBMITTED", "LOCKED"]
    }
  })
    .select("dateBs entries")
    .lean();

  const byPerson = new Map<string, Map<string, AttendanceRegisterCell>>();
  for (const sheet of sheets) {
    for (const entry of sheet.entries ?? []) {
      const pid =
        category === "TEACHER"
          ? entry.teacherId?.toString()
          : entry.staffId?.toString();
      if (!pid) continue;
      if (!byPerson.has(pid)) byPerson.set(pid, new Map());
      byPerson.get(pid)!.set(sheet.dateBs, {
        dateBs: sheet.dateBs,
        status: entry.status,
        code: toAttendanceRegisterCode(entry.status),
        remarks: entry.remarks || undefined,
        checkInTime: entry.checkInTime || undefined,
        checkOutTime: entry.checkOutTime || undefined,
        source: entry.source || undefined,
        locationLabel:
          entry.geo?.lat != null && entry.geo?.lng != null
            ? `${entry.geo.lat.toFixed(5)}, ${entry.geo.lng.toFixed(5)}`
            : undefined,
        attendanceDocId: sheet._id.toString()
      });
    }
  }

  const rows: AttendanceRegisterPersonRow[] = people.map((person, index) => {
    const dayMap = byPerson.get(person.id) ?? new Map();
    const cells: Record<string, AttendanceRegisterCell> = {};
    for (const day of days) {
      cells[day.dateBs] = dayMap.get(day.dateBs) ?? {
        dateBs: day.dateBs,
        status: null,
        code: null
      };
    }
    return {
      personId: person.id,
      personType: category,
      sn: index + 1,
      fullName: person.fullName,
      code: person.code,
      photoUrl: person.photoUrl,
      department: person.department,
      designation: person.designation,
      cells,
      summary: buildSummary(cells, days)
    };
  });

  return {
    tab,
    monthBs,
    monthLabel: monthLabel(year, month),
    scopeLabel: category === "TEACHER" ? "Teachers" : "Staff",
    days,
    rows,
    stats: computeStats(rows, todayBs),
    legend: legendFromStatuses([
      "PRESENT",
      "ABSENT",
      "LEAVE",
      "LATE",
      "HALF_DAY",
      "OFFICIAL_DUTY",
      "HOLIDAY"
    ]),
    filtersEcho: { monthBs, department, designation, search, category },
    generatedAt: new Date().toISOString()
  };
};

/** GET /api/attendance-register/teachers */
export const getTeacherAttendanceRegister = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = await loadEmployeeRegister(req, "TEACHER", "TEACHER");
    return sendSuccess(res, "Teacher attendance register", payload);
  }
);

/** GET /api/attendance-register/staff */
export const getStaffAttendanceRegister = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = await loadEmployeeRegister(req, "STAFF", "STAFF");
    return sendSuccess(res, "Staff attendance register", payload);
  }
);

/** GET /api/attendance-register/cell-detail — optional enrichment for a cell click */
export const getAttendanceRegisterCellDetail = asyncHandler(
  async (req: Request, res: Response) => {
    const access = await resolveAccess(req);
    if (
      !access.canStudentRegister &&
      !access.canTeacherRegister &&
      !access.canStaffRegister
    ) {
      throw new ApiError(403, "Access denied");
    }

    const schoolId = tenantObjectId(req);
    const tab = (q(req, "tab") || "STUDENT").toUpperCase() as AttendanceRegisterTab;
    const personId = q(req, "personId");
    const dateBs = q(req, "dateBs");
    if (!personId || !dateBs) {
      throw new ApiError(400, "personId and dateBs are required");
    }

    if (tab === "STUDENT") {
      // Scope by tenant: findById alone returned the name of any student in
      // any institution for a guessed id, leaking PII across colleges.
      const student = await Student.findOne({ _id: personId, schoolId })
        .populate("user", "fullName")
        .lean();
      const personName =
        (student?.user as { fullName?: string } | null)?.fullName ?? "Student";

      const sheet = await DailyAttendance.findOne({
        schoolId,
        dateBs,
        "entries.studentId": personId
      })
        .populate("createdBy", "fullName")
        .lean();
      const entry = sheet?.entries?.find(
        (e) => e.studentId?.toString() === personId
      );
      if (entry) {
        return sendSuccess(res, "Cell detail", {
          personId,
          personName,
          dateBs,
          status: entry.status ?? null,
          editStatus: entry.status ?? null,
          code: toAttendanceRegisterCode(entry.status),
          remarks: entry.remarks,
          markedByName: (sheet?.createdBy as { fullName?: string } | null)
            ?.fullName,
          source: "DAILY_ATTENDANCE",
          attendanceDocId: sheet?._id?.toString(),
          batchName: undefined,
          yearName: undefined
        });
      }

      // Fall back to Field Management attendance (roster / date-wise marks)
      const fieldSheet = await FieldDutyAttendance.findOne({
        schoolId,
        dateBs,
        isDeleted: { $ne: true },
        status: { $in: ["SUBMITTED", "LOCKED"] },
        "entries.studentId": personId
      })
        .populate("createdBy", "fullName")
        .sort({ updatedAt: -1 })
        .lean();
      const fieldEntry = fieldSheet?.entries?.find(
        (e) => e.studentId?.toString() === personId
      );
      if (fieldEntry) {
        const raw = (fieldEntry.status || "").toUpperCase();
        const mapped =
          raw === "PRESENT" || raw === "EMERGENCY_DUTY" ? "FIELD_DUTY" : raw;
        const site = (fieldSheet?.siteName || fieldSheet?.hospitalName || "Field")
          .toString()
          .trim();
        const shift = (fieldSheet?.shift || "DAY").toString().replace(/_/g, " ");
        return sendSuccess(res, "Cell detail", {
          personId,
          personName,
          dateBs,
          status: mapped || null,
          editStatus: fieldEntry.status || null,
          code: toAttendanceRegisterCode(mapped),
          remarks: fieldEntry.remarks,
          markedByName: (fieldSheet?.createdBy as { fullName?: string } | null)
            ?.fullName,
          source: "FIELD_DUTY",
          attendanceDocId: fieldSheet?._id?.toString(),
          locationLabel: `${site} · ${shift}`,
          batchName: undefined,
          yearName: undefined
        });
      }

      return sendSuccess(res, "Cell detail", {
        personId,
        personName,
        dateBs,
        status: null,
        code: null,
        batchName: undefined,
        yearName: undefined
      });
    }

    const category = tab === "TEACHER" ? "TEACHER" : "STAFF";
    const sheet = await EmployeeAttendance.findOne({
      schoolId,
      category,
      dateBs,
      isDeleted: { $ne: true },
      ...(category === "TEACHER"
        ? { "entries.teacherId": personId }
        : { "entries.staffId": personId })
    }).lean();

    const entry = sheet?.entries?.find((e) =>
      category === "TEACHER"
        ? e.teacherId?.toString() === personId
        : e.staffId?.toString() === personId
    );

    return sendSuccess(res, "Cell detail", {
      personId,
      personName: entry?.fullName ?? "Employee",
      dateBs,
      status: entry?.status ?? null,
      editStatus: entry?.status ?? null,
      code: toAttendanceRegisterCode(entry?.status),
      checkInTime: entry?.checkInTime,
      checkOutTime: entry?.checkOutTime,
      remarks: entry?.remarks,
      source: entry?.source,
      attendanceDocId: sheet?._id?.toString(),
      locationLabel:
        entry?.geo?.lat != null && entry?.geo?.lng != null
          ? `${entry.geo.lat.toFixed(5)}, ${entry.geo.lng.toFixed(5)}`
          : undefined,
      department: entry?.department,
      designation: entry?.designation
    });
  }
);

/** GET /api/attendance-register/meta — filter helpers + permissions */
export const getAttendanceRegisterMeta = asyncHandler(
  async (req: Request, res: Response) => {
    const access = await resolveAccess(req);
    const schoolId = tenantObjectId(req);
    const todayBs = getTodayBs();
    const monthBs = todayBs.slice(0, 7);

    const [batches, years, classes, sections, deptsTeacher, deptsStaff] =
      await Promise.all([
        Batch.find({ schoolId }).select("_id name").sort({ name: 1 }).lean(),
        Year.find({ schoolId }).select("_id name batchId level").sort({ level: 1 }).lean(),
        SchoolClass.find({ schoolId }).select("_id name").sort({ name: 1 }).lean(),
        Section.find({ schoolId }).select("_id name classId").sort({ name: 1 }).lean(),
        Teacher.distinct("department", { schoolId }),
        CollegeStaff.distinct("department", { schoolId })
      ]);

    return sendSuccess(res, "Attendance register meta", {
      todayBs,
      defaultMonthBs: monthBs,
      canStudentRegister: access.canStudentRegister,
      canTeacherRegister: access.canTeacherRegister,
      canStaffRegister: access.canStaffRegister,
      batches,
      years,
      classes,
      sections,
      departments: [
        ...new Set(
          [...deptsTeacher, ...deptsStaff]
            .map((d) => String(d || "").trim())
            .filter(Boolean)
        )
      ].sort(),
      legend: legendFromStatuses([
        "PRESENT",
        "ABSENT",
        "LEAVE",
        "LATE",
        "HALF_DAY",
        "OFFICIAL_DUTY",
        "HOLIDAY",
        "FIELD_DUTY",
        "NIGHT_DUTY",
        "EVENING_DUTY",
        "MORNING_DUTY"
      ]),
      monthNames: BS_MONTH_NAMES
    });
  }
);

/**
 * PUT /api/attendance-register/cell
 * Administrator-only: change one person × day mark on the register.
 */
export const updateAttendanceRegisterCell = asyncHandler(
  async (req: Request, res: Response) => {
    await assertRegisterAdmin(req);
    const schoolId = tenantObjectId(req);
    const tab = String(req.body?.tab ?? "STUDENT").toUpperCase() as AttendanceRegisterTab;
    const personId = String(req.body?.personId ?? "").trim();
    const dateBs = ensureValidBsDate(String(req.body?.dateBs ?? "").trim());
    const status = String(req.body?.status ?? "").trim().toUpperCase();
    const remarks = String(req.body?.remarks ?? "").trim();
    if (!personId) throw new ApiError(400, "personId is required");
    if (!status) throw new ApiError(400, "status is required");

    const actorId = req.user!.userId;

    if (tab === "STUDENT") {
      const student = await Student.findOne({ _id: personId, schoolId }).lean();
      if (!student) throw new ApiError(404, "Student not found");

      const dailySheet = await DailyAttendance.findOne({
        schoolId,
        dateBs,
        "entries.studentId": personId
      });
      if (dailySheet) {
        if (!DAILY_STATUS_SET.has(status)) {
          throw new ApiError(400, `Invalid student attendance status: ${status}`);
        }
        for (const e of dailySheet.entries ?? []) {
          if (entryStudentId(e.studentId) === personId) {
            e.status = status as typeof e.status;
            e.remarks = remarks;
          }
        }
        dailySheet.lastEditedBy = actorId as never;
        dailySheet.markModified("entries");
        await dailySheet.save();
        const institutionType = await getInstitutionType(req);
        await syncDailyAttendanceToSubject(
          {
            _id: dailySheet._id.toString(),
            schoolId: schoolId.toString(),
            classId: dailySheet.classId?.toString(),
            sectionId: dailySheet.sectionId?.toString(),
            batchId: dailySheet.batchId?.toString(),
            yearId: dailySheet.yearId?.toString(),
            subjectId: dailySheet.subjectId.toString(),
            teacherId: dailySheet.teacherId.toString(),
            dateBs: dailySheet.dateBs,
            entries: (dailySheet.entries ?? []).map((e) => ({
              studentId: entryStudentId(e.studentId),
              status: String(e.status)
            })),
            createdBy: String(dailySheet.createdBy),
            syncedAttendanceId: dailySheet.syncedAttendanceId?.toString()
          },
          isCollege(institutionType),
          req.user!.userId,
          req.user!.role,
          null
        );
        await recordAudit(req, {
          action: "attendance_register.cell.update",
          entity: "DAILY_ATTENDANCE",
          entityId: dailySheet._id.toString(),
          after: { personId, dateBs, status }
        });
        return sendSuccess(res, "Register updated", {
          tab,
          personId,
          dateBs,
          status,
          code: toAttendanceRegisterCode(status),
          source: "DAILY_ATTENDANCE"
        });
      }

      const fieldSheet = await FieldDutyAttendance.findOne({
        schoolId,
        dateBs,
        isDeleted: { $ne: true },
        "entries.studentId": personId
      }).sort({ updatedAt: -1 });

      const fieldStatus =
        status === "FIELD_DUTY" ? "PRESENT" : status;
      if (fieldSheet) {
        if (!FIELD_STATUS_SET.has(fieldStatus)) {
          throw new ApiError(400, `Invalid field attendance status: ${status}`);
        }
        for (const e of fieldSheet.entries ?? []) {
          if (entryStudentId(e.studentId) === personId) {
            e.status = fieldStatus as typeof e.status;
            e.remarks = remarks;
          }
        }
        fieldSheet.markModified("entries");
        await fieldSheet.save();
        await recordAudit(req, {
          action: "attendance_register.cell.update",
          entity: "FIELD_DUTY_ATTENDANCE",
          entityId: fieldSheet._id.toString(),
          after: { personId, dateBs, status: fieldStatus }
        });
        return sendSuccess(res, "Register updated", {
          tab,
          personId,
          dateBs,
          status: fieldStatus,
          code: toAttendanceRegisterCode(
            fieldStatus === "PRESENT" || fieldStatus === "EMERGENCY_DUTY"
              ? "FIELD_DUTY"
              : fieldStatus
          ),
          source: "FIELD_DUTY"
        });
      }

      // Sheet exists for the student's group but this student was missing — add them.
      const groupFilter: Record<string, unknown> = { schoolId, dateBs };
      if (student.batchId && student.yearId) {
        groupFilter.batchId = student.batchId;
        groupFilter.yearId = student.yearId;
      } else if (student.classId && student.sectionId) {
        groupFilter.classId = student.classId;
        groupFilter.sectionId = student.sectionId;
      }
      const groupSheet = await DailyAttendance.findOne(groupFilter);
      if (groupSheet) {
        if (!DAILY_STATUS_SET.has(status)) {
          throw new ApiError(400, `Invalid student attendance status: ${status}`);
        }
        groupSheet.entries = [
          ...(groupSheet.entries ?? []),
          { studentId: personId as never, status, remarks }
        ] as never;
        groupSheet.lastEditedBy = actorId as never;
        await groupSheet.save();
        await recordAudit(req, {
          action: "attendance_register.cell.update",
          entity: "DAILY_ATTENDANCE",
          entityId: groupSheet._id.toString(),
          after: { personId, dateBs, status, added: true }
        });
        return sendSuccess(res, "Register updated", {
          tab,
          personId,
          dateBs,
          status,
          code: toAttendanceRegisterCode(status),
          source: "DAILY_ATTENDANCE"
        });
      }

      throw new ApiError(
        400,
        "No attendance has been taken for this date. Mark it from Daily Attendance or Field Management first, then you can edit it here."
      );
    }

    if (tab !== "TEACHER" && tab !== "STAFF") {
      throw new ApiError(400, "Invalid register tab");
    }
    if (!EMPLOYEE_STATUS_SET.has(status)) {
      throw new ApiError(400, `Invalid ${tab.toLowerCase()} attendance status: ${status}`);
    }

    const category = tab === "TEACHER" ? "TEACHER" : "STAFF";
    let fullName = "";
    let employeeCode = "";
    let department = "";
    let designation = "";
    let userId: string | undefined;
    if (category === "TEACHER") {
      const teacher = await Teacher.findOne({ _id: personId, schoolId })
        .populate("user", "fullName designation")
        .lean();
      if (!teacher) throw new ApiError(404, "Teacher not found");
      const user = teacher.user as { _id?: { toString(): string }; fullName?: string; designation?: string } | null;
      fullName = user?.fullName ?? teacher.teacherCode;
      employeeCode = teacher.teacherCode;
      department = user?.designation || "Teaching";
      designation = user?.designation || "Teacher";
      userId = user?._id?.toString();
    } else {
      const staff = await CollegeStaff.findOne({
        _id: personId,
        schoolId,
        isDeleted: false
      }).lean();
      if (!staff) throw new ApiError(404, "Staff not found");
      fullName = staff.fullName;
      employeeCode = staff.staffId;
      department = staff.department || "";
      designation = staff.designation || staff.category || "";
      userId = staff.user ? String(staff.user) : undefined;
    }

    const settings = await Setting.findOne({ schoolId }).select("academicYearBs").lean();
    let sheet = await EmployeeAttendance.findOne({
      schoolId,
      category,
      dateBs,
      isDeleted: false
    });
    if (!sheet) {
      sheet = await EmployeeAttendance.create({
        schoolId,
        category,
        dateBs,
        academicYearBs: settings?.academicYearBs ?? "",
        entries: [],
        notes: "",
        status: "DRAFT",
        sourceDefault: "MANUAL",
        createdBy: actorId
      });
    }

    const matchId = (entry: { teacherId?: unknown; staffId?: unknown }) =>
      String(category === "TEACHER" ? entry.teacherId : entry.staffId) === personId;
    const existingEntry = (sheet.entries ?? []).find(matchId);
    const nextEntry = {
      teacherId: category === "TEACHER" ? personId : undefined,
      staffId: category === "STAFF" ? personId : undefined,
      employeeUserId: userId,
      employeeCode,
      fullName,
      department,
      designation,
      status: status as EmployeeAttendanceStatus,
      checkInTime: existingEntry?.checkInTime ?? "",
      checkOutTime: existingEntry?.checkOutTime ?? "",
      periodsTaught: existingEntry?.periodsTaught,
      remarks,
      source: "MANUAL" as const
    };
    sheet.entries = [
      ...(sheet.entries ?? []).filter((e) => !matchId(e)),
      nextEntry
    ] as never;
    await sheet.save();
    await recordAudit(req, {
      action: "attendance_register.cell.update",
      entity: "EMPLOYEE_ATTENDANCE",
      entityId: sheet._id.toString(),
      after: { personId, dateBs, status, category }
    });
    return sendSuccess(res, "Register updated", {
      tab,
      personId,
      dateBs,
      status,
      code: toAttendanceRegisterCode(status),
      source: "EMPLOYEE_ATTENDANCE"
    });
  }
);
