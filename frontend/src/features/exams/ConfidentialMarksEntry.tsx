import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamConfidentialMarkRow,
  ExamConfidentialMarkSheet,
  ExamRecord,
  SubjectRecord,
  TeacherAssignmentPair,
} from "@phit-erp/shared";
import { EXAM_ATTENDANCE_STATUSES } from "@phit-erp/shared";
import { KeyRound, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import {
  RESULT_SUBMISSION_STATUS_COLORS,
  RESULT_SUBMISSION_STATUS_LABELS,
} from "features/exams/examDefaults";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsForTeacherCohort,
  filterYearsForTeacherBatch,
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface Option {
  _id: string;
  name: string;
}

interface ConfidentialMarksEntryProps {
  /** Exams with confidential marking switched on. */
  exams: ExamRecord[];
  subjects: SubjectRecord[];
  batches: Option[];
  years: Array<Option & { batchId: string }>;
  classes: Option[];
  sections: Array<Option & { classId: string }>;
  isCollege: boolean;
  labels: { primary: string; secondary: string };
  assignments?: TeacherAssignmentPair[];
  assignedSubjectIds?: string[];
}

type RowDraft = {
  theoryMarks: number;
  practicalMarks: number;
  attendanceStatus: (typeof EXAM_ATTENDANCE_STATUSES)[number];
};

const draftFromRow = (row: ExamConfidentialMarkRow): RowDraft => ({
  theoryMarks: row.theoryMarks ?? 0,
  practicalMarks: row.practicalMarks ?? 0,
  attendanceStatus:
    (row.attendanceStatus as RowDraft["attendanceStatus"] | null) ?? "PRESENT",
});

/**
 * Examination → Mark Entry for confidential exams.
 *
 * The evaluator sees the code written on each answer sheet and a marks field —
 * nothing else. The server resolves code → student when marks are saved.
 */
export const ConfidentialMarksEntry = ({
  exams,
  subjects,
  batches,
  years,
  classes,
  sections,
  isCollege,
  labels,
  assignments = [],
  assignedSubjectIds = [],
}: ConfidentialMarksEntryProps) => {
  const [examId, setExamId] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [scheme, setScheme] = useState({ fullMarks: 100, passMarks: 35 });

  const primaryOptions = useMemo(() => {
    const assigned = new Set(
      assignments
        .map((pair) => String((isCollege ? pair.batchId : pair.classId) ?? ""))
        .filter(Boolean),
    );
    const list = isCollege ? batches : classes;
    const scoped = list.filter((item) => assigned.has(String(item._id)));
    return scoped.length > 0 ? scoped : list;
  }, [assignments, batches, classes, isCollege]);

  const secondaryOptions = useMemo(
    () =>
      isCollege
        ? filterYearsForTeacherBatch(years, primaryId, { assignments })
        : filterSectionsByClass(sections, primaryId),
    [assignments, isCollege, primaryId, sections, years],
  );

  const subjectOptions = useMemo(
    () =>
      filterSubjectsForTeacherCohort(subjects, {
        isCollege,
        batchId: isCollege ? primaryId : undefined,
        yearId: isCollege ? secondaryId : undefined,
        classId: isCollege ? undefined : primaryId,
        sectionId: isCollege ? undefined : secondaryId,
        assignments,
        assignedSubjectIds,
      }) as SubjectRecord[],
    [assignedSubjectIds, assignments, isCollege, primaryId, secondaryId, subjects],
  );
  const subject = subjectOptions.find((item) => item._id === subjectId);
  const hasPractical = Number(subject?.practicalMarks ?? 0) > 0;

  const cohortParams = isCollege
    ? { batchId: primaryId, yearId: secondaryId }
    : { classId: primaryId, sectionId: secondaryId };
  const ready = Boolean(examId && primaryId && secondaryId && subjectId);

  const sheetQuery = useQuery({
    queryKey: ["exam-confidential-sheet", examId, subjectId, primaryId, secondaryId],
    queryFn: () =>
      unwrap<ExamConfidentialMarkSheet>(
        api.get(`/exams/${examId}/confidential-sheet`, {
          params: { subjectId, ...cohortParams },
        }),
      ),
    enabled: ready,
  });
  const sheet = sheetQuery.data;

  useEffect(() => {
    setDrafts({});
  }, [examId, subjectId, primaryId, secondaryId]);

  useEffect(() => {
    if (sheet?.marksSchemeConfigured && sheet.fullMarks !== undefined) {
      setScheme({ fullMarks: sheet.fullMarks, passMarks: sheet.passMarks ?? 0 });
    } else if (subject) {
      setScheme({ fullMarks: subject.fullMarks ?? 100, passMarks: subject.passMarks ?? 35 });
    }
  }, [sheet?.fullMarks, sheet?.marksSchemeConfigured, sheet?.passMarks, subject]);

  const status = sheet?.submissionStatus ?? "DRAFT";
  const canEdit = status === "DRAFT" || status === "RETURNED_FOR_CORRECTION";
  const rows = sheet?.rows ?? [];
  const marked = rows.filter((row) => row.hasMarks).length;
  const visibleRows = useMemo(() => {
    const term = search.trim().toUpperCase();
    return term ? rows.filter((row) => row.code.toUpperCase().includes(term)) : rows;
  }, [rows, search]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["exam-confidential-sheet", examId] }),
      queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
    ]);

  const schemeMutation = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/exams/result-submissions/marks-scheme", {
          examId,
          subjectId,
          ...cohortParams,
          fullMarks: scheme.fullMarks,
          passMarks: scheme.passMarks,
        }),
      ),
    onSuccess: async () => {
      toast.success("Full Marks and Pass Marks saved. You can now enter marks by code.");
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { code: string } & RowDraft) =>
      unwrap<ExamConfidentialMarkRow>(
        api.post(`/exams/${examId}/confidential-marks`, {
          subjectId,
          ...cohortParams,
          code: payload.code,
          theoryMarks: payload.attendanceStatus === "ABSENT" ? 0 : payload.theoryMarks,
          practicalMarks:
            payload.attendanceStatus === "ABSENT" || !hasPractical ? 0 : payload.practicalMarks,
          attendanceStatus: payload.attendanceStatus,
        }),
      ),
    onSuccess: async (row) => {
      toast.success(`Marks saved for ${row.code}`);
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.code];
        return next;
      });
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/exams/result-submissions/submit", { examId, subjectId, ...cohortParams }),
      ),
    onSuccess: async () => {
      toast.success("Marks submitted for admin review");
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (exams.length === 0) return null;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        These exams are marked by confidential code. Enter marks against the code written on
        each answer sheet. Student details are not shown.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Examination">
          <Select
            value={examId}
            onChange={(event) => setExamId(event.target.value)}
          >
            <option value="">Select exam</option>
            {exams.map((exam) => (
              <option key={exam._id} value={exam._id}>
                {exam.name} ({exam.academicYearBs})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={labels.primary}>
          <Select
            value={primaryId}
            onChange={(event) => {
              setPrimaryId(event.target.value);
              setSecondaryId("");
              setSubjectId("");
            }}
          >
            <option value="">Select</option>
            {primaryOptions.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={labels.secondary}>
          <Select
            value={secondaryId}
            disabled={!primaryId}
            onChange={(event) => {
              setSecondaryId(event.target.value);
              setSubjectId("");
            }}
          >
            <option value="">Select</option>
            {secondaryOptions.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Subject">
          <Select
            value={subjectId}
            disabled={!secondaryId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="">Select subject</option>
            {subjectOptions.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {!ready ? null : sheetQuery.isLoading ? (
        <LoadingState />
      ) : sheetQuery.isError ? (
        <EmptyState title="Could not load answer sheets" description={parseErrorMessage(sheetQuery.error)} />
      ) : sheet ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={RESULT_SUBMISSION_STATUS_COLORS[status as keyof typeof RESULT_SUBMISSION_STATUS_COLORS]}>
              {RESULT_SUBMISSION_STATUS_LABELS[status as keyof typeof RESULT_SUBMISSION_STATUS_LABELS] ?? status}
            </Badge>
            <span className="text-slate-600">
              {marked} of {rows.length} answer sheet(s) marked
            </span>
            {sheet.uncodedCount > 0 ? (
              <span className="text-amber-700">
                · {sheet.uncodedCount} sheet(s) not yet coded by the exam office
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-end">
            <FormField label="Full Marks">
              <NumberInput
                value={scheme.fullMarks}
                disabled={!canEdit || sheet.marksSchemeConfigured}
                onValueChange={(value) => setScheme((current) => ({ ...current, fullMarks: Number(value) || 0 }))}
              />
            </FormField>
            <FormField label="Pass Marks">
              <NumberInput
                value={scheme.passMarks}
                disabled={!canEdit || sheet.marksSchemeConfigured}
                onValueChange={(value) => setScheme((current) => ({ ...current, passMarks: Number(value) || 0 }))}
              />
            </FormField>
            {!sheet.marksSchemeConfigured && canEdit ? (
              <Button
                disabled={schemeMutation.isPending || scheme.fullMarks < 1 || scheme.passMarks > scheme.fullMarks}
                onClick={() => schemeMutation.mutate()}
              >
                Save Full / Pass Marks
              </Button>
            ) : (
              <p className="text-sm text-slate-500">Full / Pass Marks set for this subject.</p>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No coded answer sheets yet"
              description="The exam office has not assigned confidential codes for this group."
            />
          ) : (
            <>
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9 font-mono uppercase"
                  placeholder="Find code"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Confidential Code</Th>
                      <Th>Attendance</Th>
                      <Th>{hasPractical ? "Theory" : "Marks"}</Th>
                      {hasPractical ? <Th>Practical</Th> : null}
                      <Th>Saved</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {visibleRows.map((row) => {
                      const draft = drafts[row.code] ?? draftFromRow(row);
                      const isDirty = drafts[row.code] !== undefined;
                      const absent = draft.attendanceStatus === "ABSENT";
                      const update = (patch: Partial<RowDraft>) =>
                        setDrafts((current) => ({ ...current, [row.code]: { ...draft, ...patch } }));
                      return (
                        <tr key={row.code}>
                          <Td className="whitespace-nowrap font-mono text-base font-semibold">{row.code}</Td>
                          <Td>
                            <Select
                              value={draft.attendanceStatus}
                              disabled={!canEdit || !sheet.marksSchemeConfigured}
                              onChange={(event) =>
                                update({ attendanceStatus: event.target.value as RowDraft["attendanceStatus"] })
                              }
                            >
                              {EXAM_ATTENDANCE_STATUSES.map((value) => (
                                <option key={value} value={value}>
                                  {value.charAt(0) + value.slice(1).toLowerCase()}
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td className="min-w-[6rem]">
                            <NumberInput
                              value={draft.theoryMarks}
                              disabled={!canEdit || !sheet.marksSchemeConfigured || absent}
                              onValueChange={(value) => update({ theoryMarks: Number(value) || 0 })}
                            />
                          </Td>
                          {hasPractical ? (
                            <Td className="min-w-[6rem]">
                              <NumberInput
                                value={draft.practicalMarks}
                                disabled={!canEdit || !sheet.marksSchemeConfigured || absent}
                                onValueChange={(value) => update({ practicalMarks: Number(value) || 0 })}
                              />
                            </Td>
                          ) : null}
                          <Td className="whitespace-nowrap">
                            {row.hasMarks ? (
                              row.attendanceStatus === "ABSENT" ? (
                                "Absent"
                              ) : (
                                `${row.obtainedMarks} / ${sheet.fullMarks ?? "—"} (${row.grade ?? "—"})`
                              )
                            ) : (
                              <span className="text-slate-400">Pending</span>
                            )}
                          </Td>
                          <Td>
                            {canEdit && sheet.marksSchemeConfigured ? (
                              <Button
                                size="sm"
                                variant={isDirty || !row.hasMarks ? "default" : "outline"}
                                disabled={saveMutation.isPending || (!isDirty && row.hasMarks)}
                                onClick={() => saveMutation.mutate({ code: row.code, ...draft })}
                              >
                                Save
                              </Button>
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {canEdit && rows.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Submit once every answer sheet has marks. The administrator then reviews and publishes.
              </p>
              <Button
                disabled={
                  submitMutation.isPending ||
                  !sheet.marksSchemeConfigured ||
                  marked < rows.length ||
                  sheet.uncodedCount > 0
                }
                onClick={() => submitMutation.mutate()}
              >
                <Send className="mr-2 h-4 w-4" />
                Submit for Review
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
