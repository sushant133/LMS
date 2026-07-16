import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  DAYS_OF_WEEK,
  timetableSlotSchema,
  type TimetableSlotInput,
} from "@phit-erp/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsCollege } from "hooks/useInstitutionType";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  type ScopeOption,
} from "lib/teacherScopeUtils";
import { cn, parseErrorMessage } from "lib/utils";

type SlotRow = {
  _id: string;
  dayOfWeek: number;
  periodNumber: number;
  subjectId?: { _id?: string; name?: string } | string;
  teacherId?:
    | { _id?: string; user?: { fullName?: string } }
    | string;
  startTime: string;
  endTime: string;
  room?: string;
  academicYearBs?: string;
  batchId?: { _id?: string; name?: string } | string;
  yearId?: { _id?: string; name?: string; level?: number } | string;
  classId?: { _id?: string; name?: string } | string;
  sectionId?: { _id?: string; name?: string } | string;
};

const defaultSlot = (): TimetableSlotInput => ({
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  dayOfWeek: 1,
  periodNumber: 1,
  subjectId: "",
  teacherId: "",
  room: "",
  startTime: "10:00",
  endTime: "10:45",
  academicYearBs: "2083/2084",
});

const idOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id?: string })._id ?? "");
  }
  return "";
};

const nameOf = (value: unknown, fallback = "—"): string => {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as {
      name?: string;
      user?: { fullName?: string };
    };
    return obj.name || obj.user?.fullName || fallback;
  }
  return fallback;
};

/** Program years only for weekly tables (exclude Ended). */
const isProgramYear = (year: ScopeOption & { level?: number; name?: string }) => {
  const name = (year.name ?? "").toLowerCase();
  if (name === "ended") return false;
  if (year.level != null && year.level >= 4) return false;
  return true;
};

