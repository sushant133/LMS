import { normalizeUserRole, type UserRole } from "@nepal-school-erp/shared";
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
  return role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN";
};