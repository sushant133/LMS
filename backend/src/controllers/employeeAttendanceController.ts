import type { Request, Response } from "express";
import {
  canManageInstitution,
  employeeAttendanceSubmitSchema,
  employeeAttendanceUnlockSchema,
  employeeAttendanceUpdateSchema,
  hasModuleAction,
  type EmployeeAttendanceCategory,
  type EmployeeAttendanceRecord,
  type EmployeeAttendanceStatus,
  type EmployeeAttendanceSummary,
  type ModulePermissionAction
} from "@phit-erp/shared";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { Setting } from "../models/Setting.js";
import { Teacher } from "../models/Teacher.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  getFullPermissionStateForUser,
  getUserModuleAccessMap,
  getUserModuleActionsMap
} from "../utils/moduleAccessService.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const actorId = (req: Request) => req.user!.userId;

const moduleKeyFor = (category: EmployeeAttendanceCategory) =>
  category === "TEACHER" ? "teacher-attendance" : "staff-attendance";

const emptyToUndef = (v?: string | null) => {
  const t = v?.trim();
  return t ? t : undefined;
};

const summarize = (
  entries: Array<{ status: string }>
): EmployeeAttendanceSummary => {
  const s: EmployeeAttendanceSummary = {
    total: entries.length,
    present: 0,
    absent: 0,
    leave: 0,
    halfDay: 0,
    late: 0,
    officialDuty: 0,
    holiday: 0,
    pending: 0
  };
  for (const e of entries) {
    if (e.status === "PRESENT") s.present += 1;
    else if (e.status === "ABSENT") s.absent += 1;
    else if (e.status === "LEAVE") s.leave += 1;
    else if (e.status === "HALF_DAY") s.halfDay += 1;
    else if (e.status === "LATE") s.late += 1;
    else if (e.status === "OFFICIAL_DUTY") s.officialDuty += 1;
    else if (e.status === "HOLIDAY") s.holiday += 1;
  }
  return s;
};

const presentForPercent = (s: EmployeeAttendanceSummary) =>
  s.present + s.late + s.halfDay + s.officialDuty + s.holiday;

const serializeRecord = (
  doc: Record<string, unknown> & { _id: { toString(): string }; entries?: unknown[] }
): EmployeeAttendanceRecord => {
  const entries = (doc.entries as EmployeeAttendanceRecord["entries"]) ?? [];
  return {
    _id: doc._id.toString(),
    schoolId: String(doc.schoolId),
    category: doc.category as EmployeeAttendanceCategory,
    dateBs: String(doc.dateBs),
    academicYearBs: (doc.academicYearBs as string) || undefined,
    entries: entries.map((e) => ({
      teacherId: e.teacherId ? String(e.teacherId) : undefined,
      staffId: e.staffId ? String(e.staffId) : undefined,
      employeeUserId: e.employeeUserId ? String(e.employeeUserId) : undefined,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      department: e.department || undefined,
      designation: e.designation || undefined,
      status: e.status as EmployeeAttendanceStatus,
      checkInTime: e.checkInTime || undefined,
      checkOutTime: e.checkOutTime || undefined,
      periodsTaught:
        typeof e.periodsTaught === "number" && Number.isFinite(e.periodsTaught)
          ? e.periodsTaught
          : undefined,
      remarks: e.remarks || undefined,
      source: e.source || "MANUAL",
      deviceId: e.deviceId || undefined,
      externalRef: e.externalRef || undefined,
      geo: e.geo
    })),
    notes: (doc.notes as string) || undefined,
    status: doc.status as EmployeeAttendanceRecord["status"],
    sourceDefault: (doc.sourceDefault as EmployeeAttendanceRecord["sourceDefault"]) || "MANUAL",
    createdBy: doc.createdBy ? String(doc.createdBy) : undefined,
    submittedBy: doc.submittedBy ? String(doc.submittedBy) : undefined,
    submittedAt: doc.submittedAt
      ? new Date(doc.submittedAt as Date).toISOString()
      : undefined,
    unlockedBy: doc.unlockedBy ? String(doc.unlockedBy) : undefined,
    unlockedAt: doc.unlockedAt
      ? new Date(doc.unlockedAt as Date).toISOString()
      : undefined,
    unlockReason: (doc.unlockReason as string) || undefined,
    approvedBy: doc.approvedBy ? String(doc.approvedBy) : undefined,
    approvedAt: doc.approvedAt
      ? new Date(doc.approvedAt as Date).toISOString()
      : undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as Date).toISOString() : undefined,
    summary: summarize(entries)
  };
};

