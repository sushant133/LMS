import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
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
const statuses = ["PRESENT", "ABSENT", "LEAVE", "LATE"];
const statusBadgeStyles = {
    PRESENT: "bg-emerald-100 text-emerald-800",
    ABSENT: "bg-rose-100 text-rose-800",
    LATE: "bg-amber-100 text-amber-800",
    LEAVE: "bg-sky-100 text-sky-800"
};
const StatusBadge = ({ status }) => {
    if (status === "NOT_MARKED") {
        return _jsx(Badge, { className: "bg-slate-100 text-slate-600", children: "Not marked" });
    }
    return _jsx(Badge, { className: statusBadgeStyles[status], children: status });
};
export const AttendanceManager = () => {
    const { user } = useAuth();
    const isTeacher = user?.role === "TEACHER";
    const isAdminViewer = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const canMark = isTeacher;
    const teacherScopeQuery = useTeacherScope(isTeacher);
    const [classId, setClassId] = useState("");
    const [sectionId, setSectionId] = useState("");
    const [subjectId, setSubjectId] = useState("");
    const [dateBs, setDateBs] = useState("");
    const [statusMap, setStatusMap] = useState({});
    const classesQuery = useQuery({
        queryKey: ["classes"],
        queryFn: () => unwrap(api.get("/academics/classes")),
        enabled: isAdminViewer
    });
    const sectionsQuery = useQuery({
        queryKey: ["sections"],
        queryFn: () => unwrap(api.get("/academics/sections")),
        enabled: isAdminViewer
    });
    const subjectsQuery = useQuery({
        queryKey: ["subjects"],
        queryFn: () => unwrap(api.get("/academics/subjects")),
        enabled: isAdminViewer
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students")),
        enabled: isAdminViewer
    });
    const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
    const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
    const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
    const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);
    const filtersComplete = Boolean(classId && sectionId && subjectId && dateBs);
    const attendanceQuery = useQuery({
        queryKey: ["attendance", classId, sectionId, subjectId, dateBs],
        queryFn: () => unwrap(api.get("/attendance", {
            params: { classId, sectionId, subjectId, dateBs }
        })),
        enabled: filtersComplete
    });
    const saveAttendance = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/attendance", payload)),
        onSuccess: async () => {
            toast.success("Attendance saved");
            await queryClient.invalidateQueries({ queryKey: ["attendance"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const filteredSections = useMemo(() => filterSectionsByClass(sections, classId), [classId, sections]);
    const filteredSubjects = useMemo(() => filterSubjectsByClass(subjects, classId), [classId, subjects]);
    useEffect(() => {
        if (!isTeacher) {
            return;
        }
        if (hasSingleOption(classes) && classId !== classes[0]._id) {
            setClassId(classes[0]._id);
            setSectionId("");
            setSubjectId("");
        }
    }, [classId, classes, isTeacher]);
    useEffect(() => {
        if (!isTeacher || !classId) {
            return;
        }
        if (hasSingleOption(filteredSections) && sectionId !== filteredSections[0]._id) {
            setSectionId(filteredSections[0]._id);
            setSubjectId("");
        }
    }, [classId, filteredSections, isTeacher, sectionId]);
    useEffect(() => {
        if (!isTeacher || !classId) {
            return;
        }
        if (hasSingleOption(filteredSubjects) && subjectId !== filteredSubjects[0]._id) {
            setSubjectId(filteredSubjects[0]._id);
        }
    }, [classId, filteredSubjects, isTeacher, subjectId]);
    const filteredStudents = useMemo(() => students.filter((student) => student.classId === classId && student.sectionId === sectionId), [classId, sectionId, students]);
    useEffect(() => {
        const existing = attendanceQuery.data?.[0];
        if (!existing) {
            setStatusMap({});
            return;
        }
        const nextStatusMap = existing.entries.reduce((acc, item) => {
            acc[item.studentId] = item.status;
            return acc;
        }, {});
        setStatusMap(nextStatusMap);
    }, [attendanceQuery.data]);
    const summary = useMemo(() => {
        const counts = { present: 0, absent: 0, late: 0, leave: 0, notMarked: 0 };
        filteredStudents.forEach((student) => {
            const status = statusMap[student._id];
            if (!status) {
                counts.notMarked += 1;
                return;
            }
            if (status === "PRESENT")
                counts.present += 1;
            if (status === "ABSENT")
                counts.absent += 1;
            if (status === "LATE")
                counts.late += 1;
            if (status === "LEAVE")
                counts.leave += 1;
        });
        return counts;
    }, [filteredStudents, statusMap]);
    const isLoading = isTeacher
        ? teacherScopeQuery.isLoading
        : classesQuery.isLoading || sectionsQuery.isLoading || studentsQuery.isLoading || subjectsQuery.isLoading;
    if (isLoading) {
        return _jsx(LoadingState, {});
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Attendance", description: canMark
                    ? "Mark subject-wise attendance for your assigned classes. Each record is stored per subject and teacher."
                    : "View attendance results by class, section, subject, and date. Teachers mark attendance from their section." }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: canMark ? "Attendance Sheet" : "Attendance Lookup" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-4", children: [_jsxs("div", { children: [_jsx("label", { className: "mb-2 block text-sm font-medium text-slate-700", children: "Class" }), isTeacher && hasSingleOption(classes) ? (_jsx(Input, { value: classes[0].name, readOnly: true, disabled: true })) : (_jsxs(Select, { value: classId, onChange: (event) => {
                                            setClassId(event.target.value);
                                            setSectionId("");
                                            setSubjectId("");
                                        }, children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-2 block text-sm font-medium text-slate-700", children: "Section" }), isTeacher && hasSingleOption(filteredSections) ? (_jsx(Input, { value: filteredSections[0].name, readOnly: true, disabled: true })) : (_jsxs(Select, { value: sectionId, onChange: (event) => {
                                            setSectionId(event.target.value);
                                            setSubjectId("");
                                        }, disabled: !classId, children: [_jsx("option", { value: "", children: "Select section" }), filteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-2 block text-sm font-medium text-slate-700", children: "Subject" }), isTeacher && hasSingleOption(filteredSubjects) ? (_jsx(Input, { value: filteredSubjects[0].code
                                            ? `${filteredSubjects[0].name} (${filteredSubjects[0].code})`
                                            : filteredSubjects[0].name, readOnly: true, disabled: true })) : (_jsxs(Select, { value: subjectId, onChange: (event) => setSubjectId(event.target.value), disabled: !classId, children: [_jsx("option", { value: "", children: "Select subject" }), filteredSubjects.map((item) => (_jsxs("option", { value: item._id, children: [item.name, " (", item.code, ")"] }, item._id)))] }))] }), _jsxs("div", { children: [_jsx("label", { className: "mb-2 block text-sm font-medium text-slate-700", children: "Date (BS)" }), _jsx(NepaliDateField, { value: dateBs, onChange: setDateBs })] })] })] }), filtersComplete ? (_jsxs(_Fragment, { children: [isAdminViewer ? (_jsx("div", { className: "grid gap-4 sm:grid-cols-2 xl:grid-cols-5", children: [
                            { label: "Present", value: summary.present, className: "text-emerald-700" },
                            { label: "Absent", value: summary.absent, className: "text-rose-600" },
                            { label: "Late", value: summary.late, className: "text-amber-600" },
                            { label: "Leave", value: summary.leave, className: "text-sky-700" },
                            { label: "Not marked", value: summary.notMarked, className: "text-slate-600" }
                        ].map((stat) => (_jsx(Card, { className: "bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]", children: _jsxs(CardContent, { className: "py-5", children: [_jsx("p", { className: "text-sm text-slate-500", children: stat.label }), _jsx("p", { className: `mt-1 text-3xl font-semibold ${stat.className}`, children: stat.value })] }) }, stat.label))) })) : null, _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: canMark ? "Daily Attendance Register" : "Attendance Results" }) }), _jsx(CardContent, { children: attendanceQuery.isLoading ? (_jsx(LoadingState, {})) : filteredStudents.length === 0 ? (_jsx(EmptyState, { title: "No students found", description: "Assign students to the selected class and section first." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Student" }), _jsx(Th, { children: "Roll" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: filteredStudents.map((student) => {
                                                            const status = statusMap[student._id];
                                                            return (_jsxs("tr", { children: [_jsx(Td, { children: student.user.fullName }), _jsx(Td, { children: student.rollNumber }), _jsx(Td, { children: canMark ? (_jsx(Select, { value: status ?? "PRESENT", onChange: (event) => setStatusMap((current) => ({
                                                                                ...current,
                                                                                [student._id]: event.target.value
                                                                            })), children: statuses.map((item) => (_jsx("option", { value: item, children: item }, item))) })) : (_jsx(StatusBadge, { status: status ?? "NOT_MARKED" })) })] }, student._id));
                                                        }) })] }) }), canMark ? (_jsx("div", { className: "mt-4 flex justify-end", children: _jsx(Button, { disabled: saveAttendance.isPending, onClick: () => void saveAttendance.mutateAsync({
                                                    classId,
                                                    sectionId,
                                                    subjectId,
                                                    dateBs,
                                                    entries: filteredStudents.map((student) => ({
                                                        studentId: student._id,
                                                        status: statusMap[student._id] ?? "PRESENT"
                                                    }))
                                                }), children: "Save Attendance" }) })) : attendanceQuery.data?.length === 0 ? (_jsx("p", { className: "mt-4 text-sm text-slate-500", children: "No attendance has been recorded for this class, section, subject, and date yet." })) : null] })) })] })] })) : null] }));
};
