import type { Request } from "express";
import type {
  FieldDutyAttendanceRecord,
  FieldDutyDashboard,
  FieldDutyMonitoringSummary,
  FieldDutyPortalSummary,
  FieldDutyScheduleRecord,
  FieldDutyStudentStatus,
  FieldPostingSection
} from "@phit-erp/shared";
import { canManageInstitution, postingTypeToSection } from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { FieldDutyAttendance } from "../models/FieldDutyAttendance.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { compareBsDates, ensureValidBsDate, getTodayBs } from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";
import { tenantObjectId } from "./tenant.js";

/** Resolve college staff record linked to the logged-in user (field coordinator). */
export const getFieldSupervisorStaffScope = async (
  req: Request
): Promise<{ staffId: string; fullName: string } | null> => {
  if (!req.user?.userId) return null;
  const staff = await CollegeStaff.findOne({
    schoolId: tenantObjectId(req),
    user: req.user.userId,
    status: "ACTIVE"
  })
    .select("_id fullName staffId")
    .lean();
  if (!staff) return null;
  return {
    staffId: staff._id.toString(),
    fullName: staff.fullName || staff.staffId || "Staff"
  };
};

const toId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "object" && value && "toString" in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value);
};

const schedulePrimaryId = (schedule: {
  supervisorStaffId?: unknown;
  supervisorTeacherId?: unknown;
}): string => toId(schedule.supervisorStaffId || schedule.supervisorTeacherId);

const scheduleAssistantIds = (schedule: Record<string, unknown> | {
  assistantCoordinatorStaffIds?: unknown;
}): string[] => {
  const raw = (schedule as { assistantCoordinatorStaffIds?: unknown })
    .assistantCoordinatorStaffIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => toId(id)).filter(Boolean);
};

/** All coordinator staff ids for a schedule (primary + assistants). */
export const scheduleCoordinatorIds = (schedule: {
  supervisorStaffId?: unknown;
  supervisorTeacherId?: unknown;
  assistantCoordinatorStaffIds?: unknown;
}): string[] => {
  const ids = new Set<string>();
  const primary = schedulePrimaryId(schedule);
  if (primary) ids.add(primary);
  for (const id of scheduleAssistantIds(schedule)) ids.add(id);
  return [...ids];
};

export const isCoordinatorOfSchedule = (
  staffId: string,
  schedule: {
    supervisorStaffId?: unknown;
    supervisorTeacherId?: unknown;
    assistantCoordinatorStaffIds?: unknown;
  }
): boolean => scheduleCoordinatorIds(schedule).includes(staffId);

export const emptyToUndef = (value?: string | null) => {
  const t = value?.trim();
  return t ? t : undefined;
};

export const resolveSiteName = (row: Record<string, unknown> | {
  siteName?: unknown;
  hospitalName?: unknown;
}): string => {
  const r = row as { siteName?: unknown; hospitalName?: unknown };
  const site = String(r.siteName ?? "").trim();
  if (site) return site;
  return String(r.hospitalName ?? "").trim();
};

export const resolvePostingType = (
  row: Record<string, unknown> | { postingType?: unknown }
): string => {
  const t = String((row as { postingType?: unknown }).postingType ?? "HOSPITAL")
    .trim()
    .toUpperCase();
  return t || "HOSPITAL";
};

export const summarizeEntries = (
  entries: Array<{ status: string }>
): NonNullable<FieldDutyAttendanceRecord["summary"]> => {
  const summary = {
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    emergencyDuty: 0,
    total: entries.length
  };
  for (const e of entries) {
    if (e.status === "PRESENT") summary.present += 1;
    else if (e.status === "ABSENT") summary.absent += 1;
    else if (e.status === "LATE") summary.late += 1;
    else if (e.status === "LEAVE") summary.leave += 1;
    else if (e.status === "EMERGENCY_DUTY") summary.emergencyDuty += 1;
  }
  return summary;
};

/** Present count for percentage (PRESENT + EMERGENCY + optional LATE). */
export const presentForPercent = (
  summary: { present: number; late: number; emergencyDuty: number },
  countLateAsPresent = true
) => summary.present + summary.emergencyDuty + (countLateAsPresent ? summary.late : 0);

/**
 * Students for a field posting roster.
 * MANUAL → assignedStudentIds only; AUTO_BATCH_YEAR → active batch+year students.
 * If MANUAL has no assignments, falls back to empty list (admin must assign).
 */