/** Super/Admin always; otherwise module access + granular action. */
const assertEmployeeAttendanceAccess = async (
  req: Request,
  category: EmployeeAttendanceCategory,
  action: ModulePermissionAction
) => {
  if (canManageInstitution(req.user?.role ?? "")) return;
  const userId = req.user?.userId;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const role = req.user?.role ?? "";
  const key = moduleKeyFor(category);
  const [map, actions] = await Promise.all([
    getUserModuleAccessMap(userId),
    getUserModuleActionsMap(userId)
  ]);

  // Teachers/staff with no module matrix must NOT inherit legacy full WRITE for
  // employee attendance sheets — only Super Admin / Admin by default (requirement).
  // Admin grants explicit teacher-attendance / staff-attendance (or attendance) modules.
  const isEmployeeLogin = role === "TEACHER" || role === "COLLEGE_STAFF";
  const hasExplicitMatrix = Boolean(map && Object.keys(map).length > 0);
  if (isEmployeeLogin && !hasExplicitMatrix) {
    throw new ApiError(
      403,
      `You do not have permission to ${action} ${category === "TEACHER" ? "teacher" : "staff"} attendance. Ask an administrator to grant access.`
    );
  }

  // Prefer category-specific module; fall back to general "attendance" when granted
  const ok =
    hasModuleAction(map, actions, key, action) ||
    (action === "view" && hasModuleAction(map, actions, "attendance", "view")) ||
    ((action === "create" || action === "edit") &&
      hasModuleAction(map, actions, "attendance", "create"));

  if (!ok) {
    throw new ApiError(
      403,
      `You do not have permission to ${action} ${category === "TEACHER" ? "teacher" : "staff"} attendance`
    );
  }
};

const listTeachers = async (schoolId: unknown) => {
  const rows = await Teacher.find({ schoolId })
    .populate("user", "fullName designation")
    .sort({ teacherCode: 1 })
    .lean();
  return rows.map((t) => {
    const user = t.user as unknown as {
      _id?: { toString(): string };
      fullName?: string;
      designation?: string;
    } | null;
    return {
      _id: t._id.toString(),
      employeeCode: t.teacherCode,
      fullName: user?.fullName ?? t.teacherCode,
      department: user?.designation || "Teaching",
      designation: user?.designation || "Teacher",
      userId: user?._id?.toString(),
      status: "ACTIVE" as const
    };
  });
};

const listStaff = async (schoolId: unknown) => {
  const rows = await CollegeStaff.find({
    schoolId,
    isDeleted: false,
    status: "ACTIVE"
  })
    .sort({ staffId: 1 })
    .lean();
  return rows.map((s) => ({
    _id: s._id.toString(),
    employeeCode: s.staffId,
    fullName: s.fullName,
    department: s.department || undefined,
    designation: s.designation || s.category || undefined,
    userId: s.user ? String(s.user) : undefined,
    status: (s.status as "ACTIVE" | "INACTIVE") || "ACTIVE"
  }));
};

const parseCategory = (raw: unknown): EmployeeAttendanceCategory => {
  const c = String(raw || "").toUpperCase();
  if (c === "TEACHER" || c === "STAFF") return c;
  throw new ApiError(400, "category must be TEACHER or STAFF");
};

