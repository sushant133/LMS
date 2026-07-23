import {
  applyTeacherRoleBaseline,
  canAccessModule,
  canManageInstitution,
  canWriteModule,
  hasModuleAction,
  resolveModuleAccessMode,
  resolveModuleFromRoutePath,
  TEACHER_BASELINE_MODULE_KEYS,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode,
  type ModuleActionsMap,
  type ModulePermissionAction,
} from "@phit-erp/shared";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "features/auth/AuthProvider";

/**
 * Resolve module access for the signed-in user.
 * Admins always have full write.
 * Staff only see / use modules the admin granted (NONE modules are hidden).
 * Teachers always keep teaching baseline modules (Academic Management, etc.).
 * Do not surface “disabled by administrator” messages — simply hide or disable actions.
 */
export const useModuleAccess = (moduleKey?: ErpModuleKey) => {
  const { user } = useAuth();
  const location = useLocation();

  const isTeacher =
    user?.role === "TEACHER" ||
    (user?.secondaryRoles ?? []).includes("TEACHER");

  const map = useMemo(() => {
    const raw = (user?.moduleAccess ?? {}) as ModuleAccessMap;
    // Mirror backend applyTeacherRoleBaseline so client nav/actions match API
    if (isTeacher && Object.keys(raw).length > 0) {
      return applyTeacherRoleBaseline(raw) as ModuleAccessMap;
    }
    return raw;
  }, [user?.moduleAccess, isTeacher]);

  const actionsMap = (user?.moduleActions ?? {}) as ModuleActionsMap;
  const isAdmin = canManageInstitution(user?.role ?? "");

  const resolvedKey =
    moduleKey ?? resolveModuleFromRoutePath(location.pathname) ?? undefined;

  const mode: ModuleAccessMode = useMemo(() => {
    if (isAdmin) return "WRITE";
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
  }, [isAdmin, isTeacher, map, resolvedKey]);

  const canAccess =
    isAdmin ||
    !resolvedKey ||
    mode !== "NONE" ||
    canAccessModule(map, resolvedKey);
  const canWrite =
    isAdmin ||
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
    if (isAdmin) return true;
    if (!resolvedKey) return true;
    return hasModuleAction(map, actionsMap, resolvedKey, action);
  };

  return {
    moduleKey: resolvedKey,
    mode,
    canAccess,
    canWrite,
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
