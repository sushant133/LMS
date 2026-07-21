import type { Request, Response } from "express";
import {
  canManageInstitution,
  fieldDutyAssignCoordinatorsSchema,
  fieldDutyAssignStudentsSchema,
  fieldDutyAttendanceSubmitSchema,
  fieldDutyAttendanceUpdateSchema,
  fieldDutyEditRequestReviewSchema,
  fieldDutyEditRequestSchema,
  fieldDutyScheduleSchema,
  fieldDutyScheduleUpdateSchema,
  fieldDutyUnlockSchema,
  hasInstitutionAccess,
  postingTypeToSection,
  postingTypesForSection
} from "@phit-erp/shared";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { FieldDutyAttendance } from "../models/FieldDutyAttendance.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { Student } from "../models/Student.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  assertScheduleAccess,
  buildFieldDutyDashboard,
  buildFieldDutyMonitoring,
  buildStudentFieldDutyPortal,
  emptyToUndef,
  getEligibleStudentsForDuty,
  getFieldSupervisorStaffScope,
  isDateWithinDuty,
  notifyFieldDutyAttendance,
  resolvePostingType,
  resolveSiteName,
  scheduleAccessFilter,
  serializeAttendance,
  serializeSchedule
} from "../utils/fieldDutyService.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { sendSuccess } from "../utils/response.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { tenantObjectId } from "../utils/tenant.js";

const actorId = (req: Request) => req.user!.userId;

const normalizeSiteName = (payload: {
  siteName?: string;
  hospitalName?: string;
}): string => (payload.siteName || payload.hospitalName || "").trim();

const assertStaffExists = async (schoolId: unknown, staffId: string) => {
  const staff = await CollegeStaff.findOne({
    _id: staffId,
    schoolId,
    status: "ACTIVE"
  })
    .select("_id")
    .lean();
  if (!staff) {
    throw new ApiError(400, "Coordinator must be an active college staff member");
  }
};

export const listFieldDutySchedules = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  let filter: Record<string, unknown> = { schoolId, isDeleted: false };

  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string" && req.query.yearId) filter.yearId = req.query.yearId;
  if (typeof req.query.academicYearBs === "string" && req.query.academicYearBs) {
    filter.academicYearBs = req.query.academicYearBs;
  }
  if (typeof req.query.postingType === "string" && req.query.postingType) {
    filter.postingType = req.query.postingType.toUpperCase();
  }
  if (typeof req.query.section === "string" && req.query.section) {
    const hospitalTypes = postingTypesForSection("HOSPITAL");
    const priorAnd = Array.isArray(filter.$and) ? (filter.$and as unknown[]) : [];
    // Legacy rows without postingType are treated as HOSPITAL.
    if (req.query.section === "HOSPITAL") {
      filter.$and = [
        ...priorAnd,
        {
          $or: [
            { postingType: { $in: hospitalTypes } },
            { postingType: { $exists: false } },
            { postingType: null },
            { postingType: "" }
          ]
        }
      ];
    } else {
      filter.$and = [
        ...priorAnd,
        { postingType: { $exists: true, $nin: hospitalTypes, $ne: "" } }
      ];
    }
  }

  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    filter = await scheduleAccessFilter(req, filter);
  } else if (typeof req.query.supervisorStaffId === "string" && req.query.supervisorStaffId) {
    filter.$or = [
      { supervisorStaffId: req.query.supervisorStaffId },
      { assistantCoordinatorStaffIds: req.query.supervisorStaffId }
    ];
  }

  const schedules = await FieldDutySchedule.find(filter).sort({ startDateBs: -1 }).lean();
  const rows = await Promise.all(
    schedules.map((s) => serializeSchedule(s as never, { includeStudentCount: true }))
  );
  return sendSuccess(res, "Field postings fetched", rows);
});

