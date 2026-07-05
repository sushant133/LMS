import { Building2, LogOut, Menu } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { useTranslation } from "react-i18next";
import { INSTITUTION_NAME, isInstitutionAdmin, normalizeUserRole, type UserRole } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
import { getCollegeDisplayName, roleLabelMap } from "lib/auth";
import { redirectToLogin } from "lib/redirectToLogin";
import { resetAppShell } from "lib/resetAppShell";

const navItems: Array<{ labelKey: string; path: string; roles: UserRole[] }> = [
  { labelKey: "dashboard", path: "/dashboard", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
  { labelKey: "mySubjects", path: "/my-subjects", roles: ["STUDENT"] },
  { labelKey: "parentPortal", path: "/parent-portal", roles: ["PARENT"] },
  { labelKey: "students", path: "/students", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"] },
  { labelKey: "collegeStaff", path: "/college-staff", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "academics", path: "/academics", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "timetable", path: "/timetable", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"] },
  { labelKey: "homework", path: "/homework", roles: ["TEACHER"] },
  { labelKey: "homework", path: "/homework-view", roles: ["STUDENT", "PARENT"] },
  { labelKey: "attendance", path: "/attendance", roles: ["TEACHER"] },
  { labelKey: "attendance", path: "/attendance-view", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "exams", path: "/exams", roles: ["TEACHER", "STUDENT", "PARENT"] },
  { labelKey: "exams", path: "/exams-view", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "accounting", path: "/accounting", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"] },
  { labelKey: "myFees", path: "/my-fees", roles: ["STUDENT"] },
  { labelKey: "library", path: "/library", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "LIBRARY_STAFF"] },
  { labelKey: "myLibrary", path: "/my-library", roles: ["STUDENT", "TEACHER"] },
  { labelKey: "laboratory", path: "/laboratory", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "LABORATORY_STAFF"] },
  { labelKey: "transport", path: "/transport", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "hr", path: "/hr", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "parentLinks", path: "/parent-links", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "notifications", path: "/notifications", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
  { labelKey: "notices", path: "/notices", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
  { labelKey: "settings", path: "/settings", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "reports", path: "/reports", roles: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
  { labelKey: "adminManagement", path: "/admin-management", roles: ["SUPER_ADMIN"] }
];

export const AppLayout = () => {
  const [open, setOpen] = useState(false);
  const { user, logout, availableSchools } = useAuth();
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
  const institutionAdmin = isInstitutionAdmin(normalizedRole);
  const moduleOnlyRoles: UserRole[] = ["LIBRARY_STAFF", "LABORATORY_STAFF", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL"];
  const isModuleOnlyUser = moduleOnlyRoles.includes(normalizedRole);
  const collegeName = getCollegeDisplayName(availableSchools, user);
  const showCollegeContext = !institutionAdmin;

  const visibleItems = navItems
    .filter((item) => item.roles.includes(normalizedRole))
    .filter((item) => {
      if (isModuleOnlyUser) {
        if (normalizedRole === "ACCOUNTANT" || normalizedRole === "CASHIER" || normalizedRole === "AUDITOR" || normalizedRole === "PRINCIPAL") {
          return item.path === "/accounting" || item.path === "/notifications";
        }
        return item.path === "/library" || item.path === "/laboratory" || item.path === "/notifications";
      }
      return true;
    })
    .map((item) => ({
      ...item,
      path: item.path === "/dashboard" ? `/dashboard/${normalizedRole.toLowerCase()}` : item.path
    }));

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]">
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
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-500/20 p-3">
                <Building2 className="h-6 w-6 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold leading-tight">{t("appName")}</h2>
                {showCollegeContext ? <p className="truncate text-xs text-slate-400">{INSTITUTION_NAME}</p> : null}
              </div>
            </div>
          </div>

          <div className="app-sidebar-scroll mt-8 min-h-0 flex-1">
            <nav className="space-y-2 pr-1">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "block rounded-2xl px-4 py-3 text-sm font-medium transition",
                      isActive ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    )
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              ))}
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button variant="ghost" size="sm" className="shrink-0 md:hidden" onClick={() => setOpen((current) => !current)}>
                    <Menu className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-emerald-600">{t("welcome")}</p>
                    <h1 className="truncate text-lg font-semibold text-slate-900">{user.fullName}</h1>
                  </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex min-w-0 max-w-full items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-sm shadow-sm sm:max-w-xs md:max-w-sm">
                    <Building2 className="h-4 w-4 shrink-0 text-emerald-700" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold leading-tight text-emerald-950" title={collegeName}>
                        {collegeName}
                      </div>
                      <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-700/80">
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