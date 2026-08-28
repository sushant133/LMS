import {
  hasExtraAdminModuleGrants,
  isSystemAdministrator,
  type ModuleAccessMap,
  type UserProfile,
} from "@phit-erp/shared";
import { useLocation } from "react-router-dom";
import { userIsTeacher } from "lib/teacherRole";

/** Teaching (My Work) vs institution Administration. */
export type WorkspaceMode = "teacher" | "admin" | "general";

export const TEACHER_WORK_PATHS = {
  students: "/my-students",
  academicManagement: "/academic-management",
  timetable: "/timetable",
  laboratory: "/laboratory",
  attendance: "/attendance",
  exams: "/exams",
  homework: "/homework",
  library: "/my-library",
} as const;

export const ADMIN_WORK_PATHS = {
  students: "/students",
  academicManagement: "/academic-management-view",
  timetable: "/timetable-view",
  laboratory: "/laboratory-view",
  attendance: "/attendance-view",
  exams: "/exams-view",
  library: "/library",
  subjectAssignments: "/academics/subject-assignments",
  academicStructure: "/academics",
} as const;

const stripQuery = (path: string): string => path.split("?")[0] ?? path;

export const isTeacherWorkspacePath = (pathname: string): boolean => {
  const path = stripQuery(pathname);
  if (path.startsWith("/academic-management-view")) return false;
  if (path.startsWith("/timetable-view")) return false;
  if (path.startsWith("/laboratory-view")) return false;
  return (
    path === "/my-students" ||
    path.startsWith("/my-students/") ||
    path === "/academic-management" ||
    path.startsWith("/academic-management/") ||
    path === "/homework" ||
    path.startsWith("/homework/") ||
    path === "/exams" ||
    (path.startsWith("/exams/") && !path.startsWith("/exams-view")) ||
    path === "/attendance" ||
    (path.startsWith("/attendance/") && !path.startsWith("/attendance-view")) ||
    path === "/my-library" ||
    path === TEACHER_WORK_PATHS.timetable ||
    path === TEACHER_WORK_PATHS.laboratory
  );
};

export const isAdminWorkspacePath = (pathname: string): boolean => {
  const path = stripQuery(pathname);
  if (path === "/academic-management-view" || path.startsWith("/academic-management-view/")) {
    return true;
  }
  if (path === "/timetable-view" || path.startsWith("/timetable-view/")) return true;
  if (path === "/laboratory-view" || path.startsWith("/laboratory-view/")) return true;
  if (path === "/exams-view" || path.startsWith("/exams-view/")) return true;
  if (path === "/attendance-view" || path.startsWith("/attendance-view/")) return true;
  if (path === "/students" || path.startsWith("/students/")) return true;
  if (path === "/teachers" || path.startsWith("/teachers/")) return true;
  if (path === "/college-staff" || path.startsWith("/college-staff/")) return true;
  if (path === "/academics" || path.startsWith("/academics/")) return true;
  if (path === "/library" || path.startsWith("/library/")) return true;
  if (
    path === "/accounting" ||
    path === "/hr" ||
    path === "/settings" ||
    path === "/reports" ||
    path === "/parent-links" ||
    path === "/transport" ||
    path === "/finance"
  ) {
    return true;
  }
  return false;
};

export const userHasExtraAdminAccess = (
  user?: Pick<UserProfile, "moduleAccess" | "moduleAccessConfigured"> | null,
): boolean => {
  if (!user?.moduleAccessConfigured) return false;
  return hasExtraAdminModuleGrants((user.moduleAccess ?? {}) as ModuleAccessMap);
};

/**
 * Teacher who was also given Administration modules (Principal / Vice Principal
 * / Coordinator with extra access). They get two sidebars: My Work (own
 * subjects / students / assignments) and Administration (institution tools).
 */
export const isDualRoleTeacher = (
  user?: Pick<
    UserProfile,
    "role" | "secondaryRoles" | "designation" | "moduleAccess" | "moduleAccessConfigured"
  > | null,
): boolean => {
  if (!user || !userIsTeacher(user)) return false;
  if (isSystemAdministrator(user.role)) return false;
  return userHasExtraAdminAccess(user);
};

export const resolveWorkspaceMode = (
  pathname: string,
  user?: UserProfile | null,
): WorkspaceMode => {
  if (isAdminWorkspacePath(pathname)) return "admin";
  if (isTeacherWorkspacePath(pathname)) return "teacher";
  if (pathname === "/timetable" || pathname === "/laboratory") {
    if (userIsTeacher(user)) return "teacher";
    return "admin";
  }
  return "general";
};

export const useWorkspaceMode = (): WorkspaceMode => {
  const location = useLocation();
  if (isAdminWorkspacePath(location.pathname)) return "admin";
  if (isTeacherWorkspacePath(location.pathname)) return "teacher";
  return "general";
};

/** Attach to academic-management / student admin API calls from Administration. */
export const adminScopeParams = { adminScope: "1" as const };
