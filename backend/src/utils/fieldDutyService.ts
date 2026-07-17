import type { Request } from "express";
import type {
  FieldDutyAttendanceRecord,
  FieldDutyDashboard,
  FieldDutyPortalSummary,
  FieldDutyScheduleRecord,
  FieldDutyStudentStatus
} from "@phit-erp/shared";
import { canManageInstitution } from "@phit-erp/shared";
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

/** Resolve college staff record linked to the logged-in user (field supervisor). */
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

const scheduleSupervisorId = (schedule: {
  supervisorStaffId?: unknown;
  supervisorTeacherId?: unknown;
}): string => {
  if (schedule.supervisorStaffId) {
    return String(
      typeof schedule.supervisorStaffId === "object" &&
        schedule.supervisorStaffId &&
        "toString" in schedule.supervisorStaffId
        ? (schedule.supervisorStaffId as { toString(): string }).toString()
        : schedule.supervisorStaffId
    );
  }
  if (schedule.supervisorTeacherId) {
    return String(
      typeof schedule.supervisorTeacherId === "object" &&
        schedule.supervisorTeacherId &&
        "toString" in schedule.supervisorTeacherId
        ? (schedule.supervisorTeacherId as { toString(): string }).toString()
        : schedule.supervisorTeacherId
    );
  }
  return "";
};

