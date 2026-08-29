import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type EmployeeAttendanceCategory,
  type EmployeeAttendanceDashboard,
  type EmployeeAttendanceEntryRecord,
  type EmployeeAttendanceMarkContext,
  type EmployeeAttendanceRecord,
  type EmployeeAttendanceStatus,
  type EmployeeAttendanceSelfSummary,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import * as XLSX from "xlsx";
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
import { StickyTableScroll } from "components/ui/StickyTableScroll";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { cn, parseErrorMessage } from "lib/utils";

const STATUSES: EmployeeAttendanceStatus[] = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "HALF_DAY",
  "LATE",
  "OFFICIAL_DUTY",
  "HOLIDAY",
];

/** Check-in / check-out only apply when the employee is considered on-duty. */
const STATUSES_WITH_CHECK_TIMES: ReadonlySet<EmployeeAttendanceStatus> = new Set([
  "PRESENT",
  "HALF_DAY",
  "LATE",
  "OFFICIAL_DUTY",
]);

const hasCheckTimes = (status: EmployeeAttendanceStatus | string): boolean =>
  STATUSES_WITH_CHECK_TIMES.has(status as EmployeeAttendanceStatus);

/** Unmarked rows keep their time fields open — a check-in decides the status. */
const acceptsCheckTimes = (status: EmployeeAttendanceStatus | ""): boolean =>
  status === "" || hasCheckTimes(status);

/** "09:05" for the current wall clock — used by the per-row In/Out stamps. */
const nowHm = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

