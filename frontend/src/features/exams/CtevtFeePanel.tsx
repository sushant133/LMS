import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  BatchRecord,
  ModuleAccessMap,
  StudentRecord,
  YearRecord,
} from "@phit-erp/shared";
import {
  canAccessExaminationCtevt,
  canWriteExaminationCtevt,
  isSystemAdministrator,
} from "@phit-erp/shared";
import {
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Search,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { useAuth } from "features/auth/AuthProvider";
import {
  useHasInstitutionAccess,
  useIsTenantAdmin,
} from "hooks/useNormalizedRole";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

export type CtevtFeeKind = "registration" | "exam";

type FeeStatus = "PAID" | "NOT_PAID";
/** CLEAR = remove Paid/Not Paid so the student looks unmarked again. */
type PendingFeeAction = FeeStatus | "CLEAR";
type FeeFilter = "" | FeeStatus;
/** null = not marked yet (show blank in list). */
type FeeStatusOrBlank = FeeStatus | null;

const FEE_CONFIG: Record<
  CtevtFeeKind,
  {
    title: string;
    shortLabel: string;
    apiPath: string;
    getStatus: (s: StudentRecord) => FeeStatusOrBlank;
  }
> = {
  registration: {
    title: "Registration fee",
    shortLabel: "Registration fee",
    apiPath: "/students/ctevt-registration-fee",
    getStatus: (s) => {
      if (s.ctevtRegistrationFeeStatus === "PAID") return "PAID";
      if (s.ctevtRegistrationFeeStatus === "NOT_PAID") return "NOT_PAID";
      return null;
    },
  },
  exam: {
    title: "Exam fee",
    shortLabel: "Exam fee",
    apiPath: "/students/ctevt-exam-fee",
    getStatus: (s) => {
      if (s.ctevtExamFeeStatus === "PAID") return "PAID";
      if (s.ctevtExamFeeStatus === "NOT_PAID") return "NOT_PAID";
      return null;
    },
  },
};

const feeBadgeClass = (status: FeeStatus) =>
  status === "PAID"
    ? "border-emerald-700 bg-emerald-600 text-white shadow-sm"
    : "border-rose-700 bg-rose-600 text-white shadow-sm";

interface CtevtFeePanelProps {
  feeKind: CtevtFeeKind;
}

/**
 * CTEVT Registration / Exam fee desk:
 * filter students by batch/year; left list + right Paid / Not Paid / Clear.
 */
export const CtevtFeePanel = ({ feeKind }: CtevtFeePanelProps) => {
  const config = FEE_CONFIG[feeKind];
  const { user } = useAuth();
  const isTenantAdmin = useIsTenantAdmin();
  const hasInstitutionRead = useHasInstitutionAccess();
  const isSuperAdmin = isSystemAdministrator(user?.role ?? "");
  const moduleAccessMap = (user?.moduleAccess ?? {}) as ModuleAccessMap;
  const moduleAccessConfigured = Boolean(user?.moduleAccessConfigured);

  /** Super Admin / unconfigured admin: full write. Configured matrix: examinations-ctevt WRITE. */
  const canManage =
    isSuperAdmin ||
    (!moduleAccessConfigured && isTenantAdmin) ||
    canWriteExaminationCtevt(moduleAccessMap);

  const canLoadRoster =
    isSuperAdmin ||
    hasInstitutionRead ||
    !moduleAccessConfigured ||
    canAccessExaminationCtevt(moduleAccessMap);

  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [feeFilter, setFeeFilter] = useState<FeeFilter>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingFeeAction | null>(
    null,
  );

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: canLoadRoster,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: canLoadRoster,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: canLoadRoster,
  });

  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];
  const students = studentsQuery.data ?? [];

  const yearsForBatch = useMemo(
    () => filterYearsByBatch(years, batchFilter),
    [batchFilter, years],
  );

  const batchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) map.set(b._id, b.name);
    return map;
  }, [batches]);

  const yearNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const y of years) map.set(y._id, y.name);
    return map;
  }, [years]);

  const feeStatusOf = config.getStatus;

  const activeStudents = useMemo(
    () =>
      students.filter((s) => {
        const status = s.academicStatus ?? "ACTIVE";
        return status === "ACTIVE" || status === "PENDING_NOT_PASSED";
      }),
    [students],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeStudents
      .filter((s) => {
        if (batchFilter && s.batchId !== batchFilter) return false;
        if (yearFilter && s.yearId !== yearFilter) return false;
        if (feeFilter && feeStatusOf(s) !== feeFilter) return false;
        if (!q) return true;
        const name = (s.user?.fullName ?? "").toLowerCase();
        const adm = (s.admissionNumber ?? "").toLowerCase();
        const reg = (s.registrationNumber ?? "").toLowerCase();
        const roll = String(s.rollNumber ?? "");
        return (
          name.includes(q) ||
          adm.includes(q) ||
          reg.includes(q) ||
          roll.includes(q)
        );
      })
      .sort((a, b) => {
        const nameA = (a.user?.fullName ?? "").toLowerCase();
        const nameB = (b.user?.fullName ?? "").toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return (a.rollNumber ?? 0) - (b.rollNumber ?? 0);
      });
  }, [activeStudents, batchFilter, yearFilter, feeFilter, search, feeStatusOf]);

  const counts = useMemo(() => {
    let paid = 0;
    let notPaid = 0;
    for (const s of filtered) {
      const st = feeStatusOf(s);
      if (st === "PAID") paid += 1;
      else if (st === "NOT_PAID") notPaid += 1;
    }
    return { total: filtered.length, paid, notPaid };
  }, [filtered, feeStatusOf]);

  const selectedStudents = useMemo(
    () => filtered.filter((s) => selectedIds.includes(s._id)),
    [filtered, selectedIds],
  );

  const primarySelected = selectedStudents[0] ?? null;

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      studentIds: string[];
      action: PendingFeeAction;
    }) =>
      unwrap(
        api.patch(config.apiPath, {
          studentIds: payload.studentIds,
          status: payload.action === "CLEAR" ? "CLEAR" : payload.action,
        }),
      ),
    onSuccess: async (_data, vars) => {
      const n = vars.studentIds.length;
      const feeName = config.shortLabel;
      if (vars.action === "CLEAR") {
        toast.success(
          n === 1
            ? `${feeName} status cleared`
            : `Cleared ${feeName.toLowerCase()} status for ${n} students`,
        );
      } else {
        const label = vars.action === "PAID" ? "Paid" : "Not Paid";
        toast.success(
          n === 1
            ? `${feeName} marked as ${label}`
            : `Updated ${n} students — ${label}`,
        );
      }
      setPendingAction(null);
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPendingAction(null);
  };

  const selectOnly = (id: string) => {
    setSelectedIds([id]);
    setPendingAction(null);
  };

  const selectAllFiltered = () => {
    setSelectedIds(filtered.map((s) => s._id));
    setPendingAction(null);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setPendingAction(null);
  };

  const onBatchChange = (value: string) => {
    setBatchFilter(value);
    setYearFilter("");
    clearSelection();
  };

  const applyStatus = () => {
    if (!canManage) {
      toast.error("You have read-only access.");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Select at least one student from the list.");
      return;
    }
    if (!pendingAction) {
      toast.error("Choose Paid, Not Paid, or Clear status on the right.");
      return;
    }
    saveMutation.mutate({ studentIds: selectedIds, action: pendingAction });
  };

  if (studentsQuery.isLoading || batchesQuery.isLoading || yearsQuery.isLoading) {
    return <LoadingState />;
  }

  if (studentsQuery.isError) {
    return (
      <EmptyState
        title="Could not load students"
        description={parseErrorMessage(studentsQuery.error)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Students
              </p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {counts.total}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-100 bg-emerald-50/40 shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700/80">
                Fee Paid
              </p>
              <p className="text-2xl font-semibold tabular-nums text-emerald-900">
                {counts.paid}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-100 bg-amber-50/40 shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-800/80">
                Not Paid
              </p>
              <p className="text-2xl font-semibold tabular-nums text-amber-950">
                {counts.notPaid}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Batch</span>
            <Select
              value={batchFilter}
              onChange={(e) => onBatchChange(e.target.value)}
            >
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Year</span>
            <Select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                clearSelection();
              }}
              disabled={!batchFilter && yearsForBatch.length === 0}
            >
              <option value="">All years</option>
              {(batchFilter ? yearsForBatch : years).map((y) => (
                <option key={y._id} value={y._id}>
                  {y.name}
                  {!batchFilter && y.batchId
                    ? ` (${batchNameById.get(y.batchId) ?? "—"})`
                    : ""}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Fee status</span>
            <Select
              value={feeFilter}
              onChange={(e) => {
                setFeeFilter(e.target.value as FeeFilter);
                clearSelection();
              }}
            >
              <option value="">All</option>
              <option value="PAID">Paid</option>
              <option value="NOT_PAID">Not Paid</option>
            </Select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Name, admission no., roll…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </label>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-slate-100 bg-slate-50/70 py-3">
            <div>
              <CardTitle className="text-base">Student list</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                Select one or more students, then set fee status on the right.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={selectAllFiltered}
                disabled={filtered.length === 0}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearSelection}
                disabled={selectedIds.length === 0}
              >
                <X className="mr-1 h-4 w-4" />
                Clear selection
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No students match"
                  description="Try another batch, year, fee status, or search term."
                />
              </div>
            ) : (
              <ul className="max-h-[min(32rem,70vh)] divide-y divide-slate-100 overflow-y-auto">
                {filtered.map((student) => {
                  const status = feeStatusOf(student);
                  const selected = selectedIds.includes(student._id);
                  const batchLabel =
                    student.batchName ||
                    (student.batchId
                      ? batchNameById.get(student.batchId)
                      : undefined) ||
                    "—";
                  const yearLabel =
                    student.yearName ||
                    (student.yearId
                      ? yearNameById.get(student.yearId)
                      : undefined) ||
                    "—";

                  return (
                    <li key={student._id}>
                      <button
                        type="button"
                        onClick={() => selectOnly(student._id)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                          selected
                            ? "bg-brand-50/80 ring-inset ring-1 ring-brand-200"
                            : "hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={selected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelect(student._id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${student.user?.fullName ?? "student"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-semibold text-slate-900">
                              {student.user?.fullName || "Unnamed student"}
                            </span>
                            {status ? (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center rounded-md border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
                                  feeBadgeClass(status),
                                )}
                              >
                                {status === "PAID" ? "Paid" : "Not Paid"}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            Adm: {student.admissionNumber || "—"}
                            {student.rollNumber
                              ? ` · Roll: ${student.rollNumber}`
                              : ""}
                            {student.registrationNumber
                              ? ` · Reg: ${student.registrationNumber}`
                              : ""}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {batchLabel} · {yearLabel}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit border-slate-200 shadow-sm lg:sticky lg:top-4">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-brand-50/80 to-white py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <CircleDollarSign className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">{config.title}</CardTitle>
                <p className="text-xs text-slate-500">
                  Mark Paid / Not Paid, or clear status back to blank
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {selectedIds.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center">
                <Banknote className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">
                  No student selected
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Click a student on the left (or use checkboxes for multiple).
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {selectedIds.length === 1 && primarySelected ? (
                        <>
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Selected student
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {primarySelected.user?.fullName || "Unnamed"}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {primarySelected.admissionNumber}
                            {primarySelected.rollNumber
                              ? ` · Roll ${primarySelected.rollNumber}`
                              : ""}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Current status:{" "}
                            {(() => {
                              const st = feeStatusOf(primarySelected);
                              if (st === "PAID") {
                                return (
                                  <span className="font-bold text-emerald-700">
                                    Paid
                                  </span>
                                );
                              }
                              if (st === "NOT_PAID") {
                                return (
                                  <span className="font-bold text-rose-700">
                                    Not Paid
                                  </span>
                                );
                              }
                              return (
                                <span className="font-medium text-slate-400">
                                  Not set
                                </span>
                              );
                            })()}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Selection
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {selectedIds.length} students
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Status will apply to all selected students.
                          </p>
                          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-600">
                            {selectedStudents.slice(0, 12).map((s) => (
                              <li key={s._id} className="truncate">
                                · {s.user?.fullName || s.admissionNumber}
                              </li>
                            ))}
                            {selectedStudents.length > 12 ? (
                              <li className="text-slate-400">
                                +{selectedStudents.length - 12} more…
                              </li>
                            ) : null}
                          </ul>
                        </>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-slate-300 text-slate-700 hover:bg-slate-100"
                      onClick={clearSelection}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  <button
                    type="button"
                    disabled={!canManage || saveMutation.isPending}
                    onClick={() => setPendingAction("PAID")}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all",
                      pendingAction === "PAID"
                        ? "border-emerald-500 bg-emerald-50 shadow-md ring-2 ring-emerald-200"
                        : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40",
                      (!canManage || saveMutation.isPending) &&
                        "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl",
                        pendingAction === "PAID"
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-100 text-emerald-700",
                      )}
                    >
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900">
                        Paid
                      </p>
                      <p className="text-xs text-slate-500">
                        {config.shortLabel} has been received
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!canManage || saveMutation.isPending}
                    onClick={() => setPendingAction("NOT_PAID")}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all",
                      pendingAction === "NOT_PAID"
                        ? "border-rose-500 bg-rose-50 shadow-md ring-2 ring-rose-200"
                        : "border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/40",
                      (!canManage || saveMutation.isPending) &&
                        "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl",
                        pendingAction === "NOT_PAID"
                          ? "bg-rose-600 text-white"
                          : "bg-rose-100 text-rose-800",
                      )}
                    >
                      <XCircle className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900">
                        Not Paid
                      </p>
                      <p className="text-xs text-slate-500">
                        {config.shortLabel} is still outstanding
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!canManage || saveMutation.isPending}
                    onClick={() => setPendingAction("CLEAR")}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all",
                      pendingAction === "CLEAR"
                        ? "border-slate-500 bg-slate-100 shadow-md ring-2 ring-slate-300"
                        : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50",
                      (!canManage || saveMutation.isPending) &&
                        "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl",
                        pendingAction === "CLEAR"
                          ? "bg-slate-700 text-white"
                          : "bg-slate-200 text-slate-700",
                      )}
                    >
                      <X className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900">
                        Clear status
                      </p>
                      <p className="text-xs text-slate-500">
                        Remove Paid / Not Paid — leave blank as if not marked
                      </p>
                    </div>
                  </button>
                </div>

                <Button
                  type="button"
                  className="w-full bg-brand-600 py-6 text-base font-semibold hover:bg-brand-700"
                  disabled={
                    !canManage || !pendingAction || saveMutation.isPending
                  }
                  onClick={applyStatus}
                >
                  {saveMutation.isPending
                    ? "Saving…"
                    : pendingAction === "CLEAR"
                      ? "Clear fee status"
                      : pendingAction === "PAID"
                        ? "Save as Paid"
                        : pendingAction === "NOT_PAID"
                          ? "Save as Not Paid"
                          : "Choose Paid, Not Paid, or Clear"}
                </Button>

                {!canManage ? (
                  <p className="text-center text-xs text-slate-500">
                    Read-only access — status changes require admin permission.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
