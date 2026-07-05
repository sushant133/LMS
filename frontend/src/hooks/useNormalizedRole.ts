import { isInstitutionAdmin, isSystemAdministrator, normalizeUserRole, type UserRole } from "@phit-erp/shared";
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
  return role ? isInstitutionAdmin(role) : false;
};

export const useIsSystemAdministrator = (): boolean => {
  const role = useNormalizedRole();
  return role ? isSystemAdministrator(role) : false;
};