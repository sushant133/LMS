import {
  canAccessModule,
  canManageInstitution,
  canWriteModule,
  hasModuleAction,
  resolveModuleAccessMode,
  resolveModuleFromRoutePath,
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
 * Do not surface “disabled by administrator” messages — simply hide or disable actions.
 */
export const useModuleAccess = (moduleKey?: ErpModuleKey) => {
  const { user } = useAuth();
  const location = useLocation();

  const map = (user?.moduleAccess ?? {}) as ModuleAccessMap;
  const actionsMap = (user?.moduleActions ?? {}) as ModuleActionsMap;
  const isAdmin = canManageInstitution(user?.role ?? "");

  const resolvedKey =
    moduleKey ?? resolveModuleFromRoutePath(location.pathname) ?? undefined;

  const mode: ModuleAccessMode = useMemo(() => {
    if (isAdmin) return "WRITE";
    if (!resolvedKey) return "WRITE";
    return resolveModuleAccessMode(map, resolvedKey);
  }, [isAdmin, map, resolvedKey]);

  const canAccess = isAdmin || !resolvedKey || canAccessModule(map, resolvedKey);
  const canWrite =
    isAdmin ||
    (resolvedKey ? canWriteModule(map, resolvedKey) : true);
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