export const createFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can create field postings");
  }
  const payload = fieldDutyScheduleSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);

  const schoolId = tenantObjectId(req);
  await assertStaffExists(schoolId, payload.supervisorStaffId);
  for (const aid of payload.assistantCoordinatorStaffIds ?? []) {
    if (aid === payload.supervisorStaffId) continue;
    await assertStaffExists(schoolId, aid);
  }

  const siteName = normalizeSiteName(payload);
  const postingType = (payload.postingType || "HOSPITAL").toUpperCase();
  const assistants = (payload.assistantCoordinatorStaffIds ?? []).filter(
    (id) => id !== payload.supervisorStaffId
  );

  if (payload.rosterMode === "MANUAL" && (payload.assignedStudentIds ?? []).length) {
    const count = await Student.countDocuments({
      schoolId,
      _id: { $in: payload.assignedStudentIds },
      academicStatus: "ACTIVE"
    });
    if (count !== payload.assignedStudentIds!.length) {
      throw new ApiError(400, "One or more students are invalid or inactive");
    }
  }
  if (payload.rosterMode === "MULTI_SHIFT") {
    const shifts = payload.studentShifts ?? [];
    if (!shifts.length) {
      throw new ApiError(400, "Assign at least one student to a shift");
    }
    const ids = shifts.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(400, "Each student can only be assigned to one shift");
    }
    const count = await Student.countDocuments({
      schoolId,
      _id: { $in: ids },
      academicStatus: "ACTIVE"
    });
    if (count !== ids.length) {
      throw new ApiError(400, "One or more students are invalid or inactive");
    }
  }

  const created = await FieldDutySchedule.create({
    schoolId,
    academicYearBs: payload.academicYearBs,
    faculty: emptyToUndef(payload.faculty) ?? "",
    semesterBs: emptyToUndef(payload.semesterBs) ?? "",
    batchId: payload.batchId,
    yearId: payload.yearId,
    sectionId: emptyToUndef(payload.sectionId),
    postingType,
    siteName,
    hospitalName: siteName,
    address: emptyToUndef(payload.address) ?? "",
    department: emptyToUndef(payload.department) ?? "",
    ward: emptyToUndef(payload.ward) ?? "",
    supervisorStaffId: payload.supervisorStaffId,
    assistantCoordinatorStaffIds: assistants,
    clinicalInstructorName: emptyToUndef(payload.clinicalInstructorName) ?? "",
    hospitalSupervisorName: emptyToUndef(payload.hospitalSupervisorName) ?? "",
    startDateBs: payload.startDateBs,
    endDateBs: payload.endDateBs,
    shift: payload.rosterMode === "MULTI_SHIFT" ? "DAY" : payload.shift,
    remarks: emptyToUndef(payload.remarks) ?? "",
    status: payload.status,
    rosterMode: payload.rosterMode ?? "AUTO_BATCH_YEAR",
    assignedStudentIds:
      payload.rosterMode === "MANUAL" ? (payload.assignedStudentIds ?? []) : [],
    studentShifts:
      payload.rosterMode === "MULTI_SHIFT"
        ? (payload.studentShifts ?? []).map((r) => ({
            studentId: r.studentId,
            shift: r.shift
          }))
        : [],
    createdBy: actorId(req)
  });

  await recordAudit(req, {
    action: "field_duty.schedule.create",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: created._id.toString(),
    after: created
  });

  const serialized = await serializeSchedule(created.toObject() as never, {
    includeStudentCount: true
  });
  return sendSuccess(res, "Field posting created", serialized, 201);
});