export const TimetableManager = () => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isStudent = user?.role === "STUDENT";
  const isAdmin = canManageInstitution(user?.role ?? "");
  const canWrite = isAdmin || isTeacher;
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [form, setForm] = useState<TimetableSlotInput>(defaultSlot);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  /** Which year table is active for adding slots (college). */
  const [activeYearId, setActiveYearId] = useState("");

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/classes")),
    enabled: canWrite && !isCollege && !isStudent,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections", form.classId],
    queryFn: () =>
      unwrap<ScopeOption[]>(
        api.get("/academics/sections", { params: { classId: form.classId } }),
      ),
    enabled: canWrite && !isCollege && Boolean(form.classId),
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/batches")),
    enabled: (isAdmin || isTeacher) && isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years", form.batchId],
    queryFn: () =>
      unwrap<Array<ScopeOption & { level?: number; name?: string }>>(
        api.get("/academics/years", { params: { batchId: form.batchId } }),
      ),
    enabled: (isAdmin || isTeacher) && isCollege && Boolean(form.batchId),
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<ScopeOption[]>(api.get("/academics/subjects")),
    enabled: canWrite && !isStudent,
  });
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () =>
      unwrap<Array<{ _id: string; user: { fullName: string } }>>(
        api.get("/teachers"),
      ),
    enabled: isAdmin,
  });

  const primaryOptions: ScopeOption[] = isCollege
    ? isTeacher
      ? (teacherScopeQuery.data?.batches ?? batchesQuery.data ?? [])
      : (batchesQuery.data ?? [])
    : isTeacher
      ? (teacherScopeQuery.data?.classes ?? [])
      : (classesQuery.data ?? []);

  const secondaryOptions = isCollege
    ? isTeacher
      ? (teacherScopeQuery.data?.years ?? yearsQuery.data ?? [])
      : (yearsQuery.data ?? [])
    : isTeacher
      ? (teacherScopeQuery.data?.sections ?? [])
      : (sectionsQuery.data ?? []);

  const subjects = isTeacher
    ? (teacherScopeQuery.data?.subjects ?? [])
    : (subjectsQuery.data ?? []);
  const teacherId = isTeacher
    ? (teacherScopeQuery.data?.scope.teacherId ?? "")
    : form.teacherId;

  const primaryId = isCollege ? (form.batchId ?? "") : (form.classId ?? "");

  const filteredSections = useMemo(
    () => filterSectionsByClass(secondaryOptions, form.classId ?? ""),
    [form.classId, secondaryOptions],
  );
  const filteredYears = useMemo(() => {
    const years = filterYearsByBatch(
      secondaryOptions as ScopeOption[],
      form.batchId ?? "",
    ) as Array<ScopeOption & { level?: number; name?: string }>;
    return years.filter(isProgramYear).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  }, [form.batchId, secondaryOptions]);

  const formYearId = form.yearId || activeYearId;
  const filteredSubjects = useMemo(
    () =>
      isCollege
        ? filterSubjectsByYear(subjects, formYearId)
        : filterSubjectsByClass(subjects, form.classId ?? ""),
    [form.classId, formYearId, isCollege, subjects],
  );

  useEffect(() => {
    if (!isTeacher || !teacherScopeQuery.data) return;
    setForm((current) => ({
      ...current,
      teacherId: teacherScopeQuery.data!.scope.teacherId,
    }));
  }, [isTeacher, teacherScopeQuery.data]);

  // Timetable fetch
  const timetableParams = useMemo(() => {
    if (isStudent) return {}; // backend scopes to student batch/year
    if (isCollege) {
      const params: Record<string, string> = {};
      if (form.batchId) params.batchId = form.batchId;
      return params; // all years for batch (or all if no batch)
    }
    const params: Record<string, string> = {};
    if (form.classId) params.classId = form.classId;
    if (form.sectionId) params.sectionId = form.sectionId;
    return params;
  }, [form.batchId, form.classId, form.sectionId, isCollege, isStudent]);

  const timetableQuery = useQuery({
    queryKey: ["timetable", timetableParams, isStudent, isTeacher],
    queryFn: () =>
      unwrap<SlotRow[]>(
        api.get("/timetable", {
          params: Object.keys(timetableParams).length
            ? timetableParams
            : undefined,
        }),
      ),
    enabled: isStudent || isAdmin || isTeacher,
  });

  const slots = timetableQuery.data ?? [];

  /** Group slots by year (college) or section (school). */
  const tables = useMemo(() => {
    if (isCollege) {
      // Prefer known program years for the selected batch
      if (filteredYears.length > 0) {
        return filteredYears.map((year) => ({
          key: year._id,
          title: year.name || `Year ${year.level ?? ""}`,
          yearId: year._id,
          batchId: form.batchId ?? "",
          slots: slots.filter((s) => idOf(s.yearId) === year._id),
        }));
      }
      // Fall back: group whatever years appear in slots
      const byYear = new Map<
        string,
        { title: string; yearId: string; batchId: string; slots: SlotRow[] }
      >();
      for (const slot of slots) {
        const yid = idOf(slot.yearId) || "unknown";
        const title = nameOf(slot.yearId, "Year");
        if (title.toLowerCase() === "ended") continue;
        const existing = byYear.get(yid);
        if (existing) existing.slots.push(slot);
        else
          byYear.set(yid, {
            title,
            yearId: yid,
            batchId: idOf(slot.batchId),
            slots: [slot],
          });
      }
      return Array.from(byYear.entries()).map(([key, value]) => ({
        key,
        ...value,
      }));
    }

    // School mode: single table for selected class/section
    if (!form.classId || !form.sectionId) {
      return slots.length
        ? [
            {
              key: "all",
              title: "Weekly timetable",
              yearId: "",
              batchId: "",
              slots,
            },
          ]
        : [];
    }
    return [
      {
        key: `${form.classId}-${form.sectionId}`,
        title: "Weekly timetable",
        yearId: form.sectionId ?? "",
        batchId: form.classId ?? "",
        slots: slots.filter(
          (s) =>
            idOf(s.classId) === form.classId &&
            idOf(s.sectionId) === form.sectionId,
        ),
      },
    ];
  }, [filteredYears, form.batchId, form.classId, form.sectionId, isCollege, slots]);

  const saveMutation = useMutation({
    mutationFn: (payload: TimetableSlotInput) =>
      editingId
        ? unwrap(api.put(`/timetable/${editingId}`, payload))
        : unwrap(api.post("/timetable", payload)),
    onSuccess: async () => {
      toast.success(editingId ? "Timetable slot updated" : "Timetable slot saved");
      setEditingId(null);
      setShowForm(false);
      setForm((c) => ({
        ...defaultSlot(),
        batchId: c.batchId,
        yearId: activeYearId || c.yearId,
        classId: c.classId,
        sectionId: c.sectionId,
        academicYearBs: c.academicYearBs,
        teacherId: isTeacher ? teacherId : "",
      }));
      await queryClient.invalidateQueries({ queryKey: ["timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/timetable/${id}`)),
    onSuccess: async () => {
      toast.success("Timetable slot deleted");
      await queryClient.invalidateQueries({ queryKey: ["timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteYearMutation = useMutation({
    mutationFn: async (slotIds: string[]) => {
      for (const id of slotIds) {
        await unwrap(api.delete(`/timetable/${id}`));
      }
    },
    onSuccess: async () => {
      toast.success("Year timetable cleared");
      await queryClient.invalidateQueries({ queryKey: ["timetable"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const buildPayload = (): TimetableSlotInput => {
    const base: TimetableSlotInput = {
      dayOfWeek: form.dayOfWeek,
      periodNumber: form.periodNumber,
      subjectId: form.subjectId,
      teacherId: isTeacher ? teacherId : form.teacherId,
      room: form.room?.trim() ? form.room : undefined,
      startTime: form.startTime,
      endTime: form.endTime,
      academicYearBs: form.academicYearBs,
    };
    if (isCollege) {
      return {
        ...base,
        batchId: form.batchId,
        yearId: form.yearId || activeYearId,
      };
    }
    return { ...base, classId: form.classId, sectionId: form.sectionId };
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildPayload();
    const parsed = timetableSlotSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }
    saveMutation.mutate(parsed.data);
  };

  const startEdit = (slot: SlotRow) => {
    setEditingId(slot._id);
    setShowForm(true);
    setActiveYearId(idOf(slot.yearId));
    setForm({
      classId: idOf(slot.classId),
      sectionId: idOf(slot.sectionId),
      batchId: idOf(slot.batchId) || form.batchId || "",
      yearId: idOf(slot.yearId),
      dayOfWeek: slot.dayOfWeek,
      periodNumber: slot.periodNumber,
      subjectId: idOf(slot.subjectId),
      teacherId: idOf(slot.teacherId),
      room: slot.room ?? "",
      startTime: slot.startTime,
      endTime: slot.endTime,
      academicYearBs: slot.academicYearBs || form.academicYearBs,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startAddForYear = (yearId: string) => {
    setEditingId(null);
    setActiveYearId(yearId);
    setShowForm(true);
    setForm((c) => ({
      ...defaultSlot(),
      batchId: c.batchId,
      yearId,
      academicYearBs: c.academicYearBs,
      teacherId: isTeacher ? teacherId : "",
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const canEditSlot = (slot: SlotRow) => {
    if (isAdmin) return true;
    if (!isTeacher) return false;
    return idOf(slot.teacherId) === teacherId;
  };

  if (timetableQuery.isLoading && isStudent) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable Management"
        description={
          isStudent
            ? "Your weekly class schedule for your academic year."
            : isTeacher
              ? "View weekly timetables for 1st, 2nd, and 3rd year. Edit or delete periods you teach."
              : `Create a separate weekly timetable for each year (1st / 2nd / 3rd). Students only see their own year; teachers see all years.`
        }
      />

      {/* Scope selectors for admin / teacher (not student) */}
      {!isStudent ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isCollege ? "Select batch" : "Select class & section"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {isCollege ? (
              <FormField label="Batch">
                <Select
                  value={form.batchId ?? ""}
                  onChange={(e) => {
                    setForm((c) => ({
                      ...c,
                      batchId: e.target.value,
                      yearId: "",
                      subjectId: "",
                    }));
                    setActiveYearId("");
                  }}
                >
                  <option value="">Select batch</option>
                  {primaryOptions.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : (
              <>
                <FormField label="Class">
                  <Select
                    value={form.classId ?? ""}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        classId: e.target.value,
                        sectionId: "",
                        subjectId: "",
                      }))
                    }
                  >
                    <option value="">Select class</option>
                    {primaryOptions.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Section">
                  <Select
                    value={form.sectionId ?? ""}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        sectionId: e.target.value,
                        subjectId: "",
                      }))
                    }
                    disabled={!form.classId}
                  >
                    <option value="">Select section</option>
                    {filteredSections.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            )}
            <FormField label="Academic Year (BS)">
              <Input
                value={form.academicYearBs}
                onChange={(e) =>
                  setForm((c) => ({ ...c, academicYearBs: e.target.value }))
                }
              />
            </FormField>
          </CardContent>
        </Card>
      ) : null}

      {/* Add / Edit form */}
      {canWrite && showForm ? (
        <Card className="border-brand-200 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>
              {editingId ? "Edit timetable slot" : "Add timetable slot"}
              {isCollege && (form.yearId || activeYearId)
                ? ` · ${
                    filteredYears.find(
                      (y) => y._id === (form.yearId || activeYearId),
                    )?.name ?? "Year"
                  }`
                : ""}
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
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={handleSubmit}
            >
              {isCollege ? (
                <FormField label="Year">
                  <Select
                    value={form.yearId || activeYearId}
                    onChange={(e) => {
                      setActiveYearId(e.target.value);
                      setForm((c) => ({
                        ...c,
                        yearId: e.target.value,
                        subjectId: "",
                      }));
                    }}
                  >
                    <option value="">Select year</option>
                    {filteredYears.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Subject">
                <Select
                  value={form.subjectId}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, subjectId: e.target.value }))
                  }
                >
                  <option value="">Select subject</option>
                  {filteredSubjects.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isAdmin ? (
                <FormField label="Teacher">
                  <Select
                    value={form.teacherId}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, teacherId: e.target.value }))
                    }
                  >
                    <option value="">Select teacher</option>
                    {(teachersQuery.data ?? []).map((teacher) => (
                      <option key={teacher._id} value={teacher._id}>
                        {teacher.user.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Day">
                <Select
                  value={form.dayOfWeek}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      dayOfWeek: Number(e.target.value),
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
              <FormField label="Period">
                <NumberInput
                  min={1}
                  max={12}
                  value={form.periodNumber}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      periodNumber: e.target.valueAsNumber,
                    }))
                  }
                />
              </FormField>
              <FormField label="Start time">
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, startTime: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="End time">
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, endTime: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Room">
                <Input
                  value={form.room ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, room: e.target.value }))
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

      {/* Weekly tables — one per year (college) or one for class/section */}
      {timetableQuery.isLoading ? (
        <LoadingState />
      ) : isStudent ? (
        <Card>
          <CardHeader>
            <CardTitle>My weekly timetable</CardTitle>
            <p className="text-sm text-slate-600">
              Schedule for your enrolled year only.
            </p>
          </CardHeader>
          <CardContent>
            {slots.length === 0 ? (
              <EmptyState
                title="No timetable yet"
                description="Your year timetable has not been published. Contact the college office."
              />
            ) : (
              <SlotTable
                slots={slots}
                canWrite={false}
                onEdit={() => undefined}
                onDelete={() => undefined}
              />
            )}
          </CardContent>
        </Card>
      ) : isCollege && !form.batchId ? (
        <EmptyState
          title="Select a batch"
          description="Choose a batch to view separate weekly timetables for 1st, 2nd, and 3rd year."
        />
      ) : !isCollege && (!form.classId || !form.sectionId) ? (
        <EmptyState
          title={`Select ${labels.primary.toLowerCase()} and ${labels.secondary.toLowerCase()}`}
          description="Then view or edit the weekly timetable."
        />
      ) : (
        <div className="space-y-6">
          {tables.map((table) => (
            <Card key={table.key} className="border-slate-200">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">
                    {isCollege
                      ? `${table.title} — weekly timetable`
                      : "Weekly timetable"}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    {table.slots.length} period
                    {table.slots.length === 1 ? "" : "s"}
                    {isCollege
                      ? " · Visible to students of this year only"
                      : ""}
                  </p>
                </div>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (isCollege) {
                          startAddForYear(table.yearId);
                          return;
                        }
                        setEditingId(null);
                        setShowForm(true);
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add period
                    </Button>
                    {isAdmin && table.slots.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-700 border-rose-200"
                        disabled={deleteYearMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete all ${table.slots.length} slots for ${table.title}? This cannot be undone.`,
                            )
                          ) {
                            return;
                          }
                          deleteYearMutation.mutate(
                            table.slots.map((s) => s._id),
                          );
                        }}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Clear timetable
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                {table.slots.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No periods scheduled for this year yet.
                    {canWrite ? " Use Add period to build the weekly timetable." : ""}
                  </p>
                ) : (
                  <SlotTable
                    slots={table.slots}
                    canWrite={canWrite}
                    canEditSlot={canEditSlot}
                    onEdit={startEdit}
                    onDelete={(id) => {
                      if (!window.confirm("Delete this timetable period?")) {
                        return;
                      }
                      deleteMutation.mutate(id);
                    }}
                  />
                )}
              </CardContent>
            </Card>
          ))}
          {isCollege && tables.length === 0 ? (
            <EmptyState
              title="No program years"
              description="This batch has no 1st/2nd/3rd year configured. Create years under Academic Structure."
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

const SlotTable = ({
  slots,
  canWrite,
  canEditSlot,
  onEdit,
  onDelete,
}: {
  slots: SlotRow[];
  canWrite: boolean;
  canEditSlot?: (slot: SlotRow) => boolean;
  onEdit: (slot: SlotRow) => void;
  onDelete: (id: string) => void;
}) => {
  const sorted = [...slots].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.periodNumber - b.periodNumber,
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <tr>
            <Th>Day</Th>
            <Th>Period</Th>
            <Th>Subject</Th>
            <Th>Teacher</Th>
            <Th>Time</Th>
            <Th>Room</Th>
            {canWrite ? <Th className="text-right">Actions</Th> : null}
          </tr>
        </TableHead>
        <TableBody>
          {sorted.map((slot) => {
            const editable = canEditSlot ? canEditSlot(slot) : canWrite;
            return (
              <tr
                key={slot._id}
                className={cn(editable ? "" : canWrite ? "opacity-90" : "")}
              >
                <Td className="font-medium">
                  {DAYS_OF_WEEK[slot.dayOfWeek] ?? slot.dayOfWeek}
                </Td>
                <Td>{slot.periodNumber}</Td>
                <Td>{nameOf(slot.subjectId)}</Td>
                <Td>{nameOf(slot.teacherId)}</Td>
                <Td className="whitespace-nowrap text-sm">
                  {slot.startTime} – {slot.endTime}
                </Td>
                <Td>{slot.room || "—"}</Td>
                {canWrite ? (
                  <Td className="text-right">
                    {editable ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onEdit(slot)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-rose-700 border-rose-200"
                          onClick={() => onDelete(slot._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                ) : null}
              </tr>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
