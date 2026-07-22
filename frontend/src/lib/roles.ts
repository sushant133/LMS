import {
  INSTITUTION_ACCESS_ROLES,
  INSTITUTION_ADMIN_ROLES,
  canAccessModule,
  canManageInstitution,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isSystemAdministrator,
  normalizeUserRole,
  resolveModuleFromRoutePath,
  type ModuleAccessMap,
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

export const hasProtectedRouteAccess = (
  userRole: string,
  allowedRoles?: UserRole[],
  secondaryRoles?: string[],
  options?: {
    pathname?: string;
    moduleAccess?: ModuleAccessMap | null;
    /** Only unlock role-gated routes when an admin has saved a custom map */
    moduleAccessConfigured?: boolean;
  }
): boolean => {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  const normalizedRole = normalizeUserRole(userRole);
  const effective = new Set<UserRole>([
    normalizedRole,
    ...(secondaryRoles ?? []).map((role) => normalizeUserRole(role))
  ]);

  if (allowedRoles.some((role) => effective.has(normalizeUserRole(role)))) {
    return true;
  }

  if (effective.has("COLLEGE_VIEWER") && allowedRoles.includes("COLLEGE_ADMIN")) {
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
      "COLLEGE_STAFF",
      "PRINCIPAL",
      "CASHIER",
      "AUDITOR"
    ];
    return allowedRoles.some((role) => staffModuleRoles.includes(role));
  }

  // Staff / teachers with an explicit Module Access grant may open that department's routes
  if (
    options?.moduleAccessConfigured &&
    options.pathname &&
    options.moduleAccess
  ) {
    const moduleKey = resolveModuleFromRoutePath(options.pathname);
    if (moduleKey && canAccessModule(options.moduleAccess, moduleKey)) {
      return true;
    }
  }

  return false;
};