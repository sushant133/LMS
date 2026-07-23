import type { Request, Response } from "express";
import {
  ERP_MODULES,
  LEADERSHIP_DESIGNATIONS,
  MODULE_ACCESS_UI_GROUPS,
  MODULE_PERMISSION_ACTIONS,
  MODULE_PERMISSION_ACTION_LABELS,
  PERMISSION_PRESETS,
  applyTeacherRoleBaseline,
  buildPresetModuleAccess,
  buildTeacherBaselineModuleAccess,
  expandModuleAccessMap,
  expandModuleActionsMap,
  hasConfiguredModuleAccess,
  updateModuleAccessSchema,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleActionsMap,
  type UserRole
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  getFullPermissionStateForUser,
  updateUserModuleAccess
} from "../utils/moduleAccessService.js";
import { sendSuccess } from "../utils/response.js";

const mapFromDoc = (raw: unknown): ModuleAccessMap => {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries()) as ModuleAccessMap;
  if (typeof raw === "object") return { ...(raw as ModuleAccessMap) };
  return {};
};

const actionsFromDoc = (raw: unknown): ModuleActionsMap => {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries()) as ModuleActionsMap;
  if (typeof raw === "object") return { ...(raw as ModuleActionsMap) };
  return {};
};

export const listErpModules = asyncHandler(async (_req: Request, res: Response) => {
  return sendSuccess(res, "ERP modules fetched", {
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      availableActions: m.availableActions ?? [...MODULE_PERMISSION_ACTIONS]
    })),
    actions: MODULE_PERMISSION_ACTIONS.map((action) => ({
      key: action,
      label: MODULE_PERMISSION_ACTION_LABELS[action]
    })),
    presets: PERMISSION_PRESETS,
    leadershipDesignations: LEADERSHIP_DESIGNATIONS
  });
});

export const getUserModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "");
  if (!userId) throw new ApiError(400, "userId is required");

  const user = await User.findById(userId)
    .select("fullName email role employeeId designation department moduleAccess moduleActions secondaryRoles schoolId")
    .lean();
  if (!user) throw new ApiError(404, "User not found");

  if (req.user?.role !== "SUPER_ADMIN") {
    const tenantId = req.tenantSchoolId ?? req.user?.schoolId;
    if (!user.schoolId || user.schoolId.toString() !== String(tenantId)) {
      throw new ApiError(403, "User is outside your institution");
    }
  }

  let map = mapFromDoc(user.moduleAccess);
  const actions = actionsFromDoc(user.moduleActions);
  const secondaryRoles = (user.secondaryRoles as UserRole[]) ?? [];
  const isTeacher =
    user.role === "TEACHER" || secondaryRoles.includes("TEACHER");
  if (isTeacher && hasConfiguredModuleAccess(map)) {
    map = applyTeacherRoleBaseline(map);
  }
  const configured = hasConfiguredModuleAccess(map);
  // Unconfigured: teachers start with teaching tools on; others start from no access.
  // (Runtime still uses legacy full access until the first save for non-teachers.)
  const expanded = configured
    ? expandModuleAccessMap(map)
    : isTeacher
      ? buildTeacherBaselineModuleAccess()
      : buildPresetModuleAccess("NO_ACCESS");
  const expandedActions = expandModuleActionsMap(
    configured ? map : expanded,
    actions
  );

  return sendSuccess(res, "Module access fetched", {
    userId,
    fullName: user.fullName,
    email: user.email,
    employeeId: user.employeeId,
    role: user.role,
    designation: user.designation,
    department: user.department,
    secondaryRoles,
    configured,
    moduleAccess: expanded,
    moduleActions: expandedActions,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: expanded[m.key as ErpModuleKey],
      actions: expandedActions[m.key as ErpModuleKey],
      availableActions: m.availableActions ?? [...MODULE_PERMISSION_ACTIONS]
    })),
    groups: MODULE_ACCESS_UI_GROUPS,
    leadershipDesignations: LEADERSHIP_DESIGNATIONS,
    presets: PERMISSION_PRESETS
  });
});

export const putUserModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "");
  if (!userId) throw new ApiError(400, "userId is required");

  const parsed = updateModuleAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.issues[0];
    const path = detail?.path?.length ? detail.path.join(".") : "payload";
    throw new ApiError(400, detail ? `${path}: ${detail.message}` : "Invalid permission payload");
  }
  const payload = parsed.data;
  const result = await updateUserModuleAccess(req, userId, {
    moduleAccess: payload.moduleAccess as ModuleAccessMap,
    moduleActions: (payload.moduleActions ?? {}) as ModuleActionsMap,
    secondaryRoles: (payload.secondaryRoles ?? []) as UserRole[],
    designation: payload.designation,
    reason: payload.reason
  });

  return sendSuccess(res, "Department access & permissions updated", {
    userId,
    ...result,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: result.moduleAccess[m.key as ErpModuleKey],
      actions: result.moduleActions[m.key as ErpModuleKey],
      availableActions: m.availableActions ?? [...MODULE_PERMISSION_ACTIONS]
    }))
  });
});

export const getMyModuleAccess = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const state = await getFullPermissionStateForUser(req.user.userId, req.user.role);
  return sendSuccess(res, "My module access fetched", {
    ...state,
    modules: ERP_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      mode: state.moduleAccess[m.key],
      actions: state.moduleActions[m.key]
    }))
  });
});

/** Helper for admin UI: return a preset map without saving. */
export const previewPermissionPreset = asyncHandler(async (req: Request, res: Response) => {
  const preset = String(req.query.preset ?? "FULL_ACCESS");
  if (!PERMISSION_PRESETS.includes(preset as (typeof PERMISSION_PRESETS)[number])) {
    throw new ApiError(400, "Invalid preset");
  }
  const moduleAccess = buildPresetModuleAccess(preset as (typeof PERMISSION_PRESETS)[number]);
  return sendSuccess(res, "Preset preview", {
    preset,
    moduleAccess,
    moduleActions: expandModuleActionsMap(moduleAccess, {})
  });
});
