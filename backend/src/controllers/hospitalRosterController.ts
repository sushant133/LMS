import type { Request, Response } from "express";
import {
  DEFAULT_DUTY_SHIFTS,
  DEFAULT_HOSPITAL_DEPARTMENTS,
  DEFAULT_ROSTER_FREE_CODES,
  dutyShiftSchema,
  dutyShiftUpdateSchema,
  fieldHospitalSchema,
  fieldHospitalUpdateSchema,
  hospitalDepartmentSchema,
  hospitalDepartmentUpdateSchema,
  hospitalRosterCellsUpdateSchema,
  hospitalRosterSchema,
  hospitalRosterStudentsUpdateSchema,
  hospitalRosterUpdateSchema,
  postingTypesForSection,
  rosterDutyCodeSchema,
  rosterDutyCodeUpdateSchema,
  type ClinicalDutyRecordRow,
  type HospitalRosterCell,
  type StudentDutySummaryRow,
} from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { DutyShift } from "../models/DutyShift.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { FieldHospital } from "../models/FieldHospital.js";
import { HospitalDepartment } from "../models/HospitalDepartment.js";
import { HospitalRoster } from "../models/HospitalRoster.js";
import { RosterDutyCode } from "../models/RosterDutyCode.js";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { assertCanManageFieldDuty } from "../utils/fieldDutyService.js";
import {
  compareBsDates,
  countInclusiveBsDays,
  ensureValidBsDate,
  getDaysInBsMonth,
  getOffsetFromBsDate,
} from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const tenantId = (req: Request) => {
  const id = req.tenantSchoolId;
  if (!id) throw new ApiError(400, "Institution context required");
  return id;
};

/** Institution admin or staff with Field Management → Manage (WRITE). */
const assertAdmin = async (req: Request) => {
  await assertCanManageFieldDuty(req);
};

const assertCanWriteRoster = async (req: Request) => {
  await assertAdmin(req);
};

const staffName = async (staffId?: string | null): Promise<string | undefined> => {
  if (!staffId) return undefined;
  const staff = await CollegeStaff.findById(staffId)
    .populate("user", "fullName")
    .lean();
  if (!staff) return undefined;
  const user = staff.user as unknown as { fullName?: string } | null;
  // CollegeStaff stores fullName on the document; user.fullName is secondary.
  const fromStaff = (staff as { fullName?: string }).fullName?.trim();
  const fromUser = user?.fullName?.trim();
  return fromStaff || fromUser || (staff as { staffId?: string }).staffId || undefined;
};

/** Normalize optional ObjectId-like fields from the client ("" / null → undefined). */
const cleanId = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s || !/^[a-f\d]{24}$/i.test(s)) return undefined;
  return s;
};

const normalizeHospitalName = (name: string): string =>
  name.trim().replace(/\s+/g, " ");

const hospitalNameKey = (name: string): string =>
  normalizeHospitalName(name).toLowerCase();

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Match FieldHospital rows even if schoolId was stored as ObjectId or string,
 * and even if isDeleted was never written (legacy rows).
 */
const hospitalTenantFilter = (req: Request) => {
  const oid = tenantObjectId(req);
  return {
    $or: [{ schoolId: oid }, { schoolId: oid.toString() }],
  };
};

const hospitalNotDeleted = { isDeleted: { $ne: true } };

const findHospitalById = (req: Request, id: string) =>
  FieldHospital.findOne({
    _id: id,
    ...hospitalTenantFilter(req),
    ...hospitalNotDeleted,
  });

/**
 * Promote hospital posting site names into the FieldHospital registry so
 * Roster Builder / Create roster can select every hospital the college uses.
 */
const syncHospitalsFromPostings = async (req: Request) => {
  const schoolId = tenantObjectId(req);
  const hospitalTypes = postingTypesForSection("HOSPITAL");
  const postings = await FieldDutySchedule.find({
    $and: [
      { $or: [{ schoolId }, { schoolId: schoolId.toString() }] },
      { isDeleted: { $ne: true } },
      {
        $or: [
          { postingType: { $in: hospitalTypes } },
          { postingType: { $exists: false } },
          { postingType: null },
          { postingType: "" },
        ],
      },
    ],
  })
    .select("siteName hospitalName address")
    .lean();

  const existing = await FieldHospital.find({
    ...hospitalTenantFilter(req),
    ...hospitalNotDeleted,
  })
    .select("name")
    .lean();
  const have = new Set(
    existing.map((h) => hospitalNameKey(String(h.name || ""))).filter(Boolean),
  );

  const toCreate: Array<{
    schoolId: typeof schoolId;
    name: string;
    address: string;
    status: "ACTIVE";
    isDeleted: false;
    createdBy?: string;
  }> = [];
  const seen = new Set(have);
  for (const p of postings) {
    const name = normalizeHospitalName(
      String(p.siteName || p.hospitalName || ""),
    );
    if (!name) continue;
    const key = hospitalNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    toCreate.push({
      schoolId,
      name,
      address: String(p.address || ""),
      status: "ACTIVE",
      isDeleted: false,
      createdBy: req.user?.userId,
    });
  }
  if (toCreate.length) {
    try {
      await FieldHospital.insertMany(toCreate, { ordered: false });
    } catch {
      // Race / duplicate name — list query still returns saved hospitals.
    }
  }
};

const dedupeHospitalDocs = <T extends { _id: unknown; name?: unknown }>(
  rows: T[],
): T[] => {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = String(row._id);
    if (seenIds.has(id)) continue;
    const key = hospitalNameKey(String(row.name || ""));
    if (key && seenNames.has(key)) continue;
    seenIds.add(id);
    if (key) seenNames.add(key);
    out.push(row);
  }
  return out;
};

// ─── Seed helpers ───────────────────────────────────────────────────────────

export const ensureDefaultDepartments = async (schoolId: string) => {
  const count = await HospitalDepartment.countDocuments({
    schoolId,
    isDeleted: false,
  });
  if (count > 0) return;
  await HospitalDepartment.insertMany(
    DEFAULT_HOSPITAL_DEPARTMENTS.map((d) => ({
      schoolId,
      name: d.name,
      shortCode: d.shortCode,
      sortOrder: d.sortOrder,
      isActive: true,
      isSystem: true,
    })),
  );
};

