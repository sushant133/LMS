import type { Request, Response } from "express";
import {
  canManageInstitution,
  employeeAttendanceEntryUpsertSchema,
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
import { Accountant } from "../models/Accountant.js";
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

/**
 * Resolve the logged-in user's HR attendance identity.
 * Teachers → Teacher profile; non-teaching → CollegeStaff; finance → Accountant fallback.
 */
const resolveEmployeeAttendanceIdentity = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  userId: string
): Promise<{
  category: EmployeeAttendanceCategory;
  teacherId?: string;
  staffId?: string;
  /** Always set for staff path so history can match biometric punches by user id */
  employeeUserId: string;
}> => {
  const teacher = await Teacher.findOne({ schoolId, user: userId }).select("_id").lean();
  if (teacher) {
    return {
      category: "TEACHER",
      teacherId: teacher._id.toString(),
      employeeUserId: userId
    };
  }

  const staff = await CollegeStaff.findOne({
    schoolId,
    user: userId,
    isDeleted: false
  })
    .select("_id")
    .lean();
  if (staff) {
    return {
      category: "STAFF",
      staffId: staff._id.toString(),
      employeeUserId: userId
    };
  }

  // Accountants may only have the finance Accountant profile (legacy seed)
  const accountant = await Accountant.findOne({
    schoolId,
    user: userId,
    isDeleted: false
  })
    .select("_id")
    .lean();
  if (accountant) {
    return {
      category: "STAFF",
      // No CollegeStaff id — history still matches entries.employeeUserId
      employeeUserId: userId
    };
  }

  throw new ApiError(404, "No teacher or staff profile linked to your account");
};

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

    const status = existing?.status ? String(existing.status) : "";
    /** Only final lock blocks marking (CHECK_IN / CHECK_OUT phases stay editable). */
    const locked = status === "LOCKED" || status === "SUBMITTED";

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

  const phase =
    payload.phase ??
    (payload.asDraft ? "DRAFT" : "FINAL");

  // Soft order: check-out only after check-in (or draft with data); final anytime after check-in
  if (existing) {
    const cur = String(existing.status);
    if (phase === "CHECK_OUT" && cur === "DRAFT") {
      // allow first-time check-out if they already saved check-in times as draft
    }
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

  const statusByPhase: Record<string, string> = {
    DRAFT: "DRAFT",
    CHECK_IN: "CHECK_IN_SUBMITTED",
    CHECK_OUT: "CHECK_OUT_SUBMITTED",
    FINAL: "LOCKED"
  };
  const status = statusByPhase[phase] ?? "DRAFT";
  const isFinal = phase === "FINAL";
  const docPayload = {
    schoolId,
    category: payload.category,
    dateBs,
    academicYearBs: settings?.academicYearBs ?? "",
    entries,
    notes: emptyToUndef(payload.notes) ?? "",
    status,
    sourceDefault: payload.sourceDefault || "MANUAL",
    createdBy: existing?.createdBy ?? actorId(req),
    submittedBy: isFinal || phase === "CHECK_IN" || phase === "CHECK_OUT"
      ? actorId(req)
      : existing?.submittedBy,
    submittedAt:
      isFinal || phase === "CHECK_IN" || phase === "CHECK_OUT"
        ? new Date()
        : existing?.submittedAt
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
    after: { phase, status, id: saved._id }
  });

  const messages: Record<string, string> = {
    DRAFT: "Attendance draft saved",
    CHECK_IN: "Check-in submitted — you can return later for check-out",
    CHECK_OUT: "Check-out submitted — use Final submit when the day is complete",
    FINAL: "Attendance submitted and locked"
  };

  return sendSuccess(
    res,
    messages[phase] ?? "Attendance saved",
    serializeRecord(saved.toObject() as never),
    existing ? 200 : 201
  );
});

/** Statuses where a check-in / check-out time is meaningful. */
const STATUSES_WITH_CHECK_TIMES = new Set([
  "PRESENT",
  "HALF_DAY",
  "LATE",
  "OFFICIAL_DUTY"
]);

