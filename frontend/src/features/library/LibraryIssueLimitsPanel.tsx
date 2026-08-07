import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LIBRARY_ISSUE_LIMIT_YEAR_LEVELS,
  type LibraryIssueLimitConfigRecord,
  type LibraryIssueLimitExceptionRecord,
  type LibraryIssueYearLimits,
  type LibraryStudentBorrowStatus,
} from "@phit-erp/shared";
import { Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { DualBsAdDateField } from "components/shared/NepaliDateField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { getTodayBs } from "@munatech/nepali-datepicker";

type IssueStudentRow = {
  _id: string;
  admissionNumber?: string;
  rollNumber?: number;
  batchId?: string;
  batchName?: string;
  yearId?: string;
  yearName?: string;
  user?: { fullName?: string } | null;
};

type ScopeOption = {
  _id: string;
  name: string;
  batchId?: string;
};

const formatTodayBs = (): string => {
  const t = getTodayBs();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

interface LibraryIssueLimitsPanelProps {
  /** Admin can edit limits/exceptions; library staff is read-only. */
  canManage: boolean;
}

/** Draft limits may be empty while typing (so Backspace can clear the field). */
type LimitsDraft = Record<
  (typeof LIBRARY_ISSUE_LIMIT_YEAR_LEVELS)[number],
  number | ""
>;

const toLimitsDraft = (limits: LibraryIssueYearLimits): LimitsDraft => ({
  "1st Year": limits["1st Year"],
  "2nd Year": limits["2nd Year"],
  "3rd Year": limits["3rd Year"],
});

const finalizeLimitsDraft = (
  draft: LimitsDraft,
): LibraryIssueYearLimits | null => {
  const out = {} as LibraryIssueYearLimits;
  for (const year of LIBRARY_ISSUE_LIMIT_YEAR_LEVELS) {
    const raw = draft[year];
    if (raw === "" || raw === undefined || raw === null || Number.isNaN(Number(raw))) {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 50) return null;
    out[year] = Math.floor(n);
  }
  return out;
};

export const LibraryIssueLimitsPanel = ({
  canManage,
}: LibraryIssueLimitsPanelProps) => {
  const [limitsDraft, setLimitsDraft] = useState<LimitsDraft | null>(null);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [exceptionForm, setExceptionForm] = useState({
    studentId: "",
    additionalBooks: 1 as number | "",
    reason: "",
    effectiveFromBs: formatTodayBs(),
    effectiveUntilBs: "",
    remarks: "",
  });
  const [studentSearch, setStudentSearch] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("");
  const [filterYearId, setFilterYearId] = useState("");

  const limitsQuery = useQuery({
    queryKey: ["library-issue-limits"],
    queryFn: () =>
      unwrap<LibraryIssueLimitConfigRecord>(api.get("/library/issue-limits")),
  });

  const exceptionsQuery = useQuery({
    queryKey: ["library-issue-limit-exceptions", includeRevoked],
    queryFn: () =>
      unwrap<{
        records: LibraryIssueLimitExceptionRecord[];
        total: number;
      }>(
        api.get("/library/issue-limit-exceptions", {
          params: includeRevoked ? { includeRevoked: "1" } : {},
        }),
      ),
  });

  const studentsQuery = useQuery({
    queryKey: ["students", "library-issue-limits"],
    queryFn: () =>
      unwrap<IssueStudentRow[]>(
        api.get("/students", { params: { loginActive: "1" } }),
      ),
    enabled: canManage && showExceptionForm,
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/batches")),
    enabled: canManage && showExceptionForm,
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/years")),
    enabled: canManage && showExceptionForm,
  });

  const limits: LimitsDraft | null = limitsDraft
    ? limitsDraft
    : limitsQuery.data?.limits
      ? toLimitsDraft(limitsQuery.data.limits)
      : null;

  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];

  /**
   * Years for the selected batch (unique ids). Without a batch, unique year
   * *names* so the dropdown is not full of duplicate 1st/2nd/3rd year rows.
   */
  const yearOptions = useMemo(() => {
    if (filterBatchId) {
      return filterYearsByBatch(years, filterBatchId).map((y) => ({
        value: y._id,
        label: y.name,
        mode: "id" as const,
      }));
    }
    const byName = new Map<string, string>();
    for (const y of years) {
      const label = (y.name ?? "").trim();
      const key = label.toLowerCase();
      if (!key || key === "ended") continue;
      if (!byName.has(key)) byName.set(key, label);
    }
    return Array.from(byName.values())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((label) => ({
        value: `name:${label}`,
        label,
        mode: "name" as const,
      }));
  }, [years, filterBatchId]);

  const filteredStudentsAll = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const yearNameFilter = filterYearId.startsWith("name:")
      ? filterYearId.slice("name:".length).trim().toLowerCase()
      : "";

    return (studentsQuery.data ?? [])
      .filter((s) => {
        if (filterBatchId && s.batchId !== filterBatchId) return false;
        if (filterYearId) {
          if (yearNameFilter) {
            const yName = (s.yearName ?? "").trim().toLowerCase();
            if (yName !== yearNameFilter) return false;
          } else if (s.yearId !== filterYearId) {
            return false;
          }
        }
        if (!q) return true;
        const name = (s.user?.fullName ?? "").toLowerCase();
        const adm = (s.admissionNumber ?? "").toLowerCase();
        const roll = String(s.rollNumber ?? "");
        return name.includes(q) || adm.includes(q) || roll.includes(q);
      })
      .sort((a, b) =>
        (a.user?.fullName ?? "").localeCompare(b.user?.fullName ?? ""),
      );
  }, [
    studentsQuery.data,
    studentSearch,
    filterBatchId,
    filterYearId,
  ]);

  const filteredStudents = useMemo(
    () => filteredStudentsAll.slice(0, 80),
    [filteredStudentsAll],
  );

  const saveLimits = useMutation({
    mutationFn: (next: LibraryIssueYearLimits) =>
      unwrap(api.put("/library/issue-limits", { limits: next })),
    onSuccess: async () => {
      toast.success("Year-wise issue limits saved");
      setLimitsDraft(null);
      await queryClient.invalidateQueries({
        queryKey: ["library-issue-limits"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createException = useMutation({
    mutationFn: (payload: {
      studentId: string;
      additionalBooks: number;
      reason: string;
      effectiveFromBs: string;
      effectiveUntilBs?: string;
      remarks?: string;
    }) => unwrap(api.post("/library/issue-limit-exceptions", payload)),
    onSuccess: async () => {
      toast.success("Exception granted");
      setShowExceptionForm(false);
      setExceptionForm({
        studentId: "",
        additionalBooks: 1,
        reason: "",
        effectiveFromBs: formatTodayBs(),
        effectiveUntilBs: "",
        remarks: "",
      });
      setStudentSearch("");
      setFilterBatchId("");
      setFilterYearId("");
      await queryClient.invalidateQueries({
        queryKey: ["library-issue-limit-exceptions"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const revokeException = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/library/issue-limit-exceptions/${id}`)),
    onSuccess: async () => {
      toast.success("Exception revoked");
      await queryClient.invalidateQueries({
        queryKey: ["library-issue-limit-exceptions"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const dirty =
    Boolean(limitsDraft) &&
    Boolean(limitsQuery.data?.limits) &&
    LIBRARY_ISSUE_LIMIT_YEAR_LEVELS.some((y) => {
      const draftVal = limitsDraft?.[y];
      const saved = limitsQuery.data!.limits[y];
      if (draftVal === "" || draftVal === undefined) return true;
      return Number(draftVal) !== saved;
    });

  const exceptions = exceptionsQuery.data?.records ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-brand-600" />
            Year-wise book issue limits
          </CardTitle>
          <p className="text-sm text-slate-500">
            Maximum number of books a student may hold at once, by academic year.
            Active student exceptions add to this default.
            {!canManage
              ? " You can view limits but only Admin / Super Admin can change them."
              : null}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {limitsQuery.isLoading ? (
            <LoadingState />
          ) : limitsQuery.isError ? (
            <EmptyState
              title="Could not load limits"
              description={parseErrorMessage(limitsQuery.error)}
            />
          ) : limits ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {LIBRARY_ISSUE_LIMIT_YEAR_LEVELS.map((year) => (
                  <FormField key={year} label={year}>
                    <NumberInput
                      min={0}
                      max={50}
                      value={limits[year]}
                      disabled={!canManage || saveLimits.isPending}
                      onValueChange={(v) => {
                        const base =
                          limitsDraft ??
                          toLimitsDraft(limitsQuery.data!.limits);
                        if (v === undefined) {
                          setLimitsDraft({ ...base, [year]: "" });
                          return;
                        }
                        setLimitsDraft({
                          ...base,
                          [year]: Math.max(0, Math.min(50, v)),
                        });
                      }}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Max concurrent books for {year}
                    </p>
                  </FormField>
                ))}
              </div>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={!dirty || saveLimits.isPending}
                    onClick={() => {
                      if (!limitsDraft && !limitsQuery.data?.limits) return;
                      const draft =
                        limitsDraft ??
                        toLimitsDraft(limitsQuery.data!.limits);
                      const finalized = finalizeLimitsDraft(draft);
                      if (!finalized) {
                        toast.error(
                          "Enter a valid number (0–50) for every year before saving",
                        );
                        return;
                      }
                      saveLimits.mutate(finalized);
                    }}
                  >
                    {saveLimits.isPending ? "Saving…" : "Save limits"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!dirty || saveLimits.isPending}
                    onClick={() => {
                      setLimitsDraft(null);
                      toast.message("Limits reset to last saved values");
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!dirty || saveLimits.isPending}
                    onClick={() => {
                      setLimitsDraft(null);
                      toast.message("Changes cancelled");
                    }}
                  >
                    Cancel
                  </Button>
                  {limitsQuery.data?.updatedByName ? (
                    <span className="text-xs text-slate-500">
                      Last updated by {limitsQuery.data.updatedByName}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">
              Issue limit exceptions
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Grant extra books to specific students. Example: default 3 +
              exception +2 → student may borrow 5.
            </p>
          </div>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setShowExceptionForm((v) => !v);
                if (showExceptionForm) {
                  setFilterBatchId("");
                  setFilterYearId("");
                  setStudentSearch("");
                }
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {showExceptionForm ? "Close form" : "Grant exception"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage && showExceptionForm ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Batch">
                  <Select
                    value={filterBatchId}
                    onChange={(e) => {
                      setFilterBatchId(e.target.value);
                      setFilterYearId("");
                      setExceptionForm((c) => ({ ...c, studentId: "" }));
                    }}
                  >
                    <option value="">All batches</option>
                    {batches.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Year">
                  <Select
                    value={filterYearId}
                    onChange={(e) => {
                      setFilterYearId(e.target.value);
                      setExceptionForm((c) => ({ ...c, studentId: "" }));
                    }}
                  >
                    <option value="">
                      {filterBatchId ? "All years in batch" : "All years"}
                    </option>
                    {yearOptions.map((y) => (
                      <option key={y.value} value={y.value}>
                        {y.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Search student">
                  <Input
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Name, roll, admission…"
                  />
                </FormField>
                <FormField label="Additional books *">
                  <NumberInput
                    min={1}
                    max={20}
                    value={exceptionForm.additionalBooks}
                    onValueChange={(v) =>
                      setExceptionForm((c) => ({
                        ...c,
                        additionalBooks:
                          v === undefined
                            ? ""
                            : Math.max(1, Math.min(20, v)),
                      }))
                    }
                  />
                </FormField>
              </div>
              <p className="text-xs text-slate-500">
                Filter by batch and year, then search or pick a student from the
                list.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {studentsQuery.isLoading ||
                batchesQuery.isLoading ||
                yearsQuery.isLoading ? (
                  <p className="p-3 text-sm text-slate-500">Loading students…</p>
                ) : filteredStudents.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">
                    No students match batch, year, or search.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredStudents.map((s) => {
                      const selected = exceptionForm.studentId === s._id;
                      return (
                        <li key={s._id}>
                          <button
                            type="button"
                            className={
                              selected
                                ? "flex w-full items-start gap-2 px-3 py-2 text-left text-sm bg-brand-50"
                                : "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                            }
                            onClick={() =>
                              setExceptionForm((c) => ({
                                ...c,
                                studentId: s._id,
                              }))
                            }
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">
                                {s.user?.fullName ?? "Student"}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {[
                                  s.admissionNumber,
                                  s.rollNumber != null
                                    ? `Roll ${s.rollNumber}`
                                    : "",
                                  s.batchName,
                                  s.yearName,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            {selected ? (
                              <Badge className="bg-brand-100 text-brand-800">
                                Selected
                              </Badge>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {filteredStudentsAll.length > 80 ? (
                <p className="text-xs text-slate-500">
                  Showing first 80 of {filteredStudentsAll.length}. Narrow batch,
                  year, or search.
                </p>
              ) : filteredStudents.length > 0 ? (
                <p className="text-xs text-slate-500">
                  {filteredStudents.length} student
                  {filteredStudents.length === 1 ? "" : "s"} shown
                  {exceptionForm.studentId ? " · student selected" : ""}
                </p>
              ) : null}
              <FormField label="Reason *">
                <Input
                  value={exceptionForm.reason}
                  onChange={(e) =>
                    setExceptionForm((c) => ({ ...c, reason: e.target.value }))
                  }
                  placeholder="e.g. Research project, exam preparation"
                />
              </FormField>
              <div className="grid min-w-0 gap-4 md:grid-cols-2">
                <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                  <FormField label="Effective from *">
                    <DualBsAdDateField
                      valueBs={exceptionForm.effectiveFromBs}
                      onChangeBs={(v) =>
                        setExceptionForm((c) => ({
                          ...c,
                          effectiveFromBs: v,
                        }))
                      }
                    />
                  </FormField>
                </div>
                <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                  <FormField label="Effective until (optional)">
                    <DualBsAdDateField
                      valueBs={exceptionForm.effectiveUntilBs}
                      onChangeBs={(v) =>
                        setExceptionForm((c) => ({
                          ...c,
                          effectiveUntilBs: v,
                        }))
                      }
                    />
                  </FormField>
                  <p className="mt-1 text-xs text-slate-500">
                    Leave empty for open-ended exception.
                  </p>
                </div>
              </div>
              <FormField label="Remarks (optional)">
                <Textarea
                  rows={2}
                  value={exceptionForm.remarks}
                  onChange={(e) =>
                    setExceptionForm((c) => ({
                      ...c,
                      remarks: e.target.value,
                    }))
                  }
                />
              </FormField>
              <Button
                type="button"
                disabled={
                  createException.isPending ||
                  !exceptionForm.studentId ||
                  !exceptionForm.reason.trim() ||
                  exceptionForm.additionalBooks === "" ||
                  Number(exceptionForm.additionalBooks) < 1
                }
                onClick={() => {
                  if (
                    exceptionForm.additionalBooks === "" ||
                    Number(exceptionForm.additionalBooks) < 1
                  ) {
                    toast.error("Enter additional books (1–20)");
                    return;
                  }
                  createException.mutate({
                    studentId: exceptionForm.studentId,
                    additionalBooks: Number(exceptionForm.additionalBooks),
                    reason: exceptionForm.reason.trim(),
                    effectiveFromBs: exceptionForm.effectiveFromBs,
                    effectiveUntilBs:
                      exceptionForm.effectiveUntilBs || undefined,
                    remarks: exceptionForm.remarks.trim() || undefined,
                  });
                }}
              >
                {createException.isPending ? "Saving…" : "Grant exception"}
              </Button>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(e) => setIncludeRevoked(e.target.checked)}
            />
            Show revoked exceptions
          </label>

          {exceptionsQuery.isLoading ? (
            <LoadingState />
          ) : exceptions.length === 0 ? (
            <EmptyState
              title="No exceptions"
              description="Grant an exception when a student needs more books than the year limit."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Extra books</Th>
                    <Th>Reason</Th>
                    <Th>Effective</Th>
                    <Th>Status</Th>
                    <Th>By</Th>
                    {canManage ? <Th className="text-right">Actions</Th> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {exceptions.map((row) => (
                    <tr key={row._id}>
                      <Td>
                        <StudentNameLink
                          studentId={row.studentId}
                          name={row.studentName || "Student"}
                          subtitle={[row.admissionNumber, row.batchName, row.yearName]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      </Td>
                      <Td className="font-semibold text-brand-700">
                        +{row.additionalBooks}
                      </Td>
                      <Td className="max-w-[12rem] text-sm">
                        {row.reason}
                        {row.remarks ? (
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {row.remarks}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        {row.effectiveFromBs}
                        {row.effectiveUntilBs
                          ? ` → ${row.effectiveUntilBs}`
                          : " → open"}
                      </Td>
                      <Td>
                        {row.isRevoked ? (
                          <Badge className="bg-slate-200 text-slate-700">
                            Revoked
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Active
                          </Badge>
                        )}
                      </Td>
                      <Td className="text-xs text-slate-500">
                        {row.createdByName || "—"}
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          {!row.isRevoked ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={revokeException.isPending}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Revoke +${row.additionalBooks} exception for ${row.studentName ?? "this student"}?`,
                                  )
                                ) {
                                  return;
                                }
                                revokeException.mutate(row._id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            "—"
                          )}
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
    </div>
  );
};

/** Compact borrow status banner for the Issue Books screen. */
export const StudentBorrowStatusBanner = ({
  studentId,
}: {
  studentId: string;
}) => {
  const statusQuery = useQuery({
    queryKey: ["library-borrow-status", studentId],
    queryFn: () =>
      unwrap<LibraryStudentBorrowStatus>(
        api.get(`/library/students/${studentId}/borrow-status`),
      ),
    enabled: Boolean(studentId),
  });

  if (!studentId) return null;
  if (statusQuery.isLoading) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Checking borrow limit…
      </p>
    );
  }
  if (statusQuery.isError || !statusQuery.data) return null;

  const s = statusQuery.data;
  const ratio = `${s.issuedCount} / ${s.maxAllowed}`;
  const atLimit = s.limitReached;

  return (
    <div
      className={
        atLimit
          ? "rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          : s.hasActiveException
            ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            : "rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Books issued: {ratio}</span>
        {s.hasActiveException ? (
          <Badge className="bg-amber-100 text-amber-900">
            Exception applied (+{s.exceptionAdditional})
          </Badge>
        ) : null}
        {s.yearName ? (
          <span className="text-xs opacity-80">
            Year default: {s.yearDefaultLimit} ({s.yearName})
          </span>
        ) : null}
      </div>
      {atLimit && s.message ? (
        <p className="mt-1 text-xs font-medium">{s.message}</p>
      ) : (
        <p className="mt-1 text-xs opacity-80">
          {s.remaining} more book{s.remaining === 1 ? "" : "s"} may be issued.
        </p>
      )}
    </div>
  );
};
