import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BatchRecord,
  type CollegeStaffRecord,
  type FieldDutyAttendanceRecord,
  type FieldDutyRosterStudent,
  type FieldDutyScheduleRecord,
  type FieldDutyShift,
  type FieldDutyStudentStatus,
  type FieldPostingSection,
  type YearRecord,
} from "@phit-erp/shared";
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
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import {
  defaultPostingTypeForSection,
  FIELD_SHIFTS,
  FIELD_STATUSES,
  postingTypeLabel,
  postingTypeOptionsForSection,
  sectionLabel,
  statusClass,
} from "./fieldUtils";

type PanelTab = "postings" | "mark" | "history" | "reports";

interface MarkRow {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: number;
  status: FieldDutyStudentStatus;
  remarks: string;
}

interface Props {
  section: FieldPostingSection;
  isAdmin: boolean;
  canWrite: boolean;
  isCoordinatorView: boolean;
}

const defaultForm = (section: FieldPostingSection, academicYearBs = "") => ({
  academicYearBs,
  faculty: "HA",
  semesterBs: "",
  batchId: "",
  yearId: "",
  postingType: defaultPostingTypeForSection(section),
  siteName: "",
  hospitalName: "",
  address: "",
  department: "",
  ward: "",
  supervisorStaffId: "",
  assistantCoordinatorStaffIds: [] as string[],
  clinicalInstructorName: "",
  hospitalSupervisorName: "",
  startDateBs: "",
  endDateBs: "",
  shift: "DAY" as FieldDutyShift,
  remarks: "",
  status: "ACTIVE" as const,
  rosterMode: "AUTO_BATCH_YEAR" as "AUTO_BATCH_YEAR" | "MANUAL",
  assignedStudentIds: [] as string[],
});

