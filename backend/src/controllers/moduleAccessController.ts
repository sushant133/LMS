import type { Request, Response } from "express";
import {
  ERP_MODULES,
  expandModuleAccessMap,
  updateModuleAccessSchema,
  type ErpModuleKey,
  type ModuleAccessMap
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  getExpandedModuleAccessForUser,
  updateUserModuleAccess
} from "../utils/moduleAccessService.js";
import { sendSuccess } from "../utils/response.js";

const mapFromDoc = (raw: unknown): ModuleAccessMap => {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries()) as ModuleAccessMap;
  if (typeof raw === "object") return { ...(raw as ModuleAccessMap) };
  return {};
};

export const listErpModules = asyncHandler(async (_req: Request, res: Response) => {
  return sendSuccess(
    res,
    "ERP modules fetched",
    ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description
    }))
  );
});

export const getUserModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "");
  if (!userId) throw new ApiError(400, "userId is required");

  const user = await User.findById(userId).select("fullName email role employeeId moduleAccess schoolId").lean();
  if (!user) throw new ApiError(404, "User not found");

  if (req.user?.role !== "SUPER_ADMIN") {
    const tenantId = req.tenantSchoolId ?? req.user?.schoolId;
    if (!user.schoolId || user.schoolId.toString() !== String(tenantId)) {
      throw new ApiError(403, "User is outside your institution");
    }
  }

  const expanded = expandModuleAccessMap(mapFromDoc(user.moduleAccess));

  return sendSuccess(res, "Module access fetched", {
    userId,
    fullName: user.fullName,
    email: user.email,
    employeeId: user.employeeId,
    role: user.role,
    moduleAccess: expanded,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: expanded[m.key as ErpModuleKey]
    }))
  });
});

export const putUserModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "");
  if (!userId) throw new ApiError(400, "userId is required");

  const payload = updateModuleAccessSchema.parse(req.body);
  const expanded = await updateUserModuleAccess(req, userId, payload.moduleAccess as ModuleAccessMap);

  return sendSuccess(res, "Module access updated", {
    userId,
    moduleAccess: expanded,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: expanded[m.key as ErpModuleKey]
    }))
  });
});

export const getMyModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const expanded = await getExpandedModuleAccessForUser(req.user.userId, req.user.role);
  return sendSuccess(res, "My module access fetched", {
    moduleAccess: expanded,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: expanded[m.key]
    }))
  });
});
