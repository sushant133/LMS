import {
  canManageInstitution,
  hasInstitutionAccess,
  isSystemAdministrator,
  normalizeUserRole,
  type UserRole
} from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";

export const useNormalizedRole = (): UserRole | null => {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  return normalizeUserRole(user.role);
};

export const useIsTenantAdmin = (): boolean => {
  const role = useNormalizedRole();
  return role ? canManageInstitution(role) : false;
};

export const useHasInstitutionAccess = (): boolean => {
  const role = useNormalizedRole();
  return role ? hasInstitutionAccess(role) : false;
};

export const useIsSystemAdministrator = (): boolean => {
  const role = useNormalizedRole();
  return role ? isSystemAdministrator(role) : false;
};

/**
 * @deprecated Global role-based read-only for College Administrators was removed.
 * Per-module write is controlled by Module Access (`useModuleAccess` / `useCanWriteModule`).
 * Kept so existing callers still compile; always reports not read-only.
 */
export const useReadOnlyAccess = () => {
  return {
    isReadOnly: false,
    readOnlyMessage: ""
  };
};
