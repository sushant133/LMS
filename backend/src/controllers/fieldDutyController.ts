import type { Request, Response } from "express";
import {
  canManageInstitution,
  fieldDutyAttendanceSubmitSchema,
  fieldDutyAttendanceUpdateSchema,
  fieldDutyScheduleSchema,
  fieldDutyUnlockSchema
} from "@phit-erp/shared";
import { FieldDutyAttendance } from "../models/FieldDutyAttendance.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { Student } from "../models/Student.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  assertScheduleAccess,
  buildFieldDutyDashboard,
  buildStudentFieldDutyPortal,
  emptyToUndef,
  getEligibleStudentsForDuty,
  getFieldSupervisorStaffScope,
  isDateWithinDuty,
  notifyFieldDutyAttendance,
  serializeAttendance,
  serializeSchedule
} from "../utils/fieldDutyService.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { sendSuccess } from "../utils/response.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { tenantObjectId } from "../utils/tenant.js";

const actorId = (req: Request) => req.user!.userId;

export const listFieldDutySchedules = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };

  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string" && req.query.yearId) filter.yearId = req.query.yearId;
  if (typeof req.query.academicYearBs === "string" && req.query.academicYearBs) {
    filter.academicYearBs = req.query.academicYearBs;
  }

  if (!canManageInstitution(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (!staffScope) {
      throw new ApiError(403, "Not allowed to list field duty schedules");
    }
    filter.supervisorStaffId = staffScope.staffId;
  } else if (typeof req.query.supervisorStaffId === "string" && req.query.supervisorStaffId) {
    filter.supervisorStaffId = req.query.supervisorStaffId;
  }

  const schedules = await FieldDutySchedule.find(filter).sort({ startDateBs: -1 }).lean();
  const rows = await Promise.all(
    schedules.map((s) => serializeSchedule(s as never, { includeStudentCount: true }))
  );
  return sendSuccess(res, "Field duty schedules fetched", rows);
});

export const createFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can create field duty schedules");
  }
  const payload = fieldDutyScheduleSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);

  const created = await FieldDutySchedule.create({
    schoolId: tenantObjectId(req),
    academicYearBs: payload.academicYearBs,
    faculty: emptyToUndef(payload.faculty) ?? "",
    batchId: payload.batchId,
    yearId: payload.yearId,
    sectionId: emptyToUndef(payload.sectionId),
    hospitalName: payload.hospitalName.trim(),
    department: payload.department.trim(),
    ward: emptyToUndef(payload.ward) ?? "",
    supervisorStaffId: payload.supervisorStaffId,
    clinicalInstructorName: emptyToUndef(payload.clinicalInstructorName) ?? "",
    hospitalSupervisorName: emptyToUndef(payload.hospitalSupervisorName) ?? "",
    startDateBs: payload.startDateBs,
    endDateBs: payload.endDateBs,
    shift: payload.shift,
    remarks: emptyToUndef(payload.remarks) ?? "",
    status: payload.status,
    createdBy: actorId(req)
  });

  await recordAudit(req, {
    action: "field_duty.schedule.create",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: created._id.toString(),
    after: created
  });

  const serialized = await serializeSchedule(created.toObject() as never, { includeStudentCount: true });
  return sendSuccess(res, "Field duty schedule created", serialized, 201);
});

export const updateFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can update field duty schedules");
  }
  const payload = fieldDutyScheduleSchema.partial().parse(req.body);
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field duty schedule not found");

  if (payload.startDateBs) ensureValidBsDate(payload.startDateBs);
  if (payload.endDateBs) ensureValidBsDate(payload.endDateBs);

  Object.assign(existing, {
    ...payload,
    faculty: payload.faculty !== undefined ? emptyToUndef(payload.faculty) ?? "" : existing.faculty,
    sectionId:
      payload.sectionId !== undefined ? emptyToUndef(payload.sectionId) : existing.sectionId,
    ward: payload.ward !== undefined ? emptyToUndef(payload.ward) ?? "" : existing.ward,
    clinicalInstructorName:
      payload.clinicalInstructorName !== undefined
        ? emptyToUndef(payload.clinicalInstructorName) ?? ""
        : existing.clinicalInstructorName,
    hospitalSupervisorName:
      payload.hospitalSupervisorName !== undefined
        ? emptyToUndef(payload.hospitalSupervisorName) ?? ""
        : existing.hospitalSupervisorName,
    remarks: payload.remarks !== undefined ? emptyToUndef(payload.remarks) ?? "" : existing.remarks
  });
  await existing.save();

  await recordAudit(req, {
    action: "field_duty.schedule.update",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: existing._id.toString(),
    after: existing
  });

  const serialized = await serializeSchedule(existing.toObject() as never, { includeStudentCount: true });
  return sendSuccess(res, "Field duty schedule updated", serialized);
});

