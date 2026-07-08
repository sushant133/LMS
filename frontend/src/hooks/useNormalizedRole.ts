import {
  canManageInstitution,
  hasInstitutionAccess,
  isCollegeViewer,
  isSystemAdministrator,
  normalizeUserRole,
  READ_ONLY_ACCESS_MESSAGE,
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

export const useReadOnlyAccess = () => {
  const role = useNormalizedRole();
  const isReadOnly = role ? isCollegeViewer(role) : false;

  return {
    isReadOnly,
    readOnlyMessage: READ_ONLY_ACCESS_MESSAGE
  };
};