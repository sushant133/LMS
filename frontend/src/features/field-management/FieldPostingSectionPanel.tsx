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
  rosterMode: "AUTO_BATCH_YEAR" as "AUTO_BATCH_YEAR" | "MANUAL" | "MULTI_SHIFT",
  assignedStudentIds: [] as string[],
  /** studentId → shift for MULTI_SHIFT mode */
  studentShiftMap: {} as Record<string, FieldDutyShift>,
});

export const FieldPostingSectionPanel = ({
  section,
  isAdmin,
  canWrite,
  isCoordinatorView,
}: Props) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>(
    canWrite && isCoordinatorView ? "mark" : "postings",
  );
  const [form, setForm] = useState(() => defaultForm(section));
  const [assistantPick, setAssistantPick] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  /** Full schedule metadata for the posting currently being marked. */
  const [selectedSchedule, setSelectedSchedule] =
    useState<FieldDutyScheduleRecord | null>(null);
  const [markDateBs, setMarkDateBs] = useState("");
  const [markRows, setMarkRows] = useState<MarkRow[]>([]);
  const [notes, setNotes] = useState("");
  /** Filter postings by duty shift when taking attendance (empty = all shifts). */
  const [shiftFilter, setShiftFilter] = useState<"" | FieldDutyShift>("");
  /**
   * Shift selected for marking attendance on a MULTI_SHIFT posting
   * (or the posting's single shift for single-mode).
   */
  const [markShift, setMarkShift] = useState<FieldDutyShift | "">("");
  /** Attendance record currently loaded for mark panel (authoritative for read-only). */
  const [loadedAttendance, setLoadedAttendance] =
    useState<FieldDutyAttendanceRecord | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);

  useEffect(() => {
    setForm((f) => ({
      ...defaultForm(section, f.academicYearBs),
      academicYearBs: f.academicYearBs,
    }));
    setTab(canWrite && isCoordinatorView ? "mark" : "postings");
    setSelectedScheduleId("");
    setSelectedSchedule(null);
    setMarkRows([]);
    setLoadedAttendance(null);
    setNotes("");
    setShiftFilter("");
    setMarkShift("");
  }, [section, isCoordinatorView, canWrite]);

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
          attendanceByShift?: Record<string, FieldDutyAttendanceRecord>;
          isMultiShift?: boolean;
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
    enabled:
      isAdmin &&
      (form.rosterMode === "MANUAL" || form.rosterMode === "MULTI_SHIFT") &&
      !!form.batchId &&
      !!form.yearId,
  });

  const multiShiftCounts = useMemo(() => {
    const counts: Partial<Record<FieldDutyShift, number>> = {};
    for (const sh of Object.values(form.studentShiftMap)) {
      if (!sh) continue;
      counts[sh] = (counts[sh] ?? 0) + 1;
    }
    return counts;
  }, [form.studentShiftMap]);

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
      if (!form.batchId || !form.yearId) {
        throw new Error("Select batch and year");
      }
      if (!form.siteName.trim()) {
        throw new Error("Hospital / PHC / Community name is required");
      }
      if (!form.supervisorStaffId) {
        throw new Error("Select a primary field coordinator");
      }
      if (!form.startDateBs || !form.endDateBs) {
        throw new Error("Start and end dates are required");
      }
      if (form.rosterMode === "MANUAL" && form.assignedStudentIds.length === 0) {
        throw new Error("Select at least one student for manual roster");
      }
      if (form.rosterMode === "MULTI_SHIFT") {
        const assigned = Object.entries(form.studentShiftMap).filter(([, sh]) => !!sh);
        if (assigned.length === 0) {
          throw new Error(
            "Assign students to shifts (e.g. 10 Morning, 10 Day, 10 Night, 10 Full day)",
          );
        }
      }

      // Explicit payload only — avoid spreading UI-only fields into the API body.
      const payload = {
        academicYearBs: form.academicYearBs,
        faculty: form.faculty,
        semesterBs: form.semesterBs,
        batchId: form.batchId,
        yearId: form.yearId,
        postingType: form.postingType,
        siteName: form.siteName,
        hospitalName: form.siteName,
        address: form.address,
        department: form.department,
        ward: form.ward,
        supervisorStaffId: form.supervisorStaffId,
        assistantCoordinatorStaffIds: form.assistantCoordinatorStaffIds,
        clinicalInstructorName: form.clinicalInstructorName,
        hospitalSupervisorName: form.hospitalSupervisorName,
        startDateBs: form.startDateBs,
        endDateBs: form.endDateBs,
        // Single-shift default; for MULTI_SHIFT attendance uses each student's shift
        shift: form.rosterMode === "MULTI_SHIFT" ? "DAY" : form.shift,
        remarks: form.remarks,
        status: form.status,
        rosterMode: form.rosterMode,
        assignedStudentIds:
          form.rosterMode === "MANUAL" ? form.assignedStudentIds : [],
        studentShifts:
          form.rosterMode === "MULTI_SHIFT"
            ? Object.entries(form.studentShiftMap)
                .filter(([, shift]) => !!shift)
                .map(([studentId, shift]) => ({
                  studentId,
                  shift,
                }))
            : [],
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
      setStudentPickerOpen(false);
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
    mutationFn: () => {
      const isMulti = selectedSchedule?.rosterMode === "MULTI_SHIFT";
      const shift =
        markShift ||
        selectedSchedule?.shift ||
        "DAY";
      if (isMulti && !markShift) {
        throw new Error("Select a shift before submitting multi-shift attendance");
      }
      return unwrap(
        api.post("/field-duty/attendance", {
          scheduleId: selectedScheduleId,
          dateBs: markDateBs,
          shift,
          notes,
          entries: markRows.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            remarks: r.remarks,
          })),
        }),
      );
    },
    onSuccess: async (data) => {
      toast.success(
        markShift
          ? `${markShift.replace(/_/g, " ")} shift attendance submitted`
          : "Attendance submitted (read-only until admin unlocks)",
      );
      setLoadedAttendance(data as FieldDutyAttendanceRecord);
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
    onSuccess: async (data) => {
      toast.success("Attendance unlocked");
      setLoadedAttendance(data as FieldDutyAttendanceRecord);
      await invalidate();
      if (selectedScheduleId && markDateBs) {
        void loadRosterForMarking(
          selectedScheduleId,
          markDateBs,
          data as FieldDutyAttendanceRecord,
          markShift || (data as FieldDutyAttendanceRecord).shift || "",
        );
      }
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

  /**
   * Load roster for one posting (+ optional shift for MULTI_SHIFT).
   * Attendance is always looked up by scheduleId + dateBs + shift.
   */
  const loadRosterForMarking = async (
    scheduleId: string,
    dateBs: string,
    existing?: FieldDutyAttendanceRecord | null,
    shiftForMark?: FieldDutyShift | "",
  ) => {
    setSelectedScheduleId(scheduleId);
    setMarkDateBs(dateBs);
    try {
      // First fetch schedule meta (no filter) so we know multi vs single
      const meta = await unwrap<{
        schedule: FieldDutyScheduleRecord;
        students: FieldDutyRosterStudent[];
      }>(api.get(`/field-duty/schedules/${scheduleId}/roster`));

      const isMulti = meta.schedule.rosterMode === "MULTI_SHIFT";
      const usedShifts: FieldDutyShift[] =
        meta.schedule.shiftsUsed && meta.schedule.shiftsUsed.length > 0
          ? meta.schedule.shiftsUsed
          : isMulti
            ? (FIELD_SHIFTS.filter(
                (s) => (meta.schedule.shiftCounts?.[s] ?? 0) > 0,
              ) as FieldDutyShift[])
            : [meta.schedule.shift || "DAY"];

      const activeShift: FieldDutyShift =
        (shiftForMark as FieldDutyShift) ||
        (isMulti
          ? usedShifts[0] || "DAY"
          : meta.schedule.shift || "DAY");

      setMarkShift(activeShift);
      setSelectedSchedule(meta.schedule);

      const roster = isMulti
        ? await unwrap<{
            schedule: FieldDutyScheduleRecord;
            students: FieldDutyRosterStudent[];
          }>(
            api.get(`/field-duty/schedules/${scheduleId}/roster`, {
              params: { shift: activeShift },
            }),
          )
        : meta;

      if (isMulti) setSelectedSchedule(roster.schedule);

      let attendance = existing ?? null;
      if (
        attendance &&
        attendance.shift &&
        attendance.shift !== activeShift
      ) {
        attendance = null;
      }
      if (!attendance && dateBs) {
        const list = await unwrap<FieldDutyAttendanceRecord[]>(
          api.get("/field-duty/attendance", {
            params: {
              scheduleId,
              dateBs,
              shift: activeShift,
            },
          }),
        );
        attendance = list[0] ?? null;
      }
      setLoadedAttendance(attendance);

      setMarkRows(
        roster.students.map((s) => {
          const prev = attendance?.entries.find((e) => e.studentId === s._id);
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
      if (attendance?.notes) setNotes(attendance.notes);
      else setNotes("");
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  /** When user changes attendance date, re-load roster + existing record for that date. */
  const onMarkDateChange = (dateBs: string) => {
    setMarkDateBs(dateBs);
    if (selectedScheduleId && dateBs) {
      void loadRosterForMarking(selectedScheduleId, dateBs, null, markShift);
    }
  };

  const onMarkShiftChange = (shift: FieldDutyShift) => {
    setMarkShift(shift);
    if (selectedScheduleId) {
      void loadRosterForMarking(
        selectedScheduleId,
        markDateBs || selectedSchedule?.startDateBs || "",
        null,
        shift,
      );
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
        return `<h3>${rec.dateBs} — ${rec.siteName || rec.hospitalName} · Shift ${rec.shift} (${postingTypeLabel(rec.postingType)})</h3>
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
    {
      id: "postings" as const,
      label: isAdmin ? "Posting Assignment" : "Assigned postings",
    },
    ...(canWrite ? [{ id: "mark" as const, label: "Take Attendance" }] : []),
    { id: "history", label: "History" },
    { id: "reports", label: "Reports" },
  ];

  const typeOptions = postingTypeOptionsForSection(section);
  const staff = staffQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const isReadOnly =
    loadedAttendance?.status === "LOCKED" ||
    loadedAttendance?.status === "SUBMITTED";

  /**
   * Active postings expanded to shift cards.
   * MULTI_SHIFT postings → one card per used shift (Morning 10, Day 10, …).
   * Single-shift postings → one card with posting.shift.
   */
  const markablePostings = useMemo(() => {
    type MarkCard = {
      key: string;
      schedule: FieldDutyScheduleRecord;
      shift: FieldDutyShift;
      dateBs: string;
      studentCount: number;
      existingAttendance: FieldDutyAttendanceRecord | null;
      activeToday: boolean;
      isMultiShift: boolean;
    };
    const todayCtx = todayQuery.data ?? [];
    const todayById = new Map(todayCtx.map((c) => [c.schedule._id, c]));
    const active = schedules.filter((s) => s.status === "ACTIVE");
    const cards: MarkCard[] = [];

    for (const s of active) {
      const ctx = todayById.get(s._id);
      const isMulti = s.rosterMode === "MULTI_SHIFT";
      const dateBs = ctx?.dateBs ?? markDateBs;
      const activeToday = Boolean(ctx);

      if (isMulti) {
        const used: FieldDutyShift[] =
          s.shiftsUsed && s.shiftsUsed.length > 0
            ? s.shiftsUsed
            : (FIELD_SHIFTS.filter(
                (sh) => (s.shiftCounts?.[sh] ?? 0) > 0,
              ) as FieldDutyShift[]);
        for (const sh of used) {
          if (shiftFilter && sh !== shiftFilter) continue;
          const att =
            ctx?.attendanceByShift?.[sh] ??
            (ctx?.existingAttendance?.shift === sh
              ? ctx.existingAttendance
              : null);
          cards.push({
            key: `${s._id}:${sh}`,
            schedule: s,
            shift: sh,
            dateBs,
            studentCount: s.shiftCounts?.[sh] ?? 0,
            existingAttendance: att ?? null,
            activeToday,
            isMultiShift: true,
          });
        }
      } else {
        const sh = (s.shift || "DAY") as FieldDutyShift;
        if (shiftFilter && sh !== shiftFilter) continue;
        cards.push({
          key: `${s._id}:${sh}`,
          schedule: s,
          shift: sh,
          dateBs,
          studentCount: ctx?.students.length ?? s.studentCount ?? 0,
          existingAttendance: ctx?.existingAttendance ?? null,
          activeToday,
          isMultiShift: false,
        });
      }
    }
    return cards;
  }, [schedules, todayQuery.data, shiftFilter, markDateBs]);

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

      {tab === "postings" ? (
        <div className={`grid gap-4 ${isAdmin ? "lg:grid-cols-2" : ""}`}>
          {isAdmin ? (
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
                {form.rosterMode !== "MULTI_SHIFT" ? (
                  <FormField label="Shift (all roster students)">
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
                ) : (
                  <FormField label="Shift assignment">
                    <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                      Multi-shift mode: assign each student a shift below. Attendance is
                      taken separately per shift.
                    </p>
                  </FormField>
                )}
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
                  onChange={(e) => {
                    const mode = e.target.value as
                      | "AUTO_BATCH_YEAR"
                      | "MANUAL"
                      | "MULTI_SHIFT";
                    setForm((f) => ({
                      ...f,
                      rosterMode: mode,
                      assignedStudentIds:
                        mode === "MANUAL" ? f.assignedStudentIds : [],
                      studentShiftMap:
                        mode === "MULTI_SHIFT" ? f.studentShiftMap : {},
                    }));
                    if (mode === "MULTI_SHIFT" || mode === "MANUAL") {
                      setStudentPickerOpen(true);
                    }
                  }}
                >
                  <option value="AUTO_BATCH_YEAR">
                    Auto — all batch + year students (one shift)
                  </option>
                  <option value="MANUAL">Manual — select students (one shift)</option>
                  <option value="MULTI_SHIFT">
                    Multi-shift — assign each student to Morning / Day / Night / Full day
                  </option>
                </Select>
              </FormField>

              {form.rosterMode === "MULTI_SHIFT" ? (
                <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Assign each student a duty shift
                    </p>
                    <p className="text-xs text-slate-600">
                      Example: 40 students → 10 Morning, 10 Day, 10 Night, 10 Full day.
                      Attendance is taken separately for each shift.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {FIELD_SHIFTS.map((s) => (
                      <Badge key={s} className="bg-white text-slate-800 ring-1 ring-slate-200">
                        {s.replace(/_/g, " ")}: {multiShiftCounts[s] ?? 0}
                      </Badge>
                    ))}
                    <Badge className="bg-slate-800 text-white">
                      Assigned: {Object.keys(form.studentShiftMap).length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setStudentPickerOpen((v) => !v)}
                    >
                      {studentPickerOpen ? "Hide students" : "Show students"}
                    </Button>
                    {(assignableQuery.data ?? []).length > 0 ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            // Even split across MORNING / DAY / NIGHT / FULL_DAY (common hospital pattern)
                            const targets: FieldDutyShift[] = [
                              "MORNING",
                              "DAY",
                              "NIGHT",
                              "FULL_DAY",
                            ];
                            const students = [...(assignableQuery.data ?? [])].sort(
                              (a, b) => a.rollNumber - b.rollNumber,
                            );
                            const map: Record<string, FieldDutyShift> = {};
                            const n = students.length;
                            const base = Math.floor(n / targets.length);
                            let rem = n % targets.length;
                            let idx = 0;
                            for (const sh of targets) {
                              const take = base + (rem > 0 ? 1 : 0);
                              if (rem > 0) rem -= 1;
                              for (let i = 0; i < take && idx < n; i += 1, idx += 1) {
                                map[students[idx]._id] = sh;
                              }
                            }
                            setForm((f) => ({ ...f, studentShiftMap: map }));
                            toast.success(
                              `Split ${n} students across Morning / Day / Night / Full day`,
                            );
                          }}
                        >
                          Auto-split 4 ways (M/D/N/Full)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const students = assignableQuery.data ?? [];
                            const map: Record<string, FieldDutyShift> = {
                              ...form.studentShiftMap,
                            };
                            const unassigned = students.filter((s) => !map[s._id]);
                            unassigned.forEach((s, i) => {
                              map[s._id] = FIELD_SHIFTS[i % FIELD_SHIFTS.length];
                            });
                            setForm((f) => ({ ...f, studentShiftMap: map }));
                            toast.success(
                              `Assigned ${unassigned.length} unassigned students evenly`,
                            );
                          }}
                        >
                          Fill unassigned evenly
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setForm((f) => ({ ...f, studentShiftMap: {} }));
                            toast.message("Cleared all shift assignments");
                          }}
                        >
                          Clear all
                        </Button>
                      </>
                    ) : null}
                  </div>
                  {studentPickerOpen ? (
                    assignableQuery.isLoading ? (
                      <LoadingState />
                    ) : !form.batchId || !form.yearId ? (
                      <p className="text-xs text-slate-500">
                        Select batch and year first to load students.
                      </p>
                    ) : (assignableQuery.data ?? []).length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No active students found for this batch and year.
                      </p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                        <Table>
                          <TableHead>
                            <tr>
                              <Th>Roll</Th>
                              <Th>Student</Th>
                              <Th>Shift</Th>
                            </tr>
                          </TableHead>
                          <TableBody>
                            {(assignableQuery.data ?? []).map((s) => (
                              <tr key={s._id}>
                                <Td className="text-sm">{s.rollNumber}</Td>
                                <Td className="text-sm">
                                  {s.fullName}
                                  <div className="text-xs text-slate-400">
                                    {s.admissionNumber}
                                  </div>
                                </Td>
                                <Td>
                                  <Select
                                    className="min-w-[130px]"
                                    value={form.studentShiftMap[s._id] ?? ""}
                                    onChange={(e) => {
                                      const val = e.target.value as FieldDutyShift | "";
                                      setForm((f) => {
                                        const next = { ...f.studentShiftMap };
                                        if (!val) delete next[s._id];
                                        else next[s._id] = val;
                                        return { ...f, studentShiftMap: next };
                                      });
                                    }}
                                  >
                                    <option value="">— Unassigned —</option>
                                    {FIELD_SHIFTS.map((sh) => (
                                      <option key={sh} value={sh}>
                                        {sh.replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </Select>
                                </Td>
                              </tr>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}

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
          ) : null}

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
                  description={
                    isAdmin
                      ? "Create a field posting to assign coordinators and students."
                      : "No field postings are assigned to you in this section."
                  }
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
                          {s.semesterBs ? ` · ${s.semesterBs}` : ""}
                          {" · "}
                          {s.rosterMode === "MULTI_SHIFT" ? (
                            <span className="font-medium text-indigo-700">
                              Multi-shift roster
                            </span>
                          ) : (
                            <span className="font-medium text-indigo-700">
                              Shift: {(s.shift || "DAY").replace(/_/g, " ")}
                            </span>
                          )}
                          {" · "}
                          {s.startDateBs} → {s.endDateBs}
                        </p>
                        <p className="text-xs text-slate-500">
                          Coordinator:{" "}
                          {s.supervisor?.fullName || s.supervisor?.user?.fullName || "—"}
                          {s.assistants && s.assistants.length > 0
                            ? ` · Assistants: ${s.assistants.map((a) => a.fullName).join(", ")}`
                            : ""}
                          {" · "}
                          {s.studentCount ?? 0} students ({s.rosterMode ?? "AUTO"})
                          {s.rosterMode === "MULTI_SHIFT" && s.shiftCounts
                            ? ` · ${FIELD_SHIFTS.filter((sh) => (s.shiftCounts?.[sh] ?? 0) > 0)
                                .map(
                                  (sh) =>
                                    `${sh.replace(/_/g, " ")}: ${s.shiftCounts?.[sh] ?? 0}`,
                                )
                                .join(", ")}`
                            : ""}
                        </p>
                      </div>
                      {isAdmin ? (
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
                                postingType:
                                  s.postingType || defaultPostingTypeForSection(section),
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
                                studentShiftMap: Object.fromEntries(
                                  (s.studentShifts ?? []).map((r) => [
                                    r.studentId,
                                    r.shift as FieldDutyShift,
                                  ]),
                                ),
                              });
                              if (s.rosterMode === "MULTI_SHIFT" || s.rosterMode === "MANUAL") {
                                setStudentPickerOpen(true);
                              }
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
                      ) : canWrite ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setTab("mark");
                            const firstShift =
                              s.rosterMode === "MULTI_SHIFT"
                                ? s.shiftsUsed?.[0] ||
                                  FIELD_SHIFTS.find(
                                    (sh) => (s.shiftCounts?.[sh] ?? 0) > 0,
                                  ) ||
                                  "DAY"
                                : s.shift || "DAY";
                            void loadRosterForMarking(
                              s._id,
                              s.startDateBs,
                              null,
                              firstShift,
                            );
                          }}
                        >
                          Take attendance
                        </Button>
                      ) : null}
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
              <CardTitle className="text-base">
                Take attendance (shift-wise)
              </CardTitle>
              <p className="text-sm font-normal text-slate-500">
                Open a posting, pick the duty shift (for multi-shift postings only students
                on that shift appear), mark Present / Absent / Late / Leave, then submit.
                Mark each shift separately (e.g. Morning, then Day, then Night).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Filter by shift">
                  <Select
                    value={shiftFilter}
                    onChange={(e) =>
                      setShiftFilter((e.target.value || "") as "" | FieldDutyShift)
                    }
                  >
                    <option value="">All shifts</option>
                    {FIELD_SHIFTS.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>

              {schedulesQuery.isLoading || todayQuery.isLoading ? (
                <LoadingState />
              ) : markablePostings.length === 0 ? (
                <EmptyState
                  title={
                    shiftFilter
                      ? `No ${shiftFilter.replace(/_/g, " ")} postings assigned`
                      : "No active postings"
                  }
                  description={
                    isCoordinatorView
                      ? "You have no assigned field postings for this section (and shift filter). Ask admin to assign you as field coordinator."
                      : "Create an active posting and assign a coordinator first."
                  }
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Shift rosters to mark
                    {shiftFilter ? ` · ${shiftFilter.replace(/_/g, " ")}` : " · all shifts"}
                  </p>
                  {markablePostings.map((ctx) => {
                    const isSelected =
                      selectedScheduleId === ctx.schedule._id &&
                      markShift === ctx.shift;
                    const submitted =
                      ctx.existingAttendance?.status === "LOCKED" ||
                      ctx.existingAttendance?.status === "SUBMITTED";
                    return (
                      <div
                        key={ctx.key}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
                          isSelected
                            ? "border-brand-500 bg-brand-50/50"
                            : "border-slate-200"
                        }`}
                      >
                        <div>
                          <p className="font-medium">
                            {ctx.schedule.siteName || ctx.schedule.hospitalName}
                            <Badge className="ml-2 bg-indigo-100 text-indigo-800">
                              {ctx.shift.replace(/_/g, " ")}
                            </Badge>
                            {ctx.isMultiShift ? (
                              <Badge className="ml-1 bg-violet-100 text-violet-800">
                                multi-shift
                              </Badge>
                            ) : null}
                            {submitted ? (
                              <Badge className="ml-1 bg-emerald-100 text-emerald-800">
                                {ctx.existingAttendance?.status}
                              </Badge>
                            ) : (
                              <Badge className="ml-1 bg-amber-100 text-amber-900">
                                Not submitted
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-slate-600">
                            <span className="font-medium">
                              {ctx.schedule.batch?.name ?? "Batch"} ·{" "}
                              {ctx.schedule.year?.name ?? "Year"}
                            </span>
                            {" · "}
                            {postingTypeLabel(ctx.schedule.postingType)}
                            {" · "}
                            <span className="font-medium">{ctx.studentCount}</span>{" "}
                            students on this shift
                            {ctx.activeToday ? (
                              <span className="ml-1 text-emerald-700">· Active today</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500">
                            {ctx.schedule.startDateBs} → {ctx.schedule.endDateBs}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => {
                            const date =
                              ctx.dateBs ||
                              markDateBs ||
                              ctx.schedule.startDateBs ||
                              "";
                            void loadRosterForMarking(
                              ctx.schedule._id,
                              date,
                              ctx.existingAttendance,
                              ctx.shift,
                            );
                          }}
                        >
                          {submitted && isSelected
                            ? "View / re-open"
                            : isSelected
                              ? "Selected"
                              : `Mark ${ctx.shift.replace(/_/g, " ")}`}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedScheduleId && selectedSchedule ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                    <p className="font-semibold text-slate-900">
                      {selectedSchedule.siteName || selectedSchedule.hospitalName}
                    </p>
                    <p className="mt-1 text-slate-600">
                      <span className="font-medium">Batch:</span>{" "}
                      {selectedSchedule.batch?.name ?? "—"}
                      {" · "}
                      <span className="font-medium">Year:</span>{" "}
                      {selectedSchedule.year?.name ?? "—"}
                      {" · "}
                      <span className="font-medium">{markRows.length}</span> students on this
                      shift
                    </p>
                    {selectedSchedule.rosterMode === "MULTI_SHIFT" &&
                    selectedSchedule.shiftCounts ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Shift split:{" "}
                        {FIELD_SHIFTS.filter(
                          (sh) => (selectedSchedule.shiftCounts?.[sh] ?? 0) > 0,
                        )
                          .map(
                            (sh) =>
                              `${sh.replace(/_/g, " ")} (${selectedSchedule.shiftCounts?.[sh] ?? 0})`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="Attendance Date (BS)">
                      <NepaliDateField value={markDateBs} onChange={onMarkDateChange} />
                    </FormField>
                    <FormField
                      label={
                        selectedSchedule.rosterMode === "MULTI_SHIFT"
                          ? "Duty shift (required)"
                          : "Duty shift"
                      }
                    >
                      <Select
                        value={
                          markShift ||
                          (selectedSchedule.rosterMode === "MULTI_SHIFT"
                            ? ""
                            : selectedSchedule.shift || "DAY")
                        }
                        disabled={
                          isReadOnly ||
                          selectedSchedule.rosterMode !== "MULTI_SHIFT"
                        }
                        onChange={(e) =>
                          onMarkShiftChange(e.target.value as FieldDutyShift)
                        }
                      >
                        {selectedSchedule.rosterMode === "MULTI_SHIFT" ? (
                          <>
                            <option value="">Select shift…</option>
                            {(selectedSchedule.shiftsUsed?.length
                              ? selectedSchedule.shiftsUsed
                              : FIELD_SHIFTS.filter(
                                  (s) =>
                                    (selectedSchedule.shiftCounts?.[s] ?? 0) > 0,
                                )
                            ).map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")} (
                                {selectedSchedule.shiftCounts?.[s] ?? 0} students)
                              </option>
                            ))}
                          </>
                        ) : (
                          <option value={selectedSchedule.shift || "DAY"}>
                            {(selectedSchedule.shift || "DAY").replace(/_/g, " ")}
                          </option>
                        )}
                      </Select>
                    </FormField>
                    <FormField label="Notes (optional)">
                      <Input
                        value={notes}
                        disabled={isReadOnly}
                        onChange={(e) => setNotes(e.target.value)}
                      />
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
                            loadedAttendance &&
                            unlockAttendance.mutate(loadedAttendance._id)
                          }
                        >
                          Unlock
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          disabled={loadedAttendance?.editRequest?.status === "PENDING"}
                          onClick={() =>
                            loadedAttendance &&
                            requestEdit.mutate(loadedAttendance._id)
                          }
                        >
                          {loadedAttendance?.editRequest?.status === "PENDING"
                            ? "Edit request pending"
                            : "Request edit"}
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {markRows.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No students in roster for this batch/year (or manual list is empty).
                    </p>
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
                          setMarkRows((rows) =>
                            rows.map((r) => ({ ...r, status: "PRESENT" })),
                          );
                        }}
                        variant="outline"
                        type="button"
                      >
                        Mark all Present
                      </Button>
                      <Button
                        onClick={() => {
                          setMarkRows((rows) =>
                            rows.map((r) => ({ ...r, status: "ABSENT" })),
                          );
                        }}
                        variant="outline"
                        type="button"
                      >
                        Mark all Absent
                      </Button>
                      <Button
                        onClick={() => submitAttendance.mutate()}
                        disabled={
                          submitAttendance.isPending ||
                          !markDateBs ||
                          (selectedSchedule.rosterMode === "MULTI_SHIFT" && !markShift)
                        }
                      >
                        Submit{" "}
                        {markShift
                          ? `${markShift.replace(/_/g, " ")} shift `
                          : ""}
                        attendance
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