export const updateFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can update field postings");
  }
  const payload = fieldDutyScheduleUpdateSchema.parse(req.body);
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field posting not found");

  if (payload.startDateBs) ensureValidBsDate(payload.startDateBs);
  if (payload.endDateBs) ensureValidBsDate(payload.endDateBs);

  if (payload.supervisorStaffId) {
    await assertStaffExists(tenantObjectId(req), payload.supervisorStaffId);
  }
  if (payload.assistantCoordinatorStaffIds) {
    for (const aid of payload.assistantCoordinatorStaffIds) {
      await assertStaffExists(tenantObjectId(req), aid);
    }
  }

  const siteName =
    payload.siteName !== undefined || payload.hospitalName !== undefined
      ? normalizeSiteName({
          siteName: payload.siteName,
          hospitalName: payload.hospitalName
        })
      : undefined;

  Object.assign(existing, {
    ...payload,
    postingType:
      payload.postingType !== undefined
        ? payload.postingType.toUpperCase()
        : existing.postingType,
    faculty: payload.faculty !== undefined ? emptyToUndef(payload.faculty) ?? "" : existing.faculty,
    semesterBs:
      payload.semesterBs !== undefined
        ? emptyToUndef(payload.semesterBs) ?? ""
        : existing.semesterBs,
    sectionId:
      payload.sectionId !== undefined ? emptyToUndef(payload.sectionId) : existing.sectionId,
    address:
      payload.address !== undefined ? emptyToUndef(payload.address) ?? "" : existing.address,
    department:
      payload.department !== undefined
        ? emptyToUndef(payload.department) ?? ""
        : existing.department,
    ward: payload.ward !== undefined ? emptyToUndef(payload.ward) ?? "" : existing.ward,
    clinicalInstructorName:
      payload.clinicalInstructorName !== undefined
        ? emptyToUndef(payload.clinicalInstructorName) ?? ""
        : existing.clinicalInstructorName,
    hospitalSupervisorName:
      payload.hospitalSupervisorName !== undefined
        ? emptyToUndef(payload.hospitalSupervisorName) ?? ""
        : existing.hospitalSupervisorName,
    remarks:
      payload.remarks !== undefined ? emptyToUndef(payload.remarks) ?? "" : existing.remarks,
    assistantCoordinatorStaffIds:
      payload.assistantCoordinatorStaffIds !== undefined
        ? payload.assistantCoordinatorStaffIds.filter(
            (id) => id !== (payload.supervisorStaffId ?? existing.supervisorStaffId?.toString())
          )
        : existing.assistantCoordinatorStaffIds,
    assignedStudentIds: (() => {
      if (payload.rosterMode === "MANUAL") {
        return payload.assignedStudentIds ?? existing.assignedStudentIds;
      }
      if (payload.rosterMode === "AUTO_BATCH_YEAR" || payload.rosterMode === "MULTI_SHIFT") {
        return [];
      }
      if (payload.assignedStudentIds !== undefined) return payload.assignedStudentIds;
      return existing.assignedStudentIds;
    })(),
    studentShifts: (() => {
      if (payload.rosterMode === "MULTI_SHIFT") {
        return (payload.studentShifts ?? []).map((r) => ({
          studentId: r.studentId as never,
          shift: r.shift
        }));
      }
      if (payload.rosterMode === "AUTO_BATCH_YEAR" || payload.rosterMode === "MANUAL") {
        return [];
      }
      if (payload.studentShifts !== undefined) {
        return payload.studentShifts.map((r) => ({
          studentId: r.studentId as never,
          shift: r.shift
        }));
      }
      return existing.studentShifts;
    })()
  });

  if (siteName !== undefined) {
    existing.siteName = siteName;
    existing.hospitalName = siteName;
  }

  await existing.save();

  await recordAudit(req, {
    action: "field_duty.schedule.update",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: existing._id.toString(),
    after: existing
  });

  const serialized = await serializeSchedule(existing.toObject() as never, {
    includeStudentCount: true
  });
  return sendSuccess(res, "Field posting updated", serialized);
});

export const deleteFieldDutySchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can delete field postings");
  }
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field posting not found");
  existing.isDeleted = true;
  existing.status = "CANCELLED";
  await existing.save();
  return sendSuccess(res, "Field posting deleted");
});

/** Assign / reassign primary + assistant coordinators from existing staff. */
export const assignFieldCoordinators = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can assign field coordinators");
  }
  const payload = fieldDutyAssignCoordinatorsSchema.parse(req.body);
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field posting not found");

  await assertStaffExists(tenantObjectId(req), payload.supervisorStaffId);
  for (const aid of payload.assistantCoordinatorStaffIds ?? []) {
    await assertStaffExists(tenantObjectId(req), aid);
  }

  existing.supervisorStaffId = payload.supervisorStaffId as never;
  existing.assistantCoordinatorStaffIds = (payload.assistantCoordinatorStaffIds ?? []).filter(
    (id) => id !== payload.supervisorStaffId
  ) as never;
  await existing.save();

  await recordAudit(req, {
    action: "field_duty.schedule.assign_coordinators",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: existing._id.toString(),
    after: {
      supervisorStaffId: payload.supervisorStaffId,
      assistantCoordinatorStaffIds: payload.assistantCoordinatorStaffIds
    }
  });

  return sendSuccess(
    res,
    "Field coordinators assigned",
    await serializeSchedule(existing.toObject() as never, { includeStudentCount: true })
  );
});

