import type { Request, Response } from "express";
import { teacherLaboratoryAssignmentSchema } from "@phit-erp/shared";
import { Laboratory } from "../models/Laboratory.js";
import { Teacher } from "../models/Teacher.js";
import { TeacherLaboratoryAssignment } from "../models/TeacherLaboratoryAssignment.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

const formatRow = (row: Record<string, unknown>) => {
  const lab = row.laboratoryId as { _id?: unknown; name?: string } | string | null;
  const laboratoryId =
    lab && typeof lab === "object" && lab._id != null
      ? String(lab._id)
      : String(row.laboratoryId);
  const laboratoryName =
    lab && typeof lab === "object" ? lab.name : undefined;

  return {
    ...row,
    _id: String(row._id),
    schoolId: String(row.schoolId),
    teacherId: String(
      typeof row.teacherId === "object" && row.teacherId && "_id" in (row.teacherId as object)
        ? (row.teacherId as { _id: unknown })._id
        : row.teacherId
    ),
    laboratoryId,
    laboratoryName
  };
};

export const listTeacherLabAssignments = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = typeof req.query.teacherId === "string" ? req.query.teacherId : "";
  const laboratoryId =
    typeof req.query.laboratoryId === "string" ? req.query.laboratoryId : "";
  const status = typeof req.query.status === "string" ? req.query.status : "ACTIVE";

  const filter: Record<string, unknown> = withTenantScope(req);
  if (teacherId) filter.teacherId = teacherId;
  if (laboratoryId) filter.laboratoryId = laboratoryId;
  if (status && status !== "ALL") filter.status = status;

  const rows = await TeacherLaboratoryAssignment.find(filter)
    .populate("laboratoryId", "name code yearLevel")
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(
    res,
    "Teacher laboratory assignments fetched",
    rows.map((row) => formatRow(row as Record<string, unknown>))
  );
});

export const createTeacherLabAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = teacherLaboratoryAssignmentSchema.parse(req.body);

  const [teacher, lab] = await Promise.all([
    Teacher.findOne(withTenantScope(req, { _id: payload.teacherId })),
    Laboratory.findOne(withTenantScope(req, { _id: payload.laboratoryId }))
  ]);

  if (!teacher) throw new ApiError(404, "Teacher not found");
  if (!lab) throw new ApiError(404, "Laboratory not found");

  const existing = await TeacherLaboratoryAssignment.findOne(
    withTenantScope(req, {
      teacherId: payload.teacherId,
      laboratoryId: payload.laboratoryId,
      role: payload.role,
      status: "ACTIVE"
    })
  );
  if (existing) {
    throw new ApiError(409, "This teacher already has an active assignment for this laboratory and role");
  }

  const fromBs =
    typeof payload.assignedFromBs === "string" && payload.assignedFromBs.trim()
      ? payload.assignedFromBs.trim()
      : getTodayBs();

  const row = await TeacherLaboratoryAssignment.create({
    schoolId: req.tenantSchoolId,
    teacherId: payload.teacherId,
    laboratoryId: payload.laboratoryId,
    role: payload.role,
    assignedFromBs: fromBs,
    assignedToBs: payload.assignedToBs?.trim() || null,
    status: payload.status ?? "ACTIVE",
    remarks: payload.remarks?.trim() || "",
    createdBy: req.user?.userId,
    updatedBy: req.user?.userId
  });

  // Keep legacy single in-charge field in sync when assigning IN_CHARGE
  if (payload.role === "IN_CHARGE" && payload.status !== "INACTIVE") {
    lab.inChargeTeacherId = teacher._id;
    await lab.save();
  }

  await recordAudit(req, {
    action: "CREATE",
    entity: "TeacherLaboratoryAssignment",
    entityId: row._id.toString(),
    after: row.toObject()
  });

  const populated = await TeacherLaboratoryAssignment.findById(row._id)
    .populate("laboratoryId", "name code yearLevel")
    .lean();

  return sendSuccess(
    res,
    "Laboratory assignment created",
    formatRow((populated ?? row.toObject()) as Record<string, unknown>),
    201
  );
});

export const updateTeacherLabAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = teacherLaboratoryAssignmentSchema.partial().parse(req.body);
  const row = await TeacherLaboratoryAssignment.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!row) throw new ApiError(404, "Laboratory assignment not found");

  const before = row.toObject();

  if (payload.role !== undefined) row.role = payload.role;
  if (payload.assignedFromBs !== undefined) row.assignedFromBs = payload.assignedFromBs;
  if (payload.assignedToBs !== undefined) {
    row.set("assignedToBs", payload.assignedToBs?.trim() ? payload.assignedToBs : null);
  }
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.remarks !== undefined) row.remarks = payload.remarks.trim();
  row.updatedBy = req.user?.userId as never;
  await row.save();

  if (row.role === "IN_CHARGE" && row.status === "ACTIVE") {
    await Laboratory.updateOne(
      withTenantScope(req, { _id: row.laboratoryId }),
      { $set: { inChargeTeacherId: row.teacherId } }
    );
  }

  await recordAudit(req, {
    action: "UPDATE",
    entity: "TeacherLaboratoryAssignment",
    entityId: row._id.toString(),
    before,
    after: row.toObject()
  });

  const populated = await TeacherLaboratoryAssignment.findById(row._id)
    .populate("laboratoryId", "name code yearLevel")
    .lean();

  return sendSuccess(
    res,
    "Laboratory assignment updated",
    formatRow((populated ?? row.toObject()) as Record<string, unknown>)
  );
});

export const deactivateTeacherLabAssignment = asyncHandler(async (req: Request, res: Response) => {
  const row = await TeacherLaboratoryAssignment.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!row) throw new ApiError(404, "Laboratory assignment not found");

  const before = row.toObject();
  row.status = "INACTIVE";
  row.assignedToBs = getTodayBs();
  row.updatedBy = req.user?.userId as never;
  await row.save();

  // Clear legacy in-charge if this was the active IN_CHARGE row
  if (before.role === "IN_CHARGE") {
    const lab = await Laboratory.findOne(withTenantScope(req, { _id: row.laboratoryId }));
    if (lab && String(lab.inChargeTeacherId) === String(row.teacherId)) {
      lab.set("inChargeTeacherId", null);
      await lab.save();
    }
  }

  await recordAudit(req, {
    action: "DEACTIVATE",
    entity: "TeacherLaboratoryAssignment",
    entityId: row._id.toString(),
    before,
    after: row.toObject()
  });

  return sendSuccess(res, "Laboratory assignment deactivated", formatRow(row.toObject() as Record<string, unknown>));
});
