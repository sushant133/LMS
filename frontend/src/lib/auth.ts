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

/**
 * Title shown on the logged-in account (sidebar, header, dashboard badge).
 * Leadership designation (e.g. Principal) takes priority over system role (Teacher).
 */
export const getUserDisplayTitle = (
  user?: Pick<UserProfile, "role" | "designation"> | null
): string => {
  if (!user) return "";
  const designation = user.designation?.trim();
  if (designation) return designation;
  return roleLabelMap[normalizeUserRole(user.role)] ?? user.role;
};

/**
 * Secondary label when designation is set — e.g. system role "Teacher" under "Principal".
 */
export const getUserRoleSubtitle = (
  user?: Pick<UserProfile, "role" | "designation"> | null
): string | null => {
  if (!user?.designation?.trim()) return null;
  const role = roleLabelMap[normalizeUserRole(user.role)] ?? user.role;
  if (role.toLowerCase() === user.designation.trim().toLowerCase()) return null;
  return role;
};

/** Keep in sync with backend authController getRedirectPath. */
export const roleRedirectMap: Record<UserRole, string> = {
  SUPER_ADMIN: "/dashboard/super_admin",
  COLLEGE_ADMIN: "/dashboard/college_admin",
  COLLEGE_VIEWER: "/dashboard/college_admin",
  TEACHER: "/dashboard/teacher",
  STUDENT: "/my-subjects",
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