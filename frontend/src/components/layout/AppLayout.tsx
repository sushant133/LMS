import { LogOut, Menu } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { ReadOnlyBanner } from "components/shared/ReadOnlyBanner";
import { useTranslation } from "react-i18next";
import { INSTITUTION_NAME, hasInstitutionAccess, normalizeUserRole, type UserRole } from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { getCollegeDisplayName, getRoleRedirectPath, roleLabelMap } from "lib/auth";
import { redirectToLogin } from "lib/redirectToLogin";
import { resetAppShell } from "lib/resetAppShell";

const institutionRoles: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"];

const navItems: Array<{ labelKey: string; path: string; roles: UserRole[] }> = [
  {
    labelKey: "dashboard",
    path: "/dashboard",
    roles: [
      ...institutionRoles,
      "TEACHER",
      "STUDENT",
      "PARENT",
      "COLLEGE_STAFF",
      "ACCOUNTANT",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL"
    ]
  },
  { labelKey: "myProfile", path: "/my-profile", roles: ["STUDENT"] },
  { labelKey: "mySubjects", path: "/my-subjects", roles: ["STUDENT"] },
  { labelKey: "parentPortal", path: "/parent-portal", roles: ["PARENT"] },
  { labelKey: "students", path: "/students", roles: [...institutionRoles, "TEACHER"] },
  // Teachers are managed under College Staff → Teachers tab (no separate sidebar item)
  { labelKey: "collegeStaff", path: "/college-staff", roles: institutionRoles },
  { labelKey: "academics", path: "/academics", roles: institutionRoles },
  { labelKey: "subjectAssignment", path: "/academics/subject-assignments", roles: institutionRoles },
  { labelKey: "academicManagement", path: "/academic-management", roles: [...institutionRoles, "TEACHER"] },
  {
    labelKey: "academicCalendar",
    path: "/academic-calendar",
    roles: [
      ...institutionRoles,
      "TEACHER",
      "STUDENT",
      "PARENT",
      "COLLEGE_STAFF",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "ACCOUNTANT",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL"
    ]
  },
  { labelKey: "timetable", path: "/timetable", roles: [...institutionRoles, "TEACHER"] },
  { labelKey: "homework", path: "/homework", roles: ["TEACHER"] },
  { labelKey: "homework", path: "/homework-view", roles: ["STUDENT", "PARENT"] },
  { labelKey: "attendance", path: "/attendance", roles: ["TEACHER"] },
  { labelKey: "attendance", path: "/attendance-view", roles: institutionRoles },
  { labelKey: "exams", path: "/exams", roles: ["TEACHER", "STUDENT", "PARENT"] },
  { labelKey: "exams", path: "/exams-view", roles: institutionRoles },
  { labelKey: "accounting", path: "/accounting", roles: [...institutionRoles, "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"] },
  { labelKey: "myFees", path: "/my-fees", roles: ["STUDENT"] },
  { labelKey: "library", path: "/library", roles: [...institutionRoles, "LIBRARY_STAFF"] },
  { labelKey: "myLibrary", path: "/my-library", roles: ["STUDENT", "TEACHER"] },
  { labelKey: "laboratory", path: "/laboratory", roles: [...institutionRoles, "LABORATORY_STAFF", "TEACHER"] },
  { labelKey: "transport", path: "/transport", roles: [...institutionRoles, "COLLEGE_STAFF"] },
  { labelKey: "hr", path: "/hr", roles: institutionRoles },
  { labelKey: "parentLinks", path: "/parent-links", roles: institutionRoles },
  {
    labelKey: "notifications",
    path: "/notifications",
    roles: [
      ...institutionRoles,
      "TEACHER",
      "STUDENT",
      "PARENT",
      "COLLEGE_STAFF",
      "ACCOUNTANT",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL"
    ]
  },
  {
    labelKey: "notices",
    path: "/notices",
    roles: [...institutionRoles, "TEACHER", "STUDENT", "PARENT", "COLLEGE_STAFF"]
  },
  {
    labelKey: "complains",
    path: "/complains",
    roles: [
      "SUPER_ADMIN",
      "COLLEGE_ADMIN",
      "COLLEGE_VIEWER",
      "TEACHER",
      "STUDENT",
      "COLLEGE_STAFF",
      "LIBRARY_STAFF",
      "LABORATORY_STAFF",
      "ACCOUNTANT",
      "CASHIER",
      "AUDITOR",
      "PRINCIPAL"
    ]
  },
  { labelKey: "settings", path: "/settings", roles: institutionRoles },
  { labelKey: "reports", path: "/reports", roles: institutionRoles }
];

const administrationItems: Array<{ labelKey: string; path: string; roles: UserRole[] }> = [
  { labelKey: "adminUsers", path: "/admin-management", roles: ["SUPER_ADMIN"] },
  { labelKey: "collegeAdministrators", path: "/college-administrators", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] }
];