/**
 * Save one employee's row on its own.
 *
 * Staff trickle in and leave across the day, so the sheet is filled person by
 * person rather than in one sitting: this upserts a single entry into the day
 * sheet (creating it as DRAFT if the day has not been started) and leaves every
 * other entry — and the sheet's workflow phase — untouched. The whole-sheet
 * submit / check-in / check-out / final flow is unchanged.
 */
export const upsertEmployeeAttendanceEntry = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = employeeAttendanceEntryUpsertSchema.parse(req.body);
    const dateBs = ensureValidBsDate(payload.dateBs);
    const schoolId = tenantObjectId(req);
    await assertEmployeeAttendanceAccess(req, payload.category, "create");

    const employeeId = payload.category === "TEACHER" ? payload.teacherId : payload.staffId;
    if (!employeeId) {
      throw new ApiError(
        400,
        payload.category === "TEACHER" ? "teacherId is required" : "staffId is required"
      );
    }

    const employees =
      payload.category === "TEACHER" ? await listTeachers(schoolId) : await listStaff(schoolId);
    const employee = employees.find((e) => e._id === employeeId);
    if (!employee) throw new ApiError(400, "Employee not found for this attendance category");

    const settings = await Setting.findOne({ schoolId }).select("academicYearBs").lean();
    let sheet = await EmployeeAttendance.findOne({
      schoolId,
      category: payload.category,
      dateBs,
      isDeleted: false
    });

    if (sheet && (sheet.status === "LOCKED" || sheet.status === "SUBMITTED")) {
      throw new ApiError(400, "This day sheet is locked. Unlock it before editing entries.");
    }

    if (!sheet) {
      sheet = await EmployeeAttendance.create({
        schoolId,
        category: payload.category,
        dateBs,
        academicYearBs: settings?.academicYearBs ?? "",
        entries: [],
        notes: "",
        status: "DRAFT",
        sourceDefault: "MANUAL",
        createdBy: actorId(req)
      });
    }

    const entryEmployeeId = (entry: { teacherId?: unknown; staffId?: unknown }): string =>
      String((payload.category === "TEACHER" ? entry.teacherId : entry.staffId) ?? "");
    const existingEntry = (sheet.entries ?? []).find(
      (e) => entryEmployeeId(e) === employeeId
    );

    // A check-in with no status chosen yet means the person has turned up.
    const status =
      payload.status ??
      ((existingEntry?.status as EmployeeAttendanceStatus | undefined) ||
        (payload.checkInTime || payload.checkOutTime ? "PRESENT" : undefined));
    if (!status) {
      throw new ApiError(400, "Select a status (or record a check-in time) before saving");
    }

    // Omitted fields keep what is already stored; a status without check times drops them.
    const keepTimes = STATUSES_WITH_CHECK_TIMES.has(status);
    const checkInTime = keepTimes
      ? (emptyToUndef(payload.checkInTime) ?? existingEntry?.checkInTime ?? "")
      : "";
    const checkOutTime = keepTimes
      ? (emptyToUndef(payload.checkOutTime) ?? existingEntry?.checkOutTime ?? "")
      : "";

    const nextEntry = {
      teacherId: payload.category === "TEACHER" ? employeeId : undefined,
      staffId: payload.category === "STAFF" ? employeeId : undefined,
      employeeUserId: employee.userId,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      department: employee.department ?? "",
      designation: employee.designation ?? "",
      status,
      checkInTime,
      checkOutTime,
      periodsTaught:
        payload.category === "TEACHER"
          ? (payload.periodsTaught ?? existingEntry?.periodsTaught ?? undefined)
          : undefined,
      remarks: emptyToUndef(payload.remarks) ?? existingEntry?.remarks ?? "",
      source: payload.source || "MANUAL"
    };

    const rest = (sheet.entries ?? []).filter((e) => entryEmployeeId(e) !== employeeId);
    sheet.entries = [...rest, nextEntry] as never;
    await sheet.save();

    await recordAudit(req, {
      action: "employee_attendance.entry.save",
      entity: "EMPLOYEE_ATTENDANCE",
      entityId: sheet._id.toString(),
      after: {
        employeeCode: employee.employeeCode,
        status,
        checkInTime,
        checkOutTime
      }
    });

    return sendSuccess(
      res,
      `${employee.fullName} saved`,
      serializeRecord(sheet.toObject() as never)
    );
  }
);

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
  // DRAFT / CHECK_IN_SUBMITTED / CHECK_OUT_SUBMITTED remain editable

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

  const identity = await resolveEmployeeAttendanceIdentity(schoolId, userId);
  let category = identity.category;
  const teacherId = identity.teacherId;
  const staffId = identity.staffId;

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
          : (staffId ? String(e.staffId) === staffId : false) ||
            String(e.employeeUserId) === userId;
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
    const isEmployeeLogin =
      role === "TEACHER" ||
      role === "COLLEGE_STAFF" ||
      role === "LIBRARY_STAFF" ||
      role === "LABORATORY_STAFF" ||
      role === "ACCOUNTANT" ||
      role === "CASHIER" ||
      role === "AUDITOR";
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