export const getEmployeeAttendanceMarkContext = asyncHandler(
  async (req: Request, res: Response) => {
    const category = parseCategory(req.query.category);
    await assertEmployeeAttendanceAccess(req, category, "view");
    const dateBs = ensureValidBsDate(
      typeof req.query.dateBs === "string" && req.query.dateBs
        ? req.query.dateBs
        : getTodayBs()
    );
    const schoolId = tenantObjectId(req);

    const employees =
      category === "TEACHER" ? await listTeachers(schoolId) : await listStaff(schoolId);

    const existing = await EmployeeAttendance.findOne({
      schoolId,
      category,
      dateBs,
      isDeleted: false
    }).lean();

    let canMark = false;
    let canEdit = false;
    try {
      await assertEmployeeAttendanceAccess(req, category, "create");
      canMark = true;
    } catch {
      canMark = false;
    }
    try {
      await assertEmployeeAttendanceAccess(req, category, "edit");
      canEdit = true;
    } catch {
      canEdit = false;
    }
    if (canManageInstitution(req.user?.role ?? "")) {
      canMark = true;
      canEdit = true;
    }

    const locked =
      existing && (existing.status === "LOCKED" || existing.status === "SUBMITTED");

    return sendSuccess(res, "Employee attendance context fetched", {
      category,
      dateBs,
      employees,
      existingRecord: existing ? serializeRecord(existing as never) : null,
      canMark: canMark && !locked,
      canEdit: canEdit && Boolean(existing && !locked),
      message: locked
        ? "Attendance is locked for this date. Unlock or request admin approval to edit."
        : undefined
    });
  }
);

export const listEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const category = parseCategory(req.query.category ?? "TEACHER");
  await assertEmployeeAttendanceAccess(req, category, "view");
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, category, isDeleted: false };

  if (typeof req.query.dateBs === "string" && req.query.dateBs) {
    filter.dateBs = ensureValidBsDate(req.query.dateBs);
  }
  if (typeof req.query.status === "string" && req.query.status) {
    filter.status = req.query.status;
  }

  let rows = await EmployeeAttendance.find(filter).sort({ dateBs: -1 }).limit(120).lean();

  if (typeof req.query.fromDateBs === "string" && req.query.fromDateBs) {
    const from = ensureValidBsDate(req.query.fromDateBs);
    rows = rows.filter((r) => String(r.dateBs) >= from);
  }
  if (typeof req.query.toDateBs === "string" && req.query.toDateBs) {
    const to = ensureValidBsDate(req.query.toDateBs);
    rows = rows.filter((r) => String(r.dateBs) <= to);
  }

  return sendSuccess(
    res,
    "Employee attendance listed",
    rows.map((r) => serializeRecord(r as never))
  );
});

export const getEmployeeAttendanceById = asyncHandler(async (req: Request, res: Response) => {
  const row = await EmployeeAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!row) throw new ApiError(404, "Attendance record not found");
  await assertEmployeeAttendanceAccess(
    req,
    row.category as EmployeeAttendanceCategory,
    "view"
  );
  return sendSuccess(res, "Employee attendance fetched", serializeRecord(row as never));
});

