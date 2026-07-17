import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  canManageInstitution,
  type BatchRecord,
  type CollegeStaffRecord,
  type FieldDutyAttendanceRecord,
  type FieldDutyDashboard,
  type FieldDutyRosterStudent,
  type FieldDutyScheduleRecord,
  type FieldDutyShift,
  type FieldDutyStudentStatus,
  type YearRecord,
} from "@phit-erp/shared";
import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  Hospital,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "components/ui/textarea";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import * as XLSX from "xlsx";

type PanelTab = "dashboard" | "schedules" | "mark" | "history" | "reports";

const SHIFTS: FieldDutyShift[] = [
  "MORNING",
  "DAY",
  "EVENING",
  "NIGHT",
  "FULL_DAY",
];

const STATUSES: FieldDutyStudentStatus[] = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "EMERGENCY_DUTY",
];

const statusClass = (status: string) => {
  switch (status) {
    case "PRESENT":
    case "EMERGENCY_DUTY":
      return "bg-emerald-100 text-emerald-800";
    case "ABSENT":
      return "bg-rose-100 text-rose-800";
    case "LATE":
      return "bg-amber-100 text-amber-900";
    case "LEAVE":
      return "bg-sky-100 text-sky-800";
    case "LOCKED":
    case "SUBMITTED":
      return "bg-slate-800 text-white";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

interface MarkRow {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: number;
  status: FieldDutyStudentStatus;
  remarks: string;
}

const defaultScheduleForm = {
  academicYearBs: "",
  faculty: "HA",
  batchId: "",
  yearId: "",
  hospitalName: "",
  department: "",
  ward: "",
  supervisorStaffId: "",
  clinicalInstructorName: "",
  hospitalSupervisorName: "",
  startDateBs: "",
  endDateBs: "",
  shift: "DAY" as FieldDutyShift,
  remarks: "",
  status: "ACTIVE" as const,
};

export const FieldDutyManager = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const isTeacher = user?.role === "TEACHER";
  const [tab, setTab] = useState<PanelTab>(isTeacher ? "mark" : "dashboard");
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [markDateBs, setMarkDateBs] = useState("");
  const [markRows, setMarkRows] = useState<MarkRow[]>([]);
  const [notes, setNotes] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<{ academicYearBs: string }>(api.get("/settings")),
  });

  useEffect(() => {
    if (settingsQuery.data?.academicYearBs && !scheduleForm.academicYearBs) {
      setScheduleForm((c) => ({
        ...c,
        academicYearBs: settingsQuery.data.academicYearBs,
      }));
    }
  }, [settingsQuery.data?.academicYearBs, scheduleForm.academicYearBs]);

  const batchesQuery = useQuery({
    queryKey: ["academics", "batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isAdmin,
  });

  const yearsQuery = useQuery({
    queryKey: ["academics", "years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isAdmin,
  });

  const staffQuery = useQuery({
    queryKey: ["college-staff", "field-duty-supervisors"],
    queryFn: () =>
      unwrap<CollegeStaffRecord[]>(
        api.get("/college-staff", { params: { status: "ACTIVE" } }),
      ),
    enabled: isAdmin,
  });

  const dashboardQuery = useQuery({
    queryKey: ["field-duty", "dashboard"],
    queryFn: () =>
      unwrap<FieldDutyDashboard>(api.get("/field-duty/dashboard")),
    enabled: tab === "dashboard" || tab === "mark",
  });

  const schedulesQuery = useQuery({
    queryKey: ["field-duty", "schedules"],
    queryFn: () =>
      unwrap<FieldDutyScheduleRecord[]>(api.get("/field-duty/schedules")),
  });

  const todayQuery = useQuery({
    queryKey: ["field-duty", "today"],
    queryFn: () =>
      unwrap<
        Array<{
          dateBs: string;
          schedule: FieldDutyScheduleRecord;
          students: FieldDutyRosterStudent[];
          existingAttendance: FieldDutyAttendanceRecord | null;
        }>
      >(api.get("/field-duty/today")),
    enabled: tab === "mark",
  });

  const historyQuery = useQuery({
    queryKey: ["field-duty", "attendance"],
    queryFn: () =>
      unwrap<FieldDutyAttendanceRecord[]>(api.get("/field-duty/attendance")),
    enabled: tab === "history" || tab === "reports",
  });

  const yearsForBatch = useMemo(() => {
    const years = yearsQuery.data ?? [];
    if (!scheduleForm.batchId) return years;
    return years.filter((y) => y.batchId === scheduleForm.batchId);
  }, [yearsQuery.data, scheduleForm.batchId]);

  const createSchedule = useMutation({
    mutationFn: (payload: typeof scheduleForm) =>
      unwrap(api.post("/field-duty/schedules", payload)),
    onSuccess: async () => {
      toast.success("Field duty schedule created");
      setScheduleForm({
        ...defaultScheduleForm,
        academicYearBs: settingsQuery.data?.academicYearBs ?? "",
        faculty: "HA",
      });
      await queryClient.invalidateQueries({ queryKey: ["field-duty"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const submitAttendance = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/field-duty/attendance", {
          scheduleId: selectedScheduleId,
          dateBs: markDateBs,
          notes,
          entries: markRows.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            remarks: r.remarks,
          })),
        }),
      ),
    onSuccess: async () => {
      toast.success("Field duty attendance submitted");
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["field-duty"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const unlockAttendance = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Unlock reason");
      if (!reason) throw new Error("Unlock cancelled");
      return unwrap(api.post(`/field-duty/attendance/${id}/unlock`, { reason }));
    },
    onSuccess: async () => {
      toast.success("Attendance unlocked");
      await queryClient.invalidateQueries({ queryKey: ["field-duty"] });
    },
    onError: (e) => {
      if (String(e).includes("cancelled")) return;
      toast.error(parseErrorMessage(e));
    },
  });

  const loadRosterForMarking = async (scheduleId: string, dateBs: string) => {
    setSelectedScheduleId(scheduleId);
    setMarkDateBs(dateBs);
    try {
      const data = await unwrap<{
        schedule: FieldDutyScheduleRecord;
        students: FieldDutyRosterStudent[];
      }>(api.get(`/field-duty/schedules/${scheduleId}/roster`));

      const existing = (todayQuery.data ?? []).find(
        (c) => c.schedule._id === scheduleId,
      )?.existingAttendance;

      setMarkRows(
        data.students.map((s) => {
          const prev = existing?.entries.find((e) => e.studentId === s._id);
          return {
            studentId: s._id,
            fullName: s.fullName,
            admissionNumber: s.admissionNumber,
            rollNumber: s.rollNumber,
            status: prev?.status ?? "PRESENT",
            remarks: prev?.remarks ?? "",
          };
        }),
      );
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  const exportExcel = () => {
    const rows = (historyQuery.data ?? []).flatMap((rec) =>
      rec.entries.map((e) => ({
        Date: rec.dateBs,
        Hospital: rec.hospitalName,
        Department: rec.department,
        Shift: rec.shift,
        Student: e.student?.fullName ?? "",
        Admission: e.student?.admissionNumber ?? "",
        Roll: e.student?.rollNumber ?? "",
        Status: e.status,
        Remarks: e.remarks ?? "",
        Record: rec.status,
      })),
    );
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Field Duty");
    XLSX.writeFile(book, "field-duty-attendance.xlsx");
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    ...(isAdmin ? [{ id: "schedules" as const, label: "Duty schedules" }] : []),
    { id: "mark", label: "Mark attendance" },
    { id: "history", label: "History" },
    { id: "reports", label: "Reports" },
  ];

  const dash = dashboardQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Field / Hospital Duty Attendance
        </h2>
        <p className="text-sm text-slate-600">
          Separate from daily and subject attendance. Students are filled
          automatically from batch + current year (no manual roster after
          promotion).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "dashboard" ? (
        dashboardQuery.isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "On duty today",
                  value: dash?.studentsOnDutyToday ?? 0,
                  icon: Users,
                },
                {
                  label: "Present",
                  value: dash?.present ?? 0,
                  icon: ClipboardCheck,
                },
                {
                  label: "Absent",
                  value: dash?.absent ?? 0,
                  icon: Hospital,
                },
                {
                  label: "Submitted today",
                  value: dash?.submittedToday ?? 0,
                  icon: CalendarDays,
                },
              ].map((card) => (
                <Card key={card.label}>
                  <CardContent className="flex items-center gap-3 pt-4">
                    <card.icon className="h-8 w-8 text-brand-600" />
                    <div>
                      <p className="text-xs text-slate-500">{card.label}</p>
                      <p className="text-2xl font-semibold">{card.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {dash?.myAssignments && dash.myAssignments.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">My field assignments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dash.myAssignments.map((a) => (
                    <div
                      key={a.scheduleId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <p className="font-medium">
                          {a.hospitalName} · {a.department}
                        </p>
                        <p className="text-xs text-slate-500">
                          {a.batchName} · {a.yearName} · {a.studentCount}{" "}
                          students · Attendance: {a.attendanceStatus ?? "NONE"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          setTab("mark");
                          void loadRosterForMarking(
                            a.scheduleId,
                            todayQuery.data?.[0]?.dateBs ?? "",
                          );
                        }}
                      >
                        Mark today
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Hospital-wise today</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(dash?.hospitalWise ?? []).length === 0 ? (
                    <p className="text-slate-500">No submissions today.</p>
                  ) : (
                    dash?.hospitalWise.map((h) => (
                      <div
                        key={h.hospital}
                        className="flex justify-between rounded-lg border border-slate-100 px-3 py-2"
                      >
                        <span>{h.hospital}</span>
                        <span>
                          P {h.present} / A {h.absent} / T {h.total}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Supervisor-wise today
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(dash?.supervisorWise ?? []).length === 0 ? (
                    <p className="text-slate-500">No submissions today.</p>
                  ) : (
                    dash?.supervisorWise.map((s) => (
                      <div
                        key={s.supervisorId}
                        className="flex justify-between rounded-lg border border-slate-100 px-3 py-2"
                      >
                        <span>{s.supervisorName}</span>
                        <span>
                          P {s.present} / A {s.absent}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )
      ) : null}

      {tab === "schedules" && isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create field duty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Academic year (BS)">
                <Input
                  value={scheduleForm.academicYearBs}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      academicYearBs: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Program / Faculty">
                <Input
                  value={scheduleForm.faculty}
                  onChange={(e) =>
                    setScheduleForm((c) => ({ ...c, faculty: e.target.value }))
                  }
                  placeholder="HA"
                />
              </FormField>
              <FormField label="Batch">
                <Select
                  value={scheduleForm.batchId}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      batchId: e.target.value,
                      yearId: "",
                    }))
                  }
                >
                  <option value="">Select batch</option>
                  {(batchesQuery.data ?? []).map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Current year">
                <Select
                  value={scheduleForm.yearId}
                  onChange={(e) =>
                    setScheduleForm((c) => ({ ...c, yearId: e.target.value }))
                  }
                >
                  <option value="">Select year</option>
                  {yearsForBatch.map((y) => (
                    <option key={y._id} value={y._id}>
                      {y.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Hospital / Institution">
                <Input
                  value={scheduleForm.hospitalName}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      hospitalName: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Department / Ward">
                <Input
                  value={scheduleForm.department}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      department: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Ward (optional)">
                <Input
                  value={scheduleForm.ward}
                  onChange={(e) =>
                    setScheduleForm((c) => ({ ...c, ward: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Field supervisor (staff)">
                <Select
                  value={scheduleForm.supervisorStaffId}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      supervisorStaffId: e.target.value,
                    }))
                  }
                >
                  <option value="">Select staff</option>
                  {(staffQuery.data ?? []).map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.fullName}
                      {s.designation ? ` · ${s.designation}` : ""}
                      {s.staffId ? ` (${s.staffId})` : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Clinical instructor">
                <Input
                  value={scheduleForm.clinicalInstructorName}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      clinicalInstructorName: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Hospital supervisor">
                <Input
                  value={scheduleForm.hospitalSupervisorName}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      hospitalSupervisorName: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Start date (BS)">
                <NepaliDateField
                  value={scheduleForm.startDateBs}
                  onChange={(v) =>
                    setScheduleForm((c) => ({ ...c, startDateBs: v }))
                  }
                />
              </FormField>
              <FormField label="End date (BS)">
                <NepaliDateField
                  value={scheduleForm.endDateBs}
                  onChange={(v) =>
                    setScheduleForm((c) => ({ ...c, endDateBs: v }))
                  }
                />
              </FormField>
              <FormField label="Shift">
                <Select
                  value={scheduleForm.shift}
                  onChange={(e) =>
                    setScheduleForm((c) => ({
                      ...c,
                      shift: e.target.value as FieldDutyShift,
                    }))
                  }
                >
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Remarks">
                <Textarea
                  value={scheduleForm.remarks}
                  onChange={(e) =>
                    setScheduleForm((c) => ({ ...c, remarks: e.target.value }))
                  }
                />
              </FormField>
              <Button
                disabled={createSchedule.isPending}
                onClick={() => {
                  if (
                    !scheduleForm.batchId ||
                    !scheduleForm.yearId ||
                    !scheduleForm.hospitalName ||
                    !scheduleForm.supervisorStaffId
                  ) {
                    toast.error("Fill required fields");
                    return;
                  }
                  createSchedule.mutate(scheduleForm);
                }}
              >
                Save schedule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active & past schedules</CardTitle>
            </CardHeader>
            <CardContent>
              {schedulesQuery.isLoading ? (
                <LoadingState />
              ) : (schedulesQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No field duties yet"
                  description="Create a hospital or community posting schedule. Eligible students load automatically from the selected batch and year."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Hospital</Th>
                        <Th>Batch / Year</Th>
                        <Th>Supervisor</Th>
                        <Th>Period</Th>
                        <Th>Students</Th>
                        <Th>Status</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {(schedulesQuery.data ?? []).map((s) => (
                        <tr key={s._id}>
                          <Td>
                            <p className="font-medium">{s.hospitalName}</p>
                            <p className="text-xs text-slate-500">
                              {s.department}
                              {s.ward ? ` · ${s.ward}` : ""}
                            </p>
                          </Td>
                          <Td className="text-sm">
                            {s.batch?.name} · {s.year?.name}
                          </Td>
                          <Td className="text-sm">
                            {s.supervisor?.fullName ??
                              s.supervisor?.user?.fullName ??
                              "—"}
                          </Td>
                          <Td className="text-xs whitespace-nowrap">
                            {s.startDateBs} → {s.endDateBs}
                            <br />
                            {s.shift}
                          </Td>
                          <Td>{s.studentCount ?? "—"}</Td>
                          <Td>
                            <Badge className={statusClass(s.status)}>
                              {s.status}
                            </Badge>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "mark" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Today&apos;s field duties
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {todayQuery.isLoading ? (
                <LoadingState />
              ) : (todayQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No active field duty today"
                  description={
                    isAdmin
                      ? "Create a duty schedule covering today's date and assign a supervisor."
                      : "You have no hospital/field duty assigned for today."
                  }
                />
              ) : (
                (todayQuery.data ?? []).map((ctx) => (
                  <div
                    key={ctx.schedule._id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div>
                      <p className="font-medium">
                        {ctx.schedule.hospitalName} · {ctx.schedule.department}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ctx.schedule.batch?.name} · {ctx.schedule.year?.name} ·{" "}
                        {ctx.students.length} students · {ctx.dateBs} ·{" "}
                        {ctx.existingAttendance
                          ? `Submitted (${ctx.existingAttendance.status})`
                          : "Pending"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={
                        ctx.existingAttendance &&
                        ctx.existingAttendance.status !== "DRAFT"
                          ? "outline"
                          : "default"
                      }
                      onClick={() =>
                        void loadRosterForMarking(ctx.schedule._id, ctx.dateBs)
                      }
                    >
                      {ctx.existingAttendance &&
                      ctx.existingAttendance.status !== "DRAFT"
                        ? "View roster"
                        : "Mark attendance"}
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {selectedScheduleId && markRows.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Mark students</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMarkRows((rows) =>
                        rows.map((r) => ({ ...r, status: "PRESENT" })),
                      )
                    }
                  >
                    Mark all present
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMarkRows((rows) =>
                        rows.map((r) => ({ ...r, status: "ABSENT" })),
                      )
                    }
                  >
                    Mark all absent
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Date (BS)">
                    <NepaliDateField
                      value={markDateBs}
                      onChange={setMarkDateBs}
                    />
                  </FormField>
                  <FormField label="Notes">
                    <Input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </FormField>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Roll</Th>
                        <Th>Student</Th>
                        <Th>Status</Th>
                        <Th>Remarks</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {markRows.map((row, index) => (
                        <tr key={row.studentId}>
                          <Td>{row.rollNumber}</Td>
                          <Td>
                            <p className="font-medium">{row.fullName}</p>
                            <p className="text-xs text-slate-500">
                              {row.admissionNumber}
                            </p>
                          </Td>
                          <Td>
                            <Select
                              value={row.status}
                              onChange={(e) =>
                                setMarkRows((rows) =>
                                  rows.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          status: e.target
                                            .value as FieldDutyStudentStatus,
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
                              value={row.remarks}
                              onChange={(e) =>
                                setMarkRows((rows) =>
                                  rows.map((r, i) =>
                                    i === index
                                      ? { ...r, remarks: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                              placeholder="Optional"
                            />
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  disabled={submitAttendance.isPending || !markDateBs}
                  onClick={() => submitAttendance.mutate()}
                >
                  Submit attendance (locks after save)
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "history" || tab === "reports" ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {tab === "reports"
                ? "Field duty reports"
                : "Submitted attendance history"}
            </CardTitle>
            {tab === "reports" ? (
              <Button size="sm" variant="outline" onClick={exportExcel}>
                Export Excel
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading ? (
              <LoadingState />
            ) : (historyQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No records yet"
                description="Submitted field duty attendance will appear here and stay in history after promotion."
              />
            ) : (
              <div className="space-y-4">
                {(historyQuery.data ?? []).map((rec) => (
                  <div
                    key={rec._id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {rec.dateBs} · {rec.hospitalName} · {rec.department}
                        </p>
                        <p className="text-xs text-slate-500">
                          Shift {rec.shift} ·{" "}
                          {rec.summary
                            ? `P${rec.summary.present} A${rec.summary.absent} L${rec.summary.late}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={statusClass(rec.status)}>
                          {rec.status}
                        </Badge>
                        {isAdmin &&
                        (rec.status === "LOCKED" ||
                          rec.status === "SUBMITTED") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unlockAttendance.mutate(rec._id)}
                          >
                            Unlock
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>Student</Th>
                            <Th>Status</Th>
                            <Th>Remarks</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {rec.entries.map((e) => (
                            <tr key={e.studentId}>
                              <Td>
                                {e.student?.fullName ?? e.studentId}
                                <span className="block text-xs text-slate-500">
                                  {e.student?.admissionNumber}
                                </span>
                              </Td>
                              <Td>
                                <Badge className={statusClass(e.status)}>
                                  {e.status}
                                </Badge>
                              </Td>
                              <Td className="text-sm">{e.remarks || "—"}</Td>
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