export const getEligibleStudentsForDuty = async (
  schoolId: unknown,
  batchId: string,
  yearId: string,
  options?: {
    rosterMode?: string;
    assignedStudentIds?: unknown[];
  }
) => {
  const mode = options?.rosterMode || "AUTO_BATCH_YEAR";
  const assigned = (options?.assignedStudentIds ?? []).map((id) => toId(id)).filter(Boolean);

  let students;
  if (mode === "MANUAL") {
    if (!assigned.length) return [];
    students = await Student.find({
      schoolId,
      _id: { $in: assigned },
      academicStatus: "ACTIVE"
    })
      .populate("user", "fullName")
      .sort({ rollNumber: 1 })
      .lean();
  } else {
    students = await Student.find({
      schoolId,
      batchId,
      yearId,
      academicStatus: "ACTIVE"
    })
      .populate("user", "fullName")
      .sort({ rollNumber: 1 })
      .lean();
  }

  return students.map((s) => {
    const user = s.user as unknown as { fullName?: string } | null;
    return {
      _id: s._id.toString(),
      fullName: user?.fullName ?? "Student",
      admissionNumber: s.admissionNumber,
      rollNumber: s.rollNumber,
      batchId: s.batchId?.toString(),
      yearId: s.yearId?.toString()
    };
  });
};

export const assertScheduleAccess = async (
  req: Request,
  schedule: {
    supervisorStaffId?: unknown;
    supervisorTeacherId?: unknown;
    assistantCoordinatorStaffIds?: unknown;
  }
) => {
  if (canManageInstitution(req.user?.role ?? "")) return;
  const staffScope = await getFieldSupervisorStaffScope(req);
  if (staffScope && isCoordinatorOfSchedule(staffScope.staffId, schedule)) return;
  throw new ApiError(
    403,
    "Only an assigned field coordinator (staff) or an administrator can access this posting"
  );
};

/** Mongo filter for schedules visible to the current user (admin = all; staff = assigned). */
export const scheduleAccessFilter = async (
  req: Request,
  base: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  const filter = { ...base };
  if (canManageInstitution(req.user?.role ?? "")) return filter;
  const staffScope = await getFieldSupervisorStaffScope(req);
  if (!staffScope) {
    throw new ApiError(403, "Not allowed to list field postings");
  }
  filter.$or = [
    { supervisorStaffId: staffScope.staffId },
    { assistantCoordinatorStaffIds: staffScope.staffId }
  ];
  return filter;
};

const serializeStaffBrief = (staff: {
  _id: { toString(): string };
  staffId?: string;
  designation?: string;
  fullName?: string;
  user?: unknown;
}) => {
  const user = staff.user as { fullName?: string } | undefined;
  const fullName = staff.fullName || user?.fullName || staff.staffId || "Staff";
  return {
    _id: staff._id.toString(),
    staffId: staff.staffId,
    designation: staff.designation,
    fullName,
    user: { fullName }
  };
};