/** Assign students by manual list or switch to auto batch/year roster. */
export const assignFieldStudents = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can assign students to field postings");
  }
  const payload = fieldDutyAssignStudentsSchema.parse(req.body);
  const existing = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field posting not found");

  if (payload.rosterMode === "MANUAL") {
    if (!payload.assignedStudentIds.length) {
      throw new ApiError(400, "Select at least one student for manual assignment");
    }
    const count = await Student.countDocuments({
      schoolId: tenantObjectId(req),
      _id: { $in: payload.assignedStudentIds },
      academicStatus: "ACTIVE"
    });
    if (count !== payload.assignedStudentIds.length) {
      throw new ApiError(400, "One or more students are invalid or inactive");
    }
  }

  if (payload.rosterMode === "MULTI_SHIFT") {
    if (!payload.studentShifts.length) {
      throw new ApiError(400, "Assign at least one student to a shift");
    }
    const ids = payload.studentShifts.map((r) => r.studentId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new ApiError(400, "Each student can only be assigned to one shift");
    }
    const count = await Student.countDocuments({
      schoolId: tenantObjectId(req),
      _id: { $in: ids },
      academicStatus: "ACTIVE"
    });
    if (count !== ids.length) {
      throw new ApiError(400, "One or more students are invalid or inactive");
    }
  }

  existing.rosterMode = payload.rosterMode;
  existing.assignedStudentIds =
    payload.rosterMode === "MANUAL" ? (payload.assignedStudentIds as never) : ([] as never);
  existing.studentShifts =
    payload.rosterMode === "MULTI_SHIFT"
      ? (payload.studentShifts.map((r) => ({
          studentId: r.studentId,
          shift: r.shift
        })) as never)
      : ([] as never);
  await existing.save();

  await recordAudit(req, {
    action: "field_duty.schedule.assign_students",
    entity: "FIELD_DUTY_SCHEDULE",
    entityId: existing._id.toString(),
    after: {
      rosterMode: payload.rosterMode,
      assignedStudentIds: payload.assignedStudentIds,
      studentShifts: payload.studentShifts
    }
  });

  return sendSuccess(
    res,
    "Students assigned to field posting",
    await serializeSchedule(existing.toObject() as never, { includeStudentCount: true })
  );
});

/** Roster for a posting (manual, auto, or multi-shift). Optional ?shift= for MULTI_SHIFT. */
export const getFieldDutyRoster = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await FieldDutySchedule.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!schedule) throw new ApiError(404, "Field posting not found");
  await assertScheduleAccess(req, schedule);

  const filterShift =
    typeof req.query.shift === "string" && req.query.shift
      ? req.query.shift.toUpperCase()
      : undefined;

  const students = await getEligibleStudentsForDuty(
    schedule.schoolId,
    schedule.batchId.toString(),
    schedule.yearId.toString(),
    {
      rosterMode: schedule.rosterMode as string,
      assignedStudentIds: schedule.assignedStudentIds as unknown[],
      studentShifts: schedule.studentShifts as Array<{ studentId: unknown; shift: string }>,
      filterShift:
        schedule.rosterMode === "MULTI_SHIFT" ? filterShift : undefined,
      defaultShift: (schedule.shift as string) || "DAY"
    }
  );
  return sendSuccess(res, "Field posting roster fetched", {
    schedule: await serializeSchedule(schedule as never, { includeStudentCount: true }),
    students,
    filterShift: filterShift ?? null
  });
});

/**
 * Candidate students for assignment (filter by batch/year/faculty/semester).
 * Admin only.
 */
export const listAssignableStudents = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can list assignable students");
  }
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = {
    schoolId,
    academicStatus: "ACTIVE"
  };
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string" && req.query.yearId) filter.yearId = req.query.yearId;
  // Note: Student model has no faculty/program field — filter by batch + year only.

  const students = await Student.find(filter)
    .populate("user", "fullName")
    .sort({ rollNumber: 1 })
    .limit(500)
    .lean();

  const rows = students.map((s) => {
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

  return sendSuccess(res, "Assignable students fetched", rows);
});

