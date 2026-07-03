import { normalizeUserRole, type SchoolRecord, type UserProfile, type UserRole } from "@nepal-school-erp/shared";

export const getCollegeDisplayName = (
  availableSchools: SchoolRecord[],
  user?: UserProfile | null
): string => availableSchools[0]?.name ?? user?.school?.name ?? "Your College";

export const roleLabelMap: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  COLLEGE_ADMIN: "College Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
  LIBRARY_STAFF: "Library Staff",
  LABORATORY_STAFF: "Laboratory Staff",
  ACCOUNTANT: "Accountant"
};

export const roleRedirectMap: Record<UserRole, string> = {
  SUPER_ADMIN: "/dashboard/super_admin",
  COLLEGE_ADMIN: "/dashboard/college_admin",
  TEACHER: "/dashboard/teacher",
  STUDENT: "/my-subjects",
  PARENT: "/dashboard/parent",
  LIBRARY_STAFF: "/library",
  LABORATORY_STAFF: "/laboratory",
  ACCOUNTANT: "/accounting"
};

export const getRoleRedirectPath = (role: string | undefined | null): string | null => {
  if (!role) {
    return null;
  }

  const normalizedRole = normalizeUserRole(role);
  return roleRedirectMap[normalizedRole] ?? null;
};