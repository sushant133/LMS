import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ResultInput,
  ResultMarkInput,
  ResultRecord,
  ResultSubmissionRecord,
  StudentRecord,
  SubjectRecord
} from "@phit-erp/shared";
import { EXAM_ATTENDANCE_STATUSES, computeSubjectMark, resultSchema } from "@phit-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import {
  RESULT_SUBMISSION_STATUS_COLORS,
  RESULT_SUBMISSION_STATUS_LABELS,
  defaultResultValue
} from "features/exams/examDefaults";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterYearsByBatch, filterSubjectsByClass, filterSubjectsByYear, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface SubmissionScopeData {
  _id?: string;
  status: string;
  studentsTotal: number;
  marksEntered: number;
  missingStudents: Array<{ studentId: string; studentName: string }>;
  reviewComments?: string;
}

interface ExamMarksEntryProps {
  exams: ExamRecord[];
  subjects: SubjectRecord[];
  students: StudentRecord[];
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId: string }>;
  classes: Array<{ _id: string; name: string }>;
  sections: Array<{ _id: string; name: string; classId: string }>;
  isCollege: boolean;
  resultsLockedExamIds: Set<string>;
}

const buildDefaultMark = (subject?: SubjectRecord): ResultMarkInput => ({
  subjectId: subject?._id ?? "",
  fullMarks: subject?.fullMarks ?? 100,
  passMarks: subject?.passMarks ?? 35,
  theoryMarks: 0,
  practicalMarks: 0,
  internalMarks: 0,
  attendanceStatus: "PRESENT",
  teacherRemarks: ""
});

