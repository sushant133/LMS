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
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

const STATUSES: EmployeeAttendanceStatus[] = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "HALF_DAY",
  "LATE",
  "OFFICIAL_DUTY",
  "HOLIDAY",
];

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
  status: EmployeeAttendanceStatus;
  checkInTime: string;
  checkOutTime: string;
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
          status: prev?.status ?? "PRESENT",
          checkInTime: prev?.checkInTime ?? "",
          checkOutTime: prev?.checkOutTime ?? "",
          remarks: prev?.remarks ?? "",
        };
      }),
    );
  }, [contextQuery.data, category]);

  const isLocked =
    loaded?.status === "LOCKED" || loaded?.status === "SUBMITTED";
  const canWriteSheet =
    (canTake || canEdit) &&
    !isLocked &&
    (contextQuery.data?.canMark || contextQuery.data?.canEdit || canTake);

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

  const submitMut = useMutation({
    mutationFn: (asDraft: boolean) =>
      unwrap(
        api.post("/employee-attendance", {
          category,
          dateBs,
          notes,
          asDraft,
          entries: rows.map((r) => ({
            teacherId: category === "TEACHER" ? r.id : undefined,
            staffId: category === "STAFF" ? r.id : undefined,
            employeeUserId: r.userId,
            employeeCode: r.employeeCode,
            fullName: r.fullName,
            department: r.department ?? "",
            designation: r.designation ?? "",
            status: r.status,
            checkInTime: r.checkInTime || undefined,
            checkOutTime: r.checkOutTime || undefined,
            remarks: r.remarks,
            source: "MANUAL",
          })),
        }),
      ),
    onSuccess: async (data, asDraft) => {
      toast.success(
        asDraft
          ? "Draft saved"
          : `${label} attendance submitted and locked for ${dateBs}`,
      );
      setLoaded(data as EmployeeAttendanceRecord);
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

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
      remarks?: string;
    }>;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Allow pop-ups to print");
      return;
    }
    const body = reg
      .map(
        (r) =>
          `<tr><td>${r.dateBs ?? ""}</td><td>${r.employeeCode ?? ""}</td><td>${r.fullName ?? ""}</td><td>${r.department ?? ""}</td><td>${r.designation ?? ""}</td><td>${r.status ?? ""}</td><td>${r.checkInTime ?? ""}</td><td>${r.checkOutTime ?? ""}</td><td>${r.remarks ?? ""}</td></tr>`,
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><title>PHIT LMS — ${label} Attendance</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px} table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #ccc;padding:4px}</style>
      </head><body>
      <h1>PHIT LMS — ${label} Attendance Register</h1>
      <p>Generated ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Date</th><th>ID</th><th>Name</th><th>Dept</th><th>Designation</th><th>Status</th><th>In</th><th>Out</th><th>Remarks</th></tr></thead>
      <tbody>${body || "<tr><td colspan='9'>No records</td></tr>"}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  };

  const dash = dashQuery.data;

  if (selfOnly) {
    return <SelfPortal data={myQuery.data} loading={myQuery.isLoading} label={label} />;
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
              Uses existing {label.toLowerCase()} records only. Select date, mark status, then
              submit to lock the day sheet.
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

            {isLocked ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This day sheet is locked.
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
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>ID</Th>
                      <Th>Name</Th>
                      <Th>Department</Th>
                      <Th>Designation</Th>
                      <Th>Status</Th>
                      <Th>Check-in</Th>
                      <Th>Check-out</Th>
                      <Th>Remarks</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <tr key={row.id}>
                        <Td className="text-sm">{row.employeeCode}</Td>
                        <Td className="text-sm font-medium">{row.fullName}</Td>
                        <Td className="text-sm text-slate-600">
                          {row.department || "—"}
                        </Td>
                        <Td className="text-sm text-slate-600">
                          {row.designation || "—"}
                        </Td>
                        <Td>
                          <Select
                            className="min-w-[130px]"
                            disabled={!canWriteSheet}
                            value={row.status}
                            onChange={(e) =>
                              setRows((list) =>
                                list.map((r) =>
                                  r.id === row.id
                                    ? {
                                        ...r,
                                        status: e.target
                                          .value as EmployeeAttendanceStatus,
                                      }
                                    : r,
                                ),
                              )
                            }
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </Select>
                        </Td>
                        <Td>
                          <Input
                            className="w-24"
                            placeholder="HH:mm"
                            disabled={!canWriteSheet}
                            value={row.checkInTime}
                            onChange={(e) =>
                              setRows((list) =>
                                list.map((r) =>
                                  r.id === row.id
                                    ? { ...r, checkInTime: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </Td>
                        <Td>
                          <Input
                            className="w-24"
                            placeholder="HH:mm"
                            disabled={!canWriteSheet}
                            value={row.checkOutTime}
                            onChange={(e) =>
                              setRows((list) =>
                                list.map((r) =>
                                  r.id === row.id
                                    ? { ...r, checkOutTime: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </Td>
                        <Td>
                          <Input
                            className="min-w-[100px]"
                            disabled={!canWriteSheet}
                            value={row.remarks}
                            onChange={(e) =>
                              setRows((list) =>
                                list.map((r) =>
                                  r.id === row.id
                                    ? { ...r, remarks: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
                      list.map((r) => ({ ...r, status: "ABSENT" })),
                    )
                  }
                >
                  Mark all Absent
                </Button>
                <Button
                  variant="outline"
                  disabled={submitMut.isPending}
                  onClick={() => submitMut.mutate(true)}
                >
                  Save draft
                </Button>
                <Button
                  disabled={submitMut.isPending || !dateBs}
                  onClick={() => submitMut.mutate(false)}
                >
                  Submit &amp; lock
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Date</Th>
                      <Th>ID</Th>
                      <Th>Name</Th>
                      <Th>Dept</Th>
                      <Th>Designation</Th>
                      <Th>Status</Th>
                      <Th>In</Th>
                      <Th>Out</Th>
                      <Th>Remarks</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(
                      (registerQuery.data?.rows ?? []) as Array<{
                        attendanceId?: string;
                        dateBs?: string;
                        employeeCode?: string;
                        fullName?: string;
                        department?: string;
                        designation?: string;
                        status?: string;
                        checkInTime?: string;
                        checkOutTime?: string;
                        remarks?: string;
                      }>
                    ).map((r, i) => (
                      <tr key={`${r.attendanceId ?? "x"}-${r.employeeCode ?? i}-${i}`}>
                        <Td className="text-sm">{r.dateBs ?? "—"}</Td>
                        <Td className="text-sm">{r.employeeCode ?? "—"}</Td>
                        <Td className="text-sm">{r.fullName ?? "—"}</Td>
                        <Td className="text-sm">{r.department ?? "—"}</Td>
                        <Td className="text-sm">{r.designation ?? "—"}</Td>
                        <Td>
                          <Badge className={statusClass(String(r.status ?? ""))}>
                            {String(r.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </Td>
                        <Td className="text-sm">{r.checkInTime ?? "—"}</Td>
                        <Td className="text-sm">{r.checkOutTime ?? "—"}</Td>
                        <Td className="text-sm">{r.remarks ?? "—"}</Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "my" ? (
        <SelfPortal data={myQuery.data} loading={myQuery.isLoading} label={label} />
      ) : null}
    </div>
  );
};

const SelfPortal = ({
  data,
  loading,
  label,
}: {
  data?: EmployeeAttendanceSelfSummary;
  loading: boolean;
  label: string;
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
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Status</Th>
                    <Th>Check-in</Th>
                    <Th>Check-out</Th>
                    <Th>Remarks</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {data.history.map((h) => (
                    <tr key={h.dateBs + h.status}>
                      <Td className="text-sm">{h.dateBs}</Td>
                      <Td>
                        <Badge className={statusClass(h.status)}>
                          {h.status.replace(/_/g, " ")}
                        </Badge>
                      </Td>
                      <Td className="text-sm">{h.checkInTime || "—"}</Td>
                      <Td className="text-sm">{h.checkOutTime || "—"}</Td>
                      <Td className="text-sm">{h.remarks || "—"}</Td>
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
