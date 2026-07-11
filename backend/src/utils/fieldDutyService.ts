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
import { FieldDutyAttendance } from "../models/FieldDutyAttendance.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { compareBsDates, ensureValidBsDate, getTodayBs } from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";
import { getTeacherScope } from "./teacherScope.js";
import { tenantObjectId } from "./tenant.js";

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

export const assertScheduleAccess = async (req: Request, schedule: { supervisorTeacherId: unknown }) => {
  if (canManageInstitution(req.user?.role ?? "")) return;
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only field supervisors or administrators can access this duty");
  }
  const scope = await getTeacherScope(req);
  if (!scope || scope.teacherId !== String(schedule.supervisorTeacherId)) {
    throw new ApiError(403, "You are not the assigned field supervisor for this duty");
  }
};

export const serializeSchedule = async (
  schedule: Record<string, unknown> & { _id: { toString(): string } },
  options?: { includeStudentCount?: boolean }
): Promise<FieldDutyScheduleRecord> => {
  const batchId = schedule.batchId?.toString?.() ?? String(schedule.batchId ?? "");
  const yearId = schedule.yearId?.toString?.() ?? String(schedule.yearId ?? "");
  const supervisorId =
    schedule.supervisorTeacherId?.toString?.() ?? String(schedule.supervisorTeacherId ?? "");

  const [batch, year, supervisor, studentCount] = await Promise.all([
    Batch.findById(batchId).select("name").lean(),
    Year.findById(yearId).select("name level").lean(),
    Teacher.findById(supervisorId).populate("user", "fullName").lean(),
    options?.includeStudentCount
      ? Student.countDocuments({
          schoolId: schedule.schoolId,
          batchId,
          yearId,
          academicStatus: "ACTIVE"
        })
      : Promise.resolve(undefined)
  ]);

  const supUser = supervisor?.user as unknown as { fullName?: string } | undefined;

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
    supervisorTeacherId: supervisorId,
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
    supervisor: supervisor
      ? {
          _id: supervisor._id.toString(),
          teacherCode: supervisor.teacherCode,
          user: { fullName: supUser?.fullName ?? "Supervisor" }
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
    supervisorTeacherId: String(doc.supervisorTeacherId),
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
    const links = await ParentChildLink.find({
      schoolId,
      studentId: entry.studentId,
      status: "APPROVED"
    }).lean();

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
  const teacherScope = req.user?.role === "TEACHER" ? await getTeacherScope(req) : null;

  const scheduleFilter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $lte: todayBs },
    endDateBs: { $gte: todayBs }
  };
  if (!isAdmin && teacherScope) {
    scheduleFilter.supervisorTeacherId = teacherScope.teacherId;
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

    const sid = rec.supervisorTeacherId.toString();
    const s = supervisorMap.get(sid) ?? { present: 0, absent: 0, total: 0, name: sid };
    s.present += sum.present;
    s.absent += sum.absent;
    s.total += sum.total;
    supervisorMap.set(sid, s);
  }

  // Enrich supervisor names
  const supervisors = await Teacher.find({
    _id: { $in: [...supervisorMap.keys()] }
  })
    .populate("user", "fullName")
    .lean();
  for (const t of supervisors) {
    const row = supervisorMap.get(t._id.toString());
    if (row) {
      const u = t.user as unknown as { fullName?: string } | undefined;
      row.name = u?.fullName ?? t.teacherCode;
    }
  }

  const submittedToday = todayRecords.filter((r) => r.status === "SUBMITTED" || r.status === "LOCKED").length;
  const pendingSubmissions = Math.max(activeSchedules.length - submittedToday, 0);

  // Teacher my-assignments
  let myAssignments: FieldDutyDashboard["myAssignments"];
  if (teacherScope) {
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

  const teacherIds = [...new Set(records.map((r) => r.supervisorTeacherId.toString()))];
  const teachers = await Teacher.find({ _id: { $in: teacherIds } })
    .populate("user", "fullName")
    .lean();
  const teacherName = new Map(
    teachers.map((t) => {
      const u = t.user as unknown as { fullName?: string } | undefined;
      return [t._id.toString(), u?.fullName ?? t.teacherCode];
    })
  );

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
      supervisorName: teacherName.get(rec.supervisorTeacherId.toString()),
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