const statusClass = (s: string) => {
  switch (s) {
    case "PRESENT":
    case "OFFICIAL_DUTY":
      return "bg-emerald-100 text-emerald-800";
    case "ABSENT":
      return "bg-rose-100 text-rose-800";
    case "LATE":
    case "HALF_DAY":
      return "bg-amber-100 text-amber-900";
    case "LEAVE":
      return "bg-sky-100 text-sky-800";
    case "HOLIDAY":
      return "bg-violet-100 text-violet-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const formatTodayBs = (): string => {
  const t = getTodayBs();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

interface MarkRow {
  id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  designation?: string;
  userId?: string;
  /** "" = not marked yet; the sheet starts blank and is chosen per employee. */
  status: EmployeeAttendanceStatus | "";
  checkInTime: string;
  checkOutTime: string;
  /** Periods taught — empty string when not entered (still valid to submit). */
  periodsTaught: string;
  remarks: string;
}

interface Props {
  category: EmployeeAttendanceCategory;
  canTake: boolean;
  canEdit: boolean;
  canUnlock: boolean;
  canExport: boolean;
  /** When true, only show personal read-only portal */
  selfOnly?: boolean;
}

export const EmployeeAttendancePanel = ({
  category,
  canTake,
  canEdit,
  canUnlock,
  canExport,
  selfOnly = false,
}: Props) => {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"mark" | "register" | "dashboard" | "my">(
    selfOnly ? "my" : canTake ? "mark" : "dashboard",
  );
  const [dateBs, setDateBs] = useState(formatTodayBs);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<MarkRow[]>([]);
  const [loaded, setLoaded] = useState<EmployeeAttendanceRecord | null>(null);

  const label = category === "TEACHER" ? "Teacher" : "Staff";

  const dashQuery = useQuery({
    queryKey: ["employee-attendance", "dashboard", category, dateBs],
    queryFn: () =>
      unwrap<EmployeeAttendanceDashboard>(
        api.get("/employee-attendance/dashboard", {
          params: { category, dateBs },
        }),
      ),
    enabled: !selfOnly && (view === "dashboard" || view === "mark"),
  });

  const contextQuery = useQuery({
    queryKey: ["employee-attendance", "context", category, dateBs],
    queryFn: () =>
      unwrap<EmployeeAttendanceMarkContext>(
        api.get("/employee-attendance/context", {
          params: { category, dateBs },
        }),
      ),
    enabled: !selfOnly && view === "mark",
  });

  const registerQuery = useQuery({
    queryKey: ["employee-attendance", "register", category],
    queryFn: () =>
      unwrap<{ rows: Array<Record<string, unknown>> }>(
        api.get("/employee-attendance/register", { params: { category } }),
      ),
    enabled: !selfOnly && view === "register",
  });

  const myQuery = useQuery({
    queryKey: ["employee-attendance", "me", category],
    queryFn: () =>
      unwrap<EmployeeAttendanceSelfSummary>(
        api.get("/employee-attendance/me", { params: { category } }),
      ),
    enabled: selfOnly || view === "my",
  });

  useEffect(() => {
    const ctx = contextQuery.data;
    if (!ctx) return;
    setLoaded(ctx.existingRecord);
    setNotes(ctx.existingRecord?.notes ?? "");
    const byId = new Map<string, EmployeeAttendanceEntryRecord>();
    for (const e of ctx.existingRecord?.entries ?? []) {
      const key = category === "TEACHER" ? e.teacherId : e.staffId;
      if (key) byId.set(key, e);
    }
    setRows(
      ctx.employees.map((emp) => {
        const prev = byId.get(emp._id);
        return {
          id: emp._id,
          employeeCode: emp.employeeCode,
          fullName: emp.fullName,
          department: emp.department,
          designation: emp.designation,
          userId: emp.userId,
          // Blank until someone marks it — an untouched row must not read as
          // "Present" and get submitted by accident.
          status: prev?.status ?? "",
          checkInTime: prev?.checkInTime ?? "",
          checkOutTime: prev?.checkOutTime ?? "",
          periodsTaught:
            typeof prev?.periodsTaught === "number"
              ? String(prev.periodsTaught)
              : "",
          remarks: prev?.remarks ?? "",
        };
      }),
    );
  }, [contextQuery.data, category]);

  type SubmitPhase = "DRAFT" | "CHECK_IN" | "CHECK_OUT" | "FINAL";

  const sheetStatus = loaded?.status ?? "NONE";
  const isLocked =
    sheetStatus === "LOCKED" || sheetStatus === "SUBMITTED";
  const canWriteSheet =
    (canTake || canEdit) &&
    !isLocked &&
    (contextQuery.data?.canMark || contextQuery.data?.canEdit || canTake);

  const phaseLabel = (() => {
    switch (sheetStatus) {
      case "DRAFT":
        return "Open — saving rows as people arrive; close the check-in stage when everyone is in";
      case "CHECK_IN_SUBMITTED":
        return "Check-in stage closed — keep saving check-out times, then close the check-out stage";
      case "CHECK_OUT_SUBMITTED":
        return "Check-out stage closed — Final submit locks the day";
      case "LOCKED":
      case "SUBMITTED":
        return "Final — day sheet locked";
      default:
        return "Not started — save a row, or fill the table and close the check-in stage";
    }
  })();

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.designation || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["employee-attendance"] });
  };

  /** Only marked rows are part of the sheet; the rest stay pending. */
  const markedRows = useMemo(() => rows.filter((r) => r.status !== ""), [rows]);
  const unmarkedCount = rows.length - markedRows.length;

  const submitMut = useMutation({
    mutationFn: (phase: SubmitPhase) => {
      if (markedRows.length === 0) {
        throw new Error(
          `Select a status for at least one ${label.toLowerCase()} before submitting`,
        );
      }
      return unwrap(
        api.post("/employee-attendance", {
          category,
          dateBs,
          notes,
          phase,
          asDraft: phase === "DRAFT",
          entries: markedRows.map((r) => {
            const withTimes = hasCheckTimes(r.status);
            const periodsRaw = r.periodsTaught.trim();
            const periodsNum =
              category === "TEACHER" && periodsRaw !== ""
                ? Number(periodsRaw)
                : undefined;
            return {
              teacherId: category === "TEACHER" ? r.id : undefined,
              staffId: category === "STAFF" ? r.id : undefined,
              employeeUserId: r.userId,
              employeeCode: r.employeeCode,
              fullName: r.fullName,
              department: r.department ?? "",
              designation: r.designation ?? "",
              status: r.status,
              checkInTime: withTimes ? r.checkInTime || undefined : undefined,
              checkOutTime: withTimes ? r.checkOutTime || undefined : undefined,
              periodsTaught:
                periodsNum !== undefined && Number.isFinite(periodsNum)
                  ? periodsNum
                  : undefined,
              remarks: r.remarks,
              source: "MANUAL" as const,
            };
          }),
        }),
      );
    },
    onSuccess: async (data, phase) => {
      const msg =
        phase === "DRAFT"
          ? "Draft saved"
          : phase === "CHECK_IN"
            ? `Whole table saved (${markedRows.length} row(s)) — check-in stage closed`
            : phase === "CHECK_OUT"
              ? `Whole table saved (${markedRows.length} row(s)) — check-out stage closed`
              : `${label} attendance submitted and locked for ${dateBs}`;
      toast.success(msg);
      setLoaded(data as EmployeeAttendanceRecord);
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  /**
   * Save one employee's row on its own. Teachers arrive and leave at different
   * times, so their check-in / check-out is recorded as it happens instead of
   * waiting to fill in the whole sheet. This never advances the sheet phase —
   * the check-in / check-out / final submit flow below is unchanged.
   */
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const saveRowMut = useMutation({
    mutationFn: (row: MarkRow) => {
      const withTimes = acceptsCheckTimes(row.status);
      const periodsRaw = row.periodsTaught.trim();
      const periodsNum =
        category === "TEACHER" && periodsRaw !== "" ? Number(periodsRaw) : undefined;
      return unwrap(
        api.post("/employee-attendance/entry", {
          category,
          dateBs,
          teacherId: category === "TEACHER" ? row.id : undefined,
          staffId: category === "STAFF" ? row.id : undefined,
          status: row.status || undefined,
          checkInTime: withTimes ? row.checkInTime || undefined : undefined,
          checkOutTime: withTimes ? row.checkOutTime || undefined : undefined,
          periodsTaught:
            periodsNum !== undefined && Number.isFinite(periodsNum) ? periodsNum : undefined,
          remarks: row.remarks,
          source: "MANUAL" as const,
        }),
      );
    },
    onMutate: (row: MarkRow) => setSavingRowId(row.id),
    onSuccess: async (data, row) => {
      toast.success(`${row.fullName} saved`);
      setLoaded(data as EmployeeAttendanceRecord);
      // Deliberately not invalidating the mark context: refetching it rebuilds
      // every row from the server and would discard whatever the user has
      // typed into other rows but not saved yet.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["employee-attendance", "dashboard"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["employee-attendance", "register"],
        }),
        queryClient.invalidateQueries({ queryKey: ["employee-attendance", "me"] }),
      ]);
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
    onSettled: () => setSavingRowId(null),
  });

  /** Stamp the current time into a row and save just that employee. */
  const stampAndSave = (row: MarkRow, field: "checkInTime" | "checkOutTime") => {
    const next: MarkRow = {
      ...row,
      // A check-in with no status yet means the person has turned up.
      status: row.status || (field === "checkInTime" ? "PRESENT" : row.status),
      [field]: nowHm(),
    };
    setRows((list) => list.map((r) => (r.id === row.id ? next : r)));
    saveRowMut.mutate(next);
  };

  const unlockMut = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Unlock reason");
      if (!reason) throw new Error("cancelled");
      return unwrap(api.post(`/employee-attendance/${id}/unlock`, { reason }));
    },
    onSuccess: async (data) => {
      toast.success("Attendance unlocked");
      setLoaded(data as EmployeeAttendanceRecord);
      await invalidate();
      // Force mark context reload so canMark flips back to true
      await queryClient.invalidateQueries({
        queryKey: ["employee-attendance", "context", category],
      });
    },
    onError: (e) => {
      if (String(e).includes("cancelled")) return;
      toast.error(parseErrorMessage(e));
    },
  });

  const showPeriods = category === "TEACHER";

  /**
   * One set of controls for both layouts: the desktop sheet renders them as
   * table cells, the phone renders them stacked in a card. Same state, same
   * handlers — a change here lands in both.
   */
  const statusSelect = (row: MarkRow, className = "h-10 w-[8.75rem] max-w-full") => (
    <Select
      className={className}
      disabled={!canWriteSheet}
      value={row.status}
      onChange={(e) => {
        const nextStatus = e.target.value as EmployeeAttendanceStatus | "";
        const withTimes = acceptsCheckTimes(nextStatus);
        setRows((list) =>
          list.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: nextStatus,
                  checkInTime: withTimes ? r.checkInTime : "",
                  checkOutTime: withTimes ? r.checkOutTime : "",
                }
              : r,
          ),
        );
      }}
    >
      {/* Blank by default — nothing is assumed until someone marks the row. */}
      <option value="">— Select —</option>
      {STATUSES.map((st) => (
        <option key={st} value={st}>
          {st.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );

  const timeInput = (
    row: MarkRow,
    field: "checkInTime" | "checkOutTime",
    className = "time-input h-10 w-[9.75rem] max-w-none shrink-0",
  ) =>
    acceptsCheckTimes(row.status) ? (
      <Input
        className={className}
        type="time"
        disabled={!canWriteSheet}
        value={row[field]}
        onChange={(e) =>
          setRows((list) =>
            list.map((r) =>
              r.id === row.id ? { ...r, [field]: e.target.value } : r,
            ),
          )
        }
      />
    ) : (
      <span className="text-sm text-slate-400">—</span>
    );

  const periodsInput = (row: MarkRow, className = "h-10 w-16") => (
    <NumberInput
      className={className}
      min={0}
      max={24}
      step={1}
      placeholder=""
      disabled={!canWriteSheet}
      value={row.periodsTaught}
      onChange={(e) =>
        setRows((list) =>
          list.map((r) =>
            r.id === row.id ? { ...r, periodsTaught: e.target.value } : r,
          ),
        )
      }
    />
  );

  const remarksInput = (row: MarkRow, className = "h-10 w-full min-w-[6rem]") => (
    <Input
      className={className}
      disabled={!canWriteSheet}
      value={row.remarks}
      onChange={(e) =>
        setRows((list) =>
          list.map((r) => (r.id === row.id ? { ...r, remarks: e.target.value } : r)),
        )
      }
    />
  );

  /**
   * Per-employee save: each teacher checks in and out at their own time, so
   * their row is stored on its own without touching anyone else's or moving
   * the sheet to the next step.
   */
  const rowActions = (row: MarkRow) => (
    <div className="flex flex-wrap gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 px-2 text-xs"
        disabled={!canWriteSheet || savingRowId === row.id}
        title="Stamp the current time as check-in and save this row"
        onClick={() => stampAndSave(row, "checkInTime")}
      >
        In now
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 px-2 text-xs"
        disabled={!canWriteSheet || savingRowId === row.id}
        title="Stamp the current time as check-out and save this row"
        onClick={() => stampAndSave(row, "checkOutTime")}
      >
        Out now
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 px-2 text-xs"
        disabled={
          !canWriteSheet ||
          savingRowId === row.id ||
          (row.status === "" && !row.checkInTime && !row.checkOutTime)
        }
        title="Save only this employee's row"
        onClick={() => saveRowMut.mutate(row)}
      >
        {savingRowId === row.id ? "Saving…" : "Save"}
      </Button>
    </div>
  );

  const exportExcel = () => {
    const reg = (registerQuery.data?.rows ?? []) as Array<{
      dateBs?: string;
      employeeCode?: string;
      fullName?: string;
      department?: string;
      designation?: string;
      status?: string;
      checkInTime?: string;
      checkOutTime?: string;
      periodsTaught?: number;
      remarks?: string;
      recordStatus?: string;
      attendanceId?: string;
    }>;
    const sheet = XLSX.utils.json_to_sheet(
      reg.map((r) => ({
        Date: r.dateBs ?? "",
        Code: r.employeeCode ?? "",
        Name: r.fullName ?? "",
        Department: r.department ?? "",
        Designation: r.designation ?? "",
        Status: r.status ?? "",
        "Check-in": r.checkInTime ?? "",
        "Check-out": r.checkOutTime ?? "",
        ...(showPeriods
          ? { Period: r.periodsTaught ?? "" }
          : {}),
        Remarks: r.remarks ?? "",
        Record: r.recordStatus ?? "",
      })),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, `${label} Attendance`);
    XLSX.writeFile(book, `${category.toLowerCase()}-attendance-register.xlsx`);
  };

  const printRegister = () => {
    const reg = (registerQuery.data?.rows ?? []) as Array<{
      dateBs?: string;
      employeeCode?: string;
      fullName?: string;
      department?: string;
      designation?: string;
      status?: string;
      checkInTime?: string;
      checkOutTime?: string;
      periodsTaught?: number;
      remarks?: string;
    }>;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Allow pop-ups to print");
      return;
    }
    const periodHeader = showPeriods ? "<th>Period</th>" : "";
    const colSpan = showPeriods ? 10 : 9;
    const body = reg
      .map((r) => {
        const periodCell = showPeriods
          ? `<td>${r.periodsTaught ?? ""}</td>`
          : "";
        return `<tr><td>${r.dateBs ?? ""}</td><td>${r.employeeCode ?? ""}</td><td>${r.fullName ?? ""}</td><td>${r.department ?? ""}</td><td>${r.designation ?? ""}</td><td>${r.status ?? ""}</td><td>${r.checkInTime ?? ""}</td><td>${r.checkOutTime ?? ""}</td>${periodCell}<td>${r.remarks ?? ""}</td></tr>`;
      })
      .join("");
    const branding = getPrintInstitutionBranding();
    const instName = branding.name || "Institution";
    const instAddr = branding.address
      ? `<p style="margin:2px 0 0;font-size:12px;color:#475569">${branding.address}</p>`
      : "";
    win.document.write(`<!DOCTYPE html><html><head><title>${instName} — ${label} Attendance</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a} .hdr{text-align:center;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px} .hdr h1{margin:0;font-size:18px;text-transform:uppercase} table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #ccc;padding:4px} th{background:#f1f5f9}</style>
      </head><body>
      <div class="hdr"><h1>${instName}</h1>${instAddr}<p style="margin:8px 0 0;font-size:15px;font-weight:600">${label} Attendance Register</p></div>
      <table><thead><tr><th>Date</th><th>ID</th><th>Name</th><th>Dept</th><th>Designation</th><th>Status</th><th>In</th><th>Out</th>${periodHeader}<th>Remarks</th></tr></thead>
      <tbody>${body || `<tr><td colspan='${colSpan}'>No records</td></tr>`}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  };

  const dash = dashQuery.data;

  if (selfOnly) {
    return (
      <SelfPortal
        data={myQuery.data}
        loading={myQuery.isLoading}
        label={label}
        showPeriods={showPeriods}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ...(canTake || canEdit ? (["mark"] as const) : []),
            "dashboard",
            "register",
            "my",
          ] as const
        ).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "default" : "outline"}
            onClick={() => setView(v)}
          >
            {v === "mark"
              ? `Take ${label} Attendance`
              : v === "dashboard"
                ? "Dashboard"
                : v === "register"
                  ? "Register / Reports"
                  : "My Attendance"}
          </Button>
        ))}
      </div>

      {view === "dashboard" ? (
        dashQuery.isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Date (BS)">
                <NepaliDateField value={dateBs} onChange={setDateBs} />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {[
                { label: `Total ${label}s`, value: dash?.totalEmployees ?? 0 },
                { label: "Present", value: dash?.present ?? 0 },
                { label: "Absent", value: dash?.absent ?? 0 },
                { label: "Leave", value: dash?.leave ?? 0 },
                { label: "Late", value: dash?.late ?? 0 },
                { label: "Pending", value: dash?.pending ?? 0 },
              ].map((c) => (
                <Card key={c.label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-slate-500">{c.label}</p>
                    <p className="text-2xl font-semibold">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-slate-600">
              Today ({dash?.dateBs}):{" "}
              <Badge className={statusClass(dash?.recordStatus === "NONE" ? "" : "PRESENT")}>
                {dash?.recordStatus ?? "NONE"}
              </Badge>
              {" · "}
              Attendance {dash?.attendancePercent ?? 0}%
              {canTake && (dash?.pending ?? 0) > 0 ? (
                <Button
                  size="sm"
                  className="ml-2"
                  onClick={() => setView("mark")}
                >
                  Mark pending
                </Button>
              ) : null}
            </p>
          </div>
        )
      ) : null}

      {view === "mark" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {label} attendance — {dateBs}
            </CardTitle>
            <p className="text-sm font-normal text-slate-500">
              Two ways to fill this sheet, same table.{" "}
              <strong>One person at a time</strong> — as each{" "}
              {label.toLowerCase()} arrives or leaves, press{" "}
              <strong>In now</strong> / <strong>Out now</strong> (or type a time
              and press <strong>Save</strong>) on their row; only that row is
              saved. <strong>Everyone at once</strong> — fill the table, then use
              the “Save all &amp; mark … done” buttons below, which post the whole
              table as shown on this screen and close that stage. Final submit
              locks the day.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Date (BS)">
                <NepaliDateField value={dateBs} onChange={setDateBs} />
              </FormField>
              <FormField label="Search">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, ID, department…"
                />
              </FormField>
              <FormField label="Notes">
                <Input
                  value={notes}
                  disabled={!canWriteSheet}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </FormField>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-semibold text-slate-800">Step:</span>
              <Badge
                className={
                  isLocked
                    ? "bg-slate-800 text-white"
                    : sheetStatus === "CHECK_OUT_SUBMITTED"
                      ? "bg-violet-100 text-violet-900"
                      : sheetStatus === "CHECK_IN_SUBMITTED"
                        ? "bg-sky-100 text-sky-900"
                        : "bg-amber-100 text-amber-900"
                }
              >
                {String(sheetStatus).replace(/_/g, " ")}
              </Badge>
              <span className="text-slate-600">{phaseLabel}</span>
              <span className="ml-auto text-slate-600">
                Marked{" "}
                <strong className="text-slate-800">{markedRows.length}</strong>{" "}
                of {rows.length}
                {unmarkedCount > 0 ? (
                  <span className="text-amber-700">
                    {" "}
                    · {unmarkedCount} still blank
                  </span>
                ) : null}
              </span>
            </div>

            {isLocked ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This day sheet is locked (final submit done).
                {canUnlock && loaded ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-2"
                    onClick={() => unlockMut.mutate(loaded._id)}
                  >
                    Unlock
                  </Button>
                ) : null}
              </div>
            ) : null}

            {contextQuery.isLoading ? (
              <LoadingState />
            ) : rows.length === 0 ? (
              <EmptyState
                title={`No ${label.toLowerCase()} records`}
                description={`Add ${label.toLowerCase()}s in the ${label} module first.`}
              />
            ) : (
              (() => {
                /**
                 * Fixed column widths (px) so Check-in / Check-out time fields
                 * never crush under table-fixed percentages (screenshot bug).
                 * Sticky ID + Name while scrolling left-right.
                 */
                const markMinW = showPeriods
                  ? "min-w-[1560px]"
                  : "min-w-[1480px]";
                const markTableClass = cn(
                  "w-full border-collapse table-fixed",
                  markMinW,
                );
                const thClass =
                  "bg-slate-50 whitespace-nowrap text-xs font-semibold text-slate-600";
                const stickyId =
                  "sticky left-0 z-20 border-r border-slate-100 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]";
                const stickyName =
                  "sticky left-[6.5rem] z-20 border-r border-slate-100 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]";
                const markCols = showPeriods ? (
                  <colgroup>
                    <col style={{ width: "6.5rem" }} />
                    <col style={{ width: "11rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "10.5rem" }} />
                    <col style={{ width: "10.5rem" }} />
                    <col style={{ width: "5rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "12rem" }} />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col style={{ width: "6.5rem" }} />
                    <col style={{ width: "11rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "9.5rem" }} />
                    <col style={{ width: "10.5rem" }} />
                    <col style={{ width: "10.5rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "12rem" }} />
                  </colgroup>
                );
                return (
                  <>
                    {/*
                      Phone: one card per employee. The sheet is ~1500px wide with
                      two sticky columns, which on a phone cover the fields they are
                      meant to label — so stack the same controls instead.
                    */}
                    <div className="space-y-3 md:hidden">
                      {filteredRows.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-xl border border-slate-200 bg-white p-3"
                        >
                          <p className="font-medium text-slate-900">
                            {row.fullName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {[row.employeeCode, row.department, row.designation]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                          <div className="mt-2 space-y-2">
                            <label className="block">
                              <span className="text-xs text-slate-500">Status</span>
                              {statusSelect(row, "mt-0.5 h-10 w-full")}
                            </label>
                            {acceptsCheckTimes(row.status) ? (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                  <span className="text-xs text-slate-500">
                                    Check-in
                                  </span>
                                  {timeInput(
                                    row,
                                    "checkInTime",
                                    "time-input mt-0.5 h-10 w-full",
                                  )}
                                </label>
                                <label className="block">
                                  <span className="text-xs text-slate-500">
                                    Check-out
                                  </span>
                                  {timeInput(
                                    row,
                                    "checkOutTime",
                                    "time-input mt-0.5 h-10 w-full",
                                  )}
                                </label>
                              </div>
                            ) : null}
                            {showPeriods ? (
                              <label className="block">
                                <span className="text-xs text-slate-500">
                                  Periods taught
                                </span>
                                {periodsInput(row, "mt-0.5 h-10 w-20")}
                              </label>
                            ) : null}
                            <label className="block">
                              <span className="text-xs text-slate-500">Remarks</span>
                              {remarksInput(row, "mt-0.5 h-10 w-full")}
                            </label>
                          </div>
                          <div className="mt-3">{rowActions(row)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
                    <StickyTableScroll
                      maxHeightClassName="max-h-[min(70vh,720px)]"
                      header={
                        <Table className={markTableClass}>
                          {markCols}
                          <TableHead>
                            <tr>
                              <Th
                                className={cn(
                                  thClass,
                                  stickyId,
                                  "bg-slate-50",
                                )}
                              >
                                ID
                              </Th>
                              <Th
                                className={cn(
                                  thClass,
                                  stickyName,
                                  "bg-slate-50",
                                )}
                              >
                                Name
                              </Th>
                              <Th className={thClass}>Department</Th>
                              <Th className={thClass}>Designation</Th>
                              <Th className={thClass}>Status</Th>
                              <Th className={thClass}>Check-in</Th>
                              <Th className={thClass}>Check-out</Th>
                              {showPeriods ? (
                                <Th className={thClass}>Period</Th>
                              ) : null}
                              <Th className={thClass}>Remarks</Th>
                              <Th className={thClass}>Save this row</Th>
                            </tr>
                          </TableHead>
                        </Table>
                      }
                      body={
                        <Table className={markTableClass}>
                          {markCols}
                          <TableBody>
                            {filteredRows.map((row) => (
                              <tr key={row.id} className="align-middle">
                                <Td
                                  className={cn(
                                    "bg-white text-sm tabular-nums text-slate-600",
                                    stickyId,
                                  )}
                                >
                                  {row.employeeCode}
                                </Td>
                                <Td
                                  className={cn(
                                    "bg-white text-sm font-medium text-slate-900",
                                    stickyName,
                                  )}
                                >
                                  <span className="line-clamp-2">
                                    {row.fullName}
                                  </span>
                                </Td>
                                <Td className="text-sm text-slate-600">
                                  <span className="line-clamp-2">
                                    {row.department || "—"}
                                  </span>
                                </Td>
                                <Td className="text-sm text-slate-600">
                                  <span className="line-clamp-2">
                                    {row.designation || "—"}
                                  </span>
                                </Td>
                                <Td>{statusSelect(row)}</Td>
                                <Td className="p-2">
                                  {timeInput(row, "checkInTime")}
                                </Td>
                                <Td className="p-2">
                                  {timeInput(row, "checkOutTime")}
                                </Td>
                                {showPeriods ? (
                                  <Td className="p-2">{periodsInput(row)}</Td>
                                ) : null}
                                <Td className="p-2">{remarksInput(row)}</Td>
                                <Td className="p-2">{rowActions(row)}</Td>
                              </tr>
                            ))}
                          </TableBody>
                        </Table>
                      }
                    />
                    </div>
                  </>
                );
              })()
            )}

            {canWriteSheet && rows.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setRows((list) =>
                      list.map((r) => ({ ...r, status: "PRESENT" })),
                    )
                  }
                >
                  Mark all Present
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setRows((list) =>
                      list.map((r) => ({
                        ...r,
                        status: "ABSENT",
                        checkInTime: "",
                        checkOutTime: "",
                      })),
                    )
                  }
                >
                  Mark all Absent
                </Button>
                <Button
                  variant="outline"
                  disabled={submitMut.isPending}
                  onClick={() => submitMut.mutate("DRAFT")}
                >
                  Save draft
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    submitMut.isPending ||
                    !dateBs ||
                    sheetStatus === "CHECK_OUT_SUBMITTED"
                  }
                  onClick={() => submitMut.mutate("CHECK_IN")}
                  title={`Posts the whole table as shown on this screen (${markedRows.length} marked row(s)) and marks the check-in stage done. To record one person only, use Save on their row.`}
                >
                  Save all &amp; mark check-in done
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    submitMut.isPending ||
                    !dateBs ||
                    sheetStatus === "NONE" ||
                    sheetStatus === "DRAFT"
                  }
                  onClick={() => submitMut.mutate("CHECK_OUT")}
                  title={
                    sheetStatus === "NONE" || sheetStatus === "DRAFT"
                      ? "Mark the check-in stage done first"
                      : `Posts the whole table as shown on this screen (${markedRows.length} marked row(s)) and marks the check-out stage done. To record one person only, use Save on their row.`
                  }
                >
                  Save all &amp; mark check-out done
                </Button>
                <Button
                  disabled={
                    submitMut.isPending ||
                    !dateBs ||
                    (sheetStatus !== "CHECK_IN_SUBMITTED" &&
                      sheetStatus !== "CHECK_OUT_SUBMITTED")
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Final submit posts the whole table as shown here (${markedRows.length} marked row(s)) and locks the day sheet. Continue?`,
                      )
                    ) {
                      submitMut.mutate("FINAL");
                    }
                  }}
                  title={
                    sheetStatus !== "CHECK_IN_SUBMITTED" &&
                    sheetStatus !== "CHECK_OUT_SUBMITTED"
                      ? "Use “Save all & mark check-in done” first — the day can only be locked once a stage is closed"
                      : `Posts the whole table as shown on this screen (${markedRows.length} marked row(s)) and locks the day`
                  }
                >
                  Final submit &amp; lock
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {view === "register" ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{label} attendance register</CardTitle>
            {canExport ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportExcel}>
                  Excel
                </Button>
                <Button size="sm" variant="outline" onClick={printRegister}>
                  Print / PDF
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            {registerQuery.isLoading ? (
              <LoadingState />
            ) : (registerQuery.data?.rows ?? []).length === 0 ? (
              <EmptyState
                title="No records"
                description={`Submitted ${label.toLowerCase()} attendance will appear here.`}
              />
            ) : (
              (() => {
                const regMinW = showPeriods
                  ? "min-w-[1100px]"
                  : "min-w-[1000px]";
                const regTableClass = cn("w-full table-fixed", regMinW);
                const thClass = "bg-slate-50 whitespace-nowrap";
                const regCols = showPeriods ? (
                  <colgroup>
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[6%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col className="w-[11%]" />
                    <col className="w-[9%]" />
                    <col className="w-[15%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[11%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                );
                const regRows = (registerQuery.data?.rows ?? []) as Array<{
                  attendanceId?: string;
                  dateBs?: string;
                  employeeCode?: string;
                  fullName?: string;
                  department?: string;
                  designation?: string;
                  status?: string;
                  checkInTime?: string;
                  checkOutTime?: string;
                  periodsTaught?: number;
                  remarks?: string;
                }>;
                return (
                  <>
                    {/* Phone: the register is read-only, so stack it as cards. */}
                    <div className="space-y-2 md:hidden">
                      {regRows.map((r, i) => (
                        <div
                          key={`m-${r.attendanceId ?? "x"}-${r.employeeCode ?? i}-${i}`}
                          className="rounded-xl border border-slate-200 bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">
                                {r.fullName ?? "—"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {[r.employeeCode, r.department, r.designation]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </p>
                            </div>
                            <Badge
                              className={cn(statusClass(String(r.status ?? "")), "shrink-0")}
                            >
                              {String(r.status ?? "—").replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                            <div>
                              <dt className="text-slate-400">Date</dt>
                              <dd>{r.dateBs ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-400">In / Out</dt>
                              <dd>
                                {hasCheckTimes(String(r.status ?? ""))
                                  ? `${r.checkInTime || "—"} / ${r.checkOutTime || "—"}`
                                  : "—"}
                              </dd>
                            </div>
                            {showPeriods ? (
                              <div>
                                <dt className="text-slate-400">Periods</dt>
                                <dd>
                                  {typeof r.periodsTaught === "number"
                                    ? r.periodsTaught
                                    : "—"}
                                </dd>
                              </div>
                            ) : null}
                            {r.remarks ? (
                              <div className="col-span-2">
                                <dt className="text-slate-400">Remarks</dt>
                                <dd>{r.remarks}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                      ))}
                    </div>
                    <div className="hidden min-w-0 overflow-hidden rounded-xl border border-slate-200 md:block">
                    <StickyTableScroll
                      maxHeightClassName="max-h-[min(70vh,720px)]"
                      header={
                        <Table className={regTableClass}>
                          {regCols}
                          <TableHead>
                            <tr>
                              <Th className={thClass}>Date</Th>
                              <Th className={thClass}>ID</Th>
                              <Th className={thClass}>Name</Th>
                              <Th className={thClass}>Dept</Th>
                              <Th className={thClass}>Designation</Th>
                              <Th className={thClass}>Status</Th>
                              <Th className={thClass}>In</Th>
                              <Th className={thClass}>Out</Th>
                              {showPeriods ? (
                                <Th className={thClass}>Period</Th>
                              ) : null}
                              <Th className={thClass}>Remarks</Th>
                            </tr>
                          </TableHead>
                        </Table>
                      }
                      body={
                        <Table className={regTableClass}>
                          {regCols}
                          <TableBody>
                            {regRows.map((r, i) => (
                              <tr
                                key={`${r.attendanceId ?? "x"}-${r.employeeCode ?? i}-${i}`}
                              >
                                <Td className="text-sm">
                                  {r.dateBs ?? "—"}
                                </Td>
                                <Td className="text-sm">
                                  {r.employeeCode ?? "—"}
                                </Td>
                                <Td className="text-sm">
                                  {r.fullName ?? "—"}
                                </Td>
                                <Td className="text-sm">
                                  {r.department ?? "—"}
                                </Td>
                                <Td className="text-sm">
                                  {r.designation ?? "—"}
                                </Td>
                                <Td>
                                  <Badge
                                    className={statusClass(
                                      String(r.status ?? ""),
                                    )}
                                  >
                                    {String(r.status ?? "—").replace(
                                      /_/g,
                                      " ",
                                    )}
                                  </Badge>
                                </Td>
                                <Td className="text-sm">
                                  {hasCheckTimes(String(r.status ?? ""))
                                    ? r.checkInTime || "—"
                                    : "—"}
                                </Td>
                                <Td className="text-sm">
                                  {hasCheckTimes(String(r.status ?? ""))
                                    ? r.checkOutTime || "—"
                                    : "—"}
                                </Td>
                                {showPeriods ? (
                                  <Td className="text-sm">
                                    {typeof r.periodsTaught === "number"
                                      ? r.periodsTaught
                                      : "—"}
                                  </Td>
                                ) : null}
                                <Td className="text-sm">
                                  {r.remarks ?? "—"}
                                </Td>
                              </tr>
                            ))}
                          </TableBody>
                        </Table>
                      }
                    />
                    </div>
                  </>
                );
              })()
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "my" ? (
        <SelfPortal
          data={myQuery.data}
          loading={myQuery.isLoading}
          label={label}
          showPeriods={showPeriods}
        />
      ) : null}
    </div>
  );
};

const SelfPortal = ({
  data,
  loading,
  label,
  showPeriods = false,
}: {
  data?: EmployeeAttendanceSelfSummary;
  loading: boolean;
  label: string;
  showPeriods?: boolean;
}) => {
  if (loading) return <LoadingState />;
  if (!data) {
    return (
      <EmptyState
        title="No attendance profile"
        description={`Your account is not linked as ${label.toLowerCase()}, or no attendance has been recorded yet.`}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Attendance %", value: `${data.attendancePercent}%` },
          { label: "Present", value: data.present },
          { label: "Absent", value: data.absent },
          { label: "Leave", value: data.leave },
          { label: "Late", value: data.late },
          { label: "Half day", value: data.halfDay },
          { label: "Official duty", value: data.officialDuty },
          { label: "Days marked", value: data.totalMarked },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance history (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.length === 0 ? (
            <p className="text-sm text-slate-500">No history yet.</p>
          ) : (
            (() => {
              const histMinW = showPeriods
                ? "min-w-[720px]"
                : "min-w-[640px]";
              const histClass = cn("w-full table-fixed", histMinW);
              const thClass = "bg-slate-50 whitespace-nowrap";
              const histCols = showPeriods ? (
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[24%]" />
                </colgroup>
              ) : (
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[28%]" />
                </colgroup>
              );
              return (
                <>
                  {/* Phone: personal history as cards instead of a wide table. */}
                  <div className="space-y-2 md:hidden">
                    {data.history.map((h, i) => (
                      <div
                        key={`mh-${h.dateBs ?? i}-${i}`}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-900">
                            {h.dateBs ?? "—"}
                          </p>
                          <Badge
                            className={cn(statusClass(String(h.status ?? "")), "shrink-0")}
                          >
                            {String(h.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                          <div>
                            <dt className="text-slate-400">In / Out</dt>
                            <dd>{`${h.checkInTime || "—"} / ${h.checkOutTime || "—"}`}</dd>
                          </div>
                          {showPeriods ? (
                            <div>
                              <dt className="text-slate-400">Periods</dt>
                              <dd>
                                {typeof h.periodsTaught === "number"
                                  ? h.periodsTaught
                                  : "—"}
                              </dd>
                            </div>
                          ) : null}
                          {h.remarks ? (
                            <div className="col-span-2">
                              <dt className="text-slate-400">Remarks</dt>
                              <dd>{h.remarks}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    ))}
                  </div>
                  <div className="hidden min-w-0 overflow-hidden rounded-xl border border-slate-200 md:block">
                  <StickyTableScroll
                    maxHeightClassName="max-h-[min(50vh,480px)]"
                    header={
                      <Table className={histClass}>
                        {histCols}
                        <TableHead>
                          <tr>
                            <Th className={thClass}>Date</Th>
                            <Th className={thClass}>Status</Th>
                            <Th className={thClass}>Check-in</Th>
                            <Th className={thClass}>Check-out</Th>
                            {showPeriods ? (
                              <Th className={thClass}>Period</Th>
                            ) : null}
                            <Th className={thClass}>Remarks</Th>
                          </tr>
                        </TableHead>
                      </Table>
                    }
                    body={
                      <Table className={histClass}>
                        {histCols}
                        <TableBody>
                          {data.history.map((h) => (
                            <tr key={h.dateBs + h.status}>
                              <Td className="text-sm">{h.dateBs}</Td>
                              <Td>
                                <Badge className={statusClass(h.status)}>
                                  {h.status.replace(/_/g, " ")}
                                </Badge>
                              </Td>
                              <Td className="text-sm">
                                {hasCheckTimes(h.status)
                                  ? h.checkInTime || "—"
                                  : "—"}
                              </Td>
                              <Td className="text-sm">
                                {hasCheckTimes(h.status)
                                  ? h.checkOutTime || "—"
                                  : "—"}
                              </Td>
                              {showPeriods ? (
                                <Td className="text-sm">
                                  {typeof h.periodsTaught === "number"
                                    ? h.periodsTaught
                                    : "—"}
                                </Td>
                              ) : null}
                              <Td className="text-sm">
                                {h.remarks || "—"}
                              </Td>
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    }
                  />
                </div>
                </>
              );
            })()
          )}
        </CardContent>
      </Card>
    </div>
  );
};