export const FieldPostingSectionPanel = ({
  section,
  isAdmin,
  canWrite,
  isCoordinatorView,
}: Props) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>(isCoordinatorView ? "mark" : "postings");
  const [form, setForm] = useState(() => defaultForm(section));
  const [assistantPick, setAssistantPick] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [markDateBs, setMarkDateBs] = useState("");
  const [markRows, setMarkRows] = useState<MarkRow[]>([]);
  const [notes, setNotes] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);

  useEffect(() => {
    setForm((f) => ({
      ...defaultForm(section, f.academicYearBs),
      academicYearBs: f.academicYearBs,
    }));
    setTab(isCoordinatorView ? "mark" : "postings");
    setSelectedScheduleId("");
    setMarkRows([]);
  }, [section, isCoordinatorView]);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<{ academicYearBs: string }>(api.get("/settings")),
  });

  useEffect(() => {
    if (settingsQuery.data?.academicYearBs && !form.academicYearBs) {
      setForm((c) => ({ ...c, academicYearBs: settingsQuery.data.academicYearBs }));
    }
  }, [settingsQuery.data?.academicYearBs, form.academicYearBs]);

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
    queryKey: ["college-staff", "field-coordinators"],
    queryFn: () =>
      unwrap<CollegeStaffRecord[]>(
        api.get("/college-staff", { params: { status: "ACTIVE" } }),
      ),
    enabled: isAdmin,
  });

  const schedulesQuery = useQuery({
    queryKey: ["field-duty", "schedules", section],
    queryFn: () =>
      unwrap<FieldDutyScheduleRecord[]>(
        api.get("/field-duty/schedules", { params: { section } }),
      ),
  });

  const todayQuery = useQuery({
    queryKey: ["field-duty", "today", section],
    queryFn: () =>
      unwrap<
        Array<{
          dateBs: string;
          schedule: FieldDutyScheduleRecord;
          students: FieldDutyRosterStudent[];
          existingAttendance: FieldDutyAttendanceRecord | null;
        }>
      >(api.get("/field-duty/today", { params: { section } })),
    enabled: tab === "mark" || canWrite,
  });

  const historyQuery = useQuery({
    queryKey: ["field-duty", "attendance", section],
    queryFn: () =>
      unwrap<FieldDutyAttendanceRecord[]>(
        api.get("/field-duty/attendance", { params: { section } }),
      ),
    enabled: tab === "history" || tab === "reports",
  });

  const assignableQuery = useQuery({
    queryKey: [
      "field-duty",
      "assignable",
      form.batchId,
      form.yearId,
      form.faculty,
    ],
    queryFn: () =>
      unwrap<FieldDutyRosterStudent[]>(
        api.get("/field-duty/assignable-students", {
          params: {
            batchId: form.batchId || undefined,
            yearId: form.yearId || undefined,
            faculty: form.faculty || undefined,
          },
        }),
      ),
    enabled: isAdmin && form.rosterMode === "MANUAL" && !!form.batchId,
  });

  const yearsForBatch = useMemo(() => {
    const years = yearsQuery.data ?? [];
    if (!form.batchId) return years;
    return years.filter((y) => y.batchId === form.batchId);
  }, [yearsQuery.data, form.batchId]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["field-duty"] });
  };

  const savePosting = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        hospitalName: form.siteName,
        siteName: form.siteName,
        assistantCoordinatorStaffIds: form.assistantCoordinatorStaffIds,
      };
      if (editingScheduleId) {
        return unwrap(api.put(`/field-duty/schedules/${editingScheduleId}`, payload));
      }
      return unwrap(api.post("/field-duty/schedules", payload));
    },
    onSuccess: async () => {
      toast.success(editingScheduleId ? "Posting updated" : "Posting created");
      setForm(defaultForm(section, settingsQuery.data?.academicYearBs ?? ""));
      setEditingScheduleId(null);
      setAssistantPick("");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deletePosting = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/field-duty/schedules/${id}`)),
    onSuccess: async () => {
      toast.success("Posting deleted");
      await invalidate();
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
      toast.success("Attendance submitted (read-only until admin unlocks)");
      setNotes("");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const unlockAttendance = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Unlock reason (admin)");
      if (!reason) throw new Error("Unlock cancelled");
      return unwrap(api.post(`/field-duty/attendance/${id}/unlock`, { reason }));
    },
    onSuccess: async () => {
      toast.success("Attendance unlocked");
      await invalidate();
    },
    onError: (e) => {
      if (String(e).includes("cancelled")) return;
      toast.error(parseErrorMessage(e));
    },
  });

  const requestEdit = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Reason for edit request");
      if (!reason) throw new Error("cancelled");
      return unwrap(api.post(`/field-duty/attendance/${id}/edit-request`, { reason }));
    },
    onSuccess: async () => {
      toast.success("Edit request sent to admin");
      await invalidate();
    },
    onError: (e) => {
      if (String(e).includes("cancelled")) return;
      toast.error(parseErrorMessage(e));
    },
  });

  const reviewEdit = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "APPROVED" | "REJECTED";
    }) =>
      unwrap(
        api.post(`/field-duty/attendance/${id}/edit-review`, {
          decision,
          reviewNotes: decision === "APPROVED" ? "Approved" : "Rejected",
        }),
      ),
    onSuccess: async () => {
      toast.success("Edit request reviewed");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const loadRosterForMarking = async (
    scheduleId: string,
    dateBs: string,
    existing?: FieldDutyAttendanceRecord | null,
  ) => {
    setSelectedScheduleId(scheduleId);
    setMarkDateBs(dateBs);
    try {
      const data = await unwrap<{
        schedule: FieldDutyScheduleRecord;
        students: FieldDutyRosterStudent[];
      }>(api.get(`/field-duty/schedules/${scheduleId}/roster`));

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
        Section: sectionLabel(section),
        Type: postingTypeLabel(rec.postingType),
        Site: rec.siteName || rec.hospitalName,
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
    XLSX.utils.book_append_sheet(book, sheet, "Field Attendance");
    XLSX.writeFile(
      book,
      `field-${section === "HOSPITAL" ? "hospital" : "community"}-attendance.xlsx`,
    );
  };

  const printReport = () => {
    const rows = historyQuery.data ?? [];
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Pop-up blocked — allow pop-ups to print");
      return;
    }
    const body = rows
      .map((rec) => {
        const entries = rec.entries
          .map(
            (e) =>
              `<tr><td>${e.student?.rollNumber ?? ""}</td><td>${e.student?.fullName ?? ""}</td><td>${e.status}</td><td>${e.remarks ?? ""}</td></tr>`,
          )
          .join("");
        return `<h3>${rec.dateBs} — ${rec.siteName || rec.hospitalName} (${postingTypeLabel(rec.postingType)})</h3>
          <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px">
            <thead><tr><th>Roll</th><th>Name</th><th>Status</th><th>Remarks</th></tr></thead>
            <tbody>${entries}</tbody>
          </table>`;
      })
      .join("<hr/>");

    win.document.write(`<!DOCTYPE html><html><head><title>PHIT LMS — Field Attendance Report</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px} h1{font-size:18px} h3{font-size:14px;margin-top:16px}</style>
      </head><body>
      <h1>PHIT LMS — ${sectionLabel(section)} Attendance Report</h1>
      <p>Generated ${new Date().toLocaleString()}</p>
      ${body || "<p>No records.</p>"}
      <script>window.onload=()=>{window.print()}</script>
      </body></html>`);
    win.document.close();
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    ...(isAdmin ? [{ id: "postings" as const, label: "Posting Assignment" }] : []),
    { id: "mark", label: "Take Attendance" },
    { id: "history", label: "History" },
    { id: "reports", label: "Reports" },
  ];

  const typeOptions = postingTypeOptionsForSection(section);
  const staff = staffQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const existingForSelected = (todayQuery.data ?? []).find(
    (c) => c.schedule._id === selectedScheduleId,
  )?.existingAttendance;
  const isReadOnly =
    existingForSelected?.status === "LOCKED" ||
    existingForSelected?.status === "SUBMITTED";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{sectionLabel(section)}</h2>
        <p className="text-sm text-slate-600">
          Coordinators use their staff login. Attendance is locked after submit; edit requests go to admin.
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

      {tab === "postings" && isAdmin ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingScheduleId ? "Edit posting" : "Create field posting"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Academic Year">
                  <Input
                    value={form.academicYearBs}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, academicYearBs: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Faculty / Program">
                  <Input
                    value={form.faculty}
                    onChange={(e) => setForm((f) => ({ ...f, faculty: e.target.value }))}
                  />
                </FormField>
                <FormField label="Semester (optional)">
                  <Input
                    value={form.semesterBs}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, semesterBs: e.target.value }))
                    }
                    placeholder="e.g. 1st Semester"
                  />
                </FormField>
                <FormField label="Posting Type">
                  <Select
                    value={form.postingType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, postingType: e.target.value }))
                    }
                  >
                    {typeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Batch">
                  <Select
                    value={form.batchId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, batchId: e.target.value, yearId: "" }))
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
                <FormField label="Year">
                  <Select
                    value={form.yearId}
                    onChange={(e) => setForm((f) => ({ ...f, yearId: e.target.value }))}
                  >
                    <option value="">Select year</option>
                    {yearsForBatch.map((y) => (
                      <option key={y._id} value={y._id}>
                        {y.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>

              <FormField label="Hospital / PHC / Community Name">
                <Input
                  value={form.siteName}
                  onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                  placeholder="Site name"
                />
              </FormField>
              <FormField label="Address">
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Ward / Department (optional)">
                  <Input
                    value={form.department || form.ward}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        department: e.target.value,
                        ward: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Shift">
                  <Select
                    value={form.shift}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        shift: e.target.value as FieldDutyShift,
                      }))
                    }
                  >
                    {FIELD_SHIFTS.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Start Date (BS)">
                  <NepaliDateField
                    value={form.startDateBs}
                    onChange={(v) => setForm((f) => ({ ...f, startDateBs: v }))}
                  />
                </FormField>
                <FormField label="End Date (BS)">
                  <NepaliDateField
                    value={form.endDateBs}
                    onChange={(v) => setForm((f) => ({ ...f, endDateBs: v }))}
                  />
                </FormField>
              </div>

              <FormField label="Primary Field Coordinator (from Staff)">
                <Select
                  value={form.supervisorStaffId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, supervisorStaffId: e.target.value }))
                  }
                >
                  <option value="">Select coordinator</option>
                  {staff.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.fullName || s.staffId} {s.designation ? `· ${s.designation}` : ""}
                    </option>
                  ))}
                </Select>
              </FormField>

              <div className="space-y-2">
                <FormField label="Assistant Coordinators (optional)">
                  <div className="flex gap-2">
                    <Select
                      value={assistantPick}
                      onChange={(e) => setAssistantPick(e.target.value)}
                    >
                      <option value="">Add assistant…</option>
                      {staff
                        .filter(
                          (s) =>
                            s._id !== form.supervisorStaffId &&
                            !form.assistantCoordinatorStaffIds.includes(s._id),
                        )
                        .map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.fullName || s.staffId}
                          </option>
                        ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!assistantPick}
                      onClick={() => {
                        if (!assistantPick) return;
                        setForm((f) => ({
                          ...f,
                          assistantCoordinatorStaffIds: [
                            ...f.assistantCoordinatorStaffIds,
                            assistantPick,
                          ],
                        }));
                        setAssistantPick("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </FormField>
                {form.assistantCoordinatorStaffIds.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {form.assistantCoordinatorStaffIds.map((id) => {
                      const s = staff.find((x) => x._id === id);
                      return (
                        <Badge key={id} className="gap-1 bg-slate-100 text-slate-800">
                          {s?.fullName || id}
                          <button
                            type="button"
                            className="ml-1 text-rose-600"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                assistantCoordinatorStaffIds:
                                  f.assistantCoordinatorStaffIds.filter((x) => x !== id),
                              }))
                            }
                          >
                            ×
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <FormField label="Student roster mode">
                <Select
                  value={form.rosterMode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      rosterMode: e.target.value as "AUTO_BATCH_YEAR" | "MANUAL",
                      assignedStudentIds:
                        e.target.value === "AUTO_BATCH_YEAR" ? [] : f.assignedStudentIds,
                    }))
                  }
                >
                  <option value="AUTO_BATCH_YEAR">
                    Auto — all active students in Batch + Year
                  </option>
                  <option value="MANUAL">Manual — select students</option>
                </Select>
              </FormField>

              {form.rosterMode === "MANUAL" ? (
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      Assigned students ({form.assignedStudentIds.length})
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setStudentPickerOpen((v) => !v)}
                    >
                      {studentPickerOpen ? "Hide list" : "Select students"}
                    </Button>
                  </div>
                  {studentPickerOpen ? (
                    assignableQuery.isLoading ? (
                      <LoadingState />
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
                        {(assignableQuery.data ?? []).map((s) => {
                          const checked = form.assignedStudentIds.includes(s._id);
                          return (
                            <label
                              key={s._id}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setForm((f) => ({
                                    ...f,
                                    assignedStudentIds: checked
                                      ? f.assignedStudentIds.filter((id) => id !== s._id)
                                      : [...f.assignedStudentIds, s._id],
                                  }))
                                }
                              />
                              <span>
                                {s.rollNumber}. {s.fullName}{" "}
                                <span className="text-slate-400">
                                  ({s.admissionNumber})
                                </span>
                              </span>
                            </label>
                          );
                        })}
                        {(assignableQuery.data ?? []).length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Select batch (and year) to load students.
                          </p>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}

              <FormField label="Remarks">
                <Textarea
                  value={form.remarks}
                  onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                  rows={2}
                />
              </FormField>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => savePosting.mutate()}
                  disabled={savePosting.isPending}
                >
                  {editingScheduleId ? "Update posting" : "Create posting"}
                </Button>
                {editingScheduleId ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingScheduleId(null);
                      setForm(defaultForm(section, settingsQuery.data?.academicYearBs ?? ""));
                    }}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {sectionLabel(section)} list ({schedules.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {schedulesQuery.isLoading ? (
                <LoadingState />
              ) : schedules.length === 0 ? (
                <EmptyState
                  title="No postings yet"
                  description="Create a field posting to assign coordinators and students."
                />
              ) : (
                schedules.map((s) => (
                  <div
                    key={s._id}
                    className="rounded-xl border border-slate-200 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {s.siteName || s.hospitalName}{" "}
                          <Badge className="ml-1 bg-slate-100 text-slate-700">
                            {postingTypeLabel(s.postingType)}
                          </Badge>
                        </p>
                        <p className="text-xs text-slate-500">
                          {s.batch?.name} · {s.year?.name}
                          {s.semesterBs ? ` · ${s.semesterBs}` : ""} · {s.startDateBs} →{" "}
                          {s.endDateBs}
                        </p>
                        <p className="text-xs text-slate-500">
                          Coordinator:{" "}
                          {s.supervisor?.fullName || s.supervisor?.user?.fullName || "—"}
                          {s.assistants && s.assistants.length > 0
                            ? ` · Assistants: ${s.assistants.map((a) => a.fullName).join(", ")}`
                            : ""}
                          {" · "}
                          {s.studentCount ?? 0} students ({s.rosterMode ?? "AUTO"})
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingScheduleId(s._id);
                            setForm({
                              academicYearBs: s.academicYearBs,
                              faculty: s.faculty ?? "",
                              semesterBs: s.semesterBs ?? "",
                              batchId: s.batchId,
                              yearId: s.yearId,
                              postingType: s.postingType || defaultPostingTypeForSection(section),
                              siteName: s.siteName || s.hospitalName,
                              hospitalName: s.hospitalName,
                              address: s.address ?? "",
                              department: s.department ?? "",
                              ward: s.ward ?? "",
                              supervisorStaffId: s.supervisorStaffId,
                              assistantCoordinatorStaffIds:
                                s.assistantCoordinatorStaffIds ?? [],
                              clinicalInstructorName: s.clinicalInstructorName ?? "",
                              hospitalSupervisorName: s.hospitalSupervisorName ?? "",
                              startDateBs: s.startDateBs,
                              endDateBs: s.endDateBs,
                              shift: s.shift,
                              remarks: s.remarks ?? "",
                              status: s.status as "ACTIVE",
                              rosterMode: s.rosterMode ?? "AUTO_BATCH_YEAR",
                              assignedStudentIds: s.assignedStudentIds ?? [],
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-rose-700"
                          onClick={() => {
                            if (window.confirm("Delete this posting?")) {
                              deletePosting.mutate(s._id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "mark" && canWrite ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select posting & date</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {todayQuery.isLoading ? (
                <LoadingState />
              ) : (todayQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No active postings today"
                  description={
                    isCoordinatorView
                      ? "You have no assigned field duties active today."
                      : "Create an active posting whose date range includes today."
                  }
                />
              ) : (
                <div className="space-y-2">
                  {(todayQuery.data ?? []).map((ctx) => (
                    <div
                      key={ctx.schedule._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <p className="font-medium">
                          {ctx.schedule.siteName || ctx.schedule.hospitalName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {postingTypeLabel(ctx.schedule.postingType)} ·{" "}
                          {ctx.students.length} students ·{" "}
                          {ctx.existingAttendance
                            ? `Attendance: ${ctx.existingAttendance.status}`
                            : "Not submitted"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          void loadRosterForMarking(
                            ctx.schedule._id,
                            ctx.dateBs,
                            ctx.existingAttendance,
                          )
                        }
                      >
                        {ctx.existingAttendance ? "View / re-open" : "Take attendance"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {selectedScheduleId ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Attendance Date (BS)">
                      <NepaliDateField value={markDateBs} onChange={setMarkDateBs} />
                    </FormField>
                    <FormField label="Notes">
                      <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </FormField>
                  </div>

                  {isReadOnly ? (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Submitted attendance is read-only.
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          onClick={() =>
                            existingForSelected &&
                            unlockAttendance.mutate(existingForSelected._id)
                          }
                        >
                          Unlock
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          onClick={() =>
                            existingForSelected &&
                            requestEdit.mutate(existingForSelected._id)
                          }
                        >
                          Request edit
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {markRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No students in roster.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>Roll No</Th>
                            <Th>Student Name</Th>
                            <Th>Present</Th>
                            <Th>Absent</Th>
                            <Th>Late</Th>
                            <Th>Leave</Th>
                            <Th>Remarks</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {markRows.map((row, idx) => (
                            <tr key={row.studentId}>
                              <Td className="text-sm">{row.rollNumber}</Td>
                              <Td className="text-sm">
                                {row.fullName}
                                <div className="text-xs text-slate-400">
                                  {row.admissionNumber}
                                </div>
                              </Td>
                              {(["PRESENT", "ABSENT", "LATE", "LEAVE"] as const).map(
                                (st) => (
                                  <Td key={st} className="text-center">
                                    <input
                                      type="radio"
                                      name={`status-${row.studentId}`}
                                      disabled={isReadOnly}
                                      checked={row.status === st}
                                      onChange={() =>
                                        setMarkRows((rows) =>
                                          rows.map((r, i) =>
                                            i === idx ? { ...r, status: st } : r,
                                          ),
                                        )
                                      }
                                    />
                                  </Td>
                                ),
                              )}
                              <Td>
                                <Input
                                  className="min-w-[120px]"
                                  disabled={isReadOnly}
                                  value={row.remarks}
                                  onChange={(e) =>
                                    setMarkRows((rows) =>
                                      rows.map((r, i) =>
                                        i === idx
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

                  {!isReadOnly && markRows.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          // quick-fill remaining statuses if needed
                          setMarkRows((rows) =>
                            rows.map((r) =>
                              FIELD_STATUSES.includes(r.status)
                                ? r
                                : { ...r, status: "PRESENT" },
                            ),
                          );
                        }}
                        variant="outline"
                        type="button"
                      >
                        Fill blank as Present
                      </Button>
                      <Button
                        onClick={() => submitAttendance.mutate()}
                        disabled={submitAttendance.isPending || !markDateBs}
                      >
                        Submit attendance
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "history" || tab === "reports" ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {tab === "reports" ? "Reports" : "Attendance history"}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={exportExcel}>
                Excel
              </Button>
              <Button size="sm" variant="outline" onClick={printReport}>
                Print / PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading ? (
              <LoadingState />
            ) : (historyQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No attendance records"
                description="Submitted field attendance will appear here."
              />
            ) : (
              <div className="space-y-3">
                {(historyQuery.data ?? []).map((rec) => (
                  <div
                    key={rec._id}
                    className="rounded-xl border border-slate-200 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {rec.dateBs} · {rec.siteName || rec.hospitalName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {postingTypeLabel(rec.postingType)} ·{" "}
                          <Badge className={statusClass(rec.status)}>{rec.status}</Badge>
                          {rec.summary
                            ? ` · P ${rec.summary.present} A ${rec.summary.absent} L ${rec.summary.late} Lv ${rec.summary.leave}`
                            : ""}
                          {rec.editRequest?.status === "PENDING"
                            ? " · Edit request pending"
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {isAdmin && rec.editRequest?.status === "PENDING" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                reviewEdit.mutate({ id: rec._id, decision: "APPROVED" })
                              }
                            >
                              Approve edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                reviewEdit.mutate({ id: rec._id, decision: "REJECTED" })
                              }
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                        {isAdmin &&
                        (rec.status === "LOCKED" || rec.status === "SUBMITTED") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unlockAttendance.mutate(rec._id)}
                          >
                            Unlock
                          </Button>
                        ) : null}
                        {!isAdmin &&
                        (rec.status === "LOCKED" || rec.status === "SUBMITTED") &&
                        rec.editRequest?.status !== "PENDING" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => requestEdit.mutate(rec._id)}
                          >
                            Request edit
                          </Button>
                        ) : null}
                      </div>
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
