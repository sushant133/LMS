import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EmployeeAttendancePeriodDaySheet,
  EmployeeAttendancePeriodLog,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

const BS_MONTH_NAMES = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

/** Today in BS as YYYY-MM-DD — the default date for daily period entry. */
const todayBs = (): string => {
  try {
    const today = getTodayBs();
    return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  } catch {
    return "";
  }
};

const currentBsMonth = (): string => {
  try {
    const today = getTodayBs();
    return `${today.year}-${String(today.month).padStart(2, "0")}`;
  } catch {
    return "";
  }
};

const monthLabel = (monthBs: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthBs.trim());
  if (!match) return monthBs || "—";
  const index = Number(match[2]) - 1;
  return `${BS_MONTH_NAMES[index] ?? match[2]} ${match[1]}`;
};

const npr = (value: number): string =>
  `Rs ${Math.round(value).toLocaleString("en-NP")}`;

/** Attendance statuses on which a teacher can have taught periods. */
const ATTENDED = new Set(["PRESENT", "LATE", "HALF_DAY", "OFFICIAL_DUTY"]);

interface Props {
  /** Write access to the teacher attendance sheet. */
  canEdit: boolean;
}

/**
 * Period Log — how many periods each teacher actually took.
 *
 * A PRESENT/ABSENT mark cannot pay a per-period contract, so this section records the
 * period count for every teaching day and totals it per month. Those totals are what the
 * salary sheet and the payroll Period section multiply by the teacher's period rate, so
 * anything entered here changes what a per-period teacher is paid.
 */
