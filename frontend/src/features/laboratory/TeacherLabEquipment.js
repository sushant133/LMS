import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
const issueStatusStyles = {
    ISSUED: "bg-sky-100 text-sky-800",
    RETURNED: "bg-emerald-100 text-emerald-800",
    OVERDUE: "bg-rose-100 text-rose-800"
};
export const TeacherLabEquipment = () => {
    const issuesQuery = useQuery({
        queryKey: ["laboratory-my-equipment"],
        queryFn: () => unwrap(api.get("/laboratory/my-equipment"))
    });
    const issues = issuesQuery.data ?? [];
    if (issues.length === 0) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Laboratory Equipment", description: "Equipment issued to you by the laboratory." }), _jsx(Card, { children: _jsx(CardContent, { className: "py-10 text-center text-sm text-slate-500", children: "No laboratory equipment has been issued to you." }) })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Laboratory Equipment", description: "Equipment issued to you by the laboratory." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Issued equipment" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Item" }), _jsx(Th, { children: "Quantity" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Returned" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: issues.map((issue) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: issue.equipmentName ?? "—" }), _jsx(Td, { children: issue.quantity }), _jsx(Td, { children: issue.issuedDateBs }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: issue.returnedDateBs ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) })] }, issue._id))) })] }) })] })] }));
};
