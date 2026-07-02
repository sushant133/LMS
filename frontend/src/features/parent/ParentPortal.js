import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
export const ParentPortal = () => {
    const portalQuery = useQuery({
        queryKey: ["parent-portal"],
        queryFn: () => unwrap(api.get("/parent/portal"))
    });
    const data = portalQuery.data;
    if (portalQuery.isLoading) {
        return _jsx("p", { className: "p-6 text-sm text-slate-500", children: "Loading parent portal\u2026" });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Parent Portal", description: "View your children's attendance, fees, assignments, and school alerts." }), _jsx("div", { className: "grid gap-4 md:grid-cols-2", children: (data?.children ?? []).map((child) => (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: child.fullName }), _jsxs("p", { className: "text-sm text-slate-500", children: [child.className, " \u00B7 Section ", child.sectionName, " \u00B7 Roll ", child.rollNumber] })] }), _jsxs(CardContent, { className: "grid grid-cols-2 gap-3 text-sm", children: [_jsxs("div", { children: [_jsx("p", { className: "text-slate-500", children: "Attendance" }), _jsxs("p", { className: "font-semibold", children: [child.attendanceRate, "%"] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-slate-500", children: "Fees due" }), _jsx("p", { className: "font-semibold", children: formatCurrencyNpr(child.feesDueNpr) })] }), _jsxs("div", { children: [_jsx("p", { className: "text-slate-500", children: "Pending assignments" }), _jsx("p", { className: "font-semibold", children: child.pendingHomework })] }), _jsxs("div", { children: [_jsx("p", { className: "text-slate-500", children: "Relationship" }), _jsx("p", { className: "font-semibold", children: child.relationship })] })] })] }, child.studentId))) }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Recent notifications" }) }), _jsx(CardContent, { className: "space-y-3", children: (data?.recentNotifications ?? []).map((n) => (_jsxs("div", { className: "rounded-xl border border-slate-100 p-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("p", { className: "font-medium", children: n.title }), _jsx(Badge, { children: n.type })] }), _jsx("p", { className: "mt-1 text-sm text-slate-600", children: n.message })] }, n._id))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Upcoming assignments" }) }), _jsx(CardContent, { className: "space-y-3", children: (data?.upcomingHomework ?? []).map((hw) => (_jsxs("div", { className: "rounded-xl border border-slate-100 p-3", children: [_jsx("p", { className: "font-medium", children: hw.title }), _jsx("p", { className: "text-sm text-slate-600", children: hw.description }), hw.dueDateBs ? _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["Due ", hw.dueDateBs] }) : null] }, hw._id))) })] })] }));
};