export const submitEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = employeeAttendanceSubmitSchema.parse(req.body);
  const dateBs = ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  await assertEmployeeAttendanceAccess(req, payload.category, "create");

  const employees =
    payload.category === "TEACHER"
      ? await listTeachers(schoolId)
      : await listStaff(schoolId);
  const validIds = new Set(employees.map((e) => e._id));

  for (const e of payload.entries) {
    const id = payload.category === "TEACHER" ? e.teacherId : e.staffId;
    if (!id || !validIds.has(id)) {
      throw new ApiError(400, `Invalid employee in attendance: ${e.fullName || id}`);
    }
  }

  const settings = await Setting.findOne({ schoolId }).select("academicYearBs").lean();
  const existing = await EmployeeAttendance.findOne({
    schoolId,
    category: payload.category,
    dateBs,
    isDeleted: false
  });

  if (existing && (existing.status === "LOCKED" || existing.status === "SUBMITTED")) {
    throw new ApiError(
      400,
      "Attendance already submitted for this date. Unlock before re-submitting."
    );
  }

  const entries = payload.entries.map((e) => ({
    teacherId: payload.category === "TEACHER" ? e.teacherId : undefined,
    staffId: payload.category === "STAFF" ? e.staffId : undefined,
    employeeUserId: emptyToUndef(e.employeeUserId),
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: emptyToUndef(e.department) ?? "",
    designation: emptyToUndef(e.designation) ?? "",
    status: e.status,
    checkInTime: emptyToUndef(e.checkInTime) ?? "",
    checkOutTime: emptyToUndef(e.checkOutTime) ?? "",
    periodsTaught:
      payload.category === "TEACHER" &&
      typeof e.periodsTaught === "number" &&
      Number.isFinite(e.periodsTaught)
        ? e.periodsTaught
        : undefined,
    remarks: emptyToUndef(e.remarks) ?? "",
    source: e.source || payload.sourceDefault || "MANUAL",
    deviceId: emptyToUndef(e.deviceId) ?? "",
    externalRef: emptyToUndef(e.externalRef) ?? "",
    geo: e.geo
  }));

  const status = payload.asDraft ? "DRAFT" : "LOCKED";
  const docPayload = {
    schoolId,
    category: payload.category,
    dateBs,
    academicYearBs: settings?.academicYearBs ?? "",
    entries,
    notes: emptyToUndef(payload.notes) ?? "",
    status,
    sourceDefault: payload.sourceDefault || "MANUAL",
    createdBy: actorId(req),
    submittedBy: payload.asDraft ? undefined : actorId(req),
    submittedAt: payload.asDraft ? undefined : new Date()
  };

  let saved;
  if (existing) {
    Object.assign(existing, docPayload);
    await existing.save();
    saved = existing;
  } else {
    saved = await EmployeeAttendance.create(docPayload);
  }

  await recordAudit(req, {
    action: "employee_attendance.submit",
    entity: "EMPLOYEE_ATTENDANCE",
    entityId: saved._id.toString(),
    after: saved
  });

  return sendSuccess(
    res,
    payload.asDraft ? "Attendance draft saved" : "Attendance submitted and locked",
    serializeRecord(saved.toObject() as never),
    existing ? 200 : 201
  );
});

export const updateEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = employeeAttendanceUpdateSchema.parse(req.body);
  const existing = await EmployeeAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Attendance record not found");
  await assertEmployeeAttendanceAccess(
    req,
    existing.category as EmployeeAttendanceCategory,
    "edit"
  );

  if (existing.status === "LOCKED" || existing.status === "SUBMITTED") {
    throw new ApiError(400, "Unlock attendance before editing");
  }

  existing.entries = payload.entries.map((e) => ({
    teacherId: e.teacherId as never,
    staffId: e.staffId as never,
    employeeUserId: emptyToUndef(e.employeeUserId) as never,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: emptyToUndef(e.department) ?? "",
    designation: emptyToUndef(e.designation) ?? "",
    status: e.status,
    checkInTime: emptyToUndef(e.checkInTime) ?? "",
    checkOutTime: emptyToUndef(e.checkOutTime) ?? "",
    periodsTaught:
      existing.category === "TEACHER" &&
      typeof e.periodsTaught === "number" &&
      Number.isFinite(e.periodsTaught)
        ? e.periodsTaught
        : undefined,
    remarks: emptyToUndef(e.remarks) ?? "",
    source: e.source || "MANUAL",
    deviceId: emptyToUndef(e.deviceId) ?? "",
    externalRef: emptyToUndef(e.externalRef) ?? "",
    geo: e.geo
  })) as never;
  if (payload.notes !== undefined) existing.notes = emptyToUndef(payload.notes) ?? "";
  await existing.save();

  return sendSuccess(
    res,
    "Attendance updated",
    serializeRecord(existing.toObject() as never)
  );
});

