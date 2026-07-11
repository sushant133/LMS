import type { Request } from "express";
import { isInstitutionAdmin, normalizeUserRole } from "@phit-erp/shared";
import { Laboratory } from "../models/Laboratory.js";
import { Teacher } from "../models/Teacher.js";
import { ApiError } from "./apiError.js";
import { withTenantScope } from "./tenant.js";

export type LabAccessContext = {
  role: string;
  isGlobalManager: boolean;
  isAdmin: boolean;
  teacherId: string | null;
  assignedLabIds: string[];
};

/**
 * Global managers: Admin, Super Admin, College Viewer (read), Laboratory Staff.
 * Teachers only see laboratories where they are the assigned in-charge.
 */
export async function resolveLabAccess(req: Request): Promise<LabAccessContext> {
  const role = normalizeUserRole(req.user?.role ?? "");
  const isAdmin = isInstitutionAdmin(role);
  const isGlobalManager =
    isAdmin || role === "COLLEGE_VIEWER" || role === "LABORATORY_STAFF";

  if (isGlobalManager) {
    return {
      role,
      isGlobalManager: true,
      isAdmin,
      teacherId: null,
      assignedLabIds: []
    };
  }

  if (role !== "TEACHER" || !req.user?.userId) {
    throw new ApiError(403, "You do not have access to laboratory management");
  }

  const teacher = await Teacher.findOne({ user: req.user.userId }).select("_id").lean();
  if (!teacher) {
    throw new ApiError(403, "Teacher profile not found for laboratory access");
  }

  const labs = await Laboratory.find(
    withTenantScope(req, { inChargeTeacherId: teacher._id, isActive: true })
  )
    .select("_id")
    .lean();

  return {
    role,
    isGlobalManager: false,
    isAdmin: false,
    teacherId: teacher._id.toString(),
    assignedLabIds: labs.map((lab) => lab._id.toString())
  };
}

export function labScopeFilter(
  access: LabAccessContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  if (access.isGlobalManager) {
    return { ...extra };
  }
  return {
    ...extra,
    laboratoryId: { $in: access.assignedLabIds }
  };
}

export function assertLabAccess(access: LabAccessContext, laboratoryId: string): void {
  if (access.isGlobalManager) {
    return;
  }
  if (access.assignedLabIds.length === 0) {
    throw new ApiError(
      403,
      "You are not assigned as Laboratory In-Charge for any laboratory"
    );
  }
  if (!access.assignedLabIds.includes(laboratoryId)) {
    throw new ApiError(403, "You can only manage your assigned laboratory");
  }
}

export function assertCanApprovePurchases(access: LabAccessContext): void {
  if (!access.isAdmin) {
    throw new ApiError(403, "Only administrators can approve or process stock purchases");
  }
}

export function assertCanDeleteLaboratory(access: LabAccessContext): void {
  if (!access.isAdmin) {
    throw new ApiError(403, "Only administrators can delete laboratories");
  }
}
