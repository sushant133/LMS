import {
  INSTITUTION_NAME,
  USER_ROLE_LABELS,
  normalizeUserRole,
  type SchoolRecord,
  type UserProfile,
  type UserRole
} from "@phit-erp/shared";

export const getCollegeDisplayName = (
  availableSchools: SchoolRecord[],
  user?: UserProfile | null
): string => availableSchools[0]?.name ?? user?.school?.name ?? INSTITUTION_NAME;

export const roleLabelMap: Record<UserRole, string> = USER_ROLE_LABELS;

export const roleRedirectMap: Record<UserRole, string> = {
  SUPER_ADMIN: "/dashboard/super_admin",
  COLLEGE_ADMIN: "/dashboard/college_admin",
  COLLEGE_VIEWER: "/dashboard/college_admin",
  TEACHER: "/dashboard/teacher",
  STUDENT: "/dashboard/student",
  PARENT: "/dashboard/parent",
  LIBRARY_STAFF: "/library",
  LABORATORY_STAFF: "/laboratory",
  ACCOUNTANT: "/accounting",
  CASHIER: "/accounting",
  AUDITOR: "/accounting",
  PRINCIPAL: "/accounting",
  COLLEGE_STAFF: "/dashboard/college_staff"
};

export const getRoleRedirectPath = (role: string | undefined | null): string | null => {
  if (!role) {
    return null;
  }

  const normalizedRole = normalizeUserRole(role);
  return roleRedirectMap[normalizedRole] ?? null;
};