export const ensureDefaultShifts = async (schoolId: string) => {
  const count = await DutyShift.countDocuments({ schoolId, isDeleted: false });
  if (count > 0) return;
  await DutyShift.insertMany(
    DEFAULT_DUTY_SHIFTS.map((s) => ({
      schoolId,
      name: s.name,
      shortCode: s.shortCode,
      startTime: s.startTime,
      endTime: s.endTime,
      dutyHours: s.dutyHours,
      sortOrder: s.sortOrder,
      color: s.color ?? "",
      isActive: true,
      isSystem: true,
    })),
  );
};

export const ensureDefaultDutyCodes = async (schoolId: string) => {
  const count = await RosterDutyCode.countDocuments({ schoolId, isDeleted: false });
  if (count > 0) return;
  await RosterDutyCode.insertMany(
    DEFAULT_ROSTER_FREE_CODES.map((c) => ({
      schoolId,
      code: c.code,
      label: c.label,
      sortOrder: c.sortOrder,
      isLeave: c.isLeave,
      isOff: c.isOff,
      isActive: true,
      isSystem: true,
      color: "",
    })),
  );
};

/** Resolve From–To BS dates + inclusive day count for a roster create/update. */
const resolveRosterPeriod = (payload: {
  startDateBs?: string;
  endDateBs?: string;
  monthBs?: string;
  daysInMonth?: number;
}): { startDateBs: string; endDateBs: string; monthBs: string; daysInMonth: number } => {
  const startRaw = payload.startDateBs?.trim() || "";
  const endRaw = payload.endDateBs?.trim() || "";

  if (startRaw && endRaw) {
    const startDateBs = ensureValidBsDate(startRaw);
    const endDateBs = ensureValidBsDate(endRaw);
    if (compareBsDates(endDateBs, startDateBs) < 0) {
      throw new ApiError(400, "To date must be on or after From date");
    }
    const daysInMonth = countInclusiveBsDays(startDateBs, endDateBs);
    if (daysInMonth < 1 || daysInMonth > 93) {
      throw new ApiError(400, "Roster period must be between 1 and 93 days");
    }
    const monthBs = startDateBs.slice(0, 7);
    return { startDateBs, endDateBs, monthBs, daysInMonth };
  }

  const monthBs = payload.monthBs?.trim() || "";
  if (!/^\d{4}-\d{2}$/.test(monthBs)) {
    throw new ApiError(400, "Provide From–To dates or a valid month (YYYY-MM)");
  }
  const [yStr, mStr] = monthBs.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const dim =
    typeof payload.daysInMonth === "number" && payload.daysInMonth >= 1
      ? Math.min(93, Math.max(1, Math.floor(payload.daysInMonth)))
      : getDaysInBsMonth(year, month);
  const startDateBs = ensureValidBsDate(`${monthBs}-01`);
  let endDateBs: string;
  try {
    endDateBs = ensureValidBsDate(
      `${monthBs}-${String(Math.min(dim, getDaysInBsMonth(year, month))).padStart(2, "0")}`,
    );
  } catch {
    endDateBs = getOffsetFromBsDate(startDateBs, dim - 1);
  }
  const daysInMonth = countInclusiveBsDays(startDateBs, endDateBs);
  return { startDateBs, endDateBs, monthBs, daysInMonth };
};

const formatDutyCode = (doc: Record<string, unknown>) => ({
  _id: String(doc._id),
  schoolId: String(doc.schoolId),
  code: doc.code as string,
  label: doc.label as string,
  sortOrder: Number(doc.sortOrder) || 100,
  isActive: doc.isActive !== false,
  isSystem: Boolean(doc.isSystem),
  isLeave: Boolean(doc.isLeave),
  isOff: Boolean(doc.isOff),
  color: (doc.color as string) || "",
});

// ─── Format helpers ─────────────────────────────────────────────────────────

