import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ResultRecord,
  ResultSubmissionRecord,
  StudentRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import { computeSubjectMark, resultSchema } from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import {
  RESULT_SUBMISSION_STATUS_COLORS,
  RESULT_SUBMISSION_STATUS_LABELS,
} from "features/exams/examDefaults";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

interface EnrichedSubmission extends ResultSubmissionRecord {
  examName: string;
  scopeLabel: string;
  studentsTotal: number;
  marksEntered: number;
  missingStudents: Array<{ studentId: string; studentName: string }>;
}

interface AuditLogEntry {
  _id: string;
  action: string;
  actorRole: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt?: string;
}

interface ResultReviewPanelProps {
  examId?: string;
  students: StudentRecord[];
  subjects: SubjectRecord[];
  isCollege: boolean;
  compact?: boolean;
}

const StatusBadge = ({ status }: { status: string }) => (
  <Badge
    className={
      RESULT_SUBMISSION_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"
    }
  >
    {RESULT_SUBMISSION_STATUS_LABELS[status] ?? status}
  </Badge>
);

export const ResultReviewPanel = ({
  examId,
  students,
  subjects,
  isCollege,
  compact = false,
}: ResultReviewPanelProps) => {
  const [statusFilter, setStatusFilter] = useState("PENDING_ADMIN_REVIEW");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [editingMark, setEditingMark] = useState<{
    resultId: string;
    studentId: string;
    subjectId: string;
    theoryMarks: number;
    practicalMarks: number;
    internalMarks: number;
  } | null>(null);

  const submissionsQuery = useQuery({
    queryKey: ["result-submissions", examId ?? "all", statusFilter],
    queryFn: () =>
      unwrap<EnrichedSubmission[]>(
        api.get("/exams/result-submissions", {
          params: {
            examId: examId || undefined,
            status: statusFilter || undefined,
          },
        }),
      ),
    refetchInterval: 15_000,
  });

  const selectedSubmission = useMemo(
    () =>
      (submissionsQuery.data ?? []).find(
        (item) => item._id === selectedSubmissionId,
      ),
    [selectedSubmissionId, submissionsQuery.data],
  );

  const reviewExamId = selectedSubmission?.examId ?? examId;

  const resultsQuery = useQuery({
    queryKey: ["results", "review", reviewExamId],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", { params: { examId: reviewExamId } }),
      ),
    enabled: Boolean(reviewExamId),
  });

  const results = resultsQuery.data ?? [];

  const auditLogQuery = useQuery({
    queryKey: ["result-audit-log", reviewExamId, selectedSubmissionId],
    queryFn: () =>
      unwrap<AuditLogEntry[]>(
        api.get("/exams/result-submissions/audit-log", {
          params: {
            examId: reviewExamId || undefined,
            submissionId: selectedSubmissionId || undefined,
          },
        }),
      ),
    enabled: Boolean(reviewExamId || selectedSubmissionId),
  });

  const subjectResults = useMemo(() => {
    if (!selectedSubmission) return [];

    return results
      .filter((result) => {
        if (result.examId !== selectedSubmission.examId) return false;
        if (isCollege) {
          return (
            String(result.batchId) === String(selectedSubmission.batchId) &&
            String(result.yearId) === String(selectedSubmission.yearId)
          );
        }
        return (
          String(result.classId) === String(selectedSubmission.classId) &&
          String(result.sectionId) === String(selectedSubmission.sectionId)
        );
      })
      .map((result) => {
        const mark = result.marks.find(
          (item) =>
            String(item.subjectId) === String(selectedSubmission.subjectId),
        );
        const student = students.find((item) => item._id === result.studentId);
        return { result, mark, student };
      })
      .filter((item) => item.mark);
  }, [isCollege, results, selectedSubmission, students]);

  const reviewSummary = useMemo(() => {
    if (!subjectResults.length) {
      return null;
    }

    const marks = subjectResults.map(({ mark }) =>
      computeSubjectMark({ ...mark!, obtainedMarks: 0 }),
    );
    const passCount = marks.filter((mark) => mark.passFail === "PASS").length;
    const failCount = marks.length - passCount;
    const averagePercentage =
      marks.length > 0
        ? Number(
            (
              marks.reduce((sum, mark) => sum + (mark.percentage ?? 0), 0) /
              marks.length
            ).toFixed(2),
          )
        : 0;
    const averageGpa =
      subjectResults.length > 0
        ? Number(
            (
              subjectResults.reduce((sum, item) => sum + item.result.gpa, 0) /
              subjectResults.length
            ).toFixed(2),
          )
        : 0;

    return {
      passCount,
      failCount,
      averagePercentage,
      averageGpa,
      totalStudents: marks.length,
    };
  }, [subjectResults]);

  const approveMutation = useMutation({
    mutationFn: async ({
      submissionId,
      comments,
    }: {
      submissionId: string;
      comments?: string;
    }) =>
      unwrap(
        api.post(`/exams/result-submissions/${submissionId}/approve`, {
          comments,
        }),
      ),
    onSuccess: async () => {
      toast.success(
        "Results approved. Use Publish Results on the exam session to release them to students.",
      );
      setReviewComments("");
      setSelectedSubmissionId("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
        queryClient.invalidateQueries({
          queryKey: ["result-submission-scope"],
        }),
        queryClient.invalidateQueries({ queryKey: ["result-audit-log"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const returnMutation = useMutation({
    mutationFn: async ({
      submissionId,
      comments,
    }: {
      submissionId: string;
      comments: string;
    }) =>
      unwrap(
        api.post(`/exams/result-submissions/${submissionId}/return`, {
          comments,
        }),
      ),
    onSuccess: async () => {
      toast.success("Results returned to teacher for correction");
      setReviewComments("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
        queryClient.invalidateQueries({
          queryKey: ["result-submission-scope"],
        }),
        queryClient.invalidateQueries({ queryKey: ["result-audit-log"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const adminEditMutation = useMutation({
    mutationFn: async (payload: unknown) =>
      unwrap(api.post("/exams/results/admin", payload)),
    onSuccess: async () => {
      toast.success("Marks updated");
      setEditingMark(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({ queryKey: ["result-audit-log"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (submissionsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      {!examId && !compact ? (
        <p className="text-sm text-slate-600">
          Showing teacher submissions across all exams. Select a submission
          below to review marks, approve, or return for correction.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Filter by status">
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(RESULT_SUBMISSION_STATUS_LABELS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </Select>
        </FormField>
      </div>

      {(submissionsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No submissions found"
          description="Teachers will appear here after submitting results for review."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <Th>Scope</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
                <Th>Missing</Th>
                <Th>Submitted</Th>
                <Th />
              </tr>
            </TableHead>
            <TableBody>
              {(submissionsQuery.data ?? []).map((submission) => (
                <tr
                  key={submission._id}
                  className={
                    selectedSubmissionId === submission._id ? "bg-slate-50" : ""
                  }
                >
                  <Td>
                    <div>
                      <p className="font-medium text-slate-900">
                        {submission.scopeLabel}
                      </p>
                      <p className="text-xs text-slate-500">
                        {submission.examName}
                      </p>
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={submission.status} />
                  </Td>
                  <Td>
                    {submission.marksEntered} / {submission.studentsTotal}
                  </Td>
                  <Td>
                    {submission.missingStudents.length > 0 ? (
                      <Badge className="bg-red-100 text-red-700">
                        {submission.missingStudents.length} missing
                      </Badge>
                    ) : (
                      <Badge className="bg-brand-100 text-brand-700">
                        Complete
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-sm text-slate-600">
                    {submission.submittedAt
                      ? new Date(submission.submittedAt).toLocaleString()
                      : "—"}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedSubmissionId(submission._id)}
                    >
                      Review
                    </Button>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedSubmission ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {selectedSubmission.scopeLabel}
              </h3>
              <p className="text-sm text-slate-600">
                {selectedSubmission.marksEntered} of{" "}
                {selectedSubmission.studentsTotal} students have marks entered
              </p>
              {selectedSubmission.reviewComments ? (
                <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  Previous comments: {selectedSubmission.reviewComments}
                </p>
              ) : null}
            </div>
            <StatusBadge status={selectedSubmission.status} />
          </div>

          {selectedSubmission.missingStudents.length > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">Missing marks for:</p>
              <p>
                {selectedSubmission.missingStudents
                  .map((item) => item.studentName)
                  .join(", ")}
              </p>
            </div>
          ) : null}

          {reviewSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">Average Percentage</p>
                <p className="text-lg font-semibold text-slate-900">
                  {reviewSummary.averagePercentage}%
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">Average GPA</p>
                <p className="text-lg font-semibold text-slate-900">
                  {reviewSummary.averageGpa.toFixed(2)}
                </p>
              </div>
              <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs text-brand-700">Pass</p>
                <p className="text-lg font-semibold text-brand-900">
                  {reviewSummary.passCount}
                </p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs text-red-700">Fail</p>
                <p className="text-lg font-semibold text-red-900">
                  {reviewSummary.failCount}
                </p>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Student</Th>
                  <Th>Theory</Th>
                  <Th>Practical</Th>
                  <Th>Internal</Th>
                  <Th>Total</Th>
                  <Th>Grade</Th>
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {subjectResults.map(({ result, mark, student }) => {
                  if (!mark) return null;
                  const computed = computeSubjectMark({
                    ...mark,
                    obtainedMarks: 0,
                  });
                  const isEditing =
                    editingMark?.resultId === result._id &&
                    editingMark.subjectId === mark.subjectId;

                  return (
                    <tr key={`${result._id}-${mark.subjectId}`}>
                      <Td>
                        {student ? (
                          <StudentNameLink
                            studentId={student._id}
                            name={student.user.fullName}
                          />
                        ) : (
                          result.studentId
                        )}
                      </Td>
                      {isEditing && editingMark ? (
                        <>
                          <Td>
                            <NumberInput
                              min={0}
                              value={editingMark.theoryMarks}
                              onChange={(event) =>
                                setEditingMark((current) =>
                                  current
                                    ? {
                                        ...current,
                                        theoryMarks: event.target.valueAsNumber,
                                      }
                                    : current,
                                )
                              }
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              min={0}
                              value={editingMark.practicalMarks}
                              onChange={(event) =>
                                setEditingMark((current) =>
                                  current
                                    ? {
                                        ...current,
                                        practicalMarks:
                                          event.target.valueAsNumber,
                                      }
                                    : current,
                                )
                              }
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              min={0}
                              value={editingMark.internalMarks}
                              onChange={(event) =>
                                setEditingMark((current) =>
                                  current
                                    ? {
                                        ...current,
                                        internalMarks:
                                          event.target.valueAsNumber,
                                      }
                                    : current,
                                )
                              }
                            />
                          </Td>
                          <Td colSpan={2}>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={adminEditMutation.isPending}
                                onClick={() => {
                                  const subject = subjects.find(
                                    (item) => item._id === mark.subjectId,
                                  );
                                  const parsed = resultSchema.safeParse({
                                    examId: result.examId,
                                    studentId: result.studentId,
                                    classId: result.classId,
                                    sectionId: result.sectionId,
                                    batchId: result.batchId,
                                    yearId: result.yearId,
                                    marks: [
                                      {
                                        subjectId: mark.subjectId,
                                        fullMarks:
                                          mark.fullMarks ??
                                          subject?.fullMarks ??
                                          100,
                                        passMarks:
                                          mark.passMarks ??
                                          subject?.passMarks ??
                                          35,
                                        theoryMarks: editingMark.theoryMarks,
                                        practicalMarks:
                                          editingMark.practicalMarks,
                                        internalMarks:
                                          editingMark.internalMarks,
                                        attendanceStatus:
                                          mark.attendanceStatus ?? "PRESENT",
                                        teacherRemarks:
                                          mark.teacherRemarks ?? "",
                                      },
                                    ],
                                  });
                                  if (!parsed.success) {
                                    toast.error(
                                      parsed.error.issues[0]?.message ??
                                        "Validation failed",
                                    );
                                    return;
                                  }
                                  void adminEditMutation.mutateAsync(
                                    parsed.data,
                                  );
                                }}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingMark(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </Td>
                          <Td />
                        </>
                      ) : (
                        <>
                          <Td>{mark.theoryMarks ?? 0}</Td>
                          <Td>{mark.practicalMarks ?? 0}</Td>
                          <Td>{mark.internalMarks ?? 0}</Td>
                          <Td>
                            {computed.obtainedMarks} / {computed.fullMarks}
                          </Td>
                          <Td>{computed.grade}</Td>
                          <Td>
                            {(selectedSubmission.status ===
                              "PENDING_ADMIN_REVIEW" ||
                              selectedSubmission.status ===
                                "SUBMITTED_FOR_REVIEW" ||
                              selectedSubmission.status === "APPROVED") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setEditingMark({
                                    resultId: result._id,
                                    studentId: result.studentId,
                                    subjectId: mark.subjectId,
                                    theoryMarks: mark.theoryMarks ?? 0,
                                    practicalMarks: mark.practicalMarks ?? 0,
                                    internalMarks: mark.internalMarks ?? 0,
                                  })
                                }
                              >
                                Edit
                              </Button>
                            )}
                          </Td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {(selectedSubmission.status === "PENDING_ADMIN_REVIEW" ||
            selectedSubmission.status === "SUBMITTED_FOR_REVIEW") && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <FormField label="Admin comments (required for return/reject)">
                <Textarea
                  value={reviewComments}
                  onChange={(event) => setReviewComments(event.target.value)}
                  placeholder="Add review comments..."
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    approveMutation.isPending ||
                    selectedSubmission.missingStudents.length > 0
                  }
                  onClick={() =>
                    void approveMutation.mutateAsync({
                      submissionId: selectedSubmission._id,
                      comments: reviewComments,
                    })
                  }
                >
                  Approve Results
                </Button>
                <Button
                  variant="outline"
                  disabled={returnMutation.isPending || !reviewComments.trim()}
                  onClick={() =>
                    void returnMutation.mutateAsync({
                      submissionId: selectedSubmission._id,
                      comments: reviewComments,
                    })
                  }
                >
                  Return for Correction
                </Button>
                <Button
                  variant="destructive"
                  disabled={returnMutation.isPending || !reviewComments.trim()}
                  onClick={() =>
                    void returnMutation.mutateAsync({
                      submissionId: selectedSubmission._id,
                      comments: reviewComments,
                    })
                  }
                >
                  Reject Results
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {!compact ? (
        <div className="rounded-2xl border border-slate-200 p-4">
          <h4 className="font-medium text-slate-900">Audit Log</h4>
          {auditLogQuery.isLoading ? (
            <LoadingState />
          ) : (auditLogQuery.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No audit entries yet{examId ? " for this exam" : ""}.
            </p>
          ) : (
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {(auditLogQuery.data ?? []).map((entry) => (
                <div
                  key={entry._id}
                  className="rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">
                      {entry.action}
                    </span>
                    <span className="text-xs text-slate-500">
                      {entry.createdAt
                        ? new Date(entry.createdAt).toLocaleString()
                        : ""}{" "}
                      · {entry.actorRole}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
