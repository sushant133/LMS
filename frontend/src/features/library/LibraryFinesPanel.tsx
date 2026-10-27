import { useEffect, useMemo, useState } from "react";
import { LibraryFinePayments } from "./LibraryFinePayments";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BatchRecord, LibraryIssueFineView, StudentRecord, YearRecord } from "@phit-erp/shared";
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
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";

type FineSettings = {
  enabled: boolean;
  finePerDayNpr: number;
  graceDays: number;
  maxFinePerBookNpr: number;
  chargeFromBs: string;
  updatedByName?: string;
  groupRates: Array<{
    batchId: string;
    yearId: string;
    batchName: string;
    yearName: string;
    finePerDayNpr: number;
    note: string;
  }>;
  studentRates: Array<{
    studentId: string;
    finePerDayNpr: number;
    note: string;
    studentName: string;
    admissionNumber: string;
    rollNumber: number | null;
    batchName: string;
    yearName: string;
  }>;
};

type FineRow = {
  issueId: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: number | null;
  batchName: string;
  yearName: string;
  bookTitle: string;
  bookCode: string;
  issuedDateBs: string;
  dueDateBs: string;
  returnedDateBs: string;
  loanStatus: string;
  finePaidNpr: number;
  fineClearedByName: string;
  fineClearNote: string;
  fine: LibraryIssueFineView;
};

type FinesResponse = {
  todayBs: string;
  enabled: boolean;
  rows: FineRow[];
  totals: { accruingNpr: number; outstandingNpr: number; collectedNpr: number; waivedNpr: number };
};

type View = "all" | "accruing" | "outstanding" | "cleared" | "payments";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "all", label: "All" },
  { id: "accruing", label: "Books still out" },
  { id: "outstanding", label: "To collect" },
  { id: "cleared", label: "Cleared" },
  { id: "payments", label: "Payments" },
];

const STATUS_STYLE: Record<LibraryIssueFineView["status"], string> = {
  NONE: "bg-slate-100 text-slate-700",
  ACCRUING: "bg-amber-100 text-amber-900",
  OUTSTANDING: "bg-rose-100 text-rose-800",
  PAID: "bg-emerald-100 text-emerald-800",
  WAIVED: "bg-sky-100 text-sky-800",
};

const STATUS_LABEL: Record<LibraryIssueFineView["status"], string> = {
  NONE: "No fine yet",
  ACCRUING: "Growing daily",
  OUTSTANDING: "To collect",
  PAID: "Paid",
  WAIVED: "Waived",
};

const RATE_SOURCE_LABEL: Record<string, string> = {
  STUDENT: "student",
  BATCH_YEAR: "batch-year",
  BATCH: "batch",
};

