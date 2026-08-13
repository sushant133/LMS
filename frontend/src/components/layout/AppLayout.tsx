import { LogOut, Menu, PanelLeftClose, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  INSTITUTION_NAME,
  canAccessAcademicStructure,
  canAccessAttendanceManagement,
  canAccessExaminationManagement,
  canAccessModule,
  canManageInstitution,
  hasInstitutionAccess,
  isAcademicStructurePath,
  isAttendanceManagementPath,
  isExaminationManagementPath,
  isSystemAdministrator,
  normalizeUserRole,
  resolveModuleFromRoutePath,
  type ModuleAccessMap,
  type SchoolSettingsRecord,
  type UserRole,
} from "@phit-erp/shared";
import { ErrorBoundary } from "components/shared/ErrorBoundary";
import { LoadingState, PageLoadingState } from "components/shared/LoadingState";
import { ReadOnlyBanner } from "components/shared/ReadOnlyBanner";
import { useTranslation } from "react-i18next";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { cn } from "lib/utils";
import { appConfig } from "lib/config";
import { useAuth } from "features/auth/AuthProvider";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { useFieldCoordinatorAccess } from "hooks/useFieldCoordinatorAccess";
import { useParentPortalAccess } from "hooks/useParentPortalAccess";
import { useTeacherLabAccess } from "hooks/useTeacherLabAccess";
import {
  getCollegeDisplayName,
  getRoleRedirectPath,
  getUserDisplayTitle,
  getUserRoleSubtitle,
  roleLabelMap,
} from "lib/auth";
import {
  formatPrintAddress,
  setPrintInstitutionBranding,
} from "lib/printBranding";
import { redirectToLogin } from "lib/redirectToLogin";
import { resetAppShell } from "lib/resetAppShell";

/** Desktop sidebar collapsed preference (persists for all roles / pages). */
const SIDEBAR_HIDDEN_KEY = "lms.sidebarHidden";

const loadSidebarHidden = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};

const saveSidebarHidden = (hidden: boolean) => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
};