export const ExamMarksEntry = ({
  exams,
  subjects,
  students,
  batches,
  years,
  classes,
  sections,
  isCollege,
  resultsLockedExamIds
}: ExamMarksEntryProps) => {
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [resultForm, setResultForm] = useState<ResultInput>(defaultResultValue);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [markForm, setMarkForm] = useState<ResultMarkInput>(buildDefaultMark());

  const filteredYears = useMemo(() => filterYearsByBatch(years, resultForm.batchId ?? ""), [resultForm.batchId, years]);
  const filteredSections = useMemo(() => filterSectionsByClass(sections, resultForm.classId ?? ""), [resultForm.classId, sections]);
  const teacherFormSubjects = useMemo(
    () =>
      (isCollege
        ? filterSubjectsByYear(subjects, resultForm.yearId ?? "")
        : filterSubjectsByClass(subjects, resultForm.classId ?? "")) as SubjectRecord[],
    [isCollege, resultForm.classId, resultForm.yearId, subjects]
  );
  const filteredStudents = useMemo(
    () =>
      students.filter((student) =>
        isCollege
          ? String(student.batchId) === String(resultForm.batchId) && String(student.yearId) === String(resultForm.yearId)
          : String(student.classId) === String(resultForm.classId) && String(student.sectionId) === String(resultForm.sectionId)
      ),
    [isCollege, resultForm.batchId, resultForm.classId, resultForm.sectionId, resultForm.yearId, students]
  );

  const selectedSubject = useMemo(
    () => teacherFormSubjects.find((subject) => subject._id === selectedSubjectId) ?? subjects.find((subject) => subject._id === selectedSubjectId),
    [selectedSubjectId, subjects, teacherFormSubjects]
  );

  const selectedExam = useMemo(() => exams.find((exam) => exam._id === resultForm.examId), [exams, resultForm.examId]);
  const isLocked = selectedExam ? resultsLockedExamIds.has(selectedExam._id) || selectedExam.resultsLocked : false;
  const scopeReady = isCollege ? Boolean(resultForm.batchId && resultForm.yearId) : Boolean(resultForm.classId && resultForm.sectionId);

  const marksEntryResultsQuery = useQuery({
    queryKey: [
      "results",
      "marks-entry",
      resultForm.examId,
      resultForm.batchId,
      resultForm.yearId,
      resultForm.classId,
      resultForm.sectionId
    ],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: resultForm.examId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId
              }
            : {
                examId: resultForm.examId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId
              }
        })
      ),
    enabled: Boolean(resultForm.examId && scopeReady)
  });

  const existingResults = marksEntryResultsQuery.data ?? [];

  const localCoverage = useMemo(() => {
    if (!resultForm.examId || !selectedSubjectId || !scopeReady) {
      return { studentsTotal: 0, marksEntered: 0, missingStudents: [] as Array<{ studentId: string; studentName: string }> };
    }

    const missingStudents = filteredStudents
      .filter((student) => {
        const result = existingResults.find((item) => String(item.studentId) === String(student._id));
        return !result?.marks.some((mark) => String(mark.subjectId) === selectedSubjectId);
      })
      .map((student) => ({
        studentId: student._id,
        studentName: student.user.fullName
      }));

    return {
      studentsTotal: filteredStudents.length,
      marksEntered: filteredStudents.length - missingStudents.length,
      missingStudents
    };
  }, [existingResults, filteredStudents, resultForm.examId, scopeReady, selectedSubjectId]);

  const submissionQuery = useQuery({
    queryKey: [
      "result-submission-scope",
      resultForm.examId,
      selectedSubjectId,
      resultForm.batchId,
      resultForm.yearId,
      resultForm.classId,
      resultForm.sectionId
    ],
    queryFn: () =>
      unwrap<SubmissionScopeData & Partial<ResultSubmissionRecord>>(
        api.get("/exams/result-submissions/scope", {
          params: isCollege
            ? {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId
              }
            : {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId
              }
        })
      ),
    enabled: Boolean(resultForm.examId && selectedSubjectId && scopeReady)
  });

  const submission = submissionQuery.data;
  const submissionStatus = submission?.status ?? "DRAFT";
  const coverage = {
    studentsTotal: submission?.studentsTotal ?? localCoverage.studentsTotal,
    marksEntered: Math.max(submission?.marksEntered ?? 0, localCoverage.marksEntered),
    missingStudents:
      localCoverage.missingStudents.length > 0
        ? localCoverage.missingStudents
        : (submission?.missingStudents ?? [])
  };
  const canEditMarks =
    !isLocked && (submissionStatus === "DRAFT" || submissionStatus === "RETURNED_FOR_CORRECTION");
  const isPendingReview =
    submissionStatus === "PENDING_ADMIN_REVIEW" || submissionStatus === "SUBMITTED_FOR_REVIEW";
  const canSubmitForReview =
    canEditMarks &&
    coverage.studentsTotal > 0 &&
    coverage.marksEntered >= coverage.studentsTotal &&
    coverage.missingStudents.length === 0;
  const submitBlockReason = !scopeReady
    ? `Select exam, ${labels.primary.toLowerCase()}, and ${labels.secondary.toLowerCase()} first`
    : !selectedSubjectId
      ? "Select a subject first"
      : coverage.studentsTotal === 0
        ? "No students found in this scope"
        : coverage.missingStudents.length > 0
          ? `Enter marks for ${coverage.missingStudents.length} remaining student(s)`
          : isPendingReview
            ? "Already submitted — waiting for admin review"
            : submissionStatus === "APPROVED"
              ? "Results approved by admin"
              : submissionStatus === "PUBLISHED"
                ? "Results already published"
                : !canEditMarks
                  ? "Marks are locked for editing"
                  : "";

  useEffect(() => {
    if (hasSingleOption(isCollege ? batches : classes) && (isCollege ? resultForm.batchId : resultForm.classId) !== (isCollege ? batches : classes)[0]!._id) {
      setResultForm((current) =>
        isCollege
          ? { ...current, batchId: batches[0]!._id, yearId: "", studentId: "" }
          : { ...current, classId: classes[0]!._id, sectionId: "", studentId: "" }
      );
    }
  }, [batches, classes, isCollege, resultForm.batchId, resultForm.classId]);

  useEffect(() => {
    if (!isCollege && hasSingleOption(filteredSections) && resultForm.sectionId !== filteredSections[0]!._id) {
      setResultForm((current) => ({ ...current, sectionId: filteredSections[0]!._id, studentId: "" }));
    }
  }, [filteredSections, isCollege, resultForm.sectionId]);

  useEffect(() => {
    if (isCollege && hasSingleOption(filteredYears) && resultForm.yearId !== filteredYears[0]!._id) {
      setResultForm((current) => ({ ...current, yearId: filteredYears[0]!._id, studentId: "" }));
    }
  }, [filteredYears, isCollege, resultForm.yearId]);

  useEffect(() => {
    if (hasSingleOption(teacherFormSubjects) && selectedSubjectId !== teacherFormSubjects[0]!._id) {
      setSelectedSubjectId(teacherFormSubjects[0]!._id);
    }
  }, [selectedSubjectId, teacherFormSubjects]);

  useEffect(() => {
    if (!selectedSubjectId) {
      return;
    }
    const subject = teacherFormSubjects.find((item) => item._id === selectedSubjectId) ?? subjects.find((item) => item._id === selectedSubjectId);
    setMarkForm(buildDefaultMark(subject));
  }, [selectedSubjectId, subjects, teacherFormSubjects]);

  useEffect(() => {
    if (!resultForm.examId || !resultForm.studentId || !selectedSubjectId) {
      return;
    }

    const existing = existingResults.find((result) => result.examId === resultForm.examId && result.studentId === resultForm.studentId);
    const existingMark = existing?.marks.find((mark) => String(mark.subjectId) === selectedSubjectId);
    const subject = selectedSubject;

    if (existingMark) {
      setMarkForm({
        subjectId: selectedSubjectId,
        fullMarks: existingMark.fullMarks ?? subject?.fullMarks ?? 100,
        passMarks: existingMark.passMarks ?? subject?.passMarks ?? 35,
        theoryMarks: existingMark.theoryMarks ?? 0,
        practicalMarks: existingMark.practicalMarks ?? 0,
        internalMarks: existingMark.internalMarks ?? 0,
        attendanceStatus: existingMark.attendanceStatus ?? "PRESENT",
        teacherRemarks: existingMark.teacherRemarks ?? ""
      });
    }
  }, [existingResults, resultForm.examId, resultForm.studentId, selectedSubject, selectedSubjectId]);

  const computedPreview = useMemo(() => computeSubjectMark({ ...markForm, obtainedMarks: 0 }), [markForm]);

  const resultMutation = useMutation({
    mutationFn: async (payload: ResultInput) => unwrap<ResultRecord>(api.post("/exams/results", payload)),
    onSuccess: async () => {
      toast.success("Marks saved as draft");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({ queryKey: ["result-submission-scope"] }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] })
      ]);
      await marksEntryResultsQuery.refetch();
      await submissionQuery.refetch();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const submitForReviewMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        api.post(
          "/exams/result-submissions/submit",
          isCollege
            ? {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId
              }
            : {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId
              }
        )
      ),
    onSuccess: async () => {
      toast.success("Results submitted for admin review");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["result-submission-scope"] }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] })
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (isLocked) {
          toast.error("Results are locked by the college admin");
          return;
        }
        if (!canEditMarks) {
          toast.error("Marks cannot be edited while pending admin review or approved");
          return;
        }
        if (!selectedSubjectId) {
          toast.error("Select a subject");
          return;
        }
        const parsed = resultSchema.safeParse({
          ...resultForm,
          marks: [{ ...markForm, subjectId: selectedSubjectId }]
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
          <Select
            value={resultForm.examId}
            onChange={(event) => setResultForm((current) => ({ ...current, examId: event.target.value }))}
          >
            <option value="">Select exam</option>
            {exams.map((exam) => (
              <option key={exam._id} value={exam._id}>
                {exam.name}
                {exam.resultsLocked ? " (Locked)" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        {hasSingleOption(isCollege ? batches : classes) ? (
          <FormField label={labels.primary}>
            <Input value={(isCollege ? batches : classes)[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label={labels.primary}>
            <Select
              value={isCollege ? resultForm.batchId : resultForm.classId}
              onChange={(event) => {
                setSelectedSubjectId("");
                setResultForm((current) =>
                  isCollege
                    ? { ...current, batchId: event.target.value, yearId: "", studentId: "" }
                    : { ...current, classId: event.target.value, sectionId: "", studentId: "" }
                );
              }}
            >
              <option value="">Select {labels.primary.toLowerCase()}</option>
              {(isCollege ? batches : classes).map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {hasSingleOption(isCollege ? filteredYears : filteredSections) ? (
          <FormField label={labels.secondary}>
            <Input value={(isCollege ? filteredYears : filteredSections)[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label={labels.secondary}>
            <Select
              value={isCollege ? resultForm.yearId : resultForm.sectionId}
              onChange={(event) =>
                setResultForm((current) =>
                  isCollege
                    ? { ...current, yearId: event.target.value, studentId: "" }
                    : { ...current, sectionId: event.target.value, studentId: "" }
                )
              }
              disabled={!scopeReady}
            >
              <option value="">Select {labels.secondary.toLowerCase()}</option>
              {(isCollege ? filteredYears : filteredSections).map((item) => (
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
            disabled={!scopeReady}
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
            <Select value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)} disabled={!scopeReady}>
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

      {selectedSubjectId && scopeReady ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Result Workflow Status</p>
              <p className="text-xs text-slate-500">
                {coverage.studentsTotal > 0
                  ? `${coverage.marksEntered} / ${coverage.studentsTotal} students have marks for ${selectedSubject?.name ?? "this subject"}`
                  : "No students in this batch/year"}
              </p>
            </div>
            <Badge className={RESULT_SUBMISSION_STATUS_COLORS[submissionStatus] ?? "bg-slate-100 text-slate-700"}>
              {RESULT_SUBMISSION_STATUS_LABELS[submissionStatus] ?? submissionStatus}
            </Badge>
          </div>

          {submission?.reviewComments ? (
            <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
              Admin feedback: {submission.reviewComments}
            </p>
          ) : null}

          {isPendingReview ? (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Results submitted. The college admin will review and approve or return them for correction.
            </p>
          ) : null}

          {coverage.missingStudents.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Still need marks for:</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {coverage.missingStudents.map((item) => (
                  <li key={item.studentId}>{item.studentName}</li>
                ))}
              </ul>
            </div>
          ) : coverage.studentsTotal > 0 && canEditMarks ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              All students have marks. You can submit for admin review.
            </p>
          ) : null}

          {submissionQuery.isError ? (
            <p className="mt-2 text-sm text-red-700">Could not sync server status. Local progress is shown — save marks and try submit.</p>
          ) : null}
        </div>
      ) : null}

      {isLocked ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Results for this exam are locked. Contact the college admin to unlock before editing marks.
        </p>
      ) : null}

      {!canEditMarks && !isLocked && selectedSubjectId ? (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Marks are locked for editing while pending admin review. You will be notified when the admin approves or returns them.
        </p>
      ) : null}

      {selectedSubjectId && canEditMarks ? (
        <div className="rounded-2xl border border-slate-200 p-4">
          <h4 className="font-medium text-slate-900">
            Marks — {selectedSubject?.name ?? "Subject"}
          </h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Full Marks">
              <Input
                type="number"
                min={1}
                value={markForm.fullMarks}
                onChange={(event) => setMarkForm((current) => ({ ...current, fullMarks: event.target.valueAsNumber }))}
              />
            </FormField>
            <FormField label="Pass Marks">
              <Input
                type="number"
                min={0}
                value={markForm.passMarks}
                onChange={(event) => setMarkForm((current) => ({ ...current, passMarks: event.target.valueAsNumber }))}
              />
            </FormField>
            <FormField label="Attendance">
              <Select
                value={markForm.attendanceStatus}
                onChange={(event) =>
                  setMarkForm((current) => ({ ...current, attendanceStatus: event.target.value as ResultMarkInput["attendanceStatus"] }))
                }
              >
                {EXAM_ATTENDANCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Theory Marks">
              <Input
                type="number"
                min={0}
                value={markForm.theoryMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, theoryMarks: event.target.valueAsNumber }))}
              />
            </FormField>
            <FormField label="Practical Marks">
              <Input
                type="number"
                min={0}
                value={markForm.practicalMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, practicalMarks: event.target.valueAsNumber }))}
              />
            </FormField>
            <FormField label="Internal Marks">
              <Input
                type="number"
                min={0}
                value={markForm.internalMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, internalMarks: event.target.valueAsNumber }))}
              />
            </FormField>
            <div className="md:col-span-2 xl:col-span-3">
              <FormField label="Teacher Remarks">
                <Textarea
                  value={markForm.teacherRemarks ?? ""}
                  onChange={(event) => setMarkForm((current) => ({ ...current, teacherRemarks: event.target.value }))}
                />
              </FormField>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>
              Obtained: <strong>{computedPreview.obtainedMarks}</strong> / {computedPreview.fullMarks}
            </span>
            <span>
              Grade: <strong>{computedPreview.grade}</strong>
            </span>
            <span>
              Status: <strong>{computedPreview.passFail}</strong>
            </span>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-slate-900">Submit for Review</h4>
            <p className="mt-1 text-sm text-slate-600">
              Save marks for every student, then submit to the college admin. You cannot edit after submission until results are returned.
            </p>
            {submitBlockReason && !canSubmitForReview ? (
              <p className="mt-2 text-sm font-medium text-amber-800">{submitBlockReason}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={!selectedSubjectId || !resultForm.examId || !resultForm.studentId || !canEditMarks || resultMutation.isPending}
            >
              Save Draft
            </Button>
            <Button
              type="button"
              disabled={!canSubmitForReview || submitForReviewMutation.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    `Submit marks for ${selectedSubject?.name ?? "this subject"} (${coverage.studentsTotal} students) to the college admin for review?`
                  )
                ) {
                  return;
                }
                void submitForReviewMutation.mutateAsync();
              }}
            >
              {submitForReviewMutation.isPending ? "Submitting..." : "Submit for Review"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
};