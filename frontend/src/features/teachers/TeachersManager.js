import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { TeacherForm } from "./TeacherForm";
const mapTeacherToInput = (teacher) => ({
    fullName: teacher.user.fullName,
    email: teacher.user.email,
    phone: teacher.user.phone ?? "",
    teacherCode: teacher.teacherCode,
    qualification: teacher.qualification,
    joinedDateBs: teacher.joinedDateBs,
    address: teacher.address,
    subjects: teacher.subjects,
    assignedClassIds: teacher.assignedClassIds,
    assignedSectionIds: teacher.assignedSectionIds,
    basicSalaryNpr: teacher.basicSalaryNpr
});
export const TeachersManager = () => {
    const [editing, setEditing] = useState(null);
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers"))
    });
    const classesQuery = useQuery({
        queryKey: ["classes"],
        queryFn: () => unwrap(api.get("/academics/classes"))
    });
    const sectionsQuery = useQuery({
        queryKey: ["sections"],
        queryFn: () => unwrap(api.get("/academics/sections"))
    });
    const subjectsQuery = useQuery({
        queryKey: ["subjects"],
        queryFn: () => unwrap(api.get("/academics/subjects"))
    });
    const teacherMutation = useMutation({
        mutationFn: async (payload) => editing ? unwrap(api.put(`/teachers/${editing._id}`, payload)) : unwrap(api.post("/teachers", payload)),
        onSuccess: async () => {
            toast.success(editing ? "Teacher updated" : "Teacher created");
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["teachers"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            await api.delete(`/teachers/${id}`);
        },
        onSuccess: async () => {
            toast.success("Teacher deleted");
            await queryClient.invalidateQueries({ queryKey: ["teachers"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const classMap = useMemo(() => new Map((classesQuery.data ?? []).map((item) => [item._id, item.name])), [classesQuery.data]);
    const subjectMap = useMemo(() => new Map((subjectsQuery.data ?? []).map((item) => [item._id, item.name])), [subjectsQuery.data]);
    if (teachersQuery.isLoading || classesQuery.isLoading || sectionsQuery.isLoading || subjectsQuery.isLoading) {
        return _jsx(LoadingState, {});
    }
    const teachers = teachersQuery.data ?? [];
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Teacher Management", description: "Manage teacher accounts, qualifications, BS joining dates, classes, and subject assignments." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editing ? "Edit Teacher" : "Create Teacher" }) }), _jsx(CardContent, { children: _jsx(TeacherForm, { initialValue: editing ? mapTeacherToInput(editing) : undefined, classes: classesQuery.data ?? [], sections: sectionsQuery.data ?? [], subjects: subjectsQuery.data ?? [], submitting: teacherMutation.isPending, onCancel: editing ? () => setEditing(null) : undefined, onSubmit: async (value) => {
                                await teacherMutation.mutateAsync(value);
                            } }, editing?._id ?? "new-teacher") })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Teachers" }) }), _jsx(CardContent, { children: teachers.length === 0 ? (_jsx(EmptyState, { title: "No teachers yet", description: "Create teacher profiles and link them with subjects and class responsibilities." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Code" }), _jsx(Th, { children: "Qualification" }), _jsx(Th, { children: "Classes" }), _jsx(Th, { children: "Subjects" }), _jsx(Th, { children: "Salary" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: teachers.map((teacher) => (_jsxs("tr", { children: [_jsx(Td, { children: _jsxs("div", { children: [_jsx("div", { className: "font-medium text-slate-900", children: teacher.user.fullName }), _jsx("div", { className: "text-xs text-slate-500", children: teacher.user.email })] }) }), _jsx(Td, { children: teacher.teacherCode }), _jsx(Td, { children: teacher.qualification }), _jsx(Td, { children: teacher.assignedClassIds.map((id) => classMap.get(id) ?? id).join(", ") }), _jsx(Td, { children: teacher.subjects.map((id) => subjectMap.get(id) ?? id).join(", ") }), _jsx(Td, { children: formatCurrencyNpr(teacher.basicSalaryNpr) }), _jsx(Td, { className: "text-right", children: _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => setEditing(teacher), children: "Edit" }), _jsx(Button, { variant: "destructive", size: "sm", onClick: () => void deleteMutation.mutateAsync(teacher._id), children: "Delete" })] }) })] }, teacher._id))) })] }) })) })] })] }));
};
