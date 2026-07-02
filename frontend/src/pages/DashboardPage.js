import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageContent } from "components/layout/PageContent";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { api, unwrap } from "lib/api";
import { getSchoolDisplayName } from "lib/auth";
import { formatCurrencyNpr } from "lib/utils";
export const DashboardPage = () => {
    const { role } = useParams();
    const { t } = useTranslation();
    const { user, activeSchoolId, availableSchools } = useAuth();
    const dashboardQuery = useQuery({
        queryKey: ["dashboard", activeSchoolId],
        queryFn: () => unwrap(api.get("/dashboard")),
        enabled: Boolean(user && (user.role !== "SUPER_ADMIN" || activeSchoolId))
    });
    if (user?.role === "SUPER_ADMIN" && !activeSchoolId) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: `${t("dashboard")} / ${role ?? "overview"}`, description: "Select a school context to view isolated tenant metrics, or open the school directory to create a new tenant." }), _jsx(Card, { children: _jsxs(CardContent, { className: "py-10 text-center", children: [_jsx("h2", { className: "text-2xl font-semibold text-slate-900", children: "Choose a school to continue" }), _jsx("p", { className: "mt-3 text-sm text-slate-600", children: "Use the selector in the top bar to enter a school context. Super admin school creation is available from the school directory." }), _jsx(Button, { className: "mt-5", asChild: true, children: _jsx(Link, { to: "/schools", children: "Open School Directory" }) })] }) })] }));
    }
    if (dashboardQuery.isLoading) {
        return _jsx(LoadingState, {});
    }
    if (dashboardQuery.isError) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(PageHeader, { title: t("dashboard"), description: "We could not load your dashboard data. Your session may have expired." }), _jsx(Card, { children: _jsx(CardContent, { className: "py-8 text-center text-sm text-slate-600", children: "Please try logging in again. Demo student: student01@demoerp.nepal-school.com / Demo@123456" }) })] }));
    }
    const data = dashboardQuery.data;
    if (!data) {
        return _jsx(LoadingState, {});
    }
    if (user?.role === "STUDENT") {
        const schoolName = getSchoolDisplayName(availableSchools, user);
        return (_jsxs(PageContent, { className: "space-y-6", children: [_jsx(PageHeader, { title: "Student Dashboard", description: "View your enrolled subjects, attendance, marks, and assignments." }), _jsx(Card, { children: _jsxs(CardContent, { className: "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm text-slate-500", children: "Welcome back" }), _jsx("p", { className: "text-2xl font-semibold text-slate-900", children: user.fullName }), _jsx("p", { className: "mt-1 text-sm font-medium text-emerald-700", children: schoolName }), _jsx("p", { className: "mt-1 text-sm text-slate-600", children: data.stats.map((stat) => `${stat.label}: ${stat.value}`).join(" · ") })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { asChild: true, variant: "outline", children: _jsx(Link, { to: "/homework-view", children: "Assignments & CAS Stream" }) }), _jsx(Button, { asChild: true, variant: "outline", children: _jsx(Link, { to: "/my-library", children: "My Library" }) }), _jsx(Button, { asChild: true, children: _jsx(Link, { to: "/my-subjects", children: "Open My Subjects" }) })] })] }) })] }));
    }
    const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";
    const isAdminLike = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const isTeacher = user?.role === "TEACHER";
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: `${t("dashboard")} / ${role ?? "overview"}`, description: isSchoolAdmin
                    ? "Welcome back! Here's a quick overview of your school."
                    : isTeacher
                        ? "Your teaching overview: assigned classes, attendance trends, and school notices."
                        : "Role-based overview of attendance, student volume, and recent notices." }), isSchoolAdmin && (_jsx("div", { className: "rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4", children: _jsxs("div", { className: "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-emerald-700", children: "Currently managing" }), _jsx("p", { className: "text-lg font-semibold text-emerald-950", children: getSchoolDisplayName(availableSchools, user) })] }), _jsxs("div", { className: "text-xs text-emerald-600", children: ["Academic Year: ", data.stats.find(s => s.label.includes("Year"))?.value || "Current"] })] }) })), _jsx("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: data.stats.map((stat) => (_jsx(Card, { className: "overflow-hidden bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]", children: _jsxs(CardContent, { className: "py-6", children: [_jsx("p", { className: "text-sm text-slate-500", children: stat.label }), _jsx("p", { className: "mt-2 text-3xl font-semibold text-slate-900", children: stat.value })] }) }, stat.label))) }), isSchoolAdmin && (_jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/attendance-view", children: "View Attendance" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/fees", children: "Record Fee Collection" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/exams-view", children: "View Exams & Results" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/reports", children: "IEMIS Reports" }) })] })), isTeacher && (_jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/attendance", children: "Mark Attendance" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/homework", children: "Assignments" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/timetable", children: "Timetable" }) }), _jsx(Button, { asChild: true, variant: "outline", size: "sm", children: _jsx(Link, { to: "/exams", children: "Exams & Results" }) })] })), _jsxs("div", { className: "grid gap-6 xl:grid-cols-[1.3fr_0.7fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Attendance Trend" }) }), _jsx(CardContent, { className: "h-[320px]", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(BarChart, { data: data.attendanceChart, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", vertical: false }), _jsx(XAxis, { dataKey: "label" }), _jsx(YAxis, { allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "present", fill: "#10b981", radius: [12, 12, 0, 0] }), _jsx(Bar, { dataKey: "absent", fill: "#fb7185", radius: [12, 12, 0, 0] })] }) }) })] }), data.counts.length > 0 ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: isTeacher ? "Teaching Load" : "Institution Mix" }) }), _jsx(CardContent, { className: "h-[320px]", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(PieChart, { children: [_jsx(Pie, { data: data.counts, dataKey: "value", nameKey: "name", outerRadius: 110, fill: "#0f766e", label: true }), _jsx(Tooltip, {})] }) }) })] })) : null] }), _jsxs("div", { className: isAdminLike ? "grid gap-6 xl:grid-cols-[1fr_1fr]" : "grid gap-6", children: [isAdminLike ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Fee Collection" }) }), _jsx(CardContent, { className: "space-y-4", children: data.feeChart.map((item) => (_jsxs("div", { className: "flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3", children: [_jsx("span", { className: "font-medium text-slate-700", children: item.label }), _jsx(Badge, { children: formatCurrencyNpr(item.amount) })] }, item.label))) })] })) : null, _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: t("noticeBoard") }) }), _jsx(CardContent, { className: "space-y-4", children: data.notices.map((notice) => (_jsxs("div", { className: "rounded-2xl border border-slate-200 p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("h3", { className: "font-semibold text-slate-900", children: notice.title }), _jsx(Badge, { children: notice.publishDateBs })] }), _jsx("p", { className: "mt-2 text-sm text-slate-600", children: notice.content })] }, notice._id))) })] })] })] }));
};
