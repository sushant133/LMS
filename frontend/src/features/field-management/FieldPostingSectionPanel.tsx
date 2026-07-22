import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BatchRecord,
  type CollegeStaffRecord,
  type FieldDutyAttendanceRecord,
  type FieldDutyRegisterBook,
  type FieldDutyRosterStudent,
  type FieldDutyScheduleRecord,
  type FieldDutyShift,
  type FieldDutyStudentStatus,
  type FieldPostingSection,
  type YearRecord,
} from "@phit-erp/shared";
import { formatBsDate, getTodayBs } from "@munatech/nepali-datepicker";
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
  /** Included on today's daily roster for this date+shift */
  onRoster: boolean;
  status: FieldDutyStudentStatus;
  remarks: string;
}

const todayBsString = () => {
  try {
    return formatBsDate(getTodayBs(), "YYYY-MM-DD");
  } catch {
    return "";
  }
};

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
  rosterMode: "DAILY" as "AUTO_BATCH_YEAR" | "MANUAL" | "MULTI_SHIFT" | "DAILY",
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
  const [markDateBs, setMarkDateBs] = useState(() => todayBsString());
  const [markRows, setMarkRows] = useState<MarkRow[]>([]);
  const [notes, setNotes] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  /** Filter postings list by shift (optional). */
  const [shiftFilter, setShiftFilter] = useState<"" | FieldDutyShift>("");
  /** Shift for this day's register sheet. */
  const [markShift, setMarkShift] = useState<FieldDutyShift>("DAY");
  /** Attendance record currently loaded for mark panel (authoritative for read-only). */
  const [loadedAttendance, setLoadedAttendance] =
    useState<FieldDutyAttendanceRecord | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [loadingMark, setLoadingMark] = useState(false);

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
    setMarkShift("DAY");
    setMarkDateBs(todayBsString());
    setRosterSearch("");
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

  const registerQuery = useQuery({
    queryKey: ["field-duty", "register", section],
    queryFn: () =>
      unwrap<FieldDutyRegisterBook>(
        api.get("/field-duty/register", { params: { section } }),
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
      if (!markDateBs) throw new Error("Select attendance date (BS)");
      if (!markShift) throw new Error("Select duty shift for this day");
      const onDuty = markRows.filter((r) => r.onRoster);
      if (onDuty.length === 0) {
        throw new Error("Select at least one student for today's roster");
      }
      return unwrap(
        api.post("/field-duty/attendance", {
          scheduleId: selectedScheduleId,
          dateBs: markDateBs,
          shift: markShift,
          notes,
          entries: onDuty.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            remarks: r.remarks,
          })),
        }),
      );
    },
    onSuccess: async (data) => {
      const rec = data as FieldDutyAttendanceRecord;
      toast.success(
        `Register saved · ${markDateBs} · ${markShift.replace(/_/g, " ")} · ${rec.entries?.length ?? 0} students`,
      );
      setLoadedAttendance(rec);
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["field-duty", "register"] });
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
          markShift || (data as FieldDutyAttendanceRecord).shift || "DAY",
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
   * Load daily mark context: candidate pool + suggested roster for date+shift.
   * Coordinator then ticks who is on duty today and marks P/A/L.
   */
  const loadRosterForMarking = async (
    scheduleId: string,
    dateBs: string,
    existing?: FieldDutyAttendanceRecord | null,
    shiftForMark?: FieldDutyShift | "",
  ) => {
    const date = dateBs || todayBsString();
    const shift = (shiftForMark || markShift || "DAY") as FieldDutyShift;
    setSelectedScheduleId(scheduleId);
    setMarkDateBs(date);
    setMarkShift(shift);
    setLoadingMark(true);
    try {
      const ctx = await unwrap<{
        schedule: FieldDutyScheduleRecord;
        pool?: FieldDutyRosterStudent[];
        students: FieldDutyRosterStudent[];
        suggestedStudentIds?: string[];
        existingAttendance?: FieldDutyAttendanceRecord | null;
        dateBs: string;
        shift: FieldDutyShift;
      }>(
        api.get(`/field-duty/schedules/${scheduleId}/roster`, {
          params: { dateBs: date, shift },
        }),
      );

      setSelectedSchedule(ctx.schedule);
      const attendance = existing ?? ctx.existingAttendance ?? null;
      setLoadedAttendance(attendance);

      const pool = ctx.pool ?? ctx.students ?? [];
      const mode = ctx.schedule.rosterMode || "DAILY";

      setMarkRows(
        pool.map((s) => {
          const prev = attendance?.entries.find((e) => e.studentId === s._id);
          // Existing register → those students are on roster
          // MULTI/MANUAL/AUTO defaults → all pool selected
          // DAILY new day → none selected (coordinator picks daily roster)
          let onRoster = false;
          if (prev) onRoster = true;
          else if (attendance?.entries?.length) onRoster = false;
          else if (mode === "DAILY") onRoster = false;
          else onRoster = true;

          return {
            studentId: s._id,
            fullName: s.fullName,
            admissionNumber: s.admissionNumber,
            rollNumber: s.rollNumber,
            onRoster,
            status: prev?.status ?? ("PRESENT" as FieldDutyStudentStatus),
            remarks: prev?.remarks ?? "",
          };
        }),
      );

      if (attendance?.notes) setNotes(attendance.notes);
      else setNotes("");
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setLoadingMark(false);
    }
  };

  /** When user changes attendance date, re-load pool + register for that date. */
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
        markDateBs || todayBsString(),
        null,
        shift,
      );
    }
  };

  const onDutyCount = markRows.filter((r) => r.onRoster).length;
  const filteredMarkRows = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return markRows;
    return markRows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.admissionNumber.toLowerCase().includes(q) ||
        String(r.rollNumber).includes(q),
    );
  }, [markRows, rosterSearch]);

  const exportExcel = () => {
    const reg = registerQuery.data?.rows ?? [];
    const rows =
      reg.length > 0
        ? reg.map((r) => ({
            Date: r.dateBs,
            Shift: r.shift,
            Site: r.siteName,
            Batch: r.batchName ?? "",
            Year: r.yearName ?? "",
            Roll: r.rollNumber ?? "",
            Student: r.fullName ?? "",
            Admission: r.admissionNumber ?? "",
            Status: r.status,
            Remarks: r.remarks ?? "",
            Record: r.recordStatus,
          }))
        : (historyQuery.data ?? []).flatMap((rec) =>
            rec.entries.map((e) => ({
              Date: rec.dateBs,
              Shift: rec.shift,
              Site: rec.siteName || rec.hospitalName,
              Batch: "",
              Year: "",
              Roll: e.student?.rollNumber ?? "",
              Student: e.student?.fullName ?? "",
              Admission: e.student?.admissionNumber ?? "",
              Status: e.status,
              Remarks: e.remarks ?? "",
              Record: rec.status,
            })),
          );
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Field Register");
    XLSX.writeFile(
      book,
      `field-${section === "HOSPITAL" ? "hospital" : "community"}-register.xlsx`,
    );
  };

  const printReport = () => {
    const byDate = registerQuery.data?.byDate ?? [];
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Pop-up blocked — allow pop-ups to print");
      return;
    }
    const body =
      byDate.length > 0
        ? byDate
            .map((day) => {
              const blocks = day.shifts
                .map((block) => {
                  const entries = block.entries
                    .map(
                      (e) =>
                        `<tr><td>${e.rollNumber ?? ""}</td><td>${e.fullName ?? ""}</td><td>${e.status}</td><td>${e.remarks ?? ""}</td></tr>`,
                    )
                    .join("");
                  return `<h3>${day.dateBs} · ${block.shift} · ${block.siteName}</h3>
                    <p style="font-size:12px">P:${block.summary.present} A:${block.summary.absent} L:${block.summary.late} Leave:${block.summary.leave} · Total ${block.summary.total} · ${block.recordStatus}</p>
                    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px">
                      <thead><tr><th>Roll</th><th>Name</th><th>Status</th><th>Remarks</th></tr></thead>
                      <tbody>${entries}</tbody>
                    </table>`;
                })
                .join("");
              return blocks;
            })
            .join("<hr/>")
        : "<p>No register records.</p>";

    win.document.write(`<!DOCTYPE html><html><head><title>PHIT LMS — Field Attendance Register</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px} h1{font-size:18px} h3{font-size:14px;margin-top:16px}</style>
      </head><body>
      <h1>PHIT LMS — ${sectionLabel(section)} Attendance Register</h1>
      <p>Generated ${new Date().toLocaleString()}</p>
      ${body}
      <script>window.onload=()=>{window.print()}</script>
      </body></html>`);
    win.document.close();
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    {
      id: "postings" as const,
      label: isAdmin ? "Posting Assignment" : "Assigned postings",
    },
    ...(canWrite ? [{ id: "mark" as const, label: "Daily Attendance" }] : []),
    { id: "history", label: "Attendance Register" },
    { id: "reports", label: "Reports" },
  ];

  const typeOptions = postingTypeOptionsForSection(section);
  const staff = staffQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const isReadOnly =
    loadedAttendance?.status === "LOCKED" ||
    loadedAttendance?.status === "SUBMITTED";

  /**
   * Active postings for daily marking.
   * DAILY / AUTO / MANUAL → one card (coordinator picks date+shift+students).
   * MULTI_SHIFT → one card per configured shift (optional).
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
    const dateBs = markDateBs || todayBsString();

    for (const s of active) {
      const ctx = todayById.get(s._id);
      const isMulti = s.rosterMode === "MULTI_SHIFT";
      const activeToday = Boolean(ctx);

      if (isMulti) {
        const used: FieldDutyShift[] =
          s.shiftsUsed && s.shiftsUsed.length > 0
            ? s.shiftsUsed
            : (FIELD_SHIFTS.filter(
                (sh) => (s.shiftCounts?.[sh] ?? 0) > 0,
              ) as FieldDutyShift[]);
        for (const sh of used.length ? used : (["DAY"] as FieldDutyShift[])) {
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
            dateBs: ctx?.dateBs ?? dateBs,
            studentCount: s.shiftCounts?.[sh] ?? s.studentCount ?? 0,
            existingAttendance: att ?? null,
            activeToday,
            isMultiShift: true,
          });
        }
      } else {
        const sh = (shiftFilter || s.shift || "DAY") as FieldDutyShift;
        if (shiftFilter && s.shift && s.shift !== shiftFilter && s.rosterMode !== "DAILY") {
          // For DAILY, shift is chosen when marking — still show posting
        }
        cards.push({
          key: `${s._id}:daily`,
          schedule: s,
          shift: sh,
          dateBs: ctx?.dateBs ?? dateBs,
          studentCount: s.studentCount ?? ctx?.students.length ?? 0,
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
                      | "MULTI_SHIFT"
                      | "DAILY";
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
                  <option value="DAILY">
                    Daily roster — pick students each day (recommended)
                  </option>
                  <option value="AUTO_BATCH_YEAR">
                    Auto — all batch + year students every day
                  </option>
                  <option value="MANUAL">Manual — fixed student list</option>
                  <option value="MULTI_SHIFT">
                    Multi-shift defaults — fixed student→shift map
                  </option>
                </Select>
              </FormField>

              {form.rosterMode === "DAILY" ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-900">
                  <strong>Daily roster:</strong> Coordinator selects who is on duty each day
                  (date + shift), marks Present/Absent/Late/Leave, and saves a register
                  sheet. Student list can change every day.
                </div>
              ) : null}

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
                              todayBsString() || s.startDateBs,
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
                Daily attendance register
              </CardTitle>
              <p className="text-sm font-normal text-slate-500">
                1) Open a posting · 2) Choose <strong>attendance date</strong> (today or any
                previous date within the posting period) and <strong>shift</strong> · 3) Tick
                students on duty for that date · 4) Mark Present / Absent / Late / Leave ·
                5) Save register (stored like a manual attendance book).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Filter postings by shift (optional)">
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
                      Pool: <span className="font-medium">{markRows.length}</span>
                      {" · "}
                      On duty today:{" "}
                      <span className="font-medium text-indigo-700">{onDutyCount}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Rosters can change every day — tick only the students on duty for this
                      date and shift, then mark attendance.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <FormField label="Attendance date (BS) *">
                        <NepaliDateField value={markDateBs} onChange={onMarkDateChange} />
                      </FormField>
                      <p className="text-xs text-slate-500">
                        Posting {selectedSchedule.startDateBs} →{" "}
                        {selectedSchedule.endDateBs}. Choose today or a previous date
                        within this range to keep past records.
                      </p>
                    </div>
                    <FormField label="Duty shift *">
                      <Select
                        value={markShift}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          onMarkShiftChange(e.target.value as FieldDutyShift)
                        }
                      >
                        {FIELD_SHIFTS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Search students">
                      <Input
                        value={rosterSearch}
                        onChange={(e) => setRosterSearch(e.target.value)}
                        placeholder="Name, roll, admission…"
                      />
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
                      This day&apos;s register is locked (read-only).
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

                  {loadingMark ? (
                    <LoadingState />
                  ) : markRows.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No students in the batch/year pool. Check posting batch and year.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                        Daily register sheet · {markDateBs || "—"} ·{" "}
                        {markShift.replace(/_/g, " ")} ·{" "}
                        {selectedSchedule.siteName || selectedSchedule.hospitalName}
                      </div>
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>
                              <span className="sr-only">On roster</span>
                              Duty
                            </Th>
                            <Th>Roll</Th>
                            <Th>Student Name</Th>
                            <Th>Present</Th>
                            <Th>Absent</Th>
                            <Th>Late</Th>
                            <Th>Leave</Th>
                            <Th>Remarks</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {filteredMarkRows.map((row) => {
                            const idx = markRows.findIndex(
                              (r) => r.studentId === row.studentId,
                            );
                            return (
                              <tr
                                key={row.studentId}
                                className={row.onRoster ? "" : "opacity-50"}
                              >
                                <Td className="text-center">
                                  <input
                                    type="checkbox"
                                    disabled={isReadOnly}
                                    checked={row.onRoster}
                                    title="Include on today's roster"
                                    onChange={() =>
                                      setMarkRows((rows) =>
                                        rows.map((r, i) =>
                                          i === idx
                                            ? { ...r, onRoster: !r.onRoster }
                                            : r,
                                        ),
                                      )
                                    }
                                  />
                                </Td>
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
                                        disabled={isReadOnly || !row.onRoster}
                                        checked={row.onRoster && row.status === st}
                                        onChange={() =>
                                          setMarkRows((rows) =>
                                            rows.map((r, i) =>
                                              i === idx
                                                ? { ...r, onRoster: true, status: st }
                                                : r,
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
                                    disabled={isReadOnly || !row.onRoster}
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
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {!isReadOnly && markRows.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setMarkRows((rows) =>
                            rows.map((r) => ({ ...r, onRoster: true })),
                          )
                        }
                      >
                        Select all for today
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setMarkRows((rows) =>
                            rows.map((r) => ({ ...r, onRoster: false })),
                          )
                        }
                      >
                        Clear selection
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setMarkRows((rows) =>
                            rows.map((r) =>
                              r.onRoster ? { ...r, status: "PRESENT" } : r,
                            ),
                          )
                        }
                      >
                        On-duty → Present
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setMarkRows((rows) =>
                            rows.map((r) =>
                              r.onRoster ? { ...r, status: "ABSENT" } : r,
                            ),
                          )
                        }
                      >
                        On-duty → Absent
                      </Button>
                      <Button
                        onClick={() => submitAttendance.mutate()}
                        disabled={
                          submitAttendance.isPending ||
                          !markDateBs ||
                          !markShift ||
                          onDutyCount === 0
                        }
                      >
                        Save register ({onDutyCount} students · {markDateBs} ·{" "}
                        {markShift.replace(/_/g, " ")})
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
              {tab === "reports" ? "Reports" : "Attendance register (manual book)"}
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
            {registerQuery.isLoading || historyQuery.isLoading ? (
              <LoadingState />
            ) : (registerQuery.data?.byDate ?? []).length === 0 &&
              (historyQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="No register entries yet"
                description="Saved daily attendance sheets will appear here as a date-wise register."
              />
            ) : (registerQuery.data?.byDate ?? []).length > 0 ? (
              <div className="space-y-6">
                {(registerQuery.data?.byDate ?? []).map((day) => (
                  <div key={day.dateBs} className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Date (BS): {day.dateBs}
                    </h3>
                    {day.shifts.map((block) => (
                      <div
                        key={block.attendanceId}
                        className="overflow-hidden rounded-xl border border-slate-200"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium">{block.siteName}</span>
                            <Badge className="ml-2 bg-indigo-100 text-indigo-800">
                              {block.shift.replace(/_/g, " ")}
                            </Badge>
                            <Badge className={`ml-1 ${statusClass(block.recordStatus)}`}>
                              {block.recordStatus}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-600">
                            P {block.summary.present} · A {block.summary.absent} · Late{" "}
                            {block.summary.late} · Leave {block.summary.leave} · Total{" "}
                            {block.summary.total}
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHead>
                              <tr>
                                <Th>Roll</Th>
                                <Th>Student Name</Th>
                                <Th>Admission</Th>
                                <Th>Status</Th>
                                <Th>Remarks</Th>
                              </tr>
                            </TableHead>
                            <TableBody>
                              {block.entries.map((e) => (
                                <tr key={`${block.attendanceId}-${e.studentId}`}>
                                  <Td className="text-sm">{e.rollNumber ?? "—"}</Td>
                                  <Td className="text-sm">{e.fullName ?? "—"}</Td>
                                  <Td className="text-sm text-slate-500">
                                    {e.admissionNumber ?? "—"}
                                  </Td>
                                  <Td>
                                    <Badge className={statusClass(e.status)}>
                                      {e.status}
                                    </Badge>
                                  </Td>
                                  <Td className="text-sm text-slate-600">
                                    {e.remarks || "—"}
                                  </Td>
                                </tr>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {isAdmin ? (
                          <div className="flex flex-wrap gap-1 border-t border-slate-100 px-3 py-2">
                            {block.recordStatus === "LOCKED" ||
                            block.recordStatus === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => unlockAttendance.mutate(block.attendanceId)}
                              >
                                Unlock day sheet
                              </Button>
                            ) : null}
                            {canWrite ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setTab("mark");
                                  void loadRosterForMarking(
                                    block.scheduleId,
                                    day.dateBs,
                                    null,
                                    block.shift as FieldDutyShift,
                                  );
                                }}
                              >
                                Open / re-mark
                              </Button>
                            ) : null}
                          </div>
                        ) : canWrite ? (
                          <div className="border-t border-slate-100 px-3 py-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setTab("mark");
                                void loadRosterForMarking(
                                  block.scheduleId,
                                  day.dateBs,
                                  null,
                                  block.shift as FieldDutyShift,
                                );
                              }}
                            >
                              Open day sheet
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
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
                          {rec.dateBs} · {rec.siteName || rec.hospitalName} ·{" "}
                          {rec.shift}
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