export const TeacherPeriodLogPanel = ({ canEdit }: Props) => {
  const queryClient = useQueryClient();
  const [monthBs, setMonthBs] = useState(currentBsMonth);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  /** Daily entry: the date being recorded, what has been typed, and who to list. */
  const [entryDateBs, setEntryDateBs] = useState(todayBs);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dayFilter, setDayFilter] = useState<"PERIOD" | "ALL">("PERIOD");
  /**
   * Rows the user has typed into but not saved. A refetch reseeds every other row from
   * the server, so unsaved typing elsewhere in the table survives a single-row save.
   */
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  /** Teacher whose already-saved count is currently open for editing. */
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);

  const [year, month] = useMemo(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(monthBs);
    return match ? [match[1]!, match[2]!] : ["", ""];
  }, [monthBs]);

  const logQuery = useQuery({
    queryKey: ["employee-attendance", "periods", monthBs, search],
    queryFn: () =>
      unwrap<EmployeeAttendancePeriodLog>(
        api.get("/employee-attendance/periods", {
          params: { monthBs, q: search.trim() || undefined },
        }),
      ),
    enabled: /^\d{4}-\d{2}$/.test(monthBs),
  });

  /**
   * The chosen day's roster, loaded on its own so periods can be entered for any date —
   * including one whose attendance sheet has not been opened yet.
   */
  const dayQuery = useQuery({
    queryKey: ["employee-attendance", "periods", "day", entryDateBs],
    queryFn: () =>
      unwrap<EmployeeAttendancePeriodDaySheet>(
        api.get("/employee-attendance/periods/day", {
          params: { dateBs: entryDateBs },
        }),
      ),
    enabled: canEdit && /^\d{4}-\d{2}-\d{2}$/.test(entryDateBs),
  });

  const log = logQuery.data;
  const rows = log?.rows ?? [];
  const daySheet = dayQuery.data;

  const dayRows = useMemo(() => {
    const all = daySheet?.rows ?? [];
    if (dayFilter === "ALL") return all;
    const periodOnly = all.filter((row) => row.paymentType === "PERIOD");
    // A college with no per-period contracts yet would otherwise see an empty table.
    return periodOnly.length > 0 ? periodOnly : all;
  }, [dayFilter, daySheet]);

  // Reseed from the server, keeping rows the user is still typing into.
  useEffect(() => {
    setDraft((current) => {
      const next: Record<string, string> = {};
      for (const row of daySheet?.rows ?? []) {
        next[row.teacherId] = dirty.has(row.teacherId)
          ? (current[row.teacherId] ?? "")
          : typeof row.periodsTaught === "number"
            ? String(row.periodsTaught)
            : "";
      }
      return next;
    });
    // `dirty` is intentionally not a dependency — reseeding is driven by new server data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySheet]);

  // Switching date drops any half-typed values and closes the open editor.
  useEffect(() => {
    setDirty(new Set());
    setEditingTeacherId(null);
  }, [entryDateBs]);

  const setDraftValue = (teacherId: string, value: string) => {
    setDraft((current) => ({ ...current, [teacherId]: value }));
    setDirty((current) => new Set(current).add(teacherId));
  };

  const dayTotalPeriods = useMemo(
    () =>
      dayRows.reduce((sum, row) => {
        const value = Number((draft[row.teacherId] ?? "").trim());
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [dayRows, draft],
  );

  type PeriodEntry = { teacherId: string; periodsTaught: number | null };

  const saveMutation = useMutation({
    mutationFn: (entries: PeriodEntry[]) =>
      unwrap<{
        updated: number;
        markedPresent: number;
        skipped: Array<{ reason: string }>;
      }>(
        api.post("/employee-attendance/periods", {
          dateBs: entryDateBs,
          entries,
          // Recording a period on an unmarked day asserts the teacher was present.
          markPresent: true,
        }),
      ),
    onSuccess: async (data, entries) => {
      const skipped = data?.skipped ?? [];
      const marked = data?.markedPresent ?? 0;
      const suffix = marked > 0 ? ` · ${marked} marked present` : "";
      if (skipped.length > 0) {
        toast.warning(
          `Saved ${data?.updated ?? 0}${suffix} · ${skipped.length} skipped — ${skipped[0]?.reason ?? ""}`,
        );
      } else if (entries.length === 1 && entries[0]?.periodsTaught === null) {
        toast.success("Period count removed");
      } else {
        toast.success(`Saved periods for ${data?.updated ?? 0} teacher(s)${suffix}`);
      }

      // Saved rows are no longer dirty, so the refetch may overwrite them.
      setDirty((current) => {
        const next = new Set(current);
        for (const entry of entries) next.delete(entry.teacherId);
        return next;
      });
      setEditingTeacherId(null);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee-attendance"] }),
        // Payroll reads these totals — refresh the sheet so the Period section follows.
        queryClient.invalidateQueries({ queryKey: ["accounting-salary-sheet"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  /** Teacher ids in the request currently in flight — drives the per-row busy state. */
  const savingIds = saveMutation.isPending
    ? new Set((saveMutation.variables ?? []).map((entry) => entry.teacherId))
    : new Set<string>();

  const parsePeriods = (teacherId: string): number | null | undefined => {
    const raw = (draft[teacherId] ?? "").trim();
    if (raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 24) return undefined;
    return value;
  };

  /** Save one teacher's count on its own. */
  const saveRow = (teacherId: string) => {
    const periodsTaught = parsePeriods(teacherId);
    if (periodsTaught === undefined) {
      toast.error("Periods must be a number between 0 and 24");
      return;
    }
    void saveMutation.mutateAsync([{ teacherId, periodsTaught }]);
  };

  /** Remove a saved count, leaving the day "not recorded" for that teacher. */
  const deleteRow = (teacherId: string, fullName: string) => {
    if (
      !window.confirm(
        `Remove ${fullName}'s period count for ${entryDateBs}?\n\nThe day goes back to "not recorded" and stops counting towards period pay. Their attendance mark is not changed.`,
      )
    ) {
      return;
    }
    setDraftValue(teacherId, "");
    void saveMutation.mutateAsync([{ teacherId, periodsTaught: null }]);
  };

  const startEdit = (teacherId: string, saved?: number) => {
    setEditingTeacherId(teacherId);
    setDraftValue(teacherId, typeof saved === "number" ? String(saved) : "");
  };

  const cancelEdit = (teacherId: string, saved?: number) => {
    setEditingTeacherId(null);
    setDraft((current) => ({
      ...current,
      [teacherId]: typeof saved === "number" ? String(saved) : "",
    }));
    setDirty((current) => {
      const next = new Set(current);
      next.delete(teacherId);
      return next;
    });
  };

  /** Save every row that can take a count — the whole-day shortcut. */
  const submitDay = () => {
    const editable = dayRows.filter(
      // A teacher marked ABSENT / LEAVE cannot have taught — never send a count for them.
      (row) => !row.marked || ATTENDED.has(row.status),
    );

    if (editable.length === 0) {
      toast.error("No teacher on this date can be given a period count");
      return;
    }

    const entries: PeriodEntry[] = [];
    for (const row of editable) {
      const periodsTaught = parsePeriods(row.teacherId);
      if (periodsTaught === undefined) {
        toast.error(`${row.fullName}: periods must be a number between 0 and 24`);
        return;
      }
      entries.push({ teacherId: row.teacherId, periodsTaught });
    }

    void saveMutation.mutateAsync(entries);
  };

  const totals = log?.totals;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Period Log — periods taught</CardTitle>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Attendance only records present or absent, which cannot pay a teacher on a
            per-period contract. Record here how many periods each teacher actually took
            each day. The monthly total feeds the salary sheet and the payroll{" "}
            <span className="font-medium">Period</span> section, where it is multiplied by
            that teacher&apos;s period rate.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="BS Year">
              <Input
                value={year}
                inputMode="numeric"
                placeholder="2082"
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "").slice(0, 4);
                  setMonthBs(`${next}-${month || "01"}`);
                }}
              />
            </FormField>
            <FormField label="Month">
              <Select
                value={month}
                onChange={(event) =>
                  setMonthBs(`${year || getTodayBs().year}-${event.target.value}`)
                }
              >
                {BS_MONTH_NAMES.map((name, index) => (
                  <option key={name} value={String(index + 1).padStart(2, "0")}>
                    {name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Search teacher">
              <Input
                value={search}
                placeholder="Name or teacher code"
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>
          </div>

          {totals ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Per-period teachers",
                  value: totals.periodPaidTeachers,
                  hint: `of ${totals.teachers} on roster`,
                },
                {
                  label: "Periods this month",
                  value: totals.totalPeriods,
                  hint: monthLabel(monthBs),
                },
                {
                  label: "Estimated period pay",
                  value: npr(totals.estimatedAmountNpr),
                  hint: "periods × rate",
                },
                {
                  label: "Days missing a count",
                  value: totals.daysMissingPeriods,
                  hint: "present but no periods entered",
                },
              ].map((tile) => (
                <div
                  key={tile.label}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {tile.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {tile.value}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{tile.hint}</p>
                </div>
              ))}
            </div>
          ) : null}

          {totals && totals.daysMissingPeriods > 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-900">
                {totals.daysMissingPeriods} attended day
                {totals.daysMissingPeriods === 1 ? " has" : "s have"} no period count
                yet. Those days contribute nothing to period pay until a number is
                recorded below.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Daily entry: pick any date, enter each teacher's periods for that day */}
      {canEdit ? (
        <Card className="border-brand-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Record periods for a day
            </CardTitle>
            <p className="text-sm text-slate-500">
              Pick any date and enter how many periods each teacher took that day — e.g.
              on 2083-05-09, Ram took 2 periods. Save each teacher on their own row; a
              saved count can be edited or deleted from that row afterwards.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <FormField label="Date (BS)">
                <NepaliDateField value={entryDateBs} onChange={setEntryDateBs} />
              </FormField>
              <FormField label="Show">
                <Select
                  value={dayFilter}
                  onChange={(event) =>
                    setDayFilter(event.target.value as "PERIOD" | "ALL")
                  }
                >
                  <option value="PERIOD">Per-period teachers only</option>
                  <option value="ALL">All teachers</option>
                </Select>
              </FormField>
              <div className="flex items-end">
                <p className="text-xs text-slate-500">
                  {daySheet
                    ? `${dayRows.length} teacher(s) listed · ${daySheet.sheetExists ? `sheet ${daySheet.sheetStatus || "DRAFT"}` : "no attendance sheet yet"}`
                    : ""}
                </p>
              </div>
            </div>

            {dayQuery.isLoading ? (
              <LoadingState />
            ) : !daySheet ? null : daySheet.locked ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                The attendance sheet for {daySheet.dateBs} is locked. Unlock it from Take
                Teacher Attendance before changing period counts.
              </p>
            ) : (
              <>
                {!daySheet.sheetExists ? (
                  <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <p className="text-sm text-blue-900">
                      No attendance has been taken for {daySheet.dateBs} yet. Saving
                      periods here will open a draft sheet and mark the teachers you gave
                      a count to as <span className="font-medium">Present</span> for that
                      day — recording that someone taught a period says they were there.
                    </p>
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Teacher</Th>
                        <Th>Code</Th>
                        <Th>Pay type</Th>
                        <Th className="text-center">Attendance</Th>
                        <Th className="text-center">Periods taught</Th>
                        <Th className="text-right">Actions</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {dayRows.length === 0 ? (
                        <tr>
                          <Td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                            No teachers to show. Switch “Show” to All teachers, or add
                            teachers under HR.
                          </Td>
                        </tr>
                      ) : (
                        dayRows.map((row) => {
                          const canRecord = !row.marked || ATTENDED.has(row.status);
                          const saved = row.periodsTaught;
                          const isSaved = typeof saved === "number";
                          const isEditing = editingTeacherId === row.teacherId;
                          const isBusy = savingIds.has(row.teacherId);
                          // A saved row is read-only until Edit is pressed; an unrecorded
                          // one is open for typing straight away.
                          const inputOpen = canRecord && (!isSaved || isEditing);

                          return (
                            <tr key={row.teacherId}>
                              <Td className="font-medium text-slate-900">
                                {row.fullName}
                              </Td>
                              <Td className="text-xs text-slate-500">
                                {row.employeeCode}
                              </Td>
                              <Td>
                                <Badge
                                  className={
                                    row.paymentType === "PERIOD"
                                      ? "bg-brand-100 text-brand-700"
                                      : "bg-slate-100 text-slate-600"
                                  }
                                >
                                  {row.paymentType}
                                </Badge>
                              </Td>
                              <Td className="text-center">
                                <Badge
                                  className={
                                    !row.marked
                                      ? "bg-slate-100 text-slate-500"
                                      : ATTENDED.has(row.status)
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-red-100 text-red-700"
                                  }
                                >
                                  {row.marked ? row.status : "Not marked"}
                                </Badge>
                              </Td>
                              <Td className="text-center">
                                {inputOpen ? (
                                  <NumberInput
                                    className="mx-auto h-9 w-20"
                                    min={0}
                                    max={24}
                                    step={1}
                                    autoFocus={isEditing}
                                    disabled={isBusy}
                                    value={draft[row.teacherId] ?? ""}
                                    onChange={(event) =>
                                      setDraftValue(row.teacherId, event.target.value)
                                    }
                                  />
                                ) : isSaved ? (
                                  <span className="text-base font-semibold tabular-nums text-slate-900">
                                    {saved}
                                  </span>
                                ) : (
                                  <span
                                    className="text-xs text-slate-400"
                                    title={`Marked ${row.status} on ${entryDateBs} — no periods can be taught`}
                                  >
                                    —
                                  </span>
                                )}
                              </Td>
                              <Td>
                                <div className="flex flex-wrap justify-end gap-1.5">
                                  {!canRecord ? (
                                    <span className="text-xs text-slate-400">
                                      {row.status}
                                    </span>
                                  ) : isEditing ? (
                                    <>
                                      <Button
                                        size="sm"
                                        className="h-8 px-2.5 text-xs"
                                        disabled={isBusy}
                                        onClick={() => saveRow(row.teacherId)}
                                      >
                                        <Save className="mr-1 h-3.5 w-3.5" />
                                        {isBusy ? "Saving…" : "Save"}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-2.5 text-xs"
                                        disabled={isBusy}
                                        onClick={() => cancelEdit(row.teacherId, saved)}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : isSaved ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-2.5 text-xs"
                                        disabled={isBusy}
                                        onClick={() => startEdit(row.teacherId, saved)}
                                      >
                                        <Pencil className="mr-1 h-3.5 w-3.5" />
                                        Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-8 px-2.5 text-xs"
                                        disabled={isBusy}
                                        onClick={() =>
                                          deleteRow(row.teacherId, row.fullName)
                                        }
                                      >
                                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                                        Delete
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      size="sm"
                                      className="h-8 px-2.5 text-xs"
                                      disabled={
                                        isBusy || (draft[row.teacherId] ?? "").trim() === ""
                                      }
                                      onClick={() => saveRow(row.teacherId)}
                                    >
                                      <Save className="mr-1 h-3.5 w-3.5" />
                                      {isBusy ? "Saving…" : "Save"}
                                    </Button>
                                  )}
                                </div>
                              </Td>
                            </tr>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <p className="mr-auto text-sm text-slate-600">
                    {dayTotalPeriods} period{dayTotalPeriods === 1 ? "" : "s"} entered for{" "}
                    {entryDateBs} · save each teacher on their own row, or save the whole
                    day at once.
                  </p>
                  <Button
                    variant="outline"
                    onClick={submitDay}
                    disabled={saveMutation.isPending || dayRows.length === 0}
                  >
                    <Save className="mr-1.5 h-4 w-4" />
                    {saveMutation.isPending ? "Saving…" : "Save all rows"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Monthly totals per teacher */}
      {logQuery.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No teachers on the roster"
          description="Add teachers under HR, then their monthly period totals will be summarised here."
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {monthLabel(monthBs)} — periods per teacher
            </CardTitle>
            <p className="text-sm text-slate-500">
              Per-period teachers first. Open a row to see the day-by-day breakdown
              behind the total.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Teacher</Th>
                    <Th>Pay type</Th>
                    <Th className="text-center">Period rate</Th>
                    <Th className="text-center">Days attended</Th>
                    <Th className="text-center">Days with a count</Th>
                    <Th className="text-center">Total periods</Th>
                    <Th className="text-center">Period pay</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const open = expanded === row.teacherId;
                    return (
                      <Fragment key={row.teacherId}>
                        <tr>
                          <Td>
                            <button
                              type="button"
                              aria-label={open ? "Hide days" : "Show days"}
                              onClick={() =>
                                setExpanded(open ? null : row.teacherId)
                              }
                              className="rounded p-1 text-slate-500 hover:bg-slate-100"
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </Td>
                          <Td>
                            <div className="font-medium text-slate-900">
                              {row.fullName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.employeeCode} · {row.designation}
                            </div>
                          </Td>
                          <Td>
                            <Badge
                              className={
                                row.paymentType === "PERIOD"
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-slate-100 text-slate-600"
                              }
                            >
                              {row.paymentType}
                            </Badge>
                          </Td>
                          <Td className="text-center tabular-nums">
                            {row.paymentType === "PERIOD"
                              ? npr(row.periodRateNpr)
                              : "—"}
                          </Td>
                          <Td className="text-center tabular-nums">
                            {row.attendedDays}
                          </Td>
                          <Td className="text-center tabular-nums">
                            {row.daysWithPeriods}
                            {row.attendedDaysMissingPeriods > 0 ? (
                              <span
                                className="ml-1 text-xs text-amber-600"
                                title={`${row.attendedDaysMissingPeriods} attended day(s) without a period count`}
                              >
                                ({row.attendedDaysMissingPeriods} missing)
                              </span>
                            ) : null}
                          </Td>
                          <Td className="text-center text-base font-semibold tabular-nums text-slate-900">
                            {row.totalPeriods}
                          </Td>
                          <Td className="text-center tabular-nums">
                            {row.paymentType === "PERIOD"
                              ? npr(row.estimatedAmountNpr)
                              : "—"}
                          </Td>
                        </tr>
                        {open ? (
                          <tr>
                            <Td colSpan={8} className="bg-slate-50/70">
                              {row.days.length === 0 ? (
                                <p className="py-2 text-sm text-slate-500">
                                  No attendance marked for this teacher in{" "}
                                  {monthLabel(monthBs)}.
                                </p>
                              ) : (
                                <div className="flex flex-wrap gap-2 py-1">
                                  {row.days.map((day) => (
                                    <div
                                      key={day.dateBs}
                                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                                    >
                                      <div className="font-medium tabular-nums text-slate-900">
                                        {day.dateBs}
                                      </div>
                                      <div className="text-slate-500">
                                        {day.status || "—"}
                                      </div>
                                      <div
                                        className={
                                          typeof day.periodsTaught === "number"
                                            ? "font-semibold text-brand-700"
                                            : "text-amber-600"
                                        }
                                      >
                                        {typeof day.periodsTaught === "number"
                                          ? `${day.periodsTaught} period${day.periodsTaught === 1 ? "" : "s"}`
                                          : "not recorded"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </Td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