export const serializeSchedule = async (
  schedule: Record<string, unknown> & { _id: { toString(): string } },
  options?: { includeStudentCount?: boolean }
): Promise<FieldDutyScheduleRecord> => {
  const batchId = toId(schedule.batchId);
  const yearId = toId(schedule.yearId);
  const staffId = toId(schedule.supervisorStaffId);
  const legacyTeacherId = toId(schedule.supervisorTeacherId);
  const assistantIds = scheduleAssistantIds(schedule);
  const postingType = resolvePostingType(schedule);
  const siteName = resolveSiteName(schedule);
  const rosterMode =
    (schedule.rosterMode as "AUTO_BATCH_YEAR" | "MANUAL" | undefined) || "AUTO_BATCH_YEAR";
  const assignedStudentIds = Array.isArray(schedule.assignedStudentIds)
    ? schedule.assignedStudentIds.map((id) => toId(id)).filter(Boolean)
    : [];

  const [batch, year, staff, legacyTeacher, assistants, studentCount] = await Promise.all([
    Batch.findById(batchId).select("name").lean(),
    Year.findById(yearId).select("name level").lean(),
    staffId
      ? CollegeStaff.findById(staffId).populate("user", "fullName").lean()
      : Promise.resolve(null),
    !staffId && legacyTeacherId
      ? Teacher.findById(legacyTeacherId).populate("user", "fullName").lean()
      : Promise.resolve(null),
    assistantIds.length
      ? CollegeStaff.find({ _id: { $in: assistantIds } }).populate("user", "fullName").lean()
      : Promise.resolve([]),
    options?.includeStudentCount
      ? rosterMode === "MANUAL"
        ? Promise.resolve(assignedStudentIds.length)
        : Student.countDocuments({
            schoolId: schedule.schoolId,
            batchId,
            yearId,
            academicStatus: "ACTIVE"
          })
      : Promise.resolve(undefined)
  ]);

  const staffUser = staff?.user as unknown as { fullName?: string } | undefined;
  const teacherUser = legacyTeacher?.user as unknown as { fullName?: string } | undefined;
  const supervisorName =
    staff?.fullName ||
    staffUser?.fullName ||
    teacherUser?.fullName ||
    legacyTeacher?.teacherCode ||
    "Coordinator";

  const assistantBriefs = (assistants || []).map((a) => serializeStaffBrief(a as never));

  const coordinators: FieldDutyScheduleRecord["coordinators"] = [];
  if (staff) {
    coordinators.push({
      staffId: staff._id.toString(),
      role: "PRIMARY",
      staff: serializeStaffBrief(staff as never)
    });
  } else if (legacyTeacher) {
    coordinators.push({
      staffId: legacyTeacher._id.toString(),
      role: "PRIMARY",
      staff: {
        _id: legacyTeacher._id.toString(),
        fullName: supervisorName,
        user: { fullName: supervisorName }
      }
    });
  }
  for (const a of assistantBriefs) {
    coordinators.push({ staffId: a._id, role: "ASSISTANT", staff: a });
  }

  return {
    _id: schedule._id.toString(),
    schoolId: toId(schedule.schoolId),
    academicYearBs: String(schedule.academicYearBs ?? ""),
    faculty: (schedule.faculty as string) || undefined,
    semesterBs: (schedule.semesterBs as string) || undefined,
    batchId,
    yearId,
    sectionId: schedule.sectionId ? toId(schedule.sectionId) : undefined,
    postingType,
    postingSection: postingTypeToSection(postingType) as FieldPostingSection,
    siteName,
    hospitalName: siteName,
    address: (schedule.address as string) || undefined,
    department: (schedule.department as string) || undefined,
    ward: (schedule.ward as string) || undefined,
    supervisorStaffId: staffId || legacyTeacherId,
    assistantCoordinatorStaffIds: assistantIds,
    supervisorTeacherId: legacyTeacherId || undefined,
    clinicalInstructorName: (schedule.clinicalInstructorName as string) || undefined,
    hospitalSupervisorName: (schedule.hospitalSupervisorName as string) || undefined,
    startDateBs: String(schedule.startDateBs ?? ""),
    endDateBs: String(schedule.endDateBs ?? ""),
    shift: schedule.shift as FieldDutyScheduleRecord["shift"],
    remarks: (schedule.remarks as string) || undefined,
    status: schedule.status as FieldDutyScheduleRecord["status"],
    rosterMode,
    assignedStudentIds,
    createdBy: schedule.createdBy ? toId(schedule.createdBy) : undefined,
    createdAt: schedule.createdAt
      ? new Date(schedule.createdAt as Date).toISOString()
      : undefined,
    updatedAt: schedule.updatedAt
      ? new Date(schedule.updatedAt as Date).toISOString()
      : undefined,
    batch: batch ? { _id: batch._id.toString(), name: batch.name } : undefined,
    year: year
      ? { _id: year._id.toString(), name: year.name, level: year.level }
      : undefined,
    supervisor: staff
      ? serializeStaffBrief(staff as never)
      : legacyTeacher
        ? {
            _id: legacyTeacher._id.toString(),
            fullName: supervisorName,
            user: { fullName: supervisorName }
          }
        : undefined,
    assistants: assistantBriefs,
    coordinators,
    studentCount
  };
};

