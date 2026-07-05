import { INSTITUTION_ADMIN_ROLES, isInstitutionAdmin, isSystemAdministrator, normalizeUserRole, type UserRole } from "@phit-erp/shared";

export { INSTITUTION_ADMIN_ROLES, isInstitutionAdmin, isSystemAdministrator };

export const hasProtectedRouteAccess = (userRole: string, allowedRoles?: UserRole[]): boolean => {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  const normalizedRole = normalizeUserRole(userRole);

  if (allowedRoles.includes(normalizedRole)) {
    return true;
  }

  // System Administrator inherits every College Administrator route and all staff module routes.
  if (normalizedRole === "SUPER_ADMIN") {
    const staffModuleRoles: UserRole[] = [
      "COLLEGE_ADMIN",
      "TEACHER",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "ACCOUNTANT",
      "COLLEGE_STAFF"
    ];
    return allowedRoles.some((role) => staffModuleRoles.includes(role));
  }

  return false;
};