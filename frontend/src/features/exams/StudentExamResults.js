import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNepalGrade } from "@nepal-school-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { PageContent } from "components/layout/PageContent";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
const getOverallStatus = (grade, percentage) => {
    if (grade === "E" || percentage < 35) {
        return { label: "Fail", className: "bg-red-100 text-red-700" };
    }
    return { label: "Pass", className: "bg-emerald-100 text-emerald-700" };
};
export const StudentExamResults = ({ exams, results, isLoading }) => {
    const { user } = useAuth();
    const subjectsQuery = useQuery({
        queryKey: ["student-subjects"],
        queryFn: () => unwrap(api.get("/student/subjects")),
        enabled: user?.role === "STUDENT",
        staleTime: 60_000
    });
    const subjectMap = useMemo(() => new Map((subjectsQuery.data ?? []).map((subject) => [subject._id, subject])), [subjectsQuery.data]);
    const examById = useMemo(() => new Map(exams.map((exam) => [exam._id, exam])), [exams]);
    const sortedResults = useMemo(() => [...results].sort((left, right) => {
        const leftDate = examById.get(left.examId)?.startDateBs ?? "";
        const rightDate = examById.get(right.examId)?.startDateBs ?? "";
        return rightDate.localeCompare(leftDate);
    }), [results, examById]);
    if (isLoading) {
        return _jsx(LoadingState, {});
    }
    if (sortedResults.length === 0) {
        return (_jsx(EmptyState, { title: "No published results yet", description: "Your exam results will appear here after teachers enter and publish marks." }));
    }
    return (_jsx(PageContent, { className: "space-y-6", children: sortedResults.map((result) => {
            const exam = examById.get(result.examId);
            const overallStatus = getOverallStatus(result.grade, result.percentage);
            return (_jsxs(Card, { className: "overflow-hidden border-emerald-100", children: [_jsx(CardHeader, { className: "border-b border-emerald-50 bg-emerald-50/40", children: _jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx(CardTitle, { children: exam?.name ?? "Exam" }), _jsxs("p", { className: "mt-1 text-sm text-slate-600", children: [exam ? `${exam.startDateBs} to ${exam.endDateBs}` : "Exam session", result.publishedAtBs ? ` · Published ${result.publishedAtBs}` : ""] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Badge, { children: result.grade }), _jsx(Badge, { className: overallStatus.className, children: overallStatus.label })] })] }) }), _jsxs(CardContent, { className: "space-y-4 pt-5", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3", children: [_jsx("p", { className: "text-xs uppercase tracking-wide text-slate-500", children: "Overall Grade" }), _jsx("p", { className: "mt-1 text-2xl font-semibold text-slate-900", children: result.grade })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3", children: [_jsx("p", { className: "text-xs uppercase tracking-wide text-slate-500", children: "GPA" }), _jsx("p", { className: "mt-1 text-2xl font-semibold text-slate-900", children: result.gpa.toFixed(2) })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3", children: [_jsx("p", { className: "text-xs uppercase tracking-wide text-slate-500", children: "Percentage" }), _jsxs("p", { className: "mt-1 text-2xl font-semibold text-slate-900", children: [result.percentage, "%"] })] })] }), _jsx("div", { className: "overflow-x-auto rounded-2xl border border-slate-200", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Subject" }), _jsx(Th, { children: "Marks" }), _jsx(Th, { children: "Grade" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: result.marks.map((mark) => {
                                                const subject = subjectMap.get(mark.subjectId);
                                                const fullMarks = subject?.fullMarks ?? 100;
                                                const passMarks = subject?.passMarks ?? 35;
                                                const percentage = fullMarks > 0 ? (mark.obtainedMarks / fullMarks) * 100 : 0;
                                                const subjectGrade = getNepalGrade(percentage).grade;
                                                const passed = mark.obtainedMarks >= passMarks;
                                                return (_jsxs("tr", { children: [_jsxs(Td, { children: [_jsx("div", { className: "font-medium text-slate-900", children: subject?.name ?? "Subject" }), subject?.code ? _jsx("div", { className: "text-xs text-slate-500", children: subject.code }) : null] }), _jsxs(Td, { children: [mark.obtainedMarks, " / ", fullMarks] }), _jsx(Td, { children: _jsx(Badge, { children: subjectGrade }) }), _jsx(Td, { children: _jsx(Badge, { className: passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700", children: passed ? "Pass" : "Fail" }) })] }, mark.subjectId));
                                            }) })] }) })] })] }, result._id));
        }) }));
};
