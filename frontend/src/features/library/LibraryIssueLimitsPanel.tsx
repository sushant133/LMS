import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LIBRARY_BORROWER_TYPES,
  LIBRARY_ISSUE_LIMIT_YEAR_LEVELS,
  defaultLibraryIssueStaffLimits,
  libraryBorrowerTypeLabel,
  type LibraryBorrowStatus,
  type LibraryBorrowerType,
  type LibraryIssueLimitConfigRecord,
  type LibraryIssueLimitExceptionRecord,
  type LibraryIssueStaffLimits,
  type LibraryIssueYearLimits,
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
import { cn, parseErrorMessage } from "lib/utils";
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

type TeacherRow = {
  _id: string;
  user?: { fullName?: string } | null;
};

type StaffRow = {
  _id: string;
  staffId?: string;
  fullName: string;
  designation?: string;
  department?: string;
};

type ScopeOption = {
  _id: string;
  name: string;
  batchId?: string;
};

/** One row in the borrower picker, whatever the borrower kind. */
type BorrowerOption = {
  _id: string;
  name: string;
  subtitle: string;
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
type StaffLimitsDraft = Record<"TEACHER" | "STAFF", number | "">;

const toLimitsDraft = (limits: LibraryIssueYearLimits): LimitsDraft => ({
  "1st Year": limits["1st Year"],
  "2nd Year": limits["2nd Year"],
  "3rd Year": limits["3rd Year"],
});

/** Configs saved before teacher/staff limits existed come back without them. */
const toStaffLimitsDraft = (
  limits: LibraryIssueStaffLimits | undefined,
): StaffLimitsDraft => {
  const base = limits ?? defaultLibraryIssueStaffLimits();
  return { TEACHER: base.TEACHER, STAFF: base.STAFF };
};

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

const finalizeStaffLimitsDraft = (
  draft: StaffLimitsDraft,
): LibraryIssueStaffLimits | null => {
  const out = {} as LibraryIssueStaffLimits;
  for (const key of ["TEACHER", "STAFF"] as const) {
    const raw = draft[key];
    if (raw === "" || raw === undefined || raw === null || Number.isNaN(Number(raw))) {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 50) return null;
    out[key] = Math.floor(n);
  }
  return out;
};

export const LibraryIssueLimitsPanel = ({
  canManage,
}: LibraryIssueLimitsPanelProps) => {
  const [limitsDraft, setLimitsDraft] = useState<LimitsDraft | null>(null);
  const [staffDraft, setStaffDraft] = useState<StaffLimitsDraft | null>(null);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [borrowerType, setBorrowerType] =
    useState<LibraryBorrowerType>("STUDENT");
  const [exceptionForm, setExceptionForm] = useState({
    borrowerId: "",
    additionalBooks: 1 as number | "",
    reason: "",
    effectiveFromBs: formatTodayBs(),
    effectiveUntilBs: "",
    remarks: "",
  });
  const [borrowerSearch, setBorrowerSearch] = useState("");
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

  const formOpen = canManage && showExceptionForm;

  const studentsQuery = useQuery({
    queryKey: ["students", "library-issue-limits"],
    queryFn: () =>
      unwrap<IssueStudentRow[]>(
        api.get("/students", { params: { loginActive: "1" } }),
      ),
    enabled: formOpen && borrowerType === "STUDENT",
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers", "library-issue-limits"],
    queryFn: () => unwrap<TeacherRow[]>(api.get("/teachers")),
    enabled: formOpen && borrowerType === "TEACHER",
  });

  const staffQuery = useQuery({
    queryKey: ["library-borrowers-staff", "library-issue-limits"],
    queryFn: () => unwrap<StaffRow[]>(api.get("/library/borrowers/staff")),
    enabled: formOpen && borrowerType === "STAFF",
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/batches")),
    enabled: formOpen && borrowerType === "STUDENT",
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/years")),
    enabled: formOpen && borrowerType === "STUDENT",
  });

  const limits: LimitsDraft | null = limitsDraft
    ? limitsDraft
    : limitsQuery.data?.limits
      ? toLimitsDraft(limitsQuery.data.limits)
      : null;

  const staffLimits: StaffLimitsDraft | null = staffDraft
    ? staffDraft
    : limitsQuery.data
      ? toStaffLimitsDraft(limitsQuery.data.staffLimits)
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

  /** Borrower list for the active tab, already filtered and sorted. */
  const borrowerOptionsAll = useMemo<BorrowerOption[]>(() => {
    const q = borrowerSearch.trim().toLowerCase();

    if (borrowerType === "TEACHER") {
      return (teachersQuery.data ?? [])
        .map((t) => ({
          _id: t._id,
          name: t.user?.fullName ?? "Teacher",
          subtitle: "Teacher",
        }))
        .filter((row) => !q || row.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (borrowerType === "STAFF") {
      return (staffQuery.data ?? [])
        .map((s) => ({
          _id: s._id,
          name: s.fullName,
          subtitle: [s.staffId, s.designation, s.department]
            .filter(Boolean)
            .join(" · "),
        }))
        .filter(
          (row) =>
            !q ||
            row.name.toLowerCase().includes(q) ||
            row.subtitle.toLowerCase().includes(q),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    }

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
      .map((s) => ({
        _id: s._id,
        name: s.user?.fullName ?? "Student",
        subtitle: [
          s.admissionNumber,
          s.rollNumber != null ? `Roll ${s.rollNumber}` : "",
          s.batchName,
          s.yearName,
        ]
          .filter(Boolean)
          .join(" · "),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    borrowerType,
    borrowerSearch,
    studentsQuery.data,
    teachersQuery.data,
    staffQuery.data,
    filterBatchId,
    filterYearId,
  ]);

  const borrowerOptions = useMemo(
    () => borrowerOptionsAll.slice(0, 80),
    [borrowerOptionsAll],
  );

  const borrowersLoading =
    borrowerType === "STUDENT"
      ? studentsQuery.isLoading || batchesQuery.isLoading || yearsQuery.isLoading
      : borrowerType === "TEACHER"
        ? teachersQuery.isLoading
        : staffQuery.isLoading;

  /** Switching borrower kind clears the selection and the student-only filters. */
  useEffect(() => {
    setExceptionForm((c) => ({ ...c, borrowerId: "" }));
    setBorrowerSearch("");
    setFilterBatchId("");
    setFilterYearId("");
  }, [borrowerType]);

  const saveLimits = useMutation({
    mutationFn: (next: {
      limits: LibraryIssueYearLimits;
      staffLimits: LibraryIssueStaffLimits;
    }) => unwrap(api.put("/library/issue-limits", next)),
    onSuccess: async () => {
      toast.success("Issue limits saved");
      setLimitsDraft(null);
      setStaffDraft(null);
      await queryClient.invalidateQueries({
        queryKey: ["library-issue-limits"],
      });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createException = useMutation({
    mutationFn: (payload: {
      borrowerType: LibraryBorrowerType;
      borrowerId: string;
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
        borrowerId: "",
        additionalBooks: 1,
        reason: "",
        effectiveFromBs: formatTodayBs(),
        effectiveUntilBs: "",
        remarks: "",
      });
      setBorrowerSearch("");
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

  const yearDirty =
    Boolean(limitsDraft) &&
    Boolean(limitsQuery.data?.limits) &&
    LIBRARY_ISSUE_LIMIT_YEAR_LEVELS.some((y) => {
      const draftVal = limitsDraft?.[y];
      const saved = limitsQuery.data!.limits[y];
      if (draftVal === "" || draftVal === undefined) return true;
      return Number(draftVal) !== saved;
    });

  const staffDirty =
    Boolean(staffDraft) &&
    Boolean(limitsQuery.data) &&
    (["TEACHER", "STAFF"] as const).some((key) => {
      const draftVal = staffDraft?.[key];
      const saved = toStaffLimitsDraft(limitsQuery.data!.staffLimits)[key];
      if (draftVal === "" || draftVal === undefined) return true;
      return Number(draftVal) !== saved;
    });

  const dirty = yearDirty || staffDirty;

  const resetDrafts = () => {
    setLimitsDraft(null);
    setStaffDraft(null);
  };

  const handleSaveLimits = () => {
    if (!limitsQuery.data) return;
    const yearFinal = finalizeLimitsDraft(
      limitsDraft ?? toLimitsDraft(limitsQuery.data.limits),
    );
    const staffFinal = finalizeStaffLimitsDraft(
      staffDraft ?? toStaffLimitsDraft(limitsQuery.data.staffLimits),
    );
    if (!yearFinal || !staffFinal) {
      toast.error("Enter a valid number (0–50) for every limit before saving");
      return;
    }
    saveLimits.mutate({ limits: yearFinal, staffLimits: staffFinal });
  };

  const exceptions = exceptionsQuery.data?.records ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-brand-600" />
            Book issue limits
          </CardTitle>
          <p className="text-sm text-slate-500">
            Maximum number of books a borrower may hold at once. Students are
            limited by academic year; teachers and staff have one flat limit
            each. Active exceptions add to these defaults.
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
          ) : limits && staffLimits ? (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Students — by academic year
                </p>
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
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Teachers and staff
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["TEACHER", "STAFF"] as const).map((key) => (
                    <FormField
                      key={key}
                      label={
                        key === "TEACHER" ? "Teachers" : "College staff"
                      }
                    >
                      <NumberInput
                        min={0}
                        max={50}
                        value={staffLimits[key]}
                        disabled={!canManage || saveLimits.isPending}
                        onValueChange={(v) => {
                          const base =
                            staffDraft ??
                            toStaffLimitsDraft(limitsQuery.data!.staffLimits);
                          if (v === undefined) {
                            setStaffDraft({ ...base, [key]: "" });
                            return;
                          }
                          setStaffDraft({
                            ...base,
                            [key]: Math.max(0, Math.min(50, v)),
                          });
                        }}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Max concurrent books for{" "}
                        {key === "TEACHER" ? "each teacher" : "each staff member"}
                      </p>
                    </FormField>
                  ))}
                </div>
              </div>

              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={!dirty || saveLimits.isPending}
                    onClick={handleSaveLimits}
                  >
                    {saveLimits.isPending ? "Saving…" : "Save limits"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!dirty || saveLimits.isPending}
                    onClick={() => {
                      resetDrafts();
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
                      resetDrafts();
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
              Grant extra books to a specific student, teacher, or staff member.
              Example: default 3 + exception +2 → borrower may hold 5.
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
                  setBorrowerSearch("");
                }
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {showExceptionForm ? "Close form" : "Grant exception"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {formOpen ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap gap-2">
                {LIBRARY_BORROWER_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setBorrowerType(type)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition",
                      borrowerType === type
                        ? "border-brand-500 bg-brand-50 font-medium text-brand-800"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {libraryBorrowerTypeLabel(type)}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {borrowerType === "STUDENT" ? (
                  <>
                    <FormField label="Batch">
                      <Select
                        value={filterBatchId}
                        onChange={(e) => {
                          setFilterBatchId(e.target.value);
                          setFilterYearId("");
                          setExceptionForm((c) => ({ ...c, borrowerId: "" }));
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
                          setExceptionForm((c) => ({ ...c, borrowerId: "" }));
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
                  </>
                ) : null}
                <FormField
                  label={`Search ${libraryBorrowerTypeLabel(borrowerType).toLowerCase()}`}
                >
                  <Input
                    value={borrowerSearch}
                    onChange={(e) => setBorrowerSearch(e.target.value)}
                    placeholder={
                      borrowerType === "STUDENT"
                        ? "Name, roll, admission…"
                        : borrowerType === "TEACHER"
                          ? "Teacher name"
                          : "Name, staff ID, designation…"
                    }
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
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {borrowersLoading ? (
                  <p className="p-3 text-sm text-slate-500">
                    Loading {libraryBorrowerTypeLabel(borrowerType).toLowerCase()}…
                  </p>
                ) : borrowerOptions.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">
                    No {libraryBorrowerTypeLabel(borrowerType).toLowerCase()}{" "}
                    matches the current filters.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {borrowerOptions.map((row) => {
                      const selected = exceptionForm.borrowerId === row._id;
                      return (
                        <li key={row._id}>
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
                                borrowerId: row._id,
                              }))
                            }
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{row.name}</span>
                              {row.subtitle ? (
                                <span className="block text-xs text-slate-500">
                                  {row.subtitle}
                                </span>
                              ) : null}
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
              {borrowerOptionsAll.length > 80 ? (
                <p className="text-xs text-slate-500">
                  Showing first 80 of {borrowerOptionsAll.length}. Narrow the
                  filters or search.
                </p>
              ) : borrowerOptions.length > 0 ? (
                <p className="text-xs text-slate-500">
                  {borrowerOptions.length} shown
                  {exceptionForm.borrowerId ? " · borrower selected" : ""}
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
                  !exceptionForm.borrowerId ||
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
                    borrowerType,
                    borrowerId: exceptionForm.borrowerId,
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
              description="Grant an exception when a borrower needs more books than their default limit."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Borrower</Th>
                    <Th>Type</Th>
                    <Th>Extra books</Th>
                    <Th>Reason</Th>
                    <Th>Effective</Th>
                    <Th>Status</Th>
                    <Th>By</Th>
                    {canManage ? <Th className="text-right">Actions</Th> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {exceptions.map((row) => {
                    const subtitle =
                      row.borrowerType === "STUDENT"
                        ? [row.admissionNumber, row.batchName, row.yearName]
                            .filter(Boolean)
                            .join(" · ")
                        : [row.staffCode, row.designation, row.department]
                            .filter(Boolean)
                            .join(" · ");
                    const name =
                      row.borrowerName ||
                      row.studentName ||
                      libraryBorrowerTypeLabel(row.borrowerType);
                    return (
                      <tr key={row._id}>
                        <Td>
                          {row.borrowerType === "STUDENT" && row.studentId ? (
                            <StudentNameLink
                              studentId={row.studentId}
                              name={name}
                              subtitle={subtitle}
                            />
                          ) : (
                            <div>
                              <span className="font-medium">{name}</span>
                              {subtitle ? (
                                <span className="block text-xs text-slate-500">
                                  {subtitle}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <Badge
                            className={
                              row.borrowerType === "STUDENT"
                                ? "bg-slate-100 text-slate-700"
                                : row.borrowerType === "TEACHER"
                                  ? "bg-indigo-100 text-indigo-800"
                                  : "bg-teal-100 text-teal-800"
                            }
                          >
                            {libraryBorrowerTypeLabel(row.borrowerType)}
                          </Badge>
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
                                      `Revoke +${row.additionalBooks} exception for ${name}?`,
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
                    );
                  })}
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
export const BorrowStatusBanner = ({
  borrowerType,
  borrowerId,
}: {
  borrowerType: LibraryBorrowerType;
  borrowerId: string;
}) => {
  const statusQuery = useQuery({
    queryKey: ["library-borrow-status", borrowerType, borrowerId],
    queryFn: () =>
      unwrap<LibraryBorrowStatus>(
        api.get(`/library/borrow-status/${borrowerType}/${borrowerId}`),
      ),
    enabled: Boolean(borrowerId),
  });

  if (!borrowerId) return null;
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
        <span className="text-xs opacity-80">
          {s.borrowerType === "STUDENT"
            ? `Year default: ${s.yearDefaultLimit}${s.yearName ? ` (${s.yearName})` : ""}`
            : `${libraryBorrowerTypeLabel(s.borrowerType)} default: ${s.yearDefaultLimit}`}
        </span>
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

/** Student-only shorthand kept for existing call sites. */
export const StudentBorrowStatusBanner = ({
  studentId,
}: {
  studentId: string;
}) => <BorrowStatusBanner borrowerType="STUDENT" borrowerId={studentId} />;