export const serializeAttendance = async (
  doc: Record<string, unknown> & {
    _id: { toString(): string };
    entries?: Array<Record<string, unknown>>;
    editRequest?: Record<string, unknown>;
  }
): Promise<FieldDutyAttendanceRecord> => {
  const entries = doc.entries ?? [];
  const studentIds = entries.map((e) => e.studentId);
  const students = await Student.find({ _id: { $in: studentIds } })
    .populate("user", "fullName")
    .lean();
  const studentMap = new Map(
    students.map((s) => {
      const user = s.user as unknown as { fullName?: string } | null;
      return [
        s._id.toString(),
        {
          _id: s._id.toString(),
          fullName: user?.fullName ?? "Student",
          admissionNumber: s.admissionNumber,
          rollNumber: s.rollNumber
        }
      ];
    })
  );

  const mappedEntries = entries.map((e) => ({
    studentId: String(e.studentId),
    status: e.status as FieldDutyStudentStatus,
    remarks: (e.remarks as string) || undefined,
    student: studentMap.get(String(e.studentId))
  }));

  const siteName = resolveSiteName(doc);
  const editReq = doc.editRequest;

  return {
    _id: doc._id.toString(),
    schoolId: String(doc.schoolId),
    scheduleId: String(doc.scheduleId),
    dateBs: String(doc.dateBs),
    postingType: resolvePostingType(doc),
    siteName,
    hospitalName: siteName,
    department: String(doc.department ?? ""),
    ward: (doc.ward as string) || undefined,
    shift: doc.shift as FieldDutyAttendanceRecord["shift"],
    batchId: String(doc.batchId),
    yearId: String(doc.yearId),
    supervisorStaffId: String(doc.supervisorStaffId ?? doc.supervisorTeacherId ?? ""),
    supervisorTeacherId: doc.supervisorTeacherId ? String(doc.supervisorTeacherId) : undefined,
    entries: mappedEntries,
    notes: (doc.notes as string) || undefined,
    status: doc.status as FieldDutyAttendanceRecord["status"],
    editRequest: editReq
      ? {
          requestedBy: editReq.requestedBy ? String(editReq.requestedBy) : undefined,
          requestedAt: editReq.requestedAt
            ? new Date(editReq.requestedAt as Date).toISOString()
            : undefined,
          reason: (editReq.reason as string) || undefined,
          status: (editReq.status as "PENDING" | "APPROVED" | "REJECTED") || "PENDING",
          reviewedBy: editReq.reviewedBy ? String(editReq.reviewedBy) : undefined,
          reviewedAt: editReq.reviewedAt
            ? new Date(editReq.reviewedAt as Date).toISOString()
            : undefined,
          reviewNotes: (editReq.reviewNotes as string) || undefined
        }
      : undefined,
    submittedBy: doc.submittedBy ? String(doc.submittedBy) : undefined,
    submittedAt: doc.submittedAt ? new Date(doc.submittedAt as Date).toISOString() : undefined,
    unlockedBy: doc.unlockedBy ? String(doc.unlockedBy) : undefined,
    unlockedAt: doc.unlockedAt ? new Date(doc.unlockedAt as Date).toISOString() : undefined,
    unlockReason: (doc.unlockReason as string) || undefined,
    createdBy: doc.createdBy ? String(doc.createdBy) : undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as Date).toISOString() : undefined,
    summary: summarizeEntries(mappedEntries)
  };
};

export const isDateWithinDuty = (dateBs: string, startDateBs: string, endDateBs: string): boolean => {
  ensureValidBsDate(dateBs);
  ensureValidBsDate(startDateBs);
  ensureValidBsDate(endDateBs);
  return compareBsDates(dateBs, startDateBs) >= 0 && compareBsDates(dateBs, endDateBs) <= 0;
};

export const notifyFieldDutyAttendance = async (
  schoolId: string,
  attendance: {
    dateBs: string;
    hospitalName: string;
    department: string;
    entries: Array<{ studentId: string; status: string; remarks?: string }>;
  }
) => {
  const { ParentChildLink } = await import("../models/ParentChildLink.js");

  for (const entry of attendance.entries) {
    if (!["ABSENT", "LATE", "LEAVE"].includes(entry.status)) continue;

    const student = await Student.findById(entry.studentId).populate("user", "fullName _id").lean();
    if (!student) continue;
    const studentUser = student.user as unknown as {
      _id?: { toString(): string };
      fullName?: string;
    } | null;
    const name = studentUser?.fullName ?? "Student";

    if (studentUser?._id) {
      await sendNotification({
        schoolId,
        recipientUserId: studentUser._id.toString(),
        title: "Field attendance recorded",
        message: `${name}: ${entry.status} on ${attendance.dateBs} at ${attendance.hospitalName}${
          attendance.department ? ` (${attendance.department})` : ""
        }.`,
        type: "ATTENDANCE",
        metadata: {
          fieldDuty: "1",
          dateBs: attendance.dateBs,
          status: entry.status
        }
      });
    }

    const { approvedParentLinkFilter } = await import("./parentScope.js");
    const links = await ParentChildLink.find(
      approvedParentLinkFilter({
        schoolId,
        studentId: entry.studentId
      })
    ).lean();

    await Promise.all(
      links.map((link) =>
        sendNotification({
          schoolId,
          recipientUserId: link.parentUserId.toString(),
          title: `Field attendance: ${entry.status}`,
          message: `${name} was marked ${entry.status} for field posting on ${attendance.dateBs} at ${attendance.hospitalName}${
            entry.remarks ? ` — ${entry.remarks}` : ""
          }.`,
          type: "ATTENDANCE",
          metadata: {
            fieldDuty: "1",
            studentId: entry.studentId,
            dateBs: attendance.dateBs,
            status: entry.status
          }
        })
      )
    );
  }
};

