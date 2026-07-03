import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Menu, School, LogOut } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { useTranslation } from "react-i18next";
import { Button } from "components/ui/button";
import { Select } from "components/ui/select";
import { cn } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
import { getSchoolDisplayName, roleLabelMap } from "lib/auth";
import { resetAppShell } from "lib/resetAppShell";
const navItems = [
    { labelKey: "dashboard", path: "/dashboard", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
    { labelKey: "mySubjects", path: "/my-subjects", roles: ["STUDENT"] },
    { labelKey: "parentPortal", path: "/parent-portal", roles: ["PARENT"] },
    { labelKey: "schools", path: "/schools", roles: ["SUPER_ADMIN"] },
    { labelKey: "students", path: "/students", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"] },
    { labelKey: "teachers", path: "/teachers", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "academics", path: "/academics", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "timetable", path: "/timetable", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"] },
    { labelKey: "homework", path: "/homework", roles: ["TEACHER"] },
    { labelKey: "homework", path: "/homework-view", roles: ["STUDENT", "PARENT"] },
    { labelKey: "attendance", path: "/attendance", roles: ["TEACHER"] },
    { labelKey: "attendance", path: "/attendance-view", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "exams", path: "/exams", roles: ["TEACHER", "STUDENT", "PARENT"] },
    { labelKey: "exams", path: "/exams-view", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "fees", path: "/fees", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "accounting", path: "/accounting", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"] },
    { labelKey: "myFees", path: "/my-fees", roles: ["STUDENT"] },
    { labelKey: "library", path: "/library", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "LIBRARY_STAFF"] },
    { labelKey: "myLibrary", path: "/my-library", roles: ["STUDENT", "TEACHER"] },
    { labelKey: "laboratory", path: "/laboratory", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "LABORATORY_STAFF"] },
    { labelKey: "transport", path: "/transport", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "hr", path: "/hr", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "parentLinks", path: "/parent-links", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "notifications", path: "/notifications", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
    { labelKey: "notices", path: "/notices", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
    { labelKey: "settings", path: "/settings", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] },
    { labelKey: "reports", path: "/reports", roles: ["SUPER_ADMIN", "SCHOOL_ADMIN"] }
];
export const AppLayout = () => {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const { user, logout, availableSchools, activeSchoolId, setActiveSchool } = useAuth();
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
        }
        finally {
            resetAppShell();
            navigate("/login", { replace: true });
        }
    };
    if (!user) {
        return null;
    }
    const superAdminNeedsSchoolSelection = user.role === "SUPER_ADMIN" && !activeSchoolId;
    const moduleOnlyRoles = ["LIBRARY_STAFF", "LABORATORY_STAFF", "ACCOUNTANT"];
    const isModuleOnlyUser = moduleOnlyRoles.includes(user.role);
    const schoolName = getSchoolDisplayName(availableSchools, user);
    const visibleItems = navItems
        .filter((item) => item.roles.includes(user.role))
        .filter((item) => {
        if (isModuleOnlyUser) {
            if (user.role === "ACCOUNTANT") {
                return item.path === "/accounting" || item.path === "/notifications";
            }
            return item.path === "/library" || item.path === "/laboratory" || item.path === "/notifications";
        }
        return true;
    })
        .filter((item) => {
        if (!superAdminNeedsSchoolSelection) {
            return true;
        }
        return item.path === "/dashboard" || item.path === "/schools";
    })
        .map((item) => ({
        ...item,
        path: item.path === "/dashboard" ? `/dashboard/${user.role.toLowerCase()}` : item.path
    }));
    return (_jsxs("div", { className: "min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]", children: [open ? (_jsx("button", { type: "button", "aria-label": "Close menu", "aria-hidden": "true", className: "fixed inset-0 z-40 bg-slate-950/50 md:hidden", onClick: () => setOpen(false) })) : null, _jsxs("div", { className: "flex min-h-screen w-full", children: [_jsxs("aside", { className: cn("flex w-[var(--app-sidebar-width)] shrink-0 flex-col overflow-hidden border-r border-white/60 bg-slate-950/95 px-5 py-6 text-white", "h-[100dvh] md:h-screen", "max-md:fixed max-md:left-0 max-md:top-0 max-md:z-50 max-md:transition-transform max-md:duration-200", open ? "max-md:translate-x-0" : "max-md:-translate-x-full", "md:sticky md:top-0 md:z-30 md:translate-x-0"), children: [_jsx("div", { className: "shrink-0", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-emerald-500/20 p-3", children: _jsx(School, { className: "h-6 w-6 text-emerald-300" }) }), _jsx("div", { className: "min-w-0", children: _jsx("h2", { className: "truncate text-lg font-semibold leading-tight", children: t("appName") }) })] }) }), _jsxs("div", { className: "app-sidebar-scroll mt-8 min-h-0 flex-1", children: [_jsx("nav", { className: "space-y-2 pr-1", children: visibleItems.map((item) => (_jsx(NavLink, { to: item.path, onClick: () => setOpen(false), className: ({ isActive }) => cn("block rounded-2xl px-4 py-3 text-sm font-medium transition", isActive ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"), children: t(item.labelKey) }, item.path))) }), _jsx("div", { className: "mt-4 pt-4", children: _jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-4", children: [_jsx("p", { className: "text-xs uppercase tracking-[0.2em] text-slate-400", children: roleLabelMap[user.role] }), _jsx("p", { className: "mt-2 truncate font-semibold", children: user.fullName }), _jsx("p", { className: "truncate text-sm text-slate-300", children: user.email }), _jsx("p", { className: "mt-2 truncate text-xs text-slate-400", children: user.role === "SUPER_ADMIN"
                                                        ? activeSchoolId
                                                            ? "School context selected"
                                                            : "Select a school to manage tenant data"
                                                        : schoolName })] }) })] })] }), _jsxs("div", { className: "flex min-h-screen min-w-0 flex-1 flex-col", children: [_jsx("header", { className: "sticky top-0 z-20 shrink-0 border-b border-white/70 bg-white/90 backdrop-blur", children: _jsx("div", { className: "mx-auto w-full max-w-[1600px] px-4 py-3 sm:px-6 lg:px-8 lg:py-4", children: _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(Button, { variant: "ghost", size: "sm", className: "shrink-0 md:hidden", onClick: () => setOpen((current) => !current), children: _jsx(Menu, { className: "h-4 w-4" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-xs uppercase tracking-[0.2em] text-emerald-600", children: t("welcome") }), _jsx("h1", { className: "truncate text-lg font-semibold text-slate-900", children: user.fullName })] })] }), _jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-2", children: [user.role === "SUPER_ADMIN" ? (_jsx("div", { className: "min-w-0 w-full sm:w-auto sm:min-w-[220px]", children: _jsxs(Select, { value: activeSchoolId ?? "", onChange: (event) => {
                                                                if (event.target.value) {
                                                                    void setActiveSchool(event.target.value);
                                                                }
                                                            }, children: [_jsx("option", { value: "", children: availableSchools.length === 0 ? "No schools available" : "Select school context" }), availableSchools.map((school) => (_jsx("option", { value: school._id, children: school.name }, school._id)))] }) })) : (_jsxs("div", { className: "flex min-w-0 max-w-full items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-sm shadow-sm sm:max-w-xs md:max-w-sm", children: [_jsx(School, { className: "h-4 w-4 shrink-0 text-emerald-700" }), _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate font-semibold leading-tight text-emerald-950", title: schoolName, children: schoolName }), _jsx("div", { className: "text-[10px] font-medium uppercase tracking-widest text-emerald-700/80", children: roleLabelMap[user.role] })] })] })), _jsxs(Button, { className: "shrink-0", variant: "outline", size: "sm", onClick: () => void handleLogout(), children: [_jsx(LogOut, { className: "mr-2 h-4 w-4" }), t("logout")] })] })] }) }) }), _jsx("main", { className: "min-w-0 flex-1 overflow-x-clip px-4 py-6 sm:px-6 lg:px-8", children: _jsxs("div", { className: "mx-auto min-w-0 w-full max-w-[1600px]", children: [user.role === "SCHOOL_ADMIN" ? (_jsxs("div", { className: "mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-sm", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx("div", { className: "rounded-xl bg-emerald-100 p-2", children: _jsx(School, { className: "h-5 w-5 text-emerald-700" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-xs uppercase tracking-widest text-emerald-600", children: "Managing School" }), _jsx("p", { className: "truncate text-lg font-semibold leading-tight text-emerald-950", title: schoolName, children: schoolName })] })] }), _jsx("div", { className: "text-xs text-emerald-600", children: "All data shown is for this school only" })] })) : null, _jsx(Suspense, { fallback: _jsx(LoadingState, {}), children: _jsx(Outlet, {}) })] }) })] })] }, user._id)] }));
};
