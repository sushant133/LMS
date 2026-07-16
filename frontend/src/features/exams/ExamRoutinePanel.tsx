import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ExamRoutineInput,
  ExamRoutineRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import { DAYS_OF_WEEK, examRoutineSchema } from "@phit-erp/shared";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { defaultRoutineValue } from "features/exams/examDefaults";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

interface EnrichedRoutine extends ExamRoutineRecord {
  subjectName?: string;
  subjectCode?: string;
  yearName?: string;
  yearLevel?: number;
}

/** Minimal year shape from /academics/years (full YearRecord not always returned). */
type YearOption = {
  _id: string;
  name: string;
  batchId?: string;
  level?: number;
};

type BatchOption = {
  _id: string;
  name: string;
};

interface ExamRoutinePanelProps {
  exam: ExamRecord;
  subjects: SubjectRecord[];
  /** College years for building 1st/2nd/3rd tables */
  years?: YearOption[];
  /** Batches for labeling "1st Year · Batch 2083" */
  batches?: BatchOption[];
  isCollege?: boolean;
  isAdmin: boolean;
  readOnly?: boolean;
}

const isProgramYear = (year: YearOption) => {
  if ((year.name ?? "").toLowerCase() === "ended") return false;
  if (year.level != null && year.level >= 4) return false;
  return true;
};

