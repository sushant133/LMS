import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createSchoolSchema, schoolSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
const schoolToForm = (school) => ({
    name: school.name,
    nameNp: school.nameNp,
    code: school.code,
    email: school.email,
    phone: school.phone,
    principalName: school.principalName,
    academicYearBs: school.academicYearBs,
    address: school.address,
    isActive: school.isActive
});
const defaultSchoolValue = {
    name: "",
    nameNp: "",
    code: "",
    email: "",
    phone: "",
    principalName: "",
    academicYearBs: "2083/2084",
    address: {
        province: "",
        district: "",
        municipality: "",
        ward: "",
        streetAddress: ""
    },
    isActive: true,
    adminFullName: "",
    adminEmail: "",
    adminPhone: ""
};
export const SchoolManager = () => {
    const [form, setForm] = useState(defaultSchoolValue);
    const [editingSchoolId, setEditingSchoolId] = useState(null);
    const schoolsQuery = useQuery({
        queryKey: ["schools"],
        queryFn: () => unwrap(api.get("/schools"))
    });
    const createMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/schools", payload)),
        onSuccess: async () => {
            toast.success("School created successfully");
            setForm(defaultSchoolValue);
            await queryClient.invalidateQueries({ queryKey: ["schools"] });
            await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const updateMutation = useMutation({
        mutationFn: async ({ schoolId, payload }) => unwrap(api.put(`/schools/${schoolId}`, payload)),
        onSuccess: async () => {
            toast.success("School updated successfully");
            setEditingSchoolId(null);
            setForm(defaultSchoolValue);
            await queryClient.invalidateQueries({ queryKey: ["schools"] });
            await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const deleteMutation = useMutation({
        mutationFn: async (schoolId) => unwrap(api.delete(`/schools/${schoolId}`)),
        onSuccess: async () => {
            toast.success("School and all associated data deleted");
            await queryClient.invalidateQueries({ queryKey: ["schools"] });
            await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "School Directory", description: "Create, edit, and manage tenant schools. Each school gets isolated data and an initial school admin account." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingSchoolId ? "Edit School" : "Create School" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "space-y-4", onSubmit: (event) => {
                                event.preventDefault();
                                if (editingSchoolId) {
                                    const parsed = schoolSchema.safeParse(form);
                                    if (!parsed.success) {
                                        toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                        return;
                                    }
                                    void updateMutation.mutateAsync({ schoolId: editingSchoolId, payload: parsed.data });
                                    return;
                                }
                                const parsed = createSchoolSchema.safeParse(form);
                                if (!parsed.success) {
                                    toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                    return;
                                }
                                void createMutation.mutateAsync(parsed.data);
                            }, children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "School Name (English)", children: _jsx(Input, { value: form.name, onChange: (event) => setForm((current) => ({ ...current, name: event.target.value })) }) }), _jsx(FormField, { label: "School Name (Nepali)", children: _jsx(Input, { value: form.nameNp, onChange: (event) => setForm((current) => ({ ...current, nameNp: event.target.value })) }) }), _jsx(FormField, { label: "Code", children: _jsx(Input, { value: form.code, onChange: (event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() })) }) }), _jsx(FormField, { label: "Academic Year (BS)", children: _jsx(Input, { value: form.academicYearBs, onChange: (event) => setForm((current) => ({ ...current, academicYearBs: event.target.value })) }) }), _jsx(FormField, { label: "School Email", children: _jsx(Input, { value: form.email, onChange: (event) => setForm((current) => ({ ...current, email: event.target.value })) }) }), _jsx(FormField, { label: "School Phone", children: _jsx(Input, { value: form.phone, onChange: (event) => setForm((current) => ({ ...current, phone: event.target.value })) }) }), _jsx(FormField, { label: "Principal Name", children: _jsx(Input, { value: form.principalName, onChange: (event) => setForm((current) => ({ ...current, principalName: event.target.value })) }) }), _jsx(FormField, { label: "Status", children: _jsxs(Select, { value: String(form.isActive), onChange: (event) => setForm((current) => ({ ...current, isActive: event.target.value === "true" })), children: [_jsx("option", { value: "true", children: "Active" }), _jsx("option", { value: "false", children: "Inactive" })] }) })] }), _jsx(AddressFields, { value: form.address, onChange: (address) => setForm((current) => ({ ...current, address })) }), editingSchoolId ? null : (_jsxs("div", { className: "grid gap-4 md:grid-cols-3", children: [_jsx(FormField, { label: "School Admin Name", children: _jsx(Input, { value: form.adminFullName, onChange: (event) => setForm((current) => ({ ...current, adminFullName: event.target.value })) }) }), _jsx(FormField, { label: "School Admin Email", children: _jsx(Input, { value: form.adminEmail, onChange: (event) => setForm((current) => ({ ...current, adminEmail: event.target.value })) }) }), _jsx(FormField, { label: "School Admin Phone", children: _jsx(Input, { value: form.adminPhone, onChange: (event) => setForm((current) => ({ ...current, adminPhone: event.target.value })) }) })] })), _jsxs("div", { className: "flex justify-end gap-2", children: [editingSchoolId ? (_jsx(Button, { type: "button", variant: "outline", onClick: () => {
                                                setEditingSchoolId(null);
                                                setForm(defaultSchoolValue);
                                            }, children: "Cancel" })) : null, _jsx(Button, { disabled: createMutation.isPending || updateMutation.isPending, type: "submit", children: editingSchoolId
                                                ? updateMutation.isPending
                                                    ? "Saving..."
                                                    : "Save Changes"
                                                : createMutation.isPending
                                                    ? "Creating..."
                                                    : "Create School" })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Schools" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Code" }), _jsx(Th, { children: "Academic Year" }), _jsx(Th, { children: "Principal" }), _jsx(Th, { children: "Status" }), _jsx(Th, { className: "text-right", children: "Actions" })] }) }), _jsx(TableBody, { children: (schoolsQuery.data ?? []).map((school) => (_jsxs("tr", { children: [_jsxs(Td, { children: [_jsx("div", { className: "font-medium text-slate-900", children: school.name }), _jsx("div", { className: "text-xs text-slate-500", children: school.email })] }), _jsx(Td, { children: school.code }), _jsx(Td, { children: school.academicYearBs }), _jsx(Td, { children: school.principalName }), _jsx(Td, { children: school.isActive ? "Active" : "Inactive" }), _jsx(Td, { className: "text-right", children: _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", disabled: deleteMutation.isPending || updateMutation.isPending, onClick: () => {
                                                                setEditingSchoolId(school._id);
                                                                setForm({ ...schoolToForm(school), adminFullName: "", adminEmail: "", adminPhone: "" });
                                                                window.scrollTo({ top: 0, behavior: "smooth" });
                                                            }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "destructive", disabled: deleteMutation.isPending || updateMutation.isPending, onClick: () => {
                                                                if (window.confirm(`Permanently delete "${school.name}" and ALL associated data (users, students, teachers, records, uploads)? This cannot be undone.`)) {
                                                                    if (editingSchoolId === school._id) {
                                                                        setEditingSchoolId(null);
                                                                        setForm(defaultSchoolValue);
                                                                    }
                                                                    void deleteMutation.mutateAsync(school._id);
                                                                }
                                                            }, children: "Delete" })] }) })] }, school._id))) })] }) })] })] }));
};