/** True when viewport is desktop (left menu is a sticky column, not a drawer). */
const useIsDesktopLayout = (): boolean => {
  const [isDesktop, setIsDesktop] = useState(() => {
    try {
      return typeof window !== "undefined"
        ? window.matchMedia("(min-width: 768px)").matches
        : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
};

const institutionRoles: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
];

/**
 * Roles that may appear in staff shell / general nav, but must NOT be bulk-added
 * to administration links they cannot open (ProtectedRoute / API would bounce them).
 */
const staffPortalRoles: UserRole[] = [
  ...institutionRoles,
  "TEACHER",
  "COLLEGE_STAFF",
  "ACCOUNTANT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL",
];

/**
 * Sidebar sections:
 * - general: always-available shared links
 * - myWork: personal / teaching / self-service modules
 * - administration: management modules (admin-granted or institution admin)
 */
type NavSection = "general" | "myWork" | "administration";

interface NavItem {
  /** i18n key for the display label */
  labelKey: string;
  path: string;
  roles: UserRole[];
  section: NavSection;
}

/**
 * Distinct labels avoid duplicates like "Attendance" twice for teacher-admins.
 * Personal items use "My …"; management items use "… Management".
 */
const navItems: NavItem[] = [
  // —— General ——
  {
    labelKey: "dashboard",
    path: "/dashboard",
    roles: [...staffPortalRoles, "STUDENT", "PARENT"],
    section: "general",
  },
  {
    labelKey: "notifications",
    path: "/notifications",
    roles: [...staffPortalRoles, "STUDENT", "PARENT"],
    section: "general",
  },
  {
    labelKey: "academicCalendar",
    path: "/academic-calendar",
    roles: [...staffPortalRoles, "STUDENT", "PARENT"],
    section: "general",
  },
  {
    labelKey: "notices",
    path: "/notices",
    roles: [
      ...institutionRoles,
      "TEACHER",
      "STUDENT",
      "PARENT",
      "COLLEGE_STAFF",
    ],
    section: "general",
  },
  {
    labelKey: "complains",
    path: "/complains",
    roles: [...staffPortalRoles, "STUDENT"],
    section: "general",
  },

  // —— My Work (personal / teaching / self-service) ——
  {
    labelKey: "myProfile",
    path: "/my-profile",
    roles: ["STUDENT"],
    section: "myWork",
  },
  {
    labelKey: "mySubjects",
    path: "/my-subjects",
    roles: ["STUDENT"],
    section: "myWork",
  },
  {
    labelKey: "parentPortal",
    path: "/parent-portal",
    roles: ["PARENT"],
    section: "myWork",
  },
  {
    labelKey: "myStudents",
    path: "/students",
    roles: ["TEACHER"],
    section: "myWork",
  },
  {
    labelKey: "myTimetable",
    path: "/timetable",
    roles: ["TEACHER", "STUDENT"],
    section: "myWork",
  },
  {
    labelKey: "myAssignments",
    path: "/homework",
    roles: ["TEACHER"],
    section: "myWork",
  },
  {
    labelKey: "myHomework",
    path: "/homework-view",
    roles: ["STUDENT", "PARENT"],
    section: "myWork",
  },
  {
    labelKey: "myAttendance",
    path: "/attendance",
    roles: ["TEACHER"],
    section: "myWork",
  },
  {
    labelKey: "parentAttendance",
    path: "/attendance",
    roles: ["PARENT"],
    section: "myWork",
  },
  {
    labelKey: "fieldManagement",
    path: "/field-management",
    roles: ["COLLEGE_STAFF"],
    section: "myWork",
  },
  {
    labelKey: "fieldAttendance",
    path: "/field-management",
    roles: ["STUDENT"],
    section: "myWork",
  },
  {
    labelKey: "myAcademicPlans",
    path: "/academic-management",
    roles: ["TEACHER"],
    section: "myWork",
  },
  {
    labelKey: "myExaminations",
    path: "/exams",
    roles: ["TEACHER", "STUDENT", "PARENT"],
    section: "myWork",
  },
  {
    labelKey: "myLibrary",
    path: "/my-library",
    roles: ["STUDENT", "TEACHER"],
    section: "myWork",
  },
  {
    labelKey: "myLaboratories",
    path: "/laboratory",
    roles: ["TEACHER", "LABORATORY_STAFF"],
    section: "myWork",
  },
  {
    labelKey: "myFees",
    path: "/my-fees",
    roles: ["STUDENT"],
    section: "myWork",
  },

  // —— Administration (roles must match App.tsx ProtectedRoute + backend authorize) ——
  {
    labelKey: "studentManagement",
    path: "/students",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "staffManagement",
    path: "/college-staff",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "academicStructure",
    path: "/academics",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "subjectAssignmentManagement",
    path: "/academics/subject-assignments",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "academicManagementAdmin",
    path: "/academic-management",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "timetableManagement",
    path: "/timetable",
    roles: [...institutionRoles, "PRINCIPAL"],
    section: "administration",
  },
  {
    labelKey: "attendanceManagement",
    path: "/attendance-view",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "fieldManagement",
    path: "/field-management",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "examinationManagement",
    path: "/exams-view",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "libraryManagement",
    path: "/library",
    roles: [...institutionRoles, "LIBRARY_STAFF"],
    section: "administration",
  },
  {
    labelKey: "laboratoryManagement",
    path: "/laboratory",
    roles: [...institutionRoles, "LABORATORY_STAFF"],
    section: "administration",
  },
  {
    labelKey: "accounting",
    path: "/accounting",
    roles: [
      ...institutionRoles,
      "ACCOUNTANT",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL",
    ],
    section: "administration",
  },
  {
    /**
     * Finance archive — Admin full view; College Administrator personal book;
     * Staff only when Admin grants personalFinanceAccess (filtered below).
     */
    labelKey: "financeManagement",
    path: "/finance",
    roles: [
      "SUPER_ADMIN",
      "COLLEGE_ADMIN",
      "COLLEGE_VIEWER",
      "COLLEGE_STAFF",
      "TEACHER",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "ACCOUNTANT",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL",
    ],
    section: "administration",
  },
  {
    labelKey: "transportManagement",
    path: "/transport",
    roles: [...institutionRoles, "COLLEGE_STAFF"],
    section: "administration",
  },
  {
    labelKey: "hrPayroll",
    path: "/hr",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "parentManagement",
    path: "/parent-links",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "reportsAnalytics",
    path: "/reports",
    roles: [...institutionRoles],
    section: "administration",
  },
  {
    labelKey: "settings",
    path: "/settings",
    roles: [...institutionRoles],
    section: "administration",
  },
];

/** System-level admin links (nested under Administration). */
const systemAdminItems: Array<{ labelKey: string; path: string; roles: UserRole[] }> = [
  { labelKey: "adminUsers", path: "/admin-management", roles: ["SUPER_ADMIN"] },
  {
    labelKey: "collegeAdministrators",
    path: "/college-administrators",
    roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"],
  },
];

const renderNavLink = (
  item: { labelKey: string; path: string; section?: string },
  label: string,
  onNavigate: () => void,
  useEnd: boolean,
  unreadCount: number,
) => (
  <NavLink
    key={`${item.section ?? "nav"}-${item.path}-${item.labelKey}`}
    to={item.path}
    end={useEnd}
    onClick={onNavigate}
    className={({ isActive }) =>
      cn(
        "flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition",
        isActive
          ? "bg-brand-500 text-white shadow-sm shadow-brand-900/20"
          : "text-slate-300 hover:bg-white/10 hover:text-white",
      )
    }
  >
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {item.path === "/notifications" ? (
      <span
        className={cn(
          "shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-amber-950 tabular-nums",
          unreadCount > 0 ? "visible" : "invisible",
        )}
        aria-hidden={unreadCount === 0}
      >
        {unreadCount > 0 ? unreadCount : 0}
      </span>
    ) : null}
  </NavLink>
);

export const AppLayout = () => {
  const isDesktop = useIsDesktopLayout();
  /** Mobile / tablet drawer open state (not persisted). */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /**
   * Desktop: collapse left column (persisted).
   * Shared by admin, superadmin, staff, teacher, student — every AppLayout page.
   */
  const [sidebarHidden, setSidebarHidden] = useState(() => loadSidebarHidden());
  const location = useLocation();
  const { user, logout, availableSchools } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const { t } = useTranslation();

  /** Settings name/address are preferred for print/PDF headers when available. */
  const printSettingsQuery = useQuery({
    queryKey: ["settings", "print-branding"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const setDesktopSidebarHidden = (hidden: boolean) => {
    setSidebarHidden(hidden);
    saveSidebarHidden(hidden);
    if (hidden) setMobileNavOpen(false);
  };

  /** Menu is currently on-screen (desktop column or mobile drawer). */
  const menuIsOpen = isDesktop ? !sidebarHidden : mobileNavOpen;

  /** Hide: desktop collapses column; mobile closes drawer. */
  const hideMenu = () => {
    if (isDesktop) {
      setDesktopSidebarHidden(true);
      return;
    }
    setMobileNavOpen(false);
  };

  /** Show: only needed when menu is hidden (button lives in the top bar). */
  const showMenu = () => {
    if (isDesktop) {
      setDesktopSidebarHidden(false);
      return;
    }
    setMobileNavOpen(true);
  };

  // Close mobile drawer on route change only (keep desktop hide preference).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const isTeacherUser =
    Boolean(user) &&
    (normalizeUserRole(user!.role) === "TEACHER" ||
      (user!.secondaryRoles ?? []).some(
        (role) => normalizeUserRole(role) === "TEACHER",
      ));
  const isStaffUser =
    Boolean(user) &&
    (normalizeUserRole(user!.role) === "COLLEGE_STAFF" ||
      (user!.secondaryRoles ?? []).some(
        (role) => normalizeUserRole(role) === "COLLEGE_STAFF",
      ));
  const teacherLabAccessQuery = useTeacherLabAccess(isTeacherUser);
  const teacherHasLaboratory =
    teacherLabAccessQuery.data?.hasLaboratoryAccess === true;
  const fieldCoordAccessQuery = useFieldCoordinatorAccess(isStaffUser);
  /** True when staff is assigned as primary/assistant coordinator on any posting. */
  const hasFieldCoordinatorAccess =
    fieldCoordAccessQuery.data?.hasCoordinatorAccess === true;
  /**
   * While the access probe is loading, keep the menu item visible for staff so it
   * does not flash away; after load, hide if neither assignment nor module grant.
   * Module Access "field-duty" (Field Management) is also checked once user map loads.
   */
  const staffMaySeeFieldManagement =
    hasFieldCoordinatorAccess ||
    (isStaffUser && fieldCoordAccessQuery.isLoading) ||
    (isStaffUser &&
      canAccessModule(
        (user?.moduleAccess ?? {}) as ModuleAccessMap,
        "field-duty",
      ));
  /** School-level parent portal section switches (Admin → Parent Management). */
  const parentPortalAccess = useParentPortalAccess();

  useEffect(() => {
    if (!mobileNavOpen) return;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const handleLogout = async () => {
    setMobileNavOpen(false);
    resetAppShell();
    try {
      await logout();
    } finally {
      redirectToLogin();
    }
  };

  // Returning null here painted a fully blank page whenever the session briefly read as
  // empty (ProtectedRoute is already redirecting by then) — show the shell loader instead.
  if (!user) {
    return <PageLoadingState />;
  }

  const normalizedRole = normalizeUserRole(user.role);
  const secondaryRoles = (user.secondaryRoles ?? []).map((role) =>
    normalizeUserRole(role),
  );
  const effectiveRoles = new Set<UserRole>([normalizedRole, ...secondaryRoles]);
  const hasAnyRole = (roles: UserRole[]) =>
    roles.some((role) => effectiveRoles.has(normalizeUserRole(role)));

  const institutionAccess = hasInstitutionAccess(normalizedRole);
  const isAdmin = canManageInstitution(normalizedRole);
  /** Super Admin never filtered by module matrix; Administrators may be. */
  const isUnrestrictedAdmin = isSystemAdministrator(normalizedRole);
  const moduleAccessMap = (user.moduleAccess ?? {}) as ModuleAccessMap;
  /** Custom map saved by admin — unlocks admin nav for staff/teachers with grants */
  const moduleAccessConfigured = Boolean(user.moduleAccessConfigured);
  const collegeName = getCollegeDisplayName(availableSchools, user);
  const showCollegeContext = !institutionAccess;

  /** Keep print/PDF headers in sync with current school name + address. */
  useEffect(() => {
    const school = availableSchools[0] ?? user?.school ?? null;
    const settings = printSettingsQuery.data;
    const name =
      settings?.schoolName?.trim() ||
      collegeName ||
      school?.name ||
      INSTITUTION_NAME;
    const nameNp =
      settings?.schoolNameNp?.trim() || school?.nameNp || undefined;
    const address =
      formatPrintAddress(settings?.address) ||
      formatPrintAddress(school?.address);
    setPrintInstitutionBranding({
      name,
      nameNp,
      address,
    });
  }, [
    availableSchools,
    collegeName,
    user?.school,
    printSettingsQuery.data,
  ]);

  /**
   * Modules that power a teacher's "My Work" tools.
   * These must NOT open the Administration section for a pure teacher —
   * otherwise the same pages appear twice (My Students + Student Management).
   */
  const TEACHING_MY_WORK_MODULES = new Set([
    "students",
    "attendance",
    "daily-attendance",
    "academic-management",
    "timetable",
    "examinations",
    "results",
    "homework",
    "library",
    "laboratory",
    "notices",
    "academic-calendar",
    "complaints",
    "dashboard",
    "profile",
  ]);

  const hasTeachingCapability =
    effectiveRoles.has("TEACHER") || isTeacherUser;
  /** Real management / office roles (not teaching baseline). */
  const hasAdminCapability =
    isAdmin ||
    institutionAccess ||
    effectiveRoles.has("PRINCIPAL") ||
    effectiveRoles.has("COLLEGE_STAFF") ||
    effectiveRoles.has("LIBRARY_STAFF") ||
    effectiveRoles.has("LABORATORY_STAFF") ||
    effectiveRoles.has("ACCOUNTANT") ||
    effectiveRoles.has("CASHIER") ||
    effectiveRoles.has("AUDITOR");

  /** Explicit department grant (not legacy unconfigured full access) */
  const hasExplicitModuleGrant = (path: string): boolean => {
    if (!moduleAccessConfigured) return false;
    // Academic Structure: own visibility module, never inherited from `academics`
    if (isAcademicStructurePath(path)) {
      return canAccessAcademicStructure(moduleAccessMap);
    }
    // Teacher / Staff Attendance module grants unlock Attendance Management hub
    if (
      isAttendanceManagementPath(path) &&
      canAccessAttendanceManagement(moduleAccessMap)
    ) {
      return true;
    }
    // Examination — College and/or CTEVT unlock Examination Management hub
    if (
      isExaminationManagementPath(path) &&
      canAccessExaminationManagement(moduleAccessMap)
    ) {
      return true;
    }
    const moduleKey = resolveModuleFromRoutePath(path);
    if (!moduleKey) return false;
    return canAccessModule(moduleAccessMap, moduleKey);
  };

  /**
   * Unlock an Administration menu item via Module Access.
   * Pure teachers: only non-teaching departments (Settings, Reports, Accounting…).
   * Teaching modules stay under My Work only.
   */
  const hasExplicitAdminNavGrant = (path: string): boolean => {
    if (!hasExplicitModuleGrant(path)) return false;
    const moduleKey = resolveModuleFromRoutePath(path);
    if (!moduleKey) return false;
    if (
      hasTeachingCapability &&
      !hasAdminCapability &&
      TEACHING_MY_WORK_MODULES.has(moduleKey)
    ) {
      return false;
    }
    return true;
  };

  const isModuleAllowedForNav = (path: string): boolean => {
    if (isUnrestrictedAdmin) return true;

    // Parents: school-level portal access matrix (Parent Management)
    if (effectiveRoles.has("PARENT") && normalizedRole === "PARENT") {
      if (path.startsWith("/dashboard")) return true;
      // While loading, show full parent menu to avoid flicker; API still enforces data.
      if (parentPortalAccess.isLoading) return true;
      return parentPortalAccess.canAccessPath(path);
    }

    if (
      path.startsWith("/dashboard") ||
      path === "/notifications" ||
      path === "/my-profile" ||
      path === "/profile" ||
      path === "/my-subjects" ||
      path === "/my-fees" ||
      path === "/my-library" ||
      path === "/parent-portal"
    ) {
      return true;
    }
    // Field Management: assigned coordinators always see it (even without module matrix)
    if (path === "/field-management" || path.startsWith("/field-management/")) {
      if (effectiveRoles.has("STUDENT")) return true;
      if (staffMaySeeFieldManagement || hasFieldCoordinatorAccess) return true;
      return canAccessModule(moduleAccessMap, "field-duty");
    }
    // Academic Structure screen: hidden unless its own toggle is on.
    // Academic data stays readable for fee/exam/attendance pickers either way.
    if (isAcademicStructurePath(path)) {
      if (!moduleAccessConfigured) return isAdmin || institutionAccess;
      return canAccessAcademicStructure(moduleAccessMap);
    }
    if (isAttendanceManagementPath(path)) {
      // Teachers always keep My Attendance; HR teacher/staff attendance is via grants
      if (hasTeachingCapability && path === "/attendance") return true;
      if (!moduleAccessConfigured) return hasAdminCapability || hasTeachingCapability;
      return canAccessAttendanceManagement(moduleAccessMap);
    }
    if (isExaminationManagementPath(path)) {
      // Admin hub only — not My Examinations (/exams)
      if (isUnrestrictedAdmin) return true;
      if (!moduleAccessConfigured) {
        return isAdmin || institutionAccess || effectiveRoles.has("COLLEGE_VIEWER");
      }
      return canAccessExaminationManagement(moduleAccessMap);
    }
    const moduleKey = resolveModuleFromRoutePath(path);
    if (!moduleKey) return true;
    if (moduleKey === "profile") return true;
    // Teaching role: always show My Work teaching paths even if a custom
    // module map was saved with Hidden for admin sections only.
    if (
      hasTeachingCapability &&
      (path === "/academic-management" ||
        path === "/homework" ||
        path === "/timetable" ||
        path === "/exams" ||
        path === "/students" ||
        path === "/my-library" ||
        path === "/laboratory" ||
        path === "/notices" ||
        path === "/academic-calendar" ||
        path === "/complains")
    ) {
      return true;
    }
    return canAccessModule(moduleAccessMap, moduleKey);
  };

  const resolveDashboardPath = (): string => {
    if (normalizedRole === "COLLEGE_VIEWER") return "/dashboard/college_admin";
    return `/dashboard/${normalizedRole.toLowerCase()}`;
  };

  /**
   * Deduplicate same path across My Work vs Administration for multi-role users.
   * Prefer Administration when user has admin capability for that path;
   * otherwise keep My Work.
   */
  const filteredItems = useMemo(() => {
    const roleMatched = navItems
      .filter((item) => {
        // Role match OR explicit admin-department grant unlocks Administration
        if (hasAnyRole(item.roles)) return true;
        if (
          item.section === "administration" &&
          hasExplicitAdminNavGrant(item.path)
        ) {
          return true;
        }
        return false;
      })
      .filter((item) => {
        // Lab: teachers only if assigned (unless lab staff / unrestricted admin)
        if (item.path === "/laboratory") {
          if (isUnrestrictedAdmin || effectiveRoles.has("LABORATORY_STAFF")) {
            return true;
          }
          if (hasExplicitAdminNavGrant(item.path)) return true;
          if (item.section === "myWork") {
            return hasTeachingCapability && teacherHasLaboratory;
          }
          return isModuleAllowedForNav(item.path);
        }
        // Field Management: staff only when assigned as primary/assistant coordinator
        // (or module grant); students always get Field Attendance entry
        if (item.path === "/field-management") {
          if (isAdmin || institutionAccess) {
            return isModuleAllowedForNav(item.path);
          }
          if (effectiveRoles.has("STUDENT")) return true;
          if (hasExplicitAdminNavGrant(item.path)) return true;
          if (effectiveRoles.has("COLLEGE_STAFF")) {
            return (
              staffMaySeeFieldManagement ||
              hasFieldCoordinatorAccess ||
              canAccessModule(moduleAccessMap, "field-duty")
            );
          }
          return isModuleAllowedForNav(item.path);
        }
        // Finance: never show for staff unless Admin granted personalFinanceAccess
        if (item.path === "/finance") {
          if (isUnrestrictedAdmin) return true;
          if (isAdmin || institutionAccess || effectiveRoles.has("COLLEGE_VIEWER")) {
            return isModuleAllowedForNav(item.path);
          }
          return Boolean(user?.personalFinanceAccess);
        }
        return isModuleAllowedForNav(item.path);
      })
      .map((item) => ({
        ...item,
        path:
          item.path === "/dashboard" ? resolveDashboardPath() : item.path,
      }));

    // Multi-role path collision: same path in myWork + administration
    // Pure teacher → always keep My Work label (My Students, not Student Management)
    const byPath = new Map<string, NavItem[]>();
    for (const item of roleMatched) {
      const list = byPath.get(item.path) ?? [];
      list.push(item);
      byPath.set(item.path, list);
    }

    const result: NavItem[] = [];
    for (const [, group] of byPath) {
      if (group.length === 1) {
        result.push(group[0]!);
        continue;
      }
      const adminItem = group.find((g) => g.section === "administration");
      const workItem = group.find((g) => g.section === "myWork");
      const generalItem = group.find((g) => g.section === "general");
      if (generalItem) {
        result.push(generalItem);
        continue;
      }
      // Prefer My Work for teaching-only users when both exist
      if (
        workItem &&
        hasTeachingCapability &&
        !hasAdminCapability
      ) {
        result.push(workItem);
        continue;
      }
      if (
        adminItem &&
        ((hasAdminCapability && hasAnyRole(adminItem.roles)) ||
          hasExplicitAdminNavGrant(adminItem.path))
      ) {
        result.push(adminItem);
        continue;
      }
      if (workItem) {
        result.push(workItem);
        continue;
      }
      result.push(group[0]!);
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- role/module maps drive visibility
  }, [
    normalizedRole,
    secondaryRoles.join(","),
    teacherHasLaboratory,
    hasFieldCoordinatorAccess,
    staffMaySeeFieldManagement,
    moduleAccessConfigured,
    isAdmin,
    isUnrestrictedAdmin,
    parentPortalAccess.isLoading,
    JSON.stringify(parentPortalAccess.modules),
    JSON.stringify(moduleAccessMap),
    hasTeachingCapability,
    hasAdminCapability,
  ]);

  const generalItems = filteredItems.filter((i) => i.section === "general");
  const myWorkItems = filteredItems.filter((i) => i.section === "myWork");
  const adminNavItems = filteredItems.filter(
    (i) => i.section === "administration",
  );

  const visibleSystemAdminItems = systemAdminItems.filter(
    (item) => hasAnyRole(item.roles) && isModuleAllowedForNav(item.path),
  );
  const showAdminSection =
    adminNavItems.length > 0 || visibleSystemAdminItems.length > 0;
  const showMyWorkSection = myWorkItems.length > 0;

  const allNavPaths = filteredItems.map((item) => item.path);
  const navLinkUsesEnd = (path: string): boolean => {
    if (path === "/notifications" || path === "/notices") return true;
    return allNavPaths.some(
      (other) => other !== path && other.startsWith(`${path}/`),
    );
  };

  const brandHomePath =
    generalItems.find((item) => item.labelKey === "dashboard")?.path ??
    getRoleRedirectPath(normalizedRole) ??
    "/dashboard";

  const closeMobile = () => setMobileNavOpen(false);

  const sectionHeader = (label: string) => (
    <p className="mb-2 mt-1 px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      {label}
    </p>
  );

  /**
   * Parents see "Homework" / "Examination" (not "My Homework" / "My Examinations")
   * — labels refer to their children's schoolwork, not personal "my" items.
   */
  const resolveNavLabel = (labelKey: string): string => {
    if (normalizedRole === "PARENT") {
      if (labelKey === "myHomework") return t("parentHomework");
      if (labelKey === "myExaminations") return t("parentExaminations");
      if (labelKey === "parentAttendance" || labelKey === "myAttendance") {
        return t("parentAttendance");
      }
    }
    return t(labelKey);
  };

  const navTree = (
    <>
      {/* General */}
      {generalItems.length > 0 ? (
        <div className="space-y-1">
          {generalItems.map((item) =>
            renderNavLink(
              item,
              resolveNavLabel(item.labelKey),
              closeMobile,
              navLinkUsesEnd(item.path),
              unreadCount,
            ),
          )}
        </div>
      ) : null}

      {/* My Work */}
      {showMyWorkSection ? (
        <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
          {sectionHeader(t("myWork"))}
          {myWorkItems.map((item) =>
            renderNavLink(
              item,
              resolveNavLabel(item.labelKey),
              closeMobile,
              navLinkUsesEnd(item.path),
              unreadCount,
            ),
          )}
        </div>
      ) : null}

      {/* Administration */}
      {showAdminSection ? (
        <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
          {sectionHeader(t("administration"))}
          {adminNavItems.map((item) =>
            renderNavLink(
              item,
              t(item.labelKey),
              closeMobile,
              navLinkUsesEnd(item.path),
              unreadCount,
            ),
          )}
          {visibleSystemAdminItems.map((item) =>
            renderNavLink(
              { ...item, labelKey: item.labelKey },
              t(item.labelKey),
              closeMobile,
              true,
              unreadCount,
            ),
          )}
        </div>
      ) : null}
    </>
  );

  const desktopMenuCollapsed = isDesktop && sidebarHidden;

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(12,45,107,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[55] bg-slate-950/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div
        className="app-shell"
        data-sidebar-collapsed={desktopMenuCollapsed ? "true" : "false"}
      >
        <aside
          id="app-main-sidebar"
          className="app-sidebar"
          data-desktop-hidden={sidebarHidden ? "true" : "false"}
          data-mobile-open={mobileNavOpen ? "true" : "false"}
          aria-label="Main navigation"
          aria-hidden={desktopMenuCollapsed ? true : undefined}
        >
          {/* Sidebar brand — always PHIT COLLEGE first (mobile-app style) */}
          <div className="app-sidebar-brand flex shrink-0 items-start gap-2">
            <NavLink
              to={brandHomePath}
              onClick={closeMobile}
              title={`${appConfig.appName} — Dashboard`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <div className="shrink-0 rounded-2xl bg-white/10 p-2 ring-1 ring-white/10">
                <CollegeLogo variant="light" className="h-9 w-9 sm:h-10 sm:w-10" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold tracking-tight text-white sm:text-lg">
                  {t("appName")}
                </h2>
                <p
                  className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400"
                  title={collegeName || INSTITUTION_NAME}
                >
                  {showCollegeContext ? INSTITUTION_NAME : collegeName}
                </p>
              </div>
            </NavLink>
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 hover:text-white md:h-9 md:w-9"
              aria-label={isDesktop ? "Hide menu" : "Close menu"}
              title={isDesktop ? "Hide menu" : "Close menu"}
              onClick={hideMenu}
            >
              {isDesktop ? (
                <PanelLeftClose className="h-5 w-5" />
              ) : (
                <X className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Mobile drawer: signed-in user strip under brand */}
          <div className="mt-4 shrink-0 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 md:hidden">
            <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
            <p className="truncate text-xs text-slate-400">
              {getUserDisplayTitle(user)}
              {getUserRoleSubtitle(user) ? ` · ${getUserRoleSubtitle(user)}` : ""}
            </p>
          </div>

          <div className="app-sidebar-scroll mt-5 min-h-0 flex-1 md:mt-8">
            <nav className="space-y-1 pr-1">{navTree}</nav>

            <div className="mt-4 hidden pt-4 md:block">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {getUserDisplayTitle(user)}
                  {getUserRoleSubtitle(user)
                    ? ` · ${getUserRoleSubtitle(user)}`
                    : ""}
                </p>
                <p className="mt-2 truncate font-semibold">{user.fullName}</p>
                <p className="truncate text-sm text-slate-300">{user.email}</p>
                {showCollegeContext ? (
                  <p className="mt-2 truncate text-xs text-slate-400">
                    {collegeName}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <div className="app-shell-main">
          {/* Sticky app bar — PHIT COLLEGE brand first on mobile */}
          <header className="app-topbar sticky top-0 z-40 shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
            <div className="app-shell-header-inner flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3 lg:px-8 lg:py-4">
              {/* Mobile: always-visible menu toggle (app-style hamburger) */}
              {!isDesktop ? (
                <button
                  type="button"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm active:bg-slate-50"
                  aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                  title={mobileNavOpen ? "Close menu" : "Open menu"}
                  aria-controls="app-main-sidebar"
                  aria-expanded={mobileNavOpen}
                  onClick={() =>
                    mobileNavOpen ? setMobileNavOpen(false) : showMenu()
                  }
                >
                  {mobileNavOpen ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Menu className="h-5 w-5" />
                  )}
                </button>
              ) : null}

              {/* Desktop: show menu only when the left column is collapsed */}
              {isDesktop && !menuIsOpen ? (
                <button
                  type="button"
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                  aria-label="Show menu"
                  title="Show menu"
                  aria-controls="app-main-sidebar"
                  onClick={showMenu}
                >
                  <Menu className="h-4 w-4 shrink-0" />
                  <span>Show menu</span>
                </button>
              ) : null}

              {/* Brand block: PHIT COLLEGE primary on mobile (never the long legal name) */}
              <NavLink
                to={brandHomePath}
                onClick={closeMobile}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                title={`${appConfig.appName} — Dashboard`}
              >
                <div className="shrink-0 rounded-xl bg-brand-50 p-1 ring-1 ring-brand-100 md:hidden">
                  <CollegeLogo className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                  {isDesktop ? (
                    <>
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                        {t("welcome")}
                      </p>
                      <h1 className="truncate text-base font-semibold leading-tight text-slate-900 sm:text-lg">
                        {user.fullName}
                      </h1>
                    </>
                  ) : (
                    <>
                      <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight text-brand-800 sm:text-base">
                        {t("appName")}
                      </h1>
                      <p className="truncate text-xs font-medium leading-snug text-slate-500">
                        {user.fullName}
                        <span className="text-slate-400">
                          {" "}
                          · {getUserDisplayTitle(user)}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              </NavLink>

              {isDesktop ? (
                <div className="hidden min-w-0 max-w-[12rem] items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-sm shadow-sm sm:flex lg:max-w-[16rem]">
                  <CollegeLogo className="h-8 w-8 shrink-0" />
                  <div className="min-w-0">
                    <div
                      className="truncate font-semibold leading-tight text-brand-950"
                      title={appConfig.appName}
                    >
                      {t("appName")}
                    </div>
                    <div className="truncate text-[10px] font-medium uppercase tracking-wide text-brand-700/80">
                      {getUserDisplayTitle(user)}
                      {getUserRoleSubtitle(user)
                        ? ` · ${getUserRoleSubtitle(user)}`
                        : ""}
                    </div>
                  </div>
                </div>
              ) : null}

              <Button
                type="button"
                className="h-11 w-11 shrink-0 gap-0 rounded-2xl px-0 sm:h-9 sm:w-auto sm:gap-2 sm:rounded-xl sm:px-3"
                variant="outline"
                size="sm"
                onClick={() => void handleLogout()}
                aria-label={t("logout")}
                title={t("logout")}
              >
                <span className="inline-flex items-center justify-center">
                  <LogOut className="h-4 w-4" />
                </span>
                <span className="hidden sm:inline">{t("logout")}</span>
              </Button>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="app-shell-main-inner min-w-0">
              <ReadOnlyBanner />
              {/* Keyed on the path so leaving a broken section clears the error by itself.
                  Outside Suspense so it also catches lazy-chunk load failures. */}
              <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<LoadingState />}>
                {(() => {
                  // Super Admin unrestricted; Administrators honor module matrix when configured
                  if (!isUnrestrictedAdmin) {
                    const path = location.pathname;
                    const alwaysOk =
                      path.startsWith("/dashboard") ||
                      path === "/notifications" ||
                      path === "/my-profile" ||
                      path === "/profile" ||
                      path === "/my-subjects" ||
                      path === "/my-fees" ||
                      path === "/my-library" ||
                      path === "/parent-portal";
                    // Assigned field coordinators may open Field Management without module matrix
                    const fieldOk =
                      (path === "/field-management" ||
                        path.startsWith("/field-management/")) &&
                      (hasFieldCoordinatorAccess ||
                        staffMaySeeFieldManagement ||
                        effectiveRoles.has("STUDENT") ||
                        canAccessModule(moduleAccessMap, "field-duty"));
                    if (!alwaysOk && !fieldOk) {
                      // Teacher/Staff Attendance grants unlock the shared Attendance Management routes
                      if (
                        isAttendanceManagementPath(path) &&
                        (canAccessAttendanceManagement(moduleAccessMap) ||
                          (hasTeachingCapability && path === "/attendance"))
                      ) {
                        // allowed
                      } else {
                        const moduleKey = resolveModuleFromRoutePath(path);
                        if (
                          moduleKey &&
                          moduleKey !== "profile" &&
                          moduleKey !== "dashboard" &&
                          !canAccessModule(moduleAccessMap, moduleKey)
                        ) {
                          return (
                            <Navigate
                              to={
                                normalizedRole === "COLLEGE_VIEWER"
                                  ? "/dashboard/college_admin"
                                  : `/dashboard/${normalizedRole.toLowerCase()}`
                              }
                              replace
                            />
                          );
                        }
                      }
                    }
                  }
                  return <Outlet />;
                })()}
              </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