export const emptyToUndef = (value?: string | null) => {
  const t = value?.trim();
  return t ? t : undefined;
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

/** Active students for a field duty schedule — auto roster, no manual assignment. */
export const getEligibleStudentsForDuty = async (
  schoolId: unknown,
  batchId: string,
  yearId: string
) => {
  const students = await Student.find({
    schoolId,
    batchId,
    yearId,
    academicStatus: "ACTIVE"
  })
    .populate("user", "fullName")
    .sort({ rollNumber: 1 })
    .lean();

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
  schedule: { supervisorStaffId?: unknown; supervisorTeacherId?: unknown }
) => {
  if (canManageInstitution(req.user?.role ?? "")) return;
  const staffScope = await getFieldSupervisorStaffScope(req);
  const assignedId = scheduleSupervisorId(schedule);
  if (staffScope && assignedId && staffScope.staffId === assignedId) return;
  throw new ApiError(
    403,
    "Only the assigned field supervisor (staff) or an administrator can access this duty"
  );
};

export const serializeSchedule = async (
  schedule: Record<string, unknown> & { _id: { toString(): string } },
  options?: { includeStudentCount?: boolean }
): Promise<FieldDutyScheduleRecord> => {
  const batchId = schedule.batchId?.toString?.() ?? String(schedule.batchId ?? "");
  const yearId = schedule.yearId?.toString?.() ?? String(schedule.yearId ?? "");
  const staffId =
    schedule.supervisorStaffId?.toString?.() ??
    (schedule.supervisorStaffId ? String(schedule.supervisorStaffId) : "");
  const legacyTeacherId =
    schedule.supervisorTeacherId?.toString?.() ??
    (schedule.supervisorTeacherId ? String(schedule.supervisorTeacherId) : "");

  const [batch, year, staff, legacyTeacher, studentCount] = await Promise.all([
    Batch.findById(batchId).select("name").lean(),
    Year.findById(yearId).select("name level").lean(),
    staffId
      ? CollegeStaff.findById(staffId).populate("user", "fullName").lean()
      : Promise.resolve(null),
    !staffId && legacyTeacherId
      ? Teacher.findById(legacyTeacherId).populate("user", "fullName").lean()
      : Promise.resolve(null),
    options?.includeStudentCount
      ? Student.countDocuments({
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
    "Supervisor";

  return {
    _id: schedule._id.toString(),
    schoolId: schedule.schoolId?.toString?.() ?? String(schedule.schoolId ?? ""),
    academicYearBs: String(schedule.academicYearBs ?? ""),
    faculty: (schedule.faculty as string) || undefined,
    batchId,
    yearId,
    sectionId: schedule.sectionId ? String(schedule.sectionId) : undefined,
    hospitalName: String(schedule.hospitalName ?? ""),
    department: String(schedule.department ?? ""),
    ward: (schedule.ward as string) || undefined,
    supervisorStaffId: staffId || legacyTeacherId,
    supervisorTeacherId: legacyTeacherId || undefined,
    clinicalInstructorName: (schedule.clinicalInstructorName as string) || undefined,
    hospitalSupervisorName: (schedule.hospitalSupervisorName as string) || undefined,
    startDateBs: String(schedule.startDateBs ?? ""),
    endDateBs: String(schedule.endDateBs ?? ""),
    shift: schedule.shift as FieldDutyScheduleRecord["shift"],
    remarks: (schedule.remarks as string) || undefined,
    status: schedule.status as FieldDutyScheduleRecord["status"],
    createdBy: schedule.createdBy ? String(schedule.createdBy) : undefined,
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
      ? {
          _id: staff._id.toString(),
          staffId: staff.staffId,
          designation: staff.designation,
          fullName: staff.fullName,
          user: { fullName: supervisorName }
        }
      : legacyTeacher
        ? {
            _id: legacyTeacher._id.toString(),
            fullName: supervisorName,
            user: { fullName: supervisorName }
          }
        : undefined,
    studentCount
  };
};

export const serializeAttendance = async (
  doc: Record<string, unknown> & { _id: { toString(): string }; entries?: Array<Record<string, unknown>> }
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

  return {
    _id: doc._id.toString(),
    schoolId: String(doc.schoolId),
    scheduleId: String(doc.scheduleId),
    dateBs: String(doc.dateBs),
    hospitalName: String(doc.hospitalName),
    department: String(doc.department),
    ward: (doc.ward as string) || undefined,
    shift: doc.shift as FieldDutyAttendanceRecord["shift"],
    batchId: String(doc.batchId),
    yearId: String(doc.yearId),
    supervisorStaffId: String(
      doc.supervisorStaffId ?? doc.supervisorTeacherId ?? ""
    ),
    supervisorTeacherId: doc.supervisorTeacherId
      ? String(doc.supervisorTeacherId)
      : undefined,
    entries: mappedEntries,
    notes: (doc.notes as string) || undefined,
    status: doc.status as FieldDutyAttendanceRecord["status"],
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
    const studentUser = student.user as unknown as { _id?: { toString(): string }; fullName?: string } | null;
    const name = studentUser?.fullName ?? "Student";

    // Notify student
    if (studentUser?._id) {
      await sendNotification({
        schoolId,
        recipientUserId: studentUser._id.toString(),
        title: "Field duty attendance recorded",
        message: `${name}: ${entry.status} on ${attendance.dateBs} at ${attendance.hospitalName} (${attendance.department}).`,
        type: "ATTENDANCE",
        metadata: {
          fieldDuty: "1",
          dateBs: attendance.dateBs,
          status: entry.status
        }
      });
    }

    // Notify parents
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
          title: `Field duty: ${entry.status}`,
          message: `${name} was marked ${entry.status} for hospital duty on ${attendance.dateBs} at ${attendance.hospitalName}${
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
    scheduleFilter.supervisorStaffId = staffScope.staffId;
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
  const supervisorMap = new Map<
    string,
    { present: number; absent: number; total: number; name: string }
  >();

  for (const rec of todayRecords) {
    const sum = summarizeEntries(rec.entries);
    present += sum.present;
    absent += sum.absent;
    late += sum.late;
    leave += sum.leave;
    emergencyDuty += sum.emergencyDuty;
    studentsOnDutyToday += sum.total;

    const h = hospitalMap.get(rec.hospitalName) ?? { present: 0, absent: 0, total: 0 };
    h.present += sum.present;
    h.absent += sum.absent;
    h.total += sum.total;
    hospitalMap.set(rec.hospitalName, h);

    const sid = String(rec.supervisorStaffId ?? rec.supervisorTeacherId ?? "");
    if (!sid) continue;
    const s = supervisorMap.get(sid) ?? { present: 0, absent: 0, total: 0, name: sid };
    s.present += sum.present;
    s.absent += sum.absent;
    s.total += sum.total;
    supervisorMap.set(sid, s);
  }

  // Enrich supervisor names from college staff (and legacy teachers)
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

  const submittedToday = todayRecords.filter((r) => r.status === "SUBMITTED" || r.status === "LOCKED").length;
  const pendingSubmissions = Math.max(activeSchedules.length - submittedToday, 0);

  // Staff supervisor my-assignments
  let myAssignments: FieldDutyDashboard["myAssignments"];
  if (staffScope) {
    myAssignments = await Promise.all(
      activeSchedules.map(async (sch) => {
        const count = await Student.countDocuments({
          schoolId,
          batchId: sch.batchId,
          yearId: sch.yearId,
          academicStatus: "ACTIVE"
        });
        const att = todayRecords.find((r) => r.scheduleId.toString() === sch._id.toString());
        const batch = await Batch.findById(sch.batchId).select("name").lean();
        const year = await Year.findById(sch.yearId).select("name").lean();
        return {
          scheduleId: sch._id.toString(),
          hospitalName: sch.hospitalName,
          department: sch.department,
          batchName: batch?.name,
          yearName: year?.name,
          studentCount: count,
          attendanceStatus: (att?.status as "DRAFT" | "SUBMITTED" | "LOCKED" | undefined) ?? "NONE"
        };
      })
    );
  }

  return {
    studentsOnDutyToday,
    present,
    absent,
    late,
    leave,
    emergencyDuty,
    pendingSubmissions,
    submittedToday,
    hospitalWise: [...hospitalMap.entries()].map(([hospital, v]) => ({ hospital, ...v })),
    supervisorWise: [...supervisorMap.entries()].map(([supervisorId, v]) => ({
      supervisorId,
      supervisorName: v.name,
      present: v.present,
      absent: v.absent,
      total: v.total
    })),
    myAssignments
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
      records.map((r) =>
        String(r.supervisorStaffId ?? r.supervisorTeacherId ?? "")
      ).filter(Boolean)
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

  for (const rec of records) {
    const entry = rec.entries.find((e) => e.studentId.toString() === studentId);
    if (!entry) continue;
    if (entry.status === "PRESENT" || entry.status === "EMERGENCY_DUTY") present += 1;
    else if (entry.status === "ABSENT") absent += 1;
    else if (entry.status === "LATE") {
      late += 1;
      present += 1; // late counts toward presence for %
    } else if (entry.status === "LEAVE") leave += 1;

    if (entry.status === "EMERGENCY_DUTY") emergencyDuty += 1;

    rows.push({
      _id: `${rec._id.toString()}-${studentId}`,
      dateBs: rec.dateBs,
      hospitalName: rec.hospitalName,
      department: rec.department,
      ward: rec.ward || undefined,
      shift: rec.shift as FieldDutyPortalSummary["rows"][0]["shift"],
      supervisorName: supervisorName.get(
        String(rec.supervisorStaffId ?? rec.supervisorTeacherId ?? "")
      ),
      status: entry.status as FieldDutyStudentStatus,
      remarks: entry.remarks || undefined,
      attendanceRecordStatus: rec.status as FieldDutyPortalSummary["rows"][0]["attendanceRecordStatus"]
    });
  }

  const totalMarked = rows.length;
  const attendancePercent =
    totalMarked > 0 ? Math.round((present / totalMarked) * 100) : 0;

  return {
    rows,
    present,
    absent,
    late,
    leave,
    emergencyDuty,
    totalMarked,
    attendancePercent
  };
};