/* ────────────────────────────────────────────────────────────────────────────
 * Period Log — teachers paid per period
 *
 * Attendance alone only says PRESENT or ABSENT, which is not enough to pay a
 * teacher whose contract is per period. These endpoints record the number of
 * periods each teacher actually took on a given day, and total them per month so
 * the salary sheet and the payroll Period section can multiply periods × rate.
 * ──────────────────────────────────────────────────────────────────────────── */

/** "2082-05" — the BS month a period log is summarised over. */
const parseMonthBs = (value: unknown): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(text)) {
    throw new ApiError(400, "Provide a month as YYYY-MM (BS), e.g. 2082-05");
  }
  return text;
};

/** Periods only make sense on a day the teacher actually attended. */
const countsAsAttended = (status: string): boolean =>
  status === "PRESENT" ||
  status === "LATE" ||
  status === "HALF_DAY" ||
  status === "OFFICIAL_DUTY";

/**
 * GET /employee-attendance/periods
 *
 * Monthly period totals per teacher, with the day-by-day breakdown behind each total
 * and the pay estimate (periods × the teacher's period rate) for per-period contracts.
 */
export const getEmployeeAttendancePeriodLog = asyncHandler(
  async (req: Request, res: Response) => {
    await assertEmployeeAttendanceAccess(req, "TEACHER", "view");
    const schoolId = tenantObjectId(req);
    const monthBs = parseMonthBs(req.query.monthBs);
    const search = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    const [sheets, teachers] = await Promise.all([
      EmployeeAttendance.find({
        schoolId,
        category: "TEACHER",
        isDeleted: false,
        dateBs: { $regex: `^${monthBs}` }
      })
        .select("dateBs status entries")
        .sort({ dateBs: 1 })
        .lean(),
      Teacher.find({ schoolId })
        .populate("user", "fullName designation")
        .select("teacherCode user paymentType periodRateNpr basicSalaryNpr status")
        .sort({ teacherCode: 1 })
        .lean()
    ]);

    type DayEntry = {
      dateBs: string;
      status: string;
      periodsTaught?: number;
      recordStatus: string;
      /** Sheet is LOCKED — periods can no longer be edited from this screen. */
      locked: boolean;
    };

    const daysByTeacher = new Map<string, DayEntry[]>();
    for (const sheet of sheets) {
      for (const entry of sheet.entries ?? []) {
        if (!entry.teacherId) continue;
        const key = String(entry.teacherId);
        const list = daysByTeacher.get(key) ?? [];
        list.push({
          dateBs: String(sheet.dateBs),
          status: String(entry.status ?? ""),
          periodsTaught:
            typeof entry.periodsTaught === "number" && Number.isFinite(entry.periodsTaught)
              ? entry.periodsTaught
              : undefined,
          recordStatus: String(sheet.status ?? "DRAFT"),
          locked: String(sheet.status ?? "") === "LOCKED"
        });
        daysByTeacher.set(key, list);
      }
    }

    const rows = teachers
      .map((teacher) => {
        const teacherId = teacher._id.toString();
        const user = teacher.user as unknown as {
          fullName?: string;
          designation?: string;
        } | null;
        const fullName = user?.fullName ?? teacher.teacherCode;

        if (
          search &&
          !fullName.toLowerCase().includes(search) &&
          !String(teacher.teacherCode ?? "").toLowerCase().includes(search)
        ) {
          return null;
        }

        const days = (daysByTeacher.get(teacherId) ?? []).sort((left, right) =>
          left.dateBs.localeCompare(right.dateBs)
        );

        let totalPeriods = 0;
        let daysWithPeriods = 0;
        let attendedDays = 0;
        let attendedDaysMissingPeriods = 0;

        for (const day of days) {
          const attended = countsAsAttended(day.status);
          if (attended) attendedDays += 1;
          if (typeof day.periodsTaught === "number") {
            totalPeriods += day.periodsTaught;
            daysWithPeriods += 1;
          } else if (attended) {
            attendedDaysMissingPeriods += 1;
          }
        }

        const paymentType = String(teacher.paymentType ?? "MONTHLY").toUpperCase();
        const periodRateNpr = Math.max(
          0,
          Number(
            teacher.periodRateNpr || (paymentType === "PERIOD" ? teacher.basicSalaryNpr : 0)
          ) || 0
        );

        return {
          teacherId,
          employeeCode: teacher.teacherCode,
          fullName,
          designation: user?.designation || "Teacher",
          paymentType,
          periodRateNpr,
          totalPeriods,
          daysRecorded: days.length,
          daysWithPeriods,
          attendedDays,
          /** Days marked present where nobody entered a period count yet. */
          attendedDaysMissingPeriods,
          estimatedAmountNpr:
            paymentType === "PERIOD"
              ? Math.round(totalPeriods * periodRateNpr * 100) / 100
              : 0,
          days
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    // Per-period teachers first — they are the reason this log exists.
    rows.sort((left, right) => {
      if (left.paymentType !== right.paymentType) {
        if (left.paymentType === "PERIOD") return -1;
        if (right.paymentType === "PERIOD") return 1;
      }
      return left.fullName.localeCompare(right.fullName);
    });

    const periodTeachers = rows.filter((row) => row.paymentType === "PERIOD");

    return sendSuccess(res, "Period log fetched", {
      monthBs,
      sheetDates: sheets.map((sheet) => String(sheet.dateBs)),
      rows,
      totals: {
        teachers: rows.length,
        periodPaidTeachers: periodTeachers.length,
        totalPeriods: rows.reduce((sum, row) => sum + row.totalPeriods, 0),
        estimatedAmountNpr:
          Math.round(
            periodTeachers.reduce((sum, row) => sum + row.estimatedAmountNpr, 0) * 100
          ) / 100,
        daysMissingPeriods: rows.reduce(
          (sum, row) => sum + row.attendedDaysMissingPeriods,
          0
        )
      }
    });
  }
);

/**
 * POST /employee-attendance/periods
 *
 * Record the periods teachers took on one date. Body:
 *   { dateBs, entries: [{ teacherId, periodsTaught }], markPresent? }
 *
 * Periods are a detail of an attendance record, so a teacher needs a mark on that day.
 * When the day has no sheet yet — or a teacher has no row on it — `markPresent` (the
 * default) opens a DRAFT sheet and marks exactly those teachers PRESENT, because
 * recording that someone taught two periods asserts they were there. Send
 * `markPresent: false` to record only against teachers already marked and report the
 * rest as skipped, leaving the register untouched.
 *
 * A LOCKED sheet is refused so payroll cannot shift under an approved month, and the
 * existing PRESENT/ABSENT marks of already-marked teachers are never changed.
 */
export const recordEmployeeAttendancePeriods = asyncHandler(
  async (req: Request, res: Response) => {
    await assertEmployeeAttendanceAccess(req, "TEACHER", "edit");
    const schoolId = tenantObjectId(req);

    const body = (req.body ?? {}) as {
      dateBs?: unknown;
      entries?: unknown;
      markPresent?: unknown;
    };
    const dateBs = ensureValidBsDate(typeof body.dateBs === "string" ? body.dateBs : "");
    const markPresent = body.markPresent !== false;

    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      throw new ApiError(400, "Send at least one teacher's period count");
    }

    let record = await EmployeeAttendance.findOne({
      schoolId,
      category: "TEACHER",
      dateBs,
      isDeleted: false
    });

    if (record?.status === "LOCKED") {
      throw new ApiError(
        400,
        `The attendance sheet for ${dateBs} is locked. Unlock it before changing period counts.`
      );
    }

    // Only needed when a teacher has to be added to the sheet.
    const roster = await listTeachers(schoolId);
    const rosterById = new Map(roster.map((row) => [row._id, row]));

    if (!record) {
      if (!markPresent) {
        throw new ApiError(
          404,
          `No teacher attendance sheet exists for ${dateBs}. Take attendance for that day first, or allow marking teachers present while recording periods.`
        );
      }
      await assertEmployeeAttendanceAccess(req, "TEACHER", "create");
      const settings = await Setting.findOne({ schoolId })
        .select("academicYearBs")
        .lean();
      record = new EmployeeAttendance({
        schoolId,
        category: "TEACHER",
        dateBs,
        academicYearBs: settings?.academicYearBs ?? "",
        entries: [],
        status: "DRAFT",
        sourceDefault: "MANUAL",
        createdBy: actorId(req)
      });
    }

    const before = record.isNew ? null : record.toObject();
    const updated: string[] = [];
    const marked: string[] = [];
    const skipped: Array<{ teacherId: string; reason: string }> = [];

    for (const raw of body.entries as Array<Record<string, unknown>>) {
      const teacherId = typeof raw.teacherId === "string" ? raw.teacherId : "";
      if (!teacherId) {
        skipped.push({ teacherId: "", reason: "Missing teacher" });
        continue;
      }

      // An explicit null / "" clears the count back to "not recorded".
      const clearing = raw.periodsTaught === null || raw.periodsTaught === "";
      const periods = clearing ? null : Number(raw.periodsTaught);
      if (!clearing && (!Number.isFinite(periods) || periods! < 0 || periods! > 24)) {
        skipped.push({ teacherId, reason: "Periods must be between 0 and 24" });
        continue;
      }

      let entry = record.entries.find((row) => String(row.teacherId ?? "") === teacherId);

      if (!entry) {
        // Nothing to clear on a teacher who was never on the sheet.
        if (clearing) continue;
        if (!markPresent) {
          skipped.push({
            teacherId,
            reason: "This teacher has no attendance mark on that day"
          });
          continue;
        }
        const person = rosterById.get(teacherId);
        if (!person) {
          skipped.push({ teacherId, reason: "Teacher not found on the roster" });
          continue;
        }
        record.entries.push({
          teacherId,
          employeeUserId: person.userId,
          employeeCode: person.employeeCode,
          fullName: person.fullName,
          department: person.department ?? "",
          designation: person.designation ?? "",
          // Recording periods asserts the teacher was present that day.
          status: "PRESENT",
          checkInTime: "",
          checkOutTime: "",
          remarks: "",
          source: "MANUAL",
          deviceId: "",
          externalRef: ""
        } as unknown as (typeof record.entries)[number]);
        entry = record.entries[record.entries.length - 1];
        marked.push(teacherId);
      }

      if (!entry) {
        skipped.push({ teacherId, reason: "Could not add this teacher to the sheet" });
        continue;
      }

      entry.periodsTaught = clearing ? undefined : (periods as number);
      updated.push(teacherId);
    }

    if (updated.length === 0) {
      throw new ApiError(400, skipped[0]?.reason ?? "No period counts could be saved");
    }

    await record.save();

    await recordAudit(req, {
      action: "employee-attendance.periods.record",
      entity: "EmployeeAttendance",
      entityId: record._id.toString(),
      before,
      after: record.toObject()
    });

    const parts = [`Saved periods for ${updated.length} teacher(s)`];
    if (marked.length > 0) {
      parts.push(`${marked.length} marked present on ${dateBs}`);
    }
    if (skipped.length > 0) {
      parts.push(`${skipped.length} skipped`);
    }

    return sendSuccess(res, parts.join(" · "), {
      dateBs,
      updated: updated.length,
      markedPresent: marked.length,
      skipped
    });
  }
);

/**
 * GET /employee-attendance/periods/day?dateBs=YYYY-MM-DD
 *
 * The full teacher roster for one date with that day's attendance mark and period
 * count, so periods can be entered for any day — including a day whose attendance
 * sheet has not been opened yet.
 */
export const getEmployeeAttendancePeriodDay = asyncHandler(
  async (req: Request, res: Response) => {
    await assertEmployeeAttendanceAccess(req, "TEACHER", "view");
    const schoolId = tenantObjectId(req);
    const dateBs = ensureValidBsDate(
      typeof req.query.dateBs === "string" && req.query.dateBs
        ? req.query.dateBs
        : getTodayBs()
    );

    const [record, teachers] = await Promise.all([
      EmployeeAttendance.findOne({
        schoolId,
        category: "TEACHER",
        dateBs,
        isDeleted: false
      })
        .select("status entries")
        .lean(),
      Teacher.find({ schoolId })
        .populate("user", "fullName designation")
        .select("teacherCode user paymentType periodRateNpr basicSalaryNpr")
        .sort({ teacherCode: 1 })
        .lean()
    ]);

    const entryByTeacher = new Map<string, Record<string, unknown>>();
    for (const entry of (record?.entries ?? []) as unknown as Array<Record<string, unknown>>) {
      if (entry.teacherId) entryByTeacher.set(String(entry.teacherId), entry);
    }

    const rows = teachers.map((teacher) => {
      const teacherId = teacher._id.toString();
      const user = teacher.user as unknown as {
        fullName?: string;
        designation?: string;
      } | null;
      const entry = entryByTeacher.get(teacherId);
      const paymentType = String(teacher.paymentType ?? "MONTHLY").toUpperCase();

      return {
        teacherId,
        employeeCode: teacher.teacherCode,
        fullName: user?.fullName ?? teacher.teacherCode,
        designation: user?.designation || "Teacher",
        paymentType,
        periodRateNpr: Math.max(
          0,
          Number(
            teacher.periodRateNpr || (paymentType === "PERIOD" ? teacher.basicSalaryNpr : 0)
          ) || 0
        ),
        /** Empty when this teacher has no mark on that day. */
        status: entry ? String(entry.status ?? "") : "",
        marked: Boolean(entry),
        periodsTaught:
          entry && typeof entry.periodsTaught === "number" && Number.isFinite(entry.periodsTaught)
            ? (entry.periodsTaught as number)
            : undefined
      };
    });

    // Per-period teachers first — they are the reason this screen exists.
    rows.sort((left, right) => {
      if (left.paymentType !== right.paymentType) {
        if (left.paymentType === "PERIOD") return -1;
        if (right.paymentType === "PERIOD") return 1;
      }
      return left.fullName.localeCompare(right.fullName);
    });

    return sendSuccess(res, "Period day fetched", {
      dateBs,
      sheetExists: Boolean(record),
      sheetStatus: String(record?.status ?? ""),
      locked: String(record?.status ?? "") === "LOCKED",
      rows
    });
  }
);