export const buildFieldDutyDashboard = async (req: Request): Promise<FieldDutyDashboard> => {
  const schoolId = tenantObjectId(req);
  const todayBs = getTodayBs();
  const isAdmin = canManageInstitution(req.user?.role ?? "");
  const staffScope = !isAdmin ? await getFieldSupervisorStaffScope(req) : null;

  const scheduleFilter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $lte: todayBs },
    endDateBs: { $gte: todayBs }
  };
  if (!isAdmin && staffScope) {
    scheduleFilter.$or = [
      { supervisorStaffId: staffScope.staffId },
      { assistantCoordinatorStaffIds: staffScope.staffId }
    ];
  }

  const activeSchedules = await FieldDutySchedule.find(scheduleFilter).lean();
  const scheduleIds = activeSchedules.map((s) => s._id);

  const todayRecords = await FieldDutyAttendance.find({
    schoolId,
    dateBs: todayBs,
    isDeleted: false,
    ...(scheduleIds.length ? { scheduleId: { $in: scheduleIds } } : { scheduleId: { $in: [] } })
  }).lean();

  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let emergencyDuty = 0;
  let studentsOnDutyToday = 0;
  const hospitalMap = new Map<string, { present: number; absent: number; total: number }>();
  const siteMap = new Map<
    string,
    { siteName: string; postingType?: string; present: number; absent: number; total: number }
  >();
  const supervisorMap = new Map<
    string,
    { present: number; absent: number; total: number; name: string }
  >();
  const typeMap = new Map<string, { present: number; absent: number; total: number }>();

  for (const rec of todayRecords) {
    const sum = summarizeEntries(rec.entries);
    present += sum.present;
    absent += sum.absent;
    late += sum.late;
    leave += sum.leave;
    emergencyDuty += sum.emergencyDuty;
    studentsOnDutyToday += sum.total;

    const siteName = resolveSiteName(rec);
    const postingType = resolvePostingType(rec);

    const h = hospitalMap.get(siteName) ?? { present: 0, absent: 0, total: 0 };
    h.present += sum.present;
    h.absent += sum.absent;
    h.total += sum.total;
    hospitalMap.set(siteName, h);

    const sk = `${postingType}::${siteName}`;
    const sRow = siteMap.get(sk) ?? {
      siteName,
      postingType,
      present: 0,
      absent: 0,
      total: 0
    };
    sRow.present += sum.present;
    sRow.absent += sum.absent;
    sRow.total += sum.total;
    siteMap.set(sk, sRow);

    const t = typeMap.get(postingType) ?? { present: 0, absent: 0, total: 0 };
    t.present += sum.present;
    t.absent += sum.absent;
    t.total += sum.total;
    typeMap.set(postingType, t);

    const sid = String(rec.supervisorStaffId ?? rec.supervisorTeacherId ?? "");
    if (!sid) continue;
    const s = supervisorMap.get(sid) ?? { present: 0, absent: 0, total: 0, name: sid };
    s.present += sum.present;
    s.absent += sum.absent;
    s.total += sum.total;
    supervisorMap.set(sid, s);
  }

  const supervisorIds = [...supervisorMap.keys()];
  const staffRows = await CollegeStaff.find({ _id: { $in: supervisorIds } })
    .select("_id fullName staffId")
    .lean();
  for (const st of staffRows) {
    const row = supervisorMap.get(st._id.toString());
    if (row) row.name = st.fullName || st.staffId;
  }
  const missingIds = supervisorIds.filter((id) => {
    const row = supervisorMap.get(id);
    return row && row.name === id;
  });
  if (missingIds.length) {
    const legacyTeachers = await Teacher.find({ _id: { $in: missingIds } })
      .populate("user", "fullName")
      .lean();
    for (const t of legacyTeachers) {
      const row = supervisorMap.get(t._id.toString());
      if (row) {
        const u = t.user as unknown as { fullName?: string } | undefined;
        row.name = u?.fullName ?? t.teacherCode;
      }
    }
  }

  const submittedToday = todayRecords.filter(
    (r) => r.status === "SUBMITTED" || r.status === "LOCKED"
  ).length;
  const pendingSubmissions = Math.max(activeSchedules.length - submittedToday, 0);
  const missingAttendance = pendingSubmissions;
  const markedPresent = present + emergencyDuty + late;
  const overallAttendancePercent =
    studentsOnDutyToday > 0 ? Math.round((markedPresent / studentsOnDutyToday) * 100) : 0;

  let myAssignments: FieldDutyDashboard["myAssignments"];
  if (staffScope) {
    myAssignments = await Promise.all(
      activeSchedules.map(async (sch) => {
        const rosterMode = (sch.rosterMode as string) || "AUTO_BATCH_YEAR";
        const assigned = Array.isArray(sch.assignedStudentIds) ? sch.assignedStudentIds : [];
        const count =
          rosterMode === "MANUAL"
            ? assigned.length
            : await Student.countDocuments({
                schoolId,
                batchId: sch.batchId,
                yearId: sch.yearId,
                academicStatus: "ACTIVE"
              });
        const att = todayRecords.find((r) => r.scheduleId.toString() === sch._id.toString());
        const batch = await Batch.findById(sch.batchId).select("name").lean();
        const year = await Year.findById(sch.yearId).select("name").lean();
        const siteName = resolveSiteName(sch);
        return {
          scheduleId: sch._id.toString(),
          hospitalName: siteName,
          siteName,
          postingType: resolvePostingType(sch),
          department: sch.department || "",
          batchName: batch?.name,
          yearName: year?.name,
          studentCount: count,
          attendanceStatus: (att?.status as "DRAFT" | "SUBMITTED" | "LOCKED" | undefined) ?? "NONE",
          startDateBs: sch.startDateBs,
          endDateBs: sch.endDateBs
        };
      })
    );
  }

  // Upcoming postings (start after today)
  const upcomingFilter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $gt: todayBs }
  };
  if (!isAdmin && staffScope) {
    upcomingFilter.$or = [
      { supervisorStaffId: staffScope.staffId },
      { assistantCoordinatorStaffIds: staffScope.staffId }
    ];
  }
  const upcoming = await FieldDutySchedule.find(upcomingFilter)
    .sort({ startDateBs: 1 })
    .limit(10)
    .lean();

  const upcomingPostings = await Promise.all(
    upcoming.map(async (sch) => {
      const rosterMode = (sch.rosterMode as string) || "AUTO_BATCH_YEAR";
      const assigned = Array.isArray(sch.assignedStudentIds) ? sch.assignedStudentIds : [];
      const count =
        rosterMode === "MANUAL"
          ? assigned.length
          : await Student.countDocuments({
              schoolId,
              batchId: sch.batchId,
              yearId: sch.yearId,
              academicStatus: "ACTIVE"
            });
      return {
        scheduleId: sch._id.toString(),
        siteName: resolveSiteName(sch),
        postingType: resolvePostingType(sch),
        startDateBs: sch.startDateBs,
        endDateBs: sch.endDateBs,
        studentCount: count
      };
    })
  );

  return {
    studentsOnDutyToday,
    present,
    absent,
    late,
    leave,
    emergencyDuty,
    pendingSubmissions,
    submittedToday,
    missingAttendance,
    overallAttendancePercent,
    hospitalWise: [...hospitalMap.entries()].map(([hospital, v]) => ({ hospital, ...v })),
    siteWise: [...siteMap.values()],
    supervisorWise: [...supervisorMap.entries()].map(([supervisorId, v]) => ({
      supervisorId,
      supervisorName: v.name,
      present: v.present,
      absent: v.absent,
      total: v.total
    })),
    postingTypeWise: [...typeMap.entries()].map(([postingType, v]) => ({
      postingType,
      ...v
    })),
    myAssignments,
    upcomingPostings
  };
};