export const unlockEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = employeeAttendanceUnlockSchema.parse(req.body);
  const existing = await EmployeeAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Attendance record not found");

  const category = existing.category as EmployeeAttendanceCategory;
  if (!canManageInstitution(req.user?.role ?? "")) {
    await assertEmployeeAttendanceAccess(req, category, "approve");
  }

  existing.status = "DRAFT";
  existing.unlockedBy = actorId(req) as never;
  existing.unlockedAt = new Date();
  existing.unlockReason = payload.reason;
  await existing.save();

  await recordAudit(req, {
    action: "employee_attendance.unlock",
    entity: "EMPLOYEE_ATTENDANCE",
    entityId: existing._id.toString(),
    after: { reason: payload.reason }
  });

  return sendSuccess(res, "Attendance unlocked", serializeRecord(existing.toObject() as never));
});

export const deleteEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const existing = await EmployeeAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Attendance record not found");
  await assertEmployeeAttendanceAccess(
    req,
    existing.category as EmployeeAttendanceCategory,
    "delete"
  );
  existing.isDeleted = true;
  await existing.save();
  return sendSuccess(res, "Attendance record deleted");
});

export const getEmployeeAttendanceDashboard = asyncHandler(
  async (req: Request, res: Response) => {
    const category = parseCategory(req.query.category ?? "TEACHER");
    await assertEmployeeAttendanceAccess(req, category, "view");
    const schoolId = tenantObjectId(req);
    const dateBs = ensureValidBsDate(
      typeof req.query.dateBs === "string" && req.query.dateBs
        ? req.query.dateBs
        : getTodayBs()
    );

    const employees =
      category === "TEACHER" ? await listTeachers(schoolId) : await listStaff(schoolId);
    const record = await EmployeeAttendance.findOne({
      schoolId,
      category,
      dateBs,
      isDeleted: false
    }).lean();

    const summary = record
      ? summarize(record.entries as Array<{ status: string }>)
      : {
          total: employees.length,
          present: 0,
          absent: 0,
          leave: 0,
          halfDay: 0,
          late: 0,
          officialDuty: 0,
          holiday: 0,
          pending: employees.length
        };

    if (!record) {
      summary.pending = employees.length;
      summary.total = employees.length;
    } else {
      summary.pending = Math.max(employees.length - summary.total, 0);
    }

    const markedPresent = presentForPercent(summary);
    const denom = summary.total || employees.length;
    const attendancePercent =
      denom > 0 ? Math.round((markedPresent / denom) * 100) : 0;

    return sendSuccess(res, "Employee attendance dashboard", {
      category,
      dateBs,
      totalEmployees: employees.length,
      present: summary.present,
      absent: summary.absent,
      leave: summary.leave,
      late: summary.late,
      halfDay: summary.halfDay,
      officialDuty: summary.officialDuty,
      holiday: summary.holiday,
      pending: summary.pending,
      recordStatus: record
        ? (record.status as "DRAFT" | "SUBMITTED" | "LOCKED")
        : "NONE",
      attendancePercent
    });
  }
);

