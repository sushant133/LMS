import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PARENT_RELATIONSHIPS, parentChildLinkSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
export const ParentLinkManager = () => {
    const [form, setForm] = useState({ parentUserId: "", studentId: "", relationship: "GUARDIAN", isPrimary: true });
    const parentsQuery = useQuery({
        queryKey: ["parent-users"],
        queryFn: () => unwrap(api.get("/parent/users"))
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students"))
    });
    const linksQuery = useQuery({
        queryKey: ["parent-links"],
        queryFn: () => unwrap(api.get("/parent/links"))
    });
    const createLink = useMutation({
        mutationFn: (payload) => unwrap(api.post("/parent/links", payload)),
        onSuccess: async () => {
            toast.success("Parent linked to student");
            await queryClient.invalidateQueries({ queryKey: ["parent-links"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Parent\u2013Student Links", description: "Connect parent accounts to students for the parent portal." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Link parent to student" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: "Parent", children: _jsxs(Select, { value: form.parentUserId, onChange: (e) => setForm((c) => ({ ...c, parentUserId: e.target.value })), children: [_jsx("option", { value: "", children: "Select parent" }), (parentsQuery.data ?? []).map((p) => (_jsxs("option", { value: p._id, children: [p.fullName, " (", p.email, ")"] }, p._id)))] }) }), _jsx(FormField, { label: "Student", children: _jsxs(Select, { value: form.studentId, onChange: (e) => setForm((c) => ({ ...c, studentId: e.target.value })), children: [_jsx("option", { value: "", children: "Select student" }), (studentsQuery.data ?? []).map((s) => (_jsx("option", { value: s._id, children: s.user.fullName }, s._id)))] }) }), _jsx(FormField, { label: "Relationship", children: _jsx(Select, { value: form.relationship, onChange: (e) => setForm((c) => ({ ...c, relationship: e.target.value })), children: PARENT_RELATIONSHIPS.map((r) => _jsx("option", { value: r, children: r }, r)) }) }), _jsx("div", { className: "flex items-end", children: _jsx(Button, { onClick: () => { const p = parentChildLinkSchema.safeParse(form); if (!p.success)
                                        return toast.error("Invalid link"); createLink.mutate(p.data); }, children: "Create link" }) })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Existing links" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Parent" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Relationship" })] }) }), _jsx(TableBody, { children: (linksQuery.data ?? []).map((link) => (_jsxs("tr", { children: [_jsx(Td, { children: link.parentUserId }), _jsx(Td, { children: link.studentId?.user?.fullName ?? "—" }), _jsx(Td, { children: link.relationship })] }, link._id))) })] }) })] })] }));
};
