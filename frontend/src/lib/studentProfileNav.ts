import { normalizeUserRole, type UserRole } from "@phit-erp/shared";

export const getStudentProfileBackPath = (role: UserRole | string | null | undefined): string => {
  const normalized = role ? normalizeUserRole(role) : null;

  switch (normalized) {
    case "ACCOUNTANT":
      return "/accounting";
    case "STUDENT":
      return "/my-subjects";
    case "PARENT":
      return "/parent-portal";
    case "TEACHER":
    case "COLLEGE_ADMIN":
    case "COLLEGE_VIEWER":
    case "SUPER_ADMIN":
      return "/students/list";
    default:
      return "/dashboard";
  }
};

export const getStudentProfileBackLabel = (role: UserRole | string | null | undefined): string => {
  const normalized = role ? normalizeUserRole(role) : null;

  switch (normalized) {
    case "ACCOUNTANT":
      return "Back to Accounting";
    case "STUDENT":
      return "Back to My Subjects";
    case "PARENT":
      return "Back to Parent Portal";
    case "TEACHER":
    case "COLLEGE_ADMIN":
    case "COLLEGE_VIEWER":
    case "SUPER_ADMIN":
      return "Back to Students";
    default:
      return "Back to Dashboard";
  }
};