export const AppLayout = () => {
  const [open, setOpen] = useState(false);
  const { user, logout, availableSchools } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) {
      return;
    }

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
  const institutionAccess = hasInstitutionAccess(normalizedRole);
  const visibleAdministrationItems = administrationItems.filter((item) => item.roles.includes(normalizedRole));
  const showAdministrationSection = visibleAdministrationItems.length > 0;
  const moduleOnlyRoles: UserRole[] = [
    "LIBRARY_STAFF",
    "LABORATORY_STAFF",
    "ACCOUNTANT",
    "CASHIER",
    "AUDITOR",
    "PRINCIPAL",
    "COLLEGE_STAFF"
  ];
  const isModuleOnlyUser = moduleOnlyRoles.includes(normalizedRole);
  const collegeName = getCollegeDisplayName(availableSchools, user);
  const showCollegeContext = !institutionAccess;

  const visibleItems = navItems
    .filter((item) => item.roles.includes(normalizedRole))
    .filter((item) => {
      if (isModuleOnlyUser) {
        if (normalizedRole === "ACCOUNTANT" || normalizedRole === "CASHIER" || normalizedRole === "AUDITOR" || normalizedRole === "PRINCIPAL") {
          return (
            item.path === "/dashboard" ||
            item.path === "/accounting" ||
            item.path === "/notifications" ||
            item.path === "/complains" ||
            item.path === "/academic-calendar"
          );
        }
        if (normalizedRole === "LABORATORY_STAFF") {
          return (
            item.path === "/dashboard" ||
            item.path === "/laboratory" ||
            item.path === "/notifications" ||
            item.path === "/complains" ||
            item.path === "/academic-calendar"
          );
        }
        if (normalizedRole === "LIBRARY_STAFF") {
          return (
            item.path === "/dashboard" ||
            item.path === "/library" ||
            item.path === "/notifications" ||
            item.path === "/complains" ||
            item.path === "/academic-calendar"
          );
        }
        if (normalizedRole === "COLLEGE_STAFF") {
          return (
            item.path === "/dashboard" ||
            item.path === "/notifications" ||
            item.path === "/notices" ||
            item.path === "/complains" ||
            item.path === "/academic-calendar" ||
            item.path === "/transport"
          );
        }
      }
      return true;
    })
    .map((item) => ({
      ...item,
      path:
        item.path === "/dashboard"
          ? normalizedRole === "COLLEGE_VIEWER"
            ? "/dashboard/college_admin"
            : `/dashboard/${normalizedRole.toLowerCase()}`
          : item.path
    }));

  const brandHomePath =
    visibleItems.find((item) => item.labelKey === "dashboard")?.path ??
    getRoleRedirectPath(normalizedRole) ??
    "/dashboard";

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
            "md:sticky md:top-0 md:z-30 md:translate-x-0"
          )}
        >
          <div className="shrink-0">
            <NavLink
              to={brandHomePath}
              onClick={() => setOpen(false)}
              title="Go to dashboard"
              className="flex cursor-pointer items-center gap-3 rounded-2xl outline-none"
            >
              <div className="rounded-2xl bg-white/10 p-2">
                <CollegeLogo variant="light" className="h-10 w-10" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold leading-tight">{t("appName")}</h2>
                {showCollegeContext ? <p className="truncate text-xs text-slate-400">{INSTITUTION_NAME}</p> : null}
              </div>
            </NavLink>
          </div>

          <div className="app-sidebar-scroll mt-8 min-h-0 flex-1">
            <nav className="space-y-2 pr-1">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/notifications" || item.path === "/notices"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition",
                      isActive ? "bg-brand-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    )
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-left">{t(item.labelKey)}</span>
                  {item.path === "/notifications" ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-amber-950 tabular-nums",
                        unreadCount > 0 ? "visible" : "invisible"
                      )}
                      aria-hidden={unreadCount === 0}
                    >
                      {unreadCount > 0 ? unreadCount : 0}
                    </span>
                  ) : null}
                </NavLink>
              ))}

              {showAdministrationSection ? (
                <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                  <p className="px-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("administration")}</p>
                  {visibleAdministrationItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "block rounded-2xl px-4 py-2.5 text-sm font-medium transition",
                          isActive ? "bg-brand-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                        )
                      }
                    >
                      {t(item.labelKey)}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </nav>

            <div className="mt-4 pt-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{roleLabelMap[normalizedRole]}</p>
                <p className="mt-2 truncate font-semibold">{user.fullName}</p>
                <p className="truncate text-sm text-slate-300">{user.email}</p>
                {showCollegeContext ? <p className="mt-2 truncate text-xs text-slate-400">{collegeName}</p> : null}
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 shrink-0 border-b border-white/70 bg-white/90 backdrop-blur">
            <div className="mx-auto w-full max-w-[1600px] px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Button variant="ghost" size="sm" className="shrink-0 md:hidden" onClick={() => setOpen((current) => !current)}>
                    <Menu className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-600">{t("welcome")}</p>
                    <h1 className="truncate text-lg font-semibold text-slate-900">{user.fullName}</h1>
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex min-w-0 max-w-[10rem] items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-sm shadow-sm sm:max-w-xs md:max-w-sm">
                    <CollegeLogo className="h-8 w-8 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold leading-tight text-brand-950" title={collegeName}>
                        {collegeName}
                      </div>
                      <div className="text-[10px] font-medium uppercase tracking-widest text-brand-700/80">
                        {roleLabelMap[normalizedRole]}
                      </div>
                    </div>
                  </div>
                  <Button className="shrink-0" variant="outline" size="sm" onClick={() => void handleLogout()}>
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
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};