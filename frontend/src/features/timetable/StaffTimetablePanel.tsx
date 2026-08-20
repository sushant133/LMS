import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DAYS_OF_WEEK,
  STAFF_TIMETABLE_SESSION_TYPE_LABELS,
  STAFF_TIMETABLE_SESSION_TYPES,
  TIMETABLE_BREAK_LABELS,
  type StaffTimetableSessionType,
  type StaffTimetableSlotRecord,
} from "@phit-erp/shared";
import { Download, Image as ImageIcon, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import {
  formatPrintAddress,
  getPrintInstitutionBranding,
} from "lib/printBranding";
import {
  downloadImageFromElementById,
  downloadPdfFromElementById,
  printElementById,
} from "lib/printUtils";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { SESSION_COLORS } from "./timetableColors";
import { TimetablePrintView } from "./TimetablePrintView";
import {
  buildWeeklyMatrix,
  uniqueRooms,
  type PeriodColumn,
  type TimetableSlotRow,
} from "./timetableMatrixUtils";
import { WeeklyTimetableGrid } from "./WeeklyTimetableGrid";

interface StaffTimetablePanelProps {
  academicYearBs: string;
  saturdayIsHoliday: boolean;
  canWrite: boolean;
}

interface StaffOption {
  _id: string;
  fullName: string;
  staffId?: string;
  designation?: string;
  department?: string;
  status?: string;
}

type StaffViewMode = "staff" | "department" | "room" | "combined";

const emptyForm = (academicYearBs: string) => ({
  staffId: "",
  dayOfWeek: 0,
  periodNumber: 1,
  startTime: "10:00",
  endTime: "10:50",
  sessionType: "DUTY" as StaffTimetableSessionType,
  dutyTitle: "",
  room: "",
  department: "",
  breakLabel: "",
  remarks: "",
  academicYearBs,
});

type SlotForm = ReturnType<typeof emptyForm>;

const idOfStaff = (value: StaffTimetableSlotRecord["staffId"]): string =>
  typeof value === "string" ? value : (value?._id ?? "");

const staffNameOf = (
  slot: StaffTimetableSlotRecord,
  people: StaffOption[],
): string => {
  const populated = typeof slot.staffId === "object" ? slot.staffId : null;
  if (populated?.fullName) return populated.fullName;
  const id = idOfStaff(slot.staffId);
  return people.find((p) => p._id === id)?.fullName || "Staff member";
};

const staffDesignationOf = (
  slot: StaffTimetableSlotRecord,
  people: StaffOption[],
): string => {
  const populated = typeof slot.staffId === "object" ? slot.staffId : null;
  if (populated?.designation) return populated.designation;
  const id = idOfStaff(slot.staffId);
  return people.find((p) => p._id === id)?.designation || "";
};

const mapStaffSlotToRow = (
  slot: StaffTimetableSlotRecord,
  people: StaffOption[],
): TimetableSlotRow => {
  const type = slot.sessionType ?? "DUTY";
  const sessionType =
    type === "BREAK" ? "BREAK" : type === "DAY_OFF" ? "HOLIDAY" : "SPECIAL";
  return {
    _id: slot._id,
    dayOfWeek: slot.dayOfWeek,
    periodNumber: slot.periodNumber,
    startTime: slot.startTime,
    endTime: slot.endTime,
    room: slot.room,
    academicYearBs: slot.academicYearBs,
    sessionType,
    breakLabel: slot.breakLabel,
    remarks: slot.remarks,
    badgeLabel: type === "DUTY" ? "Duty" : undefined,
    subjectId: {
      name:
        type === "DUTY"
          ? slot.dutyTitle || "Duty"
          : type === "BREAK"
            ? slot.breakLabel || "Break"
            : "Day off",
    },
    teacherId: { user: { fullName: staffNameOf(slot, people) } },
  };
};

export const StaffTimetablePanel = ({
  academicYearBs: yearFromParent,
  saturdayIsHoliday,
  canWrite,
}: StaffTimetablePanelProps) => {
  const [academicYearBs, setAcademicYearBs] = useState(yearFromParent);
  const [viewMode, setViewMode] = useState<StaffViewMode>("staff");
  const [staffFilter, setStaffFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SlotForm>(() => emptyForm(yearFromParent));
  const [periodTimeEdit, setPeriodTimeEdit] = useState<{
    period: PeriodColumn;
    staffId: string;
    tableTitle: string;
  } | null>(null);
  const [periodNewStart, setPeriodNewStart] = useState("");
  const [periodNewEnd, setPeriodNewEnd] = useState("");

  useEffect(() => {
    if (!yearFromParent) return;
    setAcademicYearBs((current) => current || yearFromParent);
    setForm((current) =>
      current.academicYearBs ? current : { ...current, academicYearBs: yearFromParent },
    );
  }, [yearFromParent]);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      unwrap<{
        schoolName?: string;
        schoolNameNp?: string;
        principalName?: string;
        academicYearBs?: string;
        address?: Parameters<typeof formatPrintAddress>[0];
      }>(api.get("/settings")),
  });

  useEffect(() => {
    const year = settingsQuery.data?.academicYearBs;
    if (!year) return;
    setAcademicYearBs((current) => current || year);
    setForm((current) =>
      current.academicYearBs ? current : { ...current, academicYearBs: year },
    );
  }, [settingsQuery.data?.academicYearBs]);

  const staffQuery = useQuery({
    queryKey: ["college-staff", "timetable-picker"],
    queryFn: () =>
      unwrap<StaffOption[]>(
        api.get("/college-staff", { params: { status: "ACTIVE" } }),
      ),
  });

  const slotsQuery = useQuery({
    queryKey: ["staff-timetable", academicYearBs, staffFilter, departmentFilter, roomFilter],
    queryFn: () =>
      unwrap<StaffTimetableSlotRecord[]>(
        api.get("/staff-timetable", {
          params: {
            academicYearBs: academicYearBs || undefined,
            staffId: viewMode === "staff" && staffFilter ? staffFilter : undefined,
            department:
              viewMode === "department" && departmentFilter
                ? departmentFilter
                : undefined,
            room: viewMode === "room" && roomFilter ? roomFilter : undefined,
          },
        }),
      ),
  });

  const staff = useMemo(() => staffQuery.data ?? [], [staffQuery.data]);
  const slots = useMemo(() => slotsQuery.data ?? [], [slotsQuery.data]);
  const allRooms = useMemo(
    () =>
      uniqueRooms(
        slots.map((slot) => ({
          _id: slot._id,
          dayOfWeek: slot.dayOfWeek,
          periodNumber: slot.periodNumber,
          startTime: slot.startTime,
          endTime: slot.endTime,
          room: slot.room,
        })),
      ),
    [slots],
  );

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const person of staff) {
      if (person.department?.trim()) set.add(person.department.trim());
    }
    for (const slot of slots) {
      if (slot.department?.trim()) set.add(slot.department.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [staff, slots]);

  type StaffTable = {
    key: string;
    title: string;
    subtitle?: string;
    staffId?: string;
    department?: string;
    slots: StaffTimetableSlotRecord[];
  };

  const tables = useMemo((): StaffTable[] => {
    if (viewMode === "combined" || viewMode === "room") {
      const title =
        viewMode === "room"
          ? `Room: ${roomFilter || "All"}`
          : "Combined staff timetable";
      return [{ key: "combined", title, slots }];
    }
    if (viewMode === "department") {
      const byDept = new Map<string, StaffTimetableSlotRecord[]>();
      for (const slot of slots) {
        const key = (slot.department || "General").trim() || "General";
        const list = byDept.get(key) ?? [];
        list.push(slot);
        byDept.set(key, list);
      }
      return [...byDept.entries()]
        .map(([department, rows]) => ({
          key: `dept-${department}`,
          title: department,
          department,
          slots: rows,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    }

    const byStaff = new Map<string, StaffTimetableSlotRecord[]>();
    for (const slot of slots) {
      const key = idOfStaff(slot.staffId);
      if (!key) continue;
      const list = byStaff.get(key) ?? [];
      list.push(slot);
      byStaff.set(key, list);
    }
    if (staffFilter && !byStaff.has(staffFilter)) {
      byStaff.set(staffFilter, []);
    }
    return [...byStaff.entries()]
      .map(([id, rows]) => {
        const sample = rows[0];
        const name = sample
          ? staffNameOf(sample, staff)
          : staff.find((p) => p._id === id)?.fullName || "Staff member";
        const designation = sample
          ? staffDesignationOf(sample, staff)
          : staff.find((p) => p._id === id)?.designation || "";
        return {
          key: id,
          staffId: id,
          title: name,
          subtitle: designation,
          slots: rows,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [slots, staff, viewMode, staffFilter, roomFilter]);

  const saveMutation = useMutation({
    mutationFn: async (payload: SlotForm) => {
      const body = {
        staffId: payload.staffId,
        dayOfWeek: payload.dayOfWeek,
        periodNumber: payload.periodNumber,
        startTime: payload.startTime,
        endTime: payload.endTime,
        academicYearBs: payload.academicYearBs || academicYearBs,
        sessionType: payload.sessionType,
        dutyTitle: payload.dutyTitle,
        room: payload.room,
        department: payload.department,
        breakLabel: payload.breakLabel,
        remarks: payload.remarks,
      };
      if (editingId) return unwrap(api.put(`/staff-timetable/${editingId}`, body));
      return unwrap(api.post("/staff-timetable", body));
    },
    onSuccess: async () => {
      toast.success(editingId ? "Duty slot updated" : "Duty slot saved");
      setShowForm(false);
      setEditingId(null);
      setForm((current) => ({
        ...emptyForm(current.academicYearBs || academicYearBs),
        staffId: staffFilter || "",
        academicYearBs: current.academicYearBs || academicYearBs,
      }));
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => unwrap(api.delete(`/staff-timetable/${slotId}`)),
    onSuccess: async () => {
      toast.success("Duty slot deleted");
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const clearMutation = useMutation({
    mutationFn: async (slotIds: string[]) => {
      for (const id of slotIds) {
        await unwrap(api.delete(`/staff-timetable/${id}`));
      }
    },
    onSuccess: async () => {
      toast.success("Staff timetable cleared");
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const periodTimeMutation = useMutation({
    mutationFn: (payload: {
      academicYearBs: string;
      staffId: string;
      oldStartTime: string;
      oldEndTime: string;
      newStartTime: string;
      newEndTime: string;
    }) =>
      unwrap<{
        updatedCount: number;
        daysUpdated: number;
        newStartTime: string;
        newEndTime: string;
      }>(api.put("/staff-timetable/period-times", payload)),
    onSuccess: async (data) => {
      toast.success(
        `Period time updated for ${data.updatedCount} slot(s) across ${data.daysUpdated} day(s) → ${data.newStartTime}–${data.newEndTime}`,
      );
      setPeriodTimeEdit(null);
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const startEdit = (row: TimetableSlotRow) => {
    const slot = slots.find((s) => s._id === row._id);
    if (!slot) return;
    setEditingId(slot._id);
    setForm({
      staffId: idOfStaff(slot.staffId),
      dayOfWeek: slot.dayOfWeek,
      periodNumber: slot.periodNumber > 900 ? 1 : slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      sessionType: slot.sessionType ?? "DUTY",
      dutyTitle: slot.dutyTitle ?? "",
      room: slot.room ?? "",
      department: slot.department ?? "",
      breakLabel: slot.breakLabel ?? "",
      remarks: slot.remarks ?? "",
      academicYearBs: slot.academicYearBs || academicYearBs,
    });
    setShowForm(true);
  };

  const startCreate = (staffId?: string) => {
    setEditingId(null);
    const preset = emptyForm(academicYearBs);
    const nextStaff = staffId || staffFilter;
    if (nextStaff) {
      preset.staffId = nextStaff;
      preset.department =
        staff.find((entry) => entry._id === nextStaff)?.department ?? "";
    }
    setForm(preset);
    setShowForm(true);
  };

  const handleDeleteSlot = (row: TimetableSlotRow) => {
    if (!window.confirm("Remove this duty slot from the staff timetable?")) return;
    deleteMutation.mutate(row._id);
  };

  const handlePrint = (printId: string) => {
    void printElementById(printId, "staff-timetable-print");
  };

  const handlePdf = async (printId: string, title: string) => {
    try {
      toast.message("Generating PDF…");
      await downloadPdfFromElementById(printId, `${title}.pdf`);
      toast.success("PDF downloaded");
    } catch (error) {
      toast.error(
        parseErrorMessage(error) ||
          "Could not download PDF. Try Print → Save as PDF.",
      );
    }
  };

  const handleImage = async (printId: string, filename: string) => {
    try {
      toast.message("Generating image…");
      await downloadImageFromElementById(printId, `${filename}.png`);
      toast.success("Image downloaded");
    } catch (error) {
      toast.error(
        parseErrorMessage(error) ||
          "Could not download image. Try Print → Save as PDF.",
      );
    }
  };

  const submitPeriodTimeEdit = () => {
    if (!periodTimeEdit) return;
    const start = periodNewStart.trim();
    const end = periodNewEnd.trim();
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      toast.error("Times must be HH:MM (24-hour), e.g. 10:00 and 10:50");
      return;
    }
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    if (toMin(start) >= toMin(end)) {
      toast.error("End time must be after start time");
      return;
    }
    if (
      start === periodTimeEdit.period.startTime &&
      end === periodTimeEdit.period.endTime
    ) {
      toast.error("Change the start or end time first");
      return;
    }
    if (
      !window.confirm(
        `Change this period from ${periodTimeEdit.period.startTime}–${periodTimeEdit.period.endTime} to ${start}–${end} for ALL days in ${periodTimeEdit.tableTitle}?`,
      )
    ) {
      return;
    }
    periodTimeMutation.mutate({
      academicYearBs,
      staffId: periodTimeEdit.staffId,
      oldStartTime: periodTimeEdit.period.startTime,
      oldEndTime: periodTimeEdit.period.endTime,
      newStartTime: start,
      newEndTime: end,
    });
  };

  const isNonDuty = form.sessionType === "BREAK" || form.sessionType === "DAY_OFF";

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.staffId) {
      toast.error("Select a staff member");
      return;
    }
    if (!form.startTime?.trim() || !form.endTime?.trim()) {
      toast.error("Start time and end time are required");
      return;
    }
    if (!isNonDuty && !form.dutyTitle.trim()) {
      toast.error("Duty / task is required");
      return;
    }
    if (!isNonDuty && (form.periodNumber < 1 || form.periodNumber > 12)) {
      toast.error("Period number (1–12) is required");
      return;
    }
    saveMutation.mutate({ ...form, academicYearBs: form.academicYearBs || academicYearBs });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Note
          </span>
          <Badge className={`${SESSION_COLORS.SPECIAL.badge} border ${SESSION_COLORS.SPECIAL.border}`}>
            Duty
          </Badge>
          <Badge className={`${SESSION_COLORS.BREAK.badge} border ${SESSION_COLORS.BREAK.border}`}>
            Break
          </Badge>
          <Badge className={`${SESSION_COLORS.HOLIDAY.badge} border ${SESSION_COLORS.HOLIDAY.border}`}>
            Day off
          </Badge>
          <Badge className={`${SESSION_COLORS.HOLIDAY_ROW.badge} border`}>
            Saturday holiday
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters & view</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Academic Year (BS)">
            <Input
              value={academicYearBs}
              onChange={(event) => {
                setAcademicYearBs(event.target.value);
                setForm((current) => ({
                  ...current,
                  academicYearBs: event.target.value,
                }));
              }}
            />
          </FormField>
          <FormField label="View mode">
            <Select
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as StaffViewMode)}
            >
              <option value="staff">By staff (weekly timetable)</option>
              <option value="department">By department</option>
              <option value="room">By room / location</option>
              <option value="combined">Combined weekly timetable</option>
            </Select>
          </FormField>
          {viewMode === "staff" ? (
            <FormField label="Staff member">
              <Select
                value={staffFilter}
                onChange={(event) => setStaffFilter(event.target.value)}
              >
                <option value="">All staff</option>
                {staff.map((person) => (
                  <option key={person._id} value={person._id}>
                    {person.fullName}
                    {person.designation ? ` — ${person.designation}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {viewMode === "department" ? (
            <FormField label="Department">
              <Select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {viewMode === "room" ? (
            <FormField label="Room / location">
              <Select
                value={roomFilter}
                onChange={(event) => setRoomFilter(event.target.value)}
              >
                <option value="">All rooms</option>
                {allRooms.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
        </CardContent>
      </Card>

      {canWrite && showForm ? (
        <Card className="border-brand-200 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>
              {editingId ? "Edit timetable slot" : "Add timetable slot"}
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              <X className="mr-1 h-4 w-4" />
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={handleSubmit}
            >
              <FormField label="Staff member">
                <Select
                  value={form.staffId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setForm((current) => ({
                      ...current,
                      staffId: nextId,
                      department:
                        staff.find((entry) => entry._id === nextId)?.department ??
                        current.department,
                    }));
                  }}
                >
                  <option value="">Select staff member</option>
                  {staff.map((person) => (
                    <option key={person._id} value={person._id}>
                      {person.fullName}
                      {person.designation ? ` — ${person.designation}` : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Session type">
                <Select
                  value={form.sessionType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sessionType: event.target.value as StaffTimetableSessionType,
                    }))
                  }
                >
                  {STAFF_TIMETABLE_SESSION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {STAFF_TIMETABLE_SESSION_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isNonDuty ? (
                form.sessionType === "BREAK" ? (
                  <FormField label="Break label">
                    <Select
                      value={form.breakLabel || ""}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          breakLabel: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select break</option>
                      {TIMETABLE_BREAK_LABELS.map((label) => (
                        <option key={label} value={label === "Custom" ? "" : label}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : (
                  <div className="flex items-end">
                    <p className="pb-2 text-xs text-slate-500">
                      Day off is not a duty period — only set the time interval.
                    </p>
                  </div>
                )
              ) : (
                <FormField label="Duty / task">
                  <Input
                    value={form.dutyTitle}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dutyTitle: event.target.value,
                      }))
                    }
                    placeholder="e.g. Fee counter, Front desk"
                  />
                </FormField>
              )}
              <FormField label="Day">
                <Select
                  value={form.dayOfWeek}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dayOfWeek: Number(event.target.value),
                    }))
                  }
                >
                  {DAYS_OF_WEEK.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </Select>
              </FormField>
              {!isNonDuty ? (
                <FormField label="Period">
                  <NumberInput
                    min={1}
                    max={12}
                    value={form.periodNumber}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        periodNumber: event.target.valueAsNumber,
                      }))
                    }
                  />
                </FormField>
              ) : (
                <div className="flex items-end">
                  <p className="pb-2 text-xs text-slate-500">
                    Break / day off is not a duty period — only set the time.
                  </p>
                </div>
              )}
              <FormField label={isNonDuty ? "Start time" : "Start time"}>
                <Input
                  type="time"
                  value={form.startTime}
                  required
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label={isNonDuty ? "End time" : "End time"}>
                <Input
                  type="time"
                  value={form.endTime}
                  required
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      endTime: event.target.value,
                    }))
                  }
                />
              </FormField>
              {!isNonDuty ? (
                <FormField label="Room / location">
                  <Input
                    value={form.room}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, room: event.target.value }))
                    }
                    placeholder="e.g. Admin Block, Counter 2"
                  />
                </FormField>
              ) : null}
              <FormField label="Department">
                <Input
                  value={form.department}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      department: event.target.value,
                    }))
                  }
                  placeholder="Defaults to the staff member's department"
                />
              </FormField>
              <FormField label="Remarks">
                <Input
                  value={form.remarks}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, remarks: event.target.value }))
                  }
                />
              </FormField>
              <div className="md:col-span-2 xl:col-span-4 flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {editingId ? "Update slot" : "Save slot"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {slotsQuery.isLoading ? (
        <LoadingState />
      ) : tables.length === 0 ? (
        <EmptyState
          title="No staff duties scheduled"
          description={
            canWrite
              ? "Use Add period — the weekly matrix builds automatically, same as Academic Timetable."
              : "The office has not published a staff duty timetable yet."
          }
        />
      ) : (
        <div className="space-y-6">
          {tables.map((table) => {
            const matrix = buildWeeklyMatrix(
              table.slots.map((slot) => mapStaffSlotToRow(slot, staff)),
              { saturdayIsHoliday },
            );
            const printId = `staff-timetable-print-${table.key}`;
            const viewTitle = table.subtitle
              ? `${table.title} · ${table.subtitle}`
              : table.title;
            return (
              <Card key={table.key} className="border-slate-200">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{viewTitle}</CardTitle>
                    <p className="text-xs text-slate-500">
                      {table.slots.length} period
                      {table.slots.length === 1 ? "" : "s"} · Matrix generated
                      from existing slots · Click a cell to edit
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="no-print"
                      onClick={() => handlePrint(printId)}
                    >
                      <Printer className="mr-1.5 h-4 w-4" />
                      Print
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="no-print"
                      onClick={() =>
                        void handlePdf(printId, `staff-timetable-${table.key}`)
                      }
                    >
                      <Download className="mr-1.5 h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="no-print"
                      onClick={() =>
                        void handleImage(printId, `staff-timetable-${table.key}`)
                      }
                    >
                      <ImageIcon className="mr-1.5 h-4 w-4" />
                      Image
                    </Button>
                    {canWrite ? (
                      <Button
                        size="sm"
                        className="no-print"
                        onClick={() => startCreate(table.staffId)}
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Add period
                      </Button>
                    ) : null}
                    {canWrite && table.slots.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="no-print border-rose-200 text-rose-700"
                        disabled={clearMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete all ${table.slots.length} slots for ${table.title}?`,
                            )
                          ) {
                            return;
                          }
                          clearMutation.mutate(table.slots.map((s) => s._id));
                        }}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {table.slots.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No periods scheduled yet.
                      {canWrite
                        ? " Use Add period — the weekly matrix builds automatically."
                        : ""}
                    </p>
                  ) : (
                    <WeeklyTimetableGrid
                      matrix={matrix}
                      onEditSlot={canWrite ? startEdit : undefined}
                      onDeleteSlot={canWrite ? handleDeleteSlot : undefined}
                      onChangePeriodTime={
                        canWrite && table.staffId
                          ? (period) => {
                              setPeriodTimeEdit({
                                period,
                                staffId: table.staffId!,
                                tableTitle: viewTitle,
                              });
                              setPeriodNewStart(period.startTime);
                              setPeriodNewEnd(period.endTime);
                            }
                          : undefined
                      }
                    />
                  )}
                  <TimetablePrintView
                    printId={printId}
                    matrix={matrix}
                    meta={{
                      collegeName:
                        settingsQuery.data?.schoolName ||
                        getPrintInstitutionBranding().name ||
                        "College",
                      collegeNameNp: settingsQuery.data?.schoolNameNp,
                      collegeAddress:
                        formatPrintAddress(settingsQuery.data?.address) ||
                        getPrintInstitutionBranding().address,
                      principalName: settingsQuery.data?.principalName,
                      academicYearBs,
                      viewTitle,
                      documentTitle: "Weekly Staff Timetable",
                      staffName: table.staffId ? table.title : undefined,
                      department: table.department,
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canWrite && !showForm && tables.length === 0 ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => startCreate()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add period
          </Button>
        </div>
      ) : null}

      {periodTimeEdit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-period-time-edit-title"
        >
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle id="staff-period-time-edit-title" className="text-lg">
                Change period time (all days)
              </CardTitle>
              <p className="text-sm text-slate-500">
                {periodTimeEdit.tableTitle}
                {" · "}
                Current: {periodTimeEdit.period.startTime}–
                {periodTimeEdit.period.endTime}
              </p>
              <p className="text-xs text-slate-500">
                This updates every weekday that uses this period column so the
                full week stays aligned.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="New start (HH:MM)">
                  <Input
                    type="time"
                    value={periodNewStart}
                    onChange={(event) => setPeriodNewStart(event.target.value)}
                  />
                </FormField>
                <FormField label="New end (HH:MM)">
                  <Input
                    type="time"
                    value={periodNewEnd}
                    onChange={(event) => setPeriodNewEnd(event.target.value)}
                  />
                </FormField>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPeriodTimeEdit(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={periodTimeMutation.isPending}
                  onClick={submitPeriodTimeEdit}
                >
                  Update week
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};