export const listFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (typeof req.query.dateBs === "string" && req.query.dateBs) filter.dateBs = req.query.dateBs;
  if (typeof req.query.scheduleId === "string" && req.query.scheduleId) {
    filter.scheduleId = req.query.scheduleId;
  }
  if (typeof req.query.batchId === "string" && req.query.batchId) filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string" && req.query.yearId) filter.yearId = req.query.yearId;
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.postingType === "string" && req.query.postingType) {
    filter.postingType = req.query.postingType.toUpperCase();
  }
  if (typeof req.query.editRequestStatus === "string" && req.query.editRequestStatus) {
    filter["editRequest.status"] = req.query.editRequestStatus;
  }
  if (typeof req.query.shift === "string" && req.query.shift) {
    filter.shift = req.query.shift.toUpperCase();
  }

  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (!staffScope) throw new ApiError(403, "Not allowed");
    // Scope to postings where this staff is coordinator
    const mySchedules = await FieldDutySchedule.find({
      schoolId,
      isDeleted: false,
      $or: [
        { supervisorStaffId: staffScope.staffId },
        { assistantCoordinatorStaffIds: staffScope.staffId }
      ]
    })
      .select("_id")
      .lean();
    const allowedIds = mySchedules.map((s) => s._id.toString());
    const requested =
      typeof req.query.scheduleId === "string" && req.query.scheduleId
        ? req.query.scheduleId
        : null;
    if (requested) {
      if (!allowedIds.includes(requested)) {
        throw new ApiError(403, "Not allowed to view this posting attendance");
      }
      filter.scheduleId = requested;
    } else {
      filter.scheduleId = { $in: mySchedules.map((s) => s._id) };
    }
  } else if (typeof req.query.supervisorStaffId === "string" && req.query.supervisorStaffId) {
    filter.supervisorStaffId = req.query.supervisorStaffId;
  }

  let rows = await FieldDutyAttendance.find(filter).sort({ dateBs: -1 }).limit(200).lean();

  if (typeof req.query.section === "string" && req.query.section) {
    rows = rows.filter(
      (r) =>
        postingTypeToSection(resolvePostingType(r)) ===
        (req.query.section === "HOSPITAL" ? "HOSPITAL" : "COMMUNITY_PHC")
    );
  }

  const serialized = await Promise.all(rows.map((r) => serializeAttendance(r as never)));
  return sendSuccess(res, "Field attendance fetched", serialized);
});