const formatHospital = async (doc: Record<string, unknown>) => {
  const coordinatorStaffId = doc.coordinatorStaffId
    ? String(doc.coordinatorStaffId)
    : undefined;
  return {
    _id: String(doc._id),
    schoolId: String(doc.schoolId),
    name: doc.name as string,
    address: (doc.address as string) || "",
    contact: (doc.contact as string) || "",
    coordinatorStaffId,
    coordinatorName: await staffName(coordinatorStaffId),
    status: (doc.status as string) || "ACTIVE",
    remarks: (doc.remarks as string) || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const loadStudentRows = async (schoolId: string, studentIds: string[]) => {
  if (!studentIds.length) return [];
  const students = await Student.find({
    schoolId,
    _id: { $in: studentIds },
  })
    .populate("user", "fullName")
    .lean();
  const byId = new Map(
    students.map((s) => {
      const user = s.user as unknown as { fullName?: string } | null;
      return [
        s._id.toString(),
        {
          studentId: s._id.toString(),
          fullName: user?.fullName ?? "Student",
          admissionNumber: s.admissionNumber,
          rollNumber: s.rollNumber,
        },
      ] as const;
    }),
  );
  return studentIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
};

const formatRoster = async (doc: Record<string, unknown>) => {
  const schoolId = String(doc.schoolId);
  const studentIds = ((doc.studentIds as unknown[]) ?? []).map(String);
  const hospitalId = String(doc.hospitalId);
  const batchId = String(doc.batchId);
  const yearId = String(doc.yearId);
  const coordinatorStaffId = doc.coordinatorStaffId
    ? String(doc.coordinatorStaffId)
    : undefined;

  const [hospital, batch, year, students, coordinatorName] = await Promise.all([
    FieldHospital.findById(hospitalId).lean(),
    Batch.findById(batchId).lean(),
    Year.findById(yearId).lean(),
    loadStudentRows(schoolId, studentIds),
    staffName(coordinatorStaffId),
  ]);

  const cells = ((doc.cells as HospitalRosterCell[]) ?? []).map((c) => ({
    studentId: String(c.studentId),
    day: Number(c.day),
    shiftId: c.shiftId ? String(c.shiftId) : undefined,
    departmentId: c.departmentId ? String(c.departmentId) : undefined,
    code: c.code || "",
    remarks: c.remarks || "",
  }));

  return {
    _id: String(doc._id),
    schoolId,
    name: doc.name as string,
    academicYearBs: doc.academicYearBs as string,
    program: (doc.program as string) || "",
    batchId,
    batchName: batch?.name,
    yearId,
    yearName: year?.name,
    sectionId: doc.sectionId ? String(doc.sectionId) : undefined,
    hospitalId,
    hospitalName: hospital?.name,
    startDateBs: (doc.startDateBs as string) || "",
    endDateBs: (doc.endDateBs as string) || "",
    monthBs: doc.monthBs as string,
    daysInMonth: Number(doc.daysInMonth) || 30,
    coordinatorStaffId,
    coordinatorName,
    remarks: (doc.remarks as string) || "",
    status: (doc.status as string) || "DRAFT",
    studentIds,
    students,
    cells,
    preparedByName: (doc.preparedByName as string) || "",
    approvedByName: (doc.approvedByName as string) || "",
    lockedAt: doc.lockedAt,
    lockedBy: doc.lockedBy ? String(doc.lockedBy) : undefined,
    createdBy: doc.createdBy ? String(doc.createdBy) : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const assertRosterEditable = (status: string) => {
  if (status === "LOCKED") {
    throw new ApiError(400, "Roster is locked. Unlock as admin to edit.");
  }
};

// ─── Hospitals ──────────────────────────────────────────────────────────────

export const listHospitals = asyncHandler(async (req: Request, res: Response) => {
  await syncHospitalsFromPostings(req);
  const filter: Record<string, unknown> = {
    ...hospitalTenantFilter(req),
    ...hospitalNotDeleted,
  };
  if (req.query.status === "ACTIVE" || req.query.status === "INACTIVE") {
    filter.status = req.query.status;
  }
  const rows = await FieldHospital.find(filter).sort({ name: 1 }).lean();
  const unique = dedupeHospitalDocs(rows);
  const formatted = await Promise.all(
    unique.map((r) => formatHospital(r as Record<string, unknown>)),
  );
  return sendSuccess(res, "Hospitals fetched", formatted);
});

export const createHospital = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantObjectId(req);
  const payload = fieldHospitalSchema.parse(req.body);
  const name = normalizeHospitalName(payload.name);
  if (name.length < 2) throw new ApiError(400, "Hospital name is required");

  const existing = await FieldHospital.findOne({
    ...hospitalTenantFilter(req),
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  });
  if (existing) {
    if (existing.isDeleted || existing.status === "INACTIVE") {
      existing.isDeleted = false;
      existing.name = name;
      existing.address = payload.address ?? existing.address ?? "";
      existing.contact = payload.contact ?? existing.contact ?? "";
      existing.status = payload.status ?? "ACTIVE";
      existing.remarks = payload.remarks ?? existing.remarks ?? "";
      const coordinatorId = cleanId(payload.coordinatorStaffId);
      if (coordinatorId) {
        existing.set("coordinatorStaffId", coordinatorId);
      }
      await existing.save();
      return sendSuccess(
        res,
        "Hospital restored",
        await formatHospital(existing.toObject() as Record<string, unknown>),
      );
    }
    throw new ApiError(409, "A hospital with this name already exists");
  }

  const doc = await FieldHospital.create({
    schoolId,
    name,
    address: payload.address ?? "",
    contact: payload.contact ?? "",
    coordinatorStaffId: cleanId(payload.coordinatorStaffId),
    status: payload.status ?? "ACTIVE",
    remarks: payload.remarks ?? "",
    isDeleted: false,
    createdBy: req.user?.userId,
  });
  return sendSuccess(
    res,
    "Hospital created",
    await formatHospital(doc.toObject() as Record<string, unknown>),
    201,
  );
});

export const updateHospital = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const payload = fieldHospitalUpdateSchema.parse(req.body);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (payload.name !== undefined) $set.name = normalizeHospitalName(payload.name);
  if (payload.address !== undefined) $set.address = payload.address;
  if (payload.contact !== undefined) $set.contact = payload.contact;
  if (payload.status !== undefined) $set.status = payload.status;
  if (payload.remarks !== undefined) $set.remarks = payload.remarks;
  // Empty / omitted optional id must clear the ref (mongoose ignores undefined in $set).
  if (Object.prototype.hasOwnProperty.call(payload, "coordinatorStaffId")) {
    const cleaned = cleanId(payload.coordinatorStaffId);
    if (cleaned) $set.coordinatorStaffId = cleaned;
    else $unset.coordinatorStaffId = 1;
  }
  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (!Object.keys(update).length) {
    throw new ApiError(400, "No fields to update");
  }
  const doc = await FieldHospital.findOneAndUpdate(
    { _id: req.params.id, ...hospitalTenantFilter(req), ...hospitalNotDeleted },
    update,
    { new: true },
  ).lean();
  if (!doc) throw new ApiError(404, "Hospital not found");
  return sendSuccess(res, "Hospital updated", await formatHospital(doc as Record<string, unknown>));
});

export const deleteHospital = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantObjectId(req);
  const inUse = await HospitalRoster.countDocuments({
    $or: [{ schoolId }, { schoolId: schoolId.toString() }],
    hospitalId: req.params.id,
    isDeleted: { $ne: true },
  });
  if (inUse > 0) {
    throw new ApiError(400, "Cannot delete hospital used by existing rosters. Mark inactive instead.");
  }
  const doc = await FieldHospital.findOneAndUpdate(
    { _id: req.params.id, ...hospitalTenantFilter(req), ...hospitalNotDeleted },
    { $set: { isDeleted: true } },
    { new: true },
  );
  if (!doc) throw new ApiError(404, "Hospital not found");
  return sendSuccess(res, "Hospital deleted");
});

// ─── Departments ────────────────────────────────────────────────────────────

