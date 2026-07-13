import { getTodayBs, parseBsDate } from "@munatech/nepali-datepicker";
import { Suspense, lazy, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ClassRecord,
  ExamInput,
  ExamRecord,
  ResultRecord,
  SectionRecord,
  StudentRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import {
  EXAM_STATUSES,
  computeSubjectMark,
  examSchema,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { StudentNameLink } from "components/shared/StudentNameLink";
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
const ExamAnalyticsPanel = lazy(() =>
  import("features/exams/ExamAnalyticsPanel").then((module) => ({
    default: module.ExamAnalyticsPanel,
  })),
);
const ExamMarksEntry = lazy(() =>
  import("features/exams/ExamMarksEntry").then((module) => ({
    default: module.ExamMarksEntry,
  })),
);
const ExamRoutinePanel = lazy(() =>
  import("features/exams/ExamRoutinePanel").then((module) => ({
    default: module.ExamRoutinePanel,
  })),
);
const TeacherRoutineList = lazy(() =>
  import("features/exams/ExamRoutinePanel").then((module) => ({
    default: module.TeacherRoutineList,
  })),
);
const PrintResultsPanel = lazy(() =>
  import("features/exams/PrintResultsPanel").then((module) => ({
    default: module.PrintResultsPanel,
  })),
);
const ResultReviewPanel = lazy(() =>
  import("features/exams/ResultReviewPanel").then((module) => ({
    default: module.ResultReviewPanel,
  })),
);
const StudentExamPortal = lazy(() =>
  import("features/exams/StudentExamPortal").then((module) => ({
    default: module.StudentExamPortal,
  })),
);
import {
  EXAM_STATUS_LABELS,
  RESULT_SUBMISSION_STATUS_COLORS,
  RESULT_SUBMISSION_STATUS_LABELS,
  defaultExamValue,
} from "features/exams/examDefaults";
import { useIsCollege } from "hooks/useInstitutionType";
import {
  useHasInstitutionAccess,
  useIsTenantAdmin,
  useNormalizedRole,
} from "hooks/useNormalizedRole";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  hasSingleOption,
} from "lib/teacherScopeUtils";
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
  const canManage = useIsTenantAdmin();
  const hasInstitutionRead = useHasInstitutionAccess();
  /** Write admins + college viewers (read-only admin surfaces). */
  const isAdmin = canManage || hasInstitutionRead;
  const isStudentOrParent = role === "STUDENT" || role === "PARENT";
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [examForm, setExamForm] = useState<ExamInput>(defaultExamValue);
  const [examBatchId, setExamBatchId] = useState("");
  const [examYearId, setExamYearId] = useState("");
  const [examClassId, setExamClassId] = useState("");
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [marksheetSelection, setMarksheetSelection] = useState<{
    examId: string;
    studentId: string;
  } | null>(null);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [adminSection, setAdminSection] = useState<"manage" | "print-results">(
    "manage",
  );
  const [adminTab, setAdminTab] = useState<
    "routine" | "analytics" | "review" | "results"
  >("routine");

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

  const examsQuery = useQuery({
    queryKey: ["exams"],
    queryFn: () => unwrap<ExamRecord[]>(api.get("/exams")),
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: isAdmin && !isCollege,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: isAdmin && !isCollege,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; academicYearBs: string }>>(
        api.get("/academics/batches"),
      ),
    enabled: (isAdmin || isTeacher) && isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; batchId: string }>>(
        api.get("/academics/years"),
      ),
    enabled: (isAdmin || isTeacher) && isCollege,
  });
  const examYearsQuery = useQuery({
    queryKey: ["years", "exam-form", examBatchId],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; batchId: string }>>(
        api.get("/academics/years", { params: { batchId: examBatchId } }),
      ),
    enabled: isAdmin && isCollege && Boolean(examBatchId),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<{ academicYearBs: string }>(api.get("/settings")),
    enabled: isAdmin,
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
    enabled: isAdmin,
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: isAdmin,
  });

  const viewFiltersComplete = isCollege
    ? Boolean(viewExamId && viewBatchId && viewYearId)
    : Boolean(viewExamId && viewClassId && viewSectionId);

  const adminResultsQuery = useQuery({
    queryKey: [
      "results",
      "admin",
      viewExamId,
      viewClassId,
      viewSectionId,
      viewBatchId,
      viewYearId,
      viewStudentId,
    ],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: viewExamId || undefined,
                batchId: viewBatchId || undefined,
                yearId: viewYearId || undefined,
                studentId: viewStudentId || undefined,
              }
            : {
                examId: viewExamId || undefined,
                classId: viewClassId || undefined,
                sectionId: viewSectionId || undefined,
                studentId: viewStudentId || undefined,
              },
        }),
      ),
    enabled: isAdmin && viewFiltersComplete,
  });

  const portalResultsQuery = useQuery({
    queryKey: ["results", "portal"],
    queryFn: () => unwrap<ResultRecord[]>(api.get("/exams/results/all")),
    enabled: isStudentOrParent,
  });

  const teacherSubmissionsQuery = useQuery({
    queryKey: ["result-submissions", "teacher"],
    queryFn: () =>
      unwrap<
        Array<{
          _id: string;
          examId: string;
          subjectId: string;
          status: string;
          scopeLabel: string;
        }>
      >(api.get("/exams/result-submissions")),
    enabled: isTeacher,
  });

  const pendingReviewQuery = useQuery({
    queryKey: ["result-submissions", "pending-review"],
    queryFn: () =>
      unwrap<Array<{ _id: string; examId: string; status: string }>>(
        api.get("/exams/result-submissions", {
          params: { status: "PENDING_ADMIN_REVIEW" },
        }),
      ),
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  const pendingReviewCount = pendingReviewQuery.data?.length ?? 0;

  const teacherResultsQuery = useQuery({
    queryKey: [
      "results",
      "teacher",
      teacherViewExamId,
      teacherViewClassId,
      teacherViewBatchId,
      teacherViewYearId,
    ],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: teacherViewExamId || undefined,
                batchId: teacherViewBatchId || undefined,
                yearId: teacherViewYearId || undefined,
              }
            : {
                examId: teacherViewExamId || undefined,
                classId: teacherViewClassId || undefined,
              },
        }),
      ),
    enabled: isTeacher,
  });

  const resultsQuery = isAdmin
    ? adminResultsQuery
    : isTeacher
      ? teacherResultsQuery
      : portalResultsQuery;

  const marksheetQuery = useQuery({
    queryKey: [
      "marksheet",
      marksheetSelection?.examId,
      marksheetSelection?.studentId,
    ],
    queryFn: () =>
      unwrap<MarksheetResponse>(
        api.get(
          `/exams/results/${marksheetSelection?.examId}/${marksheetSelection?.studentId}/marksheet`,
        ),
      ),
    enabled: Boolean(
      marksheetSelection?.examId &&
      marksheetSelection?.studentId &&
      (isAdmin || isTeacher),
    ),
  });

  const examMutation = useMutation({
    mutationFn: async (payload: ExamInput) =>
      editingExamId
        ? unwrap<ExamRecord>(api.put(`/exams/${editingExamId}`, payload))
        : unwrap<ExamRecord>(api.post("/exams", payload)),
    onSuccess: async () => {
      toast.success(editingExamId ? "Exam updated" : "Exam created");
      setExamForm(defaultExamValue);
      setExamBatchId("");
      setExamYearId("");
      setExamClassId("");
      setEditingExamId(null);
      await queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteExamMutation = useMutation({
    mutationFn: async (examId: string) =>
      unwrap(api.delete(`/exams/${examId}`)),
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
        queryClient.invalidateQueries({ queryKey: ["exam-routines"] }),
        queryClient.invalidateQueries({ queryKey: ["print-results"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteResultMutation = useMutation({
    mutationFn: async (resultId: string) =>
      unwrap(api.delete(`/exams/results/${resultId}`)),
    onSuccess: async () => {
      toast.success("Result deleted");
      setMarksheetSelection(null);
      await queryClient.invalidateQueries({ queryKey: ["results"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteResultMarkMutation = useMutation({
    mutationFn: async ({
      examId,
      studentId,
      subjectId,
    }: {
      examId: string;
      studentId: string;
      subjectId: string;
    }) =>
      unwrap(
        api.delete(`/exams/results/${examId}/${studentId}/marks/${subjectId}`),
      ),
    onSuccess: async () => {
      toast.success("Subject marks deleted");
      await queryClient.invalidateQueries({ queryKey: ["results"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const examActionMutation = useMutation({
    mutationFn: async ({
      examId,
      action,
    }: {
      examId: string;
      action: "publish-results" | "unpublish-results" | "lock" | "unlock";
    }) => {
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
        unlock: "Results unlocked",
      };
      toast.success(labels[variables.action]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
        queryClient.invalidateQueries({ queryKey: ["print-results"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const classes = isTeacher
    ? (teacherScopeQuery.data?.classes ?? [])
    : (classesQuery.data ?? []);
  const sections = isTeacher
    ? (teacherScopeQuery.data?.sections ?? [])
    : (sectionsQuery.data ?? []);
  const batches = isTeacher
    ? (teacherScopeQuery.data?.batches ?? [])
    : (batchesQuery.data ?? []);
  const years = isTeacher
    ? (teacherScopeQuery.data?.years ?? [])
    : (yearsQuery.data ?? []);
  const subjects = isTeacher
    ? (teacherScopeQuery.data?.subjects ?? [])
    : (subjectsQuery.data ?? []);
  const students = isTeacher
    ? (teacherScopeQuery.data?.students ?? [])
    : (studentsQuery.data ?? []);

  const viewFilteredSections = useMemo(
    () =>
      (sectionsQuery.data ?? []).filter(
        (section) => section.classId === viewClassId,
      ),
    [sectionsQuery.data, viewClassId],
  );
  const viewFilteredYears = useMemo(
    () => filterYearsByBatch(yearsQuery.data ?? [], viewBatchId),
    [viewBatchId, yearsQuery.data],
  );
  const viewFilteredStudents = useMemo(
    () =>
      (studentsQuery.data ?? []).filter((student) =>
        isCollege
          ? student.batchId === viewBatchId && student.yearId === viewYearId
          : student.classId === viewClassId &&
            student.sectionId === viewSectionId,
      ),
    [
      isCollege,
      studentsQuery.data,
      viewBatchId,
      viewClassId,
      viewSectionId,
      viewYearId,
    ],
  );

  const teacherViewYears = useMemo(
    () => filterYearsByBatch(years, teacherViewBatchId),
    [teacherViewBatchId, years],
  );
  const teacherViewSections = useMemo(
    () => filterSectionsByClass(sections, teacherViewClassId),
    [sections, teacherViewClassId],
  );
  const teacherViewSubjects = useMemo(
    () =>
      (isCollege
        ? filterSubjectsByYear(subjects, teacherViewYearId)
        : filterSubjectsByClass(
            subjects,
            teacherViewClassId,
          )) as SubjectRecord[],
    [isCollege, subjects, teacherViewClassId, teacherViewYearId],
  );

  const teacherDisplayedResults = useMemo(() => {
    if (!isTeacher) return [];

    const teacherSubjectIds = teacherScopeQuery.data?.scope.subjectIds ?? [];
    return (teacherResultsQuery.data ?? [])
      .flatMap((result) =>
        result.marks
          .filter((mark) => teacherSubjectIds.includes(mark.subjectId))
          .filter(
            (mark) =>
              !teacherViewSubjectId || mark.subjectId === teacherViewSubjectId,
          )
          .map((mark) => ({ result, mark })),
      )
      .filter(({ result }) => {
        if (teacherViewExamId && result.examId !== teacherViewExamId)
          return false;
        if (isCollege) {
          if (teacherViewBatchId && result.batchId !== teacherViewBatchId)
            return false;
          if (teacherViewYearId && result.yearId !== teacherViewYearId)
            return false;
        } else {
          if (teacherViewClassId && result.classId !== teacherViewClassId)
            return false;
          if (teacherViewSectionId && result.sectionId !== teacherViewSectionId)
            return false;
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
    teacherViewYearId,
  ]);

  const displayedResults = useMemo(() => {
    const results = resultsQuery.data ?? [];
    if (!isAdmin) return results;
    return results.filter((result) => {
      const matchesScope = isCollege
        ? result.batchId === viewBatchId && result.yearId === viewYearId
        : result.sectionId === viewSectionId;
      return (
        matchesScope && (!viewStudentId || result.studentId === viewStudentId)
      );
    });
  }, [
    isAdmin,
    isCollege,
    resultsQuery.data,
    viewBatchId,
    viewSectionId,
    viewStudentId,
    viewYearId,
  ]);

  const selectedExam = useMemo(
    () => (examsQuery.data ?? []).find((exam) => exam._id === selectedExamId),
    [examsQuery.data, selectedExamId],
  );

  const resultsLockedExamIds = useMemo(
    () =>
      new Set(
        (examsQuery.data ?? [])
          .filter((exam) => exam.resultsLocked)
          .map((exam) => exam._id),
      ),
    [examsQuery.data],
  );

  const selectedStudentResult = useMemo(
    () => displayedResults.find((result) => result.studentId === viewStudentId),
    [displayedResults, viewStudentId],
  );

  const resultStudents = isAdmin ? (studentsQuery.data ?? []) : students;
  const subjectNameById = new Map(
    subjects.map((subject) => [subject._id, subject]),
  );

  const examYearOptions = useMemo(
    () => (examBatchId ? (examYearsQuery.data ?? []) : []),
    [examBatchId, examYearsQuery.data],
  );

  const academicSessionOptions = useMemo(() => {
    const sessions = new Set<string>();
    if (settingsQuery.data?.academicYearBs) {
      sessions.add(settingsQuery.data.academicYearBs);
    }
    (batchesQuery.data ?? []).forEach((batch) => {
      if (batch.academicYearBs) {
        sessions.add(batch.academicYearBs);
      }
    });
    if (examForm.academicYearBs) {
      sessions.add(examForm.academicYearBs);
    }
    return [...sessions].sort((left, right) => right.localeCompare(left));
  }, [
    batchesQuery.data,
    examForm.academicYearBs,
    settingsQuery.data?.academicYearBs,
  ]);

  const startDateValue = examForm.startDateBs
    ? parseBsDate(examForm.startDateBs)
    : undefined;
  const endDateValue = examForm.endDateBs
    ? parseBsDate(examForm.endDateBs)
    : undefined;

  const buildScopedExamForm = (
    current: ExamInput,
    scope: {
      batchId?: string;
      yearId?: string;
      classId?: string;
    },
  ): ExamInput => {
    if (isCollege) {
      const batchId = scope.batchId ?? examBatchId;
      const yearId = scope.yearId ?? examYearId;
      const selectedBatch = (batchesQuery.data ?? []).find(
        (batch) => batch._id === batchId,
      );
      return {
        ...current,
        academicYearBs: selectedBatch?.academicYearBs ?? current.academicYearBs,
        batchIds: batchId ? [batchId] : [],
        yearIds: yearId ? [yearId] : [],
        classIds: [],
      };
    }

    const classId = scope.classId ?? examClassId;
    return {
      ...current,
      classIds: classId ? [classId] : [],
      batchIds: [],
      yearIds: [],
    };
  };

  const resetExamForm = () => {
    setExamForm(defaultExamValue);
    setExamBatchId("");
    setExamYearId("");
    setExamClassId("");
    setEditingExamId(null);
  };

  const loadExamForEdit = (exam: ExamRecord) => {
    setEditingExamId(exam._id);
    setExamBatchId(exam.batchIds?.[0] ?? "");
    setExamYearId(exam.yearIds?.[0] ?? "");
    setExamClassId(exam.classIds?.[0] ?? "");
    setExamForm({
      name: exam.name,
      academicYearBs: exam.academicYearBs,
      startDateBs: exam.startDateBs,
      endDateBs: exam.endDateBs,
      resultPublishDateBs: exam.resultPublishDateBs ?? "",
      status: exam.status,
      classIds: exam.classIds ?? [],
      batchIds: exam.batchIds ?? [],
      yearIds: exam.yearIds ?? [],
    });
  };

  const isLoading = isStudentOrParent
    ? examsQuery.isLoading || portalResultsQuery.isLoading
    : examsQuery.isLoading ||
      (isAdmin &&
        (subjectsQuery.isLoading ||
          studentsQuery.isLoading ||
          (isCollege
            ? batchesQuery.isLoading || yearsQuery.isLoading
            : classesQuery.isLoading || sectionsQuery.isLoading)));

  if (isLoading) {
    return <LoadingState />;
  }

  if (isTeacher && teacherScopeQuery.isError) {
    return (
      <PageContent>
        <PageHeader
          title="Exams & Results"
          description="View exam routines and enter marks for your assigned subjects."
        />
        <EmptyState
          title="Could not load your teaching assignments"
          description={parseErrorMessage(teacherScopeQuery.error)}
        />
      </PageContent>
    );
  }

  if (isTeacher && teacherScopeQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Exams & Results"
        description={
          canManage
            ? "Create exams, publish routines, manage results, and view analytics."
            : isAdmin
              ? "View exams, routines, results, and print published marksheets (read-only)."
              : isTeacher
                ? "View exam routines and enter marks for your assigned subjects."
                : "View your exam schedule and published results."
        }
      />

      {isStudentOrParent ? (
        <Suspense fallback={<LoadingState />}>
          <StudentExamPortal
            exams={examsQuery.data ?? []}
            results={portalResultsQuery.data ?? []}
            isLoading={portalResultsQuery.isLoading}
          />
        </Suspense>
      ) : null}

      {isAdmin ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={adminSection === "manage" ? "default" : "outline"}
              onClick={() => setAdminSection("manage")}
            >
              Exam Sessions
            </Button>
            <Button
              size="sm"
              variant={adminSection === "print-results" ? "default" : "outline"}
              onClick={() => setAdminSection("print-results")}
            >
              Print Results
            </Button>
          </div>

          {adminSection === "print-results" ? (
            <Suspense fallback={<LoadingState />}>
              <PrintResultsPanel
                isCollege={isCollege}
                labels={labels}
                batches={batchesQuery.data ?? []}
                years={yearsQuery.data ?? []}
                classes={classesQuery.data ?? []}
                sections={sectionsQuery.data ?? []}
                students={studentsQuery.data ?? []}
                fallbackPublishedExams={(examsQuery.data ?? []).filter(
                  (exam) => exam.resultsPublished,
                )}
              />
            </Suspense>
          ) : null}

          {adminSection === "manage" ? (
            <>
              {canManage ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {editingExamId ? "Edit Exam" : "Create Exam"}
                    </CardTitle>
                    <p className="text-sm text-slate-500">
                      Use the live Nepali calendar for exam dates and assign the
                      exam to a {isCollege ? "batch and year" : "class"}.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-6"
                      onSubmit={(event) => {
                        event.preventDefault();

                        if (isCollege && (!examBatchId || !examYearId)) {
                          toast.error(
                            `Select both ${labels.primary.toLowerCase()} and ${labels.secondary.toLowerCase()}`,
                          );
                          return;
                        }

                        if (!isCollege && !examClassId) {
                          toast.error("Select a class for this exam");
                          return;
                        }

                        const scopedForm = buildScopedExamForm(examForm, {});
                        const parsed = examSchema.safeParse(scopedForm);
                        if (!parsed.success) {
                          toast.error(
                            parsed.error.issues[0]?.message ??
                              "Validation failed",
                          );
                          return;
                        }
                        void examMutation.mutateAsync(parsed.data);
                      }}
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <FormField label="Exam Name">
                            <Input
                              value={examForm.name}
                              onChange={(event) =>
                                setExamForm((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </FormField>
                        </div>

                        <FormField label="Academic Session">
                          <Select
                            value={examForm.academicYearBs}
                            onChange={(event) =>
                              setExamForm((current) => ({
                                ...current,
                                academicYearBs: event.target.value,
                              }))
                            }
                          >
                            {academicSessionOptions.length === 0 ? (
                              <option value={examForm.academicYearBs}>
                                {examForm.academicYearBs}
                              </option>
                            ) : (
                              academicSessionOptions.map((session) => (
                                <option key={session} value={session}>
                                  {session}
                                </option>
                              ))
                            )}
                          </Select>
                        </FormField>

                        <FormField label="Status">
                          <Select
                            value={examForm.status}
                            onChange={(event) =>
                              setExamForm((current) => ({
                                ...current,
                                status: event.target
                                  .value as ExamInput["status"],
                              }))
                            }
                          >
                            {EXAM_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {EXAM_STATUS_LABELS[status] ?? status}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        <p className="text-sm font-semibold text-slate-900">
                          Exam schedule (Nepali calendar)
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Pick dates from the live BS calendar. End date cannot
                          be before the start date.
                        </p>
                        <div className="mt-4 grid gap-4 md:grid-cols-3">
                          <FormField label="Start Date (BS)">
                            <NepaliDateField
                              value={examForm.startDateBs}
                              maxDate={endDateValue ?? undefined}
                              onChange={(value) =>
                                setExamForm((current) => {
                                  const nextEnd =
                                    current.endDateBs &&
                                    value &&
                                    current.endDateBs < value
                                      ? value
                                      : current.endDateBs;
                                  return {
                                    ...current,
                                    startDateBs: value,
                                    endDateBs: nextEnd,
                                  };
                                })
                              }
                            />
                          </FormField>
                          <FormField label="End Date (BS)">
                            <NepaliDateField
                              value={examForm.endDateBs}
                              minDate={startDateValue ?? getTodayBs()}
                              onChange={(value) =>
                                setExamForm((current) => ({
                                  ...current,
                                  endDateBs: value,
                                }))
                              }
                            />
                          </FormField>
                          <FormField label="Result Publish Date (optional)">
                            <NepaliDateField
                              value={examForm.resultPublishDateBs ?? ""}
                              minDate={
                                endDateValue ?? startDateValue ?? getTodayBs()
                              }
                              onChange={(value) =>
                                setExamForm((current) => ({
                                  ...current,
                                  resultPublishDateBs: value,
                                }))
                              }
                            />
                          </FormField>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">
                          Exam scope
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {isCollege
                            ? `Choose the ${labels.primary.toLowerCase()} first, then select the ${labels.secondary.toLowerCase()} for this exam session.`
                            : "Choose which class this exam applies to."}
                        </p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          {isCollege ? (
                            <>
                              <FormField label={labels.primary}>
                                <Select
                                  value={examBatchId}
                                  onChange={(event) => {
                                    const batchId = event.target.value;
                                    setExamBatchId(batchId);
                                    setExamYearId("");
                                    setExamForm((current) =>
                                      buildScopedExamForm(current, {
                                        batchId,
                                        yearId: "",
                                        classId: "",
                                      }),
                                    );
                                  }}
                                >
                                  <option value="">
                                    Select {labels.primary.toLowerCase()}
                                  </option>
                                  {(batchesQuery.data ?? []).map((batch) => (
                                    <option key={batch._id} value={batch._id}>
                                      {batch.name} ({batch.academicYearBs})
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <FormField label={labels.secondary}>
                                <Select
                                  value={examYearId}
                                  disabled={
                                    !examBatchId || examYearsQuery.isLoading
                                  }
                                  onChange={(event) => {
                                    const yearId = event.target.value;
                                    setExamYearId(yearId);
                                    setExamForm((current) =>
                                      buildScopedExamForm(current, { yearId }),
                                    );
                                  }}
                                >
                                  <option value="">
                                    {examBatchId
                                      ? `Select ${labels.secondary.toLowerCase()}`
                                      : `Select ${labels.primary.toLowerCase()} first`}
                                  </option>
                                  {examYearOptions.map((year) => (
                                    <option key={year._id} value={year._id}>
                                      {year.name}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                            </>
                          ) : (
                            <FormField label="Class">
                              <Select
                                value={examClassId}
                                onChange={(event) => {
                                  const classId = event.target.value;
                                  setExamClassId(classId);
                                  setExamForm((current) =>
                                    buildScopedExamForm(current, { classId }),
                                  );
                                }}
                              >
                                <option value="">Select class</option>
                                {(classesQuery.data ?? []).map(
                                  (schoolClass) => (
                                    <option
                                      key={schoolClass._id}
                                      value={schoolClass._id}
                                    >
                                      {schoolClass.name}
                                    </option>
                                  ),
                                )}
                              </Select>
                            </FormField>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        {editingExamId ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={resetExamForm}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        <Button type="submit">
                          {editingExamId ? "Update Exam" : "Create Exam"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>Exam Sessions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(examsQuery.data ?? []).length === 0 ? (
                    <EmptyState
                      title="No exams yet"
                      description="Create an exam and assign it to batches/years."
                    />
                  ) : (
                    (examsQuery.data ?? []).map((exam) => (
                      <div
                        key={exam._id}
                        className={`rounded-2xl border p-4 transition-colors ${selectedExamId === exam._id ? "border-brand-300 bg-brand-50/30" : "border-slate-200"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">
                              {exam.name}
                            </h3>
                            <p className="text-sm text-slate-500">
                              {exam.startDateBs} to {exam.endDateBs} ·{" "}
                              {exam.academicYearBs}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge>
                                {EXAM_STATUS_LABELS[exam.status] ?? exam.status}
                              </Badge>
                              {exam.routinePublished ? (
                                <Badge className="bg-blue-100 text-blue-700">
                                  Routine Live
                                </Badge>
                              ) : null}
                              {exam.resultsPublished ? (
                                <Badge className="bg-brand-100 text-brand-700">
                                  Results Published
                                </Badge>
                              ) : null}
                              {exam.resultsLocked ? (
                                <Badge className="bg-amber-100 text-amber-700">
                                  Locked
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {canManage ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => loadExamForEdit(exam)}
                              >
                                Edit
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant={
                                selectedExamId === exam._id
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() => {
                                setSelectedExamId(exam._id);
                                setAdminTab("routine");
                              }}
                            >
                              {canManage ? "Manage" : "View"}
                            </Button>
                            {canManage ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={deleteExamMutation.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete "${exam.name}"? This permanently removes the exam and routines if no results exist.`,
                                    )
                                  ) {
                                    void deleteExamMutation.mutateAsync(
                                      exam._id,
                                    );
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {canManage ? (
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                            {exam.resultsPublished ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void examActionMutation.mutateAsync({
                                    examId: exam._id,
                                    action: "unpublish-results",
                                  })
                                }
                              >
                                Unpublish Results
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Publish results for "${exam.name}"? All subject submissions must be approved first. Results will be locked and students will be notified.`,
                                    )
                                  ) {
                                    void examActionMutation.mutateAsync({
                                      examId: exam._id,
                                      action: "publish-results",
                                    });
                                  }
                                }}
                              >
                                Publish Results
                              </Button>
                            )}
                            {exam.resultsLocked ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void examActionMutation.mutateAsync({
                                    examId: exam._id,
                                    action: "unlock",
                                  })
                                }
                              >
                                Unlock Results
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void examActionMutation.mutateAsync({
                                    examId: exam._id,
                                    action: "lock",
                                  })
                                }
                              >
                                Lock Results
                              </Button>
                            )}
                          </div>
                        ) : null}
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
                        {(
                          ["routine", "analytics", "review", "results"] as const
                        ).map((tab) => (
                          <Button
                            key={tab}
                            size="sm"
                            variant={adminTab === tab ? "default" : "outline"}
                            onClick={() => setAdminTab(tab)}
                          >
                            {tab === "routine"
                              ? "Routine"
                              : tab === "analytics"
                                ? "Analytics"
                                : tab === "review"
                                  ? "Review"
                                  : "Results"}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {adminTab === "routine" ? (
                      <Suspense fallback={<LoadingState />}>
                        <ExamRoutinePanel
                          exam={selectedExam}
                          subjects={subjectsQuery.data ?? []}
                          isAdmin={canManage}
                          readOnly={!canManage}
                        />
                      </Suspense>
                    ) : adminTab === "analytics" ? (
                      <Suspense fallback={<LoadingState />}>
                        <ExamAnalyticsPanel examId={selectedExam._id} />
                      </Suspense>
                    ) : adminTab === "review" ? (
                      <Suspense fallback={<LoadingState />}>
                        <ResultReviewPanel
                          examId={selectedExam._id}
                          students={studentsQuery.data ?? []}
                          subjects={subjectsQuery.data ?? []}
                          isCollege={isCollege}
                          compact
                        />
                      </Suspense>
                    ) : (
                      <p className="text-sm text-slate-600">
                        Use the results filters below to view entered marks for
                        this exam.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle>Result Approval Workflow</CardTitle>
                    {pendingReviewCount > 0 ? (
                      <Badge className="bg-amber-100 text-amber-800">
                        {pendingReviewCount} pending review
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-slate-600">
                    Teachers submit subject results here. Approve each
                    submission, then use Publish Results on the exam session
                    above.
                  </p>
                </CardHeader>
                <CardContent>
                  <Suspense fallback={<LoadingState />}>
                    <ResultReviewPanel
                      students={studentsQuery.data ?? []}
                      subjects={subjectsQuery.data ?? []}
                      isCollege={isCollege}
                    />
                  </Suspense>
                </CardContent>
              </Card>

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
                      <option value="">
                        Select {labels.primary.toLowerCase()}
                      </option>
                      {(isCollege
                        ? (batchesQuery.data ?? [])
                        : (classesQuery.data ?? [])
                      ).map((item) => (
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
                      <option value="">
                        Select {labels.secondary.toLowerCase()}
                      </option>
                      {(isCollege
                        ? viewFilteredYears
                        : viewFilteredSections
                      ).map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Student (optional)">
                    <Select
                      value={viewStudentId}
                      onChange={(event) => setViewStudentId(event.target.value)}
                    >
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
        </>
      ) : null}

      {isTeacher ? (
        <>
          {subjects.length === 0 || students.length === 0 ? (
            <EmptyState
              title="No teaching assignments found"
              description="Your account has no assigned subjects or students. Contact the college admin to assign subjects before entering exam marks."
            />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Enter Marks</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<LoadingState />}>
                <ExamMarksEntry
                  exams={examsQuery.data ?? []}
                  subjects={subjects}
                  students={students}
                  batches={batches}
                  years={years}
                  classes={classes}
                  sections={sections}
                  isCollege={isCollege}
                  resultsLockedExamIds={resultsLockedExamIds}
                />
              </Suspense>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My Exam Routines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Exam">
                <Select
                  value={teacherViewExamId}
                  onChange={(event) => setTeacherViewExamId(event.target.value)}
                >
                  <option value="">Select exam</option>
                  {(examsQuery.data ?? []).map((exam) => (
                    <option key={exam._id} value={exam._id}>
                      {exam.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Suspense fallback={<LoadingState />}>
                <TeacherRoutineList examId={teacherViewExamId} />
              </Suspense>
            </CardContent>
          </Card>

          {(teacherSubmissionsQuery.data ?? []).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>My Submission Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(teacherSubmissionsQuery.data ?? []).map((submission) => (
                    <div
                      key={submission._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {submission.scopeLabel}
                        </p>
                        <p className="text-xs text-slate-500">
                          {(examsQuery.data ?? []).find(
                            (exam) => exam._id === submission.examId,
                          )?.name ?? submission.examId}
                        </p>
                      </div>
                      <Badge
                        className={
                          RESULT_SUBMISSION_STATUS_COLORS[submission.status] ??
                          "bg-slate-100 text-slate-700"
                        }
                      >
                        {RESULT_SUBMISSION_STATUS_LABELS[submission.status] ??
                          submission.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Filter Entered Marks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Exam">
                <Select
                  value={teacherViewExamId}
                  onChange={(event) => setTeacherViewExamId(event.target.value)}
                >
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
                      disabled={
                        !teacherViewBatchId && !hasSingleOption(batches)
                      }
                    >
                      <option value="">All years</option>
                      {(teacherViewBatchId ? teacherViewYears : years).map(
                        (item) => (
                          <option key={item._id} value={item._id}>
                            {item.name}
                          </option>
                        ),
                      )}
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
                      onChange={(event) =>
                        setTeacherViewSectionId(event.target.value)
                      }
                      disabled={
                        !teacherViewClassId && !hasSingleOption(classes)
                      }
                    >
                      <option value="">All sections</option>
                      {(teacherViewClassId
                        ? teacherViewSections
                        : sections
                      ).map((item) => (
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
                  onChange={(event) =>
                    setTeacherViewSubjectId(event.target.value)
                  }
                  disabled={
                    isCollege
                      ? !teacherViewYearId && !hasSingleOption(years)
                      : !teacherViewClassId && !hasSingleOption(classes)
                  }
                >
                  <option value="">All subjects</option>
                  {(isCollege
                    ? teacherViewYearId
                      ? teacherViewSubjects
                      : subjects
                    : teacherViewClassId
                      ? teacherViewSubjects
                      : subjects
                  ).map((subject) => (
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

      {isTeacher || (isAdmin && adminSection === "manage") ? (
        <Card>
          <CardHeader>
            <CardTitle>{isAdmin ? "Results" : "My Subject Results"}</CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin && !viewFiltersComplete ? (
              <EmptyState
                title={`Select exam, ${labels.primary.toLowerCase()}, and ${labels.secondary.toLowerCase()}`}
                description="Choose filters above to view entered results."
              />
            ) : isTeacher && teacherResultsQuery.isLoading ? (
              <LoadingState />
            ) : isTeacher && teacherDisplayedResults.length === 0 ? (
              <EmptyState
                title="No results yet"
                description="Enter marks for your students using the form above."
              />
            ) : !isTeacher && resultsQuery.isLoading ? (
              <LoadingState />
            ) : !isTeacher && displayedResults.length === 0 ? (
              <EmptyState
                title="No results yet"
                description="Results will appear after teachers enter marks."
              />
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
                        <Th>Pass/Fail</Th>
                        <Th>Workflow</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {teacherDisplayedResults.map(({ result, mark }) => {
                        const computed = computeSubjectMark({
                          ...mark,
                          obtainedMarks: 0,
                        });
                        const submission = (
                          teacherSubmissionsQuery.data ?? []
                        ).find(
                          (item) =>
                            item.examId === result.examId &&
                            item.subjectId === mark.subjectId,
                        );
                        const workflowStatus = submission?.status ?? "DRAFT";
                        const canDelete =
                          !resultsLockedExamIds.has(result.examId) &&
                          (workflowStatus === "DRAFT" ||
                            workflowStatus === "RETURNED_FOR_CORRECTION");
                        return (
                          <tr key={`${result._id}-${mark.subjectId}`}>
                            <Td>
                              {(examsQuery.data ?? []).find(
                                (exam) => exam._id === result.examId,
                              )?.name ?? result.examId}
                            </Td>
                            <Td>
                              {(() => {
                                const matched = students.find(
                                  (student) => student._id === result.studentId,
                                );
                                return matched ? (
                                  <StudentNameLink
                                    studentId={matched._id}
                                    name={matched.user.fullName}
                                  />
                                ) : (
                                  result.studentId
                                );
                              })()}
                            </Td>
                            <Td>
                              {subjectNameById.get(mark.subjectId)?.name ??
                                mark.subjectId}
                            </Td>
                            <Td>
                              {computed.obtainedMarks} / {computed.fullMarks}
                            </Td>
                            <Td>
                              <Badge
                                className={
                                  computed.passFail === "PASS"
                                    ? "bg-brand-100 text-brand-700"
                                    : "bg-red-100 text-red-700"
                                }
                              >
                                {computed.passFail}
                              </Badge>
                            </Td>
                            <Td>
                              <Badge
                                className={
                                  RESULT_SUBMISSION_STATUS_COLORS[
                                    workflowStatus
                                  ] ?? "bg-slate-100 text-slate-700"
                                }
                              >
                                {RESULT_SUBMISSION_STATUS_LABELS[
                                  workflowStatus
                                ] ?? workflowStatus}
                              </Badge>
                            </Td>
                            <Td>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setMarksheetSelection({
                                      examId: result.examId,
                                      studentId: result.studentId,
                                    })
                                  }
                                >
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={
                                    deleteResultMarkMutation.isPending ||
                                    !canDelete
                                  }
                                  onClick={() => {
                                    const subjectName =
                                      subjectNameById.get(mark.subjectId)
                                        ?.name ?? "this subject";
                                    if (
                                      window.confirm(
                                        `Delete marks for ${subjectName}?`,
                                      )
                                    ) {
                                      void deleteResultMarkMutation.mutateAsync(
                                        {
                                          examId: result.examId,
                                          studentId: result.studentId,
                                          subjectId: mark.subjectId,
                                        },
                                      );
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
                  <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {viewFilteredStudents.find(
                            (s) => s._id === viewStudentId,
                          )?.user.fullName ?? "Student"}
                        </h3>
                        <p className="text-sm text-slate-600">
                          Grade: {selectedStudentResult.grade} · GPA:{" "}
                          {(selectedStudentResult.gpa ?? 0).toFixed(2)} ·{" "}
                          {selectedStudentResult.percentage}%
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge>{selectedStudentResult.grade}</Badge>
                        <Badge
                          className={
                            selectedStudentResult.passFailStatus === "PASS"
                              ? "bg-brand-100 text-brand-700"
                              : "bg-red-100 text-red-700"
                          }
                        >
                          {selectedStudentResult.passFailStatus}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              resolveApiUrl(
                                `/exams/results/${selectedStudentResult.examId}/${selectedStudentResult.studentId}/marksheet/pdf`,
                              ),
                              "_blank",
                            )
                          }
                        >
                          PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteResultMutation.isPending}
                          onClick={() => {
                            const studentName =
                              viewFilteredStudents.find(
                                (s) => s._id === viewStudentId,
                              )?.user.fullName ?? "this student";
                            if (
                              window.confirm(
                                `Delete the full result for ${studentName}?`,
                              )
                            ) {
                              void deleteResultMutation.mutateAsync(
                                selectedStudentResult._id,
                              );
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
                            const computed = computeSubjectMark({
                              ...mark,
                              obtainedMarks: 0,
                            });
                            return (
                              <tr key={mark.subjectId}>
                                <Td>
                                  {subjectNameById.get(mark.subjectId)?.name ??
                                    "Subject"}
                                </Td>
                                <Td>{mark.theoryMarks ?? 0}</Td>
                                <Td>{mark.practicalMarks ?? 0}</Td>
                                <Td>{mark.internalMarks ?? 0}</Td>
                                <Td>
                                  {computed.obtainedMarks} /{" "}
                                  {computed.fullMarks}
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
                          <Td>
                            {(examsQuery.data ?? []).find(
                              (exam) => exam._id === result.examId,
                            )?.name ?? result.examId}
                          </Td>
                          <Td>
                            {(() => {
                              const matched = resultStudents.find(
                                (student) => student._id === result.studentId,
                              );
                              return matched ? (
                                <StudentNameLink
                                  studentId={matched._id}
                                  name={matched.user.fullName}
                                />
                              ) : (
                                result.studentId
                              );
                            })()}
                          </Td>
                          <Td>
                            <Badge>{result.grade}</Badge>
                          </Td>
                          <Td>{(result.gpa ?? 0).toFixed(2)}</Td>
                          <Td>
                            <Badge
                              className={
                                result.passFailStatus === "PASS"
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-red-100 text-red-700"
                              }
                            >
                              {result.passFailStatus}
                            </Badge>
                          </Td>
                          <Td>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setMarksheetSelection({
                                    examId: result.examId,
                                    studentId: result.studentId,
                                  })
                                }
                              >
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={deleteResultMutation.isPending}
                                onClick={() => {
                                  const studentName =
                                    resultStudents.find(
                                      (student) =>
                                        student._id === result.studentId,
                                    )?.user.fullName ?? "this student";
                                  if (
                                    window.confirm(
                                      `Delete the full result for ${studentName}?`,
                                    )
                                  ) {
                                    void deleteResultMutation.mutateAsync(
                                      result._id,
                                    );
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
                  <div className="rounded-3xl border border-brand-200 bg-brand-50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">
                          {marksheetQuery.data.student.user.fullName}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {marksheetQuery.data.exam.name}
                        </p>
                      </div>
                      <Badge>{marksheetQuery.data.result.grade}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      GPA: {(marksheetQuery.data.result.gpa ?? 0).toFixed(2)} ·
                      Percentage: {marksheetQuery.data.result.percentage}% ·{" "}
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
