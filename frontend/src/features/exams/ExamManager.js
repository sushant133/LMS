import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { examSchema, resultSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useTeacherScope } from "hooks/useTeacherScope";
import { StudentExamResults } from "features/exams/StudentExamResults";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterSubjectsByClass, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";
const defaultExamValue = {
    name: "",
    academicYearBs: "2083/2084",
    startDateBs: "",
    endDateBs: "",
    classIds: []
};
const defaultResultValue = {
    examId: "",
    studentId: "",
    classId: "",
    sectionId: "",
    marks: [],
    publishedAtBs: ""
};
export const ExamManager = () => {
    const { user } = useAuth();
    const isTeacher = user?.role === "TEACHER";
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const isStudentOrParent = user?.role === "STUDENT" || user?.role === "PARENT";
    const teacherScopeQuery = useTeacherScope(isTeacher);
    const [examForm, setExamForm] = useState(defaultExamValue);
    const [resultForm, setResultForm] = useState(defaultResultValue);
    const [editingExamId, setEditingExamId] = useState(null);
    const [marksheetSelection, setMarksheetSelection] = useState(null);
    const [selectedSubjectId, setSelectedSubjectId] = useState("");
    const [viewExamId, setViewExamId] = useState("");
    const [viewClassId, setViewClassId] = useState("");
    const [viewSectionId, setViewSectionId] = useState("");
    const [viewStudentId, setViewStudentId] = useState("");
    const [teacherViewExamId, setTeacherViewExamId] = useState("");
    const [teacherViewClassId, setTeacherViewClassId] = useState("");
    const [teacherViewSectionId, setTeacherViewSectionId] = useState("");
    const [teacherViewSubjectId, setTeacherViewSubjectId] = useState("");
    const examsQuery = useQuery({ queryKey: ["exams"], queryFn: () => unwrap(api.get("/exams")) });
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
    const subjectsQuery = useQuery({
        queryKey: ["subjects"],
        queryFn: () => unwrap(api.get("/academics/subjects")),
        enabled: isAdmin
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students")),
        enabled: isAdmin
    });
    const viewFiltersComplete = Boolean(viewExamId && viewClassId && viewSectionId);
    const adminResultsQuery = useQuery({
        queryKey: ["results", "admin", viewExamId, viewClassId, viewSectionId, viewStudentId],
        queryFn: () => unwrap(api.get("/exams/results/all", {
            params: {
                examId: viewExamId || undefined,
                classId: viewClassId || undefined,
                studentId: viewStudentId || undefined
            }
        })),
        enabled: isAdmin && viewFiltersComplete
    });
    const portalResultsQuery = useQuery({
        queryKey: ["results", "portal"],
        queryFn: () => unwrap(api.get("/exams/results/all")),
        enabled: isStudentOrParent
    });
    const teacherResultsQuery = useQuery({
        queryKey: ["results", "teacher", teacherViewExamId, teacherViewClassId],
        queryFn: () => unwrap(api.get("/exams/results/all", {
            params: {
                examId: teacherViewExamId || undefined,
                classId: teacherViewClassId || undefined
            }
        })),
        enabled: isTeacher
    });
    const resultsQuery = isAdmin ? adminResultsQuery : isTeacher ? teacherResultsQuery : portalResultsQuery;
    const marksheetQuery = useQuery({
        queryKey: ["marksheet", marksheetSelection?.examId, marksheetSelection?.studentId],
        queryFn: () => unwrap(api.get(`/exams/results/${marksheetSelection?.examId}/${marksheetSelection?.studentId}/marksheet`)),
        enabled: Boolean(marksheetSelection?.examId && marksheetSelection?.studentId && (isAdmin || isTeacher))
    });
    const examMutation = useMutation({
        mutationFn: async (payload) => editingExamId ? unwrap(api.put(`/exams/${editingExamId}`, payload)) : unwrap(api.post("/exams", payload)),
        onSuccess: async () => {
            toast.success(editingExamId ? "Exam updated" : "Exam created");
            setExamForm(defaultExamValue);
            setEditingExamId(null);
            await queryClient.invalidateQueries({ queryKey: ["exams"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const resultMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/exams/results", payload)),
        onSuccess: async () => {
            toast.success("Result saved");
            await queryClient.invalidateQueries({ queryKey: ["results"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
    const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
    const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
    const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);
    const filteredSections = useMemo(() => filterSectionsByClass(sections, resultForm.classId), [resultForm.classId, sections]);
    const teacherFormSubjects = useMemo(() => (isTeacher ? filterSubjectsByClass(subjects, resultForm.classId) : []), [isTeacher, resultForm.classId, subjects]);
    const teacherViewSubjects = useMemo(() => (isTeacher ? filterSubjectsByClass(subjects, teacherViewClassId) : []), [isTeacher, teacherViewClassId, subjects]);
    const teacherViewSections = useMemo(() => filterSectionsByClass(sections, teacherViewClassId), [sections, teacherViewClassId]);
    const filteredStudents = useMemo(() => students.filter((student) => student.classId === resultForm.classId && student.sectionId === resultForm.sectionId), [resultForm.classId, resultForm.sectionId, students]);
    const viewFilteredSections = useMemo(() => (sectionsQuery.data ?? []).filter((section) => section.classId === viewClassId), [sectionsQuery.data, viewClassId]);
    const viewFilteredStudents = useMemo(() => (studentsQuery.data ?? []).filter((student) => student.classId === viewClassId && student.sectionId === viewSectionId), [studentsQuery.data, viewClassId, viewSectionId]);
    const teacherDisplayedResults = useMemo(() => {
        if (!isTeacher) {
            return [];
        }
        const teacherSubjectIds = teacherScopeQuery.data?.scope.subjectIds ?? [];
        return (teacherResultsQuery.data ?? [])
            .flatMap((result) => result.marks
            .filter((mark) => teacherSubjectIds.includes(mark.subjectId))
            .filter((mark) => !teacherViewSubjectId || mark.subjectId === teacherViewSubjectId)
            .map((mark) => ({ result, mark })))
            .filter(({ result }) => {
            if (teacherViewExamId && result.examId !== teacherViewExamId) {
                return false;
            }
            if (teacherViewClassId && result.classId !== teacherViewClassId) {
                return false;
            }
            if (teacherViewSectionId && result.sectionId !== teacherViewSectionId) {
                return false;
            }
            return true;
        });
    }, [
        isTeacher,
        teacherResultsQuery.data,
        teacherScopeQuery.data?.scope.subjectIds,
        teacherViewClassId,
        teacherViewExamId,
        teacherViewSectionId,
        teacherViewSubjectId
    ]);
    const displayedResults = useMemo(() => {
        const results = resultsQuery.data ?? [];
        if (!isAdmin)
            return results;
        return results.filter((result) => result.sectionId === viewSectionId && (!viewStudentId || result.studentId === viewStudentId));
    }, [isAdmin, resultsQuery.data, viewSectionId, viewStudentId]);
    const resultStudents = isAdmin ? (studentsQuery.data ?? []) : students;
    const selectedStudentResult = useMemo(() => displayedResults.find((result) => result.studentId === viewStudentId), [displayedResults, viewStudentId]);
    useEffect(() => {
        if (!isTeacher) {
            return;
        }
        if (hasSingleOption(classes) && resultForm.classId !== classes[0]._id) {
            setResultForm((current) => ({ ...current, classId: classes[0]._id, sectionId: "", studentId: "" }));
        }
    }, [classes, isTeacher, resultForm.classId]);
    useEffect(() => {
        if (!isTeacher || !resultForm.classId) {
            return;
        }
        if (hasSingleOption(filteredSections) && resultForm.sectionId !== filteredSections[0]._id) {
            setResultForm((current) => ({ ...current, sectionId: filteredSections[0]._id, studentId: "" }));
        }
    }, [filteredSections, isTeacher, resultForm.classId, resultForm.sectionId]);
    useEffect(() => {
        if (!isTeacher) {
            return;
        }
        if (hasSingleOption(classes) && teacherViewClassId !== classes[0]._id) {
            setTeacherViewClassId(classes[0]._id);
        }
    }, [classes, isTeacher, teacherViewClassId]);
    useEffect(() => {
        if (!isTeacher || !resultForm.classId) {
            return;
        }
        if (hasSingleOption(teacherFormSubjects) && selectedSubjectId !== teacherFormSubjects[0]._id) {
            setSelectedSubjectId(teacherFormSubjects[0]._id);
        }
    }, [isTeacher, resultForm.classId, selectedSubjectId, teacherFormSubjects]);
    useEffect(() => {
        if (!isTeacher || !resultForm.examId || !resultForm.studentId || !selectedSubjectId) {
            return;
        }
        const existing = (teacherResultsQuery.data ?? []).find((result) => result.examId === resultForm.examId && result.studentId === resultForm.studentId);
        const existingMark = existing?.marks.find((mark) => mark.subjectId === selectedSubjectId);
        setResultForm((current) => ({
            ...current,
            marks: [{ subjectId: selectedSubjectId, obtainedMarks: existingMark?.obtainedMarks ?? 0 }],
            publishedAtBs: existing?.publishedAtBs ?? current.publishedAtBs
        }));
    }, [isTeacher, resultForm.examId, resultForm.studentId, selectedSubjectId, teacherResultsQuery.data]);
    const loadTeacherResultForEdit = (result, subjectId) => {
        const mark = result.marks.find((item) => item.subjectId === subjectId);
        setSelectedSubjectId(subjectId);
        setResultForm({
            examId: result.examId,
            studentId: result.studentId,
            classId: result.classId,
            sectionId: result.sectionId,
            marks: [{ subjectId, obtainedMarks: mark?.obtainedMarks ?? 0 }],
            publishedAtBs: result.publishedAtBs ?? ""
        });
    };
    const isLoading = isStudentOrParent
        ? examsQuery.isLoading || portalResultsQuery.isLoading
        : examsQuery.isLoading ||
            (isTeacher && teacherScopeQuery.isLoading) ||
            (isAdmin && (classesQuery.isLoading || sectionsQuery.isLoading || subjectsQuery.isLoading || studentsQuery.isLoading));
    if (isLoading) {
        return _jsx(LoadingState, {});
    }
    const subjectNameById = new Map(subjects.map((subject) => [subject._id, subject]));
    return (_jsxs(PageContent, { className: "space-y-6", children: [_jsx(PageHeader, { title: "Exams & Results", description: isAdmin
                    ? "Create exam sessions and view published results. Teachers enter marks from their section."
                    : isTeacher
                        ? "Enter and edit marks for your assigned subject and students after the school admin creates exams."
                        : "View your published exam results, subject marks, grades, and overall performance." }), isAdmin ? (_jsxs(_Fragment, { children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingExamId ? "Edit Exam" : "Create Exam" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: (event) => {
                                        event.preventDefault();
                                        const parsed = examSchema.safeParse(examForm);
                                        if (!parsed.success) {
                                            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                            return;
                                        }
                                        void examMutation.mutateAsync(parsed.data);
                                    }, children: [_jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Exam Name", children: _jsx(Input, { value: examForm.name, onChange: (event) => setExamForm((current) => ({ ...current, name: event.target.value })) }) }) }), _jsx(FormField, { label: "Academic Year", children: _jsx(Input, { value: examForm.academicYearBs, onChange: (event) => setExamForm((current) => ({ ...current, academicYearBs: event.target.value })) }) }), _jsx(FormField, { label: "Start Date (BS)", children: _jsx(NepaliDateField, { value: examForm.startDateBs, onChange: (value) => setExamForm((current) => ({ ...current, startDateBs: value })) }) }), _jsx(FormField, { label: "End Date (BS)", children: _jsx(NepaliDateField, { value: examForm.endDateBs, onChange: (value) => setExamForm((current) => ({ ...current, endDateBs: value })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Classes", children: _jsx("div", { className: "flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3", children: (classesQuery.data ?? []).map((item) => {
                                                        const checked = examForm.classIds.includes(item._id);
                                                        return (_jsxs("label", { className: "flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => setExamForm((current) => ({
                                                                        ...current,
                                                                        classIds: checked
                                                                            ? current.classIds.filter((id) => id !== item._id)
                                                                            : [...current.classIds, item._id]
                                                                    })) }), item.name] }, item._id));
                                                    }) }) }) }), _jsxs("div", { className: "md:col-span-2 flex justify-end gap-2", children: [editingExamId ? (_jsx(Button, { type: "button", variant: "outline", onClick: () => {
                                                        setEditingExamId(null);
                                                        setExamForm(defaultExamValue);
                                                    }, children: "Cancel" })) : null, _jsx(Button, { type: "submit", children: editingExamId ? "Update Exam" : "Create Exam" })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "View Results" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "Exam", children: _jsxs(Select, { value: viewExamId, onChange: (event) => {
                                                setViewExamId(event.target.value);
                                                setViewStudentId("");
                                            }, children: [_jsx("option", { value: "", children: "Select exam" }), (examsQuery.data ?? []).map((exam) => (_jsx("option", { value: exam._id, children: exam.name }, exam._id)))] }) }), _jsx(FormField, { label: "Class", children: _jsxs(Select, { value: viewClassId, onChange: (event) => {
                                                setViewClassId(event.target.value);
                                                setViewSectionId("");
                                                setViewStudentId("");
                                            }, children: [_jsx("option", { value: "", children: "Select class" }), (classesQuery.data ?? []).map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Section", children: _jsxs(Select, { value: viewSectionId, onChange: (event) => {
                                                setViewSectionId(event.target.value);
                                                setViewStudentId("");
                                            }, children: [_jsx("option", { value: "", children: "Select section" }), viewFilteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Student (optional)", children: _jsxs(Select, { value: viewStudentId, onChange: (event) => setViewStudentId(event.target.value), children: [_jsx("option", { value: "", children: "All students" }), viewFilteredStudents.map((student) => (_jsx("option", { value: student._id, children: student.user.fullName }, student._id)))] }) })] })] })] })) : null, isTeacher ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Enter / Edit Result" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "space-y-4", onSubmit: (event) => {
                                event.preventDefault();
                                if (!selectedSubjectId) {
                                    toast.error("Select a subject");
                                    return;
                                }
                                const obtainedMarks = resultForm.marks.find((mark) => mark.subjectId === selectedSubjectId)?.obtainedMarks ?? 0;
                                const parsed = resultSchema.safeParse({
                                    ...resultForm,
                                    marks: [{ subjectId: selectedSubjectId, obtainedMarks }]
                                });
                                if (!parsed.success) {
                                    toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                    return;
                                }
                                void resultMutation.mutateAsync(parsed.data);
                            }, children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: "Exam", children: _jsxs(Select, { value: resultForm.examId, onChange: (event) => setResultForm((current) => ({ ...current, examId: event.target.value })), children: [_jsx("option", { value: "", children: "Select exam" }), (examsQuery.data ?? []).map((exam) => (_jsx("option", { value: exam._id, children: exam.name }, exam._id)))] }) }), hasSingleOption(classes) ? (_jsx(FormField, { label: "Class", children: _jsx(Input, { value: classes[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Class", children: _jsxs(Select, { value: resultForm.classId, onChange: (event) => {
                                                    setSelectedSubjectId("");
                                                    setResultForm((current) => ({ ...current, classId: event.target.value, sectionId: "", studentId: "" }));
                                                }, children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) })), hasSingleOption(filteredSections) ? (_jsx(FormField, { label: "Section", children: _jsx(Input, { value: filteredSections[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Section", children: _jsxs(Select, { value: resultForm.sectionId, onChange: (event) => setResultForm((current) => ({ ...current, sectionId: event.target.value, studentId: "" })), disabled: !resultForm.classId, children: [_jsx("option", { value: "", children: "Select section" }), filteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) })), _jsx(FormField, { label: "Student", children: _jsxs(Select, { value: resultForm.studentId, onChange: (event) => setResultForm((current) => ({ ...current, studentId: event.target.value })), disabled: !resultForm.sectionId, children: [_jsx("option", { value: "", children: "Select student" }), filteredStudents.map((student) => (_jsx("option", { value: student._id, children: student.user.fullName }, student._id)))] }) }), hasSingleOption(teacherFormSubjects) ? (_jsx(FormField, { label: "Subject", children: _jsx(Input, { value: teacherFormSubjects[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Subject", children: _jsxs(Select, { value: selectedSubjectId, onChange: (event) => setSelectedSubjectId(event.target.value), disabled: !resultForm.classId, children: [_jsx("option", { value: "", children: "Select subject" }), teacherFormSubjects.map((subject) => (_jsx("option", { value: subject._id, children: subject.name }, subject._id)))] }) }))] }), _jsx(FormField, { label: "Published Date (BS)", children: _jsx(NepaliDateField, { value: resultForm.publishedAtBs ?? "", onChange: (value) => setResultForm((current) => ({ ...current, publishedAtBs: value })) }) }), !selectedSubjectId ? (_jsx("p", { className: "text-sm text-slate-500", children: "Select a class and subject to enter marks." })) : (_jsx(FormField, { label: `Marks — ${subjectNameById.get(selectedSubjectId)?.name ?? "Subject"} / ${subjectNameById.get(selectedSubjectId)?.fullMarks ?? "—"}`, children: _jsx(Input, { type: "number", min: 0, max: subjectNameById.get(selectedSubjectId)?.fullMarks, value: resultForm.marks.find((item) => item.subjectId === selectedSubjectId)?.obtainedMarks ?? 0, onChange: (event) => setResultForm((current) => ({
                                            ...current,
                                            marks: [{ subjectId: selectedSubjectId, obtainedMarks: Number(event.target.value) }]
                                        })) }) })), _jsx("div", { className: "flex justify-end", children: _jsx(Button, { type: "submit", disabled: !selectedSubjectId || !resultForm.examId || !resultForm.studentId, children: "Save Result" }) })] }) })] })) : null, isTeacher ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Filter Student Results" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "Exam", children: _jsxs(Select, { value: teacherViewExamId, onChange: (event) => setTeacherViewExamId(event.target.value), children: [_jsx("option", { value: "", children: "All exams" }), (examsQuery.data ?? []).map((exam) => (_jsx("option", { value: exam._id, children: exam.name }, exam._id)))] }) }), hasSingleOption(classes) ? (_jsx(FormField, { label: "Class", children: _jsx(Input, { value: classes[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Class", children: _jsxs(Select, { value: teacherViewClassId, onChange: (event) => {
                                        setTeacherViewClassId(event.target.value);
                                        setTeacherViewSectionId("");
                                        setTeacherViewSubjectId("");
                                    }, children: [_jsx("option", { value: "", children: "All classes" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) })), _jsx(FormField, { label: "Section", children: _jsxs(Select, { value: teacherViewSectionId, onChange: (event) => setTeacherViewSectionId(event.target.value), disabled: !teacherViewClassId && !hasSingleOption(classes), children: [_jsx("option", { value: "", children: "All sections" }), (teacherViewClassId ? teacherViewSections : sections).map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Subject", children: _jsxs(Select, { value: teacherViewSubjectId, onChange: (event) => setTeacherViewSubjectId(event.target.value), disabled: !teacherViewClassId && !hasSingleOption(classes), children: [_jsx("option", { value: "", children: "All subjects" }), (teacherViewClassId ? teacherViewSubjects : subjects).map((subject) => (_jsx("option", { value: subject._id, children: subject.name }, subject._id)))] }) })] })] })) : null, isStudentOrParent ? (_jsx(StudentExamResults, { exams: examsQuery.data ?? [], results: portalResultsQuery.data ?? [], isLoading: portalResultsQuery.isLoading })) : null, (isAdmin || isTeacher) ? (_jsxs("div", { className: "grid gap-6 xl:grid-cols-[1.1fr_0.9fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Exam Sessions" }) }), _jsx(CardContent, { className: "space-y-3", children: (examsQuery.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "No exams yet", description: isAdmin ? "Create an exam schedule and assign it to classes." : "Exams will appear here once the school admin creates them." })) : ((examsQuery.data ?? []).map((exam) => (_jsx("div", { className: "rounded-2xl border border-slate-200 p-4", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-slate-900", children: exam.name }), _jsxs("p", { className: "text-sm text-slate-500", children: [exam.startDateBs, " to ", exam.endDateBs] })] }), isAdmin ? (_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                    setEditingExamId(exam._id);
                                                    setExamForm({
                                                        name: exam.name,
                                                        academicYearBs: exam.academicYearBs,
                                                        startDateBs: exam.startDateBs,
                                                        endDateBs: exam.endDateBs,
                                                        classIds: exam.classIds
                                                    });
                                                }, children: "Edit" })) : null] }) }, exam._id)))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: isAdmin ? "Results" : "My Subject Results" }) }), _jsx(CardContent, { children: isAdmin && !viewFiltersComplete ? (_jsx(EmptyState, { title: "Select exam, class, and section", description: "Choose filters above to view entered results." })) : isTeacher && teacherResultsQuery.isLoading ? (_jsx(LoadingState, {})) : isTeacher && teacherDisplayedResults.length === 0 ? (_jsx(EmptyState, { title: "No results yet", description: "Enter marks for your students using the form above." })) : !isTeacher && resultsQuery.isLoading ? (_jsx(LoadingState, {})) : !isTeacher && displayedResults.length === 0 ? (_jsx(EmptyState, { title: "No results yet", description: "Results will appear after teachers enter marks." })) : isTeacher ? (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Exam" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Subject" }), _jsx(Th, { children: "Marks" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: teacherDisplayedResults.map(({ result, mark }) => (_jsxs("tr", { children: [_jsx(Td, { children: (examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId }), _jsx(Td, { children: students.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId }), _jsx(Td, { children: subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId }), _jsxs(Td, { children: [mark.obtainedMarks, " / ", subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"] }), _jsx(Td, { children: _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => loadTeacherResultForEdit(result, mark.subjectId), children: "Edit" }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => setMarksheetSelection({ examId: result.examId, studentId: result.studentId }), children: "View" })] }) })] }, `${result._id}-${mark.subjectId}`))) })] }) }), marksheetQuery.data ? (_jsxs("div", { className: "rounded-3xl border border-emerald-200 bg-emerald-50 p-5", children: [_jsx("div", { className: "flex items-center justify-between", children: _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-slate-900", children: marksheetQuery.data.student.user.fullName }), _jsx("p", { className: "text-sm text-slate-600", children: marksheetQuery.data.exam.name })] }) }), _jsx("div", { className: "mt-4 grid gap-2 sm:grid-cols-2", children: marksheetQuery.data.result.marks.map((mark) => (_jsxs("div", { className: "rounded-xl bg-white px-3 py-2 text-sm", children: [_jsx("p", { className: "font-medium text-slate-800", children: subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId }), _jsxs("p", { className: "text-slate-600", children: [mark.obtainedMarks, " / ", subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"] })] }, mark.subjectId))) })] })) : null] })) : (_jsxs("div", { className: "space-y-4", children: [isAdmin && viewStudentId && selectedStudentResult ? (_jsxs("div", { className: "rounded-2xl border border-emerald-200 bg-emerald-50 p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-slate-900", children: viewFilteredStudents.find((s) => s._id === viewStudentId)?.user.fullName ?? "Student" }), _jsxs("p", { className: "text-sm text-slate-600", children: ["Grade: ", selectedStudentResult.grade, " \u00B7 GPA: ", selectedStudentResult.gpa.toFixed(2), " \u00B7 ", selectedStudentResult.percentage, "%"] })] }), _jsx(Badge, { children: selectedStudentResult.grade })] }), _jsx("div", { className: "mt-4 grid gap-2 sm:grid-cols-2", children: selectedStudentResult.marks.map((mark) => (_jsxs("div", { className: "rounded-xl bg-white px-3 py-2 text-sm", children: [_jsx("p", { className: "font-medium text-slate-800", children: subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId }), _jsxs("p", { className: "text-slate-600", children: [mark.obtainedMarks, " / ", subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"] })] }, mark.subjectId))) })] })) : null, _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Exam" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Grade" }), _jsx(Th, { children: "GPA" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: displayedResults.map((result) => (_jsxs("tr", { children: [_jsx(Td, { children: (examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId }), _jsx(Td, { children: resultStudents.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId }), _jsx(Td, { children: _jsx(Badge, { children: result.grade }) }), _jsx(Td, { children: result.gpa.toFixed(2) }), _jsx(Td, { children: _jsx(Button, { size: "sm", variant: "outline", onClick: () => setMarksheetSelection({ examId: result.examId, studentId: result.studentId }), children: "View Marksheet" }) })] }, result._id))) })] }) }), isAdmin && marksheetQuery.data ? (_jsxs("div", { className: "rounded-3xl border border-emerald-200 bg-emerald-50 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-slate-900", children: marksheetQuery.data.student.user.fullName }), _jsx("p", { className: "text-sm text-slate-600", children: marksheetQuery.data.exam.name })] }), _jsx(Badge, { children: marksheetQuery.data.result.grade })] }), _jsxs("p", { className: "mt-3 text-sm text-slate-700", children: ["GPA: ", marksheetQuery.data.result.gpa.toFixed(2), " / Percentage: ", marksheetQuery.data.result.percentage, "%"] })] })) : null] })) })] })] })) : null] }));
};