export const deleteFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can delete field duty schedules");
  }
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field duty schedule not found");
  existing.isDeleted = true;
  existing.status = "CANCELLED";
  await existing.save();
  return sendSuccess(res, "Field duty schedule deleted");
});

/** Auto roster for a schedule (active students of batch + year). */
export const getFieldDutyRoster = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!schedule) throw new ApiError(404, "Field duty schedule not found");
  await assertScheduleAccess(req, schedule);

  const students = await getEligibleStudentsForDuty(
    schedule.schoolId,
    schedule.batchId.toString(),
    schedule.yearId.toString()
  );
  return sendSuccess(res, "Field duty roster fetched", {
    schedule: await serializeSchedule(schedule as never, { includeStudentCount: true }),
    students
  });
});

export const listFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (typeof req.query.dateBs === "string" && req.query.dateBs) filter.dateBs = req.query.dateBs;
  if (typeof req.query.scheduleId === "string" && req.query.scheduleId) {
    filter.scheduleId = req.query.scheduleId;
  }
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;

  if (!canManageInstitution(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (!staffScope) throw new ApiError(403, "Not allowed");
    filter.supervisorStaffId = staffScope.staffId;
  }

  const rows = await FieldDutyAttendance.find(filter).sort({ dateBs: -1 }).limit(100).lean();
  const serialized = await Promise.all(rows.map((r) => serializeAttendance(r as never)));
  return sendSuccess(res, "Field duty attendance fetched", serialized);
});

export const getFieldDutyAttendanceById = asyncHandler(async (req: Request, res: Response) => {
  const row = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!row) throw new ApiError(404, "Field duty attendance not found");
  await assertScheduleAccess(req, row);
  return sendSuccess(res, "Field duty attendance fetched", await serializeAttendance(row as never));
});

export const submitFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = fieldDutyAttendanceSubmitSchema.parse(req.body);
  const dateBs = ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);

  const schedule = await FieldDutySchedule.findOne({
    _id: payload.scheduleId,
    schoolId,
    isDeleted: false,
    status: "ACTIVE"
  });
  if (!schedule) throw new ApiError(404, "Active field duty schedule not found");
  await assertScheduleAccess(req, schedule);

  if (!isDateWithinDuty(dateBs, schedule.startDateBs, schedule.endDateBs)) {
    throw new ApiError(400, "Attendance date is outside the duty period");
  }

  const existing = await FieldDutyAttendance.findOne({
    schoolId,
    scheduleId: schedule._id,
    dateBs,
    isDeleted: false
  });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "LOCKED")) {
    throw new ApiError(400, "Attendance already submitted for this duty and date. Ask admin to unlock.");
  }

  const eligible = await getEligibleStudentsForDuty(
    schoolId,
    schedule.batchId.toString(),
    schedule.yearId.toString()
  );
  const eligibleIds = new Set(eligible.map((s) => s._id));
  for (const entry of payload.entries) {
    if (!eligibleIds.has(entry.studentId)) {
      throw new ApiError(400, `Student ${entry.studentId} is not in the current year roster for this duty`);
    }
  }

  const docPayload = {
    schoolId,
    scheduleId: schedule._id,
    dateBs,
    hospitalName: schedule.hospitalName,
    department: schedule.department,
    ward: schedule.ward ?? "",
    shift: schedule.shift,
    batchId: schedule.batchId,
    yearId: schedule.yearId,
    supervisorStaffId:
      schedule.supervisorStaffId ?? schedule.supervisorTeacherId,
    entries: payload.entries.map((e) => ({
      studentId: e.studentId,
      status: e.status,
      remarks: emptyToUndef(e.remarks) ?? ""
    })),
    notes: emptyToUndef(payload.notes) ?? "",
    status: "LOCKED" as const,
    createdBy: actorId(req),
    submittedBy: actorId(req),
    submittedAt: new Date()
  };

  let saved;
  if (existing) {
    Object.assign(existing, docPayload);
    await existing.save();
    saved = existing;
  } else {
    saved = await FieldDutyAttendance.create(docPayload);
  }

  await notifyFieldDutyAttendance(schoolId.toString(), {
    dateBs,
    hospitalName: schedule.hospitalName,
    department: schedule.department,
    entries: docPayload.entries
  });

  await recordAudit(req, {
    action: "field_duty.attendance.submit",
    entity: "FIELD_DUTY_ATTENDANCE",
    entityId: saved._id.toString(),
    after: saved
  });

  return sendSuccess(
    res,
    "Field duty attendance submitted",
    await serializeAttendance(saved.toObject() as never),
    201
  );
});

export const updateFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can edit field duty attendance after submission");
  }
  const payload = fieldDutyAttendanceUpdateSchema.parse(req.body);
  const existing = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field duty attendance not found");
  if (existing.status === "LOCKED" || existing.status === "SUBMITTED") {
    throw new ApiError(400, "Unlock attendance before editing");
  }

  existing.entries = payload.entries.map((e) => ({
    studentId: e.studentId as never,
    status: e.status,
    remarks: emptyToUndef(e.remarks) ?? ""
  })) as never;
  if (payload.notes !== undefined) existing.notes = emptyToUndef(payload.notes) ?? "";
  await existing.save();

  return sendSuccess(res, "Field duty attendance updated", await serializeAttendance(existing.toObject() as never));
});

