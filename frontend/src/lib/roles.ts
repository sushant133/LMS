import {
  INSTITUTION_ACCESS_ROLES,
  INSTITUTION_ADMIN_ROLES,
  canManageInstitution,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isSystemAdministrator,
  normalizeUserRole,
  type UserRole
} from "@phit-erp/shared";

export {
  INSTITUTION_ACCESS_ROLES,
  INSTITUTION_ADMIN_ROLES,
  canManageInstitution,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isSystemAdministrator
};

export const hasProtectedRouteAccess = (userRole: string, allowedRoles?: UserRole[]): boolean => {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  const normalizedRole = normalizeUserRole(userRole);

  if (allowedRoles.includes(normalizedRole)) {
    return true;
  }

  if (normalizedRole === "COLLEGE_VIEWER" && allowedRoles.includes("COLLEGE_ADMIN")) {
    return true;
  }

  // System Administrator inherits every Administrator route and all staff module routes.
  if (normalizedRole === "SUPER_ADMIN") {
    const staffModuleRoles: UserRole[] = [
      "COLLEGE_ADMIN",
      "COLLEGE_VIEWER",
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