/** Flat register rows for reports / export. */
export const getEmployeeAttendanceRegister = asyncHandler(
  async (req: Request, res: Response) => {
    const category = parseCategory(req.query.category ?? "TEACHER");
    await assertEmployeeAttendanceAccess(req, category, "view");
    const schoolId = tenantObjectId(req);
    const filter: Record<string, unknown> = { schoolId, category, isDeleted: false };

    if (typeof req.query.dateBs === "string" && req.query.dateBs) {
      filter.dateBs = ensureValidBsDate(req.query.dateBs);
    }

    let records = await EmployeeAttendance.find(filter).sort({ dateBs: -1 }).limit(200).lean();

    if (typeof req.query.fromDateBs === "string" && req.query.fromDateBs) {
      const from = ensureValidBsDate(req.query.fromDateBs);
      records = records.filter((r) => String(r.dateBs) >= from);
    }
    if (typeof req.query.toDateBs === "string" && req.query.toDateBs) {
      const to = ensureValidBsDate(req.query.toDateBs);
      records = records.filter((r) => String(r.dateBs) <= to);
    }

    const statusFilter =
      typeof req.query.entryStatus === "string" ? req.query.entryStatus.toUpperCase() : "";
    const deptFilter =
      typeof req.query.department === "string" ? req.query.department.trim().toLowerCase() : "";
    const desigFilter =
      typeof req.query.designation === "string"
        ? req.query.designation.trim().toLowerCase()
        : "";
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    const rows = [];
    for (const rec of records) {
      for (const e of (rec.entries as unknown as Array<Record<string, unknown>>)) {
        if (statusFilter && String(e.status) !== statusFilter) continue;
        if (deptFilter && !String(e.department || "").toLowerCase().includes(deptFilter)) {
          continue;
        }
        if (desigFilter && !String(e.designation || "").toLowerCase().includes(desigFilter)) {
          continue;
        }
        if (
          q &&
          !String(e.fullName || "").toLowerCase().includes(q) &&
          !String(e.employeeCode || "").toLowerCase().includes(q)
        ) {
          continue;
        }
        rows.push({
          dateBs: rec.dateBs,
          category: rec.category,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          department: e.department || undefined,
          designation: e.designation || undefined,
          status: e.status,
          checkInTime: e.checkInTime || undefined,
          checkOutTime: e.checkOutTime || undefined,
          periodsTaught:
            typeof e.periodsTaught === "number" && Number.isFinite(e.periodsTaught)
              ? e.periodsTaught
              : undefined,
          remarks: e.remarks || undefined,
          recordStatus: rec.status,
          attendanceId: rec._id.toString()
        });
      }
    }

    return sendSuccess(res, "Employee attendance register fetched", { rows });
  }
);

/** Read-only portal for the logged-in teacher or staff member. */
export const getMyEmployeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const userId = req.user?.userId;
  if (!userId) throw new ApiError(401, "Unauthorized");

  let category: EmployeeAttendanceCategory = "TEACHER";
  let teacherId: string | undefined;
  let staffId: string | undefined;

  const teacher = await Teacher.findOne({ schoolId, user: userId }).select("_id").lean();
  if (teacher) {
    category = "TEACHER";
    teacherId = teacher._id.toString();
  } else {
    const staff = await CollegeStaff.findOne({
      schoolId,
      user: userId,
      isDeleted: false
    })
      .select("_id")
      .lean();
    if (!staff) {
      throw new ApiError(404, "No teacher or staff profile linked to your account");
    }
    category = "STAFF";
    staffId = staff._id.toString();
  }

  if (typeof req.query.category === "string" && req.query.category) {
    // allow explicit override if user has both (rare)
    const c = parseCategory(req.query.category);
    category = c;
  }

  const filter: Record<string, unknown> = {
    schoolId,
    category,
    isDeleted: false
  };

  const records = await EmployeeAttendance.find(filter).sort({ dateBs: -1 }).limit(366).lean();

  const history: Array<{
    dateBs: string;
    status: EmployeeAttendanceStatus;
    checkInTime?: string;
    checkOutTime?: string;
    periodsTaught?: number;
    remarks?: string;
  }> = [];

  for (const rec of records) {
    for (const e of rec.entries as unknown as Array<Record<string, unknown>>) {
      const match =
        category === "TEACHER"
          ? String(e.teacherId) === teacherId
          : String(e.staffId) === staffId || String(e.employeeUserId) === userId;
      if (!match) continue;
      history.push({
        dateBs: String(rec.dateBs),
        status: e.status as EmployeeAttendanceStatus,
        checkInTime: (e.checkInTime as string) || undefined,
        checkOutTime: (e.checkOutTime as string) || undefined,
        periodsTaught:
          typeof e.periodsTaught === "number" && Number.isFinite(e.periodsTaught)
            ? (e.periodsTaught as number)
            : undefined,
        remarks: (e.remarks as string) || undefined
      });
    }
  }

  // Optional month filter YYYY-MM
  const month =
    typeof req.query.monthBs === "string" && req.query.monthBs
      ? req.query.monthBs.slice(0, 7)
      : "";
  const filtered = month
    ? history.filter((h) => String(h.dateBs).startsWith(month))
    : history;

  const counts = {
    present: 0,
    absent: 0,
    leave: 0,
    late: 0,
    halfDay: 0,
    officialDuty: 0,
    holiday: 0
  };
  for (const h of filtered) {
    if (h.status === "PRESENT") counts.present += 1;
    else if (h.status === "ABSENT") counts.absent += 1;
    else if (h.status === "LEAVE") counts.leave += 1;
    else if (h.status === "LATE") counts.late += 1;
    else if (h.status === "HALF_DAY") counts.halfDay += 1;
    else if (h.status === "OFFICIAL_DUTY") counts.officialDuty += 1;
    else if (h.status === "HOLIDAY") counts.holiday += 1;
  }
  const totalMarked = filtered.length;
  const good =
    counts.present + counts.late + counts.halfDay + counts.officialDuty + counts.holiday;
  const attendancePercent =
    totalMarked > 0 ? Math.round((good / totalMarked) * 100) : 0;

  return sendSuccess(res, "My attendance fetched", {
    category,
    monthBs: month || undefined,
    ...counts,
    totalMarked,
    attendancePercent,
    history: filtered
  });
});

