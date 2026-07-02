import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { useTeacherScope } from "hooks/useTeacherScope";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { StudentForm } from "./StudentForm";
const mapStudentToInput = (student) => ({
    fullName: student.user.fullName,
    email: student.user.email,
    phone: student.user.phone ?? "",
    admissionNumber: student.admissionNumber,
    rollNumber: student.rollNumber,
    classId: student.classId,
    sectionId: student.sectionId,
    admissionDateBs: student.admissionDateBs,
    dateOfBirthBs: student.dateOfBirthBs,
    gender: student.gender,
    bloodGroup: student.bloodGroup,
    address: student.address,
    fatherName: student.fatherName,
    motherName: student.motherName,
    guardianName: student.guardianName,
    guardianPhone: student.guardianPhone,
    feesDueNpr: student.feesDueNpr,
    remarks: student.remarks ?? ""
});
export const StudentsManager = () => {
    const { user } = useAuth();
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const isTeacher = user?.role === "TEACHER";
    const canManage = isAdmin;
    const teacherScopeQuery = useTeacherScope(isTeacher);
    const [editing, setEditing] = useState(null);
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students")),
        enabled: isAdmin
    });
    const classesQuery = useQuery({
        queryKey: ["classes"],
        queryFn: () => unwrap(api.get("/academics/classes")),
        enabled: isAdmin
    });
    const sectionsQuery = useQuery({
        queryKey: ["sections"],
        queryFn: () => unwrap(api.get("/academics/sections")),
        enabled: isAdmin
    });
    const studentMutation = useMutation({
        mutationFn: async (payload) => editing ? unwrap(api.put(`/students/${editing._id}`, payload)) : unwrap(api.post("/students", payload)),
        onSuccess: async () => {
            toast.success(editing ? "Student updated" : "Student created");
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["students"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            await api.delete(`/students/${id}`);
        },
        onSuccess: async () => {
            toast.success("Student deleted");
            await queryClient.invalidateQueries({ queryKey: ["students"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
    const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
    const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);
    const classMap = useMemo(() => new Map(classes.map((item) => [item._id, item.name])), [classes]);
    const sectionMap = useMemo(() => new Map(sections.map((item) => [item._id, item.name])), [sections]);
    const isLoading = isTeacher
        ? teacherScopeQuery.isLoading
        : studentsQuery.isLoading || classesQuery.isLoading || sectionsQuery.isLoading;
    if (isLoading) {
        return _jsx(LoadingState, {});
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: canManage ? "Student Management" : "My Students", description: canManage
                    ? "Admissions, BS dates, Nepal address data, guardian details, and fee due tracking."
                    : "Students in your assigned classes and sections. Contact the school admin to register new students." }), canManage ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editing ? "Edit Student" : "Create Student" }) }), _jsx(CardContent, { children: _jsx(StudentForm, { initialValue: editing ? mapStudentToInput(editing) : undefined, classes: classesQuery.data ?? [], sections: sectionsQuery.data ?? [], submitting: studentMutation.isPending, onCancel: editing ? () => setEditing(null) : undefined, onSubmit: async (value) => {
                                await studentMutation.mutateAsync(value);
                            } }, editing?._id ?? "new-student") })] })) : null, _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: canManage ? "Students" : "Assigned Students" }) }), _jsx(CardContent, { children: students.length === 0 ? (_jsx(EmptyState, { title: "No students found", description: canManage
                                ? "Start by registering a student profile with BS admission and DOB information."
                                : "No students are assigned to your classes and sections yet." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Roll No." }), _jsx(Th, { children: "Admission No." }), _jsx(Th, { children: "Class" }), _jsx(Th, { children: "Section" }), _jsx(Th, { children: "Guardian" }), canManage ? _jsx(Th, { children: "Fees Due" }) : null, canManage ? _jsx(Th, {}) : null] }) }), _jsx(TableBody, { children: students.map((student) => (_jsxs("tr", { children: [_jsx(Td, { children: _jsxs("div", { children: [_jsx("div", { className: "font-medium text-slate-900", children: student.user.fullName }), _jsx("div", { className: "text-xs text-slate-500", children: student.user.email })] }) }), _jsx(Td, { children: student.rollNumber }), _jsx(Td, { children: student.admissionNumber }), _jsx(Td, { children: classMap.get(student.classId) ?? student.classId }), _jsx(Td, { children: sectionMap.get(student.sectionId) ?? student.sectionId }), _jsx(Td, { children: student.guardianName }), canManage ? _jsx(Td, { children: formatCurrencyNpr(student.feesDueNpr) }) : null, canManage ? (_jsx(Td, { className: "text-right", children: _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => setEditing(student), children: "Edit" }), _jsx(Button, { variant: "destructive", size: "sm", onClick: () => void deleteMutation.mutateAsync(student._id), children: "Delete" })] }) })) : null] }, student._id))) })] }) })) })] })] }));
};