export const getFieldDutyAttendanceById = asyncHandler(async (req: Request, res: Response) => {
  const row = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!row) throw new ApiError(404, "Field attendance not found");
  await assertScheduleAccess(req, row);
  return sendSuccess(res, "Field attendance fetched", await serializeAttendance(row as never));
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
  if (!schedule) throw new ApiError(404, "Active field posting not found");
  await assertScheduleAccess(req, schedule);

  if (!isDateWithinDuty(dateBs, schedule.startDateBs, schedule.endDateBs)) {
    throw new ApiError(400, "Attendance date is outside the posting period");
  }

  const isMultiShift = schedule.rosterMode === "MULTI_SHIFT";
  const attendanceShift = (
    payload.shift ||
    (isMultiShift ? "" : schedule.shift) ||
    "DAY"
  ).toString().toUpperCase();

  if (isMultiShift && !payload.shift) {
    throw new ApiError(
      400,
      "Select a shift when submitting multi-shift field attendance (e.g. MORNING, DAY, NIGHT)"
    );
  }

  const validShifts = new Set(["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"]);
  if (!validShifts.has(attendanceShift)) {
    throw new ApiError(400, `Invalid shift: ${attendanceShift}`);
  }

  // MULTI_SHIFT: shift must be one that has assigned students
  if (isMultiShift) {
    const used = new Set(
      ((schedule.studentShifts as Array<{ shift?: string }>) ?? []).map((r) =>
        String(r.shift || "").toUpperCase()
      )
    );
    if (!used.has(attendanceShift)) {
      throw new ApiError(
        400,
        `No students are assigned to the ${attendanceShift} shift on this posting`
      );
    }
  }

  const existing = await FieldDutyAttendance.findOne({
    schoolId,
    scheduleId: schedule._id,
    dateBs,
    shift: attendanceShift,
    isDeleted: false
  });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "LOCKED")) {
    throw new ApiError(
      400,
      `Attendance already submitted for this posting, date, and ${attendanceShift} shift. Request an edit or ask admin to unlock.`
    );
  }

  const eligible = await getEligibleStudentsForDuty(
    schoolId,
    schedule.batchId.toString(),
    schedule.yearId.toString(),
    {
      rosterMode: schedule.rosterMode as string,
      assignedStudentIds: schedule.assignedStudentIds as unknown[],
      studentShifts: schedule.studentShifts as Array<{ studentId: unknown; shift: string }>,
      filterShift: isMultiShift ? attendanceShift : undefined,
      defaultShift: (schedule.shift as string) || "DAY"
    }
  );
  if (eligible.length === 0) {
    throw new ApiError(
      400,
      isMultiShift
        ? `No active students found for the ${attendanceShift} shift roster`
        : "No students found in this field posting roster"
    );
  }
  const eligibleIds = new Set(eligible.map((s) => s._id));
  for (const entry of payload.entries) {
    if (!eligibleIds.has(entry.studentId)) {
      throw new ApiError(
        400,
        isMultiShift
          ? `Student is not assigned to the ${attendanceShift} shift roster`
          : "Student is not assigned to this field posting roster"
      );
    }
  }
  // Require every roster student to be included (prevents partial silent skips)
  const submittedIds = new Set(payload.entries.map((e) => e.studentId));
  const missing = eligible.filter((s) => !submittedIds.has(s._id));
  if (missing.length > 0) {
    throw new ApiError(
      400,
      `Mark attendance for all ${eligible.length} students on this shift (missing ${missing.length})`
    );
  }

  const siteName = resolveSiteName(schedule);
  const postingType = resolvePostingType(schedule);

  const docPayload = {
    schoolId,
    scheduleId: schedule._id,
    dateBs,
    postingType,
    siteName,
    hospitalName: siteName,
    department: schedule.department ?? "",
    ward: schedule.ward ?? "",
    shift: attendanceShift,
    batchId: schedule.batchId,
    yearId: schedule.yearId,
    supervisorStaffId: schedule.supervisorStaffId ?? schedule.supervisorTeacherId,
    entries: payload.entries.map((e) => ({
      studentId: e.studentId,
      status: e.status,
      remarks: emptyToUndef(e.remarks) ?? ""
    })),
    notes: emptyToUndef(payload.notes) ?? "",
    status: "LOCKED" as const,
    editRequest: undefined,
    createdBy: actorId(req),
    submittedBy: actorId(req),
    submittedAt: new Date()
  };

  let saved;
  if (existing) {
    Object.assign(existing, docPayload);
    existing.editRequest = undefined;
    await existing.save();
    saved = existing;
  } else {
    saved = await FieldDutyAttendance.create(docPayload);
  }

  await notifyFieldDutyAttendance(schoolId.toString(), {
    dateBs,
    hospitalName: siteName,
    department: schedule.department || "",
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
    "Field attendance submitted",
    await serializeAttendance(saved.toObject() as never),
    201
  );
});

export const updateFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can edit field attendance after submission");
  }
  const payload = fieldDutyAttendanceUpdateSchema.parse(req.body);
  const existing = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field attendance not found");
  if (existing.status === "LOCKED" || existing.status === "SUBMITTED") {
    throw new ApiError(400, "Unlock attendance or approve an edit request before editing");
  }

  existing.entries = payload.entries.map((e) => ({
    studentId: e.studentId as never,
    status: e.status,
    remarks: emptyToUndef(e.remarks) ?? ""
  })) as never;
  if (payload.notes !== undefined) existing.notes = emptyToUndef(payload.notes) ?? "";
  await existing.save();

  return sendSuccess(
    res,
    "Field attendance updated",
    await serializeAttendance(existing.toObject() as never)
  );
});

export const unlockFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can unlock field attendance");
  }
  const { reason } = fieldDutyUnlockSchema.parse(req.body);
  const existing = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field attendance not found");

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

  return sendSuccess(
    res,
    "Field attendance unlocked",
    await serializeAttendance(existing.toObject() as never)
  );
});

/** Coordinator requests edit after submission (read-only until admin approves). */
export const requestFieldAttendanceEdit = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = fieldDutyEditRequestSchema.parse(req.body);
  const existing = await FieldDutyAttendance.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Field attendance not found");
  await assertScheduleAccess(req, existing);

  if (existing.status !== "LOCKED" && existing.status !== "SUBMITTED") {
    throw new ApiError(400, "Attendance is already editable");
  }
  if (existing.editRequest?.status === "PENDING") {
    throw new ApiError(400, "An edit request is already pending for this attendance");
  }

  existing.editRequest = {
    requestedBy: actorId(req) as never,
    requestedAt: new Date(),
    reason,
    status: "PENDING"
  } as never;
  await existing.save();

  await recordAudit(req, {
    action: "field_duty.attendance.edit_request",
    entity: "FIELD_DUTY_ATTENDANCE",
    entityId: existing._id.toString(),
    after: { reason }
  });

  return sendSuccess(
    res,
    "Edit request submitted for admin approval",
    await serializeAttendance(existing.toObject() as never)
  );
});

