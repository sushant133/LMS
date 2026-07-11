import {
  canManageInstitution,
  canWriteModule,
  MODULE_ACCESS_DISABLED_MESSAGE,
  resolveModuleFromRoutePath,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode,
} from "@phit-erp/shared";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "features/auth/AuthProvider";

/**
 * Resolve write permission for an ERP module for the signed-in user.
 * Admins always have write. Missing keys default to WRITE (enabled).
 */
export const useModuleAccess = (moduleKey?: ErpModuleKey) => {
  const { user } = useAuth();
  const location = useLocation();

  const map = (user?.moduleAccess ?? {}) as ModuleAccessMap;
  const isAdmin = canManageInstitution(user?.role ?? "");

  const resolvedKey =
    moduleKey ?? resolveModuleFromRoutePath(location.pathname) ?? undefined;

  const mode: ModuleAccessMode = useMemo(() => {
    if (isAdmin) return "WRITE";
    if (!resolvedKey) return "WRITE";
    return canWriteModule(map, resolvedKey) ? "WRITE" : "READ_ONLY";
  }, [isAdmin, map, resolvedKey]);

  const canWrite = mode === "WRITE";
  const isReadOnly = !canWrite;

  return {
    moduleKey: resolvedKey,
    mode,
    canWrite,
    isReadOnly,
    disabledMessage: MODULE_ACCESS_DISABLED_MESSAGE,
    moduleAccess: map,
  };
};

/** Convenience: can the current user write to this module? */
export const useCanWriteModule = (moduleKey: ErpModuleKey): boolean => {
  const { canWrite } = useModuleAccess(moduleKey);
  return canWrite;
};
