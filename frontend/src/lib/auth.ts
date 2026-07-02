import type { SchoolRecord, UserProfile, UserRole } from "@nepal-school-erp/shared";

export const getSchoolDisplayName = (
  availableSchools: SchoolRecord[],
  user?: UserProfile | null
): string => availableSchools[0]?.name ?? user?.school?.name ?? "Your School";

export const roleLabelMap: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  SCHOOL_ADMIN: "School Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
  LIBRARY_STAFF: "Library Staff",
  LABORATORY_STAFF: "Laboratory Staff",
  ACCOUNTANT: "Accountant"
};

export const roleRedirectMap: Record<UserRole, string> = {
  SUPER_ADMIN: "/dashboard/super_admin",
  SCHOOL_ADMIN: "/dashboard/school_admin",
  TEACHER: "/dashboard/teacher",
  STUDENT: "/my-subjects",
  PARENT: "/dashboard/parent",
  LIBRARY_STAFF: "/library",
  LABORATORY_STAFF: "/laboratory",
  ACCOUNTANT: "/accounting"
};