/** Admin approves or rejects coordinator edit requests. */
export const reviewFieldAttendanceEditRequest = asyncHandler(
  async (req: Request, res: Response) => {
    if (!canManageInstitution(req.user?.role ?? "")) {
      throw new ApiError(403, "Only administrators can approve attendance edit requests");
    }
    const payload = fieldDutyEditRequestReviewSchema.parse(req.body);
    const existing = await FieldDutyAttendance.findOne({
      _id: req.params.id,
      schoolId: tenantObjectId(req),
      isDeleted: false
    });
    if (!existing) throw new ApiError(404, "Field attendance not found");
    if (!existing.editRequest || existing.editRequest.status !== "PENDING") {
      throw new ApiError(400, "No pending edit request for this attendance");
    }

    existing.editRequest.status = payload.decision;
    existing.editRequest.reviewedBy = actorId(req) as never;
    existing.editRequest.reviewedAt = new Date();
    existing.editRequest.reviewNotes = emptyToUndef(payload.reviewNotes) ?? "";

    if (payload.decision === "APPROVED") {
      existing.status = "DRAFT";
      existing.unlockedBy = actorId(req) as never;
      existing.unlockedAt = new Date();
      existing.unlockReason = existing.editRequest.reason || "Edit request approved";
    }

    await existing.save();

    await recordAudit(req, {
      action: "field_duty.attendance.edit_review",
      entity: "FIELD_DUTY_ATTENDANCE",
      entityId: existing._id.toString(),
      after: { decision: payload.decision }
    });

    return sendSuccess(
      res,
      payload.decision === "APPROVED"
        ? "Edit request approved — attendance is now editable"
        : "Edit request rejected",
      await serializeAttendance(existing.toObject() as never)
    );
  }
);

export const getFieldDutyDashboard = asyncHandler(async (req: Request, res: Response) => {
  const dashboard = await buildFieldDutyDashboard(req);
  return sendSuccess(res, "Field management dashboard fetched", dashboard);
});

export const getFieldDutyMonitoring = asyncHandler(async (req: Request, res: Response) => {
  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can view field monitoring");
  }
  const data = await buildFieldDutyMonitoring(req, {
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
    yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined,
    postingType: typeof req.query.postingType === "string" ? req.query.postingType : undefined,
    section: typeof req.query.section === "string" ? req.query.section : undefined,
    scheduleId: typeof req.query.scheduleId === "string" ? req.query.scheduleId : undefined,
    supervisorStaffId:
      typeof req.query.supervisorStaffId === "string" ? req.query.supervisorStaffId : undefined
  });
  return sendSuccess(res, "Field monitoring fetched", data);
});

export const getFieldDutyReports = asyncHandler(async (req: Request, res: Response) => {
  if (
    !hasInstitutionAccess(req.user?.role ?? "") &&
    req.user?.role !== "COLLEGE_STAFF"
  ) {
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
  if (typeof req.query.yearId === "string" && req.query.yearId) filter.yearId = req.query.yearId;
  if (typeof req.query.scheduleId === "string" && req.query.scheduleId) {
    filter.scheduleId = req.query.scheduleId;
  }
  if (typeof req.query.postingType === "string" && req.query.postingType) {
    filter.postingType = req.query.postingType.toUpperCase();
  }
  if (typeof req.query.supervisorStaffId === "string" && req.query.supervisorStaffId) {
    filter.supervisorStaffId = req.query.supervisorStaffId;
  }

  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    const staffScope = await getFieldSupervisorStaffScope(req);
    if (!staffScope) throw new ApiError(403, "Not allowed");
    const mySchedules = await FieldDutySchedule.find({
      schoolId,
      isDeleted: false,
      $or: [
        { supervisorStaffId: staffScope.staffId },
        { assistantCoordinatorStaffIds: staffScope.staffId }
      ]
    })
      .select("_id")
      .lean();
    filter.scheduleId = { $in: mySchedules.map((s) => s._id) };
  }

  let rows = await FieldDutyAttendance.find(filter).sort({ dateBs: -1 }).limit(500).lean();

  if (typeof req.query.section === "string" && req.query.section) {
    rows = rows.filter(
      (r) =>
        postingTypeToSection(resolvePostingType(r)) ===
        (req.query.section === "HOSPITAL" ? "HOSPITAL" : "COMMUNITY_PHC")
    );
  }

  const serialized = await Promise.all(rows.map((r) => serializeAttendance(r as never)));

  const flat = serialized.flatMap((rec) =>
    rec.entries.map((e) => ({
      dateBs: rec.dateBs,
      postingType: rec.postingType ?? "HOSPITAL",
      siteName: rec.siteName ?? rec.hospitalName,
      hospital: rec.hospitalName,
      department: rec.department,
      ward: rec.ward ?? "",
      shift: rec.shift,
      studentName: e.student?.fullName ?? "",
      admissionNumber: e.student?.admissionNumber ?? "",
      rollNumber: e.student?.rollNumber ?? "",
      status: e.status,
      remarks: e.remarks ?? "",
      recordStatus: rec.status,
      batchId: rec.batchId,
      yearId: rec.yearId,
      coordinatorStaffId: rec.supervisorStaffId
    }))
  );

  return sendSuccess(res, "Field reports fetched", { records: serialized, flat });
});