export const listDepartments = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  await ensureDefaultDepartments(schoolId);
  const rows = await HospitalDepartment.find({ schoolId, isDeleted: false })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return sendSuccess(
    res,
    "Departments fetched",
    rows.map((d) => ({
      _id: d._id.toString(),
      schoolId: d.schoolId.toString(),
      name: d.name,
      shortCode: d.shortCode,
      sortOrder: d.sortOrder,
      isActive: d.isActive,
      isSystem: d.isSystem,
    })),
  );
});

export const createDepartment = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  await ensureDefaultDepartments(schoolId);
  const payload = hospitalDepartmentSchema.parse(req.body);
  try {
    const doc = await HospitalDepartment.create({ schoolId, ...payload, isSystem: false });
    return sendSuccess(
      res,
      "Department created",
      {
        _id: doc._id.toString(),
        schoolId,
        name: doc.name,
        shortCode: doc.shortCode,
        sortOrder: doc.sortOrder,
        isActive: doc.isActive,
        isSystem: false,
      },
      201,
    );
  } catch {
    throw new ApiError(409, "Department short code already exists");
  }
});

export const updateDepartment = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const payload = hospitalDepartmentUpdateSchema.parse(req.body);
  const doc = await HospitalDepartment.findOneAndUpdate(
    { _id: req.params.id, schoolId, isDeleted: false },
    { $set: payload },
    { new: true },
  ).lean();
  if (!doc) throw new ApiError(404, "Department not found");
  return sendSuccess(res, "Department updated", {
    _id: doc._id.toString(),
    schoolId,
    name: doc.name,
    shortCode: doc.shortCode,
    sortOrder: doc.sortOrder,
    isActive: doc.isActive,
    isSystem: doc.isSystem,
  });
});

export const deleteDepartment = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const existing = await HospitalDepartment.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!existing) throw new ApiError(404, "Department not found");
  // Free unique shortCode so the same code can be recreated later.
  existing.shortCode = `${existing.shortCode}__DEL_${Date.now().toString(36).slice(-6)}`;
  existing.isDeleted = true;
  existing.isActive = false;
  await existing.save();
  return sendSuccess(res, "Department deleted");
});

// ─── Shifts ─────────────────────────────────────────────────────────────────

export const listShifts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  await ensureDefaultShifts(schoolId);
  const rows = await DutyShift.find({ schoolId, isDeleted: false })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return sendSuccess(
    res,
    "Shifts fetched",
    rows.map((s) => ({
      _id: s._id.toString(),
      schoolId: s.schoolId.toString(),
      name: s.name,
      shortCode: s.shortCode,
      startTime: s.startTime,
      endTime: s.endTime,
      dutyHours: s.dutyHours,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      isSystem: s.isSystem,
      color: s.color || "",
    })),
  );
});

export const createShift = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  await ensureDefaultShifts(schoolId);
  const payload = dutyShiftSchema.parse(req.body);
  try {
    const doc = await DutyShift.create({ schoolId, ...payload, isSystem: false });
    return sendSuccess(
      res,
      "Shift created",
      {
        _id: doc._id.toString(),
        schoolId,
        name: doc.name,
        shortCode: doc.shortCode,
        startTime: doc.startTime,
        endTime: doc.endTime,
        dutyHours: doc.dutyHours,
        sortOrder: doc.sortOrder,
        isActive: doc.isActive,
        isSystem: false,
        color: doc.color || "",
      },
      201,
    );
  } catch {
    throw new ApiError(409, "Shift short code already exists");
  }
});

export const updateShift = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const payload = dutyShiftUpdateSchema.parse(req.body);
  const doc = await DutyShift.findOneAndUpdate(
    { _id: req.params.id, schoolId, isDeleted: false },
    { $set: payload },
    { new: true },
  ).lean();
  if (!doc) throw new ApiError(404, "Shift not found");
  return sendSuccess(res, "Shift updated", {
    _id: doc._id.toString(),
    schoolId,
    name: doc.name,
    shortCode: doc.shortCode,
    startTime: doc.startTime,
    endTime: doc.endTime,
    dutyHours: doc.dutyHours,
    sortOrder: doc.sortOrder,
    isActive: doc.isActive,
    isSystem: doc.isSystem,
    color: doc.color || "",
  });
});

export const deleteShift = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const existing = await DutyShift.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!existing) throw new ApiError(404, "Shift not found");
  existing.shortCode = `${existing.shortCode}__DEL_${Date.now().toString(36).slice(-6)}`;
  existing.isDeleted = true;
  existing.isActive = false;
  await existing.save();
  return sendSuccess(res, "Shift deleted");
});

// ─── Duty codes (Off / Leave / custom) ──────────────────────────────────────

export const listDutyCodes = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  await ensureDefaultDutyCodes(schoolId);
  const rows = await RosterDutyCode.find({ schoolId, isDeleted: false })
    .sort({ sortOrder: 1, code: 1 })
    .lean();
  return sendSuccess(
    res,
    "Duty codes fetched",
    rows.map((r) => formatDutyCode(r as Record<string, unknown>)),
  );
});

export const createDutyCode = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  await ensureDefaultDutyCodes(schoolId);
  const payload = rosterDutyCodeSchema.parse(req.body);
  try {
    const doc = await RosterDutyCode.create({
      schoolId,
      ...payload,
      isSystem: false,
    });
    return sendSuccess(
      res,
      "Duty code created",
      formatDutyCode(doc.toObject() as Record<string, unknown>),
      201,
    );
  } catch {
    throw new ApiError(409, "Duty code already exists");
  }
});

export const updateDutyCode = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const payload = rosterDutyCodeUpdateSchema.parse(req.body);
  const doc = await RosterDutyCode.findOneAndUpdate(
    { _id: req.params.id, schoolId, isDeleted: false },
    { $set: payload },
    { new: true },
  ).lean();
  if (!doc) throw new ApiError(404, "Duty code not found");
  return sendSuccess(res, "Duty code updated", formatDutyCode(doc as Record<string, unknown>));
});

