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

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id ?? "");
  }
  return String(value);
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
      map.set(idStr(batch._id), batch.name);
    }
    return map;
  }, [batches]);

  const yearById = useMemo(() => {
    const map = new Map<string, YearOption>();
    for (const year of years) {
      map.set(idStr(year._id), {
        ...year,
        _id: idStr(year._id),
        batchId: year.batchId ? idStr(year.batchId) : undefined,
      });
    }
    return map;
  }, [years]);

  const yearLabel = (year: YearOption) => {
    const batchId = year.batchId ? idStr(year.batchId) : "";
    const batchName = batchId ? batchNameById.get(batchId) : undefined;
    const name = year.name?.trim() || "Year";
    return batchName ? `${name} · ${batchName}` : name;
  };

  /**
   * One table per exam year cohort (1st / 2nd / 3rd).
   * Built from exam.yearIds first so tables still appear even if the years
   * catalogue is slow/empty, then enriched with year/batch names when available.
   */
  const programYears = useMemo(() => {
    const examYearIds = (exam.yearIds ?? []).map(idStr).filter(Boolean);
    const examBatchIds = new Set(
      (exam.batchIds ?? []).map(idStr).filter(Boolean),
    );

    if (examYearIds.length > 0) {
      return examYearIds
        .map((yearId, index) => {
          const known = yearById.get(yearId);
          if (known) return known;
          // Fallback so a table still renders for every linked yearId
          return {
            _id: yearId,
            name: `Year cohort ${index + 1}`,
            level: index + 1,
          } satisfies YearOption;
        })
        .filter((year) => isProgramYear(year) || !yearById.has(idStr(year._id)))
        .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
    }

    // Legacy exams: only batchIds — program years under those batches
    if (examBatchIds.size > 0) {
      return years
        .filter(isProgramYear)
        .filter((y) => y.batchId && examBatchIds.has(idStr(y.batchId)))
        .map((y) => ({
          ...y,
          _id: idStr(y._id),
          batchId: y.batchId ? idStr(y.batchId) : undefined,
        }))
        .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
    }

    // No scope on exam: still show active 1st/2nd/3rd years for college admin
    if (isCollege) {
      const byKey = new Map<string, YearOption>();
      for (const y of years.filter(isProgramYear)) {
        const normalized: YearOption = {
          ...y,
          _id: idStr(y._id),
          batchId: y.batchId ? idStr(y.batchId) : undefined,
        };
        const key = idStr(normalized._id);
        if (!byKey.has(key)) byKey.set(key, normalized);
      }
      return Array.from(byKey.values()).sort(
        (a, b) => (a.level ?? 99) - (b.level ?? 99),
      );
    }

    return [];
  }, [exam.batchIds, exam.yearIds, isCollege, yearById, years]);

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
    const target = idStr(yearId);
    const yearSubjects = subjects.filter((subject) =>
      (subject.yearIds ?? []).map(idStr).includes(target),
    );
    if (yearSubjects.length > 0) return yearSubjects;
    const yearIdSet = new Set((exam.yearIds ?? []).map(idStr));
    if (yearIdSet.size === 0) return subjects;
    return subjects.filter((subject) =>
      (subject.yearIds ?? []).map(idStr).some((id) => yearIdSet.has(id)),
    );
  };

  const tables = useMemo(() => {
    const sortSlots = (slots: EnrichedRoutine[]) =>
      [...slots].sort((a, b) =>
        a.examDateBs === b.examDateBs
          ? a.startTime.localeCompare(b.startTime)
          : a.examDateBs.localeCompare(b.examDateBs),
      );

    // College: always one separate table per linked year cohort (even if empty)
    if (isCollege && programYears.length > 0) {
      const covered = new Set(programYears.map((y) => idStr(y._id)));
      const yearTables = programYears.map((year) => {
        const yearId = idStr(year._id);
        return {
          key: yearId,
          yearId,
          title: yearLabel(year) || `Year ${year.level ?? ""}`,
          level: year.level,
          slots: sortSlots(
            routines.filter((r) => idStr(r.yearId) === yearId),
          ),
        };
      });

      // Routines whose year is not in exam scope still get their own table
      const orphanByYear = new Map<string, EnrichedRoutine[]>();
      for (const r of routines) {
        const yid = idStr(r.yearId);
        if (!yid || covered.has(yid)) continue;
        const list = orphanByYear.get(yid) ?? [];
        list.push(r);
        orphanByYear.set(yid, list);
      }
      for (const [yid, slots] of orphanByYear) {
        const known = yearById.get(yid);
        yearTables.push({
          key: yid,
          yearId: yid,
          title: known
            ? yearLabel(known)
            : slots[0]?.yearName || "Other year",
          level: known?.level ?? slots[0]?.yearLevel ?? 99,
          slots: sortSlots(slots),
        });
      }

      // Legacy rows without yearId
      const legacy = routines.filter((r) => !idStr(r.yearId));
      if (legacy.length > 0) {
        yearTables.push({
          key: "__legacy__",
          yearId: "",
          title: "Unassigned year",
          level: 999,
          slots: sortSlots(legacy),
        });
      }

      return yearTables.sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
    }

    // School / no year cohorts: group by yearId on routines, or single table
    const byYear = new Map<
      string,
      { title: string; yearId: string; level?: number; slots: EnrichedRoutine[] }
    >();
    for (const r of routines) {
      const key = idStr(r.yearId) || "__legacy__";
      const matched = r.yearId
        ? programYears.find((y) => idStr(y._id) === idStr(r.yearId))
        : undefined;
      const known = r.yearId ? yearById.get(idStr(r.yearId)) : undefined;
      const title =
        (matched ? yearLabel(matched) : null) ||
        (known ? yearLabel(known) : null) ||
        r.yearName ||
        (isCollege ? "Unassigned year" : "Exam schedule");
      const existing = byYear.get(key);
      if (existing) existing.slots.push(r);
      else
        byYear.set(key, {
          title,
          yearId: idStr(r.yearId),
          level: r.yearLevel ?? known?.level,
          slots: [r],
        });
    }
    return Array.from(byYear.entries())
      .map(([key, value]) => ({ key, ...value, slots: sortSlots(value.slots) }))
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
  }, [batchNameById, isCollege, programYears, routines, yearById]);

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
    <div id="exam-routine-panel" className="space-y-4">
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
        {isCollege ? (
          <Badge className="bg-indigo-100 text-indigo-800">
            {programYears.length} year table
            {programYears.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <p className="text-xs text-slate-500">
          {isCollege
            ? "Each year cohort has its own routine table below (1st / 2nd / 3rd). Add subjects per year, then publish."
            : "Add subject-wise exam schedules below."}
        </p>
        {isAdmin && !readOnly ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {isCollege && programYears.length > 0 && !showForm ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openAddForYear(programYears[0]!._id)}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add entry
              </Button>
            ) : null}
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
      {isCollege && programYears.length === 0 && tables.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-900">
            No year cohorts linked to this exam
          </p>
          <p className="text-sm text-amber-800">
            Edit the exam and add year cohorts (e.g. 1st Year · Batch 2083, 2nd
            Year · Batch 2082, 3rd Year · Batch 2081). Each cohort gets its own
            routine table.
          </p>
          {routines.length > 0 ? (
            <p className="text-xs text-amber-700">
              {routines.length} routine entr
              {routines.length === 1 ? "y exists" : "ies exist"} without a year
              split — re-link cohorts, then re-assign years on each entry.
            </p>
          ) : null}
        </div>
      ) : tables.length === 0 && routines.length === 0 ? (
        <EmptyState
          title="No routine entries"
          description={
            isAdmin
              ? "Add subject-wise exam schedules below."
              : "The exam routine will appear here once published."
          }
        />
      ) : (
        <div className="space-y-6">
          {isCollege && tables.length > 1 ? (
            <p className="text-sm font-medium text-slate-700">
              Year-wise exam routines ({tables.length} tables)
            </p>
          ) : null}
          {tables.map((table) => (
            <Card
              key={table.key}
              className="border-slate-200 shadow-sm ring-1 ring-slate-100"
            >
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 pb-3">
                <div>
                  <CardTitle className="text-base text-slate-900">
                    {isCollege
                      ? `${table.title} — exam routine`
                      : table.title}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    {table.slots.length} subject
                    {table.slots.length === 1 ? "" : "s"} scheduled
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
              <CardContent className="pt-4">
                {table.slots.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                    No subjects scheduled for this year yet.
                    {isAdmin && !readOnly
                      ? " Use “Add for …” to build this year’s exam routine."
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
    </div>
  );
};

/**
 * Teacher view of exam schedules — all years / batches (1st / 2nd / 3rd), read-only.
 * When examId is empty, loads every exam routine for the college so teachers are not
 * stuck with an empty dropdown after assignment-scoped exam lists.
 */
export const TeacherRoutineList = ({
  examId,
  exams = [],
}: {
  examId: string;
  exams?: ExamRecord[];
}) => {
  const routinesQuery = useQuery({
    queryKey: ["exam-routines", "teacher", examId || "all"],
    queryFn: () =>
      unwrap<EnrichedRoutine[]>(
        api.get(
          "/exams/routines",
          examId ? { params: { examId } } : undefined,
        ),
      ),
  });

  const examNameById = useMemo(
    () => new Map(exams.map((exam) => [exam._id, exam.name])),
    [exams],
  );

  const routines = routinesQuery.data ?? [];

  /** Group: exam → year tables so multi-exam view stays clear */
  const examGroups = useMemo(() => {
    const byExam = new Map<
      string,
      {
        examId: string;
        examName: string;
        tables: Array<{
          key: string;
          title: string;
          level?: number;
          slots: EnrichedRoutine[];
        }>;
      }
    >();

    for (const r of routines) {
      const eid = r.examId;
      if (!byExam.has(eid)) {
        byExam.set(eid, {
          examId: eid,
          examName: examNameById.get(eid) ?? "Exam",
          tables: [],
        });
      }
      const group = byExam.get(eid)!;
      const yearKey = r.yearId || "__legacy__";
      const title = r.yearName || (r.yearId ? "Year" : "Exam schedule");
      if ((title || "").toLowerCase() === "ended") continue;
      let table = group.tables.find((t) => t.key === yearKey);
      if (!table) {
        table = {
          key: yearKey,
          title,
          level: r.yearLevel,
          slots: [],
        };
        group.tables.push(table);
      }
      table.slots.push(r);
    }

    return Array.from(byExam.values()).map((group) => ({
      ...group,
      tables: group.tables.sort((a, b) => (a.level ?? 99) - (b.level ?? 99)),
    }));
  }, [examNameById, routines]);

  if (routinesQuery.isLoading) return <LoadingState />;

  if (routines.length === 0) {
    return (
      <EmptyState
        title={examId ? "No routine for this exam" : "No exam routines yet"}
        description={
          examId
            ? "This exam has no schedule rows yet, or the routine is still being prepared."
            : "Exam schedules for all years will appear here once the admin adds and publishes routines."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        Full exam routine for all years and batches. Students only see their own
        enrolled year after the admin publishes the routine.
      </p>
      {examGroups.map((group) => (
        <div key={group.examId} className="space-y-3">
          {examGroups.length > 1 || !examId ? (
            <h3 className="text-base font-semibold text-slate-900">
              {group.examName}
            </h3>
          ) : null}
          {group.tables.map((table) => (
            <div key={`${group.examId}-${table.key}`} className="space-y-2">
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
      ))}
    </div>
  );
};