/** Student portal: own field attendance */
export const getMyFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getStudentProfile(req);
  if (!profile?.studentId) throw new ApiError(403, "Student profile required");
  const data = await buildStudentFieldDutyPortal(tenantObjectId(req), profile.studentId);
  return sendSuccess(res, "Student field attendance fetched", data);
});

/** Parent portal: child's field attendance */
export const getChildFieldDutyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT" && !hasInstitutionAccess(req.user?.role ?? "")) {
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
  return sendSuccess(res, "Child field attendance fetched", data);
});

export const getTodayFieldDutyContext = asyncHandler(async (req: Request, res: Response) => {
  const todayBs = getTodayBs();
  const schoolId = tenantObjectId(req);
  let filter: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    status: "ACTIVE",
    startDateBs: { $lte: todayBs },
    endDateBs: { $gte: todayBs }
  };

  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    filter = await scheduleAccessFilter(req, filter);
  }

  if (typeof req.query.section === "string" && req.query.section) {
    const hospitalTypes = postingTypesForSection("HOSPITAL");
    const priorAnd = Array.isArray(filter.$and) ? (filter.$and as unknown[]) : [];
    if (req.query.section === "HOSPITAL") {
      filter.$and = [
        ...priorAnd,
        {
          $or: [
            { postingType: { $in: hospitalTypes } },
            { postingType: { $exists: false } },
            { postingType: null },
            { postingType: "" }
          ]
        }
      ];
    } else {
      filter.$and = [
        ...priorAnd,
        { postingType: { $exists: true, $nin: hospitalTypes, $ne: "" } }
      ];
    }
  }

  const schedules = await FieldDutySchedule.find(filter).lean();
  const contexts = await Promise.all(
    schedules.map(async (sch) => {
      const isMulti = sch.rosterMode === "MULTI_SHIFT";
      const students = await getEligibleStudentsForDuty(
        schoolId,
        sch.batchId.toString(),
        sch.yearId.toString(),
        {
          rosterMode: sch.rosterMode as string,
          assignedStudentIds: sch.assignedStudentIds as unknown[],
          studentShifts: sch.studentShifts as Array<{ studentId: unknown; shift: string }>,
          defaultShift: (sch.shift as string) || "DAY"
        }
      );
      // For multi-shift, load today's attendance records for each used shift
      const todayAttendance = await FieldDutyAttendance.find({
        schoolId,
        scheduleId: sch._id,
        dateBs: todayBs,
        isDeleted: false
      }).lean();
      const attendanceByShift: Record<string, unknown> = {};
      for (const row of todayAttendance) {
        attendanceByShift[String(row.shift || "DAY")] = await serializeAttendance(row as never);
      }
      const legacySingle =
        !isMulti && todayAttendance[0]
          ? await serializeAttendance(todayAttendance[0] as never)
          : null;
      return {
        dateBs: todayBs,
        schedule: await serializeSchedule(sch as never, { includeStudentCount: true }),
        students,
        existingAttendance: legacySingle,
        attendanceByShift,
        isMultiShift: isMulti
      };
    })
  );

  return sendSuccess(res, "Today field posting context fetched", contexts);
});
