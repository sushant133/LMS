import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ClassRecord,
  ExamInput,
  ExamRecord,
  ResultRecord,
  SectionRecord,
  StudentRecord,
  SubjectRecord
} from "@nepal-school-erp/shared";
import { EXAM_STATUSES, computeSubjectMark, examSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
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
import { ExamAnalyticsPanel } from "features/exams/ExamAnalyticsPanel";
import { ExamMarksEntry } from "features/exams/ExamMarksEntry";
import { ExamRoutinePanel, TeacherRoutineList } from "features/exams/ExamRoutinePanel";
import { StudentExamPortal } from "features/exams/StudentExamPortal";
import { EXAM_STATUS_LABELS, defaultExamValue } from "features/exams/examDefaults";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin, useNormalizedRole } from "hooks/useNormalizedRole";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterSubjectsByClass, filterSubjectsByYear, filterYearsByBatch, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface MarksheetResponse {
  result: ResultRecord;
  exam: ExamRecord;
  student: StudentRecord;
  section: SectionRecord;
  subjects: SubjectRecord[];
}

export const ExamManager = () => {
  const role = useNormalizedRole();
  const isTeacher = role === "TEACHER";
  const isAdmin = useIsTenantAdmin();
  const isStudentOrParent = role === "STUDENT" || role === "PARENT";
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [examForm, setExamForm] = useState<ExamInput>(defaultExamValue);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [marksheetSelection, setMarksheetSelection] = useState<{ examId: string; studentId: string } | null>(null);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [adminTab, setAdminTab] = useState<"routine" | "analytics" | "results">("routine");

  const [viewExamId, setViewExamId] = useState("");
  const [viewClassId, setViewClassId] = useState("");
  const [viewSectionId, setViewSectionId] = useState("");
  const [viewBatchId, setViewBatchId] = useState("");
  const [viewYearId, setViewYearId] = useState("");
  const [viewStudentId, setViewStudentId] = useState("");

  const [teacherViewExamId, setTeacherViewExamId] = useState("");
  const [teacherViewClassId, setTeacherViewClassId] = useState("");
  const [teacherViewSectionId, setTeacherViewSectionId] = useState("");
  const [teacherViewBatchId, setTeacherViewBatchId] = useState("");
  const [teacherViewYearId, setTeacherViewYearId] = useState("");
  const [teacherViewSubjectId, setTeacherViewSubjectId] = useState("");

  const examsQuery = useQuery({ queryKey: ["exams"], queryFn: () => unwrap<ExamRecord[]>(api.get("/exams")) });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: isAdmin && !isCollege
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: isAdmin && !isCollege
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<Array<{ _id: string; name: string }>>(api.get("/academics/batches")),
    enabled: (isAdmin || isTeacher) && isCollege
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<Array<{ _id: string; name: string; batchId: string }>>(api.get("/academics/years")),
    enabled: (isAdmin || isTeacher) && isCollege
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
    enabled: isAdmin
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: isAdmin
  });

  const viewFiltersComplete = isCollege
    ? Boolean(viewExamId && viewBatchId && viewYearId)
    : Boolean(viewExamId && viewClassId && viewSectionId);

  const adminResultsQuery = useQuery({
    queryKey: ["results", "admin", viewExamId, viewClassId, viewSectionId, viewBatchId, viewYearId, viewStudentId],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: viewExamId || undefined,
                batchId: viewBatchId || undefined,
                yearId: viewYearId || undefined,
                studentId: viewStudentId || undefined
              }
            : {
                examId: viewExamId || undefined,
                classId: viewClassId || undefined,
                sectionId: viewSectionId || undefined,
                studentId: viewStudentId || undefined
              }
        })
      ),
    enabled: isAdmin && viewFiltersComplete
  });

  const portalResultsQuery = useQuery({
    queryKey: ["results", "portal"],
    queryFn: () => unwrap<ResultRecord[]>(api.get("/exams/results/all")),
    enabled: isStudentOrParent
  });

  const teacherResultsQuery = useQuery({
    queryKey: ["results", "teacher", teacherViewExamId, teacherViewClassId, teacherViewBatchId, teacherViewYearId],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: teacherViewExamId || undefined,
                batchId: teacherViewBatchId || undefined,
                yearId: teacherViewYearId || undefined
              }
            : {
                examId: teacherViewExamId || undefined,
                classId: teacherViewClassId || undefined
              }
        })
      ),
    enabled: isTeacher
  });

  const resultsQuery = isAdmin ? adminResultsQuery : isTeacher ? teacherResultsQuery : portalResultsQuery;

  const marksheetQuery = useQuery({
    queryKey: ["marksheet", marksheetSelection?.examId, marksheetSelection?.studentId],
    queryFn: () =>
      unwrap<MarksheetResponse>(api.get(`/exams/results/${marksheetSelection?.examId}/${marksheetSelection?.studentId}/marksheet`)),
    enabled: Boolean(marksheetSelection?.examId && marksheetSelection?.studentId && (isAdmin || isTeacher))
  });

  const examMutation = useMutation({
    mutationFn: async (payload: ExamInput) =>
      editingExamId ? unwrap<ExamRecord>(api.put(`/exams/${editingExamId}`, payload)) : unwrap<ExamRecord>(api.post("/exams", payload)),
    onSuccess: async () => {
      toast.success(editingExamId ? "Exam updated" : "Exam created");
      setExamForm(defaultExamValue);
      setEditingExamId(null);
      await queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteExamMutation = useMutation({
    mutationFn: async (examId: string) => unwrap(api.delete(`/exams/${examId}`)),
    onSuccess: async (_, examId) => {
      toast.success("Exam deleted");
      if (selectedExamId === examId) {
        setSelectedExamId("");
      }
      if (editingExamId === examId) {
        setEditingExamId(null);
        setExamForm(defaultExamValue);
      }
      if (viewExamId === examId) {
        setViewExamId("");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({ queryKey: ["exam-routines"] })
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteResultMutation = useMutation({
    mutationFn: async (resultId: string) => unwrap(api.delete(`/exams/results/${resultId}`)),
    onSuccess: async () => {
      toast.success("Result deleted");
      setMarksheetSelection(null);
      await queryClient.invalidateQueries({ queryKey: ["results"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteResultMarkMutation = useMutation({
    mutationFn: async ({ examId, studentId, subjectId }: { examId: string; studentId: string; subjectId: string }) =>
      unwrap(api.delete(`/exams/results/${examId}/${studentId}/marks/${subjectId}`)),
    onSuccess: async () => {
      toast.success("Subject marks deleted");
      await queryClient.invalidateQueries({ queryKey: ["results"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const examActionMutation = useMutation({
    mutationFn: async ({ examId, action }: { examId: string; action: "publish-results" | "unpublish-results" | "lock" | "unlock" }) => {
      const path =
        action === "publish-results"
          ? `/exams/${examId}/results/publish`
          : action === "unpublish-results"
            ? `/exams/${examId}/results/unpublish`
            : action === "lock"
              ? `/exams/${examId}/results/lock`
              : `/exams/${examId}/results/unlock`;
      return unwrap<ExamRecord>(api.post(path));
    },
    onSuccess: async (_, variables) => {
      const labels: Record<string, string> = {
        "publish-results": "Results published",
        "unpublish-results": "Results unpublished",
        lock: "Results locked",
        unlock: "Results unlocked"
      };
      toast.success(labels[variables.action]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] })
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
  const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
  const batches = isTeacher ? (teacherScopeQuery.data?.batches ?? []) : (batchesQuery.data ?? []);
  const years = isTeacher ? (teacherScopeQuery.data?.years ?? []) : (yearsQuery.data ?? []);
  const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
  const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);

  const viewFilteredSections = useMemo(
    () => (sectionsQuery.data ?? []).filter((section) => section.classId === viewClassId),
    [sectionsQuery.data, viewClassId]
  );
  const viewFilteredYears = useMemo(() => filterYearsByBatch(yearsQuery.data ?? [], viewBatchId), [viewBatchId, yearsQuery.data]);
  const viewFilteredStudents = useMemo(
    () =>
      (studentsQuery.data ?? []).filter((student) =>
        isCollege
          ? student.batchId === viewBatchId && student.yearId === viewYearId
          : student.classId === viewClassId && student.sectionId === viewSectionId
      ),
    [isCollege, studentsQuery.data, viewBatchId, viewClassId, viewSectionId, viewYearId]
  );

  const teacherViewYears = useMemo(() => filterYearsByBatch(years, teacherViewBatchId), [teacherViewBatchId, years]);
  const teacherViewSections = useMemo(() => filterSectionsByClass(sections, teacherViewClassId), [sections, teacherViewClassId]);
  const teacherViewSubjects = useMemo(
    () =>
      (isCollege
        ? filterSubjectsByYear(subjects, teacherViewYearId)
        : filterSubjectsByClass(subjects, teacherViewClassId)) as SubjectRecord[],
    [isCollege, subjects, teacherViewClassId, teacherViewYearId]
  );

  const teacherDisplayedResults = useMemo(() => {
    if (!isTeacher) return [];

    const teacherSubjectIds = teacherScopeQuery.data?.scope.subjectIds ?? [];
    return (teacherResultsQuery.data ?? [])
      .flatMap((result) =>
        result.marks
          .filter((mark) => teacherSubjectIds.includes(mark.subjectId))
          .filter((mark) => !teacherViewSubjectId || mark.subjectId === teacherViewSubjectId)
          .map((mark) => ({ result, mark }))
      )
      .filter(({ result }) => {
        if (teacherViewExamId && result.examId !== teacherViewExamId) return false;
        if (isCollege) {
          if (teacherViewBatchId && result.batchId !== teacherViewBatchId) return false;
          if (teacherViewYearId && result.yearId !== teacherViewYearId) return false;
        } else {
          if (teacherViewClassId && result.classId !== teacherViewClassId) return false;
          if (teacherViewSectionId && result.sectionId !== teacherViewSectionId) return false;
        }
        return true;
      });
  }, [
    isCollege,
    isTeacher,
    teacherResultsQuery.data,
    teacherScopeQuery.data?.scope.subjectIds,
    teacherViewBatchId,
    teacherViewClassId,
    teacherViewExamId,
    teacherViewSectionId,
    teacherViewSubjectId,
    teacherViewYearId
  ]);

  const displayedResults = useMemo(() => {
    const results = resultsQuery.data ?? [];
    if (!isAdmin) return results;
    return results.filter((result) => {
      const matchesScope = isCollege
        ? result.batchId === viewBatchId && result.yearId === viewYearId
        : result.sectionId === viewSectionId;
      return matchesScope && (!viewStudentId || result.studentId === viewStudentId);
    });
  }, [isAdmin, isCollege, resultsQuery.data, viewBatchId, viewSectionId, viewStudentId, viewYearId]);

  const selectedExam = useMemo(
    () => (examsQuery.data ?? []).find((exam) => exam._id === selectedExamId),
    [examsQuery.data, selectedExamId]
  );

  const resultsLockedExamIds = useMemo(
    () => new Set((examsQuery.data ?? []).filter((exam) => exam.resultsLocked).map((exam) => exam._id)),
    [examsQuery.data]
  );

  const selectedStudentResult = useMemo(
    () => displayedResults.find((result) => result.studentId === viewStudentId),
    [displayedResults, viewStudentId]
  );

  const resultStudents = isAdmin ? (studentsQuery.data ?? []) : students;
  const subjectNameById = new Map(subjects.map((subject) => [subject._id, subject]));

  const isLoading = isStudentOrParent
    ? examsQuery.isLoading || portalResultsQuery.isLoading
    : examsQuery.isLoading ||
      (isTeacher && teacherScopeQuery.isLoading) ||
      (isAdmin &&
        (subjectsQuery.isLoading ||
          studentsQuery.isLoading ||
          (isCollege ? batchesQuery.isLoading || yearsQuery.isLoading : classesQuery.isLoading || sectionsQuery.isLoading)));

  if (isLoading) {
    return <LoadingState />;
  }

  const loadExamForEdit = (exam: ExamRecord) => {
    setEditingExamId(exam._id);
    setExamForm({
      name: exam.name,
      academicYearBs: exam.academicYearBs,
      startDateBs: exam.startDateBs,
      endDateBs: exam.endDateBs,
      resultPublishDateBs: exam.resultPublishDateBs ?? "",
      status: exam.status,
      classIds: exam.classIds ?? [],
      batchIds: exam.batchIds ?? [],
      yearIds: exam.yearIds ?? []
    });
  };

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Exams & Results"
        description={
          isAdmin
            ? "Create exams, publish routines, manage results, and view analytics."
            : isTeacher
              ? "View exam routines and enter marks for your assigned subjects."
              : "View your exam schedule and published results."
        }
      />

      {isStudentOrParent ? (
        <StudentExamPortal exams={examsQuery.data ?? []} results={portalResultsQuery.data ?? []} isLoading={portalResultsQuery.isLoading} />
      ) : null}

      {isAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{editingExamId ? "Edit Exam" : "Create Exam"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = examSchema.safeParse(examForm);
                  if (!parsed.success) {
                    toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                    return;
                  }
                  void examMutation.mutateAsync(parsed.data);
                }}
              >
                <div className="md:col-span-2">
                  <FormField label="Exam Name">
                    <Input value={examForm.name} onChange={(event) => setExamForm((current) => ({ ...current, name: event.target.value }))} />
                  </FormField>
                </div>
                <FormField label="Academic Session">
                  <Input
                    value={examForm.academicYearBs}
                    onChange={(event) => setExamForm((current) => ({ ...current, academicYearBs: event.target.value }))}
                  />
                </FormField>
                <FormField label="Status">
                  <Select
                    value={examForm.status}
                    onChange={(event) => setExamForm((current) => ({ ...current, status: event.target.value as ExamInput["status"] }))}
                  >
                    {EXAM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {EXAM_STATUS_LABELS[status] ?? status}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Start Date (BS)">
                  <NepaliDateField value={examForm.startDateBs} onChange={(value) => setExamForm((current) => ({ ...current, startDateBs: value }))} />
                </FormField>
                <FormField label="End Date (BS)">
                  <NepaliDateField value={examForm.endDateBs} onChange={(value) => setExamForm((current) => ({ ...current, endDateBs: value }))} />
                </FormField>
                <FormField label="Result Publish Date (optional)">
                  <NepaliDateField
                    value={examForm.resultPublishDateBs ?? ""}
                    onChange={(value) => setExamForm((current) => ({ ...current, resultPublishDateBs: value }))}
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label={isCollege ? `${labels.primaryPlural} & ${labels.secondaryPlural}` : "Classes"}>
                    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3">
                      {isCollege
                        ? (yearsQuery.data ?? []).map((item) => {
                            const checked = examForm.yearIds.includes(item._id);
                            const batchName = (batchesQuery.data ?? []).find((batch) => batch._id === item.batchId)?.name ?? "Batch";
                            return (
                              <label key={item._id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setExamForm((current) => ({
                                      ...current,
                                      batchIds: checked
                                        ? current.batchIds.filter((id) => id !== item.batchId)
                                        : [...new Set([...current.batchIds, item.batchId])],
                                      yearIds: checked
                                        ? current.yearIds.filter((id) => id !== item._id)
                                        : [...current.yearIds, item._id]
                                    }))
                                  }
                                />
                                {batchName} — {item.name}
                              </label>
                            );
                          })
                        : (classesQuery.data ?? []).map((item) => {
                            const checked = examForm.classIds.includes(item._id);
                            return (
                              <label key={item._id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setExamForm((current) => ({
                                      ...current,
                                      classIds: checked
                                        ? current.classIds.filter((id) => id !== item._id)
                                        : [...current.classIds, item._id]
                                    }))
                                  }
                                />
                                {item.name}
                              </label>
                            );
                          })}
                    </div>
                  </FormField>
                </div>
                <div className="md:col-span-2 flex justify-end gap-2">
                  {editingExamId ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingExamId(null);
                        setExamForm(defaultExamValue);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  <Button type="submit">{editingExamId ? "Update Exam" : "Create Exam"}</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exam Sessions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(examsQuery.data ?? []).length === 0 ? (
                <EmptyState title="No exams yet" description="Create an exam and assign it to batches/years." />
              ) : (
                (examsQuery.data ?? []).map((exam) => (
                  <div
                    key={exam._id}
                    className={`rounded-2xl border p-4 transition-colors ${selectedExamId === exam._id ? "border-emerald-300 bg-emerald-50/30" : "border-slate-200"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{exam.name}</h3>
                        <p className="text-sm text-slate-500">
                          {exam.startDateBs} to {exam.endDateBs} · {exam.academicYearBs}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge>{EXAM_STATUS_LABELS[exam.status] ?? exam.status}</Badge>
                          {exam.routinePublished ? <Badge className="bg-blue-100 text-blue-700">Routine Live</Badge> : null}
                          {exam.resultsPublished ? <Badge className="bg-emerald-100 text-emerald-700">Results Published</Badge> : null}
                          {exam.resultsLocked ? <Badge className="bg-amber-100 text-amber-700">Locked</Badge> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => loadExamForEdit(exam)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant={selectedExamId === exam._id ? "default" : "outline"}
                          onClick={() => {
                            setSelectedExamId(exam._id);
                            setAdminTab("routine");
                          }}
                        >
                          Manage
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteExamMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${exam.name}"? This will permanently remove the exam, all routines, and all entered results.`
                              )
                            ) {
                              void deleteExamMutation.mutateAsync(exam._id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {exam.resultsPublished ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void examActionMutation.mutateAsync({ examId: exam._id, action: "unpublish-results" })}
                        >
                          Unpublish Results
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void examActionMutation.mutateAsync({ examId: exam._id, action: "publish-results" })}
                        >
                          Publish Results
                        </Button>
                      )}
                      {exam.resultsLocked ? (
                        <Button size="sm" variant="outline" onClick={() => void examActionMutation.mutateAsync({ examId: exam._id, action: "unlock" })}>
                          Unlock Results
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => void examActionMutation.mutateAsync({ examId: exam._id, action: "lock" })}>
                          Lock Results
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {selectedExam ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>{selectedExam.name}</CardTitle>
                  <div className="flex gap-2">
                    {(["routine", "analytics", "results"] as const).map((tab) => (
                      <Button key={tab} size="sm" variant={adminTab === tab ? "default" : "outline"} onClick={() => setAdminTab(tab)}>
                        {tab === "routine" ? "Routine" : tab === "analytics" ? "Analytics" : "Results"}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {adminTab === "routine" ? (
                  <ExamRoutinePanel exam={selectedExam} subjects={subjectsQuery.data ?? []} isAdmin />
                ) : adminTab === "analytics" ? (
                  <ExamAnalyticsPanel examId={selectedExam._id} />
                ) : (
                  <p className="text-sm text-slate-600">Use the results filters below to view entered marks for this exam.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>View Results</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Exam">
                <Select
                  value={viewExamId}
                  onChange={(event) => {
                    setViewExamId(event.target.value);
                    setViewStudentId("");
                  }}
                >
                  <option value="">Select exam</option>
                  {(examsQuery.data ?? []).map((exam) => (
                    <option key={exam._id} value={exam._id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={labels.primary}>
                <Select
                  value={isCollege ? viewBatchId : viewClassId}
                  onChange={(event) => {
                    if (isCollege) {
                      setViewBatchId(event.target.value);
                      setViewYearId("");
                    } else {
                      setViewClassId(event.target.value);
                      setViewSectionId("");
                    }
                    setViewStudentId("");
                  }}
                >
                  <option value="">Select {labels.primary.toLowerCase()}</option>
                  {(isCollege ? batchesQuery.data ?? [] : classesQuery.data ?? []).map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={labels.secondary}>
                <Select
                  value={isCollege ? viewYearId : viewSectionId}
                  onChange={(event) => {
                    if (isCollege) {
                      setViewYearId(event.target.value);
                    } else {
                      setViewSectionId(event.target.value);
                    }
                    setViewStudentId("");
                  }}
                  disabled={isCollege ? !viewBatchId : !viewClassId}
                >
                  <option value="">Select {labels.secondary.toLowerCase()}</option>
                  {(isCollege ? viewFilteredYears : viewFilteredSections).map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Student (optional)">
                <Select value={viewStudentId} onChange={(event) => setViewStudentId(event.target.value)}>
                  <option value="">All students</option>
                  {viewFilteredStudents.map((student) => (
                    <option key={student._id} value={student._id}>
                      {student.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            </CardContent>
          </Card>
        </>
      ) : null}

      {isTeacher ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Enter Marks</CardTitle>
            </CardHeader>
            <CardContent>
              <ExamMarksEntry
                exams={examsQuery.data ?? []}
                subjects={subjects}
                students={students}
                batches={batches}
                years={years}
                classes={classes}
                sections={sections}
                existingResults={teacherResultsQuery.data ?? []}
                isCollege={isCollege}
                resultsLockedExamIds={resultsLockedExamIds}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My Exam Routines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Exam">
                <Select value={teacherViewExamId} onChange={(event) => setTeacherViewExamId(event.target.value)}>
                  <option value="">Select exam</option>
                  {(examsQuery.data ?? []).map((exam) => (
                    <option key={exam._id} value={exam._id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <TeacherRoutineList examId={teacherViewExamId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filter Entered Marks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Exam">
                <Select value={teacherViewExamId} onChange={(event) => setTeacherViewExamId(event.target.value)}>
                  <option value="">All exams</option>
                  {(examsQuery.data ?? []).map((exam) => (
                    <option key={exam._id} value={exam._id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isCollege ? (
                <>
                  {hasSingleOption(batches) ? (
                    <FormField label={labels.primary}>
                      <Input value={batches[0]!.name} readOnly disabled />
                    </FormField>
                  ) : (
                    <FormField label={labels.primary}>
                      <Select
                        value={teacherViewBatchId}
                        onChange={(event) => {
                          setTeacherViewBatchId(event.target.value);
                          setTeacherViewYearId("");
                          setTeacherViewSubjectId("");
                        }}
                      >
                        <option value="">All batches</option>
                        {batches.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                  <FormField label={labels.secondary}>
                    <Select
                      value={teacherViewYearId}
                      onChange={(event) => {
                        setTeacherViewYearId(event.target.value);
                        setTeacherViewSubjectId("");
                      }}
                      disabled={!teacherViewBatchId && !hasSingleOption(batches)}
                    >
                      <option value="">All years</option>
                      {(teacherViewBatchId ? teacherViewYears : years).map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </>
              ) : (
                <>
                  {hasSingleOption(classes) ? (
                    <FormField label="Class">
                      <Input value={classes[0]!.name} readOnly disabled />
                    </FormField>
                  ) : (
                    <FormField label="Class">
                      <Select
                        value={teacherViewClassId}
                        onChange={(event) => {
                          setTeacherViewClassId(event.target.value);
                          setTeacherViewSectionId("");
                          setTeacherViewSubjectId("");
                        }}
                      >
                        <option value="">All classes</option>
                        {classes.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                  <FormField label="Section">
                    <Select
                      value={teacherViewSectionId}
                      onChange={(event) => setTeacherViewSectionId(event.target.value)}
                      disabled={!teacherViewClassId && !hasSingleOption(classes)}
                    >
                      <option value="">All sections</option>
                      {(teacherViewClassId ? teacherViewSections : sections).map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </>
              )}
              <FormField label="Subject">
                <Select
                  value={teacherViewSubjectId}
                  onChange={(event) => setTeacherViewSubjectId(event.target.value)}
                  disabled={isCollege ? !teacherViewYearId && !hasSingleOption(years) : !teacherViewClassId && !hasSingleOption(classes)}
                >
                  <option value="">All subjects</option>
                  {(isCollege ? (teacherViewYearId ? teacherViewSubjects : subjects) : teacherViewClassId ? teacherViewSubjects : subjects).map((subject) => (
                    <option key={subject._id} value={subject._id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </CardContent>
          </Card>
        </>
      ) : null}

      {(isAdmin || isTeacher) ? (
        <Card>
          <CardHeader>
            <CardTitle>{isAdmin ? "Results" : "My Subject Results"}</CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin && !viewFiltersComplete ? (
              <EmptyState title={`Select exam, ${labels.primary.toLowerCase()}, and ${labels.secondary.toLowerCase()}`} description="Choose filters above to view entered results." />
            ) : isTeacher && teacherResultsQuery.isLoading ? (
              <LoadingState />
            ) : isTeacher && teacherDisplayedResults.length === 0 ? (
              <EmptyState title="No results yet" description="Enter marks for your students using the form above." />
            ) : !isTeacher && resultsQuery.isLoading ? (
              <LoadingState />
            ) : !isTeacher && displayedResults.length === 0 ? (
              <EmptyState title="No results yet" description="Results will appear after teachers enter marks." />
            ) : isTeacher ? (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Exam</Th>
                        <Th>Student</Th>
                        <Th>Subject</Th>
                        <Th>Marks</Th>
                        <Th>Status</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {teacherDisplayedResults.map(({ result, mark }) => {
                        const computed = computeSubjectMark({ ...mark, obtainedMarks: 0 });
                        return (
                          <tr key={`${result._id}-${mark.subjectId}`}>
                            <Td>{(examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId}</Td>
                            <Td>{students.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId}</Td>
                            <Td>{subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId}</Td>
                            <Td>
                              {computed.obtainedMarks} / {computed.fullMarks}
                            </Td>
                            <Td>
                              <Badge className={computed.passFail === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                                {computed.passFail}
                              </Badge>
                            </Td>
                            <Td>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setMarksheetSelection({ examId: result.examId, studentId: result.studentId })}
                                >
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={deleteResultMarkMutation.isPending || resultsLockedExamIds.has(result.examId)}
                                  onClick={() => {
                                    const subjectName = subjectNameById.get(mark.subjectId)?.name ?? "this subject";
                                    if (window.confirm(`Delete marks for ${subjectName}?`)) {
                                      void deleteResultMarkMutation.mutateAsync({
                                        examId: result.examId,
                                        studentId: result.studentId,
                                        subjectId: mark.subjectId
                                      });
                                    }
                                  }}
                                >
                                  Delete
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {viewStudentId && selectedStudentResult ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {viewFilteredStudents.find((s) => s._id === viewStudentId)?.user.fullName ?? "Student"}
                        </h3>
                        <p className="text-sm text-slate-600">
                          Grade: {selectedStudentResult.grade} · GPA: {selectedStudentResult.gpa.toFixed(2)} · {selectedStudentResult.percentage}%
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge>{selectedStudentResult.grade}</Badge>
                        <Badge className={selectedStudentResult.passFailStatus === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                          {selectedStudentResult.passFailStatus}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(resolveApiUrl(`/exams/results/${selectedStudentResult.examId}/${selectedStudentResult.studentId}/marksheet/pdf`), "_blank")}
                        >
                          PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteResultMutation.isPending}
                          onClick={() => {
                            const studentName =
                              viewFilteredStudents.find((s) => s._id === viewStudentId)?.user.fullName ?? "this student";
                            if (window.confirm(`Delete the full result for ${studentName}?`)) {
                              void deleteResultMutation.mutateAsync(selectedStudentResult._id);
                            }
                          }}
                        >
                          Delete Result
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-white bg-white">
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>Subject</Th>
                            <Th>Theory</Th>
                            <Th>Practical</Th>
                            <Th>Internal</Th>
                            <Th>Total</Th>
                            <Th>Grade</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {selectedStudentResult.marks.map((mark) => {
                            const computed = computeSubjectMark({ ...mark, obtainedMarks: 0 });
                            return (
                              <tr key={mark.subjectId}>
                                <Td>{subjectNameById.get(mark.subjectId)?.name ?? "Subject"}</Td>
                                <Td>{mark.theoryMarks ?? 0}</Td>
                                <Td>{mark.practicalMarks ?? 0}</Td>
                                <Td>{mark.internalMarks ?? 0}</Td>
                                <Td>
                                  {computed.obtainedMarks} / {computed.fullMarks}
                                </Td>
                                <Td>{computed.grade}</Td>
                              </tr>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Exam</Th>
                        <Th>Student</Th>
                        <Th>Grade</Th>
                        <Th>GPA</Th>
                        <Th>Status</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {displayedResults.map((result) => (
                        <tr key={result._id}>
                          <Td>{(examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId}</Td>
                          <Td>{resultStudents.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId}</Td>
                          <Td>
                            <Badge>{result.grade}</Badge>
                          </Td>
                          <Td>{result.gpa.toFixed(2)}</Td>
                          <Td>
                            <Badge className={result.passFailStatus === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                              {result.passFailStatus}
                            </Badge>
                          </Td>
                          <Td>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setMarksheetSelection({ examId: result.examId, studentId: result.studentId })}
                              >
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={deleteResultMutation.isPending}
                                onClick={() => {
                                  const studentName =
                                    resultStudents.find((student) => student._id === result.studentId)?.user.fullName ?? "this student";
                                  if (window.confirm(`Delete the full result for ${studentName}?`)) {
                                    void deleteResultMutation.mutateAsync(result._id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {marksheetQuery.data ? (
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{marksheetQuery.data.student.user.fullName}</h3>
                        <p className="text-sm text-slate-600">{marksheetQuery.data.exam.name}</p>
                      </div>
                      <Badge>{marksheetQuery.data.result.grade}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      GPA: {marksheetQuery.data.result.gpa.toFixed(2)} · Percentage: {marksheetQuery.data.result.percentage}% ·{" "}
                      {marksheetQuery.data.result.passFailStatus}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </PageContent>
  );
};