const invalidateFines = () =>
  Promise.all(
    ["library-fines", "library-fine-settings", "library-issues", "library-dashboard"].map(
      (key) => queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );

/**
 * Library → Overdue Fines (Administrator only).
 * Daily fine for all students, individual student rates, and the fines list
 * where a returned book's fine is recorded as paid or waived.
 */
export const LibraryFinesPanel = () => {
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["library-fine-settings"],
    queryFn: () => unwrap<FineSettings>(api.get("/library/fines/settings")),
  });
  const finesQuery = useQuery({
    queryKey: ["library-fines", view],
    queryFn: () =>
      unwrap<FinesResponse>(api.get("/library/fines", { params: { view } })),
    // Payments has its own list
    enabled: view !== "payments",
  });
  const studentsQuery = useQuery({
    queryKey: ["students", "library-fine-picker"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    staleTime: 5 * 60_000,
  });

  // ---- college-wide rule
  const [form, setForm] = useState({
    enabled: false,
    finePerDayNpr: 0,
    graceDays: 0,
    maxFinePerBookNpr: 0,
    chargeFromBs: "",
  });
  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setForm({
      enabled: s.enabled,
      finePerDayNpr: s.finePerDayNpr,
      graceDays: s.graceDays,
      maxFinePerBookNpr: s.maxFinePerBookNpr,
      chargeFromBs: s.chargeFromBs,
    });
  }, [settingsQuery.data]);

  const saveSettings = useMutation({
    mutationFn: () => unwrap(api.put("/library/fines/settings", form)),
    onSuccess: async () => {
      toast.success(
        form.enabled
          ? "Overdue fines are on — students with overdue books have been notified"
          : "Overdue fines are off",
      );
      await invalidateFines();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  // ---- batch / batch-year rate
  const batchesQuery = useQuery({
    queryKey: ["academics", "batches", "library-fines"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    staleTime: 5 * 60_000,
  });
  const yearsQuery = useQuery({
    queryKey: ["academics", "years", "library-fines"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    staleTime: 5 * 60_000,
  });
  const [groupBatchId, setGroupBatchId] = useState("");
  const [groupYearId, setGroupYearId] = useState("");
  const [groupAmount, setGroupAmount] = useState<number>(0);
  const [groupNote, setGroupNote] = useState("");
  /** Years belong to a batch: only the chosen batch's years are offered */
  const groupYearOptions = useMemo(
    () =>
      (yearsQuery.data ?? []).filter((y) => {
        const batch = y.batchId as unknown;
        const id =
          batch && typeof batch === "object"
            ? String((batch as { _id?: string })._id ?? "")
            : String(batch ?? "");
        return id === groupBatchId;
      }),
    [yearsQuery.data, groupBatchId],
  );
  const saveGroupRate = useMutation({
    mutationFn: (body: {
      batchId: string;
      yearId: string;
      finePerDayNpr: number | null;
      note?: string;
    }) => unwrap(api.put("/library/fines/group-rates", body)),
    onSuccess: async (_d, body) => {
      toast.success(body.finePerDayNpr === null ? "Batch fine removed" : "Batch fine saved");
      setGroupYearId("");
      setGroupAmount(0);
      setGroupNote("");
      await invalidateFines();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  // ---- single-student rate
  const [rateStudentId, setRateStudentId] = useState("");
  const [rateSearch, setRateSearch] = useState("");
  const [rateAmount, setRateAmount] = useState<number>(0);
  const [rateNote, setRateNote] = useState("");
  const studentOptions = useMemo(() => {
    const needle = rateSearch.trim().toLowerCase();
    return (studentsQuery.data ?? [])
      .filter((s) => {
        if (!needle) return true;
        return [s.user?.fullName, s.admissionNumber, String(s.rollNumber ?? "")]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .slice(0, 200);
  }, [studentsQuery.data, rateSearch]);

  const saveStudentRate = useMutation({
    mutationFn: (body: { studentId: string; finePerDayNpr: number | null; note?: string }) =>
      unwrap(api.put("/library/fines/student-rates", body)),
    onSuccess: async (_data, body) => {
      toast.success(
        body.finePerDayNpr === null
          ? "Student now uses the fine for all students"
          : "Student fine saved",
      );
      setRateStudentId("");
      setRateSearch("");
      setRateAmount(0);
      setRateNote("");
      await invalidateFines();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  // ---- clearing / adjusting a returned book's fine
  const [actionRow, setActionRow] = useState<{
    issueId: string;
    mode: "PAID" | "WAIVED" | "ADJUST";
    amount: number;
    note: string;
  } | null>(null);

  const clearFine = useMutation({
    mutationFn: (input: { issueId: string; method: "PAID" | "WAIVED"; amountNpr: number; note: string }) =>
      unwrap(
        api.post(`/library/fines/${input.issueId}/clear`, {
          method: input.method,
          amountNpr: input.method === "PAID" ? input.amountNpr : undefined,
          note: input.note,
        }),
      ),
    onSuccess: async (_d, input) => {
      toast.success(input.method === "PAID" ? "Fine marked as paid" : "Fine waived");
      setActionRow(null);
      await invalidateFines();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const adjustFine = useMutation({
    mutationFn: (input: { issueId: string; amountNpr: number; note: string }) =>
      unwrap(
        api.put(`/library/fines/${input.issueId}`, {
          amountNpr: input.amountNpr,
          note: input.note,
        }),
      ),
    onSuccess: async () => {
      toast.success("Fine updated");
      setActionRow(null);
      await invalidateFines();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = finesQuery.data?.rows ?? [];
    if (!needle) return list;
    return list.filter((row) =>
      [row.studentName, row.admissionNumber, String(row.rollNumber ?? ""), row.bookTitle, row.bookCode]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [finesQuery.data, search]);

  if (settingsQuery.isLoading) return <LoadingState />;
  if (settingsQuery.isError) {
    return (
      <EmptyState
        title="Could not load overdue fines"
        description={parseErrorMessage(settingsQuery.error)}
      />
    );
  }

  const totals = finesQuery.data?.totals;
  // 10 days late with the rule as entered (grace days free, capped per book)
  const exampleUncapped = Math.max(0, 10 - form.graceDays) * form.finePerDayNpr;
  const exampleFine =
    form.maxFinePerBookNpr > 0
      ? Math.min(exampleUncapped, form.maxFinePerBookNpr)
      : exampleUncapped;

  return (
    <div className="space-y-6">
      {/* 1. Fine for all students */}
      <Card>
        <CardHeader>
          <CardTitle>Overdue fine for all students</CardTitle>
          <p className="text-sm text-slate-500">
            Each overdue book is charged the fine per day, starting the day after
            its due date (after any grace days), until it is returned. You can
            collect or waive it at any time — even before the book comes back, in
            which case it keeps growing from the next day. Teachers and staff are
            not fined.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Charge overdue fines
          </label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Fine per day (NPR)">
              <NumberInput
                min={0}
                value={form.finePerDayNpr}
                onValueChange={(v) => setForm((f) => ({ ...f, finePerDayNpr: v ?? 0 }))}
              />
            </FormField>
            <FormField label="Grace days (no fine)">
              <NumberInput
                min={0}
                max={60}
                value={form.graceDays}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, graceDays: Math.max(0, Math.floor(v ?? 0)) }))
                }
              />
            </FormField>
            <FormField label="Most per book (NPR, blank = no limit)">
              <NumberInput
                min={0}
                value={form.maxFinePerBookNpr}
                onValueChange={(v) => setForm((f) => ({ ...f, maxFinePerBookNpr: v ?? 0 }))}
              />
            </FormField>
            <FormField label="Start charging from (optional)">
              <NepaliDateField
                value={form.chargeFromBs}
                onChange={(v) => setForm((f) => ({ ...f, chargeFromBs: v }))}
              />
            </FormField>
          </div>
          <p className="text-xs text-slate-500">
            Leave “Start charging from” blank to count every day from the due date.
            Set it to today so books that were already overdue are only fined from
            today onward.
            {form.finePerDayNpr > 0
              ? ` Example: a book 10 days late is fined ${formatCurrencyNpr(exampleFine)}.`
              : ""}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {settingsQuery.data?.updatedByName
                ? `Last changed by ${settingsQuery.data.updatedByName}`
                : "Not set yet"}
            </p>
            <Button
              type="button"
              disabled={saveSettings.isPending}
              onClick={() => saveSettings.mutate()}
            >
              {saveSettings.isPending ? "Saving…" : "Save fine rule"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. Batch and year */}
      <Card>
        <CardHeader>
          <CardTitle>Fine by batch and year</CardTitle>
          <p className="text-sm text-slate-500">
            Set a different fine per day for a batch — for all its years, or for
            one year only. Students in it use this instead of the fine for all
            students; a student&apos;s own fine (below) still comes first. Enter 0 to
            exempt the batch or year.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
            <Select
              value={groupBatchId}
              aria-label="Batch"
              onChange={(e) => {
                setGroupBatchId(e.target.value);
                setGroupYearId("");
              }}
            >
              <option value="">
                {batchesQuery.isLoading ? "Loading batches…" : "Select batch"}
              </option>
              {(batchesQuery.data ?? []).map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select
              value={groupYearId}
              aria-label="Year"
              disabled={!groupBatchId}
              onChange={(e) => setGroupYearId(e.target.value)}
            >
              <option value="">All years of this batch</option>
              {groupYearOptions.map((y) => (
                <option key={y._id} value={y._id}>
                  {y.name}
                </option>
              ))}
            </Select>
            <NumberInput
              min={0}
              value={groupAmount}
              onValueChange={(v) => setGroupAmount(v ?? 0)}
              aria-label="Fine per day for this batch or year"
              placeholder="NPR per day"
            />
            <Input
              value={groupNote}
              onChange={(e) => setGroupNote(e.target.value)}
              placeholder="Reason (optional)"
              aria-label="Reason"
            />
            <Button
              type="button"
              disabled={!groupBatchId || saveGroupRate.isPending}
              onClick={() =>
                saveGroupRate.mutate({
                  batchId: groupBatchId,
                  yearId: groupYearId,
                  finePerDayNpr: groupAmount,
                  note: groupNote,
                })
              }
            >
              Save
            </Button>
          </div>

          {(settingsQuery.data?.groupRates ?? []).length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Batch</Th>
                    <Th>Year</Th>
                    <Th>Fine per day</Th>
                    <Th>Reason</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {[...settingsQuery.data!.groupRates]
                    .sort(
                      (a, b) =>
                        a.batchName.localeCompare(b.batchName, undefined, { numeric: true }) ||
                        a.yearName.localeCompare(b.yearName, undefined, { numeric: true }),
                    )
                    .map((g) => (
                      <tr key={`${g.batchId}-${g.yearId}`}>
                        <Td className="font-medium text-slate-900">{g.batchName}</Td>
                        <Td>{g.yearId ? g.yearName : <span className="text-slate-500">All years</span>}</Td>
                        <Td className="font-semibold">
                          {g.finePerDayNpr > 0 ? formatCurrencyNpr(g.finePerDayNpr) : "Exempt"}
                        </Td>
                        <Td className="text-sm text-slate-600">{g.note || "—"}</Td>
                        <Td className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={saveGroupRate.isPending}
                            onClick={() =>
                              saveGroupRate.mutate({
                                batchId: g.batchId,
                                yearId: g.yearId,
                                finePerDayNpr: null,
                              })
                            }
                          >
                            Remove
                          </Button>
                        </Td>
                      </tr>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No batch or year fines — students use the fine for all students.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. Individual students */}
      <Card>
        <CardHeader>
          <CardTitle>Fine for a single student</CardTitle>
          <p className="text-sm text-slate-500">
            Give a student their own fine per day instead of the one for all
            students. Enter 0 to exempt them.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
            <Input
              value={rateSearch}
              onChange={(e) => setRateSearch(e.target.value)}
              placeholder="Search name, admission or roll no."
              aria-label="Search student"
            />
            <Select
              value={rateStudentId}
              onChange={(e) => setRateStudentId(e.target.value)}
              aria-label="Student"
            >
              <option value="">
                {studentsQuery.isLoading ? "Loading students…" : "Select student"}
              </option>
              {studentOptions.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.user?.fullName ?? "Student"}
                  {s.admissionNumber ? ` · ${s.admissionNumber}` : ""}
                  {s.rollNumber != null ? ` · Roll ${s.rollNumber}` : ""}
                </option>
              ))}
            </Select>
            <NumberInput
              min={0}
              value={rateAmount}
              onValueChange={(v) => setRateAmount(v ?? 0)}
              aria-label="Fine per day for this student"
              placeholder="NPR per day"
            />
            <Input
              value={rateNote}
              onChange={(e) => setRateNote(e.target.value)}
              placeholder="Reason (optional)"
              aria-label="Reason"
            />
            <Button
              type="button"
              disabled={!rateStudentId || saveStudentRate.isPending}
              onClick={() =>
                saveStudentRate.mutate({
                  studentId: rateStudentId,
                  finePerDayNpr: rateAmount,
                  note: rateNote,
                })
              }
            >
              Save
            </Button>
          </div>

          {(settingsQuery.data?.studentRates ?? []).length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Batch / Year</Th>
                    <Th>Fine per day</Th>
                    <Th>Reason</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {settingsQuery.data!.studentRates.map((r) => (
                    <tr key={r.studentId}>
                      <Td>
                        <div className="font-medium text-slate-900">{r.studentName}</div>
                        <div className="text-xs text-slate-500">
                          {[r.admissionNumber, r.rollNumber != null ? `Roll ${r.rollNumber}` : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </Td>
                      <Td className="text-sm text-slate-600">
                        {[r.batchName, r.yearName].filter(Boolean).join(" / ") || "—"}
                      </Td>
                      <Td className="font-semibold">
                        {r.finePerDayNpr > 0 ? formatCurrencyNpr(r.finePerDayNpr) : "Exempt"}
                      </Td>
                      <Td className="text-sm text-slate-600">{r.note || "—"}</Td>
                      <Td className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saveStudentRate.isPending}
                          onClick={() =>
                            saveStudentRate.mutate({ studentId: r.studentId, finePerDayNpr: null })
                          }
                        >
                          Use rate for all students
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No individual rates — every student uses the fine for all students.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4. Fines */}
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Student fines</CardTitle>
          {totals ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Owed — books still out", value: totals.accruingNpr, tone: "text-amber-800" },
                { label: "Owed — returned books", value: totals.outstandingNpr, tone: "text-rose-700" },
                { label: "Collected", value: totals.collectedNpr, tone: "text-emerald-700" },
                { label: "Waived", value: totals.waivedNpr, tone: "text-sky-700" },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">{t.label}</p>
                  <p className={cn("text-lg font-semibold", t.tone)}>{formatCurrencyNpr(t.value)}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {VIEWS.map((v) => (
              <Button
                key={v.id}
                type="button"
                size="sm"
                variant={view === v.id ? "default" : "outline"}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </Button>
            ))}
            {view !== "payments" ? (
              <Input
                className="ml-auto w-full sm:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student or book"
                aria-label="Search fines"
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {view === "payments" ? (
            <LibraryFinePayments />
          ) : (
          <>
          {!finesQuery.data?.enabled && view !== "cleared" ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Overdue fines are off. Turn on “Charge overdue fines” above to start
              charging overdue books.
            </p>
          ) : null}
          {finesQuery.isLoading ? (
            <LoadingState />
          ) : finesQuery.isError ? (
            <EmptyState title="Could not load fines" description={parseErrorMessage(finesQuery.error)} />
          ) : rows.length === 0 ? (
            <EmptyState title="No fines" description="No student has an overdue book or a fine in this view." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Book</Th>
                    <Th className="whitespace-nowrap">Due / Returned</Th>
                    <Th className="whitespace-nowrap">Days late</Th>
                    <Th className="whitespace-nowrap">Per day</Th>
                    <Th>Fine</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const acting = actionRow?.issueId === row.issueId ? actionRow : null;
                    // Anything owed can be collected / waived — even while the book is still out
                    const canClear = row.fine.outstandingNpr > 0;
                    const stillOut = row.loanStatus !== "RETURNED";
                    return (
                      <tr key={row.issueId}>
                        <Td>
                          <div className="font-medium text-slate-900">{row.studentName}</div>
                          <div className="text-xs text-slate-500">
                            {[
                              row.admissionNumber,
                              row.rollNumber != null ? `Roll ${row.rollNumber}` : "",
                              [row.batchName, row.yearName].filter(Boolean).join(" / "),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </Td>
                        <Td>
                          <div className="text-sm text-slate-900">{row.bookTitle}</div>
                          {row.bookCode ? <div className="text-xs text-slate-500">{row.bookCode}</div> : null}
                        </Td>
                        <Td className="whitespace-nowrap text-sm">
                          <div>Due {row.dueDateBs}</div>
                          <div className="text-xs text-slate-500">
                            {row.returnedDateBs ? `Returned ${row.returnedDateBs}` : "Not returned"}
                          </div>
                        </Td>
                        <Td className="tabular-nums">{row.fine.daysOverdue}</Td>
                        <Td className="whitespace-nowrap text-sm">
                          {row.fine.ratePerDayNpr > 0 ? formatCurrencyNpr(row.fine.ratePerDayNpr) : "—"}
                          {row.fine.customRate ? (
                            <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">
                              {RATE_SOURCE_LABEL[row.fine.rateSource ?? "STUDENT"] ?? "own"}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="whitespace-nowrap font-semibold">
                          {formatCurrencyNpr(row.fine.amountNpr)}
                          {row.fine.outstandingNpr > 0 &&
                          row.fine.outstandingNpr !== row.fine.amountNpr ? (
                            <div className="text-xs font-medium text-rose-700">
                              Owed now {formatCurrencyNpr(row.fine.outstandingNpr)}
                            </div>
                          ) : null}
                          {(row.fine.paidNpr ?? 0) > 0 ? (
                            <div className="text-xs font-normal text-emerald-700">
                              Paid {formatCurrencyNpr(row.fine.paidNpr ?? 0)}
                            </div>
                          ) : null}
                          {(row.fine.waivedNpr ?? 0) > 0 ? (
                            <div className="text-xs font-normal text-sky-700">
                              Waived {formatCurrencyNpr(row.fine.waivedNpr ?? 0)}
                            </div>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge className={STATUS_STYLE[row.fine.status]}>
                            {STATUS_LABEL[row.fine.status]}
                          </Badge>
                          {row.fineClearedByName && (row.fine.status === "PAID" || row.fine.status === "WAIVED") ? (
                            <div className="mt-1 text-xs text-slate-500">by {row.fineClearedByName}</div>
                          ) : null}
                        </Td>
                        <Td className="text-right">
                          {acting ? (
                            <div className="ml-auto flex max-w-xs flex-col gap-2 text-left">
                              {acting.mode !== "WAIVED" ? (
                                <NumberInput
                                  min={0}
                                  value={acting.amount}
                                  onValueChange={(v) =>
                                    setActionRow({ ...acting, amount: v ?? 0 })
                                  }
                                  aria-label={acting.mode === "PAID" ? "Amount collected" : "Amount owed now"}
                                />
                              ) : null}
                              <p className="text-xs text-slate-500">
                                {acting.mode === "PAID"
                                  ? `Owed now ${formatCurrencyNpr(row.fine.outstandingNpr)} — enter less for a part payment.`
                                  : acting.mode === "WAIVED"
                                    ? `Waives ${formatCurrencyNpr(row.fine.outstandingNpr)} owed now.`
                                    : "Set what the student owes now."}
                                {stillOut
                                  ? " Book still out: settles up to today; the fine keeps growing from tomorrow until it is returned."
                                  : ""}
                              </p>
                              <Input
                                value={acting.note}
                                onChange={(e) => setActionRow({ ...acting, note: e.target.value })}
                                placeholder={acting.mode === "WAIVED" ? "Reason for waiving" : "Note (optional)"}
                                aria-label="Note"
                              />
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => setActionRow(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={clearFine.isPending || adjustFine.isPending}
                                  onClick={() =>
                                    acting.mode === "ADJUST"
                                      ? adjustFine.mutate({
                                          issueId: row.issueId,
                                          amountNpr: acting.amount,
                                          note: acting.note,
                                        })
                                      : clearFine.mutate({
                                          issueId: row.issueId,
                                          method: acting.mode,
                                          amountNpr: acting.amount,
                                          note: acting.note,
                                        })
                                  }
                                >
                                  {acting.mode === "PAID" ? "Mark paid" : acting.mode === "WAIVED" ? "Waive" : "Save"}
                                </Button>
                              </div>
                            </div>
                          ) : canClear ? (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  setActionRow({ issueId: row.issueId, mode: "PAID", amount: row.fine.outstandingNpr, note: "" })
                                }
                              >
                                Mark paid
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setActionRow({ issueId: row.issueId, mode: "WAIVED", amount: 0, note: "" })
                                }
                              >
                                Waive
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setActionRow({ issueId: row.issueId, mode: "ADJUST", amount: row.fine.outstandingNpr, note: "" })
                                }
                              >
                                Adjust
                              </Button>
                              {stillOut ? (
                                <p className="w-full text-right text-[11px] text-slate-500">
                                  Book still out — fine keeps growing
                                </p>
                              ) : null}
                            </div>
                          ) : stillOut && row.fine.accruing ? (
                            <span className="text-xs text-slate-500">Paid up to date — grows daily until returned</span>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
