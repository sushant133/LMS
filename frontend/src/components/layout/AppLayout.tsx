import { LogOut, Menu } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { ReadOnlyBanner } from "components/shared/ReadOnlyBanner";
import { useTranslation } from "react-i18next";
import {
  INSTITUTION_NAME,
  canAccessModule,
  canManageInstitution,
  hasInstitutionAccess,
  normalizeUserRole,
  resolveModuleFromRoutePath,
  type ModuleAccessMap,
  type UserRole,
} from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { useTeacherLabAccess } from "hooks/useTeacherLabAccess";
import {
  getCollegeDisplayName,
  getRoleRedirectPath,
  getUserDisplayTitle,
  getUserRoleSubtitle,
  roleLabelMap,
} from "lib/auth";
import { redirectToLogin } from "lib/redirectToLogin";
import { resetAppShell } from "lib/resetAppShell";

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
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user, logout, availableSchools } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const { t } = useTranslation();
  const isTeacherUser =
    Boolean(user) &&
    (normalizeUserRole(user!.role) === "TEACHER" ||
      (user!.secondaryRoles ?? []).some(
        (role) => normalizeUserRole(role) === "TEACHER",
      ));
  const teacherLabAccessQuery = useTeacherLabAccess(isTeacherUser);
  const teacherHasLaboratory =
    teacherLabAccessQuery.data?.hasLaboratoryAccess === true;

  useEffect(() => {
    if (!open) return;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    resetAppShell();
    try {
      await logout();
    } finally {
      redirectToLogin();
    }
  };

  if (!user) {
    return null;
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
  const moduleAccessMap = (user.moduleAccess ?? {}) as ModuleAccessMap;
  const collegeName = getCollegeDisplayName(availableSchools, user);
  const showCollegeContext = !institutionAccess;

  const hasTeachingCapability =
    effectiveRoles.has("TEACHER") || isTeacherUser;
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
  // hasAdminCapability still used for myWork vs administration path de-dupe only

  const isModuleAllowedForNav = (path: string): boolean => {
    if (isAdmin) return true;
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
    const moduleKey = resolveModuleFromRoutePath(path);
    if (!moduleKey) return true;
    if (moduleKey === "profile") return true;
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
      .filter((item) => hasAnyRole(item.roles))
      .filter((item) => {
        // Lab: teachers only if assigned (unless lab staff / admin)
        if (item.path === "/laboratory") {
          if (isAdmin || effectiveRoles.has("LABORATORY_STAFF")) return true;
          if (item.section === "myWork") {
            return hasTeachingCapability && teacherHasLaboratory;
          }
          // administration laboratory without lab role: need module access only
          return isModuleAllowedForNav(item.path);
        }
        return isModuleAllowedForNav(item.path);
      })
      .map((item) => ({
        ...item,
        path:
          item.path === "/dashboard" ? resolveDashboardPath() : item.path,
      }));

    // Multi-role path collision: same path in myWork + administration
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
      // Prefer administration when user has management roles; else my work
      const adminItem = group.find((g) => g.section === "administration");
      const workItem = group.find((g) => g.section === "myWork");
      const generalItem = group.find((g) => g.section === "general");
      if (generalItem) {
        result.push(generalItem);
        continue;
      }
      if (adminItem && hasAdminCapability && hasAnyRole(adminItem.roles)) {
        // Multi-role: show management label under Administration only
        result.push(adminItem);
        // If they also teach, keep personal-only items that share path only once
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
    isAdmin,
    JSON.stringify(moduleAccessMap),
    hasTeachingCapability,
    hasAdminCapability,
  ]);

  const generalItems = filteredItems.filter((i) => i.section === "general");
  const myWorkItems = filteredItems.filter((i) => i.section === "myWork");
  const adminNavItems = filteredItems.filter(
    (i) => i.section === "administration",
  );

  const visibleSystemAdminItems = systemAdminItems.filter((item) =>
    hasAnyRole(item.roles),
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

  const closeMobile = () => setOpen(false);

  const sectionHeader = (label: string) => (
    <p className="mb-2 mt-1 px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      {label}
    </p>
  );

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(12,45,107,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-slate-950/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div key={user._id} className="flex min-h-screen w-full">
        <aside
          className={cn(
            "flex w-[var(--app-sidebar-width)] shrink-0 flex-col overflow-hidden border-r border-white/60 bg-slate-950/95 px-5 py-6 text-white",
            "h-[100dvh] md:h-screen",
            "max-md:fixed max-md:left-0 max-md:top-0 max-md:z-50 max-md:transition-transform max-md:duration-200",
            open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
            "md:sticky md:top-0 md:z-30 md:translate-x-0",
          )}
        >
          <div className="shrink-0">
            <NavLink
              to={brandHomePath}
              onClick={closeMobile}
              title="Go to dashboard"
              className="flex cursor-pointer items-center gap-3 rounded-2xl outline-none"
            >
              <div className="rounded-2xl bg-white/10 p-2">
                <CollegeLogo variant="light" className="h-10 w-10" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold leading-tight">
                  {t("appName")}
                </h2>
                {showCollegeContext ? (
                  <p className="truncate text-xs text-slate-400">
                    {INSTITUTION_NAME}
                  </p>
                ) : null}
              </div>
            </NavLink>
          </div>

          <div className="app-sidebar-scroll mt-8 min-h-0 flex-1">
            <nav className="space-y-1 pr-1">
              {/* General */}
              {generalItems.length > 0 ? (
                <div className="space-y-1">
                  {generalItems.map((item) =>
                    renderNavLink(
                      item,
                      t(item.labelKey),
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
                      t(item.labelKey),
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
            </nav>

            <div className="mt-4 pt-4">
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

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 shrink-0 border-b border-white/70 bg-white/90 backdrop-blur">
            <div className="mx-auto w-full max-w-[1600px] px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 md:hidden"
                    onClick={() => setOpen((current) => !current)}
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-600">
                      {t("welcome")}
                    </p>
                    <h1 className="truncate text-lg font-semibold text-slate-900">
                      {user.fullName}
                    </h1>
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex min-w-0 max-w-[10rem] items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-sm shadow-sm sm:max-w-xs md:max-w-sm">
                    <CollegeLogo className="h-8 w-8 shrink-0" />
                    <div className="min-w-0">
                      <div
                        className="truncate font-semibold leading-tight text-brand-950"
                        title={collegeName}
                      >
                        {collegeName}
                      </div>
                      <div
                        className="text-[10px] font-medium uppercase tracking-widest text-brand-700/80"
                        title={
                          getUserRoleSubtitle(user)
                            ? `${getUserDisplayTitle(user)} · ${getUserRoleSubtitle(user)}`
                            : getUserDisplayTitle(user)
                        }
                      >
                        {getUserDisplayTitle(user)}
                      </div>
                    </div>
                  </div>
                  <Button
                    className="shrink-0"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleLogout()}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("logout")}
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-clip px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto min-w-0 w-full max-w-[1600px]">
              <ReadOnlyBanner />
              <Suspense fallback={<LoadingState />}>
                {(() => {
                  if (!isAdmin) {
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
                    if (!alwaysOk) {
                      const moduleKey = resolveModuleFromRoutePath(path);
                      if (
                        moduleKey &&
                        moduleKey !== "profile" &&
                        moduleKey !== "dashboard" &&
                        !canAccessModule(moduleAccessMap, moduleKey)
                      ) {
                        return (
                          <Navigate
                            to={`/dashboard/${normalizedRole.toLowerCase()}`}
                            replace
                          />
                        );
                      }
                    }
                  }
                  return <Outlet />;
                })()}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
