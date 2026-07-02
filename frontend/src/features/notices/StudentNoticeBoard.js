import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { EmptyState } from "components/shared/EmptyState";
import { PageContent } from "components/layout/PageContent";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
export const StudentNoticeBoard = ({ notices }) => {
    if (notices.length === 0) {
        return _jsx(EmptyState, { title: "No notices yet", description: "Announcements for your class and subjects will appear here." });
    }
    return (_jsx(PageContent, { className: "space-y-4", children: notices.map((notice) => (_jsxs(Card, { className: "min-w-0 border-emerald-100", children: [_jsx(CardHeader, { className: "pb-3", children: _jsx("div", { className: "flex flex-wrap items-start justify-between gap-3", children: _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx(CardTitle, { className: "text-lg text-slate-900", children: notice.title }), _jsxs("p", { className: "mt-1 text-sm text-slate-500", children: ["Posted by ", notice.authorName ?? "School", " \u00B7 ", notice.publishDateBs, notice.subjectName ? ` · ${notice.subjectName}` : ""] })] }) }) }), _jsxs(CardContent, { children: [_jsx("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-slate-700", children: notice.content }), notice.expiresAtBs ? _jsxs("p", { className: "mt-3 text-xs text-slate-500", children: ["Valid until ", notice.expiresAtBs] }) : null] })] }, notice._id))) }));
};
