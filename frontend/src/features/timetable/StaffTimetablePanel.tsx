import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  STAFF_TIMETABLE_SESSION_TYPE_LABELS,
  STAFF_TIMETABLE_SESSION_TYPES,
  type StaffTimetableSessionType,
  type StaffTimetableSlotRecord,
} from "@phit-erp/shared";
import { Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { printElementById } from "lib/printUtils";
import { cn, parseErrorMessage } from "lib/utils";

/**
 * Weekly duty timetable for non-teaching college staff.
 *
 * Deliberately its own grid rather than a reuse of WeeklyTimetableGrid: that one
 * is built around subject/teacher cells and the academic colour system, and a
 * duty roster carries neither. The layout still mirrors it — days down, period
 * columns across — so the two sections read the same way.
 */
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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const SESSION_STYLES: Record<StaffTimetableSessionType, string> = {
  DUTY: "bg-sky-50 border-sky-200 text-sky-900",
  BREAK: "bg-amber-50 border-amber-200 text-amber-900",
  DAY_OFF: "bg-slate-100 border-slate-300 text-slate-600",
};

const PRINT_ID = "staff-timetable-print";

const emptyForm = () => ({
  staffId: "",
  dayOfWeek: 0,
  periodNumber: 1,
  startTime: "10:00",
  endTime: "11:00",
  sessionType: "DUTY" as StaffTimetableSessionType,
  dutyTitle: "",
  room: "",
  department: "",
  breakLabel: "",
  remarks: "",
});

type SlotForm = ReturnType<typeof emptyForm>;

const idOf = (value: StaffTimetableSlotRecord["staffId"]): string =>
  typeof value === "string" ? value : (value?._id ?? "");

const timeToMinutes = (time: string): number => {
  const parts = String(time ?? "00:00").split(":");
  return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
};

export const StaffTimetablePanel = ({
  academicYearBs,
  saturdayIsHoliday,
  canWrite,
}: StaffTimetablePanelProps) => {
  const [staffFilter, setStaffFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SlotForm>(emptyForm);

  const staffQuery = useQuery({
    queryKey: ["college-staff", "timetable-picker"],
    queryFn: () =>
      unwrap<StaffOption[]>(api.get("/college-staff", { params: { status: "ACTIVE" } })),
  });

  const slotsQuery = useQuery({
    queryKey: ["staff-timetable", academicYearBs, staffFilter, departmentFilter],
    queryFn: () =>
      unwrap<StaffTimetableSlotRecord[]>(
        api.get("/staff-timetable", {
          params: {
            academicYearBs,
            staffId: staffFilter || undefined,
            department: departmentFilter || undefined,
          },
        }),
      ),
  });

  const staff = useMemo(() => staffQuery.data ?? [], [staffQuery.data]);
  const slots = useMemo(() => slotsQuery.data ?? [], [slotsQuery.data]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const person of staff) {
      if (person.department?.trim()) set.add(person.department.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [staff]);

  const visibleDays = useMemo(
    () => (saturdayIsHoliday ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]),
    [saturdayIsHoliday],
  );

  /**
   * Group the roster by staff member so each person gets their own grid, the
   * same way the academic view renders one table per year.
   */
  const staffTables = useMemo(() => {
    const byStaff = new Map<string, StaffTimetableSlotRecord[]>();
    for (const slot of slots) {
      const key = idOf(slot.staffId);
      if (!key) continue;
      const existing = byStaff.get(key);
      if (existing) existing.push(slot);
      else byStaff.set(key, [slot]);
    }

    return [...byStaff.entries()]
      .map(([id, rows]) => {
        const person = staff.find((entry) => entry._id === id);
        const populated = typeof rows[0]?.staffId === "object" ? rows[0].staffId : null;
        const name =
          person?.fullName ??
          (populated && typeof populated === "object" ? populated.fullName : "") ??
          "Staff member";
        const designation =
          person?.designation ??
          (populated && typeof populated === "object" ? populated.designation : "") ??
          "";

        // Period columns are the distinct time ranges this person actually works,
        // so someone on a short shift does not get a grid full of empty columns.
        const columns = [
          ...new Map(
            rows.map((row) => [`${row.startTime}-${row.endTime}`, row]),
          ).values(),
        ]
          .map((row) => ({
            key: `${row.startTime}-${row.endTime}`,
            startTime: row.startTime,
            endTime: row.endTime,
            periodNumber: row.periodNumber,
          }))
          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

        return { staffId: id, name, designation, rows, columns };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [slots, staff]);

  const saveMutation = useMutation({
    mutationFn: async (payload: SlotForm) => {
      const body = {
        staffId: payload.staffId,
        dayOfWeek: payload.dayOfWeek,
        periodNumber: payload.periodNumber,
        startTime: payload.startTime,
        endTime: payload.endTime,
        academicYearBs,
        sessionType: payload.sessionType,
        dutyTitle: payload.dutyTitle,
        room: payload.room,
        department: payload.department,
        breakLabel: payload.breakLabel,
        remarks: payload.remarks,
      };
      if (editingId) return api.put(`/staff-timetable/${editingId}`, body);
      return api.post("/staff-timetable", body);
    },
    onSuccess: async () => {
      toast.success(editingId ? "Duty slot updated" : "Duty slot added");
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/staff-timetable/${slotId}`),
    onSuccess: async () => {
      toast.success("Duty slot removed");
      await queryClient.invalidateQueries({ queryKey: ["staff-timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const startEdit = (slot: StaffTimetableSlotRecord) => {
    setEditingId(slot._id);
    setForm({
      staffId: idOf(slot.staffId),
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
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingId(null);
    const preset = emptyForm();
    if (staffFilter) {
      preset.staffId = staffFilter;
      preset.department =
        staff.find((entry) => entry._id === staffFilter)?.department ?? "";
    }
    setForm(preset);
    setShowForm(true);
  };

  const handleDelete = (slot: StaffTimetableSlotRecord) => {
    if (!window.confirm("Remove this duty slot from the staff timetable?")) return;
    deleteMutation.mutate(slot._id);
  };

  const isNonDuty = form.sessionType === "BREAK" || form.sessionType === "DAY_OFF";
  const canSubmit =
    Boolean(form.staffId) &&
    (isNonDuty || form.dutyTitle.trim().length > 0) &&
    !saveMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Staff duty timetable</CardTitle>
          <p className="text-sm text-slate-500">
            Weekly duty roster for non-teaching college staff. Academic year {academicYearBs}.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

          <div className="flex items-end gap-2 xl:col-span-2">
            {canWrite ? (
              <Button type="button" onClick={startCreate}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add duty slot
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={staffTables.length === 0}
              onClick={() => printElementById(PRINT_ID, "Staff Duty Timetable")}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {showForm && canWrite ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
            <CardTitle className="text-base">
              {editingId ? "Edit duty slot" : "New duty slot"}
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

              <FormField label="Day">
                <Select
                  value={String(form.dayOfWeek)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dayOfWeek: Number(event.target.value),
                    }))
                  }
                >
                  {visibleDays.map((day) => (
                    <option key={day} value={day}>
                      {DAY_NAMES[day]}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Entry type">
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

              {!isNonDuty ? (
                <FormField label="Period (1–12)">
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={form.periodNumber}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        periodNumber: Number(event.target.value),
                      }))
                    }
                  />
                </FormField>
              ) : null}

              <FormField label="Start time">
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startTime: event.target.value }))
                  }
                />
              </FormField>

              <FormField label="End time">
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, endTime: event.target.value }))
                  }
                />
              </FormField>

              {!isNonDuty ? (
                <>
                  <FormField label="Duty / task">
                    <Input
                      value={form.dutyTitle}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, dutyTitle: event.target.value }))
                      }
                      placeholder="e.g. Fee counter, Front desk"
                    />
                  </FormField>

                  <FormField label="Location / room">
                    <Input
                      value={form.room}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, room: event.target.value }))
                      }
                      placeholder="e.g. Admin Block, Counter 2"
                    />
                  </FormField>
                </>
              ) : null}

              {form.sessionType === "BREAK" ? (
                <FormField label="Break label">
                  <Input
                    value={form.breakLabel}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, breakLabel: event.target.value }))
                    }
                    placeholder="e.g. Lunch Break"
                  />
                </FormField>
              ) : null}

              <FormField label="Department">
                <Input
                  value={form.department}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, department: event.target.value }))
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
            </div>

            <div className="flex justify-end gap-2">
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
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => saveMutation.mutate(form)}
              >
                {editingId ? "Save changes" : "Add slot"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {slotsQuery.isLoading ? (
        <LoadingState />
      ) : staffTables.length === 0 ? (
        <EmptyState
          title="No staff duties scheduled"
          description={
            canWrite
              ? "Add a duty slot to start building the weekly staff roster."
              : "The office has not published a staff duty timetable yet."
          }
        />
      ) : (
        <div id={PRINT_ID} className="space-y-6">
          {staffTables.map((table) => (
            <Card key={table.staffId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {table.name}
                  {table.designation ? (
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {table.designation}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-r border-slate-200 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Day
                        </th>
                        {table.columns.map((column) => (
                          <th
                            key={column.key}
                            className="border-b border-r border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-600"
                          >
                            {column.startTime}–{column.endTime}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDays.map((day) => (
                        <tr key={day}>
                          <td className="border-b border-r border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700">
                            {DAY_NAMES[day]}
                          </td>
                          {table.columns.map((column) => {
                            const slot = table.rows.find(
                              (row) =>
                                row.dayOfWeek === day &&
                                `${row.startTime}-${row.endTime}` === column.key,
                            );
                            if (!slot) {
                              return (
                                <td
                                  key={column.key}
                                  className="border-b border-r border-slate-200 px-2 py-2 text-center text-xs text-slate-300"
                                >
                                  —
                                </td>
                              );
                            }
                            const type = slot.sessionType ?? "DUTY";
                            return (
                              <td
                                key={column.key}
                                className="border-b border-r border-slate-200 p-1 align-top"
                              >
                                <div
                                  className={cn(
                                    "group relative rounded-lg border px-2 py-1.5",
                                    SESSION_STYLES[type],
                                  )}
                                >
                                  <div className="text-xs font-semibold">
                                    {type === "DUTY"
                                      ? slot.dutyTitle || "Duty"
                                      : type === "BREAK"
                                        ? slot.breakLabel || "Break"
                                        : "Day off"}
                                  </div>
                                  {slot.room ? (
                                    <div className="text-[11px] opacity-80">{slot.room}</div>
                                  ) : null}
                                  {slot.department ? (
                                    <div className="text-[10px] uppercase tracking-wide opacity-70">
                                      {slot.department}
                                    </div>
                                  ) : null}
                                  {canWrite ? (
                                    <div className="mt-1 flex gap-1 opacity-0 transition group-hover:opacity-100 print:hidden">
                                      <button
                                        type="button"
                                        className="rounded p-0.5 hover:bg-white/70"
                                        aria-label="Edit duty slot"
                                        onClick={() => startEdit(slot)}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded p-0.5 text-rose-700 hover:bg-white/70"
                                        aria-label="Delete duty slot"
                                        onClick={() => handleDelete(slot)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
