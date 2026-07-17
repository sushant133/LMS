import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  DAYS_OF_WEEK,
  TIMETABLE_BREAK_LABELS,
  TIMETABLE_ROOM_KINDS,
  TIMETABLE_SESSION_TYPES,
  timetableSlotSchema,
  type TimetableSlotInput,
} from "@phit-erp/shared";
import {
  Download,
  Image as ImageIcon,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { useIsCollege } from "hooks/useInstitutionType";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { downloadPdfFromElementById, printElementById } from "lib/printUtils";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  type ScopeOption,
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";
import { SESSION_COLORS, SESSION_LABELS } from "./timetableColors";
import { TimetablePrintView } from "./TimetablePrintView";
import {
  buildWeeklyMatrix,
  filterSlotsByView,
  idOf,
  nameOf,
  uniqueRooms,
  type TimetableSlotRow,
} from "./timetableMatrixUtils";
import { WeeklyTimetableGrid } from "./WeeklyTimetableGrid";

type ViewMode = "group" | "mine" | "teacher" | "room" | "lab";

const SATURDAY_KEY = "phit-timetable-saturday-holiday";

const defaultSlot = (): TimetableSlotInput => ({
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  dayOfWeek: 0,
  periodNumber: 1,
  subjectId: "",
  teacherId: "",
  room: "",
  startTime: "06:30",
  endTime: "07:20",
  academicYearBs: "2083/2084",
  sessionType: "THEORY",
  breakLabel: "",
  remarks: "",
  roomKind: undefined,
});

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
  const [activeYearId, setActiveYearId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    isTeacher ? "mine" : isStudent ? "group" : "group",
  );
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterRoom, setFilterRoom] = useState("");
  const [saturdayIsHoliday, setSaturdayIsHoliday] = useState(() => {
    try {
      const v = localStorage.getItem(SATURDAY_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SATURDAY_KEY, saturdayIsHoliday ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [saturdayIsHoliday]);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      unwrap<{
        schoolName?: string;
        schoolNameNp?: string;
        principalName?: string;
        academicYearBs?: string;
      }>(api.get("/settings")),
    enabled: !isStudent,
  });

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
    enabled: isAdmin || viewMode === "teacher",
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

  const timetableParams = useMemo(() => {
    if (isStudent) return {};
    if (isCollege) {
      const params: Record<string, string> = {};
      if (form.batchId) params.batchId = form.batchId;
      if (viewMode === "mine") params.mineOnly = "1";
      if (viewMode === "teacher" && filterTeacherId) {
        params.teacherId = filterTeacherId;
      }
      if (viewMode === "room" && filterRoom) params.room = filterRoom;
      if (viewMode === "lab") params.labOnly = "1";
      return params;
    }
    const params: Record<string, string> = {};
    if (form.classId) params.classId = form.classId;
    if (form.sectionId) params.sectionId = form.sectionId;
    if (viewMode === "mine") params.mineOnly = "1";
    if (viewMode === "teacher" && filterTeacherId) {
      params.teacherId = filterTeacherId;
    }
    if (viewMode === "room" && filterRoom) params.room = filterRoom;
    if (viewMode === "lab") params.labOnly = "1";
    return params;
  }, [
    filterRoom,
    filterTeacherId,
    form.batchId,
    form.classId,
    form.sectionId,
    isCollege,
    isStudent,
    viewMode,
  ]);

  const timetableQuery = useQuery({
    queryKey: ["timetable", timetableParams, isStudent, isTeacher, viewMode],
    queryFn: () =>
      unwrap<TimetableSlotRow[]>(
        api.get("/timetable", {
          params: Object.keys(timetableParams).length
            ? timetableParams
            : undefined,
        }),
      ),
    enabled: isStudent || isAdmin || isTeacher,
  });

  const slots = timetableQuery.data ?? [];
  const mineTeacherId = teacherScopeQuery.data?.scope.teacherId ?? "";

  const tables = useMemo(() => {
    const scoped = filterSlotsByView(slots, {
      mode: viewMode === "group" ? "group" : viewMode,
      teacherId: filterTeacherId,
      room: filterRoom,
      mineTeacherId,
    });

    if (isCollege) {
      if (filteredYears.length > 0 && viewMode === "group") {
        return filteredYears.map((year) => ({
          key: year._id,
          title: year.name || `Year ${year.level ?? ""}`,
          yearId: year._id,
          batchId: form.batchId ?? "",
          slots: scoped.filter((s) => idOf(s.yearId) === year._id),
        }));
      }
      const byYear = new Map<
        string,
        { title: string; yearId: string; batchId: string; slots: TimetableSlotRow[] }
      >();
      for (const slot of scoped) {
        const yid = idOf(slot.yearId) || "all";
        const title = nameOf(slot.yearId, "All years");
        if (title.toLowerCase() === "ended") continue;
        const existing = byYear.get(yid);
        if (existing) existing.slots.push(slot);
        else
          byYear.set(yid, {
            title,
            yearId: yid,
            batchId: idOf(slot.batchId) || form.batchId || "",
            slots: [slot],
          });
      }
      if (byYear.size === 0 && scoped.length === 0) {
        return filteredYears.map((year) => ({
          key: year._id,
          title: year.name || `Year ${year.level ?? ""}`,
          yearId: year._id,
          batchId: form.batchId ?? "",
          slots: [] as TimetableSlotRow[],
        }));
      }
      return Array.from(byYear.entries()).map(([key, value]) => ({
        key,
        ...value,
      }));
    }

    if (!form.classId || !form.sectionId) {
      return scoped.length
        ? [
            {
              key: "all",
              title: "Weekly timetable",
              yearId: "",
              batchId: "",
              slots: scoped,
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
        slots: scoped.filter(
          (s) =>
            idOf(s.classId) === form.classId &&
            idOf(s.sectionId) === form.sectionId,
        ),
      },
    ];
  }, [
    filterRoom,
    filterTeacherId,
    filteredYears,
    form.batchId,
    form.classId,
    form.sectionId,
    isCollege,
    mineTeacherId,
    slots,
    viewMode,
  ]);

  const allRooms = useMemo(() => uniqueRooms(slots), [slots]);

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

  const isBreak = form.sessionType === "BREAK" || form.sessionType === "HOLIDAY";

  const buildPayload = (): TimetableSlotInput => {
    const base: TimetableSlotInput = {
      dayOfWeek: form.dayOfWeek,
      periodNumber: form.periodNumber,
      subjectId: isBreak ? "" : form.subjectId,
      teacherId: isBreak ? "" : isTeacher ? teacherId : form.teacherId,
      room: form.room?.trim() ? form.room : undefined,
      startTime: form.startTime,
      endTime: form.endTime,
      academicYearBs: form.academicYearBs,
      sessionType: form.sessionType ?? "THEORY",
      breakLabel: form.breakLabel ?? "",
      remarks: form.remarks ?? "",
      roomKind: form.roomKind,
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

  const startEdit = (slot: TimetableSlotRow) => {
    if (!canWrite) return;
    if (isTeacher && idOf(slot.teacherId) !== teacherId && !isAdmin) {
      toast.error("You can only edit your own periods");
      return;
    }
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
      sessionType: (slot.sessionType as TimetableSlotInput["sessionType"]) ?? "THEORY",
      breakLabel: slot.breakLabel ?? "",
      remarks: slot.remarks ?? "",
      roomKind: slot.roomKind as TimetableSlotInput["roomKind"],
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

  const batchName =
    primaryOptions.find((b) => b._id === form.batchId)?.name ??
    nameOf(slots[0]?.batchId, "");

  const handlePrint = (printId: string) => {
    void printElementById(printId, "timetable-print");
  };

  const handlePdf = async (printId: string, title: string) => {
    try {
      await downloadPdfFromElementById(printId, `${title}.pdf`);
      toast.success("PDF downloaded");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const handleImage = async (printId: string, filename: string) => {
    try {
      const el = document.getElementById(printId);
      if (!el) {
        toast.error("Print view not ready");
        return;
      }
      // Temporary unhide for capture
      const prev = el.className;
      el.className = el.className.replace("hidden", "").replace("print:block", "");
      el.classList.add("block");
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      el.className = prev;
      const link = document.createElement("a");
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Image downloaded");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  if (timetableQuery.isLoading && isStudent) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isStudent || isTeacher ? "My Timetable" : "Timetable Management"}
        description={
          isStudent
            ? "Your weekly class schedule (Nepali college format)."
            : isTeacher
              ? "Your teaching periods and full year weekly matrices. Create/edit your own slots."
              : "Create periods as before; the weekly matrix updates automatically for print-ready display."
        }
      />

      {/* Legend + Saturday toggle */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Legend
          </span>
          {(Object.keys(SESSION_LABELS) as Array<keyof typeof SESSION_LABELS>).map(
            (key) => (
              <Badge
                key={key}
                className={`${SESSION_COLORS[key].badge} border ${SESSION_COLORS[key].border}`}
              >
                {SESSION_LABELS[key]}
              </Badge>
            ),
          )}
          <Badge className={`${SESSION_COLORS.HOLIDAY_ROW.badge} border`}>
            Saturday holiday
          </Badge>
          {!isStudent ? (
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={saturdayIsHoliday}
                onChange={(e) => setSaturdayIsHoliday(e.target.checked)}
              />
              Saturday is holiday
            </label>
          ) : null}
        </CardContent>
      </Card>

      {/* Scope + view mode */}
      {!isStudent ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters & view</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            <FormField label="View mode">
              <Select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
              >
                <option value="group">
                  {isCollege ? "By year (class timetable)" : "Class timetable"}
                </option>
                {isTeacher ? <option value="mine">My timetable only</option> : null}
                {isAdmin ? <option value="teacher">By teacher</option> : null}
                <option value="room">By classroom</option>
                <option value="lab">By laboratory</option>
              </Select>
            </FormField>
            {viewMode === "teacher" ? (
              <FormField label="Teacher">
                <Select
                  value={filterTeacherId}
                  onChange={(e) => setFilterTeacherId(e.target.value)}
                >
                  <option value="">All teachers</option>
                  {(teachersQuery.data ?? []).map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            {viewMode === "room" ? (
              <FormField label="Room">
                <Select
                  value={filterRoom}
                  onChange={(e) => setFilterRoom(e.target.value)}
                >
                  <option value="">All rooms</option>
                  {allRooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
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
              <FormField label="Session type">
                <Select
                  value={form.sessionType ?? "THEORY"}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      sessionType: e.target
                        .value as TimetableSlotInput["sessionType"],
                    }))
                  }
                >
                  {TIMETABLE_SESSION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SESSION_LABELS[t] ?? t}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isBreak ? (
                <FormField label="Break label">
                  <Select
                    value={form.breakLabel || ""}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, breakLabel: e.target.value }))
                    }
                  >
                    <option value="">Select break</option>
                    {TIMETABLE_BREAK_LABELS.map((b) => (
                      <option key={b} value={b === "Custom" ? "" : b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : (
                <FormField label="Subject">
                  <Select
                    value={form.subjectId ?? ""}
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
              )}
              {isAdmin && !isBreak ? (
                <FormField label="Teacher">
                  <Select
                    value={form.teacherId ?? ""}
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
              <FormField label="Room / Lab">
                <Input
                  value={form.room ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, room: e.target.value }))
                  }
                  placeholder="e.g. Room 204 or Computer Lab"
                />
              </FormField>
              <FormField label="Room kind">
                <Select
                  value={form.roomKind ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      roomKind: (e.target.value ||
                        undefined) as TimetableSlotInput["roomKind"],
                    }))
                  }
                >
                  <option value="">Auto / not set</option>
                  {TIMETABLE_ROOM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Remarks">
                <Input
                  value={form.remarks ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, remarks: e.target.value }))
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

      {/* Weekly matrices */}
      {timetableQuery.isLoading ? (
        <LoadingState />
      ) : isStudent ? (
        <StudentMatrix
          slots={slots}
          saturdayIsHoliday={saturdayIsHoliday}
          settings={settingsQuery.data}
          academicYearBs={form.academicYearBs}
          onPrint={handlePrint}
          onPdf={handlePdf}
          onImage={handleImage}
        />
      ) : isCollege && !form.batchId && viewMode === "group" ? (
        <EmptyState
          title="Select a batch"
          description="Choose a batch to view weekly timetables for each program year."
        />
      ) : !isCollege &&
        (!form.classId || !form.sectionId) &&
        viewMode === "group" ? (
        <EmptyState
          title={`Select ${labels.primary.toLowerCase()} and ${labels.secondary.toLowerCase()}`}
          description="Then view the weekly matrix."
        />
      ) : (
        <div className="space-y-6">
          {tables.map((table) => {
            const matrix = buildWeeklyMatrix(table.slots, { saturdayIsHoliday });
            const printId = `timetable-print-${table.key}`;
            const viewTitle =
              viewMode === "mine"
                ? "My teaching timetable"
                : viewMode === "teacher"
                  ? `Teacher: ${
                      (teachersQuery.data ?? []).find(
                        (t) => t._id === filterTeacherId,
                      )?.user.fullName ?? "All"
                    }`
                  : viewMode === "room"
                    ? `Room: ${filterRoom || "All"}`
                    : viewMode === "lab"
                      ? "Laboratory timetable"
                      : isCollege
                        ? `${batchName} · ${table.title}`
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
                        void handlePdf(printId, `timetable-${table.key}`)
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
                        void handleImage(printId, `timetable-${table.key}`)
                      }
                    >
                      <ImageIcon className="mr-1.5 h-4 w-4" />
                      Image
                    </Button>
                    {canWrite && viewMode === "group" ? (
                      <Button
                        size="sm"
                        className="no-print"
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
                    ) : null}
                    {isAdmin && table.slots.length > 0 && viewMode === "group" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="no-print text-rose-700 border-rose-200"
                        disabled={deleteYearMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete all ${table.slots.length} slots for ${table.title}?`,
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
                      onCellClick={canWrite ? startEdit : undefined}
                    />
                  )}
                  <TimetablePrintView
                    printId={printId}
                    matrix={matrix}
                    meta={{
                      collegeName:
                        settingsQuery.data?.schoolName ?? "College",
                      collegeNameNp: settingsQuery.data?.schoolNameNp,
                      principalName: settingsQuery.data?.principalName,
                      batchName: isCollege ? batchName : undefined,
                      yearName: isCollege ? table.title : undefined,
                      className: !isCollege
                        ? nameOf(
                            primaryOptions.find((c) => c._id === form.classId),
                            form.classId ?? "",
                          )
                        : undefined,
                      sectionName: !isCollege
                        ? nameOf(
                            filteredSections.find(
                              (s) => s._id === form.sectionId,
                            ),
                            form.sectionId ?? "",
                          )
                        : undefined,
                      academicYearBs: form.academicYearBs,
                      generatedAt: new Date().toLocaleDateString(),
                      viewTitle,
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

const StudentMatrix = ({
  slots,
  saturdayIsHoliday,
  settings,
  academicYearBs,
  onPrint,
  onPdf,
  onImage,
}: {
  slots: TimetableSlotRow[];
  saturdayIsHoliday: boolean;
  settings?: {
    schoolName?: string;
    schoolNameNp?: string;
    principalName?: string;
  };
  academicYearBs: string;
  onPrint: (id: string) => void;
  onPdf: (id: string, title: string) => Promise<void>;
  onImage: (id: string, filename: string) => Promise<void>;
}) => {
  const matrix = buildWeeklyMatrix(slots, { saturdayIsHoliday });
  const printId = "timetable-print-student";
  const yearName = nameOf(slots[0]?.yearId, "");
  const batchName = nameOf(slots[0]?.batchId, "");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>My weekly timetable</CardTitle>
          <p className="text-sm text-slate-600">
            Schedule for your enrolled year only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <Button size="sm" variant="outline" onClick={() => onPrint(printId)}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onPdf(printId, "my-timetable")}
          >
            <Download className="mr-1.5 h-4 w-4" />
            PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onImage(printId, "my-timetable")}
          >
            <ImageIcon className="mr-1.5 h-4 w-4" />
            Image
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {slots.length === 0 ? (
          <EmptyState
            title="No timetable yet"
            description="Your year timetable has not been published. Contact the college office."
          />
        ) : (
          <WeeklyTimetableGrid matrix={matrix} />
        )}
        <TimetablePrintView
          printId={printId}
          matrix={matrix}
          meta={{
            collegeName: settings?.schoolName ?? "College",
            collegeNameNp: settings?.schoolNameNp,
            principalName: settings?.principalName,
            batchName,
            yearName,
            academicYearBs,
            generatedAt: new Date().toLocaleDateString(),
            viewTitle: "Student weekly timetable",
          }}
        />
      </CardContent>
    </Card>
  );
};

