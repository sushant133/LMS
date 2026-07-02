import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ClassRecord,
  ExamInput,
  ExamRecord,
  ResultInput,
  ResultRecord,
  SectionRecord,
  StudentRecord,
  SubjectRecord
} from "@nepal-school-erp/shared";
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

const defaultExamValue: ExamInput = {
  name: "",
  academicYearBs: "2083/2084",
  startDateBs: "",
  endDateBs: "",
  classIds: []
};

const defaultResultValue: ResultInput = {
  examId: "",
  studentId: "",
  classId: "",
  sectionId: "",
  marks: [],
  publishedAtBs: ""
};

interface MarksheetResponse {
  result: ResultRecord;
  exam: ExamRecord;
  student: StudentRecord;
  section: SectionRecord;
  subjects: SubjectRecord[];
}

export const ExamManager = () => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
  const isStudentOrParent = user?.role === "STUDENT" || user?.role === "PARENT";
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [examForm, setExamForm] = useState<ExamInput>(defaultExamValue);
  const [resultForm, setResultForm] = useState<ResultInput>(defaultResultValue);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [marksheetSelection, setMarksheetSelection] = useState<{ examId: string; studentId: string } | null>(null);

  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [viewExamId, setViewExamId] = useState("");
  const [viewClassId, setViewClassId] = useState("");
  const [viewSectionId, setViewSectionId] = useState("");
  const [viewStudentId, setViewStudentId] = useState("");
  const [teacherViewExamId, setTeacherViewExamId] = useState("");
  const [teacherViewClassId, setTeacherViewClassId] = useState("");
  const [teacherViewSectionId, setTeacherViewSectionId] = useState("");
  const [teacherViewSubjectId, setTeacherViewSubjectId] = useState("");

  const examsQuery = useQuery({ queryKey: ["exams"], queryFn: () => unwrap<ExamRecord[]>(api.get("/exams")) });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: isAdmin
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: isAdmin
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

  const viewFiltersComplete = Boolean(viewExamId && viewClassId && viewSectionId);

  const adminResultsQuery = useQuery({
    queryKey: ["results", "admin", viewExamId, viewClassId, viewSectionId, viewStudentId],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: {
            examId: viewExamId || undefined,
            classId: viewClassId || undefined,
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
    queryKey: ["results", "teacher", teacherViewExamId, teacherViewClassId],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: {
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

  const resultMutation = useMutation({
    mutationFn: async (payload: ResultInput) => unwrap<ResultRecord>(api.post("/exams/results", payload)),
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

  const filteredSections = useMemo(
    () => filterSectionsByClass(sections, resultForm.classId),
    [resultForm.classId, sections]
  );
  const teacherFormSubjects = useMemo(
    () => (isTeacher ? (filterSubjectsByClass(subjects, resultForm.classId) as SubjectRecord[]) : []),
    [isTeacher, resultForm.classId, subjects]
  );
  const teacherViewSubjects = useMemo(
    () => (isTeacher ? (filterSubjectsByClass(subjects, teacherViewClassId) as SubjectRecord[]) : []),
    [isTeacher, teacherViewClassId, subjects]
  );
  const teacherViewSections = useMemo(
    () => filterSectionsByClass(sections, teacherViewClassId),
    [sections, teacherViewClassId]
  );
  const filteredStudents = useMemo(
    () => students.filter((student) => student.classId === resultForm.classId && student.sectionId === resultForm.sectionId),
    [resultForm.classId, resultForm.sectionId, students]
  );

  const viewFilteredSections = useMemo(
    () => (sectionsQuery.data ?? []).filter((section) => section.classId === viewClassId),
    [sectionsQuery.data, viewClassId]
  );
  const viewFilteredStudents = useMemo(
    () => (studentsQuery.data ?? []).filter((student) => student.classId === viewClassId && student.sectionId === viewSectionId),
    [studentsQuery.data, viewClassId, viewSectionId]
  );

  const teacherDisplayedResults = useMemo(() => {
    if (!isTeacher) {
      return [];
    }

    const teacherSubjectIds = teacherScopeQuery.data?.scope.subjectIds ?? [];
    return (teacherResultsQuery.data ?? [])
      .flatMap((result) =>
        result.marks
          .filter((mark) => teacherSubjectIds.includes(mark.subjectId))
          .filter((mark) => !teacherViewSubjectId || mark.subjectId === teacherViewSubjectId)
          .map((mark) => ({ result, mark }))
      )
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
    if (!isAdmin) return results;
    return results.filter(
      (result) => result.sectionId === viewSectionId && (!viewStudentId || result.studentId === viewStudentId)
    );
  }, [isAdmin, resultsQuery.data, viewSectionId, viewStudentId]);

  const resultStudents = isAdmin ? (studentsQuery.data ?? []) : students;

  const selectedStudentResult = useMemo(
    () => displayedResults.find((result) => result.studentId === viewStudentId),
    [displayedResults, viewStudentId]
  );

  useEffect(() => {
    if (!isTeacher) {
      return;
    }

    if (hasSingleOption(classes) && resultForm.classId !== classes[0]!._id) {
      setResultForm((current) => ({ ...current, classId: classes[0]!._id, sectionId: "", studentId: "" }));
    }
  }, [classes, isTeacher, resultForm.classId]);

  useEffect(() => {
    if (!isTeacher || !resultForm.classId) {
      return;
    }

    if (hasSingleOption(filteredSections) && resultForm.sectionId !== filteredSections[0]!._id) {
      setResultForm((current) => ({ ...current, sectionId: filteredSections[0]!._id, studentId: "" }));
    }
  }, [filteredSections, isTeacher, resultForm.classId, resultForm.sectionId]);

  useEffect(() => {
    if (!isTeacher) {
      return;
    }

    if (hasSingleOption(classes) && teacherViewClassId !== classes[0]!._id) {
      setTeacherViewClassId(classes[0]!._id);
    }
  }, [classes, isTeacher, teacherViewClassId]);

  useEffect(() => {
    if (!isTeacher || !resultForm.classId) {
      return;
    }

    if (hasSingleOption(teacherFormSubjects) && selectedSubjectId !== teacherFormSubjects[0]!._id) {
      setSelectedSubjectId(teacherFormSubjects[0]!._id);
    }
  }, [isTeacher, resultForm.classId, selectedSubjectId, teacherFormSubjects]);

  useEffect(() => {
    if (!isTeacher || !resultForm.examId || !resultForm.studentId || !selectedSubjectId) {
      return;
    }

    const existing = (teacherResultsQuery.data ?? []).find(
      (result) => result.examId === resultForm.examId && result.studentId === resultForm.studentId
    );
    const existingMark = existing?.marks.find((mark) => mark.subjectId === selectedSubjectId);

    setResultForm((current) => ({
      ...current,
      marks: [{ subjectId: selectedSubjectId, obtainedMarks: existingMark?.obtainedMarks ?? 0 }],
      publishedAtBs: existing?.publishedAtBs ?? current.publishedAtBs
    }));
  }, [isTeacher, resultForm.examId, resultForm.studentId, selectedSubjectId, teacherResultsQuery.data]);

  const loadTeacherResultForEdit = (result: ResultRecord, subjectId: string) => {
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
    return <LoadingState />;
  }

  const subjectNameById = new Map(subjects.map((subject) => [subject._id, subject]));

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Exams & Results"
        description={
          isAdmin
            ? "Create exam sessions and view published results. Teachers enter marks from their section."
            : isTeacher
              ? "Enter and edit marks for your assigned subject and students after the school admin creates exams."
              : "View your published exam results, subject marks, grades, and overall performance."
        }
      />

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
                <FormField label="Academic Year">
                  <Input value={examForm.academicYearBs} onChange={(event) => setExamForm((current) => ({ ...current, academicYearBs: event.target.value }))} />
                </FormField>
                <FormField label="Start Date (BS)">
                  <NepaliDateField value={examForm.startDateBs} onChange={(value) => setExamForm((current) => ({ ...current, startDateBs: value }))} />
                </FormField>
                <FormField label="End Date (BS)">
                  <NepaliDateField value={examForm.endDateBs} onChange={(value) => setExamForm((current) => ({ ...current, endDateBs: value }))} />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Classes">
                    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3">
                      {(classesQuery.data ?? []).map((item) => {
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
              <FormField label="Class">
                <Select
                  value={viewClassId}
                  onChange={(event) => {
                    setViewClassId(event.target.value);
                    setViewSectionId("");
                    setViewStudentId("");
                  }}
                >
                  <option value="">Select class</option>
                  {(classesQuery.data ?? []).map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Section">
                <Select
                  value={viewSectionId}
                  onChange={(event) => {
                    setViewSectionId(event.target.value);
                    setViewStudentId("");
                  }}
                >
                  <option value="">Select section</option>
                  {viewFilteredSections.map((item) => (
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
        <Card>
          <CardHeader>
            <CardTitle>Enter / Edit Result</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectedSubjectId) {
                  toast.error("Select a subject");
                  return;
                }
                const obtainedMarks =
                  resultForm.marks.find((mark) => mark.subjectId === selectedSubjectId)?.obtainedMarks ?? 0;
                const parsed = resultSchema.safeParse({
                  ...resultForm,
                  marks: [{ subjectId: selectedSubjectId, obtainedMarks }]
                });
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void resultMutation.mutateAsync(parsed.data);
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Exam">
                  <Select value={resultForm.examId} onChange={(event) => setResultForm((current) => ({ ...current, examId: event.target.value }))}>
                    <option value="">Select exam</option>
                    {(examsQuery.data ?? []).map((exam) => (
                      <option key={exam._id} value={exam._id}>
                        {exam.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {hasSingleOption(classes) ? (
                  <FormField label="Class">
                    <Input value={classes[0]!.name} readOnly disabled />
                  </FormField>
                ) : (
                  <FormField label="Class">
                    <Select
                      value={resultForm.classId}
                      onChange={(event) => {
                        setSelectedSubjectId("");
                        setResultForm((current) => ({ ...current, classId: event.target.value, sectionId: "", studentId: "" }));
                      }}
                    >
                      <option value="">Select class</option>
                      {classes.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                {hasSingleOption(filteredSections) ? (
                  <FormField label="Section">
                    <Input value={filteredSections[0]!.name} readOnly disabled />
                  </FormField>
                ) : (
                  <FormField label="Section">
                    <Select
                      value={resultForm.sectionId}
                      onChange={(event) => setResultForm((current) => ({ ...current, sectionId: event.target.value, studentId: "" }))}
                      disabled={!resultForm.classId}
                    >
                      <option value="">Select section</option>
                      {filteredSections.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                <FormField label="Student">
                  <Select
                    value={resultForm.studentId}
                    onChange={(event) => setResultForm((current) => ({ ...current, studentId: event.target.value }))}
                    disabled={!resultForm.sectionId}
                  >
                    <option value="">Select student</option>
                    {filteredStudents.map((student) => (
                      <option key={student._id} value={student._id}>
                        {student.user.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {hasSingleOption(teacherFormSubjects) ? (
                  <FormField label="Subject">
                    <Input value={teacherFormSubjects[0]!.name} readOnly disabled />
                  </FormField>
                ) : (
                  <FormField label="Subject">
                    <Select
                      value={selectedSubjectId}
                      onChange={(event) => setSelectedSubjectId(event.target.value)}
                      disabled={!resultForm.classId}
                    >
                      <option value="">Select subject</option>
                      {teacherFormSubjects.map((subject) => (
                        <option key={subject._id} value={subject._id}>
                          {subject.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
              </div>
              <FormField label="Published Date (BS)">
                <NepaliDateField value={resultForm.publishedAtBs ?? ""} onChange={(value) => setResultForm((current) => ({ ...current, publishedAtBs: value }))} />
              </FormField>
              {!selectedSubjectId ? (
                <p className="text-sm text-slate-500">Select a class and subject to enter marks.</p>
              ) : (
                <FormField
                  label={`Marks — ${subjectNameById.get(selectedSubjectId)?.name ?? "Subject"} / ${subjectNameById.get(selectedSubjectId)?.fullMarks ?? "—"}`}
                >
                  <Input
                    type="number"
                    min={0}
                    max={subjectNameById.get(selectedSubjectId)?.fullMarks}
                    value={resultForm.marks.find((item) => item.subjectId === selectedSubjectId)?.obtainedMarks ?? 0}
                    onChange={(event) =>
                      setResultForm((current) => ({
                        ...current,
                        marks: [{ subjectId: selectedSubjectId, obtainedMarks: Number(event.target.value) }]
                      }))
                    }
                  />
                </FormField>
              )}
              <div className="flex justify-end">
                <Button type="submit" disabled={!selectedSubjectId || !resultForm.examId || !resultForm.studentId}>
                  Save Result
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {isTeacher ? (
        <Card>
          <CardHeader>
            <CardTitle>Filter Student Results</CardTitle>
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
            <FormField label="Subject">
              <Select
                value={teacherViewSubjectId}
                onChange={(event) => setTeacherViewSubjectId(event.target.value)}
                disabled={!teacherViewClassId && !hasSingleOption(classes)}
              >
                <option value="">All subjects</option>
                {(teacherViewClassId ? teacherViewSubjects : subjects).map((subject) => (
                  <option key={subject._id} value={subject._id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </CardContent>
        </Card>
      ) : null}

      {isStudentOrParent ? (
        <StudentExamResults exams={examsQuery.data ?? []} results={portalResultsQuery.data ?? []} isLoading={portalResultsQuery.isLoading} />
      ) : null}

      {(isAdmin || isTeacher) ? (
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Exam Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(examsQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No exams yet"
                description={isAdmin ? "Create an exam schedule and assign it to classes." : "Exams will appear here once the school admin creates them."}
              />
            ) : (
              (examsQuery.data ?? []).map((exam) => (
                <div key={exam._id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">{exam.name}</h3>
                      <p className="text-sm text-slate-500">
                        {exam.startDateBs} to {exam.endDateBs}
                      </p>
                    </div>
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingExamId(exam._id);
                          setExamForm({
                            name: exam.name,
                            academicYearBs: exam.academicYearBs,
                            startDateBs: exam.startDateBs,
                            endDateBs: exam.endDateBs,
                            classIds: exam.classIds
                          });
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isAdmin ? "Results" : "My Subject Results"}</CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin && !viewFiltersComplete ? (
              <EmptyState title="Select exam, class, and section" description="Choose filters above to view entered results." />
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
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {teacherDisplayedResults.map(({ result, mark }) => (
                        <tr key={`${result._id}-${mark.subjectId}`}>
                          <Td>{(examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId}</Td>
                          <Td>{students.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId}</Td>
                          <Td>{subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId}</Td>
                          <Td>
                            {mark.obtainedMarks} / {subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"}
                          </Td>
                          <Td>
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => loadTeacherResultForEdit(result, mark.subjectId)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setMarksheetSelection({ examId: result.examId, studentId: result.studentId })}
                              >
                                View
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
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {marksheetQuery.data.result.marks.map((mark) => (
                        <div key={mark.subjectId} className="rounded-xl bg-white px-3 py-2 text-sm">
                          <p className="font-medium text-slate-800">{subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId}</p>
                          <p className="text-slate-600">
                            {mark.obtainedMarks} / {subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                {isAdmin && viewStudentId && selectedStudentResult ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {viewFilteredStudents.find((s) => s._id === viewStudentId)?.user.fullName ?? "Student"}
                        </h3>
                        <p className="text-sm text-slate-600">
                          Grade: {selectedStudentResult.grade} · GPA: {selectedStudentResult.gpa.toFixed(2)} · {selectedStudentResult.percentage}%
                        </p>
                      </div>
                      <Badge>{selectedStudentResult.grade}</Badge>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {selectedStudentResult.marks.map((mark) => (
                        <div key={mark.subjectId} className="rounded-xl bg-white px-3 py-2 text-sm">
                          <p className="font-medium text-slate-800">{subjectNameById.get(mark.subjectId)?.name ?? mark.subjectId}</p>
                          <p className="text-slate-600">
                            {mark.obtainedMarks} / {subjectNameById.get(mark.subjectId)?.fullMarks ?? "—"}
                          </p>
                        </div>
                      ))}
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
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {displayedResults.map((result) => (
                        <tr key={result._id}>
                          <Td>{(examsQuery.data ?? []).find((exam) => exam._id === result.examId)?.name ?? result.examId}</Td>
                          <Td>
                            {resultStudents.find((student) => student._id === result.studentId)?.user.fullName ?? result.studentId}
                          </Td>
                          <Td>
                            <Badge>{result.grade}</Badge>
                          </Td>
                          <Td>{result.gpa.toFixed(2)}</Td>
                          <Td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setMarksheetSelection({ examId: result.examId, studentId: result.studentId })}
                            >
                              View Marksheet
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {isAdmin && marksheetQuery.data ? (
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{marksheetQuery.data.student.user.fullName}</h3>
                        <p className="text-sm text-slate-600">{marksheetQuery.data.exam.name}</p>
                      </div>
                      <Badge>{marksheetQuery.data.result.grade}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      GPA: {marksheetQuery.data.result.gpa.toFixed(2)} / Percentage: {marksheetQuery.data.result.percentage}%
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      ) : null}
    </PageContent>
  );
};