export const buildStudentFieldDutyPortal = async (
  schoolId: unknown,
  studentId: string
): Promise<FieldDutyPortalSummary> => {
  const records = await FieldDutyAttendance.find({
    schoolId,
    isDeleted: false,
    status: { $in: ["SUBMITTED", "LOCKED"] },
    "entries.studentId": studentId
  })
    .sort({ dateBs: -1 })
    .limit(200)
    .lean();

  const supervisorIds = [
    ...new Set(
      records
        .map((r) => String(r.supervisorStaffId ?? r.supervisorTeacherId ?? ""))
        .filter(Boolean)
    )
  ];
  const staffRows = await CollegeStaff.find({ _id: { $in: supervisorIds } })
    .select("_id fullName staffId")
    .lean();
  const supervisorName = new Map(
    staffRows.map((s) => [s._id.toString(), s.fullName || s.staffId])
  );
  const missing = supervisorIds.filter((id) => !supervisorName.has(id));
  if (missing.length) {
    const teachers = await Teacher.find({ _id: { $in: missing } })
      .populate("user", "fullName")
      .lean();
    for (const t of teachers) {
      const u = t.user as unknown as { fullName?: string } | undefined;
      supervisorName.set(t._id.toString(), u?.fullName ?? t.teacherCode);
    }
  }

  const rows = [];
  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let emergencyDuty = 0;
  const postingAgg = new Map<
    string,
    {
      scheduleId: string;
      siteName: string;
      postingType: string;
      coordinatorName?: string;
      present: number;
      absent: number;
      late: number;
      leave: number;
      total: number;
    }
  >();

  for (const rec of records) {
    const entry = rec.entries.find((e) => e.studentId.toString() === studentId);
    if (!entry) continue;
    if (entry.status === "PRESENT" || entry.status === "EMERGENCY_DUTY") present += 1;
    else if (entry.status === "ABSENT") absent += 1;
    else if (entry.status === "LATE") {
      late += 1;
      present += 1;
    } else if (entry.status === "LEAVE") leave += 1;

    if (entry.status === "EMERGENCY_DUTY") emergencyDuty += 1;

    const siteName = resolveSiteName(rec);
    const postingType = resolvePostingType(rec);
    const coordName = supervisorName.get(
      String(rec.supervisorStaffId ?? rec.supervisorTeacherId ?? "")
    );

    rows.push({
      _id: `${rec._id.toString()}-${studentId}`,
      dateBs: rec.dateBs,
      hospitalName: siteName,
      siteName,
      postingType,
      department: rec.department || "",
      ward: rec.ward || undefined,
      shift: rec.shift as FieldDutyPortalSummary["rows"][0]["shift"],
      supervisorName: coordName,
      status: entry.status as FieldDutyStudentStatus,
      remarks: entry.remarks || undefined,
      attendanceRecordStatus: rec.status as FieldDutyPortalSummary["rows"][0]["attendanceRecordStatus"]
    });

    const sid = String(rec.scheduleId);
    const agg = postingAgg.get(sid) ?? {
      scheduleId: sid,
      siteName,
      postingType,
      coordinatorName: coordName,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      total: 0
    };
    agg.total += 1;
    if (entry.status === "PRESENT" || entry.status === "EMERGENCY_DUTY") agg.present += 1;
    else if (entry.status === "ABSENT") agg.absent += 1;
    else if (entry.status === "LATE") {
      agg.late += 1;
      agg.present += 1;
    } else if (entry.status === "LEAVE") agg.leave += 1;
    postingAgg.set(sid, agg);
  }

  const totalMarked = rows.length;
  const attendancePercent = totalMarked > 0 ? Math.round((present / totalMarked) * 100) : 0;

  // Enrich postings with schedule date range
  const scheduleIds = [...postingAgg.keys()];
  const schedules = scheduleIds.length
    ? await FieldDutySchedule.find({ _id: { $in: scheduleIds } })
        .select("_id startDateBs endDateBs")
        .lean()
    : [];
  const scheduleMap = new Map(schedules.map((s) => [s._id.toString(), s]));

  const postings = [...postingAgg.values()].map((p) => {
    const sch = scheduleMap.get(p.scheduleId);
    return {
      ...p,
      startDateBs: sch?.startDateBs,
      endDateBs: sch?.endDateBs,
      attendancePercent: p.total > 0 ? Math.round((p.present / p.total) * 100) : 0
    };
  });

  return {
    rows,
    present,
    absent,
    late,
    leave,
    emergencyDuty,
    totalMarked,
    attendancePercent,
    postings
  };
};

