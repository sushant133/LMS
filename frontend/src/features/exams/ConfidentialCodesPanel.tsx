import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamConfidentialAdminSheet,
  ExamConfidentialCodeStatus,
  ExamRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import {
  EXAM_CONFIDENTIAL_CODE_PATTERN,
  EXAM_CONFIDENTIAL_CODE_STATUSES,
  EXAM_CONFIDENTIAL_CODE_STATUS_LABELS,
} from "@phit-erp/shared";
import { EyeOff, KeyRound, Save, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterYearsByBatch } from "lib/teacherScopeUtils";
import { cn, parseErrorMessage } from "lib/utils";

interface Option {
  _id: string;
  name: string;
}

interface ConfidentialCodesPanelProps {
  isCollege: boolean;
  canEdit: boolean;
  labels: { primary: string; secondary: string };
  exams: ExamRecord[];
  subjects: SubjectRecord[];
  batches: Option[];
  years: Array<Option & { batchId?: string }>;
  classes: Option[];
  sections: Array<Option & { classId?: string }>;
}

const STATUS_STYLES: Record<ExamConfidentialCodeStatus, string> = {
  CODE_NOT_ASSIGNED: "bg-slate-100 text-slate-600",
  CODE_ASSIGNED: "bg-sky-100 text-sky-700",
  MARK_PENDING: "bg-amber-100 text-amber-800",
  MARKS_ENTERED: "bg-indigo-100 text-indigo-700",
  MARKS_SUBMITTED: "bg-emerald-100 text-emerald-700",
};

const codeKey = (code: string) => code.trim().toUpperCase();

/**
 * Examination → Confidential Codes (administrators only).
 *
 * The office types a code for each student's answer sheet; evaluators then see
 * and mark codes only. This screen is the one place the student ↔ code ↔ marks
 * mapping is visible.
 */
