import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { noticeSchema, USER_ROLES } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherScope } from "hooks/useTeacherScope";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { StudentNoticeBoard } from "features/notices/StudentNoticeBoard";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterSubjectsByClass, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";
const adminDefaultNoticeValue = {
    title: "",
    content: "",
    visibleTo: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"],
    publishDateBs: "",
    expiresAtBs: ""
};
const teacherDefaultNoticeValue = {
    title: "",
    content: "",
    visibleTo: ["STUDENT"],
    publishDateBs: "",
    expiresAtBs: ""
};
export const NoticeManager = () => {
    const { user } = useAuth();
    const isTeacher = user?.role === "TEACHER";
    const teacherScopeQuery = useTeacherScope(isTeacher);
    const [form, setForm] = useState(adminDefaultNoticeValue);
    const [editingId, setEditingId] = useState(null);
    const canManageNotices = user?.role === "SUPER_ADMIN" || user?.role === "SCHOOL_ADMIN" || isTeacher;
    const isReadOnlyViewer = user?.role === "STUDENT" || user?.role === "PARENT";
    useEffect(() => {
        if (isTeacher) {
            setForm((current) => ({ ...current, visibleTo: ["STUDENT"] }));
        }
    }, [isTeacher]);
    useEffect(() => {
        if (!isTeacher || !teacherScopeQuery.data) {
            return;
        }
        const { classes: scopedClasses, sections: scopedSectionsList, subjects: scopedSubjectsList } = teacherScopeQuery.data;
        setForm((current) => {
            const next = { ...current };
            if (hasSingleOption(scopedClasses)) {
                next.classId = scopedClasses[0]._id;
            }
            const classSections = filterSectionsByClass(scopedSectionsList, next.classId ?? "");
            if (hasSingleOption(classSections)) {
                next.sectionId = classSections[0]._id;
            }
            const classSubjects = filterSubjectsByClass(scopedSubjectsList, next.classId ?? "");
            if (hasSingleOption(classSubjects)) {
                next.subjectId = classSubjects[0]._id;
            }
            return next;
        });
    }, [isTeacher, teacherScopeQuery.data]);
    const noticesQuery = useQuery({
        queryKey: ["notices"],
        queryFn: () => unwrap(api.get("/notices"))
    });
    const noticeMutation = useMutation({
        mutationFn: async (payload) => editingId ? unwrap(api.put(`/notices/${editingId}`, payload)) : unwrap(api.post("/notices", payload)),
        onSuccess: async () => {
            toast.success(editingId ? "Notice updated" : "Notice published");
            setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
            setEditingId(null);
            await queryClient.invalidateQueries({ queryKey: ["notices"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            await api.delete(`/notices/${id}`);
        },
        onSuccess: async () => {
            toast.success("Notice deleted");
            setEditingId(null);
            setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
            await queryClient.invalidateQueries({ queryKey: ["notices"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const teacherClassMap = useMemo(() => new Map((teacherScopeQuery.data?.classes ?? []).map((item) => [item._id, item.name])), [teacherScopeQuery.data?.classes]);
    const teacherSectionMap = useMemo(() => new Map((teacherScopeQuery.data?.sections ?? []).map((item) => [item._id, item.name])), [teacherScopeQuery.data?.sections]);
    const teacherSubjectMap = useMemo(() => new Map((teacherScopeQuery.data?.subjects ?? []).map((item) => [item._id, item.name])), [teacherScopeQuery.data?.subjects]);
    const announcements = useMemo(() => {
        const notices = noticesQuery.data ?? [];
        if (!isTeacher) {
            return notices;
        }
        const teacherId = teacherScopeQuery.data?.scope.teacherId;
        return notices.filter((notice) => notice.teacherId === teacherId && notice.visibleTo.includes("STUDENT"));
    }, [isTeacher, noticesQuery.data, teacherScopeQuery.data?.scope.teacherId]);
    const formatTeacherAudience = (notice) => {
        const parts = ["Students"];
        if (notice.classId) {
            parts.push(teacherClassMap.get(notice.classId) ?? "Class");
        }
        if (notice.sectionId) {
            parts.push(teacherSectionMap.get(notice.sectionId) ?? "Section");
        }
        if (notice.subjectId) {
            parts.push(teacherSubjectMap.get(notice.subjectId) ?? "Subject");
        }
        return parts.join(" · ");
    };
    if (noticesQuery.isLoading) {
        return _jsx(EmptyState, { title: "Loading notices", description: "Please wait." });
    }
    return (_jsxs(PageContent, { className: "space-y-6", children: [_jsx(PageHeader, { title: "Notice Board", description: isReadOnlyViewer
                    ? "Announcements for your class, subjects, and school."
                    : isTeacher
                        ? "Publish notices visible to your students in assigned classes and sections."
                        : "Publish notices and control visibility by role." }), canManageNotices ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingId ? "Edit Notice" : "Create Notice" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "space-y-4", onSubmit: (event) => {
                                event.preventDefault();
                                const payload = isTeacher ? { ...form, visibleTo: ["STUDENT"] } : form;
                                const parsed = noticeSchema.safeParse(payload);
                                if (!parsed.success) {
                                    toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                    return;
                                }
                                void noticeMutation.mutateAsync(parsed.data);
                            }, children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: "Title", children: _jsx(Input, { value: form.title, onChange: (event) => setForm((current) => ({ ...current, title: event.target.value })) }) }), isTeacher ? (_jsx(FormField, { label: "Visible To", children: _jsx(Input, { value: "Students", readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Visible To", children: _jsx("div", { className: "grid grid-cols-2 gap-2", children: USER_ROLES.map((role) => (_jsxs("label", { className: "flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm", children: [_jsx("input", { checked: form.visibleTo.includes(role), type: "checkbox", onChange: (event) => setForm((current) => ({
                                                                ...current,
                                                                visibleTo: event.target.checked
                                                                    ? [...current.visibleTo, role]
                                                                    : current.visibleTo.filter((item) => item !== role)
                                                            })) }), role] }, role))) }) })), _jsx(FormField, { label: "Publish Date (BS)", children: _jsx(NepaliDateField, { value: form.publishDateBs, onChange: (value) => setForm((current) => ({ ...current, publishDateBs: value })) }) }), _jsx(FormField, { label: "Expiry Date (BS)", children: _jsx(NepaliDateField, { value: form.expiresAtBs ?? "", onChange: (value) => setForm((current) => ({ ...current, expiresAtBs: value })) }) }), isTeacher ? (_jsx(_Fragment, { children: (() => {
                                                const scopedClasses = teacherScopeQuery.data?.classes ?? [];
                                                const scopedSections = filterSectionsByClass(teacherScopeQuery.data?.sections ?? [], form.classId ?? "");
                                                const scopedSubjects = filterSubjectsByClass(teacherScopeQuery.data?.subjects ?? [], form.classId ?? "");
                                                return (_jsxs(_Fragment, { children: [hasSingleOption(scopedClasses) ? (_jsx(FormField, { label: "Class", children: _jsx(Input, { value: scopedClasses[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Class (optional)", children: _jsxs("select", { className: "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm", value: form.classId ?? "", onChange: (event) => setForm((current) => ({
                                                                    ...current,
                                                                    classId: event.target.value || undefined,
                                                                    sectionId: undefined,
                                                                    subjectId: undefined
                                                                })), children: [_jsx("option", { value: "", children: "All assigned classes" }), scopedClasses.map((schoolClass) => (_jsx("option", { value: schoolClass._id, children: schoolClass.name }, schoolClass._id)))] }) })), hasSingleOption(scopedSections) ? (_jsx(FormField, { label: "Section", children: _jsx(Input, { value: scopedSections[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Section (optional)", children: _jsxs("select", { className: "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm", value: form.sectionId ?? "", onChange: (event) => setForm((current) => ({ ...current, sectionId: event.target.value || undefined })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "All assigned sections" }), scopedSections.map((section) => (_jsx("option", { value: section._id, children: section.name }, section._id)))] }) })), hasSingleOption(scopedSubjects) ? (_jsx(FormField, { label: "Subject", children: _jsx(Input, { value: scopedSubjects[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Subject (optional)", children: _jsxs("select", { className: "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm", value: form.subjectId ?? "", onChange: (event) => setForm((current) => ({ ...current, subjectId: event.target.value || undefined })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "School-wide notice" }), scopedSubjects.map((subject) => (_jsx("option", { value: subject._id, children: subject.name }, subject._id)))] }) }))] }));
                                            })() })) : null] }), _jsx(FormField, { label: "Content", children: _jsx(Textarea, { value: form.content, onChange: (event) => setForm((current) => ({ ...current, content: event.target.value })) }) }), _jsxs("div", { className: "flex justify-end gap-2", children: [editingId ? (_jsx(Button, { type: "button", variant: "outline", onClick: () => {
                                                setEditingId(null);
                                                setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
                                            }, children: "Cancel" })) : null, _jsx(Button, { type: "submit", children: editingId ? "Update Notice" : "Publish Notice" })] })] }) })] })) : null, _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: isTeacher ? "My Student Announcements" : "Announcements" }) }), _jsx(CardContent, { children: isReadOnlyViewer ? (_jsx(StudentNoticeBoard, { notices: (noticesQuery.data ?? []) })) : announcements.length === 0 ? (_jsx(EmptyState, { title: "No notices yet", description: isTeacher
                                ? "Your published student notices will appear here."
                                : "Published notices will appear here for the selected roles." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Title" }), _jsx(Th, { children: isTeacher ? "Audience" : "Visible To" }), _jsx(Th, { children: "Publish Date" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: announcements.map((notice) => (_jsxs("tr", { children: [_jsxs(Td, { children: [_jsx("div", { className: "font-medium text-slate-900", children: notice.title }), _jsx("div", { className: "text-xs text-slate-500", children: notice.content })] }), _jsx(Td, { children: isTeacher ? formatTeacherAudience(notice) : notice.visibleTo.join(", ") }), _jsx(Td, { children: notice.publishDateBs }), _jsx(Td, { className: "text-right", children: canManageNotices ? (_jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                                    setEditingId(notice._id);
                                                                    setForm({
                                                                        title: notice.title,
                                                                        content: notice.content,
                                                                        visibleTo: isTeacher ? ["STUDENT"] : notice.visibleTo,
                                                                        publishDateBs: notice.publishDateBs,
                                                                        expiresAtBs: notice.expiresAtBs ?? "",
                                                                        classId: notice.classId,
                                                                        sectionId: notice.sectionId,
                                                                        subjectId: notice.subjectId
                                                                    });
                                                                }, children: "Edit" }), isTeacher ? (_jsx(Button, { size: "sm", variant: "destructive", disabled: deleteMutation.isPending, onClick: () => void deleteMutation.mutateAsync(notice._id), children: "Delete" })) : null] })) : null })] }, notice._id))) })] }) })) })] })] }));
};