/** Permissions helper for UI (what current user can do). */
export const getEmployeeAttendancePermissions = asyncHandler(
  async (req: Request, res: Response) => {
    if (canManageInstitution(req.user?.role ?? "")) {
      return sendSuccess(res, "Permissions", {
        teacher: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          approve: true,
          export: true,
          print: true
        },
        staff: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          approve: true,
          export: true,
          print: true
        }
      });
    }
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, "Unauthorized");
    const role = req.user?.role ?? "";
    const isEmployeeLogin = role === "TEACHER" || role === "COLLEGE_STAFF";
    const rawMap = await getUserModuleAccessMap(userId);
    const hasExplicitMatrix = Boolean(rawMap && Object.keys(rawMap).length > 0);

    // Pure teacher/staff with no matrix → self portal only (no sheet permissions)
    if (isEmployeeLogin && !hasExplicitMatrix) {
      return sendSuccess(res, "Permissions", {
        teacher: {
          view: false,
          create: false,
          edit: false,
          delete: false,
          approve: false,
          export: false,
          print: false
        },
        staff: {
          view: false,
          create: false,
          edit: false,
          delete: false,
          approve: false,
          export: false,
          print: false
        }
      });
    }

    const state = await getFullPermissionStateForUser(userId, req.user?.role);
    const check = (key: "teacher-attendance" | "staff-attendance", action: ModulePermissionAction) =>
      hasModuleAction(state.moduleAccess, state.moduleActions, key, action) ||
      hasModuleAction(state.moduleAccess, state.moduleActions, "attendance", action);

    return sendSuccess(res, "Permissions", {
      teacher: {
        view: check("teacher-attendance", "view"),
        create: check("teacher-attendance", "create"),
        edit: check("teacher-attendance", "edit"),
        delete: check("teacher-attendance", "delete"),
        approve: check("teacher-attendance", "approve"),
        export: check("teacher-attendance", "export"),
        print: check("teacher-attendance", "print")
      },
      staff: {
        view: check("staff-attendance", "view"),
        create: check("staff-attendance", "create"),
        edit: check("staff-attendance", "edit"),
        delete: check("staff-attendance", "delete"),
        approve: check("staff-attendance", "approve"),
        export: check("staff-attendance", "export"),
        print: check("staff-attendance", "print")
      }
    });
  }
);
