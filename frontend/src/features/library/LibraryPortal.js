import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { PageContent } from "components/layout/PageContent";
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
export const LibraryPortal = () => {
    const booksQuery = useQuery({
        queryKey: ["library-my-books"],
        queryFn: () => unwrap(api.get("/library/my-books"))
    });
    const issues = booksQuery.data ?? [];
    const active = issues.filter((issue) => issue.status !== "RETURNED");
    const history = issues.filter((issue) => issue.status === "RETURNED");
    return (_jsxs(PageContent, { className: "space-y-6", children: [_jsx(PageHeader, { title: "My Library", description: "View books currently borrowed and your complete borrowing history." }), _jsxs("div", { className: "grid gap-4 md:grid-cols-3", children: [_jsx(Card, { className: "bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]", children: _jsxs(CardContent, { className: "flex items-center gap-4 py-6", children: [_jsx("div", { className: "rounded-2xl bg-emerald-100 p-3", children: _jsx(BookOpen, { className: "h-6 w-6 text-emerald-700" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-slate-500", children: "Currently borrowed" }), _jsx("p", { className: "text-2xl font-semibold text-slate-900", children: active.length })] })] }) }), _jsx(Card, { children: _jsxs(CardContent, { className: "py-6", children: [_jsx("p", { className: "text-sm text-slate-500", children: "Overdue" }), _jsx("p", { className: "text-2xl font-semibold text-rose-600", children: active.filter((i) => i.status === "OVERDUE").length })] }) }), _jsx(Card, { children: _jsxs(CardContent, { className: "py-6", children: [_jsx("p", { className: "text-sm text-slate-500", children: "Returned (all time)" }), _jsx("p", { className: "text-2xl font-semibold text-slate-900", children: history.length })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Borrowed books" }) }), _jsx(CardContent, { children: _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Book" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Returned" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: active.length === 0 ? (_jsx("tr", { children: _jsx(Td, { colSpan: 5, className: "py-8 text-center text-sm text-slate-500", children: "No books currently borrowed." }) })) : (active.map((issue) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: issue.bookTitle ?? "—" }), _jsx(Td, { children: issue.issuedDateBs }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: issue.returnedDateBs ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) })] }, issue._id)))) })] }) }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Borrowing history" }) }), _jsx(CardContent, { children: _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Book" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Returned" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: history.length === 0 ? (_jsx("tr", { children: _jsx(Td, { colSpan: 5, className: "py-8 text-center text-sm text-slate-500", children: "No borrowing history yet." }) })) : (history.map((issue) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: issue.bookTitle ?? "—" }), _jsx(Td, { children: issue.issuedDateBs }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: issue.returnedDateBs ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) })] }, issue._id)))) })] }) }) })] })] }));
};
