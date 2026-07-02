import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CLASS_LEVELS, classSchema, sectionSchema, subjectSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
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
const defaultClassValue = {
    name: "",
    level: "ECD",
    academicYearBs: "2083/2084",
    coordinatorId: "",
    isActive: true
};
const defaultSectionValue = {
    name: "",
    classId: "",
    room: "",
    capacity: 40,
    classTeacherId: ""
};
const defaultSubjectValue = {
    name: "",
    code: "",
    classIds: [],
    teacherIds: [],
    fullMarks: 100,
    passMarks: 35
};
export const AcademicManager = () => {
    const [classForm, setClassForm] = useState(defaultClassValue);
    const [sectionForm, setSectionForm] = useState(defaultSectionValue);
    const [subjectForm, setSubjectForm] = useState(defaultSubjectValue);
    const [editingClassId, setEditingClassId] = useState(null);
    const [editingSectionId, setEditingSectionId] = useState(null);
    const [editingSubjectId, setEditingSubjectId] = useState(null);
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
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers"))
    });
    const refreshAcademicQueries = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["classes"] }),
            queryClient.invalidateQueries({ queryKey: ["sections"] }),
            queryClient.invalidateQueries({ queryKey: ["subjects"] })
        ]);
    };
    const classMutation = useMutation({
        mutationFn: async (payload) => editingClassId ? unwrap(api.put(`/academics/classes/${editingClassId}`, payload)) : unwrap(api.post("/academics/classes", payload)),
        onSuccess: async () => {
            toast.success(editingClassId ? "Class updated" : "Class created");
            setClassForm(defaultClassValue);
            setEditingClassId(null);
            await refreshAcademicQueries();
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const sectionMutation = useMutation({
        mutationFn: async (payload) => editingSectionId ? unwrap(api.put(`/academics/sections/${editingSectionId}`, payload)) : unwrap(api.post("/academics/sections", payload)),
        onSuccess: async () => {
            toast.success(editingSectionId ? "Section updated" : "Section created");
            setSectionForm(defaultSectionValue);
            setEditingSectionId(null);
            await refreshAcademicQueries();
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const subjectMutation = useMutation({
        mutationFn: async (payload) => editingSubjectId ? unwrap(api.put(`/academics/subjects/${editingSubjectId}`, payload)) : unwrap(api.post("/academics/subjects", payload)),
        onSuccess: async () => {
            toast.success(editingSubjectId ? "Subject updated" : "Subject created");
            setSubjectForm(defaultSubjectValue);
            setEditingSubjectId(null);
            await refreshAcademicQueries();
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const deleteEntity = async (path, queryKey) => {
        try {
            await api.delete(path);
            toast.success("Deleted successfully");
            await queryClient.invalidateQueries({ queryKey: [queryKey] });
        }
        catch (error) {
            toast.error(parseErrorMessage(error));
        }
    };
    const classes = classesQuery.data ?? [];
    const sections = sectionsQuery.data ?? [];
    const subjects = subjectsQuery.data ?? [];
    const teachers = teachersQuery.data ?? [];
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Academic Setup", description: "Configure classes, sections, and subjects for BS academic years starting from Baisakh." }), _jsxs("div", { className: "grid gap-6 xl:grid-cols-3", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Classes" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("form", { className: "space-y-3", onSubmit: (event) => {
                                            event.preventDefault();
                                            const parsed = classSchema.safeParse(classForm);
                                            if (!parsed.success) {
                                                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                                return;
                                            }
                                            void classMutation.mutateAsync(parsed.data);
                                        }, children: [_jsx(FormField, { label: "Class Name", children: _jsx(Input, { value: classForm.name, onChange: (event) => setClassForm((current) => ({ ...current, name: event.target.value })) }) }), _jsx(FormField, { label: "Level", children: _jsx(Select, { value: classForm.level, onChange: (event) => setClassForm((current) => ({ ...current, level: event.target.value })), children: CLASS_LEVELS.map((level) => (_jsx("option", { value: level, children: level }, level))) }) }), _jsx(FormField, { label: "Academic Year (BS)", children: _jsx(Input, { value: classForm.academicYearBs, onChange: (event) => setClassForm((current) => ({ ...current, academicYearBs: event.target.value })) }) }), _jsx(FormField, { label: "Coordinator", children: _jsxs(Select, { value: classForm.coordinatorId ?? "", onChange: (event) => setClassForm((current) => ({ ...current, coordinatorId: event.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), teachers.map((teacher) => (_jsx("option", { value: teacher._id, children: teacher.user.fullName }, teacher._id)))] }) }), _jsx(Button, { className: "w-full", type: "submit", children: editingClassId ? "Update Class" : "Create Class" })] }), classes.length === 0 ? (_jsx(EmptyState, { title: "No classes", description: "Create ECD through Class 12 records for the active academic year." })) : (_jsx("div", { className: "space-y-3", children: classes.map((item) => (_jsx("div", { className: "rounded-2xl border border-slate-200 p-4", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-slate-900", children: item.name }), _jsx("p", { className: "text-sm text-slate-500", children: item.academicYearBs })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                                    setEditingClassId(item._id);
                                                                    setClassForm({
                                                                        name: item.name,
                                                                        level: item.level,
                                                                        academicYearBs: item.academicYearBs,
                                                                        coordinatorId: item.coordinatorId ?? "",
                                                                        isActive: item.isActive
                                                                    });
                                                                }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => void deleteEntity(`/academics/classes/${item._id}`, "classes"), children: "Delete" })] })] }) }, item._id))) }))] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Sections" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("form", { className: "space-y-3", onSubmit: (event) => {
                                            event.preventDefault();
                                            const parsed = sectionSchema.safeParse(sectionForm);
                                            if (!parsed.success) {
                                                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                                return;
                                            }
                                            void sectionMutation.mutateAsync(parsed.data);
                                        }, children: [_jsx(FormField, { label: "Section Name", children: _jsx(Input, { value: sectionForm.name, onChange: (event) => setSectionForm((current) => ({ ...current, name: event.target.value })) }) }), _jsx(FormField, { label: "Class", children: _jsxs(Select, { value: sectionForm.classId, onChange: (event) => setSectionForm((current) => ({ ...current, classId: event.target.value })), children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Room", children: _jsx(Input, { value: sectionForm.room ?? "", onChange: (event) => setSectionForm((current) => ({ ...current, room: event.target.value })) }) }), _jsx(FormField, { label: "Capacity", children: _jsx(Input, { type: "number", value: sectionForm.capacity, onChange: (event) => setSectionForm((current) => ({ ...current, capacity: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Class Teacher", children: _jsxs(Select, { value: sectionForm.classTeacherId ?? "", onChange: (event) => setSectionForm((current) => ({ ...current, classTeacherId: event.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), teachers.map((teacher) => (_jsx("option", { value: teacher._id, children: teacher.user.fullName }, teacher._id)))] }) }), _jsx(Button, { className: "w-full", type: "submit", children: editingSectionId ? "Update Section" : "Create Section" })] }), _jsx("div", { className: "space-y-3", children: sections.map((section) => (_jsx("div", { className: "rounded-2xl border border-slate-200 p-4", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-slate-900", children: section.name }), _jsxs("p", { className: "text-sm text-slate-500", children: [classes.find((item) => item._id === section.classId)?.name ?? section.classId, " / ", section.room || "No room"] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                                    setEditingSectionId(section._id);
                                                                    setSectionForm({
                                                                        name: section.name,
                                                                        classId: section.classId,
                                                                        room: section.room ?? "",
                                                                        capacity: section.capacity,
                                                                        classTeacherId: section.classTeacherId ?? ""
                                                                    });
                                                                }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => void deleteEntity(`/academics/sections/${section._id}`, "sections"), children: "Delete" })] })] }) }, section._id))) })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Subjects" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("form", { className: "space-y-3", onSubmit: (event) => {
                                            event.preventDefault();
                                            const parsed = subjectSchema.safeParse(subjectForm);
                                            if (!parsed.success) {
                                                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                                return;
                                            }
                                            void subjectMutation.mutateAsync(parsed.data);
                                        }, children: [_jsx(FormField, { label: "Subject Name", children: _jsx(Input, { value: subjectForm.name, onChange: (event) => setSubjectForm((current) => ({ ...current, name: event.target.value })) }) }), _jsx(FormField, { label: "Code", children: _jsx(Input, { value: subjectForm.code, onChange: (event) => setSubjectForm((current) => ({ ...current, code: event.target.value })) }) }), _jsx(FormField, { label: "Full Marks", children: _jsx(Input, { type: "number", value: subjectForm.fullMarks, onChange: (event) => setSubjectForm((current) => ({ ...current, fullMarks: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Pass Marks", children: _jsx(Input, { type: "number", value: subjectForm.passMarks, onChange: (event) => setSubjectForm((current) => ({ ...current, passMarks: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Class IDs (comma separated)", children: _jsx(Input, { value: subjectForm.classIds.join(", "), onChange: (event) => setSubjectForm((current) => ({
                                                        ...current,
                                                        classIds: event.target.value
                                                            .split(",")
                                                            .map((item) => item.trim())
                                                            .filter(Boolean)
                                                    })) }) }), _jsx(FormField, { label: "Teacher IDs (comma separated)", children: _jsx(Input, { value: subjectForm.teacherIds.join(", "), onChange: (event) => setSubjectForm((current) => ({
                                                        ...current,
                                                        teacherIds: event.target.value
                                                            .split(",")
                                                            .map((item) => item.trim())
                                                            .filter(Boolean)
                                                    })) }) }), _jsx(Button, { className: "w-full", type: "submit", children: editingSubjectId ? "Update Subject" : "Create Subject" })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Subject" }), _jsx(Th, { children: "Marks" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: subjects.map((subject) => (_jsxs("tr", { children: [_jsxs(Td, { children: [_jsx("div", { className: "font-medium", children: subject.name }), _jsx("div", { className: "text-xs text-slate-500", children: subject.code })] }), _jsxs(Td, { children: [subject.passMarks, "/", subject.fullMarks] }), _jsx(Td, { className: "text-right", children: _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                                                setEditingSubjectId(subject._id);
                                                                                setSubjectForm({
                                                                                    name: subject.name,
                                                                                    code: subject.code,
                                                                                    classIds: subject.classIds,
                                                                                    teacherIds: subject.teacherIds,
                                                                                    fullMarks: subject.fullMarks,
                                                                                    passMarks: subject.passMarks
                                                                                });
                                                                            }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => void deleteEntity(`/academics/subjects/${subject._id}`, "subjects"), children: "Delete" })] }) })] }, subject._id))) })] }) })] })] })] })] }));
};
