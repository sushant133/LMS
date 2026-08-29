import {
  INSTITUTION_ACCESS_ROLES,
  INSTITUTION_ADMIN_ROLES,
  canAccessAcademicStructure,
  canAccessAttendanceAdminHub,
  canAccessAttendanceManagement,
  canAccessExaminationManagement,
  canAccessModule,
  canAccessStaffDirectory,
  canManageInstitution,
  hasExtraAdminModuleGrants,
  hasInstitutionAccess,
  isAcademicStructurePath,
  isAttendanceAdminHubPath,
  isAttendanceManagementPath,
  isExaminationManagementPath,
  isInstitutionAdmin,
  isStaffDirectoryPath,
  isSystemAdministrator,
  normalizeUserRole,
  resolveModuleFromRoutePath,
  TEACHER_BASELINE_MODULE_KEYS,
  type ModuleAccessMap,
  type UserRole
} from "@phit-erp/shared";
import { isAdminWorkspacePath } from "./workspace";

export {
  INSTITUTION_ACCESS_ROLES,
  INSTITUTION_ADMIN_ROLES,
  canManageInstitution,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isSystemAdministrator,
  normalizeUserRole
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
    // Teacher + Staff directory share /college-staff (Teachers tab redirects here)
    if (
      isStaffDirectoryPath(options.pathname) &&
      canAccessStaffDirectory(options.moduleAccess)
    ) {
      return true;
    }
    // Attendance Management hub: HR teacher/staff attendance, or any attendance
    // grant for non-teaching staff. Teaching My Attendance is /attendance.
    if (isAttendanceAdminHubPath(options.pathname)) {
      if (canAccessAttendanceAdminHub(options.moduleAccess)) {
        return true;
      }
      if (canAccessAttendanceManagement(options.moduleAccess)) {
        return true;
      }
    }
    if (
      isAttendanceManagementPath(options.pathname) &&
      canAccessAttendanceManagement(options.moduleAccess)
    ) {
      return true;
    }
    // Examination Management: College and/or CTEVT grants unlock /exams-view
    if (
      isExaminationManagementPath(options.pathname) &&
      canAccessExaminationManagement(options.moduleAccess)
    ) {
      return true;
    }
    // Academic Structure is gated by its own visibility module, so a data grant
    // on `academics` (or a role baseline) never re-opens the screen.
    if (isAcademicStructurePath(options.pathname)) {
      return canAccessAcademicStructure(options.moduleAccess);
    }
    const moduleKey = resolveModuleFromRoutePath(options.pathname);
    if (moduleKey && canAccessModule(options.moduleAccess, moduleKey)) {
      const isTeacherUser =
        normalizedRole === "TEACHER" ||
        (secondaryRoles ?? []).some(
          (role) => normalizeUserRole(role) === "TEACHER",
        );
      if (
        isTeacherUser &&
        isAdminWorkspacePath(options.pathname) &&
        (TEACHER_BASELINE_MODULE_KEYS as readonly string[]).includes(moduleKey) &&
        !hasExtraAdminModuleGrants(options.moduleAccess)
      ) {
        return false;
      }
      return true;
    }
  }

  return false;
};