export const deleteDutyCode = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const existing = await RosterDutyCode.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!existing) throw new ApiError(404, "Duty code not found");
  existing.code = `${existing.code}__DEL_${Date.now().toString(36).slice(-6)}`;
  existing.isDeleted = true;
  existing.isActive = false;
  await existing.save();
  return sendSuccess(res, "Duty code deleted");
});

// ─── Rosters ────────────────────────────────────────────────────────────────

const loadBatchYearStudents = async (
  schoolId: string,
  batchId: string,
  yearId: string,
) => {
  const students = await Student.find({
    schoolId,
    batchId,
    yearId,
    academicStatus: "ACTIVE",
  })
    .populate("user", "fullName")
    .sort({ rollNumber: 1 })
    .limit(300)
    .lean();
  return students.map((s) => s._id.toString());
};

/** Ensure provided student ids belong to this school (and optionally batch/year). */
const assertValidRosterStudents = async (
  schoolId: string,
  studentIds: string[],
  options?: { batchId?: string; yearId?: string },
) => {
  if (!studentIds.length) return;
  const unique = [...new Set(studentIds.map(String).filter(Boolean))];
  if (unique.length !== studentIds.length) {
    throw new ApiError(400, "Duplicate students in roster list");
  }
  const filter: Record<string, unknown> = {
    schoolId,
    _id: { $in: unique },
    academicStatus: "ACTIVE",
  };
  if (options?.batchId) filter.batchId = options.batchId;
  if (options?.yearId) filter.yearId = options.yearId;
  const count = await Student.countDocuments(filter);
  if (count !== unique.length) {
    throw new ApiError(
      400,
      options?.batchId
        ? "One or more students are invalid, inactive, or not in this batch/year"
        : "One or more students are invalid or inactive for this institution",
    );
  }
};

export const listHospitalRosters = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (typeof req.query.monthBs === "string" && req.query.monthBs) {
    filter.monthBs = req.query.monthBs;
  }
  if (typeof req.query.hospitalId === "string" && req.query.hospitalId) {
    filter.hospitalId = req.query.hospitalId;
  }
  if (typeof req.query.batchId === "string" && req.query.batchId) {
    filter.batchId = req.query.batchId;
  }
  if (typeof req.query.status === "string" && req.query.status) {
    filter.status = req.query.status;
  }
  // Lightweight list — avoid N+1 full student hydration for every roster.
  const rows = await HospitalRoster.find(filter)
    .select("-cells")
    .sort({ monthBs: -1, updatedAt: -1 })
    .lean();

  const hospitalIds = [...new Set(rows.map((r) => String(r.hospitalId)))];
  const batchIds = [...new Set(rows.map((r) => String(r.batchId)))];
  const yearIds = [...new Set(rows.map((r) => String(r.yearId)))];
  const [hospitals, batches, years] = await Promise.all([
    FieldHospital.find({ _id: { $in: hospitalIds } }).lean(),
    Batch.find({ _id: { $in: batchIds } }).lean(),
    Year.find({ _id: { $in: yearIds } }).lean(),
  ]);
  const hospitalMap = new Map(hospitals.map((h) => [h._id.toString(), h.name]));
  const batchMap = new Map(batches.map((b) => [b._id.toString(), b.name]));
  const yearMap = new Map(years.map((y) => [y._id.toString(), y.name]));

  const formatted = rows.map((r) => {
    const studentIds = ((r.studentIds as unknown[]) ?? []).map(String);
    return {
      _id: String(r._id),
      schoolId: String(r.schoolId),
      name: r.name as string,
      academicYearBs: r.academicYearBs as string,
      program: (r.program as string) || "",
      batchId: String(r.batchId),
      batchName: batchMap.get(String(r.batchId)),
      yearId: String(r.yearId),
      yearName: yearMap.get(String(r.yearId)),
      hospitalId: String(r.hospitalId),
      hospitalName: hospitalMap.get(String(r.hospitalId)),
      startDateBs: (r.startDateBs as string) || "",
      endDateBs: (r.endDateBs as string) || "",
      monthBs: r.monthBs as string,
      daysInMonth: Number(r.daysInMonth) || 30,
      status: (r.status as string) || "DRAFT",
      studentIds,
      students: [],
      cells: [],
      remarks: (r.remarks as string) || "",
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
  return sendSuccess(res, "Hospital rosters fetched", formatted);
});

export const getHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  const doc = await HospitalRoster.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false }),
  ).lean();
  if (!doc) throw new ApiError(404, "Roster not found");
  return sendSuccess(res, "Hospital roster fetched", await formatRoster(doc as Record<string, unknown>));
});

export const createHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  await assertCanWriteRoster(req);
  const schoolId = tenantId(req);
  const payload = hospitalRosterSchema.parse(req.body);

  const hospital = await findHospitalById(req, payload.hospitalId);
  if (!hospital) throw new ApiError(404, "Hospital not found");

  let studentIds = (payload.studentIds ?? []).map(String).filter(Boolean);
  if (studentIds.length === 0) {
    studentIds = await loadBatchYearStudents(schoolId, payload.batchId, payload.yearId);
  } else {
    await assertValidRosterStudents(schoolId, studentIds, {
      batchId: payload.batchId,
      yearId: payload.yearId,
    });
  }
  if (studentIds.length === 0) {
    throw new ApiError(
      400,
      "No active students found for this batch and year. Assign students first, then create the roster.",
    );
  }

  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const period = resolveRosterPeriod({
    startDateBs: payload.startDateBs,
    endDateBs: payload.endDateBs,
    monthBs: payload.monthBs,
    daysInMonth: payload.daysInMonth,
  });

  const doc = await HospitalRoster.create({
    schoolId,
    name: payload.name,
    academicYearBs: payload.academicYearBs,
    program: payload.program ?? "",
    batchId: payload.batchId,
    yearId: payload.yearId,
    sectionId: cleanId(payload.sectionId),
    hospitalId: payload.hospitalId,
    startDateBs: period.startDateBs,
    endDateBs: period.endDateBs,
    monthBs: period.monthBs,
    daysInMonth: period.daysInMonth,
    coordinatorStaffId: cleanId(payload.coordinatorStaffId),
    remarks: payload.remarks ?? "",
    status: "DRAFT",
    studentIds,
    cells: [],
    createdBy: req.user.userId,
  });

  return sendSuccess(
    res,
    "Hospital roster created",
    await formatRoster(doc.toObject() as Record<string, unknown>),
    201,
  );
});

