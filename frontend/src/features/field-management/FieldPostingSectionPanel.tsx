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
import {
  formatBsDate,
  getDaysInBsMonth,
  getTodayBs,
} from "@munatech/nepali-datepicker";
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
import {
  buildPrintInstitutionHeaderHtml,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { parseErrorMessage } from "lib/utils";
import {
  defaultPostingTypeForSection,
  fieldCodeClass,
  FIELD_REGISTER_LEGEND,
  FIELD_SHIFTS,
  FIELD_STATUSES,
  fieldStatusToCode,
  monthBsFromDate,
  postingTypeLabel,
  postingTypeOptionsForSection,
  sectionLabel,
  shiftLabel,
  shiftMonthBs,
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
  /** From Hospital Roster cell (department / shift codes). */
  departmentLabel?: string;
  shiftLabel?: string;
  rosterCode?: string;
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
  /**
   * Shift for this day's register sheet.
   * Empty until coordinator explicitly chooses a shift (proper daily attendance).
   */
  const [markShift, setMarkShift] = useState<"" | FieldDutyShift>("");
  /**
   * True only after Load attendance sheet with posting + date + shift.
   * Prevents marking before date/shift are set intentionally.
   */
  const [sheetLoaded, setSheetLoaded] = useState(false);
  /** Attendance record currently loaded for mark panel (authoritative for read-only). */
  const [loadedAttendance, setLoadedAttendance] =
    useState<FieldDutyAttendanceRecord | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [loadingMark, setLoadingMark] = useState(false);
  /** When true, student list comes from Hospital Roster for that day. */
  const [fromHospitalRoster, setFromHospitalRoster] = useState(false);
  const [hospitalRosterInfo, setHospitalRosterInfo] = useState<{
    rosterId: string;
    rosterName: string;
    hospitalName?: string;
    monthBs: string;
    day: number;
    status: string;
    assignmentCount: number;
  } | null>(null);
  /** Traditional monthly register filters (Attendance Register tab). */
  const [registerMonthBs, setRegisterMonthBs] = useState(() =>
    monthBsFromDate(todayBsString()) || "",
  );
  const [registerScheduleId, setRegisterScheduleId] = useState("");
  const [registerShiftFilter, setRegisterShiftFilter] = useState<
    "" | FieldDutyShift
  >("");

  useEffect(() => {
    setForm((f) => ({
      ...defaultForm(section, f.academicYearBs),
      academicYearBs: f.academicYearBs,
    }));
    setTab(canWrite && isCoordinatorView ? "mark" : "postings");
    setSelectedScheduleId("");
    setSelectedSchedule(null);
    setMarkRows([]);
    setMarkShift("");
    setSheetLoaded(false);
    setLoadedAttendance(null);
    setFromHospitalRoster(false);
    setHospitalRosterInfo(null);
    setNotes("");
    setShiftFilter("");
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
    queryKey: [
      "field-duty",
      "register",
      section,
      registerMonthBs,
      registerScheduleId,
      registerShiftFilter,
    ],
    queryFn: () => {
      const month = registerMonthBs || monthBsFromDate(todayBsString());
      const fromDateBs = month ? `${month}-01` : undefined;
      // Fetch full month window (BS months up to 32 days)
      const toDateBs = month ? `${month}-32` : undefined;
      return unwrap<FieldDutyRegisterBook>(
        api.get("/field-duty/register", {
          params: {
            section,
            scheduleId: registerScheduleId || undefined,
            shift: registerShiftFilter || undefined,
            fromDateBs,
            toDateBs,
          },
        }),
      );
    },
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

  /**
   * Full student pool for the selected posting — used so Attendance Register
   * lists everyone on the roster (not only those already marked).
   */
  const registerRosterQuery = useQuery({
    queryKey: [
      "field-duty",
      "register-roster",
      registerScheduleId,
      registerShiftFilter,
    ],
    queryFn: () =>
      unwrap<{
        pool?: FieldDutyRosterStudent[];
        students?: FieldDutyRosterStudent[];
      }>(
        api.get(`/field-duty/schedules/${registerScheduleId}/roster`, {
          params: {
            shift: registerShiftFilter || undefined,
          },
        }),
      ),
    enabled:
      Boolean(registerScheduleId) &&
      (tab === "history" || tab === "reports"),
  });

  const multiShiftCounts = useMemo(() => {
    const counts: Partial<Record<FieldDutyShift, number>> = {};
    for (const sh of Object.values(form.studentShiftMap)) {
      if (!sh) continue;
      counts[sh] = (counts[sh] ?? 0) + 1;
    }
    return counts;
  }, [form.studentShiftMap]);

  /** Only the fixed 1st/2nd/3rd (etc.) years for the selected batch — never all batches. */
  const yearsForBatch = useMemo(() => {
    const years = yearsQuery.data ?? [];
    if (!form.batchId) return [];
    return years
      .filter((y) => {
        const yBatch =
          typeof y.batchId === "string"
            ? y.batchId
            : (y.batchId as { _id?: string } | undefined)?._id ??
              String(y.batchId ?? "");
        return yBatch === form.batchId;
      })
      .slice()
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
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
      if (!selectedScheduleId) throw new Error("Select a posting first");
      if (!markDateBs?.trim()) throw new Error("Select attendance date (BS)");
      if (!markShift) throw new Error("Select duty shift before marking attendance");
      if (!sheetLoaded) {
        throw new Error("Load the attendance sheet for this date and shift first");
      }
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
        `Register saved · ${markDateBs} · ${shiftLabel(markShift)} · ${rec.entries?.length ?? 0} students`,
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
   * For hospital postings with a monthly Hospital Roster, students are taken from that grid.
   */
  const loadRosterForMarking = async (
    scheduleId: string,
    dateBs: string,
    existing?: FieldDutyAttendanceRecord | null,
    shiftForMark?: FieldDutyShift | "",
  ) => {
    const date = (dateBs || markDateBs || todayBsString()).trim();
    const shift = (shiftForMark || markShift) as FieldDutyShift | "";
    if (!scheduleId) {
      toast.error("Select a posting first");
      return;
    }
    if (!date) {
      toast.error("Select attendance date (BS) first");
      return;
    }
    if (!shift) {
      toast.error("Select duty shift first, then load the sheet");
      return;
    }
    setSelectedScheduleId(scheduleId);
    setMarkDateBs(date);
    setMarkShift(shift);
    setSheetLoaded(false);
    setLoadingMark(true);
    try {
      const ctx = await unwrap<{
        schedule: FieldDutyScheduleRecord;
        pool?: FieldDutyRosterStudent[];
        students: FieldDutyRosterStudent[];
        suggestedStudentIds?: string[];
        suggestedStatusByStudent?: Partial<Record<string, FieldDutyStudentStatus>>;
        assignmentMetaByStudent?: Record<
          string,
          {
            departmentCode?: string;
            departmentName?: string;
            shiftCode?: string;
            shiftName?: string;
            fieldShift?: FieldDutyShift;
            code?: string;
          }
        >;
        existingAttendance?: FieldDutyAttendanceRecord | null;
        dateBs: string;
        shift: FieldDutyShift;
        fromHospitalRoster?: boolean;
        hospitalRoster?: {
          rosterId: string;
          rosterName: string;
          hospitalName?: string;
          monthBs: string;
          day: number;
          status: string;
          assignmentCount: number;
        } | null;
      }>(
        api.get(`/field-duty/schedules/${scheduleId}/roster`, {
          params: { dateBs: date, shift },
        }),
      );

      setSelectedSchedule(ctx.schedule);
      const attendance = existing ?? ctx.existingAttendance ?? null;
      setLoadedAttendance(attendance);
      setFromHospitalRoster(Boolean(ctx.fromHospitalRoster));
      setHospitalRosterInfo(ctx.hospitalRoster ?? null);

      const pool = ctx.pool ?? ctx.students ?? [];
      const mode = ctx.schedule.rosterMode || "DAILY";
      const suggested = new Set(ctx.suggestedStudentIds ?? []);
      const statusHints = ctx.suggestedStatusByStudent ?? {};
      const meta = ctx.assignmentMetaByStudent ?? {};
      const rosterDriven = Boolean(ctx.fromHospitalRoster);

      setMarkRows(
        pool.map((s) => {
          const prev = attendance?.entries.find((e) => e.studentId === s._id);
          const m = meta[s._id];
          // Existing register → those students are on roster
          // Hospital roster → all pool students are on duty for this day/shift
          // MULTI/MANUAL/AUTO defaults → all pool selected
          // DAILY new day → use suggested when available
          let onRoster = false;
          if (prev) onRoster = true;
          else if (attendance?.entries?.length) onRoster = false;
          else if (rosterDriven) onRoster = suggested.has(s._id) || suggested.size === 0;
          else if (mode === "DAILY") onRoster = suggested.has(s._id);
          else if (suggested.size > 0) onRoster = suggested.has(s._id);
          else onRoster = true;

          const suggestedStatus = statusHints[s._id];
          const deptLabel =
            m?.departmentCode || m?.departmentName
              ? [m.departmentCode, m.departmentName].filter(Boolean).join(" · ")
              : undefined;
          const shiftLabel =
            m?.shiftCode || m?.shiftName
              ? [m.shiftCode, m.shiftName].filter(Boolean).join(" · ")
              : undefined;

          return {
            studentId: s._id,
            fullName: s.fullName,
            admissionNumber: s.admissionNumber,
            rollNumber: s.rollNumber,
            onRoster,
            status:
              prev?.status ??
              suggestedStatus ??
              ("PRESENT" as FieldDutyStudentStatus),
            remarks: prev?.remarks ?? "",
            departmentLabel: deptLabel,
            shiftLabel: shiftLabel,
            rosterCode: m?.code,
          };
        }),
      );

      if (attendance?.notes) setNotes(attendance.notes);
      else setNotes("");
      setSheetLoaded(true);
    } catch (e) {
      setSheetLoaded(false);
      setMarkRows([]);
      toast.error(parseErrorMessage(e));
    } finally {
      setLoadingMark(false);
    }
  };

  /** Date/shift changes invalidate the loaded sheet — must Load again. */
  const onMarkDateChange = (dateBs: string) => {
    setMarkDateBs(dateBs);
    setSheetLoaded(false);
    setMarkRows([]);
    setLoadedAttendance(null);
    setFromHospitalRoster(false);
    setHospitalRosterInfo(null);
  };

  const onMarkShiftChange = (shift: FieldDutyShift | "") => {
    setMarkShift(shift);
    setSheetLoaded(false);
    setMarkRows([]);
    setLoadedAttendance(null);
    setFromHospitalRoster(false);
    setHospitalRosterInfo(null);
  };

  const selectPostingForMark = (
    schedule: FieldDutyScheduleRecord,
    preferredShift?: FieldDutyShift | "",
  ) => {
    setSelectedScheduleId(schedule._id);
    setSelectedSchedule(schedule);
    setSheetLoaded(false);
    setMarkRows([]);
    setLoadedAttendance(null);
    setFromHospitalRoster(false);
    setHospitalRosterInfo(null);
    setNotes("");
    // Prefer multi-shift / posting default only as suggestion — user must confirm Load
    if (preferredShift) {
      setMarkShift(preferredShift);
    } else if (schedule.rosterMode === "MULTI_SHIFT") {
      setMarkShift("");
    } else if (schedule.shift) {
      setMarkShift(schedule.shift as FieldDutyShift);
    } else {
      setMarkShift("");
    }
    if (!markDateBs) setMarkDateBs(todayBsString());
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
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Pop-up blocked — allow pop-ups to print");
      return;
    }
    const { month, days, students } = monthlyRegister;
    const headDays = days.map((d) => `<th>${d}</th>`).join("");
    const bodyRows =
      students.length > 0
        ? students
            .map((st, i) => {
              const dayCells = days
                .map((d) => {
                  const code = st.cells[d]?.code || "";
                  return `<td style="text-align:center;font-weight:600">${code || ""}</td>`;
                })
                .join("");
              return `<tr>
                <td style="text-align:center">${i + 1}</td>
                <td>${st.fullName}</td>
                <td style="text-align:center">${st.rollNumber ?? ""}</td>
                ${dayCells}
                <td style="text-align:center">${st.present}</td>
                <td style="text-align:center">${st.absent}</td>
                <td style="text-align:center">${st.late}</td>
                <td style="text-align:center">${st.leave}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="${days.length + 7}">No register records for this month.</td></tr>`;

    const institutionHeader = buildPrintInstitutionHeaderHtml();
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>${sectionLabel(section)} Attendance Register</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; padding: 10mm 8mm; color: #0f172a; }
        h1 { font-size: 15px; margin: 8px 0 4px; }
        .meta { font-size: 11px; color: #475569; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th, td { border: 1px solid #94a3b8; padding: 2px 3px; }
        th { background: #f1f5f9; font-weight: 600; }
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
        @page { size: A4 landscape; margin: 8mm; }
        ${PRINT_INSTITUTION_HEADER_CSS}
      </style>
      </head><body>
      ${institutionHeader}
      <h1>${sectionLabel(section)} Attendance Register</h1>
      <div class="meta">
        Month (BS): <strong>${month || "—"}</strong>
        ${registerShiftFilter ? ` · Shift: ${shiftLabel(registerShiftFilter)}` : " · All shifts"}
        · ${students.length} student(s)
        · Printed ${new Date().toLocaleString()}
      </div>
      <p class="meta">Note: P=Present · A=Absent · L=Late · Lv=Leave · E=Emergency duty</p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Student</th><th>Roll</th>
            ${headDays}
            <th>P</th><th>A</th><th>L</th><th>Lv</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <script>window.onload=function(){window.print()}</script>
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
    { id: "reports", label: "Day-wise & Reports" },
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
        const sh = (s.shift || "DAY") as FieldDutyShift;
        // DAILY postings pick shift when marking — always show them.
        // Fixed-shift postings (MANUAL / AUTO_BATCH_YEAR) must match the shift filter.
        if (shiftFilter && s.rosterMode !== "DAILY" && sh !== shiftFilter) {
          continue;
        }
        cards.push({
          key: `${s._id}:daily`,
          schedule: s,
          shift: (s.rosterMode === "DAILY" ? shiftFilter || sh : sh) as FieldDutyShift,
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

  /**
   * Traditional monthly register matrix: students × day-of-month cells.
   * Built client-side from register API rows for the selected BS month.
   * Always shows full BS month columns; includes every student who has any
   * mark (and all roster students when a posting is selected).
   */
  const monthlyRegister = useMemo(() => {
    const month = registerMonthBs || monthBsFromDate(todayBsString());
    const allRows = registerQuery.data?.rows ?? [];
    const selectedSch = registerScheduleId
      ? schedules.find((s) => s._id === registerScheduleId)
      : null;
    const siteFilterName = (
      selectedSch?.siteName ||
      selectedSch?.hospitalName ||
      ""
    )
      .trim()
      .toLowerCase();

    const rows = allRows.filter((r) => {
      if (month && !String(r.dateBs).startsWith(month)) return false;
      if (
        siteFilterName &&
        String(r.siteName || "")
          .trim()
          .toLowerCase() !== siteFilterName
      ) {
        return false;
      }
      if (registerShiftFilter && r.shift !== registerShiftFilter) return false;
      return true;
    });

    // Full BS month columns (date-wise register)
    let daysInMonth = 32;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-").map(Number);
      if (y && m) {
        try {
          daysInMonth = getDaysInBsMonth(y, m);
        } catch {
          daysInMonth = 32;
        }
      }
    }
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    type StudentAgg = {
      studentId: string;
      fullName: string;
      rollNumber?: number;
      admissionNumber?: string;
      batchName?: string;
      yearName?: string;
      cells: Record<
        number,
        { code: string; status: string; shift: string; siteName: string }
      >;
      present: number;
      absent: number;
      late: number;
      leave: number;
      emergency: number;
    };

    const byStudent = new Map<string, StudentAgg>();

    const ensureStudent = (
      studentId: string,
      meta?: {
        fullName?: string;
        rollNumber?: number;
        admissionNumber?: string;
        batchName?: string;
        yearName?: string;
      },
    ) => {
      let row = byStudent.get(studentId);
      if (!row) {
        row = {
          studentId,
          fullName: meta?.fullName ?? "Student",
          rollNumber: meta?.rollNumber,
          admissionNumber: meta?.admissionNumber,
          batchName: meta?.batchName,
          yearName: meta?.yearName,
          cells: {},
          present: 0,
          absent: 0,
          late: 0,
          leave: 0,
          emergency: 0,
        };
        byStudent.set(studentId, row);
      } else {
        if (meta?.fullName && row.fullName === "Student") row.fullName = meta.fullName;
        if (meta?.rollNumber != null && row.rollNumber == null) {
          row.rollNumber = meta.rollNumber;
        }
        if (meta?.admissionNumber && !row.admissionNumber) {
          row.admissionNumber = meta.admissionNumber;
        }
      }
      return row;
    };

    // Seed roster pool when a posting is selected so every student appears (check-all / full list)
    if (selectedSch) {
      const pool =
        registerRosterQuery.data?.pool ??
        registerRosterQuery.data?.students ??
        [];
      for (const s of pool) {
        ensureStudent(s._id, {
          fullName: s.fullName,
          rollNumber: s.rollNumber,
          admissionNumber: s.admissionNumber,
          batchName: selectedSch.batch?.name,
          yearName: selectedSch.year?.name,
        });
      }
      for (const id of selectedSch.assignedStudentIds ?? []) {
        ensureStudent(id, {
          batchName: selectedSch.batch?.name,
          yearName: selectedSch.year?.name,
        });
      }
      for (const sh of selectedSch.studentShifts ?? []) {
        ensureStudent(sh.studentId, {
          batchName: selectedSch.batch?.name,
          yearName: selectedSch.year?.name,
        });
      }
    }

    for (const r of rows) {
      const day = Number(String(r.dateBs).split("-")[2]);
      if (!Number.isFinite(day)) continue;
      const row = ensureStudent(r.studentId, {
        fullName: r.fullName,
        rollNumber: r.rollNumber,
        admissionNumber: r.admissionNumber,
        batchName: r.batchName,
        yearName: r.yearName,
      });
      // Multi-shift same day: prefer present-like over absent when overwriting
      const prev = row.cells[day];
      const nextCode = fieldStatusToCode(r.status);
      const rank = (st: string) => {
        if (st === "PRESENT" || st === "EMERGENCY_DUTY") return 4;
        if (st === "LATE") return 3;
        if (st === "LEAVE") return 2;
        if (st === "ABSENT") return 1;
        return 0;
      };
      if (prev && rank(r.status) < rank(prev.status)) continue;
      row.cells[day] = {
        code: nextCode,
        status: r.status,
        shift: r.shift,
        siteName: r.siteName,
      };
    }

    // Recompute totals from cells
    for (const row of byStudent.values()) {
      row.present = 0;
      row.absent = 0;
      row.late = 0;
      row.leave = 0;
      row.emergency = 0;
      for (const cell of Object.values(row.cells)) {
        if (cell.status === "PRESENT") row.present += 1;
        else if (cell.status === "ABSENT") row.absent += 1;
        else if (cell.status === "LATE") row.late += 1;
        else if (cell.status === "LEAVE") row.leave += 1;
        else if (cell.status === "EMERGENCY_DUTY") row.emergency += 1;
      }
    }

    const students = [...byStudent.values()].sort((a, b) => {
      const ra = a.rollNumber ?? 9999;
      const rb = b.rollNumber ?? 9999;
      if (ra !== rb) return ra - rb;
      return a.fullName.localeCompare(b.fullName);
    });

    return { month, days, students, totalMarks: rows.length };
  }, [
    registerQuery.data?.rows,
    registerMonthBs,
    registerScheduleId,
    registerShiftFilter,
    schedules,
    registerRosterQuery.data,
  ]);

  const canLoadSheet =
    Boolean(selectedScheduleId) &&
    Boolean(markDateBs?.trim()) &&
    Boolean(markShift) &&
    !loadingMark;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{sectionLabel(section)}</h2>
        <p className="text-sm text-slate-600">
          {section === "HOSPITAL"
            ? "Hospital Posting: take daily attendance with date + shift (like Daily Attendance), then view a traditional monthly register."
            : "Coordinators use their staff login. Attendance is locked after submit; edit requests go to admin."}
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
                    disabled={!form.batchId}
                    onChange={(e) => setForm((f) => ({ ...f, yearId: e.target.value }))}
                  >
                    <option value="">
                      {form.batchId ? "Select year" : "Select batch first"}
                    </option>
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
                                const student = students[idx];
                                if (student) {
                                  map[student._id] = sh;
                                }
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
                              map[s._id] =
                                FIELD_SHIFTS[i % FIELD_SHIFTS.length] ??
                                "MORNING";
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
                                  ""
                                : (s.shift as FieldDutyShift) || "";
                            selectPostingForMark(s, firstShift || undefined);
                            setMarkDateBs(todayBsString() || s.startDateBs);
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
          {/* Workflow banner — same spirit as Daily Attendance */}
          <Card className="border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_white_55%)]">
            <CardContent className="py-4">
              <p className="text-sm font-semibold text-slate-900">
                Daily Attendance — {sectionLabel(section)}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>
                  <strong>Select posting</strong> (hospital / site)
                </li>
                <li>
                  Choose <strong>date (BS)</strong> and <strong>duty shift</strong>
                </li>
                <li>
                  Click <strong>Load attendance sheet</strong>
                  {section === "HOSPITAL"
                    ? " — students come from Hospital Roster for that day when available"
                    : ""}
                </li>
                <li>
                  Mark Present / Absent / Late / Leave, then <strong>Save register</strong>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Step 1 — Posting */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">1. Select posting</CardTitle>
              <p className="text-sm font-normal text-slate-500">
                Choose the hospital posting you are marking for today.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-w-xs">
                <FormField label="Filter list by shift (optional)">
                  <Select
                    value={shiftFilter}
                    onChange={(e) =>
                      setShiftFilter((e.target.value || "") as "" | FieldDutyShift)
                    }
                  >
                    <option value="">All shifts</option>
                    {FIELD_SHIFTS.map((s) => (
                      <option key={s} value={s}>
                        {shiftLabel(s)}
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
                      ? `No ${shiftLabel(shiftFilter)} postings assigned`
                      : "No active postings"
                  }
                  description={
                    isCoordinatorView
                      ? "You have no assigned field postings for this section. Ask admin to assign you as field coordinator."
                      : "Create an active posting and assign a coordinator first."
                  }
                />
              ) : (
                <div className="space-y-2">
                  {markablePostings.map((ctx) => {
                    const isSelected = selectedScheduleId === ctx.schedule._id;
                    const submitted =
                      ctx.existingAttendance?.status === "LOCKED" ||
                      ctx.existingAttendance?.status === "SUBMITTED";
                    return (
                      <div
                        key={ctx.key}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 transition ${
                          isSelected
                            ? "border-brand-500 bg-brand-50/60 shadow-sm"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {ctx.schedule.siteName || ctx.schedule.hospitalName}
                            {ctx.isMultiShift ? (
                              <Badge className="ml-2 bg-violet-100 text-violet-800">
                                multi-shift · {shiftLabel(ctx.shift)}
                              </Badge>
                            ) : ctx.schedule.rosterMode !== "DAILY" ? (
                              <Badge className="ml-2 bg-indigo-100 text-indigo-800">
                                {shiftLabel(ctx.shift)}
                              </Badge>
                            ) : (
                              <Badge className="ml-2 bg-slate-100 text-slate-700">
                                Daily shift pick
                              </Badge>
                            )}
                            {submitted ? (
                              <Badge className="ml-1 bg-emerald-100 text-emerald-800">
                                Today: {ctx.existingAttendance?.status}
                              </Badge>
                            ) : (
                              <Badge className="ml-1 bg-amber-100 text-amber-900">
                                Pending today
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-slate-600">
                            {ctx.schedule.batch?.name ?? "Batch"} ·{" "}
                            {ctx.schedule.year?.name ?? "Year"} ·{" "}
                            {postingTypeLabel(ctx.schedule.postingType)} ·{" "}
                            {ctx.studentCount} students · {ctx.schedule.startDateBs} →{" "}
                            {ctx.schedule.endDateBs}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() =>
                            selectPostingForMark(
                              ctx.schedule,
                              ctx.isMultiShift
                                ? ctx.shift
                                : ctx.schedule.rosterMode === "DAILY"
                                  ? undefined
                                  : ctx.shift,
                            )
                          }
                        >
                          {isSelected ? "Selected" : "Select"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2 — Date + Shift + Load */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">2. Date & shift</CardTitle>
              <p className="text-sm font-normal text-slate-500">
                You must set both fields, then load the sheet — same as classroom Daily
                Attendance.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedSchedule ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Select a posting above first.
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
                    <p className="font-semibold text-slate-900">
                      {selectedSchedule.siteName || selectedSchedule.hospitalName}
                    </p>
                    <p className="mt-0.5 text-slate-600">
                      {selectedSchedule.batch?.name ?? "Batch"} ·{" "}
                      {selectedSchedule.year?.name ?? "Year"} · Posting period{" "}
                      {selectedSchedule.startDateBs} → {selectedSchedule.endDateBs}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="Attendance date (BS) *">
                      <NepaliDateField
                        value={markDateBs}
                        onChange={onMarkDateChange}
                      />
                    </FormField>
                    <FormField label="Duty shift *">
                      <Select
                        value={markShift}
                        onChange={(e) =>
                          onMarkShiftChange(
                            (e.target.value || "") as FieldDutyShift | "",
                          )
                        }
                      >
                        <option value="">Select shift…</option>
                        {FIELD_SHIFTS.map((s) => (
                          <option key={s} value={s}>
                            {shiftLabel(s)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <div className="flex items-end">
                      <Button
                        className="w-full sm:w-auto"
                        disabled={!canLoadSheet}
                        onClick={() =>
                          void loadRosterForMarking(
                            selectedScheduleId,
                            markDateBs,
                            null,
                            markShift,
                          )
                        }
                      >
                        {loadingMark
                          ? "Loading…"
                          : sheetLoaded
                            ? "Reload sheet"
                            : "Load attendance sheet"}
                      </Button>
                    </div>
                  </div>

                  {!markDateBs || !markShift ? (
                    <p className="text-xs text-amber-800">
                      Set <strong>date</strong> and <strong>shift</strong> before loading the
                      sheet. Marking is disabled until the sheet is loaded.
                    </p>
                  ) : !sheetLoaded ? (
                    <p className="text-xs text-slate-500">
                      Ready — click <strong>Load attendance sheet</strong> for{" "}
                      {markDateBs} · {shiftLabel(markShift)}.
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-800">
                      Sheet loaded for {markDateBs} · {shiftLabel(markShift)}. Changing date
                      or shift requires loading again.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Step 3 — Marking sheet */}
          {selectedSchedule && sheetLoaded ? (
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <div className="border-b border-slate-200 bg-[linear-gradient(135deg,_#0c2d6b_0%,_#1e4a8c_100%)] px-4 py-3 text-white">
                <p className="text-xs font-medium uppercase tracking-wider text-white/80">
                  Daily attendance register sheet
                </p>
                <p className="mt-0.5 text-lg font-semibold">
                  {selectedSchedule.siteName || selectedSchedule.hospitalName}
                </p>
                <p className="mt-1 text-sm text-white/90">
                  Date (BS): <strong>{markDateBs}</strong>
                  {" · "}
                  Shift: <strong>{shiftLabel(markShift)}</strong>
                  {" · "}
                  {selectedSchedule.batch?.name}/{selectedSchedule.year?.name}
                  {" · "}
                  On duty: <strong>{onDutyCount}</strong>
                  {loadedAttendance ? (
                    <>
                      {" · "}
                      Status:{" "}
                      <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-semibold">
                        {loadedAttendance.status}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <CardContent className="space-y-3 pt-4">
                {fromHospitalRoster && hospitalRosterInfo ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <span className="font-semibold">From Hospital Roster:</span>{" "}
                    {hospitalRosterInfo.rosterName}
                    {hospitalRosterInfo.hospitalName
                      ? ` · ${hospitalRosterInfo.hospitalName}`
                      : ""}{" "}
                    · day {hospitalRosterInfo.day}
                    {hospitalRosterInfo.status === "LOCKED" ? " · Locked" : ""} ·{" "}
                    {hospitalRosterInfo.assignmentCount} assigned
                  </div>
                ) : section === "HOSPITAL" ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    No matching Hospital Roster for this day. Tick duty students manually, or
                    create a roster under <strong>Hospital Roster</strong>.
                  </div>
                ) : null}

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
                        disabled={
                          loadedAttendance?.editRequest?.status === "PENDING"
                        }
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

                <div className="grid gap-3 sm:grid-cols-2">
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

                {loadingMark ? (
                  <LoadingState />
                ) : markRows.length === 0 ? (
                  <EmptyState
                    title="No students on this sheet"
                    description={
                      fromHospitalRoster
                        ? "No students on Hospital Roster for this day and shift."
                        : "No students in the batch/year pool for this posting."
                    }
                  />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-300">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          <th className="border border-slate-300 px-2 py-2 text-center">
                            S.N.
                          </th>
                          {!fromHospitalRoster ? (
                            <th className="border border-slate-300 px-2 py-2 text-center">
                              Duty
                            </th>
                          ) : null}
                          <th className="border border-slate-300 px-2 py-2">Roll</th>
                          <th className="border border-slate-300 px-2 py-2">
                            Student name
                          </th>
                          {fromHospitalRoster || section === "HOSPITAL" ? (
                            <th className="border border-slate-300 px-2 py-2">
                              Dept / roster
                            </th>
                          ) : null}
                          <th className="border border-slate-300 px-2 py-2 text-center">
                            P
                          </th>
                          <th className="border border-slate-300 px-2 py-2 text-center">
                            A
                          </th>
                          <th className="border border-slate-300 px-2 py-2 text-center">
                            Late
                          </th>
                          <th className="border border-slate-300 px-2 py-2 text-center">
                            Leave
                          </th>
                          <th className="border border-slate-300 px-2 py-2">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMarkRows.map((row, sn) => {
                          const idx = markRows.findIndex(
                            (r) => r.studentId === row.studentId,
                          );
                          return (
                            <tr
                              key={row.studentId}
                              className={
                                row.onRoster
                                  ? "bg-white hover:bg-slate-50/80"
                                  : "bg-slate-50/50 opacity-60"
                              }
                            >
                              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums text-slate-500">
                                {sn + 1}
                              </td>
                              {!fromHospitalRoster ? (
                                <td className="border border-slate-200 px-2 py-1.5 text-center">
                                  <input
                                    type="checkbox"
                                    disabled={isReadOnly}
                                    checked={row.onRoster}
                                    title="On duty today"
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
                                </td>
                              ) : null}
                              <td className="border border-slate-200 px-2 py-1.5 tabular-nums">
                                {row.rollNumber}
                              </td>
                              <td className="border border-slate-200 px-2 py-1.5 font-medium">
                                {row.fullName}
                                <div className="text-xs font-normal text-slate-400">
                                  {row.admissionNumber}
                                </div>
                              </td>
                              {fromHospitalRoster || section === "HOSPITAL" ? (
                                <td className="border border-slate-200 px-2 py-1.5 text-xs text-slate-600">
                                  {[
                                    row.departmentLabel,
                                    row.shiftLabel,
                                    row.rosterCode,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "—"}
                                </td>
                              ) : null}
                              {(
                                [
                                  "PRESENT",
                                  "ABSENT",
                                  "LATE",
                                  "LEAVE",
                                ] as const
                              ).map((st) => (
                                <td
                                  key={st}
                                  className="border border-slate-200 px-1 py-1.5 text-center"
                                >
                                  <input
                                    type="radio"
                                    className="h-4 w-4"
                                    name={`status-${row.studentId}`}
                                    disabled={isReadOnly || !row.onRoster}
                                    checked={row.onRoster && row.status === st}
                                    onChange={() =>
                                      setMarkRows((rows) =>
                                        rows.map((r, i) =>
                                          i === idx
                                            ? {
                                                ...r,
                                                onRoster: true,
                                                status: st,
                                              }
                                            : r,
                                        ),
                                      )
                                    }
                                  />
                                </td>
                              ))}
                              <td className="border border-slate-200 px-1 py-1">
                                <Input
                                  className="min-w-[100px] border-0 bg-transparent shadow-none focus-visible:ring-1"
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
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {!isReadOnly && markRows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {!fromHospitalRoster ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setMarkRows((rows) =>
                              rows.map((r) => ({ ...r, onRoster: true })),
                            )
                          }
                        >
                          All on duty
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setMarkRows((rows) =>
                              rows.map((r) => ({ ...r, onRoster: false })),
                            )
                          }
                        >
                          Clear duty
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setMarkRows((rows) =>
                          rows.map((r) =>
                            r.onRoster ? { ...r, status: "PRESENT" } : r,
                          ),
                        )
                      }
                    >
                      Mark all Present
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setMarkRows((rows) =>
                          rows.map((r) =>
                            r.onRoster ? { ...r, status: "ABSENT" } : r,
                          ),
                        )
                      }
                    >
                      Mark all Absent
                    </Button>
                    <Button
                      className="ml-auto"
                      onClick={() => submitAttendance.mutate()}
                      disabled={
                        submitAttendance.isPending ||
                        !markDateBs ||
                        !markShift ||
                        !sheetLoaded ||
                        onDutyCount === 0
                      }
                    >
                      {submitAttendance.isPending
                        ? "Saving…"
                        : `Save register · ${onDutyCount} · ${markDateBs} · ${shiftLabel(markShift)}`}
                    </Button>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Note:</span>
                  {FIELD_REGISTER_LEGEND.map((item) => (
                    <span
                      key={item.code}
                      className={`rounded px-1.5 py-0.5 ${item.className}`}
                    >
                      {item.code} = {item.label}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : selectedSchedule && !sheetLoaded ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500">
                Set date and shift, then load the attendance sheet to mark students.
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "history" || tab === "reports" ? (
        <div className="space-y-4">
          <Card className="border-brand-100">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  {tab === "reports"
                    ? `Day-wise sheets & reports — ${sectionLabel(section)}`
                    : `Attendance Register — ${sectionLabel(section)}`}
                </CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {tab === "reports"
                    ? "Date-wise saved attendance sheets from roster marking. Open a day to review or re-mark when unlocked."
                    : "Traditional monthly register (students × full BS month days). Built from roster and attendance taken — every marked student and full roster when a posting is selected."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={exportExcel}>
                  Excel
                </Button>
                <Button size="sm" variant="outline" onClick={printReport}>
                  Print
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Month (BS)">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-10 w-10 shrink-0 px-0"
                    onClick={() =>
                      setRegisterMonthBs(
                        shiftMonthBs(
                          registerMonthBs || monthBsFromDate(todayBsString()) || "2082-01",
                          -1,
                        ),
                      )
                    }
                    aria-label="Previous month"
                  >
                    ‹
                  </Button>
                  <Input
                    className="text-center"
                    value={registerMonthBs}
                    onChange={(e) => setRegisterMonthBs(e.target.value)}
                    placeholder="YYYY-MM"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-10 w-10 shrink-0 px-0"
                    onClick={() =>
                      setRegisterMonthBs(
                        shiftMonthBs(
                          registerMonthBs || monthBsFromDate(todayBsString()) || "2082-01",
                          1,
                        ),
                      )
                    }
                    aria-label="Next month"
                  >
                    ›
                  </Button>
                </div>
              </FormField>
              <FormField label="Posting / site">
                <Select
                  value={registerScheduleId}
                  onChange={(e) => setRegisterScheduleId(e.target.value)}
                >
                  <option value="">All postings</option>
                  {schedules.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.siteName || s.hospitalName} · {s.batch?.name}/{s.year?.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Shift">
                <Select
                  value={registerShiftFilter}
                  onChange={(e) =>
                    setRegisterShiftFilter(
                      (e.target.value || "") as "" | FieldDutyShift,
                    )
                  }
                >
                  <option value="">All shifts</option>
                  {FIELD_SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {shiftLabel(s)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Go to current">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setRegisterMonthBs(monthBsFromDate(todayBsString()) || "")
                  }
                >
                  Current month
                </Button>
              </FormField>
            </CardContent>
          </Card>

          {/* Note + stats */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-600">Note:</span>
            {FIELD_REGISTER_LEGEND.map((item) => (
              <span
                key={item.code}
                className={`rounded px-1.5 py-0.5 ${item.className}`}
              >
                {item.code} = {item.label}
              </span>
            ))}
            <span className="ml-auto text-slate-500">
              {monthlyRegister.students.length} students · {monthlyRegister.totalMarks}{" "}
              marks · {monthlyRegister.month || "—"}
              {monthlyRegister.days.length
                ? ` · ${monthlyRegister.days.length} days`
                : ""}
            </span>
          </div>

          {/* Attendance Register tab: full month grid */}
          {tab === "history" ? (
            registerQuery.isLoading || registerRosterQuery.isLoading ? (
              <LoadingState />
            ) : monthlyRegister.students.length === 0 ? (
              <EmptyState
                title="No register entries this month"
                description="Save daily attendance sheets first (Mark all / individual marks). They appear here date-wise for the full BS month. Select a posting to list the full roster."
              />
            ) : (
              <Card className="overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    Monthly attendance register · BS {monthlyRegister.month}
                    {registerShiftFilter
                      ? ` · ${shiftLabel(registerShiftFilter)}`
                      : " · all shifts"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Columns = full BS month days · Codes from roster attendance taken
                  </p>
                </div>
                <CardContent className="p-0">
                  <div className="max-h-[min(75vh,820px)] overflow-auto">
                    <table className="w-full min-w-[900px] border-collapse text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-100">
                        <tr>
                          <th className="sticky left-0 z-20 border border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">
                            S.N.
                          </th>
                          <th className="sticky left-8 z-20 min-w-[140px] border border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">
                            Student
                          </th>
                          <th className="border border-slate-300 px-1 py-2 font-semibold">
                            Roll
                          </th>
                          {monthlyRegister.days.map((d) => (
                            <th
                              key={d}
                              className="border border-slate-300 px-0.5 py-2 text-center font-semibold tabular-nums text-slate-600"
                            >
                              {d}
                            </th>
                          ))}
                          <th className="border border-slate-300 px-1 py-2 text-center font-semibold text-emerald-800">
                            P
                          </th>
                          <th className="border border-slate-300 px-1 py-2 text-center font-semibold text-rose-800">
                            A
                          </th>
                          <th className="border border-slate-300 px-1 py-2 text-center font-semibold text-amber-800">
                            L
                          </th>
                          <th className="border border-slate-300 px-1 py-2 text-center font-semibold text-sky-800">
                            Lv
                          </th>
                          <th className="border border-slate-300 px-1 py-2 text-center font-semibold text-violet-800">
                            E
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyRegister.students.map((st, idx) => (
                          <tr key={st.studentId} className="hover:bg-slate-50/80">
                            <td className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-center tabular-nums text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="sticky left-8 z-10 max-w-[160px] border border-slate-200 bg-white px-2 py-1 font-medium text-slate-900">
                              <div className="truncate" title={st.fullName}>
                                {st.fullName}
                              </div>
                              <div className="truncate text-[10px] font-normal text-slate-400">
                                {st.admissionNumber || "—"}
                              </div>
                            </td>
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                              {st.rollNumber ?? "—"}
                            </td>
                            {monthlyRegister.days.map((d) => {
                              const cell = st.cells[d];
                              const code = cell?.code || "";
                              return (
                                <td
                                  key={d}
                                  className={`border border-slate-200 px-0.5 py-1 text-center ${fieldCodeClass(code)}`}
                                  title={
                                    cell
                                      ? `${cell.status} · ${shiftLabel(cell.shift)} · ${cell.siteName}`
                                      : undefined
                                  }
                                >
                                  {code || "·"}
                                </td>
                              );
                            })}
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums font-medium">
                              {st.present}
                            </td>
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                              {st.absent}
                            </td>
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                              {st.late}
                            </td>
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                              {st.leave}
                            </td>
                            <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                              {st.emergency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          ) : null}

          {/* Day-wise sheets — primary content of Reports tab */}
          {tab === "reports" ? (
            registerQuery.isLoading ? (
              <LoadingState />
            ) : (registerQuery.data?.byDate ?? []).length === 0 ? (
              <EmptyState
                title="No day-wise sheets this month"
                description="Take daily attendance (with All on duty / Mark all Present if needed). Saved sheets appear here date-wise."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Day-wise sheets</CardTitle>
                  <p className="text-sm font-normal text-slate-500">
                    Open a saved day to re-mark (if unlocked) or review details. Matches
                    roster attendance taken by date and shift.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(registerQuery.data?.byDate ?? [])
                    .filter((day) =>
                      !registerMonthBs
                        ? true
                        : String(day.dateBs).startsWith(registerMonthBs),
                    )
                    .map((day) => (
                      <div key={day.dateBs} className="space-y-2">
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
                                  {shiftLabel(block.shift)}
                                </Badge>
                                <Badge
                                  className={`ml-1 ${statusClass(block.recordStatus)}`}
                                >
                                  {block.recordStatus}
                                </Badge>
                              </div>
                              <p className="text-xs text-slate-600">
                                P {block.summary.present} · A {block.summary.absent} · Late{" "}
                                {block.summary.late} · Leave {block.summary.leave} · Total{" "}
                                {block.summary.total}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1 px-3 py-2">
                              {canWrite ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setTab("mark");
                                    const sch = schedules.find(
                                      (s) => s._id === block.scheduleId,
                                    );
                                    if (sch) {
                                      selectPostingForMark(
                                        sch,
                                        block.shift as FieldDutyShift,
                                      );
                                    } else {
                                      setSelectedScheduleId(block.scheduleId);
                                      setMarkShift(block.shift as FieldDutyShift);
                                    }
                                    setMarkDateBs(day.dateBs);
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
                              ) : null}
                              {isAdmin &&
                              (block.recordStatus === "LOCKED" ||
                                block.recordStatus === "SUBMITTED") ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    unlockAttendance.mutate(block.attendanceId)
                                  }
                                >
                                  Unlock
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </CardContent>
              </Card>
            )
          ) : null}

          {/* Edit requests */}
          {(historyQuery.data ?? []).some(
            (r) => r.editRequest?.status === "PENDING",
          ) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending edit requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(historyQuery.data ?? [])
                  .filter((r) => r.editRequest?.status === "PENDING")
                  .map((rec) => (
                    <div
                      key={rec._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2 text-sm"
                    >
                      <p>
                        {rec.dateBs} · {rec.siteName || rec.hospitalName} ·{" "}
                        {shiftLabel(rec.shift)}
                      </p>
                      {isAdmin ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={() =>
                              reviewEdit.mutate({
                                id: rec._id,
                                decision: "APPROVED",
                              })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              reviewEdit.mutate({
                                id: rec._id,
                                decision: "REJECTED",
                              })
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <Badge className="bg-violet-100 text-violet-800">Pending</Badge>
                      )}
                    </div>
                  ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
