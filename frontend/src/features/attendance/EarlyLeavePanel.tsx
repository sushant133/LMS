import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { canManageInstitution, type StudentRecord } from "@phit-erp/shared";

/** Local copy so the panel loads even if shared package cache is stale. */
const EARLY_LEAVE_REASON_SUGGESTIONS = [
  "Stomachache",
  "Fever",
  "Family emergency",
  "Personal reason",
  "Medical appointment",
  "Application Leave",
  "Other",
] as const;

const APPLICATION_LEAVE_REASON = "Application Leave";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { LogOut, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { DualBsAdDateField } from "components/shared/NepaliDateField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { useIsCollege } from "hooks/useInstitutionType";
import {
  filterSectionsByClass,
  filterYearsByBatch,
  getAcademicLabels,
} from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

type ScopeOption = {
  _id: string;
  name: string;
  batchId?: string;
  classId?: string;
  level?: number;
};

type EarlyLeaveRecord = {
  _id: string;
  dateBs: string;
  periodKind: string;
  leftAfterPeriod?: number | null;
  periodLabel: string;
  reason: string;
  applicationReason?: string;
  leaveDateMode?: "EXACT" | "RANGE" | "";
  leaveFromDateBs?: string;
  leaveToDateBs?: string;
  approvedBy?: string;
  remarks?: string;
  leftAtTime?: string;
  studentName?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  createdByName?: string;
  studentId?:
    | string
    | {
        _id: string;
        admissionNumber?: string;
        rollNumber?: number;
        user?: { fullName?: string };
      };
};

const formatTodayBs = (): string => {
  const t = getTodayBs();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

const emptyForm = () => ({
  dateBs: formatTodayBs(),
  studentId: "",
  batchId: "",
  yearId: "",
  classId: "",
  sectionId: "",
  periodKind: "AFTER_PERIOD" as "AFTER_PERIOD" | "DURING_BREAK" | "OTHER",
  leftAfterPeriod: 2,
  periodLabel: "",
  reason: "",
  reasonCustom: "",
  /** Optional details when reason is Application Leave. */
  applicationReason: "",
  /** EXACT = single leave date; RANGE = from–to. */
  leaveDateMode: "EXACT" as "EXACT" | "RANGE",
  leaveFromDateBs: formatTodayBs(),
  leaveToDateBs: formatTodayBs(),
  approvedBy: "",
  remarks: "",
  leftAtTime: "",
});

export const EarlyLeavePanel = () => {
  const { user } = useAuth();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const canWrite = canManageInstitution(user?.role ?? "") || user?.role === "TEACHER" || user?.role === "COLLEGE_STAFF" || user?.role === "PRINCIPAL";
  const canDelete = canManageInstitution(user?.role ?? "");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filterDate, setFilterDate] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterReason, setFilterReason] = useState("");

  const studentsQuery = useQuery({
    queryKey: ["students", "early-leave"],
    queryFn: () =>
      unwrap<StudentRecord[]>(
        api.get("/students", { params: { loginActive: "1" } }),
      ),
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/batches")),
    enabled: isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/years")),
    enabled: isCollege,
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/classes")),
    enabled: !isCollege,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/sections")),
    enabled: !isCollege,
  });

  const listParams = useMemo(() => {
    const p: Record<string, string> = { limit: "300" };
    if (filterDate) p.dateBs = filterDate;
    else {
      if (filterFrom) p.fromDateBs = filterFrom;
      if (filterTo) p.toDateBs = filterTo;
    }
    if (filterStudent) p.studentId = filterStudent;
    if (filterBatch) p.batchId = filterBatch;
    if (filterYear) p.yearId = filterYear;
    if (filterClass) p.classId = filterClass;
    if (filterSection) p.sectionId = filterSection;
    if (filterReason.trim()) p.reason = filterReason.trim();
    return p;
  }, [
    filterDate,
    filterFrom,
    filterTo,
    filterStudent,
    filterBatch,
    filterYear,
    filterClass,
    filterSection,
    filterReason,
  ]);

  const listQuery = useQuery({
    queryKey: ["student-early-leave", listParams],
    queryFn: () =>
      unwrap<{ records: EarlyLeaveRecord[]; total: number }>(
        api.get("/student-early-leave", { params: listParams }),
      ),
  });

  const students = studentsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];

  /** Students for the record form (scoped by batch/year or class/section). */
  const filteredStudents = useMemo(() => {
    let list = students;
    if (isCollege) {
      if (form.batchId) list = list.filter((s) => s.batchId === form.batchId);
      if (form.yearId) list = list.filter((s) => s.yearId === form.yearId);
    } else {
      if (form.classId) list = list.filter((s) => s.classId === form.classId);
      if (form.sectionId)
        list = list.filter((s) => s.sectionId === form.sectionId);
    }
    return list;
  }, [students, form.batchId, form.yearId, form.classId, form.sectionId, isCollege]);

  /** Years for the form — only years of the selected batch (avoids many "1st Year" rows). */
  const yearsForFormBatch = useMemo(() => {
    if (!form.batchId) return [] as ScopeOption[];
    return filterYearsByBatch(years, form.batchId).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [years, form.batchId]);

  const sectionsForFormClass = useMemo(() => {
    if (!form.classId) return [] as ScopeOption[];
    return filterSectionsByClass(sections, form.classId);
  }, [sections, form.classId]);

  /** Years for list filters — depend on filter batch. */
  const yearsForFilterBatch = useMemo(() => {
    if (!filterBatch) return [] as ScopeOption[];
    return filterYearsByBatch(years, filterBatch).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [years, filterBatch]);

  const sectionsForFilterClass = useMemo(() => {
    if (!filterClass) return [] as ScopeOption[];
    return filterSectionsByClass(sections, filterClass);
  }, [sections, filterClass]);

  /** Students dropdown in filters — after batch/year (or class/section). */
  const studentsForFilter = useMemo(() => {
    let list = students;
    if (isCollege) {
      if (filterBatch) list = list.filter((s) => s.batchId === filterBatch);
      if (filterYear) list = list.filter((s) => s.yearId === filterYear);
    } else {
      if (filterClass) list = list.filter((s) => s.classId === filterClass);
      if (filterSection)
        list = list.filter((s) => s.sectionId === filterSection);
    }
    return list.slice().sort((a, b) =>
      (a.user?.fullName ?? "").localeCompare(b.user?.fullName ?? ""),
    );
  }, [
    students,
    isCollege,
    filterBatch,
    filterYear,
    filterClass,
    filterSection,
  ]);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      unwrap(api.post("/student-early-leave", payload)),
    onSuccess: async (_data, variables) => {
      const isApp =
        String(variables.reason ?? "")
          .toLowerCase() === APPLICATION_LEAVE_REASON.toLowerCase();
      const range =
        isApp &&
        variables.leaveDateMode === "RANGE" &&
        variables.leaveToDateBs &&
        variables.leaveToDateBs !== variables.dateBs;
      toast.success(
        range
          ? "Application leave recorded for the date range — parents notified"
          : isApp
            ? "Application leave recorded — parents notified"
            : "Early leave recorded — parents notified",
      );
      setForm(emptyForm());
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey: ["student-early-leave"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/student-early-leave/${id}`)),
    onSuccess: async () => {
      toast.success("Early leave record deleted");
      await queryClient.invalidateQueries({ queryKey: ["student-early-leave"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const buildPeriodLabel = (): string => {
    if (form.periodLabel.trim()) return form.periodLabel.trim();
    if (form.periodKind === "DURING_BREAK") return "During break";
    if (form.periodKind === "AFTER_PERIOD") {
      return `After period ${form.leftAfterPeriod}`;
    }
    return "Early leave";
  };

  const resolvedReason =
    form.reason === "__custom__"
      ? form.reasonCustom.trim()
      : form.reason.trim();
  const isApplicationLeave =
    resolvedReason.toLowerCase() === APPLICATION_LEAVE_REASON.toLowerCase() ||
    form.reason === APPLICATION_LEAVE_REASON;

  const submit = () => {
    if (!form.studentId) {
      toast.error("Select a student");
      return;
    }
    const reason =
      form.reason === "__custom__"
        ? form.reasonCustom.trim()
        : form.reason.trim();
    if (!reason) {
      toast.error("Enter a reason for leaving");
      return;
    }

    const applicationLeave =
      reason.toLowerCase() === APPLICATION_LEAVE_REASON.toLowerCase();

    let dateBs = form.dateBs;
    let leaveToDateBs: string | undefined;
    let leaveDateMode: "EXACT" | "RANGE" | undefined;

    if (applicationLeave) {
      leaveDateMode = form.leaveDateMode;
      if (form.leaveDateMode === "RANGE") {
        dateBs = form.leaveFromDateBs;
        leaveToDateBs = form.leaveToDateBs;
        if (!dateBs || !leaveToDateBs) {
          toast.error("Select leave from and to dates");
          return;
        }
      } else {
        dateBs = form.leaveFromDateBs || form.dateBs;
        if (!dateBs) {
          toast.error("Select the leave date");
          return;
        }
      }
    } else if (!form.dateBs) {
      toast.error("Select a date");
      return;
    }

    if (!applicationLeave) {
      if (form.periodKind === "AFTER_PERIOD" && !form.leftAfterPeriod) {
        toast.error("Select the period after which the student left");
        return;
      }
    }

    createMutation.mutate({
      studentId: form.studentId,
      dateBs,
      periodKind: applicationLeave ? "OTHER" : form.periodKind,
      leftAfterPeriod: applicationLeave
        ? null
        : form.periodKind === "AFTER_PERIOD"
          ? form.leftAfterPeriod
          : null,
      periodLabel: applicationLeave
        ? form.periodLabel.trim() || "Application leave"
        : buildPeriodLabel(),
      reason,
      applicationReason: applicationLeave
        ? form.applicationReason.trim() || undefined
        : undefined,
      leaveDateMode: applicationLeave ? leaveDateMode : undefined,
      leaveToDateBs:
        applicationLeave && leaveDateMode === "RANGE"
          ? leaveToDateBs
          : undefined,
      approvedBy: form.approvedBy.trim() || undefined,
      remarks: form.remarks.trim() || undefined,
      leftAtTime: applicationLeave
        ? undefined
        : form.leftAtTime.trim() || undefined,
      batchId: form.batchId || undefined,
      yearId: form.yearId || undefined,
      classId: form.classId || undefined,
      sectionId: form.sectionId || undefined,
    });
  };

  const records = listQuery.data?.records ?? [];

  const resolveStudentId = (row: EarlyLeaveRecord): string | null => {
    if (!row.studentId) return null;
    if (typeof row.studentId === "string") return row.studentId;
    return row.studentId._id ?? null;
  };

  const resolveStudentName = (row: EarlyLeaveRecord): string => {
    if (row.studentName) return row.studentName;
    if (row.studentId && typeof row.studentId === "object") {
      return row.studentId.user?.fullName ?? "Student";
    }
    return "Student";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Student Early Leave
          </h2>
          <p className="text-sm text-slate-500">
            Record students who leave campus before the end of the day. Parents
            are notified automatically. Linked to that day&apos;s attendance as
            Early Leave.
          </p>
        </div>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setShowForm((v) => !v);
              if (!showForm) setForm(emptyForm());
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {showForm ? "Close form" : "Record early leave"}
          </Button>
        ) : null}
      </div>

      {showForm && canWrite ? (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base">New early leave record</CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {!isApplicationLeave ? (
              <div className="min-w-0 md:col-span-2 lg:col-span-3">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                  <FormField label="Date *">
                    <DualBsAdDateField
                      valueBs={form.dateBs}
                      onChangeBs={(v) => setForm((c) => ({ ...c, dateBs: v }))}
                    />
                  </FormField>
                </div>
              </div>
            ) : null}
            {isCollege ? (
              <>
                <FormField label={`${labels.primary} *`}>
                  <Select
                    value={form.batchId}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        batchId: e.target.value,
                        yearId: "",
                        studentId: "",
                      }))
                    }
                  >
                    <option value="">Select batch…</option>
                    {batches.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={`${labels.secondary} *`}>
                  <Select
                    value={form.yearId}
                    disabled={!form.batchId}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        yearId: e.target.value,
                        studentId: "",
                      }))
                    }
                  >
                    <option value="">
                      {form.batchId
                        ? `Select ${labels.secondary.toLowerCase()}…`
                        : `Select ${labels.primary.toLowerCase()} first`}
                    </option>
                    {yearsForFormBatch.map((y) => (
                      <option key={y._id} value={y._id}>
                        {y.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            ) : (
              <>
                <FormField label={`${labels.primary} *`}>
                  <Select
                    value={form.classId}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        classId: e.target.value,
                        sectionId: "",
                        studentId: "",
                      }))
                    }
                  >
                    <option value="">Select class…</option>
                    {classes.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={`${labels.secondary} *`}>
                  <Select
                    value={form.sectionId}
                    disabled={!form.classId}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        sectionId: e.target.value,
                        studentId: "",
                      }))
                    }
                  >
                    <option value="">
                      {form.classId
                        ? `Select ${labels.secondary.toLowerCase()}…`
                        : `Select ${labels.primary.toLowerCase()} first`}
                    </option>
                    {sectionsForFormClass.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            )}
            <FormField label="Student *">
              <Select
                value={form.studentId}
                disabled={
                  isCollege
                    ? !form.batchId || !form.yearId
                    : !form.classId || !form.sectionId
                }
                onChange={(e) => {
                  const id = e.target.value;
                  const st = students.find((s) => s._id === id);
                  setForm((c) => ({
                    ...c,
                    studentId: id,
                    batchId: st?.batchId || c.batchId,
                    yearId: st?.yearId || c.yearId,
                    classId: st?.classId || c.classId,
                    sectionId: st?.sectionId || c.sectionId,
                  }));
                }}
              >
                <option value="">
                  {isCollege
                    ? form.batchId && form.yearId
                      ? "Select student…"
                      : "Select batch & year first"
                    : form.classId && form.sectionId
                      ? "Select student…"
                      : "Select class & section first"}
                </option>
                {filteredStudents.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.user?.fullName ?? "Student"}
                    {s.admissionNumber ? ` · ${s.admissionNumber}` : ""}
                    {s.rollNumber != null ? ` · Roll ${s.rollNumber}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Reason *">
              <Select
                value={form.reason}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((c) => ({
                    ...c,
                    reason: next,
                    // Seed leave dates from the main date when switching to application leave
                    leaveFromDateBs:
                      next === APPLICATION_LEAVE_REASON
                        ? c.leaveFromDateBs || c.dateBs || formatTodayBs()
                        : c.leaveFromDateBs,
                    leaveToDateBs:
                      next === APPLICATION_LEAVE_REASON
                        ? c.leaveToDateBs || c.dateBs || formatTodayBs()
                        : c.leaveToDateBs,
                  }));
                }}
              >
                <option value="">Select reason…</option>
                {EARLY_LEAVE_REASON_SUGGESTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="__custom__">Custom reason…</option>
              </Select>
            </FormField>
            {form.reason === "__custom__" ? (
              <FormField label="Custom reason *">
                <Input
                  value={form.reasonCustom}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, reasonCustom: e.target.value }))
                  }
                  placeholder="Enter reason"
                />
              </FormField>
            ) : null}

            {isApplicationLeave ? (
              <div className="min-w-0 space-y-4 md:col-span-2 lg:col-span-3">
                <FormField label="Leave application reason (optional)">
                  <Textarea
                    value={form.applicationReason}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        applicationReason: e.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Briefly describe what the leave application is for…"
                  />
                </FormField>

                <div className="max-w-sm">
                  <FormField label="Leave dates *">
                    <Select
                      value={form.leaveDateMode}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          leaveDateMode: e.target.value as "EXACT" | "RANGE",
                        }))
                      }
                    >
                      <option value="EXACT">Exact date</option>
                      <option value="RANGE">From date – To date</option>
                    </Select>
                  </FormField>
                </div>

                {form.leaveDateMode === "EXACT" ? (
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                    <FormField label="Leave date *">
                      <DualBsAdDateField
                        valueBs={form.leaveFromDateBs}
                        onChangeBs={(v) =>
                          setForm((c) => ({
                            ...c,
                            leaveFromDateBs: v,
                            leaveToDateBs: v,
                            dateBs: v,
                          }))
                        }
                      />
                    </FormField>
                  </div>
                ) : (
                  <div className="min-w-0 space-y-4">
                    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                      <FormField label="From date *">
                        <DualBsAdDateField
                          valueBs={form.leaveFromDateBs}
                          onChangeBs={(v) =>
                            setForm((c) => ({
                              ...c,
                              leaveFromDateBs: v,
                              dateBs: v,
                            }))
                          }
                        />
                      </FormField>
                    </div>
                    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                      <FormField label="To date *">
                        <DualBsAdDateField
                          valueBs={form.leaveToDateBs}
                          onChangeBs={(v) =>
                            setForm((c) => ({
                              ...c,
                              leaveToDateBs: v,
                            }))
                          }
                        />
                      </FormField>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <FormField label="Leave point *">
                  <Select
                    value={form.periodKind}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        periodKind: e.target.value as typeof form.periodKind,
                      }))
                    }
                  >
                    <option value="AFTER_PERIOD">After a teaching period</option>
                    <option value="DURING_BREAK">During break</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </FormField>
                {form.periodKind === "AFTER_PERIOD" ? (
                  <FormField label="Left after period *">
                    <Select
                      value={String(form.leftAfterPeriod)}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          leftAfterPeriod: Number(e.target.value),
                          periodLabel:
                            c.periodLabel || `After period ${e.target.value}`,
                        }))
                      }
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          After period {n} (P{n})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}
                <FormField label="Period description">
                  <Input
                    value={form.periodLabel}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, periodLabel: e.target.value }))
                    }
                    placeholder={
                      form.periodKind === "DURING_BREAK"
                        ? "e.g. During tiffin break"
                        : "e.g. After 2nd period"
                    }
                  />
                </FormField>
                <FormField label="Leave time (optional)">
                  <Input
                    type="time"
                    value={form.leftAtTime}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, leftAtTime: e.target.value }))
                    }
                  />
                </FormField>
              </>
            )}
            <FormField label="Approved by (optional)">
              <Input
                value={form.approvedBy}
                onChange={(e) =>
                  setForm((c) => ({ ...c, approvedBy: e.target.value }))
                }
                placeholder="Teacher / admin name"
              />
            </FormField>
            <div className="md:col-span-2 lg:col-span-3">
              <FormField label="Remarks (optional)">
                <Textarea
                  value={form.remarks}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, remarks: e.target.value }))
                  }
                  rows={2}
                  placeholder="Any extra notes"
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-3">
              <Button
                type="button"
                disabled={createMutation.isPending}
                onClick={submit}
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                {createMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Filters — order: dates → batch/year (or class/section) → student → reason */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
          <p className="text-xs text-slate-500">
            Choose {labels.primary.toLowerCase()} and{" "}
            {labels.secondary.toLowerCase()} first, then student. Year list only
            shows years for the selected batch (no duplicate 1st/2nd/3rd year
            rows from other batches).
          </p>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <FormField label="Exact date (BS / AD)">
                <DualBsAdDateField
                  valueBs={filterDate}
                  onChangeBs={(v) => {
                    setFilterDate(v);
                    if (v) {
                      setFilterFrom("");
                      setFilterTo("");
                    }
                  }}
                />
              </FormField>
            </div>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <FormField label="From date (BS / AD)">
                <DualBsAdDateField
                  valueBs={filterFrom}
                  onChangeBs={(v) => {
                    setFilterFrom(v);
                    if (v) setFilterDate("");
                  }}
                />
              </FormField>
            </div>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <FormField label="To date (BS / AD)">
                <DualBsAdDateField
                  valueBs={filterTo}
                  onChangeBs={(v) => {
                    setFilterTo(v);
                    if (v) setFilterDate("");
                  }}
                />
              </FormField>
            </div>
          </div>
          {isCollege ? (
            <>
              <FormField label={labels.primary}>
                <Select
                  value={filterBatch}
                  onChange={(e) => {
                    setFilterBatch(e.target.value);
                    setFilterYear("");
                    setFilterStudent("");
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
              <FormField label={labels.secondary}>
                <Select
                  value={filterYear}
                  disabled={!filterBatch}
                  onChange={(e) => {
                    setFilterYear(e.target.value);
                    setFilterStudent("");
                  }}
                >
                  <option value="">
                    {filterBatch
                      ? `All ${labels.secondary.toLowerCase()}s`
                      : `Select ${labels.primary.toLowerCase()} first`}
                  </option>
                  {yearsForFilterBatch.map((y) => (
                    <option key={y._id} value={y._id}>
                      {y.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          ) : (
            <>
              <FormField label={labels.primary}>
                <Select
                  value={filterClass}
                  onChange={(e) => {
                    setFilterClass(e.target.value);
                    setFilterSection("");
                    setFilterStudent("");
                  }}
                >
                  <option value="">All classes</option>
                  {classes.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={labels.secondary}>
                <Select
                  value={filterSection}
                  disabled={!filterClass}
                  onChange={(e) => {
                    setFilterSection(e.target.value);
                    setFilterStudent("");
                  }}
                >
                  <option value="">
                    {filterClass
                      ? `All ${labels.secondary.toLowerCase()}s`
                      : `Select ${labels.primary.toLowerCase()} first`}
                  </option>
                  {sectionsForFilterClass.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          )}
          <FormField label="Student">
            <Select
              value={filterStudent}
              onChange={(e) => setFilterStudent(e.target.value)}
            >
              <option value="">
                {isCollege && !filterBatch
                  ? "All students (or pick batch first)"
                  : "All students"}
              </option>
              {studentsForFilter.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.user?.fullName ?? s._id}
                  {s.admissionNumber ? ` · ${s.admissionNumber}` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reason contains">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={filterReason}
                onChange={(e) => setFilterReason(e.target.value)}
                placeholder="e.g. fever"
              />
            </div>
          </FormField>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterDate("");
                setFilterFrom("");
                setFilterTo("");
                setFilterStudent("");
                setFilterBatch("");
                setFilterYear("");
                setFilterClass("");
                setFilterSection("");
                setFilterReason("");
              }}
            >
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Early leave records
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({records.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {listQuery.isLoading ? (
            <LoadingState />
          ) : records.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="No early leave records"
                description="Record an early leave when a student leaves campus before the end of the day."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Student</Th>
                    <Th>Group</Th>
                    <Th>Left after / when</Th>
                    <Th>Reason</Th>
                    <Th>Approved by</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {records.map((row) => {
                    const sid = resolveStudentId(row);
                    const name = resolveStudentName(row);
                    const group = isCollege
                      ? [row.batchName, row.yearName].filter(Boolean).join(" · ")
                      : [row.className, row.sectionName]
                          .filter(Boolean)
                          .join(" · ");
                    return (
                      <tr key={row._id}>
                        <Td className="whitespace-nowrap font-medium">
                          {row.dateBs}
                          {row.leaveDateMode === "RANGE" &&
                          row.leaveFromDateBs &&
                          row.leaveToDateBs &&
                          row.leaveFromDateBs !== row.leaveToDateBs ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              Leave: {row.leaveFromDateBs} → {row.leaveToDateBs}
                            </span>
                          ) : null}
                          {row.leftAtTime ? (
                            <span className="block text-xs text-slate-500">
                              {row.leftAtTime}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {sid ? (
                            <StudentNameLink studentId={sid} name={name} />
                          ) : (
                            name
                          )}
                        </Td>
                        <Td className="text-sm text-slate-600">
                          {group || "—"}
                        </Td>
                        <Td>
                          <Badge className="bg-amber-100 text-amber-900">
                            {row.periodLabel}
                          </Badge>
                        </Td>
                        <Td className="max-w-[14rem]">
                          <span className="font-medium">{row.reason}</span>
                          {row.applicationReason ? (
                            <span className="mt-0.5 block text-xs text-slate-600">
                              {row.applicationReason}
                            </span>
                          ) : null}
                          {row.remarks &&
                          (!row.applicationReason ||
                            !row.remarks.includes(row.applicationReason)) ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {row.remarks}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-sm text-slate-600">
                          {row.approvedBy || row.createdByName || "—"}
                        </Td>
                        <Td className="text-right">
                          {canDelete ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Delete early leave for ${name} on ${row.dateBs}?`,
                                  )
                                ) {
                                  return;
                                }
                                deleteMutation.mutate(row._id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            "—"
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
    </div>
  );
};
