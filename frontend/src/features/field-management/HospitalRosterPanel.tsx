import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BatchRecord,
  type CollegeStaffRecord,
  type DutyShiftRecord,
  type FieldHospitalRecord,
  type HospitalDepartmentRecord,
  type HospitalRosterCell,
  type HospitalRosterRecord,
  type HospitalRosterSummary,
  type YearRecord,
  DEFAULT_ROSTER_FREE_CODES,
} from "@phit-erp/shared";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Lock,
  LockOpen,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
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
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { cn, parseErrorMessage } from "lib/utils";

type SubTab =
  | "rosters"
  | "builder"
  | "summary"
  | "hospitals"
  | "departments"
  | "shifts";

interface Props {
  isAdmin: boolean;
}

const cellKey = (studentId: string, day: number) => `${studentId}:${day}`;

const statusBadge = (status: string) => {
  if (status === "LOCKED") return "bg-slate-800 text-white";
  if (status === "PUBLISHED") return "bg-emerald-100 text-emerald-800";
  return "bg-amber-100 text-amber-900";
};

/** Strip empty strings so ObjectId fields never send "" to the API. */
const cleanOptionalId = (value?: string | null): string | undefined => {
  if (!value || !String(value).trim()) return undefined;
  const s = String(value).trim();
  return /^[a-f\d]{24}$/i.test(s) ? s : undefined;
};

const sanitizeCellsForApi = (cells: HospitalRosterCell[]): HospitalRosterCell[] =>
  cells
    .map((c) => ({
      studentId: c.studentId,
      day: c.day,
      shiftId: cleanOptionalId(c.shiftId),
      departmentId: cleanOptionalId(c.departmentId),
      code: (c.code ?? "").trim(),
      remarks: (c.remarks ?? "").trim(),
    }))
    .filter((c) => Boolean(c.shiftId || c.departmentId || c.code));