export const updateHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  await assertCanWriteRoster(req);
  const schoolId = tenantId(req);
  const payload = hospitalRosterUpdateSchema.parse(req.body);
  const existing = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!existing) throw new ApiError(404, "Roster not found");
  if (existing.status === "LOCKED") {
    // Unlock uses dedicated endpoint. While locked only prepared/approved names may change.
    const keys = Object.keys(payload).filter(
      (k) => payload[k as keyof typeof payload] !== undefined,
    );
    if (keys.some((k) => k !== "preparedByName" && k !== "approvedByName")) {
      assertRosterEditable(existing.status);
    }
  }

  if (payload.name !== undefined) existing.name = payload.name;
  if (payload.academicYearBs !== undefined) existing.academicYearBs = payload.academicYearBs;
  if (payload.program !== undefined) existing.program = payload.program;
  if (payload.batchId !== undefined) {
    existing.batchId = payload.batchId as unknown as typeof existing.batchId;
  }
  if (payload.yearId !== undefined) {
    existing.yearId = payload.yearId as unknown as typeof existing.yearId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "sectionId")) {
    existing.sectionId = cleanId(payload.sectionId) as unknown as typeof existing.sectionId;
  }
  if (payload.hospitalId !== undefined) {
    existing.hospitalId = payload.hospitalId as unknown as typeof existing.hospitalId;
  }
  const periodTouched =
    payload.startDateBs !== undefined ||
    payload.endDateBs !== undefined ||
    payload.monthBs !== undefined ||
    payload.daysInMonth !== undefined;
  if (periodTouched) {
    const period = resolveRosterPeriod({
      startDateBs:
        payload.startDateBs !== undefined
          ? payload.startDateBs
          : existing.startDateBs || undefined,
      endDateBs:
        payload.endDateBs !== undefined
          ? payload.endDateBs
          : existing.endDateBs || undefined,
      monthBs:
        payload.monthBs !== undefined ? payload.monthBs : existing.monthBs || undefined,
      daysInMonth:
        payload.daysInMonth !== undefined
          ? payload.daysInMonth
          : existing.daysInMonth || undefined,
    });
    existing.startDateBs = period.startDateBs;
    existing.endDateBs = period.endDateBs;
    existing.monthBs = period.monthBs;
    existing.daysInMonth = period.daysInMonth;
    const pruned = (existing.cells ?? []).filter((c) => c.day <= period.daysInMonth);
    existing.set("cells", pruned as unknown as typeof existing.cells);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "coordinatorStaffId")) {
    existing.coordinatorStaffId = cleanId(
      payload.coordinatorStaffId,
    ) as unknown as typeof existing.coordinatorStaffId;
  }
  if (payload.remarks !== undefined) existing.remarks = payload.remarks;
  if (payload.preparedByName !== undefined) existing.preparedByName = payload.preparedByName;
  if (payload.approvedByName !== undefined) existing.approvedByName = payload.approvedByName;
  if (payload.status !== undefined && payload.status !== "LOCKED") {
    existing.status = payload.status;
  }

  await existing.save();
  return sendSuccess(
    res,
    "Hospital roster updated",
    await formatRoster(existing.toObject() as Record<string, unknown>),
  );
});

export const updateHospitalRosterStudents = asyncHandler(
  async (req: Request, res: Response) => {
    await assertCanWriteRoster(req);
    const schoolId = tenantId(req);
    const payload = hospitalRosterStudentsUpdateSchema.parse(req.body);
    const roster = await HospitalRoster.findOne({
      _id: req.params.id,
      schoolId,
      isDeleted: false,
    });
    if (!roster) throw new ApiError(404, "Roster not found");
    assertRosterEditable(roster.status);

    const studentIds = payload.studentIds.map(String).filter(Boolean);
    const existingIds = new Set((roster.studentIds ?? []).map(String));
    const newlyAdded = studentIds.filter((id) => !existingIds.has(id));
    // Only newly added names must be active in this batch/year.
    // Existing roster members can stay so an add is not blocked by one inactive row.
    await assertValidRosterStudents(schoolId, newlyAdded, {
      batchId: String(roster.batchId),
      yearId: String(roster.yearId),
    });

    roster.set(
      "studentIds",
      studentIds as unknown as typeof roster.studentIds,
    );
    roster.markModified("studentIds");
    // Drop cells for removed students
    const keep = new Set(studentIds);
    const nextCells = (roster.cells ?? []).filter((c) =>
      keep.has(String(c.studentId)),
    );
    roster.set("cells", nextCells as unknown as typeof roster.cells);
    roster.markModified("cells");
    await roster.save();
    return sendSuccess(
      res,
      "Roster students updated",
      await formatRoster(roster.toObject() as Record<string, unknown>),
    );
  },
);

type SanitizedRosterCell = {
  studentId: string;
  day: number;
  code: string;
  remarks: string;
  shiftId?: string;
  departmentId?: string;
};

const rosterPeriodDays = (roster: { daysInMonth?: number | null; startDateBs?: string; endDateBs?: string }) => {
  if (typeof roster.daysInMonth === "number" && roster.daysInMonth >= 1) {
    return Math.min(93, roster.daysInMonth);
  }
  if (roster.startDateBs && roster.endDateBs) {
    try {
      return Math.min(93, Math.max(1, countInclusiveBsDays(roster.startDateBs, roster.endDateBs)));
    } catch {
      /* fall through */
    }
  }
  return 30;
};

