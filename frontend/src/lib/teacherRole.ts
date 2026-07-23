import { normalizeUserRole, type UserProfile, type UserRole } from "@phit-erp/shared";

/** Primary TEACHER or secondaryRoles includes TEACHER (e.g. Principal who also teaches). */
export const userIsTeacher = (
  user?: Pick<UserProfile, "role" | "secondaryRoles"> | null
): boolean => {
  if (!user) return false;
  if (normalizeUserRole(user.role) === "TEACHER") return true;
  return (user.secondaryRoles ?? []).some(
    (role) => normalizeUserRole(role as UserRole) === "TEACHER"
  );
};

export const roleIsTeacher = (
  role?: string | null,
  secondaryRoles?: string[] | null
): boolean => {
  if (role && normalizeUserRole(role) === "TEACHER") return true;
  return (secondaryRoles ?? []).some(
    (r) => normalizeUserRole(r as UserRole) === "TEACHER"
  );
};
