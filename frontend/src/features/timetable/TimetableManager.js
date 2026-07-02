import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DAYS_OF_WEEK, timetableSlotSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useTeacherScope } from "hooks/useTeacherScope";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterSubjectsByClass, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";
const defaultSlot = {
    classId: "",
    sectionId: "",
    dayOfWeek: 1,
    periodNumber: 1,
    subjectId: "",
    teacherId: "",
    room: "",
    startTime: "10:00",
    endTime: "10:45",
    academicYearBs: "2083/2084"
};
export const TimetableManager = () => {
    const { user } = useAuth();
    const isTeacher = user?.role === "TEACHER";
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const teacherScopeQuery = useTeacherScope(isTeacher);
    const [form, setForm] = useState(defaultSlot);
    const classesQuery = useQuery({
        queryKey: ["classes"],
        queryFn: () => unwrap(api.get("/academics/classes")),
        enabled: isAdmin
    });
    const sectionsQuery = useQuery({
        queryKey: ["sections", form.classId],
        queryFn: () => unwrap(api.get("/academics/sections", { params: { classId: form.classId } })),
        enabled: isAdmin && Boolean(form.classId)
    });
    const subjectsQuery = useQuery({
        queryKey: ["subjects"],
        queryFn: () => unwrap(api.get("/academics/subjects")),
        enabled: isAdmin
    });
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers")),
        enabled: isAdmin
    });
    const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
    const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
    const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
    const teacherId = isTeacher ? teacherScopeQuery.data?.scope.teacherId ?? "" : form.teacherId;
    const filteredSections = useMemo(() => filterSectionsByClass(sections, form.classId), [form.classId, sections]);
    const filteredSubjects = useMemo(() => filterSubjectsByClass(subjects, form.classId), [form.classId, subjects]);
    useEffect(() => {
        if (!isTeacher || !teacherScopeQuery.data) {
            return;
        }
        setForm((current) => ({
            ...current,
            teacherId: teacherScopeQuery.data.scope.teacherId
        }));
    }, [isTeacher, teacherScopeQuery.data]);
    useEffect(() => {
        if (!isTeacher) {
            return;
        }
        if (hasSingleOption(classes) && form.classId !== classes[0]._id) {
            setForm((current) => ({ ...current, classId: classes[0]._id, sectionId: "", subjectId: "" }));
        }
    }, [classes, form.classId, isTeacher]);
    useEffect(() => {
        if (!isTeacher || !form.classId) {
            return;
        }
        if (hasSingleOption(filteredSections) && form.sectionId !== filteredSections[0]._id) {
            setForm((current) => ({ ...current, sectionId: filteredSections[0]._id, subjectId: "" }));
        }
    }, [filteredSections, form.classId, form.sectionId, isTeacher]);
    useEffect(() => {
        if (!isTeacher || !form.classId) {
            return;
        }
        if (hasSingleOption(filteredSubjects) && form.subjectId !== filteredSubjects[0]._id) {
            setForm((current) => ({ ...current, subjectId: filteredSubjects[0]._id }));
        }
    }, [filteredSubjects, form.classId, form.subjectId, isTeacher]);
    const timetableQuery = useQuery({
        queryKey: ["timetable", form.classId, form.sectionId],
        queryFn: () => unwrap(api.get("/timetable", { params: { classId: form.classId, sectionId: form.sectionId } })),
        enabled: Boolean(form.classId && form.sectionId)
    });
    const saveMutation = useMutation({
        mutationFn: (payload) => unwrap(api.post("/timetable", payload)),
        onSuccess: async () => {
            toast.success("Timetable slot saved");
            await queryClient.invalidateQueries({ queryKey: ["timetable"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const handleSubmit = (event) => {
        event.preventDefault();
        const payload = isTeacher ? { ...form, teacherId } : form;
        const parsed = timetableSlotSchema.safeParse(payload);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
        }
        saveMutation.mutate(parsed.data);
    };
    const renderClassField = () => {
        if (isTeacher && hasSingleOption(classes)) {
            return (_jsx(FormField, { label: "Class", children: _jsx(Input, { value: classes[0].name, readOnly: true, disabled: true }) }));
        }
        return (_jsx(FormField, { label: "Class", children: _jsxs(Select, { value: form.classId, onChange: (e) => setForm((c) => ({ ...c, classId: e.target.value, sectionId: "", subjectId: "" })), children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }));
    };
    const renderSectionField = () => {
        if (isTeacher && hasSingleOption(filteredSections)) {
            return (_jsx(FormField, { label: "Section", children: _jsx(Input, { value: filteredSections[0].name, readOnly: true, disabled: true }) }));
        }
        return (_jsx(FormField, { label: "Section", children: _jsxs(Select, { value: form.sectionId, onChange: (e) => setForm((c) => ({ ...c, sectionId: e.target.value, subjectId: "" })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "Select section" }), filteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }));
    };
    const renderSubjectField = () => {
        if (isTeacher && hasSingleOption(filteredSubjects)) {
            return (_jsx(FormField, { label: "Subject", children: _jsx(Input, { value: filteredSubjects[0].code
                        ? `${filteredSubjects[0].name} (${filteredSubjects[0].code})`
                        : filteredSubjects[0].name, readOnly: true, disabled: true }) }));
        }
        return (_jsx(FormField, { label: "Subject", children: _jsxs(Select, { value: form.subjectId, onChange: (e) => setForm((c) => ({ ...c, subjectId: e.target.value })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "Select subject" }), filteredSubjects.map((item) => (_jsxs("option", { value: item._id, children: [item.name, item.code ? ` (${item.code})` : ""] }, item._id)))] }) }));
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Timetable", description: isTeacher
                    ? "Add timetable slots for your assigned classes, sections, and subjects."
                    : "Build class-section schedules by day and period." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Add slot" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-3", onSubmit: handleSubmit, children: [renderClassField(), renderSectionField(), _jsx(FormField, { label: "Day", children: _jsx(Select, { value: String(form.dayOfWeek), onChange: (e) => setForm((c) => ({ ...c, dayOfWeek: Number(e.target.value) })), children: DAYS_OF_WEEK.map((day, index) => (_jsx("option", { value: index, children: day }, day))) }) }), _jsx(FormField, { label: "Period", children: _jsx(Input, { type: "number", min: 1, value: form.periodNumber, onChange: (e) => setForm((c) => ({ ...c, periodNumber: Number(e.target.value) })) }) }), renderSubjectField(), isAdmin ? (_jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: form.teacherId, onChange: (e) => setForm((c) => ({ ...c, teacherId: e.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), (teachersQuery.data ?? []).map((t) => (_jsx("option", { value: t._id, children: t.user.fullName }, t._id)))] }) })) : null, _jsx(FormField, { label: "Start", children: _jsx(Input, { value: form.startTime, onChange: (e) => setForm((c) => ({ ...c, startTime: e.target.value })) }) }), _jsx(FormField, { label: "End", children: _jsx(Input, { value: form.endTime, onChange: (e) => setForm((c) => ({ ...c, endTime: e.target.value })) }) }), _jsx(FormField, { label: "Room", children: _jsx(Input, { value: form.room, onChange: (e) => setForm((c) => ({ ...c, room: e.target.value })) }) }), _jsx("div", { className: "md:col-span-3", children: _jsx(Button, { type: "submit", disabled: isTeacher && teacherScopeQuery.isLoading, children: "Save slot" }) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Schedule" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Day" }), _jsx(Th, { children: "Period" }), _jsx(Th, { children: "Subject" }), _jsx(Th, { children: "Teacher" }), _jsx(Th, { children: "Time" }), _jsx(Th, { children: "Room" })] }) }), _jsx(TableBody, { children: (timetableQuery.data ?? []).map((slot) => (_jsxs("tr", { children: [_jsx(Td, { children: DAYS_OF_WEEK[slot.dayOfWeek] }), _jsx(Td, { children: slot.periodNumber }), _jsx(Td, { children: slot.subjectId?.name ?? "—" }), _jsx(Td, { children: slot.teacherId?.user?.fullName ?? "—" }), _jsxs(Td, { children: [slot.startTime, " \u2013 ", slot.endTime] }), _jsx(Td, { children: slot.room ?? "—" })] }, slot._id))) })] }) })] })] }));
};
