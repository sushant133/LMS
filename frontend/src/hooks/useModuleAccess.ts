import {
  applyFinanceRoleBaseline,
  applyTeacherRoleBaseline,
  canAccessModule,
  canEditOrDeleteRecords,
  hasModuleAction,
  isInstitutionAdmin,
  isSystemAdministrator,
  resolveModuleAccessMode,
  resolveModuleFromRoutePath,
  TEACHER_BASELINE_MODULE_KEYS,
  userHasFinanceRole,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode,
  type ModuleActionsMap,
  type ModulePermissionAction,
} from "@phit-erp/shared";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "features/auth/AuthProvider";
import { userIsTeacher } from "lib/teacherRole";
import { isDualRoleTeacher, useWorkspaceMode } from "lib/workspace";

/**
 * Resolve module access for the signed-in user.
 * Super Admin always has full write.
 * Administrators (COLLEGE_ADMIN) honor Super Admin’s module matrix when configured
 * (unconfigured = full legacy access via empty map → WRITE).
 * Staff only see / use modules the admin granted (NONE modules are hidden).
 * Teachers always keep teaching baseline modules (Academic Management, etc.).
 * Finance roles keep Accounts baseline (mirror backend).
 * Do not surface “disabled by administrator” messages — simply hide or disable actions.
 */
export const useModuleAccess = (moduleKey?: ErpModuleKey) => {
  const { user } = useAuth();
  const location = useLocation();

  const isTeacher =
    user?.role === "TEACHER" ||
    (user?.secondaryRoles ?? []).includes("TEACHER");
  const secondaryRoles = user?.secondaryRoles ?? [];
  const isFinance = userHasFinanceRole(user?.role, secondaryRoles);

  const map = useMemo(() => {
    let raw = (user?.moduleAccess ?? {}) as ModuleAccessMap;
    // Mirror backend baselines so client nav/actions match API
    if (isTeacher && Object.keys(raw).length > 0) {
      raw = applyTeacherRoleBaseline(raw) as ModuleAccessMap;
    }
    if (isFinance && Object.keys(raw).length > 0) {
      raw = applyFinanceRoleBaseline(raw, [
        user?.role ?? "",
        ...secondaryRoles,
      ]) as ModuleAccessMap;
    }
    return raw;
  }, [user?.moduleAccess, user?.role, isTeacher, isFinance, secondaryRoles]);

  const actionsMap = (user?.moduleActions ?? {}) as ModuleActionsMap;
  /** Only Super Admin skips the matrix entirely. */
  const isUnrestricted = isSystemAdministrator(user?.role ?? "");

  const resolvedKey =
    moduleKey ?? resolveModuleFromRoutePath(location.pathname) ?? undefined;

  const mode: ModuleAccessMode = useMemo(() => {
    if (isUnrestricted) return "WRITE";
    if (!resolvedKey) return "WRITE";
    let m = resolveModuleAccessMode(map, resolvedKey);
    // Teaching tools: never treat baseline modules as denied for teachers
    if (
      isTeacher &&
      m === "NONE" &&
      (TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(resolvedKey)
    ) {
      m = "WRITE";
    }
    return m;
  }, [isUnrestricted, isTeacher, map, resolvedKey]);

  const canAccess =
    isUnrestricted ||
    !resolvedKey ||
    mode !== "NONE" ||
    canAccessModule(map, resolvedKey);
  const canWrite =
    isUnrestricted ||
    (resolvedKey
      ? mode === "WRITE" ||
        (isTeacher &&
          (TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(
            resolvedKey,
          ) &&
          mode !== "READ_ONLY")
      : true);
  const isReadOnly = canAccess && !canWrite;
  const isDenied = !canAccess;

  const canDo = (action: ModulePermissionAction): boolean => {
    if (isUnrestricted) return true;
    if (!resolvedKey) return true;
    return hasModuleAction(map, actionsMap, resolvedKey, action);
  };

  return {
    moduleKey: resolvedKey,
    mode,
    canAccess,
    canWrite,
    isUnrestricted,
    isReadOnly,
    isDenied,
    canDo,
    /** Kept for compatibility; intentionally empty — never show admin-disable banners to staff. */
    disabledMessage: "",
    moduleAccess: map,
    moduleActions: actionsMap,
    secondaryRoles: user?.secondaryRoles ?? [],
    designation: user?.designation,
  };
};

/** Convenience: can the current user write to this module? */
export const useCanWriteModule = (moduleKey: ErpModuleKey): boolean => {
  const { canWrite } = useModuleAccess(moduleKey);
  return canWrite;
};

/** Does the user have access (not NONE) to this module? */
export const useCanAccessModule = (moduleKey: ErpModuleKey): boolean => {
  const { canAccess } = useModuleAccess(moduleKey);
  return canAccess;
};

/**
 * True when this user may use admin controls for a department:
 * institution Administrator, or an explicit Module Access Manage grant
 * on a non-teaching module (e.g. Teacher Management for a Vice Principal).
 * Teaching baseline WRITE (My Students, My Attendance, …) does not count.
 */
export const useCanManageGrantedModule = (moduleKey: ErpModuleKey): boolean => {
  const { user } = useAuth();
  const { canWrite, isUnrestricted } = useModuleAccess(moduleKey);
  if (isUnrestricted) return true;
  if (!canWrite) return false;
  if (isInstitutionAdmin(user?.role ?? "")) return true;
  if (isDualRoleTeacher(user)) return true;
  if (userIsTeacher(user)) {
    return !(TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(
      moduleKey,
    );
  }
  return true;
};

/**
 * Administration UI for a department (Approve, create students, manage library…).
 * Institution admins always. Staff with Manage. Dual-role teachers only on
 * Administration routes for teaching-baseline modules (My Work stays teaching-only).
 */
export const useIsGrantedAdmin = (moduleKey: ErpModuleKey): boolean => {
  const { user } = useAuth();
  const workspace = useWorkspaceMode();
  const canManage = useCanManageGrantedModule(moduleKey);
  if (!canManage) return false;
  if (isInstitutionAdmin(user?.role ?? "") || isSystemAdministrator(user?.role ?? "")) {
    return true;
  }
  if (
    userIsTeacher(user) &&
    (TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(moduleKey)
  ) {
    return workspace === "admin";
  }
  return true;
};

/** Edit / Delete on existing records — Administrator and System Administrator only. */
export const useCanEditOrDeleteRecords = (): boolean => {
  const { user } = useAuth();
  return canEditOrDeleteRecords(user?.role ?? "");
};