export const ExamRoutinePanel = ({
  exam,
  subjects,
  years = [],
  batches = [],
  isCollege = false,
  isAdmin,
  readOnly = false,
}: ExamRoutinePanelProps) => {
  const [routineForm, setRoutineForm] =
    useState<ExamRoutineInput>(defaultRoutineValue);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formYearId, setFormYearId] = useState("");

  const batchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const batch of batches) {
      map.set(batch._id, batch.name);
    }
    return map;
  }, [batches]);

  const yearLabel = (year: YearOption) => {
    const batchName = year.batchId
      ? batchNameById.get(year.batchId)
      : undefined;
    return batchName ? `${year.name} · ${batchName}` : year.name;
  };

  const programYears = useMemo(() => {
    const examYearIds = new Set(exam.yearIds ?? []);
    let list = years.filter(isProgramYear);
    // Scope is explicit year IDs (each year is already tied to its intake batch)
    if (examYearIds.size > 0) {
      list = list.filter((y) => examYearIds.has(y._id));
    } else if ((exam.batchIds ?? []).length > 0) {
      // Legacy exams: only batchIds — show program years under those batches
      const examBatchIds = new Set(exam.batchIds ?? []);
      list = list.filter((y) => y.batchId && examBatchIds.has(y.batchId));
    }
    const byKey = new Map<string, YearOption>();
    for (const y of list) {
      const key = `${y.level ?? y.name}-${y.batchId ?? ""}`;
      if (!byKey.has(key)) byKey.set(key, y);
    }
    return Array.from(byKey.values()).sort(
      (a, b) => (a.level ?? 99) - (b.level ?? 99),
    );
  }, [exam.batchIds, exam.yearIds, years]);

  const routinesQuery = useQuery({
    queryKey: ["exam-routines", exam._id],
    queryFn: () =>
      unwrap<EnrichedRoutine[]>(
        api.get("/exams/routines", { params: { examId: exam._id } }),
      ),
  });

  const createMutation = useMutation({
    mutationFn: (payload: ExamRoutineInput) =>
      unwrap(api.post(`/exams/${exam._id}/routines`, payload)),
    onSuccess: async () => {
      toast.success("Routine added");
      setRoutineForm(defaultRoutineValue);
      setEditingRoutineId(null);
      setShowForm(false);
      await queryClient.invalidateQueries({
        queryKey: ["exam-routines", exam._id],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      routineId,
      payload,
    }: {
      routineId: string;
      payload: ExamRoutineInput;
    }) => unwrap(api.put(`/exams/${exam._id}/routines/${routineId}`, payload)),
    onSuccess: async () => {
      toast.success("Routine updated");
      setRoutineForm(defaultRoutineValue);
      setEditingRoutineId(null);
      setShowForm(false);
      await queryClient.invalidateQueries({
        queryKey: ["exam-routines", exam._id],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (routineId: string) =>
      unwrap(api.delete(`/exams/${exam._id}/routines/${routineId}`)),
    onSuccess: async () => {
      toast.success("Routine removed");
      await queryClient.invalidateQueries({
        queryKey: ["exam-routines", exam._id],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const publishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/publish`)),
    onSuccess: async () => {
      toast.success("Exam routine published");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["exam-routines", exam._id],
        }),
        queryClient.invalidateQueries({ queryKey: ["exams"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/unpublish`)),
    onSuccess: async () => {
      toast.success("Exam routine unpublished");
      await queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const routines = routinesQuery.data ?? [];

  /** Subjects for a given year (prefer year match; fall back to all exam subjects). */
  const subjectsForYear = (yearId: string) => {
    const yearSubjects = subjects.filter((subject) =>
      (subject.yearIds ?? []).includes(yearId),
    );
    if (yearSubjects.length > 0) return yearSubjects;
    const yearIdSet = new Set(exam.yearIds ?? []);
    if (yearIdSet.size === 0) return subjects;
    return subjects.filter((subject) =>
      (subject.yearIds ?? []).some((id) => yearIdSet.has(id)),
    );
  };

  const tables = useMemo(() => {
    if (isCollege && programYears.length > 0) {
      return programYears.map((year) => ({
        key: year._id,
        yearId: year._id,
        title: yearLabel(year) || `Year ${year.level ?? ""}`,
        level: year.level,
        slots: routines
          .filter((r) => r.yearId === year._id)
          .sort((a, b) =>
            a.examDateBs === b.examDateBs
              ? a.startTime.localeCompare(b.startTime)
              : a.examDateBs.localeCompare(b.examDateBs),
          ),
      }));
    }

    // Group by yearId present on routines, or single table for school / legacy
    const byYear = new Map<
      string,
      { title: string; yearId: string; level?: number; slots: EnrichedRoutine[] }
    >();
    for (const r of routines) {
      const key = r.yearId || "__legacy__";
      const matched = r.yearId
        ? programYears.find((y) => y._id === r.yearId)
        : undefined;
      const title =
        (matched ? yearLabel(matched) : null) ||
        r.yearName ||
        (isCollege ? "Unassigned year" : "Exam schedule");
      const existing = byYear.get(key);
      if (existing) existing.slots.push(r);
      else
        byYear.set(key, {
          title,
          yearId: r.yearId || "",
          level: r.yearLevel,
          slots: [r],
        });
    }
    return Array.from(byYear.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
  }, [batchNameById, isCollege, programYears, routines]);

  const openAddForYear = (yearId: string) => {
    setEditingRoutineId(null);
    setFormYearId(yearId);
    setRoutineForm({ ...defaultRoutineValue, yearId });
    setShowForm(true);
  };

  const openEdit = (routine: EnrichedRoutine) => {
    setEditingRoutineId(routine._id);
    setFormYearId(routine.yearId ?? "");
    setRoutineForm({
      yearId: routine.yearId ?? "",
      subjectId: routine.subjectId,
      examDateBs: routine.examDateBs,
      day: routine.day,
      startTime: routine.startTime,
      endTime: routine.endTime,
      durationMinutes: routine.durationMinutes,
      examHall: routine.examHall ?? "",
      invigilator: routine.invigilator ?? "",
      remarks: routine.remarks ?? "",
    });
    setShowForm(true);
  };

  if (routinesQuery.isLoading) {
    return <LoadingState />;
  }

  const formSubjects = subjectsForYear(
    routineForm.yearId || formYearId || "",
  );
  const scheduledInFormYear = new Set(
    routines
      .filter(
        (r) =>
          (r.yearId || "") === (routineForm.yearId || formYearId || "") &&
          r._id !== editingRoutineId,
      )
      .map((r) => r.subjectId),
  );
  const availableSubjects = formSubjects.filter(
    (s) => !scheduledInFormYear.has(s._id) || editingRoutineId,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={
            exam.routinePublished
              ? "bg-brand-100 text-brand-700"
              : "bg-slate-100 text-slate-700"
          }
        >
          {exam.routinePublished ? "Routine Published" : "Routine Draft"}
        </Badge>
        <p className="text-xs text-slate-500">
          {isCollege
            ? "Create a separate exam routine for each year cohort (e.g. 1st Year · Batch 2083, 2nd Year · Batch 2082). Students only see their year; teachers see all years."
            : "Add subject-wise exam schedules below."}
        </p>
        {isAdmin && !readOnly ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {exam.routinePublished ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void unpublishMutation.mutateAsync()}
                disabled={unpublishMutation.isPending}
              >
                Unpublish Routine
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void publishMutation.mutateAsync()}
                disabled={publishMutation.isPending || routines.length === 0}
              >
                Publish Routine
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {/* Add / Edit form */}
      {isAdmin && !readOnly && showForm ? (
        <Card className="border-brand-200">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">
              {editingRoutineId ? "Edit routine entry" : "Add routine entry"}
              {routineForm.yearId
                ? ` · ${
                    (() => {
                      const year = programYears.find(
                        (y) => y._id === routineForm.yearId,
                      );
                      return year ? yearLabel(year) : "Year";
                    })()
                  }`
                : ""}
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingRoutineId(null);
                setRoutineForm(defaultRoutineValue);
              }}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = {
                  ...routineForm,
                  yearId: routineForm.yearId || formYearId || undefined,
                };
                const parsed = examRoutineSchema.safeParse(payload);
                if (!parsed.success) {
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Validation failed",
                  );
                  return;
                }
                if (isCollege && !parsed.data.yearId) {
                  toast.error("Select a year for this routine entry");
                  return;
                }
                if (editingRoutineId) {
                  void updateMutation.mutateAsync({
                    routineId: editingRoutineId,
                    payload: parsed.data,
                  });
                } else {
                  void createMutation.mutateAsync(parsed.data);
                }
              }}
            >
              {isCollege ? (
                <FormField label="Year">
                  <Select
                    value={routineForm.yearId || formYearId}
                    onChange={(event) => {
                      const yearId = event.target.value;
                      setFormYearId(yearId);
                      setRoutineForm((current) => ({
                        ...current,
                        yearId,
                        subjectId: "",
                      }));
                    }}
                    disabled={Boolean(editingRoutineId)}
                  >
                    <option value="">Select year (1st / 2nd / 3rd)</option>
                    {programYears.map((year) => (
                      <option key={year._id} value={year._id}>
                        {year.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Subject">
                <Select
                  value={routineForm.subjectId}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      subjectId: event.target.value,
                    }))
                  }
                  disabled={Boolean(editingRoutineId)}
                >
                  <option value="">Select subject</option>
                  {(editingRoutineId ? formSubjects : availableSubjects).map(
                    (subject) => (
                      <option key={subject._id} value={subject._id}>
                        {subject.name}
                        {subject.code ? ` (${subject.code})` : ""}
                      </option>
                    ),
                  )}
                </Select>
              </FormField>
              <FormField label="Exam Date (BS)">
                <NepaliDateField
                  value={routineForm.examDateBs}
                  onChange={(value) =>
                    setRoutineForm((current) => ({
                      ...current,
                      examDateBs: value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Day">
                <Select
                  value={routineForm.day}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      day: event.target.value,
                    }))
                  }
                >
                  <option value="">Select day</option>
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Duration (minutes)">
                <NumberInput
                  min={1}
                  value={routineForm.durationMinutes}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      durationMinutes: event.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Start Time">
                <Input
                  type="time"
                  value={routineForm.startTime}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="End Time">
                <Input
                  type="time"
                  value={routineForm.endTime}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      endTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Exam Hall (optional)">
                <Input
                  value={routineForm.examHall ?? ""}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      examHall: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Invigilator (optional)">
                <Input
                  value={routineForm.invigilator ?? ""}
                  onChange={(event) =>
                    setRoutineForm((current) => ({
                      ...current,
                      invigilator: event.target.value,
                    }))
                  }
                />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Remarks (optional)">
                  <Textarea
                    value={routineForm.remarks ?? ""}
                    onChange={(event) =>
                      setRoutineForm((current) => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingRoutineId(null);
                    setRoutineForm(defaultRoutineValue);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {editingRoutineId ? "Update entry" : "Add entry"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Per-year schedule tables */}
      {tables.length === 0 && routines.length === 0 ? (
        <EmptyState
          title="No routine entries"
          description={
            isAdmin
              ? isCollege
                ? "Add exam schedules separately for 1st, 2nd, and 3rd year below."
                : "Add subject-wise exam schedules below."
              : "The exam routine will appear here once published."
          }
        />
      ) : (
        <div className="space-y-6">
          {tables.map((table) => (
            <Card key={table.key} className="border-slate-200">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
                <div>
                  <CardTitle className="text-base">
                    {isCollege
                      ? `${table.title} — exam routine`
                      : table.title}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    {table.slots.length} subject
                    {table.slots.length === 1 ? "" : "s"}
                    {isCollege
                      ? " · Visible to students of this year only"
                      : ""}
                  </p>
                </div>
                {isAdmin && !readOnly && isCollege && table.yearId ? (
                  <Button
                    size="sm"
                    onClick={() => openAddForYear(table.yearId)}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add for {table.title}
                  </Button>
                ) : null}
                {isAdmin && !readOnly && !isCollege ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingRoutineId(null);
                      setRoutineForm(defaultRoutineValue);
                      setShowForm(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add entry
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {table.slots.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No subjects scheduled for this year yet.
                    {isAdmin && !readOnly
                      ? " Use Add to create this year&apos;s exam routine."
                      : ""}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th>Subject</Th>
                          <Th>Date</Th>
                          <Th>Day</Th>
                          <Th>Time</Th>
                          <Th>Duration</Th>
                          <Th>Hall</Th>
                          <Th>Invigilator</Th>
                          {isAdmin && !readOnly ? <Th /> : null}
                        </tr>
                      </TableHead>
                      <TableBody>
                        {table.slots.map((routine) => (
                          <tr key={routine._id}>
                            <Td>
                              <div className="font-medium">
                                {routine.subjectName ?? "Subject"}
                              </div>
                              {routine.subjectCode ? (
                                <div className="text-xs text-slate-500">
                                  {routine.subjectCode}
                                </div>
                              ) : null}
                            </Td>
                            <Td>{routine.examDateBs}</Td>
                            <Td>{routine.day}</Td>
                            <Td>
                              {routine.startTime} – {routine.endTime}
                            </Td>
                            <Td>{routine.durationMinutes} min</Td>
                            <Td>{routine.examHall || "—"}</Td>
                            <Td>{routine.invigilator || "—"}</Td>
                            {isAdmin && !readOnly ? (
                              <Td>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openEdit(routine)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => {
                                      const subjectLabel =
                                        routine.subjectName ?? "this subject";
                                      if (
                                        window.confirm(
                                          `Delete the exam routine for ${subjectLabel}?`,
                                        )
                                      ) {
                                        void deleteMutation.mutateAsync(
                                          routine._id,
                                        );
                                      }
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </Td>
                            ) : null}
                          </tr>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* College: years with zero slots still show as empty tables from programYears */}
      {isAdmin &&
      !readOnly &&
      isCollege &&
      programYears.length === 0 &&
      !showForm ? (
        <p className="text-sm text-amber-800">
          No year cohorts linked to this exam. Edit the exam and select year
          cohorts (e.g. 1st Year · Batch 2083, 2nd Year · Batch 2082).
        </p>
      ) : null}
    </div>
  );
};

/**
 * Teacher view of an exam's schedule — all year tables (1st / 2nd / 3rd), read-only.
 */
export const TeacherRoutineList = ({ examId }: { examId: string }) => {
  const routinesQuery = useQuery({
    queryKey: ["exam-routines", examId, "teacher"],
    queryFn: () =>
      unwrap<EnrichedRoutine[]>(
        api.get("/exams/routines", { params: { examId } }),
      ),
    enabled: Boolean(examId),
  });

  const routines = routinesQuery.data ?? [];

  const tables = useMemo(() => {
    const byYear = new Map<
      string,
      { title: string; level?: number; slots: EnrichedRoutine[] }
    >();
    for (const r of routines) {
      const key = r.yearId || "__legacy__";
      const title = r.yearName || (r.yearId ? "Year" : "Exam schedule");
      if ((title || "").toLowerCase() === "ended") continue;
      const existing = byYear.get(key);
      if (existing) existing.slots.push(r);
      else
        byYear.set(key, {
          title,
          level: r.yearLevel,
          slots: [r],
        });
    }
    return Array.from(byYear.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
  }, [routines]);

  if (routinesQuery.isLoading) return <LoadingState />;

  if (routines.length === 0) {
    return (
      <EmptyState
        title="No routine published"
        description="Exam schedule will appear here once the admin publishes the routine."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Full exam routine for all years. Students only see their own year.
      </p>
      {tables.map((table) => (
        <div key={table.key} className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800">
            {table.title} — exam routine
          </h4>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHead>
                <tr>
                  <Th>Subject</Th>
                  <Th>Date</Th>
                  <Th>Day</Th>
                  <Th>Time</Th>
                  <Th>Duration</Th>
                  <Th>Hall</Th>
                  <Th>Invigilator</Th>
                </tr>
              </TableHead>
              <TableBody>
                {table.slots.map((routine) => (
                  <tr key={routine._id}>
                    <Td>
                      <div className="font-medium">
                        {routine.subjectName ?? "Subject"}
                      </div>
                      {routine.subjectCode ? (
                        <div className="text-xs text-slate-500">
                          {routine.subjectCode}
                        </div>
                      ) : null}
                    </Td>
                    <Td>{routine.examDateBs}</Td>
                    <Td>{routine.day}</Td>
                    <Td>
                      {routine.startTime} – {routine.endTime}
                    </Td>
                    <Td>{routine.durationMinutes} min</Td>
                    <Td>{routine.examHall || "—"}</Td>
                    <Td>{routine.invigilator || "—"}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
};