/** Admin monitoring aggregates across filters. */
export const buildFieldDutyMonitoring = async (
  req: Request,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    batchId?: string;
    yearId?: string;
    postingType?: string;
    section?: string;
    scheduleId?: string;
    supervisorStaffId?: string;
  }
): Promise<FieldDutyMonitoringSummary> => {
  const schoolId = tenantObjectId(req);
  const attendanceFilter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: { $in: ["SUBMITTED", "LOCKED"] }
  };
  if (filters.dateFrom || filters.dateTo) {
    attendanceFilter.dateBs = {
      ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { $lte: filters.dateTo } : {})
    };
  }
  if (filters.batchId) attendanceFilter.batchId = filters.batchId;
  if (filters.yearId) attendanceFilter.yearId = filters.yearId;
  if (filters.scheduleId) attendanceFilter.scheduleId = filters.scheduleId;
  if (filters.supervisorStaffId) attendanceFilter.supervisorStaffId = filters.supervisorStaffId;
  if (filters.postingType) attendanceFilter.postingType = filters.postingType.toUpperCase();

  let records = await FieldDutyAttendance.find(attendanceFilter).limit(2000).lean();

  if (filters.section) {
    records = records.filter(
      (r) => postingTypeToSection(resolvePostingType(r)) === filters.section
    );
  }

  let present = 0;
  let total = 0;
  const byCoord = new Map<string, { name: string; present: number; absent: number; total: number }>();
  const byBatch = new Map<string, { present: number; total: number }>();
  const byYear = new Map<string, { present: number; total: number }>();
  const byPosting = new Map<
    string,
    { siteName: string; postingType: string; present: number; total: number }
  >();
  const byDate = new Map<string, { present: number; absent: number; total: number }>();

  let communityMarks = 0;
  let hospitalMarks = 0;

  for (const rec of records) {
    const sum = summarizeEntries(rec.entries);
    const p = presentForPercent(sum, true);
    present += p;
    total += sum.total;

    const section = postingTypeToSection(resolvePostingType(rec));
    if (section === "HOSPITAL") hospitalMarks += sum.total;
    else communityMarks += sum.total;

    const sid = String(rec.supervisorStaffId ?? "");
    const c = byCoord.get(sid) ?? { name: sid, present: 0, absent: 0, total: 0 };
    c.present += p;
    c.absent += sum.absent;
    c.total += sum.total;
    byCoord.set(sid, c);

    const bid = String(rec.batchId);
    const b = byBatch.get(bid) ?? { present: 0, total: 0 };
    b.present += p;
    b.total += sum.total;
    byBatch.set(bid, b);

    const yid = String(rec.yearId);
    const y = byYear.get(yid) ?? { present: 0, total: 0 };
    y.present += p;
    y.total += sum.total;
    byYear.set(yid, y);

    const schId = String(rec.scheduleId);
    const post = byPosting.get(schId) ?? {
      siteName: resolveSiteName(rec),
      postingType: resolvePostingType(rec),
      present: 0,
      total: 0
    };
    post.present += p;
    post.total += sum.total;
    byPosting.set(schId, post);

    const d = byDate.get(rec.dateBs) ?? { present: 0, absent: 0, total: 0 };
    d.present += p;
    d.absent += sum.absent;
    d.total += sum.total;
    byDate.set(rec.dateBs, d);
  }

  const coordIds = [...byCoord.keys()].filter(Boolean);
  const staffRows = await CollegeStaff.find({ _id: { $in: coordIds } })
    .select("_id fullName staffId")
    .lean();
  for (const st of staffRows) {
    const row = byCoord.get(st._id.toString());
    if (row) row.name = st.fullName || st.staffId || st._id.toString();
  }

  const batchIds = [...byBatch.keys()];
  const yearIds = [...byYear.keys()];
  const [batches, years] = await Promise.all([
    Batch.find({ _id: { $in: batchIds } }).select("name").lean(),
    Year.find({ _id: { $in: yearIds } }).select("name").lean()
  ]);
  const batchName = new Map(batches.map((b) => [b._id.toString(), b.name]));
  const yearName = new Map(years.map((y) => [y._id.toString(), y.name]));

  // Pending / missing for active schedules today
  const todayBs = getTodayBs();
  const activeToday = await FieldDutySchedule.countDocuments({
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $lte: todayBs },
    endDateBs: { $gte: todayBs }
  });
  const submittedToday = await FieldDutyAttendance.countDocuments({
    schoolId,
    dateBs: todayBs,
    isDeleted: false,
    status: { $in: ["SUBMITTED", "LOCKED"] }
  });

  const pct = (p: number, t: number) => (t > 0 ? Math.round((p / t) * 100) : 0);

  return {
    overallAttendancePercent: pct(present, total),
    pendingAttendance: Math.max(activeToday - submittedToday, 0),
    submittedAttendance: submittedToday,
    missingAttendance: Math.max(activeToday - submittedToday, 0),
    communityPostingAttendance: communityMarks,
    hospitalPostingAttendance: hospitalMarks,
    byCoordinator: [...byCoord.entries()].map(([coordinatorId, v]) => ({
      coordinatorId,
      coordinatorName: v.name,
      present: v.present,
      absent: v.absent,
      total: v.total,
      percent: pct(v.present, v.total)
    })),
    byBatch: [...byBatch.entries()].map(([batchId, v]) => ({
      batchId,
      batchName: batchName.get(batchId) ?? batchId,
      present: v.present,
      total: v.total,
      percent: pct(v.present, v.total)
    })),
    byYear: [...byYear.entries()].map(([yearId, v]) => ({
      yearId,
      yearName: yearName.get(yearId) ?? yearId,
      present: v.present,
      total: v.total,
      percent: pct(v.present, v.total)
    })),
    byPosting: [...byPosting.entries()].map(([scheduleId, v]) => ({
      scheduleId,
      siteName: v.siteName,
      postingType: v.postingType,
      present: v.present,
      total: v.total,
      percent: pct(v.present, v.total)
    })),
    byDate: [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateBs, v]) => ({
        dateBs,
        present: v.present,
        absent: v.absent,
        total: v.total,
        percent: pct(v.present, v.total)
      }))
  };
};