const toSanitizedCell = (c: {
  studentId?: unknown;
  day?: unknown;
  shiftId?: unknown;
  departmentId?: unknown;
  code?: unknown;
  remarks?: unknown;
}): SanitizedRosterCell | null => {
  const studentId = String(c.studentId ?? "").trim();
  const day = Number(c.day);
  if (!studentId || !Number.isInteger(day) || day < 1 || day > 93) return null;
  const shiftId = cleanId(c.shiftId);
  const departmentId = cleanId(c.departmentId);
  const code = String(c.code ?? "").trim();
  const remarks = String(c.remarks ?? "").trim();
  if (!shiftId && !departmentId && !code) return null;
  const row: SanitizedRosterCell = { studentId, day, code, remarks };
  if (shiftId) row.shiftId = shiftId;
  if (departmentId) row.departmentId = departmentId;
  return row;
};

export const updateHospitalRosterCells = asyncHandler(async (req: Request, res: Response) => {
  await assertCanWriteRoster(req);
  const schoolId = tenantId(req);
  const payload = hospitalRosterCellsUpdateSchema.parse(req.body);
  const roster = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!roster) throw new ApiError(404, "Roster not found");
  assertRosterEditable(roster.status);

  const days = rosterPeriodDays(roster);
  const validStudents = new Set((roster.studentIds ?? []).map(String));
  const sanitized = payload.cells
    .map((c) => toSanitizedCell(c))
    .filter((c): c is SanitizedRosterCell => Boolean(c))
    .filter((c) => validStudents.has(c.studentId) && c.day >= 1 && c.day <= days);

  if (payload.replace) {
    roster.set("cells", sanitized as unknown as typeof roster.cells);
  } else {
    const map = new Map<string, SanitizedRosterCell>();
    for (const c of roster.cells ?? []) {
      const existing = toSanitizedCell(c);
      if (existing) map.set(`${existing.studentId}:${existing.day}`, existing);
    }
    for (const c of sanitized) {
      map.set(`${c.studentId}:${c.day}`, c);
    }
    // Also apply explicit clears: empty cells in payload with replace=false
    for (const raw of payload.cells) {
      const sid = String(raw.studentId);
      const day = raw.day;
      if (!validStudents.has(sid) || day < 1 || day > days) continue;
      const empty =
        !cleanId(raw.shiftId) &&
        !cleanId(raw.departmentId) &&
        !(raw.code ?? "").trim();
      if (empty) map.delete(`${sid}:${day}`);
    }
    roster.set(
      "cells",
      Array.from(map.values()) as unknown as typeof roster.cells,
    );
  }

  roster.markModified("cells");
  await roster.save();
  return sendSuccess(
    res,
    "Roster cells updated",
    await formatRoster(roster.toObject() as Record<string, unknown>),
  );
});

export const lockHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const roster = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!roster) throw new ApiError(404, "Roster not found");
  if (roster.status === "LOCKED") {
    return sendSuccess(
      res,
      "Roster already locked",
      await formatRoster(roster.toObject() as Record<string, unknown>),
    );
  }
  // Optional last-second cell save when client sends cells with lock
  if (req.body && Array.isArray(req.body.cells)) {
    const days = rosterPeriodDays(roster);
    const validStudents = new Set((roster.studentIds ?? []).map(String));
    const sanitized = (req.body.cells as HospitalRosterCell[])
      .map((c) => toSanitizedCell(c))
      .filter((c): c is SanitizedRosterCell => Boolean(c))
      .filter((c) => validStudents.has(c.studentId) && c.day >= 1 && c.day <= days);
    roster.set("cells", sanitized as unknown as typeof roster.cells);
    roster.markModified("cells");
  }
  roster.status = "LOCKED";
  roster.lockedAt = new Date();
  roster.lockedBy = req.user?.userId as typeof roster.lockedBy;
  await roster.save();
  return sendSuccess(
    res,
    "Roster locked",
    await formatRoster(roster.toObject() as Record<string, unknown>),
  );
});

export const unlockHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const roster = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!roster) throw new ApiError(404, "Roster not found");
  roster.status = "DRAFT";
  roster.lockedAt = undefined;
  roster.lockedBy = undefined;
  await roster.save();
  return sendSuccess(
    res,
    "Roster unlocked",
    await formatRoster(roster.toObject() as Record<string, unknown>),
  );
});

export const deleteHospitalRoster = asyncHandler(async (req: Request, res: Response) => {
  await assertAdmin(req);
  const schoolId = tenantId(req);
  const roster = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  });
  if (!roster) throw new ApiError(404, "Roster not found");
  if (roster.status === "LOCKED") {
    throw new ApiError(400, "Unlock the roster before deleting");
  }
  roster.isDeleted = true;
  await roster.save();
  return sendSuccess(res, "Roster deleted");
});

// ─── Summary / Clinical record ──────────────────────────────────────────────

