import {
  normalizeUserRole,
  type ModuleAccessMap,
  type UserRole,
} from "@phit-erp/shared";
import { hasProtectedRouteAccess } from "lib/roles";

/**
 * Which section a notification opens when tapped in the inbox.
 *
 * `metadata.path` from the backend always wins. Otherwise the notification type maps
 * to a list of candidate pages (most specific first) and the first one the user can
 * actually open is used — students, parents, teachers and staff see the same module
 * under different routes.
 */

const ALL_PORTAL: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "COLLEGE_STAFF",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL",
];
const ADMINS: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"];
const FINANCE_DESK: UserRole[] = [...ADMINS, "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"];

/** Mirrors the ProtectedRoute role lists in App.tsx for the pages used below. */
const ROUTE_ROLES: Record<string, UserRole[]> = {
  "/notices": [...ADMINS, "TEACHER", "STUDENT", "PARENT", "COLLEGE_STAFF"],
  "/homework": ["TEACHER"],
  "/homework-view": [...ADMINS, "TEACHER", "STUDENT", "PARENT"],
  "/exams": [...ADMINS, "TEACHER", "STUDENT", "PARENT"],
  "/exams-view": [...FINANCE_DESK, "COLLEGE_STAFF", "TEACHER"],
  "/academic-calendar": ALL_PORTAL,
  "/my-profile": ["STUDENT"],
  "/my-fees": ["STUDENT"],
  "/my-library": ["STUDENT", "TEACHER"],
  "/parent-portal": ["PARENT"],
  "/attendance": ALL_PORTAL.filter((role) => role !== "STUDENT"),
  "/attendance-view": ALL_PORTAL.filter((role) => role !== "STUDENT" && role !== "PARENT"),
  "/library": [...ADMINS, "LIBRARY_STAFF"],
  "/laboratory": [...ADMINS, "LABORATORY_STAFF", "TEACHER"],
  "/laboratory-view": [...ADMINS, "LABORATORY_STAFF", "TEACHER"],
  "/accounting": FINANCE_DESK,
  "/complains": ALL_PORTAL.filter((role) => role !== "PARENT"),
  "/academics": ADMINS,
  "/hr": ADMINS,
  "/transport": [...ADMINS, "COLLEGE_STAFF"],
  "/academic-management": [...ADMINS, "TEACHER", "COLLEGE_STAFF", "PRINCIPAL"],
  "/academic-management-view": [...ADMINS, "TEACHER", "COLLEGE_STAFF", "PRINCIPAL"],
};

const TYPE_CANDIDATES: Record<string, string[]> = {
  NOTICE: ["/notices"],
  HOMEWORK: ["/homework", "/homework-view"],
  EXAM: ["/exams-view", "/exams"],
  ACADEMIC_CALENDAR: ["/academic-calendar"],
  ATTENDANCE: ["/attendance-view", "/attendance", "/parent-portal", "/my-profile"],
  FEE: ["/my-fees", "/parent-portal", "/accounting"],
  LIBRARY: ["/library", "/my-library"],
  LABORATORY: ["/laboratory-view", "/laboratory"],
  COMPLAINT: ["/complains"],
  ACADEMIC_MANAGEMENT: ["/academic-management-view", "/academic-management"],
  ACADEMIC_PROMOTION: ["/academics", "/my-profile", "/parent-portal"],
  PAYROLL: ["/hr"],
  TRANSPORT: ["/transport", "/parent-portal"],
};

/** Roles that should prefer their personal page over the admin workspace page. */
const PERSONAL_FIRST: Record<string, string[]> = {
  TEACHER: ["/exams", "/academic-management", "/attendance", "/laboratory", "/my-library"],
};

export interface NotificationTargetUser {
  role: string;
  secondaryRoles?: string[];
  moduleAccess?: unknown;
  moduleAccessConfigured?: boolean;
  designation?: string | null;
}

const isSafeInternalPath = (path: unknown): path is string =>
  typeof path === "string" && path.startsWith("/") && !path.startsWith("//");

export const resolveNotificationTarget = (
  notification: { type: string; metadata?: Record<string, string> | null },
  user: NotificationTargetUser | null | undefined,
): string | null => {
  const explicit = notification.metadata?.path;
  if (isSafeInternalPath(explicit)) return explicit;
  if (!user) return null;

  const role = normalizeUserRole(user.role);
  const candidates = [...(TYPE_CANDIDATES[notification.type] ?? [])];
  const preferred = PERSONAL_FIRST[role] ?? [];
  candidates.sort(
    (a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)),
  );

  return (
    candidates.find((path) =>
      hasProtectedRouteAccess(role, ROUTE_ROLES[path], user.secondaryRoles, {
        pathname: path,
        moduleAccess: (user.moduleAccess ?? {}) as ModuleAccessMap,
        moduleAccessConfigured: Boolean(user.moduleAccessConfigured),
        designation: user.designation,
      }),
    ) ?? null
  );
};

/** The full-size image attached to a notification, if any. */
export const notificationImage = (
  metadata?: Record<string, string> | null,
): { full: string; thumb: string } | null => {
  const full = metadata?.imageUrl || metadata?.thumbnailUrl;
  if (!full) return null;
  return { full, thumb: metadata?.thumbnailUrl || full };
};