export const unlockFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can unlock field duty attendance");
  }
  const { reason } = fieldDutyUnlockSchema.parse(req.body);
  const existing = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field duty attendance not found");

  existing.status = "DRAFT";
  existing.unlockedBy = actorId(req) as never;
  existing.unlockedAt = new Date();
  existing.unlockReason = reason;
  await existing.save();

  await recordAudit(req, {
    action: "field_duty.attendance.unlock",
    entity: "FIELD_DUTY_ATTENDANCE",
    entityId: existing._id.toString(),
    after: { reason }
  });

  return sendSuccess(res, "Field duty attendance unlocked", await serializeAttendance(existing.toObject() as never));
});

export const getFieldDutyDashboard = asyncHandler(async (req: Request, res: Response) => {
  const dashboard = await buildFieldDutyDashboard(req);
  return sendSuccess(res, "Field duty dashboard fetched", dashboard);
});

export const getFieldDutyReports = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "") && req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Not allowed");
  }
  const schoolId = tenantObjectId(req);
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  const filter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: { $in: ["SUBMITTED", "LOCKED"] }
  };
  if (dateFrom || dateTo) {
    filter.dateBs = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {})
    };
  }
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.scheduleId === "string" && req.query.scheduleId) {
    filter.scheduleId = req.query.scheduleId;
  }
  if (!canManageInstitution(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (staffScope) filter.supervisorStaffId = staffScope.staffId;
  }

  const rows = await FieldDutyAttendance.find(filter).sort({ dateBs: -1 }).limit(500).lean();
  const serialized = await Promise.all(rows.map((r) => serializeAttendance(r as never)));

  // Flatten for export-friendly report
  const flat = serialized.flatMap((rec) =>
    rec.entries.map((e) => ({
      dateBs: rec.dateBs,
      hospital: rec.hospitalName,
      department: rec.department,
      ward: rec.ward ?? "",
      shift: rec.shift,
      studentName: e.student?.fullName ?? "",
      admissionNumber: e.student?.admissionNumber ?? "",
      rollNumber: e.student?.rollNumber ?? "",
      status: e.status,
      remarks: e.remarks ?? "",
      recordStatus: rec.status
    }))
  );

  return sendSuccess(res, "Field duty reports fetched", { records: serialized, flat });
});

/** Student portal: own field duty attendance */
export const getMyFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getStudentProfile(req);
  if (!profile?.studentId) throw new ApiError(403, "Student profile required");
  const data = await buildStudentFieldDutyPortal(tenantObjectId(req), profile.studentId);
  return sendSuccess(res, "Student field duty attendance fetched", data);
});

/** Parent portal: child's field duty attendance */
export const getChildFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT" && !canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Parent access required");
  }
  const studentId = String(req.params.studentId ?? "");
  if (!studentId) throw new ApiError(400, "studentId is required");

  if (req.user?.role === "PARENT") {
    const linked = await getLinkedStudentIds(req);
    if (!linked.map(String).includes(studentId)) {
      throw new ApiError(403, "You can only view your linked children");
    }
  }

  const student = await Student.findOne({
    _id: studentId,
    schoolId: tenantObjectId(req)
  })
    .select("_id")
    .lean();
  if (!student) throw new ApiError(404, "Student not found");

  const data = await buildStudentFieldDutyPortal(tenantObjectId(req), studentId);
  return sendSuccess(res, "Child field duty attendance fetched", data);
});

export const getTodayFieldDutyContext = asyncHandler(async (req: Request, res: Response) => {
  const todayBs = getTodayBs();
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $lte: todayBs },
    endDateBs: { $gte: todayBs }
  };

  if (!canManageInstitution(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (!staffScope) throw new ApiError(403, "Field supervisor staff scope required");
    filter.supervisorStaffId = staffScope.staffId;
  }

  const schedules = await FieldDutySchedule.find(filter).lean();
  const contexts = await Promise.all(
    schedules.map(async (sch) => {
      const students = await getEligibleStudentsForDuty(
        schoolId,
        sch.batchId.toString(),
        sch.yearId.toString()
      );
      const existing = await FieldDutyAttendance.findOne({
        schoolId,
        scheduleId: sch._id,
        dateBs: todayBs,
        isDeleted: false
      }).lean();
      return {
        dateBs: todayBs,
        schedule: await serializeSchedule(sch as never, { includeStudentCount: true }),
        students,
        existingAttendance: existing
          ? await serializeAttendance(existing as never)
          : null
      };
    })
  );

  return sendSuccess(res, "Today field duty context fetched", contexts);
});
