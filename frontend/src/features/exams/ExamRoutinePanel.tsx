import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ExamRoutineInput,
  ExamRoutineRecord,
  SchoolSettingsRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import { DAYS_OF_WEEK, examRoutineSchema } from "@phit-erp/shared";
import {
  CalendarRange,
  LayoutGrid,
  Plus,
  Printer,
  Rows3,
  Trash2,
} from "lucide-react";
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
import {
  ExamRoutineGrid,
  ExamRoutinePrintSheet,
  shortYearTitle,
  weekdayFromBsDate,
  type RoutineColumn,
} from "features/exams/ExamRoutineGrid";
import { defaultRoutineValue } from "features/exams/examDefaults";
import {
  APPROVE_ADMIN_ONLY_MESSAGE,
  useCanApproveRecords,
} from "hooks/useModuleAccess";
import { api, unwrap } from "lib/api";
import { printBulkResultsElement } from "lib/printUtils";
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

/** Single-line college address for the printed routine header. */
const formatAddressLine = (address?: SchoolSettingsRecord["address"]): string =>
  [
    address?.streetAddress,
    address?.ward ? `Ward ${address.ward}` : "",
    address?.municipality,
    address?.district,
    address?.province,
  ]
    .filter(Boolean)
    .join(", ");

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id ?? "");
  }
  return String(value);
};

/** One row of the "same slot across every year" quick-add form. */
type BulkRow = { yearId: string; subjectId: string };

const emptyBulkSlot = () => ({
  examDateBs: "",
  day: "",
  startTime: "",
  endTime: "",
  durationMinutes: 180,
  examHall: "",
  invigilator: "",
  remarks: "",
});