export const HospitalRosterPanel = ({ isAdmin }: Props) => {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>("rosters");
  const [activeRosterId, setActiveRosterId] = useState<string | null>(null);

  const hospitalsQuery = useQuery({
    queryKey: ["field-duty", "hospitals"],
    queryFn: () =>
      unwrap<FieldHospitalRecord[]>(api.get("/field-duty/hospitals")),
  });
  const departmentsQuery = useQuery({
    queryKey: ["field-duty", "departments"],
    queryFn: () =>
      unwrap<HospitalDepartmentRecord[]>(api.get("/field-duty/departments")),
  });
  const shiftsQuery = useQuery({
    queryKey: ["field-duty", "shifts"],
    queryFn: () => unwrap<DutyShiftRecord[]>(api.get("/field-duty/shifts")),
  });
  const rostersQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters"],
    queryFn: () =>
      unwrap<HospitalRosterRecord[]>(api.get("/field-duty/hospital-rosters")),
  });
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
    queryKey: ["college-staff", "ACTIVE"],
    queryFn: () =>
      unwrap<CollegeStaffRecord[]>(
        api.get("/college-staff", { params: { status: "ACTIVE" } }),
      ),
    enabled: isAdmin,
  });

  const rosterQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters", activeRosterId],
    queryFn: () =>
      unwrap<HospitalRosterRecord>(
        api.get(`/field-duty/hospital-rosters/${activeRosterId}`),
      ),
    enabled: Boolean(activeRosterId),
  });

  const summaryQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters", activeRosterId, "summary"],
    queryFn: () =>
      unwrap<HospitalRosterSummary>(
        api.get(`/field-duty/hospital-rosters/${activeRosterId}/summary`),
      ),
    enabled: Boolean(activeRosterId) && subTab === "summary",
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["field-duty"] });
  };

  const openBuilder = (id: string) => {
    setActiveRosterId(id);
    setSubTab("builder");
  };

  const tabs: Array<{ id: SubTab; label: string; icon: typeof CalendarDays }> =
    [
      { id: "rosters", label: "Rosters", icon: CalendarDays },
      { id: "builder", label: "Roster Builder", icon: ClipboardList },
      { id: "summary", label: "Duty Summary", icon: ClipboardList },
      { id: "hospitals", label: "Hospitals", icon: Building2 },
      { id: "departments", label: "Departments", icon: Building2 },
      { id: "shifts", label: "Shifts", icon: CalendarDays },
    ];

  return (
    <div className="space-y-4">
      <Card className="border-brand-100 bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
        <CardContent className="py-4 text-sm text-slate-600">
          Hospital Roster is an additive clinical duty planner. Existing Community/PHC
          and Hospital Posting attendance workflows are unchanged.
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.id}
              size="sm"
              variant={subTab === t.id ? "default" : "outline"}
              onClick={() => setSubTab(t.id)}
            >
              <Icon className="mr-1.5 h-4 w-4" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {subTab === "hospitals" ? (
        <HospitalsManager
          isAdmin={isAdmin}
          hospitals={hospitalsQuery.data ?? []}
          staff={staffQuery.data ?? []}
          loading={hospitalsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "departments" ? (
        <DepartmentsManager
          isAdmin={isAdmin}
          departments={departmentsQuery.data ?? []}
          loading={departmentsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "shifts" ? (
        <ShiftsManager
          isAdmin={isAdmin}
          shifts={shiftsQuery.data ?? []}
          loading={shiftsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "rosters" ? (
        <RostersList
          isAdmin={isAdmin}
          rosters={rostersQuery.data ?? []}
          hospitals={hospitalsQuery.data ?? []}
          batches={batchesQuery.data ?? []}
          years={yearsQuery.data ?? []}
          staff={staffQuery.data ?? []}
          loading={rostersQuery.isLoading}
          onOpen={openBuilder}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "builder" ? (
        !activeRosterId ? (
          <EmptyState
            title="Select a roster"
            description="Open a roster from the Rosters tab to edit the student × day grid."
          />
        ) : rosterQuery.isLoading ? (
          <LoadingState />
        ) : rosterQuery.data ? (
          <RosterBuilder
            isAdmin={isAdmin}
            roster={rosterQuery.data}
            shifts={shiftsQuery.data ?? []}
            departments={departmentsQuery.data ?? []}
            onChanged={async () => {
              await invalidate();
              await rosterQuery.refetch();
            }}
          />
        ) : (
          <EmptyState title="Roster not found" description="It may have been deleted." />
        )
      ) : null}

      {subTab === "summary" ? (
        !activeRosterId ? (
          <EmptyState
            title="Select a roster"
            description="Open a roster first, then view duty summary and clinical record."
          />
        ) : summaryQuery.isLoading ? (
          <LoadingState />
        ) : summaryQuery.data ? (
          <DutySummaryView summary={summaryQuery.data} />
        ) : (
          <EmptyState title="No summary" description="Unable to load duty summary." />
        )
      ) : null}
    </div>
  );
};

// ─── Hospitals ──────────────────────────────────────────────────────────────

const HospitalsManager = ({
  isAdmin,
  hospitals,
  staff,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  hospitals: FieldHospitalRecord[];
  staff: CollegeStaffRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState({
    name: "",
    address: "",
    contact: "",
    coordinatorStaffId: "",
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
    remarks: "",
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/field-duty/hospitals", {
          ...form,
          coordinatorStaffId: cleanOptionalId(form.coordinatorStaffId),
        }),
      ),
    onSuccess: async () => {
      toast.success("Hospital created");
      setForm({
        name: "",
        address: "",
        contact: "",
        coordinatorStaffId: "",
        status: "ACTIVE",
        remarks: "",
      });
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/field-duty/hospitals/${id}`)),
    onSuccess: async () => {
      toast.success("Hospital deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add hospital</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Hospital name *">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Provincial Hospital Lahan"
              />
            </FormField>
            <FormField label="Address">
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </FormField>
            <FormField label="Contact">
              <Input
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              />
            </FormField>
            <FormField label="Coordinator">
              <Select
                value={form.coordinatorStaffId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coordinatorStaffId: e.target.value }))
                }
              >
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.fullName || s.user?.fullName || s.staffId || s._id}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Status">
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as "ACTIVE" | "INACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FormField>
            <Button
              disabled={!form.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" />
              Save hospital
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hospitals ({hospitals.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Address</Th>
                  <Th>Contact</Th>
                  <Th>Coordinator</Th>
                  <Th>Status</Th>
                  {isAdmin ? <Th /> : null}
                </tr>
              </TableHead>
              <TableBody>
                {hospitals.length === 0 ? (
                  <tr>
                    <Td colSpan={isAdmin ? 6 : 5} className="py-8 text-center text-slate-500">
                      No hospitals yet. Add Provincial Hospital Lahan, Gajendra Narayan Hospital, etc.
                    </Td>
                  </tr>
                ) : (
                  hospitals.map((h) => (
                    <tr key={h._id}>
                      <Td className="font-medium">{h.name}</Td>
                      <Td>{h.address || "—"}</Td>
                      <Td>{h.contact || "—"}</Td>
                      <Td>{h.coordinatorName || "—"}</Td>
                      <Td>
                        <Badge
                          className={
                            h.status === "ACTIVE"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {h.status}
                        </Badge>
                      </Td>
                      {isAdmin ? (
                        <Td className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (window.confirm(`Delete hospital "${h.name}"?`)) {
                                remove.mutate(h._id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Td>
                      ) : null}
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Departments ────────────────────────────────────────────────────────────

const DepartmentsManager = ({
  isAdmin,
  departments,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  departments: HospitalDepartmentRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");

  const create = useMutation({
    mutationFn: () =>
      unwrap(api.post("/field-duty/departments", { name, shortCode })),
    onSuccess: async () => {
      toast.success("Department added");
      setName("");
      setShortCode("");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Hospital departments</CardTitle>
        {isAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              className="w-40"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="w-24"
              placeholder="Code"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            />
            <Button
              size="sm"
              disabled={!name.trim() || !shortCode.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Add
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <Badge
              key={d._id}
              className={cn(
                "text-sm",
                d.isActive ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-500",
              )}
            >
              <span className="font-mono font-semibold">{d.shortCode}</span>
              <span className="mx-1 text-slate-400">·</span>
              {d.name}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Shifts ─────────────────────────────────────────────────────────────────

const ShiftsManager = ({
  isAdmin,
  shifts,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  shifts: DutyShiftRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState({
    name: "",
    shortCode: "",
    startTime: "07:00",
    endTime: "13:00",
    dutyHours: 6,
  });

  const create = useMutation({
    mutationFn: () => unwrap(api.post("/field-duty/shifts", form)),
    onSuccess: async () => {
      toast.success("Shift added");
      setForm({
        name: "",
        shortCode: "",
        startTime: "07:00",
        endTime: "13:00",
        dutyHours: 6,
      });
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add shift</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FormField label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FormField>
            <FormField label="Code">
              <Input
                value={form.shortCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shortCode: e.target.value.toUpperCase() }))
                }
              />
            </FormField>
            <FormField label="Start">
              <Input
                type="time"
                className="time-input"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </FormField>
            <FormField label="End">
              <Input
                type="time"
                className="time-input"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </FormField>
            <FormField label="Hours">
              <NumberInput
                min={0}
                max={24}
                step={0.5}
                value={form.dutyHours}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    dutyHours: e.target.valueAsNumber || 0,
                  }))
                }
              />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-5">
              <Button
                disabled={
                  !form.name.trim() || !form.shortCode.trim() || create.isPending
                }
                onClick={() => create.mutate()}
              >
                Add shift
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Duty shifts</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                  <Th>Time</Th>
                  <Th>Hours</Th>
                </tr>
              </TableHead>
              <TableBody>
                {shifts.map((s) => (
                  <tr key={s._id}>
                    <Td>
                      <span
                        className="mr-2 inline-block h-3 w-3 rounded-sm"
                        style={{ background: s.color || "#e2e8f0" }}
                      />
                      {s.name}
                    </Td>
                    <Td className="font-mono font-semibold">{s.shortCode}</Td>
                    <Td>
                      {s.startTime} – {s.endTime}
                    </Td>
                    <Td>{s.dutyHours}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Rosters list + create ──────────────────────────────────────────────────

const RostersList = ({
  isAdmin,
  rosters,
  hospitals,
  batches,
  years,
  staff,
  loading,
  onOpen,
  onChanged,
}: {
  isAdmin: boolean;
  rosters: HospitalRosterRecord[];
  hospitals: FieldHospitalRecord[];
  batches: BatchRecord[];
  years: YearRecord[];
  staff: CollegeStaffRecord[];
  loading: boolean;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState({
    name: "",
    academicYearBs: "2083",
    program: "HA",
    batchId: "",
    yearId: "",
    hospitalId: "",
    monthBs: "2083-01",
    daysInMonth: 30,
    coordinatorStaffId: "",
    remarks: "",
  });

  /**
   * College years are fixed per batch (1st / 2nd / 3rd …).
   * Never show every batch's years together — only years for the selected batch.
   */
  const yearsForBatch = useMemo(() => {
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
  }, [years, form.batchId]);

  const create = useMutation({
    mutationFn: () =>
      unwrap<HospitalRosterRecord>(
        api.post("/field-duty/hospital-rosters", {
          ...form,
          coordinatorStaffId: cleanOptionalId(form.coordinatorStaffId),
          daysInMonth: Number(form.daysInMonth) || 30,
        }),
      ),
    onSuccess: async (row) => {
      toast.success("Roster created — students loaded from batch/year");
      await onChanged();
      if (row?._id) onOpen(row._id);
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/field-duty/hospital-rosters/${id}`)),
    onSuccess: async () => {
      toast.success("Roster deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Create hospital roster</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Roster name *">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Provincial Hospital Lahan – Emergency – Magh 2083"
              />
            </FormField>
            <FormField label="Academic year (BS)">
              <Input
                value={form.academicYearBs}
                onChange={(e) =>
                  setForm((f) => ({ ...f, academicYearBs: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Program">
              <Input
                value={form.program}
                onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))}
              />
            </FormField>
            <FormField label="Batch *">
              <Select
                value={form.batchId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, batchId: e.target.value, yearId: "" }))
                }
              >
                <option value="">Select batch</option>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Year *">
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
              {form.batchId && yearsForBatch.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  No years found for this batch. Create years under Academics first.
                </p>
              ) : null}
            </FormField>
            <FormField label="Hospital *">
              <Select
                value={form.hospitalId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hospitalId: e.target.value }))
                }
              >
                <option value="">Select hospital</option>
                {hospitals
                  .filter((h) => h.status === "ACTIVE")
                  .map((h) => (
                    <option key={h._id} value={h._id}>
                      {h.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Month (BS YYYY-MM) *">
                <Input
                  value={form.monthBs}
                  onChange={(e) => setForm((f) => ({ ...f, monthBs: e.target.value }))}
                  placeholder="2083-03"
                />
              </FormField>
              <FormField label="Days">
                <NumberInput
                  min={28}
                  max={32}
                  value={form.daysInMonth}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      daysInMonth: e.target.valueAsNumber || 30,
                    }))
                  }
                />
              </FormField>
            </div>
            <FormField label="Coordinator">
              <Select
                value={form.coordinatorStaffId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coordinatorStaffId: e.target.value }))
                }
              >
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.fullName || s.user?.fullName || s.staffId || s._id}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Remarks">
              <Textarea
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </FormField>
            <Button
              disabled={
                create.isPending ||
                !form.name.trim() ||
                !form.batchId ||
                !form.yearId ||
                !form.hospitalId ||
                !form.monthBs
              }
              onClick={() => create.mutate()}
            >
              Create roster
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hospital rosters</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-2">
          {rosters.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No hospital rosters yet.
            </p>
          ) : (
            rosters.map((r) => (
              <div
                key={r._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">
                    {r.hospitalName ?? "Hospital"} · {r.monthBs} ·{" "}
                    {r.batchName ?? "Batch"} / {r.yearName ?? "Year"} ·{" "}
                    {(r.studentIds?.length ?? r.students?.length ?? 0)} students
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusBadge(r.status)}>{r.status}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => onOpen(r._id)}>
                    Open
                  </Button>
                  {isAdmin && r.status !== "LOCKED" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(`Delete roster "${r.name}"?`)) {
                          remove.mutate(r._id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Roster builder grid ────────────────────────────────────────────────────

const RosterBuilder = ({
  isAdmin,
  roster,
  shifts,
  departments,
  onChanged,
}: {
  isAdmin: boolean;
  roster: HospitalRosterRecord;
  shifts: DutyShiftRecord[];
  departments: HospitalDepartmentRecord[];
  onChanged: () => Promise<void>;
}) => {
  const locked = roster.status === "LOCKED";
  const days = Array.from(
    { length: Math.max(28, Math.min(32, roster.daysInMonth || 30)) },
    (_, i) => i + 1,
  );
  const students = roster.students ?? [];

  const [localCells, setLocalCells] = useState<HospitalRosterCell[]>(
    () => roster.cells ?? [],
  );
  const [selected, setSelected] = useState<{ studentId: string; day: number } | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const localCellsRef = useRef(localCells);
  localCellsRef.current = localCells;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Re-sync when opening a different roster. When the server revision changes,
  // only apply if there are no local unsaved edits (avoids wiping work mid-type).
  useEffect(() => {
    setLocalCells(roster.cells ?? []);
    setDirty(false);
    setSelected(null);
  }, [roster._id]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setLocalCells(roster.cells ?? []);
  }, [roster.updatedAt]);

  const cellMap = useMemo(() => {
    const m = new Map<string, HospitalRosterCell>();
    for (const c of localCells) {
      m.set(cellKey(c.studentId, c.day), c);
    }
    return m;
  }, [localCells]);

  const shiftById = useMemo(
    () => new Map(shifts.map((s) => [s._id, s])),
    [shifts],
  );
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d._id, d])),
    [departments],
  );

  const cellLabel = useCallback(
    (c?: HospitalRosterCell) => {
      if (!c) return "";
      const parts: string[] = [];
      if (c.shiftId) {
        const s = shiftById.get(c.shiftId);
        if (s) parts.push(s.shortCode);
      }
      if (c.departmentId) {
        const d = deptById.get(c.departmentId);
        if (d) parts.push(d.shortCode);
      }
      if (c.code?.trim()) parts.push(c.code.trim());
      return parts.join("/");
    },
    [shiftById, deptById],
  );

  const cellColor = useCallback(
    (c?: HospitalRosterCell) => {
      if (!c?.shiftId) return undefined;
      return shiftById.get(c.shiftId)?.color || undefined;
    },
    [shiftById],
  );

  const setCell = (studentId: string, day: number, patch: Partial<HospitalRosterCell>) => {
    if (locked || !isAdmin) return;
    setLocalCells((prev) => {
      const key = cellKey(studentId, day);
      const existing = prev.find((c) => cellKey(c.studentId, c.day) === key);
      const rawShift =
        patch.shiftId !== undefined ? patch.shiftId : existing?.shiftId;
      const rawDept =
        patch.departmentId !== undefined
          ? patch.departmentId
          : existing?.departmentId;
      const next: HospitalRosterCell = {
        studentId,
        day,
        shiftId: cleanOptionalId(rawShift),
        departmentId: cleanOptionalId(rawDept),
        code: patch.code !== undefined ? patch.code : existing?.code ?? "",
        remarks: patch.remarks !== undefined ? patch.remarks : existing?.remarks ?? "",
      };
      const empty =
        !next.shiftId && !next.departmentId && !(next.code || "").trim();
      const rest = prev.filter((c) => cellKey(c.studentId, c.day) !== key);
      return empty ? rest : [...rest, next];
    });
    setDirty(true);
  };

  const saveCells = useMutation({
    mutationFn: (cells: HospitalRosterCell[]) =>
      unwrap(
        api.put(`/field-duty/hospital-rosters/${roster._id}/cells`, {
          cells: sanitizeCellsForApi(cells),
          replace: true,
        }),
      ),
    onSuccess: async (_data, cells) => {
      toast.success("Roster saved");
      // Only clear dirty if the user did not edit further while the request was in flight.
      const stillMatches =
        JSON.stringify(sanitizeCellsForApi(localCellsRef.current)) ===
        JSON.stringify(sanitizeCellsForApi(cells));
      if (stillMatches) setDirty(false);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  // Auto-save draft every 25s when dirty (uses ref so latest cells are sent)
  useEffect(() => {
    if (!dirty || locked || !isAdmin) return;
    const t = window.setTimeout(() => {
      if (dirtyRef.current && !locked) {
        saveCells.mutate(localCellsRef.current);
      }
    }, 25000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-arm timer on dirty/cells
  }, [dirty, localCells, locked, isAdmin, roster._id]);

  const lockMut = useMutation({
    mutationFn: async () => {
      // Persist unsaved cells with lock so work is never lost.
      const body =
        dirtyRef.current
          ? { cells: sanitizeCellsForApi(localCellsRef.current) }
          : {};
      return unwrap(
        api.post(`/field-duty/hospital-rosters/${roster._id}/lock`, body),
      );
    },
    onSuccess: async () => {
      toast.success("Roster locked");
      setDirty(false);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const unlockMut = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/field-duty/hospital-rosters/${roster._id}/unlock`)),
    onSuccess: async () => {
      toast.success("Roster unlocked");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const fillRow = (studentId: string, shiftId: string, departmentId: string) => {
    if (locked || !isAdmin) return;
    const sh = cleanOptionalId(shiftId);
    const dep = cleanOptionalId(departmentId);
    setLocalCells((prev) => {
      const rest = prev.filter((c) => c.studentId !== studentId);
      if (!sh && !dep) return rest;
      const filled = days.map((day) => ({
        studentId,
        day,
        shiftId: sh,
        departmentId: dep,
        code: "",
        remarks: "",
      }));
      return [...rest, ...filled];
    });
    setDirty(true);
  };

  const clearRow = (studentId: string) => {
    if (locked || !isAdmin) return;
    setLocalCells((prev) => prev.filter((c) => c.studentId !== studentId));
    setDirty(true);
  };

  const copyDay = (fromDay: number, toDay: number) => {
    if (locked || !isAdmin) return;
    setLocalCells((prev) => {
      const from = prev.filter((c) => c.day === fromDay);
      const rest = prev.filter((c) => c.day !== toDay);
      const copied = from.map((c) => ({
        ...c,
        day: toDay,
        shiftId: cleanOptionalId(c.shiftId),
        departmentId: cleanOptionalId(c.departmentId),
      }));
      return [...rest, ...copied];
    });
    setDirty(true);
  };

  const selectedCell = selected
    ? cellMap.get(cellKey(selected.studentId, selected.day))
    : undefined;

  const printRoster = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      <Card className="print:shadow-none">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{roster.name}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {roster.hospitalName} · Month {roster.monthBs} ·{" "}
              {roster.batchName}/{roster.yearName} ·{" "}
              <Badge className={statusBadge(roster.status)}>{roster.status}</Badge>
              {dirty ? (
                <span className="ml-2 text-amber-700">Unsaved changes</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {isAdmin && !locked ? (
              <Button
                size="sm"
                disabled={!dirty || saveCells.isPending}
                onClick={() => saveCells.mutate(localCells)}
              >
                Save roster
              </Button>
            ) : null}
            {isAdmin && !locked ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => lockMut.mutate()}
                disabled={lockMut.isPending}
              >
                <Lock className="mr-1 h-3.5 w-3.5" />
                Lock
              </Button>
            ) : null}
            {isAdmin && locked ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => unlockMut.mutate()}
                disabled={unlockMut.isPending}
              >
                <LockOpen className="mr-1 h-3.5 w-3.5" />
                Unlock
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={printRoster}>
              <Printer className="mr-1 h-3.5 w-3.5" />
              Print
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {/* Quick tools */}
          {isAdmin && !locked ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (roster.daysInMonth >= 2) copyDay(1, 2);
                  toast.success("Copied day 1 → day 2 (adjust as needed)");
                }}
              >
                Copy day 1 → 2
              </Button>
              <span className="self-center text-xs text-slate-500">
                Select a cell to set shift + department. Use Fill row / Clear row per student.
              </span>
            </div>
          ) : null}

          {/* Grid */}
          <div className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain rounded-xl border border-slate-200 [scrollbar-width:thin]">
            <table className="w-full min-w-[1100px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-20 border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700">
                    Student
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className="border border-slate-200 px-1 py-2 text-center font-semibold text-slate-600"
                    >
                      {d}
                    </th>
                  ))}
                  <th className="border border-slate-200 px-2 py-2 text-left font-semibold text-slate-700">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td
                      colSpan={days.length + 2}
                      className="border border-slate-200 px-3 py-8 text-center text-slate-500"
                    >
                      No students in this roster. Re-create with batch/year or update students.
                    </td>
                  </tr>
                ) : (
                  students.map((st) => (
                    <tr key={st.studentId}>
                      <td className="sticky left-0 z-10 max-w-[160px] border border-slate-200 bg-white px-2 py-1 font-medium text-slate-900">
                        <div className="truncate" title={st.fullName}>
                          {st.fullName}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {st.rollNumber != null ? `R${st.rollNumber}` : ""}{" "}
                          {st.admissionNumber ?? ""}
                        </div>
                        {isAdmin && !locked ? (
                          <div className="mt-0.5 flex gap-1 print:hidden">
                            <button
                              type="button"
                              className="text-[10px] text-brand-700 underline"
                              onClick={() => {
                                const sh = shifts[0]?._id ?? "";
                                const dep = departments[0]?._id ?? "";
                                fillRow(st.studentId, sh, dep);
                              }}
                            >
                              Fill
                            </button>
                            <button
                              type="button"
                              className="text-[10px] text-rose-700 underline"
                              onClick={() => clearRow(st.studentId)}
                            >
                              Clear
                            </button>
                          </div>
                        ) : null}
                      </td>
                      {days.map((d) => {
                        const c = cellMap.get(cellKey(st.studentId, d));
                        const active =
                          selected?.studentId === st.studentId && selected.day === d;
                        return (
                          <td
                            key={d}
                            className={cn(
                              "border border-slate-200 px-0.5 py-0.5 text-center",
                              active && "ring-2 ring-brand-400 ring-inset",
                              isAdmin && !locked && "cursor-pointer hover:bg-brand-50",
                            )}
                            style={{ background: cellColor(c) }}
                            onClick={() => {
                              if (!isAdmin || locked) return;
                              setSelected({ studentId: st.studentId, day: d });
                            }}
                          >
                            <span className="font-mono text-[11px] font-semibold">
                              {cellLabel(c) || "·"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="border border-slate-200 px-1 text-[10px] text-slate-500">
                        {(() => {
                          const notes = days
                            .map((d) => cellMap.get(cellKey(st.studentId, d))?.remarks?.trim())
                            .filter(Boolean);
                          return notes.length ? notes.slice(0, 2).join("; ") : "—";
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cell editor */}
          {isAdmin && !locked && selected ? (
            <Card className="border-brand-200 bg-brand-50/40 print:hidden">
              <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <p className="sm:col-span-2 lg:col-span-4 text-sm font-medium text-slate-800">
                  Editing day {selected.day} —{" "}
                  {students.find((s) => s.studentId === selected.studentId)?.fullName}
                </p>
                <FormField label="Shift">
                  <Select
                    value={selectedCell?.shiftId ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        shiftId: e.target.value || "",
                      })
                    }
                  >
                    <option value="">—</option>
                    {shifts
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.shortCode} — {s.name}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="Department">
                  <Select
                    value={selectedCell?.departmentId ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        departmentId: e.target.value || "",
                      })
                    }
                  >
                    <option value="">—</option>
                    {departments
                      .filter((d) => d.isActive)
                      .map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.shortCode} — {d.name}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="Code (Off / Leave / …)">
                  <Select
                    value={selectedCell?.code ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        code: e.target.value,
                      })
                    }
                  >
                    <option value="">—</option>
                    {DEFAULT_ROSTER_FREE_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Cell remarks">
                  <Input
                    value={selectedCell?.remarks ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        remarks: e.target.value,
                      })
                    }
                  />
                </FormField>
                <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCell(selected.studentId, selected.day, {
                        // Empty string (not undefined) = explicit clear
                        shiftId: "",
                        departmentId: "",
                        code: "",
                        remarks: "",
                      })
                    }
                  >
                    Clear cell
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>
                    Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Legend:</span>
            {shifts
              .filter((s) => s.isActive)
              .map((s) => (
                <span key={s._id}>
                  <span className="font-mono font-semibold">{s.shortCode}</span>={s.name} (
                  {s.dutyHours}h)
                </span>
              ))}
            {DEFAULT_ROSTER_FREE_CODES.map((c) => (
              <span key={c.code}>
                <span className="font-mono font-semibold">{c.code}</span>={c.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Duty summary / clinical record ─────────────────────────────────────────

const DutySummaryView = ({ summary }: { summary: HospitalRosterSummary }) => {
  const deptCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of summary.clinicalRecord) {
      Object.keys(row.byDepartment).forEach((k) => set.add(k));
    }
    summary.departmentLegend.forEach((d) => set.add(d.shortCode));
    return Array.from(set).sort();
  }, [summary]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Student duty summary</CardTitle>
            <p className="text-sm text-slate-500">{summary.roster.name}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHead>
                <tr>
                  <Th>Student</Th>
                  <Th>Total duties</Th>
                  <Th>Duty hours</Th>
                  <Th>Working days</Th>
                  <Th>Leave</Th>
                  <Th>Off</Th>
                  <Th>By shift</Th>
                  <Th>By department</Th>
                </tr>
              </TableHead>
              <TableBody>
                {summary.dutySummary.map((row) => (
                  <tr key={row.studentId}>
                    <Td className="font-medium">{row.fullName}</Td>
                    <Td>{row.totalDuties}</Td>
                    <Td>{row.totalDutyHours}</Td>
                    <Td>{row.workingDays}</Td>
                    <Td>{row.leaveDays}</Td>
                    <Td>{row.offDays}</Td>
                    <Td className="text-xs">
                      {Object.entries(row.byShift)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(" · ") || "—"}
                    </Td>
                    <Td className="text-xs">
                      {Object.entries(row.byDepartment)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(" · ") || "—"}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinical duty record</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHead>
                <tr>
                  <Th>Student</Th>
                  {deptCodes.map((c) => (
                    <Th key={c} className="text-center">
                      {c}
                    </Th>
                  ))}
                  <Th className="text-right">Total</Th>
                </tr>
              </TableHead>
              <TableBody>
                {summary.clinicalRecord.map((row) => (
                  <tr key={row.studentId}>
                    <Td className="font-medium">{row.fullName}</Td>
                    {deptCodes.map((c) => (
                      <Td key={c} className="text-center tabular-nums">
                        {row.byDepartment[c] ?? 0}
                      </Td>
                    ))}
                    <Td className="text-right font-semibold">{row.totalDuties}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
