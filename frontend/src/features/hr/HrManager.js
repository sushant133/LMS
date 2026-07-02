import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LEAVE_TYPES, leaveRequestSchema, payrollSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
export const HrManager = () => {
    const [leaveForm, setLeaveForm] = useState({ teacherId: "", type: "CASUAL", startDateBs: "", endDateBs: "", reason: "" });
    const [payrollForm, setPayrollForm] = useState({ teacherId: "", monthBs: "2082-01", basicSalaryNpr: 0, allowancesNpr: 0, deductionsNpr: 0, status: "DRAFT", paidDateBs: "" });
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers"))
    });
    const leavesQuery = useQuery({
        queryKey: ["hr-leaves"],
        queryFn: () => unwrap(api.get("/hr/leaves"))
    });
    const payrollQuery = useQuery({
        queryKey: ["hr-payroll"],
        queryFn: () => unwrap(api.get("/hr/payroll"))
    });
    const createLeave = useMutation({
        mutationFn: (payload) => unwrap(api.post("/hr/leaves", payload)),
        onSuccess: async () => { toast.success("Leave submitted"); await queryClient.invalidateQueries({ queryKey: ["hr-leaves"] }); },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const updateLeave = useMutation({
        mutationFn: ({ id, status }) => unwrap(api.put(`/hr/leaves/${id}/status`, { status })),
        onSuccess: async () => { toast.success("Leave updated"); await queryClient.invalidateQueries({ queryKey: ["hr-leaves"] }); },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createPayroll = useMutation({
        mutationFn: (payload) => unwrap(api.post("/hr/payroll", payload)),
        onSuccess: async () => { toast.success("Payroll created"); await queryClient.invalidateQueries({ queryKey: ["hr-payroll"] }); },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "HR & Payroll", description: "Leave requests, approvals, and monthly salary processing." }), _jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Leave request" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: leaveForm.teacherId, onChange: (e) => setLeaveForm((c) => ({ ...c, teacherId: e.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), (teachersQuery.data ?? []).map((t) => _jsx("option", { value: t._id, children: t.user.fullName }, t._id))] }) }), _jsx(FormField, { label: "Type", children: _jsx(Select, { value: leaveForm.type, onChange: (e) => setLeaveForm((c) => ({ ...c, type: e.target.value })), children: LEAVE_TYPES.map((t) => _jsx("option", { value: t, children: t }, t)) }) }), _jsx(FormField, { label: "Start (BS)", children: _jsx(NepaliDateField, { value: leaveForm.startDateBs, onChange: (v) => setLeaveForm((c) => ({ ...c, startDateBs: v })) }) }), _jsx(FormField, { label: "End (BS)", children: _jsx(NepaliDateField, { value: leaveForm.endDateBs, onChange: (v) => setLeaveForm((c) => ({ ...c, endDateBs: v })) }) }), _jsx(FormField, { label: "Reason", children: _jsx(Textarea, { value: leaveForm.reason, onChange: (e) => setLeaveForm((c) => ({ ...c, reason: e.target.value })) }) }), _jsx(Button, { onClick: () => { const p = leaveRequestSchema.safeParse(leaveForm); if (!p.success)
                                            return toast.error("Invalid leave"); createLeave.mutate(p.data); }, children: "Submit leave" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Process payroll" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: payrollForm.teacherId, onChange: (e) => setPayrollForm((c) => ({ ...c, teacherId: e.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), (teachersQuery.data ?? []).map((t) => (_jsx("option", { value: t._id, children: t.user.fullName }, t._id)))] }) }), _jsx(FormField, { label: "Month (YYYY-MM)", children: _jsx(Input, { value: payrollForm.monthBs, onChange: (e) => setPayrollForm((c) => ({ ...c, monthBs: e.target.value })) }) }), _jsx(FormField, { label: "Basic salary", children: _jsx(Input, { type: "number", value: payrollForm.basicSalaryNpr, onChange: (e) => setPayrollForm((c) => ({ ...c, basicSalaryNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Allowances", children: _jsx(Input, { type: "number", value: payrollForm.allowancesNpr, onChange: (e) => setPayrollForm((c) => ({ ...c, allowancesNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Deductions", children: _jsx(Input, { type: "number", value: payrollForm.deductionsNpr, onChange: (e) => setPayrollForm((c) => ({ ...c, deductionsNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => { const p = payrollSchema.safeParse(payrollForm); if (!p.success)
                                            return toast.error("Invalid payroll"); createPayroll.mutate(p.data); }, children: "Create payroll" })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Leave requests" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Teacher" }), _jsx(Th, { children: "Type" }), _jsx(Th, { children: "Dates" }), _jsx(Th, { children: "Status" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (leavesQuery.data ?? []).map((l) => (_jsxs("tr", { children: [_jsx(Td, { children: l.teacherId?.user?.fullName }), _jsx(Td, { children: l.type }), _jsxs(Td, { children: [l.startDateBs, " \u2013 ", l.endDateBs] }), _jsx(Td, { children: l.status }), _jsx(Td, { children: l.status === "PENDING" ? (_jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", onClick: () => updateLeave.mutate({ id: l._id, status: "APPROVED" }), children: "Approve" }), _jsx(Button, { size: "sm", variant: "secondary", onClick: () => updateLeave.mutate({ id: l._id, status: "REJECTED" }), children: "Reject" })] })) : null })] }, l._id))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Payroll records" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Teacher" }), _jsx(Th, { children: "Month" }), _jsx(Th, { children: "Net salary" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (payrollQuery.data ?? []).map((p) => (_jsxs("tr", { children: [_jsx(Td, { children: p.teacherId?.user?.fullName }), _jsx(Td, { children: p.monthBs }), _jsx(Td, { children: formatCurrencyNpr(p.netSalaryNpr) }), _jsx(Td, { children: p.status })] }, p._id))) })] }) })] })] }));
};