export const ConfidentialCodesPanel = ({
  isCollege,
  canEdit,
  labels,
  exams,
  subjects,
  batches,
  years,
  classes,
  sections,
}: ConfidentialCodesPanelProps) => {
  const [examId, setExamId] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");
  /** studentId → edited code (only rows the office has touched). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const exam = exams.find((item) => item._id === examId);

  const secondaryOptions = useMemo(
    () =>
      isCollege
        ? filterYearsByBatch(years, primaryId)
        : filterSectionsByClass(sections, primaryId),
    [isCollege, primaryId, sections, years],
  );

  const subjectOptions = useMemo(() => {
    if (isCollege) {
      return secondaryId
        ? subjects.filter((subject) => (subject.yearIds ?? []).map(String).includes(secondaryId))
        : subjects.filter((subject) =>
            (exam?.yearIds ?? []).some((id) => (subject.yearIds ?? []).map(String).includes(String(id))),
          );
    }
    return primaryId
      ? subjects.filter((subject) => (subject.classIds ?? []).map(String).includes(primaryId))
      : subjects;
  }, [exam?.yearIds, isCollege, primaryId, secondaryId, subjects]);

  const sheetQuery = useQuery({
    queryKey: ["exam-confidential-codes", examId, primaryId, secondaryId, subjectId],
    queryFn: () =>
      unwrap<ExamConfidentialAdminSheet>(
        api.get(`/exams/${examId}/confidential-codes`, {
          params: {
            ...(subjectId ? { subjectId } : {}),
            ...(isCollege
              ? { batchId: primaryId || undefined, yearId: secondaryId || undefined }
              : { classId: primaryId || undefined, sectionId: secondaryId || undefined }),
          },
        }),
      ),
    enabled: Boolean(examId),
  });

  useEffect(() => {
    setDrafts({});
  }, [examId]);

  const rows = sheetQuery.data?.rows ?? [];
  const valueFor = (studentId: string, saved?: string) =>
    drafts[studentId] !== undefined ? drafts[studentId]! : (saved ?? "");

  /** Codes used by more than one student, counting unsaved edits. */
  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      const code = valueFor(row.studentId, row.code).trim();
      if (code) seen.set(codeKey(code), (seen.get(codeKey(code)) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, rows]);

  const changedEntries = useMemo(
    () =>
      rows
        .filter((row) => drafts[row.studentId] !== undefined)
        .filter((row) => drafts[row.studentId]!.trim() !== (row.code ?? ""))
        .map((row) => ({ studentId: row.studentId, code: drafts[row.studentId]!.trim() })),
    [drafts, rows],
  );
  const invalidEntries = changedEntries.filter(
    (entry) => entry.code !== "" && !EXAM_CONFIDENTIAL_CODE_PATTERN.test(entry.code),
  );

  const counts = useMemo(() => {
    const result = Object.fromEntries(
      EXAM_CONFIDENTIAL_CODE_STATUSES.map((status) => [status, 0]),
    ) as Record<ExamConfidentialCodeStatus, number>;
    for (const row of rows) result[row.status] += 1;
    return result;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.studentName, row.symbolNumber, row.code, row.rollNumber]
        .filter((value) => value !== undefined && value !== null)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  const saveMutation = useMutation({
    mutationFn: () =>
      unwrap<{ saved: number; changed: number; confidentialMarking: boolean }>(
        api.put(`/exams/${examId}/confidential-codes`, { entries: changedEntries }),
      ),
    onSuccess: async (data) => {
      toast.success(
        data.confidentialMarking
          ? `Saved ${data.changed} code change(s). Teachers now see codes only for this exam.`
          : `Saved ${data.changed} confidential code change(s)`,
      );
      setDrafts({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exam-confidential-codes", examId] }),
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const markingMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(api.put(`/exams/${examId}/confidential-marking`, { enabled })),
    onSuccess: async (_data, enabled) => {
      toast.success(enabled ? "Confidential marking turned on" : "Confidential marking turned off");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
        queryClient.invalidateQueries({ queryKey: ["exam-confidential-codes", examId] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const confidentialOn = Boolean(sheetQuery.data?.confidentialMarking ?? exam?.confidentialMarking);
  const canSave =
    canEdit &&
    changedEntries.length > 0 &&
    duplicateKeys.size === 0 &&
    invalidEntries.length === 0 &&
    !saveMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Confidential Codes
          </CardTitle>
          <p className="text-sm text-slate-500">
            Type a code for each student&apos;s answer sheet and write the same code on the
            sheet. Evaluators see only the codes. The student-to-code mapping is visible to
            administrators only.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Examination">
            <Select
              value={examId}
              onChange={(event) => {
                setExamId(event.target.value);
                setPrimaryId("");
                setSecondaryId("");
                setSubjectId("");
              }}
            >
              <option value="">Select exam</option>
              {exams.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name} ({item.academicYearBs})
                  {item.confidentialMarking ? " — confidential" : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={labels.primary}>
            <Select
              value={primaryId}
              disabled={!examId}
              onChange={(event) => {
                setPrimaryId(event.target.value);
                setSecondaryId("");
                setSubjectId("");
              }}
            >
              <option value="">All</option>
              {(isCollege ? batches : classes).map((item) => (
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
              <option value="">All</option>
              {secondaryOptions.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Subject (for marks status)">
            <Select
              value={subjectId}
              disabled={!examId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">Codes only</option>
              {subjectOptions.map((subject) => (
                <option key={subject._id} value={subject._id}>
                  {subject.name}
                  {subject.code ? ` (${subject.code})` : ""}
                </option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      {!examId ? (
        <EmptyState
          title="Select an examination"
          description="Choose an exam to assign confidential codes to its answer sheets."
        />
      ) : sheetQuery.isLoading ? (
        <LoadingState />
      ) : sheetQuery.isError ? (
        <EmptyState title="Could not load codes" description={parseErrorMessage(sheetQuery.error)} />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {confidentialOn ? (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                )}
                <div>
                  <p className="font-semibold text-slate-900">
                    Confidential marking is {confidentialOn ? "ON" : "OFF"} for this exam
                  </p>
                  <p className="text-sm text-slate-500">
                    {confidentialOn
                      ? "Teachers enter marks against codes only. Student names, symbol and roll numbers are hidden from them for this exam."
                      : "Teachers currently enter marks by student name. Turn this on once codes are assigned."}
                  </p>
                </div>
              </div>
              {canEdit ? (
                <Button
                  variant={confidentialOn ? "outline" : "default"}
                  disabled={markingMutation.isPending}
                  onClick={() => markingMutation.mutate(!confidentialOn)}
                >
                  {confidentialOn ? "Turn off" : "Turn on confidential marking"}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {EXAM_CONFIDENTIAL_CODE_STATUSES.filter(
              (status) => subjectId || status === "CODE_NOT_ASSIGNED" || status === "CODE_ASSIGNED",
            ).map((status) => (
              <Badge key={status} className={STATUS_STYLES[status]}>
                {EXAM_CONFIDENTIAL_CODE_STATUS_LABELS[status]}: {counts[status]}
              </Badge>
            ))}
          </div>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search name, symbol no. or code"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-2">
                    {changedEntries.length > 0 ? (
                      <span className="text-sm text-amber-700">
                        {changedEntries.length} unsaved change(s)
                      </span>
                    ) : null}
                    <Button disabled={!canSave} onClick={() => saveMutation.mutate()}>
                      <Save className="mr-2 h-4 w-4" />
                      {saveMutation.isPending ? "Saving…" : "Save codes"}
                    </Button>
                  </div>
                ) : null}
              </div>
              {duplicateKeys.size > 0 ? (
                <p className="text-sm text-red-600">
                  Each code must be unique in this exam. Fix the highlighted duplicates before saving.
                </p>
              ) : null}
              {invalidEntries.length > 0 ? (
                <p className="text-sm text-red-600">
                  Codes may use letters, numbers, - _ / . and up to 30 characters.
                </p>
              ) : null}

              {rows.length === 0 ? (
                <EmptyState
                  title="No students found"
                  description="No students match this exam and filter."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Symbol No.</Th>
                        <Th>Student</Th>
                        <Th>Confidential Code</Th>
                        <Th>Status</Th>
                        {subjectId ? <Th>Marks</Th> : <Th>Subjects marked</Th>}
                      </tr>
                    </TableHead>
                    <TableBody>
                      {visibleRows.map((row) => {
                        const value = valueFor(row.studentId, row.code);
                        const isDuplicate = Boolean(value.trim()) && duplicateKeys.has(codeKey(value));
                        const isDirty =
                          drafts[row.studentId] !== undefined &&
                          drafts[row.studentId]!.trim() !== (row.code ?? "");
                        return (
                          <tr key={row.studentId}>
                            <Td className="whitespace-nowrap font-mono">
                              {row.symbolNumber ?? <span className="text-slate-400">—</span>}
                            </Td>
                            <Td>
                              <div className="font-medium text-slate-900">{row.studentName}</div>
                              {row.rollNumber ? (
                                <div className="text-xs text-slate-500">Roll {row.rollNumber}</div>
                              ) : null}
                            </Td>
                            <Td className="min-w-[10rem]">
                              {canEdit ? (
                                <Input
                                  className={cn(
                                    "font-mono uppercase",
                                    isDuplicate && "border-red-500 focus-visible:ring-red-500",
                                    isDirty && !isDuplicate && "border-amber-400",
                                  )}
                                  placeholder="e.g. EX-101"
                                  maxLength={30}
                                  value={value}
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [row.studentId]: event.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                <span className="font-mono">{row.code ?? "—"}</span>
                              )}
                            </Td>
                            <Td>
                              <Badge className={STATUS_STYLES[row.status]}>
                                {EXAM_CONFIDENTIAL_CODE_STATUS_LABELS[row.status]}
                              </Badge>
                            </Td>
                            <Td className="whitespace-nowrap">
                              {subjectId ? (
                                row.attendanceStatus === "ABSENT" ? (
                                  "Absent"
                                ) : row.obtainedMarks !== null && row.obtainedMarks !== undefined ? (
                                  `${row.obtainedMarks} / ${row.fullMarks ?? "—"}`
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )
                              ) : (
                                row.subjectsMarked
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
