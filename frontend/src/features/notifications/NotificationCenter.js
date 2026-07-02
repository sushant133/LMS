import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { api, unwrap } from "lib/api";
import { cn } from "lib/utils";
import { queryClient } from "lib/queryClient";
export const NotificationCenter = () => {
    const notificationsQuery = useQuery({
        queryKey: ["notifications"],
        queryFn: () => unwrap(api.get("/notifications"))
    });
    const markRead = useMutation({
        mutationFn: (id) => unwrap(api.put(`/notifications/${id}/read`)),
        onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
    });
    const markAllRead = useMutation({
        mutationFn: () => unwrap(api.put("/notifications/read-all")),
        onSuccess: async () => {
            toast.success("All notifications marked read");
            await queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }
    });
    return (_jsxs(PageContent, { className: "space-y-6", children: [_jsx(PageHeader, { title: "Notifications", description: "In-app alerts and SMS delivery status for attendance, assignments, fees, and more.", action: _jsx(Button, { variant: "secondary", onClick: () => markAllRead.mutate(), children: "Mark all read" }) }), _jsx("div", { className: "space-y-3", children: (notificationsQuery.data ?? []).map((n) => (_jsx(Card, { className: cn("min-w-0", n.read ? "opacity-70" : ""), children: _jsxs(CardContent, { className: "flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("p", { className: "font-semibold text-slate-900", children: n.title }), _jsx(Badge, { children: n.type }), _jsx(Badge, { children: n.channel }), n.smsStatus !== "SKIPPED" ? _jsx(Badge, { children: n.smsStatus }) : null] }), _jsx("p", { className: "mt-1 text-sm text-slate-600", children: n.message })] }), !n.read ? (_jsx(Button, { className: "shrink-0 self-start", size: "sm", variant: "secondary", onClick: () => markRead.mutate(n._id), children: "Mark read" })) : null] }) }, n._id))) })] }));
};