const buildSummary = async (schoolId: string, rosterDoc: Record<string, unknown>) => {
  const roster = await formatRoster(rosterDoc);
  const [shifts, departments, dutyCodes] = await Promise.all([
    DutyShift.find({ schoolId, isDeleted: false }).lean(),
    HospitalDepartment.find({ schoolId, isDeleted: false }).lean(),
    RosterDutyCode.find({ schoolId, isDeleted: false }).lean(),
  ]);
  const shiftById = new Map(shifts.map((s) => [s._id.toString(), s]));
  const deptById = new Map(departments.map((d) => [d._id.toString(), d]));
  const codeByValue = new Map(
    dutyCodes.map((c) => [String(c.code).trim().toLowerCase(), c]),
  );

  const dutySummary: StudentDutySummaryRow[] = (roster.students ?? []).map((st) => {
    const byShift: Record<string, number> = {};
    const byDepartment: Record<string, number> = {};
    const byCode: Record<string, number> = {};
    let totalDuties = 0;
    let totalDutyHours = 0;
    let workingDays = 0;
    let leaveDays = 0;
    let offDays = 0;

    const studentCells = roster.cells.filter((c) => c.studentId === st.studentId);
    for (const cell of studentCells) {
      const code = (cell.code || "").trim();
      const codeLower = code.toLowerCase();
      const codeMeta = codeLower ? codeByValue.get(codeLower) : undefined;
      const isLeave =
        Boolean(codeMeta?.isLeave) || codeLower === "leave";
      const isOff = Boolean(codeMeta?.isOff) || codeLower === "off";

      if (isLeave && !cell.shiftId && !cell.departmentId) {
        leaveDays += 1;
        byCode[code || "Leave"] = (byCode[code || "Leave"] ?? 0) + 1;
        continue;
      }
      if (isOff && !cell.shiftId && !cell.departmentId) {
        offDays += 1;
        byCode[code || "Off"] = (byCode[code || "Off"] ?? 0) + 1;
        continue;
      }

      let counted = false;
      if (cell.shiftId) {
        const sh = shiftById.get(cell.shiftId);
        if (sh) {
          byShift[sh.shortCode] = (byShift[sh.shortCode] ?? 0) + 1;
          totalDutyHours += sh.dutyHours || 0;
          counted = true;
        }
      }
      if (cell.departmentId) {
        const dep = deptById.get(cell.departmentId);
        if (dep) {
          byDepartment[dep.shortCode] = (byDepartment[dep.shortCode] ?? 0) + 1;
          counted = true;
        }
      }
      if (code && !cell.shiftId && !cell.departmentId) {
        byCode[code] = (byCode[code] ?? 0) + 1;
        counted = true;
      }
      // One cell (day) = one duty assignment, even if both shift + department are set.
      if (counted) {
        totalDuties += 1;
        workingDays += 1;
      }
    }

    return {
      studentId: st.studentId,
      fullName: st.fullName,
      admissionNumber: st.admissionNumber,
      rollNumber: st.rollNumber,
      byShift,
      byDepartment,
      byCode,
      totalDuties,
      totalDutyHours,
      workingDays,
      leaveDays,
      offDays,
    };
  });

  const compareRoll = (
    a: { rollNumber?: number; fullName?: string },
    b: { rollNumber?: number; fullName?: string },
  ) => {
    const ar = a.rollNumber;
    const br = b.rollNumber;
    const aHas = typeof ar === "number" && Number.isFinite(ar);
    const bHas = typeof br === "number" && Number.isFinite(br);
    if (aHas && bHas && ar !== br) return ar - br;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return (a.fullName || "").localeCompare(b.fullName || "", undefined, {
      sensitivity: "base",
    });
  };
  dutySummary.sort(compareRoll);

  const clinicalRecord: ClinicalDutyRecordRow[] = dutySummary.map((row) => ({
    studentId: row.studentId,
    fullName: row.fullName,
    admissionNumber: row.admissionNumber,
    rollNumber: row.rollNumber,
    byDepartment: row.byDepartment,
    totalDuties: row.totalDuties,
  }));

  return {
    roster,
    dutySummary,
    clinicalRecord,
    shiftLegend: shifts
      .filter((s) => s.isActive)
      .map((s) => ({
        shortCode: s.shortCode,
        name: s.name,
        dutyHours: s.dutyHours,
      })),
    departmentLegend: departments
      .filter((d) => d.isActive)
      .map((d) => ({ shortCode: d.shortCode, name: d.name })),
    codeLegend: dutyCodes
      .filter((c) => c.isActive)
      .map((c) => ({
        code: c.code,
        label: c.label,
        isLeave: Boolean(c.isLeave),
        isOff: Boolean(c.isOff),
      })),
  };
};

export const getHospitalRosterSummary = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantId(req);
  const doc = await HospitalRoster.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false,
  }).lean();
  if (!doc) throw new ApiError(404, "Roster not found");
  await ensureDefaultDepartments(schoolId);
  await ensureDefaultShifts(schoolId);
  await ensureDefaultDutyCodes(schoolId);
  const summary = await buildSummary(schoolId, doc as Record<string, unknown>);
  return sendSuccess(res, "Roster summary fetched", summary);
});

/** Day assignments for attendance integration (read-only for coordinators). */
export const getHospitalRosterDayAssignments = asyncHandler(
  async (req: Request, res: Response) => {
    const schoolId = tenantId(req);
    const day = Number(req.query.day);
    if (!Number.isFinite(day) || day < 1 || day > 93) {
      throw new ApiError(400, "Query ?day=1-93 is required");
    }
    const doc = await HospitalRoster.findOne({
      _id: req.params.id,
      schoolId,
      isDeleted: false,
    }).lean();
    if (!doc) throw new ApiError(404, "Roster not found");

    const roster = await formatRoster(doc as Record<string, unknown>);
    const [shifts, departments] = await Promise.all([
      DutyShift.find({ schoolId, isDeleted: false }).lean(),
      HospitalDepartment.find({ schoolId, isDeleted: false }).lean(),
    ]);
    const shiftById = new Map(shifts.map((s) => [s._id.toString(), s]));
    const deptById = new Map(departments.map((d) => [d._id.toString(), d]));

    const assignments = roster.cells
      .filter((c) => c.day === day)
      .map((c) => {
        const student = roster.students?.find((s) => s.studentId === c.studentId);
        const shift = c.shiftId ? shiftById.get(c.shiftId) : undefined;
        const dept = c.departmentId ? deptById.get(c.departmentId) : undefined;
        return {
          studentId: c.studentId,
          fullName: student?.fullName ?? "Student",
          admissionNumber: student?.admissionNumber,
          rollNumber: student?.rollNumber,
          day: c.day,
          shiftId: c.shiftId,
          shiftCode: shift?.shortCode,
          shiftName: shift?.name,
          departmentId: c.departmentId,
          departmentCode: dept?.shortCode,
          departmentName: dept?.name,
          code: c.code || "",
          remarks: c.remarks || "",
          hospitalId: roster.hospitalId,
          hospitalName: roster.hospitalName,
        };
      })
      .filter((a) => a.shiftId || a.departmentId || a.code);

    return sendSuccess(res, "Day assignments fetched", {
      rosterId: roster._id,
      rosterName: roster.name,
      hospitalName: roster.hospitalName,
      monthBs: roster.monthBs,
      startDateBs: roster.startDateBs,
      endDateBs: roster.endDateBs,
      day,
      assignments,
    });
  },
);