export const ExamRoutinePanel = ({
  exam,
  subjects,
  years = [],
  batches = [],
  isCollege = false,
  isAdmin,
  readOnly = false,
}: ExamRoutinePanelProps) => {
  const canPerformApprove = useCanApproveRecords();
  const [routineForm, setRoutineForm] =
    useState<ExamRoutineInput>(defaultRoutineValue);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formYearId, setFormYearId] = useState("");
  /** Combined Date × Year grid (the printed sheet) vs. one table per year. */
  const [viewMode, setViewMode] = useState<"grid" | "tables">("grid");
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkSlot, setBulkSlot] = useState(emptyBulkSlot);
  const [bulkSubjectByYear, setBulkSubjectByYear] = useState<
    Record<string, string>
  >({});
  const [isPrinting, setIsPrinting] = useState(false);

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

  /** College name/address for the printed routine header. */
  const settingsQuery = useQuery({
    queryKey: ["settings", "print-branding"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  /**
   * One column per exam year cohort (1st / 2nd / 3rd).
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
          // Fallback so a column still renders for every linked yearId
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

  const invalidateRoutines = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["exam-routines"] }),
      queryClient.invalidateQueries({ queryKey: ["exams"] }),
    ]);

  const createMutation = useMutation({
    mutationFn: (payload: ExamRoutineInput) =>
      unwrap(api.post(`/exams/${exam._id}/routines`, payload)),
    onSuccess: async () => {
      toast.success("Routine added");
      setRoutineForm(defaultRoutineValue);
      setEditingRoutineId(null);
      setShowForm(false);
      await invalidateRoutines();
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
      await invalidateRoutines();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (routineId: string) =>
      unwrap(api.delete(`/exams/${exam._id}/routines/${routineId}`)),
    onSuccess: async () => {
      toast.success("Routine removed");
      await invalidateRoutines();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  /**
   * Delete the whole routine — every year, or one year cohort — leaving the exam,
   * its marks, and its results untouched.
   */
  const deleteRoutineScopeMutation = useMutation({
    mutationFn: (yearId?: string) =>
      unwrap<{ deletedCount: number; remaining: number }>(
        api.delete(
          `/exams/${exam._id}/routines`,
          yearId ? { params: { yearId } } : undefined,
        ),
      ),
    onSuccess: async (data) => {
      toast.success(
        `Deleted ${data?.deletedCount ?? 0} routine entr${(data?.deletedCount ?? 0) === 1 ? "y" : "ies"}`,
      );
      setShowForm(false);
      setEditingRoutineId(null);
      await invalidateRoutines();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const bulkCreateMutation = useMutation({
    mutationFn: (entries: ExamRoutineInput[]) =>
      unwrap<{ created: unknown[]; skipped: Array<{ reason: string }> }>(
        api.post(`/exams/${exam._id}/routines/bulk`, { entries }),
      ),
    onSuccess: async (data) => {
      const skipped = data?.skipped ?? [];
      if (skipped.length > 0) {
        toast.warning(
          `${data?.created?.length ?? 0} added · ${skipped.length} skipped — ${skipped[0]?.reason ?? ""}`,
        );
      } else {
        toast.success(`Added ${data?.created?.length ?? 0} routine entries`);
      }
      setBulkSlot(emptyBulkSlot());
      setBulkSubjectByYear({});
      setShowBulkForm(false);
      await invalidateRoutines();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const publishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/publish`)),
    onSuccess: async () => {
      toast.success("Exam routine published");
      await invalidateRoutines();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/unpublish`)),
    onSuccess: async () => {
      toast.success("Exam routine unpublished");
      await invalidateRoutines();
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

  /** Columns of the combined Date × Year grid — mirrors the year tables. */
  const gridColumns = useMemo<RoutineColumn[]>(() => {
    if (tables.length === 0) {
      return isCollege
        ? programYears.map((year) => ({
            key: idStr(year._id),
            title: yearLabel(year),
            shortTitle: shortYearTitle(year.name, year.level),
            level: year.level,
          }))
        : [{ key: "", title: "Exam schedule" }];
    }
    return tables.map((table) => ({
      key: table.yearId || "",
      title: table.title,
      shortTitle: isCollege
        ? shortYearTitle(table.title, table.level)
        : table.title,
      level: table.level,
    }));
  }, [isCollege, programYears, tables]);

  const openAddForYear = (yearId: string) => {
    setEditingRoutineId(null);
    setShowBulkForm(false);
    setFormYearId(yearId);
    setRoutineForm({ ...defaultRoutineValue, yearId });
    setShowForm(true);
  };

  const openEdit = (routine: EnrichedRoutine) => {
    setEditingRoutineId(routine._id);
    setShowBulkForm(false);
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

  const printSheetId = `exam-routine-print-${exam._id}`;
  const handlePrint = async () => {
    if (routines.length === 0) {
      toast.error("Add routine entries before printing");
      return;
    }
    setIsPrinting(true);
    try {
      await printBulkResultsElement(document.getElementById(printSheetId));
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsPrinting(false);
    }
  };

  const submitBulk = () => {
    const rows: BulkRow[] = Object.entries(bulkSubjectByYear)
      .filter(([, subjectId]) => Boolean(subjectId))
      .map(([yearId, subjectId]) => ({ yearId, subjectId }));

    if (rows.length === 0) {
      toast.error("Pick a subject for at least one year");
      return;
    }

    const day = bulkSlot.day || weekdayFromBsDate(bulkSlot.examDateBs);
    const entries: ExamRoutineInput[] = [];
    for (const row of rows) {
      const parsed = examRoutineSchema.safeParse({
        ...bulkSlot,
        day,
        yearId: row.yearId,
        subjectId: row.subjectId,
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
        return;
      }
      entries.push(parsed.data);
    }

    void bulkCreateMutation.mutateAsync(entries);
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

  const canWrite = isAdmin && !readOnly;
  const settings = settingsQuery.data;
  const collegeAddress = settings?.address
    ? formatAddressLine(settings.address)
    : undefined;
  const examDates = new Set(routines.map((r) => r.examDateBs));

  return (
    <div id="exam-routine-panel" className="space-y-4">
      {/* Toolbar — status, view switch, publish / print / delete */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
        <Badge
          className={
            exam.routinePublished
              ? "bg-brand-100 text-brand-700"
              : "bg-slate-200 text-slate-700"
          }
        >
          {exam.routinePublished ? "Routine Published" : "Routine Draft"}
        </Badge>
        {isCollege ? (
          <Badge className="bg-indigo-100 text-indigo-800">
            {gridColumns.length} year
            {gridColumns.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <Badge className="bg-slate-200 text-slate-700">
          {routines.length} subject{routines.length === 1 ? "" : "s"} ·{" "}
          {examDates.size} date{examDates.size === 1 ? "" : "s"}
        </Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* View switch */}
          <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "grid"
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              All years
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tables")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "tables"
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Rows3 className="h-3.5 w-3.5" />
              Year-wise
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => void handlePrint()}
            disabled={isPrinting || routines.length === 0}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            {isPrinting ? "Preparing…" : "Print routine"}
          </Button>

          {canWrite ? (
            <>
              {isCollege && programYears.length > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowForm(false);
                    setShowBulkForm((current) => !current);
                  }}
                >
                  <CalendarRange className="mr-1.5 h-4 w-4" />
                  Add date for all years
                </Button>
              ) : null}
              {!showForm ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    openAddForYear(
                      isCollege ? (programYears[0]?._id ?? "") : "",
                    )
                  }
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
                  disabled={
                    !canPerformApprove || unpublishMutation.isPending
                  }
                  title={
                    canPerformApprove
                      ? undefined
                      : APPROVE_ADMIN_ONLY_MESSAGE
                  }
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void publishMutation.mutateAsync()}
                  disabled={
                    !canPerformApprove ||
                    publishMutation.isPending ||
                    routines.length === 0
                  }
                  title={
                    canPerformApprove
                      ? undefined
                      : APPROVE_ADMIN_ONLY_MESSAGE
                  }
                >
                  Publish Routine
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  deleteRoutineScopeMutation.isPending || routines.length === 0
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the ENTIRE routine for "${exam.name}"?\n\nAll ${routines.length} scheduled subject(s) across every year will be removed. The exam, its marks, and its results are NOT deleted — you can build a fresh routine right after.`,
                    )
                  ) {
                    void deleteRoutineScopeMutation.mutateAsync(undefined);
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete whole routine
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {isCollege
          ? "One combined routine covers all three years — each year's students only ever see their own row entries in the portal. Switch to Year-wise to edit a single cohort."
          : "Add subject-wise exam schedules below."}
      </p>

      {/* Quick add: same date/time, one subject per year */}
      {canWrite && showBulkForm && isCollege ? (
        <Card className="border-brand-200">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div>
              <CardTitle className="text-base">
                Add one exam date across all years
              </CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                Set the date and time once, then choose the subject each year
                sits that day. Leave a year blank to skip it.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowBulkForm(false)}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="Exam Date (BS)">
                <NepaliDateField
                  value={bulkSlot.examDateBs}
                  onChange={(value) =>
                    setBulkSlot((current) => ({
                      ...current,
                      examDateBs: value,
                      day: weekdayFromBsDate(value) || current.day,
                    }))
                  }
                />
              </FormField>
              <FormField label="Day">
                <Select
                  value={bulkSlot.day}
                  onChange={(event) =>
                    setBulkSlot((current) => ({
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
                  value={bulkSlot.durationMinutes}
                  onChange={(event) =>
                    setBulkSlot((current) => ({
                      ...current,
                      durationMinutes: event.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Start Time">
                <Input
                  type="time"
                  value={bulkSlot.startTime}
                  onChange={(event) =>
                    setBulkSlot((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="End Time">
                <Input
                  type="time"
                  value={bulkSlot.endTime}
                  onChange={(event) =>
                    setBulkSlot((current) => ({
                      ...current,
                      endTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Exam Hall (optional)">
                <Input
                  value={bulkSlot.examHall}
                  onChange={(event) =>
                    setBulkSlot((current) => ({
                      ...current,
                      examHall: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {programYears.map((year) => {
                const yearId = idStr(year._id);
                const alreadyScheduled = new Set(
                  routines
                    .filter((r) => idStr(r.yearId) === yearId)
                    .map((r) => r.subjectId),
                );
                const options = subjectsForYear(yearId).filter(
                  (subject) => !alreadyScheduled.has(subject._id),
                );
                return (
                  <FormField
                    key={yearId}
                    label={`${shortYearTitle(year.name, year.level)} year subject`}
                  >
                    <Select
                      value={bulkSubjectByYear[yearId] ?? ""}
                      onChange={(event) =>
                        setBulkSubjectByYear((current) => ({
                          ...current,
                          [yearId]: event.target.value,
                        }))
                      }
                    >
                      <option value="">— No exam this day —</option>
                      {options.map((subject) => (
                        <option key={subject._id} value={subject._id}>
                          {subject.name}
                          {subject.code ? ` (${subject.code})` : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBulkSlot(emptyBulkSlot());
                  setBulkSubjectByYear({});
                  setShowBulkForm(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitBulk}
                disabled={bulkCreateMutation.isPending}
              >
                {bulkCreateMutation.isPending
                  ? "Saving…"
                  : "Add to selected years"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Add / Edit single entry */}
      {canWrite && showForm ? (
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
                      day: weekdayFromBsDate(value) || current.day,
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

      {isCollege && programYears.length === 0 && tables.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-900">
            No year cohorts linked to this exam
          </p>
          <p className="text-sm text-amber-800">
            Edit the exam and add year cohorts (e.g. 1st Year · Batch 2083, 2nd
            Year · Batch 2082, 3rd Year · Batch 2081). Each cohort becomes a
            column of the combined routine.
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
            canWrite
              ? "Use “Add date for all years” to build the 1st / 2nd / 3rd year routine in one pass."
              : "The exam routine will appear here once published."
          }
        />
      ) : viewMode === "grid" ? (
        /* Combined Date × Year grid — the sheet the college prints */
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 pb-3">
            <div>
              <CardTitle className="text-base text-slate-900">
                {exam.name} — combined exam routine
              </CardTitle>
              <p className="text-xs text-slate-500">
                {routines.length} subject{routines.length === 1 ? "" : "s"}{" "}
                across {gridColumns.length} year
                {gridColumns.length === 1 ? "" : "s"} ·{" "}
                {exam.startDateBs} to {exam.endDateBs}
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ExamRoutineGrid columns={gridColumns} slots={routines} />
          </CardContent>
        </Card>
      ) : (
        /* Year-wise tables — editing surface for a single cohort */
        <div className="space-y-6">
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
                <div className="flex flex-wrap gap-2">
                  {canWrite && isCollege && table.yearId ? (
                    <Button
                      size="sm"
                      onClick={() => openAddForYear(table.yearId)}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add for {shortYearTitle(table.title, table.level)}
                    </Button>
                  ) : null}
                  {canWrite && !isCollege ? (
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
                  {canWrite && table.yearId && table.slots.length > 0 ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleteRoutineScopeMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete this year's whole routine (${table.title})?\n\nAll ${table.slots.length} scheduled subject(s) for this cohort will be removed. Other years, the exam, and its results stay untouched.`,
                          )
                        ) {
                          void deleteRoutineScopeMutation.mutateAsync(
                            table.yearId,
                          );
                        }
                      }}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete this year&apos;s routine
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {table.slots.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                    No subjects scheduled for this year yet.
                    {canWrite
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
                          {canWrite ? <Th /> : null}
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
                            {canWrite ? (
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

      {/* Hidden A4 landscape sheet cloned by the Print button */}
      <ExamRoutinePrintSheet
        id={printSheetId}
        collegeName={settings?.schoolName}
        collegeAddress={collegeAddress}
        examName={exam.name}
        academicYearBs={exam.academicYearBs}
        startDateBs={exam.startDateBs}
        endDateBs={exam.endDateBs}
        columns={gridColumns}
        slots={routines}
        note="Students must be seated in the examination hall 15 minutes before the scheduled start time. Bring your college identity card."
      />
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

  /** Group: exam → year columns so the multi-exam view stays clear */
  const examGroups = useMemo(() => {
    const byExam = new Map<
      string,
      {
        examId: string;
        examName: string;
        columns: RoutineColumn[];
        slots: EnrichedRoutine[];
      }
    >();

    for (const r of routines) {
      const eid = r.examId;
      if (!byExam.has(eid)) {
        byExam.set(eid, {
          examId: eid,
          examName: examNameById.get(eid) ?? "Exam",
          columns: [],
          slots: [],
        });
      }
      const group = byExam.get(eid)!;
      const yearKey = r.yearId || "";
      const title = r.yearName || (r.yearId ? "Year" : "Exam schedule");
      // yearName may be "Ended · Batch 2081" (combined with batch name) — match the year part only.
      if ((title || "").toLowerCase().startsWith("ended")) continue;
      if (!group.columns.some((column) => column.key === yearKey)) {
        group.columns.push({
          key: yearKey,
          title,
          shortTitle: shortYearTitle(title, r.yearLevel),
          level: r.yearLevel,
        });
      }
      group.slots.push(r);
    }

    return Array.from(byExam.values()).map((group) => ({
      ...group,
      columns: group.columns.sort((a, b) => (a.level ?? 99) - (b.level ?? 99)),
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
        <div key={group.examId} className="space-y-2">
          {examGroups.length > 1 || !examId ? (
            <h3 className="text-base font-semibold text-slate-900">
              {group.examName}
            </h3>
          ) : null}
          <ExamRoutineGrid columns={group.columns} slots={group.slots} />
        </div>
      ))}
    </div>
  );
};
