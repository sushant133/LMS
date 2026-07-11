import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanInput,
  type AcademicLessonPlanRecord,
  type AcademicSessionPlanRecord,
  type AcademicSessionPlanUnitRecord,
  type SessionPlanSyllabusCoverage,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import { Check, Plus, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import {
  filtersToParams,
  NEPALI_MONTHS,
  statusBadgeClass,
} from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";
import { AcademicProgressBar } from "./AcademicProgressBar";
import {
  AcademicPrintFooter,
  AcademicPrintHeader,
} from "./AcademicPrintHeader";
import { AcademicYearSubjectTree } from "./AcademicYearSubjectTree";
import {
  buildAcademicHierarchy,
  buildYearIdToLevelKeyMap,
  groupByTeacher,
  matchLessonPlanKeyword,
  recordsForCurriculumSubject,
  type HierarchyScopeOption,
  type HierarchySubjectNode,
} from "./academicHierarchyUtils";

interface LessonPlanPanelProps {
  filters: AcademicManagementFilters;
  subjects: Array<
    Pick<
      SubjectRecord,
      "_id" | "name" | "code" | "yearIds" | "classIds" | "isActive"
    > & { masterSubjectId?: string | null }
  >;
  teacherId?: string;
  teachers?: Array<{ _id: string; user: { fullName: string } }>;
  years?: HierarchyScopeOption[];
  classes?: HierarchyScopeOption[];
  assignments?: SubjectAssignmentRecord[];
  isCollege?: boolean;
  institutionName?: string;
  writeAccess?: boolean;
}

const emptyItem = (
  serialNo: number,
  unit?: AcademicSessionPlanUnitRecord,
): AcademicLessonPlanInput["items"][number] => ({
  serialNo,
  sessionPlanUnitId: unit?._id ?? "",
  subjectLabel: unit ? `Unit ${unit.unitNo}` : "",
  plannedTopic: unit
    ? unit.topicsCovered || unit.chapterName
    : "",
  description: "",
  learningObjectives: unit?.learningOutcomes ?? "",
  teachingMethod: "",
  teachingAids: "",
  assessmentMethod: "",
  deadline: "",
  estimatedClasses: Math.max(
    1,
    Math.round(unit?.estimatedTeachingHours || 1),
  ),
  remarks: "",
});

export const LessonPlanPanel = ({
  filters,
  subjects,
  teacherId,
  teachers = [],
  years = [],
  classes = [],
  assignments = [],
  isCollege = false,
  institutionName = "Institution",
  writeAccess = true,
}: LessonPlanPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const canMutate = writeAccess;
  const [showForm, setShowForm] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState<string | null>(
    null,
  );
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<HierarchySubjectNode | null>(null);
  const [form, setForm] = useState<AcademicLessonPlanInput>({
    academicYearBs: filters.academicYearBs || "2082/083",
    session: filters.session || filters.academicYearBs || "2082/083",
    faculty: filters.faculty || "",
    semesterBs: filters.semesterBs || "",
    classId: filters.classId,
    sectionId: filters.sectionId,
    batchId: filters.batchId,
    yearId: filters.yearId,
    subjectId: filters.subjectId || "",
    teacherId: teacherId || filters.teacherId || "",
    month: filters.month || NEPALI_MONTHS[0] || "Baisakh",
    sessionPlanId: "",
    monthlyDescription: "",
    items: [],
  });

  // Keep teacherId once teacher scope resolves
  useEffect(() => {
    if (!teacherId) return;
    setForm((current) =>
      current.teacherId === teacherId
        ? current
        : { ...current, teacherId },
    );
  }, [teacherId]);

  const effectiveTeacherId = teacherId || form.teacherId || filters.teacherId || "";

  const sessionPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "session-plans-for-lesson",
      form.subjectId,
      effectiveTeacherId,
      form.academicYearBs,
    ],
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: {
            ...filtersToParams(filters),
            subjectId: form.subjectId || filters.subjectId,
            teacherId: effectiveTeacherId || filters.teacherId,
            academicYearBs: form.academicYearBs || filters.academicYearBs,
            // Load all statuses; teachers may use draft/submitted plans
          },
        }),
      ),
    enabled: showForm && Boolean(form.subjectId),
  });

  /** Draft, submitted, pending, or approved — not rejected */
  const usableSessionPlans = useMemo(
    () =>
      (sessionPlansQuery.data ?? []).filter(
        (plan) => plan.status !== "REJECTED",
      ),
    [sessionPlansQuery.data],
  );

  // Auto-select the only usable Session Plan when subject/teacher/year change
  useEffect(() => {
    if (!showForm) return;
    if (
      usableSessionPlans.length === 1 &&
      form.sessionPlanId !== usableSessionPlans[0]!._id
    ) {
      const plan = usableSessionPlans[0]!;
      setForm((current) => ({
        ...current,
        sessionPlanId: plan._id,
        academicYearBs: plan.academicYearBs || current.academicYearBs,
        session: plan.session || current.session,
        faculty: plan.faculty || current.faculty,
        semesterBs: plan.semesterBs || current.semesterBs,
        classId: plan.classId || current.classId,
        sectionId: plan.sectionId || current.sectionId,
        batchId: plan.batchId || current.batchId,
        yearId: plan.yearId || current.yearId,
        subjectId: plan.subjectId || current.subjectId,
        teacherId: plan.teacherId || current.teacherId || teacherId || "",
      }));
      setSelectedUnitIds([]);
    }
  }, [usableSessionPlans, form.sessionPlanId, showForm, teacherId]);

  const coverageQuery = useQuery({
    queryKey: [
      "academic-management",
      "syllabus-coverage",
      form.sessionPlanId,
    ],
    queryFn: () =>
      unwrap<SessionPlanSyllabusCoverage>(
        api.get("/academic-management/syllabus-coverage", {
          params: { sessionPlanId: form.sessionPlanId },
        }),
      ),
    enabled: Boolean(form.sessionPlanId) && showForm,
  });

  const unitsQuery = useQuery({
    queryKey: [
      "academic-management",
      "session-plan-units",
      form.sessionPlanId,
    ],
    queryFn: () =>
      unwrap<AcademicSessionPlanUnitRecord[]>(
        api.get("/academic-management/session-plan-units", {
          params: { sessionPlanId: form.sessionPlanId },
        }),
      ),
    enabled: Boolean(form.sessionPlanId) && showForm,
  });

  const plansQuery = useQuery({
    queryKey: ["academic-management", "lesson-plans", filters],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: filtersToParams(filters),
        }),
      ),
  });

  // Rebuild form items when selected units change
  useEffect(() => {
    if (!form.sessionPlanId) return;
    const units = unitsQuery.data ?? coverageQuery.data?.units ?? [];
    const unitMap = new Map(units.map((unit) => [unit._id, unit]));
    setForm((current) => {
      const nextItems = selectedUnitIds
        .map((unitId, index) => {
          const unit = unitMap.get(unitId);
          if (!unit) return null;
          const prev = current.items.find(
            (item) => item.sessionPlanUnitId === unitId,
          );
          return {
            ...emptyItem(index + 1, unit),
            ...prev,
            serialNo: index + 1,
            sessionPlanUnitId: unit._id,
            subjectLabel: `Unit ${unit.unitNo}`,
            plannedTopic:
              prev?.plannedTopic || unit.topicsCovered || unit.chapterName,
            learningObjectives:
              prev?.learningObjectives || unit.learningOutcomes || "",
            estimatedClasses:
              prev?.estimatedClasses ||
              Math.max(1, Math.round(unit.estimatedTeachingHours || 1)),
          };
        })
        .filter(Boolean) as AcademicLessonPlanInput["items"];
      return { ...current, items: nextItems };
    });
  }, [selectedUnitIds, unitsQuery.data, coverageQuery.data?.units, form.sessionPlanId]);

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLessonPlanInput) =>
      unwrap(api.post("/academic-management/lesson-plans", payload)),
    onSuccess: () => {
      toast.success("Lesson plan saved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      setSelectedUnitIds([]);
      setUnitSearch("");
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/submit`)),
    onSuccess: () => {
      toast.success("Lesson plan submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/approve`, {})),
    onSuccess: () => {
      toast.success("Lesson plan approved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/unlock`)),
    onSuccess: () => {
      toast.success("Lesson plan unlocked");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) =>
      unwrap(
        api.post(`/academic-management/lesson-plans/${id}/reject`, { remarks }),
      ),
    onSuccess: () => {
      toast.success("Lesson plan rejected");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const filteredPlans = useMemo(
    () =>
      (plansQuery.data ?? []).filter((plan) =>
        matchLessonPlanKeyword(plan, filters.keyword ?? ""),
      ),
    [filters.keyword, plansQuery.data],
  );

  const faculties = useMemo(
    () =>
      buildAcademicHierarchy({
        isCollege,
        years,
        classes,
        subjects,
        assignments,
        teachers,
        filterYearId: filters.yearId,
        filterClassId: filters.classId,
        filterSubjectId: filters.subjectId,
        filterTeacherId: filters.teacherId || teacherId,
        filterFaculty: filters.faculty,
        keyword: filters.keyword,
        records: filteredPlans.map((plan) => ({
          subjectId: plan.subjectId,
          yearId: plan.yearId,
          classId: plan.classId,
          teacherId: plan.teacherId,
          faculty: plan.faculty,
          subjectName: plan.subject?.name,
          teacherName: plan.teacher?.user?.fullName,
        })),
      }),
    [
      isCollege,
      years,
      classes,
      subjects,
      assignments,
      teachers,
      filters.yearId,
      filters.classId,
      filters.subjectId,
      filters.teacherId,
      filters.faculty,
      filters.keyword,
      teacherId,
      filteredPlans,
    ],
  );

  const yearIdToLevelKey = useMemo(
    () => buildYearIdToLevelKeyMap(years),
    [years],
  );

  useEffect(() => {
    if (
      selectedSubject &&
      faculties.some((f) =>
        f.years.some((y) =>
          y.subjects.some(
            (s) =>
              s.subjectKey === selectedSubject.subjectKey &&
              s.yearKey === selectedYearKey &&
              f.key === selectedFacultyKey,
          ),
        ),
      )
    ) {
      return;
    }
    const firstFaculty = faculties[0];
    const firstYear = firstFaculty?.years[0];
    const firstSubject = firstYear?.subjects[0];
    if (firstFaculty && firstYear && firstSubject) {
      setSelectedFacultyKey(firstFaculty.key);
      setSelectedYearKey(firstYear.key);
      setSelectedSubject(firstSubject);
    } else {
      setSelectedFacultyKey(null);
      setSelectedYearKey(null);
      setSelectedSubject(null);
    }
  }, [faculties]);

  const selectedSubjectMeta = useMemo(() => {
    if (!selectedSubject) return null;
    for (const faculty of faculties) {
      for (const year of faculty.years) {
        const subject = year.subjects.find(
          (s) =>
            s.subjectKey === selectedSubject.subjectKey &&
            s.yearKey === selectedYearKey &&
            faculty.key === selectedFacultyKey,
        );
        if (subject) return { faculty, year, subject };
      }
    }
    return {
      faculty: {
        key: selectedFacultyKey ?? "",
        label: selectedSubject.facultyLabel,
      },
      year: {
        key: selectedYearKey ?? "",
        label: selectedSubject.yearLabel,
      },
      subject: selectedSubject,
    };
  }, [faculties, selectedSubject, selectedYearKey, selectedFacultyKey]);

  const selectedPlans = useMemo(() => {
    if (!selectedSubject) return [];
    return recordsForCurriculumSubject(
      filteredPlans,
      selectedSubject.subjectIds,
      selectedYearKey,
      yearIdToLevelKey,
      isCollege,
    );
  }, [
    filteredPlans,
    selectedSubject,
    selectedYearKey,
    yearIdToLevelKey,
    isCollege,
  ]);

  const teacherGroups = useMemo(
    () => groupByTeacher(selectedPlans),
    [selectedPlans],
  );

  const printPlans = useMemo(() => {
    if (selectedSubject && selectedPlans.length > 0) return selectedPlans;
    return filteredPlans;
  }, [selectedSubject, selectedPlans, filteredPlans]);

  const units = unitsQuery.data ?? coverageQuery.data?.units ?? [];
  const filteredUnits = useMemo(() => {
    const q = unitSearch.toLowerCase().trim();
    if (!q) return units;
    return units.filter(
      (unit) =>
        String(unit.unitNo).includes(q) ||
        unit.chapterName.toLowerCase().includes(q) ||
        (unit.topicsCovered || "").toLowerCase().includes(q),
    );
  }, [unitSearch, units]);

  const coverage = coverageQuery.data;
  const plannedThisMonth = useMemo(
    () =>
      units.filter((unit) =>
        (unit.plannedInMonths ?? []).includes(form.month),
      ),
    [units, form.month],
  );

  const toggleUnit = (unitId: string) => {
    const unit = units.find((row) => row._id === unitId);
    // Block re-selecting a unit already planned this month (unless unselecting)
    if (
      unit &&
      (unit.plannedInMonths ?? []).includes(form.month) &&
      !selectedUnitIds.includes(unitId)
    ) {
      toast.error(
        `Unit ${unit.unitNo} is already planned for ${form.month}.`,
      );
      return;
    }
    setSelectedUnitIds((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId],
    );
  };

  const updateItemField = <K extends keyof AcademicLessonPlanInput["items"][number]>(
    index: number,
    key: K,
    value: AcademicLessonPlanInput["items"][number][K],
  ) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  };

  if (plansQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Lesson Plan</h2>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? "Centralized monthly plans for all teachers, organized by year and subject."
              : "Monthly planning from your Session Plan (draft or approved). Select units/topics, set deadlines, and save."}
          </p>
        </div>
        {canMutate ? (
          <Button onClick={() => setShowForm((current) => !current)}>
            <Plus className="mr-2 h-4 w-4" />
            New Lesson Plan
          </Button>
        ) : null}
      </div>

      {showForm && canMutate ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>Create Lesson Plan</CardTitle>
            <p className="text-sm text-slate-600">
              Select Academic Year, Subject, Month — your Session Plan (draft or
              approved) loads automatically. Pick units/topics and save the monthly plan.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <FormField label="Academic Year (BS)">
                <Input
                  value={form.academicYearBs}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      academicYearBs: event.target.value,
                      session: event.target.value,
                      sessionPlanId: "",
                    }))
                  }
                  placeholder="e.g. 2082/083"
                />
              </FormField>
              <FormField label="Subject">
                <Select
                  value={form.subjectId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subjectId: event.target.value,
                      sessionPlanId: "",
                    }))
                  }
                >
                  <option value="">Select subject</option>
                  {subjects.map((subject) => (
                    <option key={subject._id} value={subject._id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isAdmin && teachers.length > 0 ? (
                <FormField label="Teacher">
                  <Select
                    value={form.teacherId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teacherId: event.target.value,
                        sessionPlanId: "",
                      }))
                    }
                  >
                    <option value="">Teacher</option>
                    {teachers.map((teacher) => (
                      <option key={teacher._id} value={teacher._id}>
                        {teacher.user.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Month">
                <Select
                  value={form.month}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      month: event.target.value,
                    }))
                  }
                >
                  {NEPALI_MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Faculty (optional)">
                <Input
                  value={form.faculty ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      faculty: event.target.value,
                    }))
                  }
                  placeholder="Faculty / Program"
                />
              </FormField>
              <FormField label="Session Plan">
                <Select
                  value={form.sessionPlanId}
                  onChange={(event) => {
                    const plan = usableSessionPlans.find(
                      (row) => row._id === event.target.value,
                    );
                    setSelectedUnitIds([]);
                    setForm((current) => ({
                      ...current,
                      sessionPlanId: event.target.value,
                      academicYearBs:
                        plan?.academicYearBs || current.academicYearBs,
                      session: plan?.session || current.session,
                      faculty: plan?.faculty || current.faculty,
                      subjectId: plan?.subjectId || current.subjectId,
                      teacherId:
                        plan?.teacherId || current.teacherId || teacherId || "",
                    }));
                  }}
                >
                  <option value="">
                    {sessionPlansQuery.isLoading
                      ? "Loading session plans…"
                      : usableSessionPlans.length === 0
                        ? "No Session Plan — create one under Session Plan first"
                        : "Select Session Plan"}
                  </option>
                  {usableSessionPlans.map((plan) => (
                    <option key={plan._id} value={plan._id}>
                      {plan.subject?.name} · {plan.academicYearBs} ·{" "}
                      {plan.status} ({plan.units.length} units)
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            {form.sessionPlanId && coverage ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-900">
                    Yearly syllabus progress
                  </p>
                  <span className="text-xs text-slate-600">
                    {coverage.completedUnits}/{coverage.totalUnits} units
                    completed · {coverage.remainingUnits} unplanned
                  </span>
                </div>
                <AcademicProgressBar
                  completedPercent={coverage.completedPercent}
                  remainingPercent={coverage.remainingPercent}
                />
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-xl bg-white/80 p-2 border border-emerald-100">
                    <p className="font-medium text-emerald-800">
                      Planned ({coverage.plannedUnits})
                    </p>
                    <p className="text-slate-600 mt-1 line-clamp-3">
                      {coverage.planned.length
                        ? coverage.planned
                            .map((u) => `U${u.unitNo}`)
                            .join(", ")
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 p-2 border border-amber-100">
                    <p className="font-medium text-amber-800">
                      Remaining ({coverage.remainingUnits})
                    </p>
                    <p className="text-slate-600 mt-1 line-clamp-3">
                      {coverage.remaining.length
                        ? coverage.remaining
                            .map((u) => `U${u.unitNo}`)
                            .join(", ")
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 p-2 border border-slate-100">
                    <p className="font-medium text-slate-800">
                      Already in {form.month} ({plannedThisMonth.length})
                    </p>
                    <p className="text-slate-600 mt-1 line-clamp-3">
                      {plannedThisMonth.length
                        ? plannedThisMonth
                            .map((u) => `U${u.unitNo}`)
                            .join(", ")
                        : "None yet"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {form.sessionPlanId ? (
              <div className="space-y-3">
                <FormField label="Select units / topics from Session Plan">
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      value={unitSearch}
                      onChange={(event) => setUnitSearch(event.target.value)}
                      placeholder="Search by unit number, title, or topics…"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y">
                    {filteredUnits.length === 0 ? (
                      <p className="p-3 text-sm text-slate-500">
                        No units found. Ensure the Session Plan has units.
                      </p>
                    ) : (
                      filteredUnits.map((unit) => {
                        const selected = selectedUnitIds.includes(unit._id);
                        const alreadyThisMonth = (
                          unit.plannedInMonths ?? []
                        ).includes(form.month);
                        return (
                          <button
                            key={unit._id}
                            type="button"
                            onClick={() => toggleUnit(unit._id)}
                            className={`flex w-full items-start gap-3 p-3 text-left text-sm transition hover:bg-slate-50 ${
                              selected ? "bg-brand-50" : ""
                            } ${alreadyThisMonth && !selected ? "opacity-60" : ""}`}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                selected
                                  ? "border-brand-600 bg-brand-600 text-white"
                                  : "border-slate-300"
                              }`}
                            >
                              {selected ? (
                                <Check className="h-3 w-3" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-slate-900">
                                Unit {unit.unitNo}: {unit.chapterName}
                              </span>
                              {unit.topicsCovered ? (
                                <span className="mt-0.5 block text-xs text-slate-600 line-clamp-2">
                                  {unit.topicsCovered}
                                </span>
                              ) : null}
                              <span className="mt-1 flex flex-wrap gap-1">
                                {unit.planningStatus ? (
                                  <Badge
                                    className={statusBadgeClass(
                                      unit.planningStatus === "UNPLANNED"
                                        ? "PENDING"
                                        : unit.planningStatus,
                                    )}
                                  >
                                    {unit.planningStatus}
                                  </Badge>
                                ) : null}
                                {alreadyThisMonth ? (
                                  <Badge className="bg-slate-200 text-slate-700">
                                    In {form.month}
                                  </Badge>
                                ) : null}
                                {(unit.plannedInMonths ?? [])
                                  .filter((m) => m !== form.month)
                                  .map((m) => (
                                    <Badge
                                      key={m}
                                      className="bg-slate-100 text-slate-600"
                                    >
                                      {m}
                                    </Badge>
                                  ))}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </FormField>

                <FormField label="Monthly description">
                  <Textarea
                    value={form.monthlyDescription ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthlyDescription: event.target.value,
                      }))
                    }
                    placeholder="Brief monthly teaching focus / description"
                  />
                </FormField>

                {form.items.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-slate-800">
                      Complete lesson details for {form.month} (
                      {form.items.length} unit
                      {form.items.length === 1 ? "" : "s"})
                    </p>
                    {form.items.map((item, index) => {
                      const unit = units.find(
                        (u) => u._id === item.sessionPlanUnitId,
                      );
                      return (
                        <div
                          key={item.sessionPlanUnitId || index}
                          className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-2"
                        >
                          <div className="md:col-span-2 rounded-xl bg-slate-50 p-3 text-sm">
                            <p className="font-medium text-slate-900">
                              {item.subjectLabel ||
                                (unit
                                  ? `Unit ${unit.unitNo}`
                                  : `Item ${index + 1}`)}
                              : {unit?.chapterName || item.plannedTopic}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              From Session Plan:{" "}
                              {unit?.topicsCovered || item.plannedTopic || "—"}
                            </p>
                          </div>
                          <FormField label="Planned topic">
                            <Input
                              value={item.plannedTopic}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "plannedTopic",
                                  event.target.value,
                                )
                              }
                              placeholder="Topic for this month"
                            />
                          </FormField>
                          <FormField label="Estimated classes">
                            <NumberInput
                              min={1}
                              value={item.estimatedClasses}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "estimatedClasses",
                                  event.target.valueAsNumber,
                                )
                              }
                            />
                          </FormField>
                          <FormField label="Learning objectives">
                            <Textarea
                              value={item.learningObjectives}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "learningObjectives",
                                  event.target.value,
                                )
                              }
                              placeholder="Objectives for this lesson block"
                            />
                          </FormField>
                          <FormField label="Description">
                            <Textarea
                              value={item.description}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "description",
                                  event.target.value,
                                )
                              }
                              placeholder="Lesson description / content outline"
                            />
                          </FormField>
                          <FormField label="Teaching method">
                            <Input
                              value={item.teachingMethod}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "teachingMethod",
                                  event.target.value,
                                )
                              }
                              placeholder="Lecture, demo, group work…"
                            />
                          </FormField>
                          <FormField label="Teaching aids">
                            <Input
                              value={item.teachingAids}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "teachingAids",
                                  event.target.value,
                                )
                              }
                              placeholder="PPT, charts, lab equipment…"
                            />
                          </FormField>
                          <FormField label="Assessment method">
                            <Input
                              value={item.assessmentMethod}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "assessmentMethod",
                                  event.target.value,
                                )
                              }
                              placeholder="Quiz, viva, assignment…"
                            />
                          </FormField>
                          <FormField label="Deadline (BS)">
                            <NepaliDateField
                              value={item.deadline}
                              onChange={(value) =>
                                updateItemField(index, "deadline", value)
                              }
                              placeholder="Select deadline"
                            />
                          </FormField>
                          <div className="md:col-span-2">
                            <FormField label="Remarks">
                              <Textarea
                                value={item.remarks}
                                onChange={(event) =>
                                  updateItemField(
                                    index,
                                    "remarks",
                                    event.target.value,
                                  )
                                }
                                placeholder="Optional remarks for this unit"
                              />
                            </FormField>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-amber-700">
                    Select one or more units from the Session Plan above.
                  </p>
                )}
              </div>
            ) : form.subjectId ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {sessionPlansQuery.isLoading
                  ? "Looking for your Session Plan…"
                  : "No Session Plan found for this subject. Create a complete yearly Session Plan first (draft is enough), then return here to build monthly Lesson Plans."}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  const resolvedTeacherId = teacherId || form.teacherId;
                  if (!form.sessionPlanId || form.items.length === 0) {
                    toast.error(
                      "Select a Session Plan and at least one unit before saving",
                    );
                    return;
                  }
                  if (!resolvedTeacherId) {
                    toast.error("Teacher profile is required to save a lesson plan");
                    return;
                  }
                  createMutation.mutate({
                    ...form,
                    teacherId: resolvedTeacherId,
                    session: form.session || form.academicYearBs,
                  });
                }}
                disabled={
                  !form.sessionPlanId ||
                  form.items.length === 0 ||
                  !form.subjectId ||
                  !(teacherId || form.teacherId) ||
                  createMutation.isPending
                }
              >
                Save Lesson Plan
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setSelectedUnitIds([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="no-print">
          <AcademicYearSubjectTree
            faculties={faculties}
            selectedFacultyKey={selectedFacultyKey}
            selectedYearKey={selectedYearKey}
            selectedSubjectKey={selectedSubject?.subjectKey}
            onSelectSubject={(facultyKey, yearKey, subject) => {
              setSelectedFacultyKey(facultyKey);
              setSelectedYearKey(yearKey);
              setSelectedSubject(subject);
            }}
            emptyMessage={
              isAdmin
                ? "No subjects found. Check Subject Master, Subject Assignment, or filters."
                : "No subjects assigned to you for the current filters."
            }
          />
        </div>

        <div className="space-y-4 min-w-0">
          {!selectedSubjectMeta ? (
            <EmptyState
              title="Select a subject"
              description="Choose Faculty → Year → Subject. Curriculum is shared across student batches."
            />
          ) : selectedPlans.length === 0 ? (
            <EmptyState
              title={`No Lesson Plans for ${selectedSubjectMeta.subject.subjectName}`}
              description="Create a monthly Lesson Plan by selecting units from your Session Plan (draft or approved)."
            />
          ) : (
            <>
              <Card className="no-print border-brand-100 bg-brand-50/30">
                <CardContent className="pt-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                    {selectedSubjectMeta.faculty.label
                      ? `${selectedSubjectMeta.faculty.label} · `
                      : ""}
                    {selectedSubjectMeta.year.label}
                  </p>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {selectedSubjectMeta.subject.subjectName}
                  </h3>
                  <p className="text-sm text-slate-600">
                    Teacher(s):{" "}
                    {selectedSubjectMeta.subject.teacherNames.join(", ") || "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    One curriculum subject · Teachers grouped below (not by
                    batch)
                  </p>
                </CardContent>
              </Card>

              {teacherGroups.map((group) => (
                <div key={group.teacherId} className="space-y-3">
                  {teacherGroups.length > 1 ? (
                    <div className="flex items-center gap-2 no-print">
                      <div className="h-px flex-1 bg-slate-200" />
                      <p className="text-sm font-semibold text-slate-800">
                        Teacher: {group.teacherName}
                      </p>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                  ) : null}
                  {group.items.map((plan) => (
                    <Card key={plan._id}>
                      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle>
                            {plan.month} · {plan.academicYearBs}
                          </CardTitle>
                          <p className="text-sm text-slate-600">
                            {plan.teacher?.user?.fullName} · Planned:{" "}
                            {plan.plannedTopics ?? plan.items.length} ·
                            Completed: {plan.completedTopics ?? 0} · Pending:{" "}
                            {plan.pendingTopics ?? plan.pendingUnits}
                          </p>
                          {plan.monthlyDescription ? (
                            <p className="mt-1 text-sm text-slate-600">
                              {plan.monthlyDescription}
                            </p>
                          ) : null}
                          <AcademicProgressBar
                            className="mt-2 max-w-md"
                            completedPercent={plan.completedPercent}
                            remainingPercent={plan.remainingPercent}
                          />
                        </div>
                        <Badge className={statusBadgeClass(plan.status)}>
                          {plan.status}
                        </Badge>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHead>
                              <tr>
                                <Th>SN</Th>
                                <Th>Unit</Th>
                                <Th>Topic</Th>
                                <Th>Deadline</Th>
                                <Th>Classes</Th>
                                <Th>Progress</Th>
                                <Th>Status</Th>
                              </tr>
                            </TableHead>
                            <TableBody>
                              {plan.items.map((item) => {
                                const remaining =
                                  item.remainingPercent ??
                                  Math.max(0, 100 - item.completedPercent);
                                return (
                                  <tr key={item._id}>
                                    <Td>{item.serialNo}</Td>
                                    <Td>
                                      {item.unit
                                        ? `U${item.unit.unitNo}: ${item.unit.chapterName}`
                                        : item.subjectLabel || "—"}
                                    </Td>
                                    <Td>{item.plannedTopic}</Td>
                                    <Td className="whitespace-nowrap text-xs">
                                      {item.deadline || "—"}
                                    </Td>
                                    <Td>
                                      {item.completedClasses}/
                                      {item.estimatedClasses}
                                    </Td>
                                    <Td className="min-w-[120px]">
                                      <AcademicProgressBar
                                        completedPercent={item.completedPercent}
                                        remainingPercent={remaining}
                                        compact
                                      />
                                    </Td>
                                    <Td>
                                      <Badge
                                        className={statusBadgeClass(
                                          item.completionStatus,
                                        )}
                                      >
                                        {item.completionStatus}
                                      </Badge>
                                    </Td>
                                  </tr>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        {canMutate ? (
                          <div className="flex flex-wrap gap-2 no-print">
                            {plan.status === "DRAFT" ||
                            plan.status === "REJECTED" ? (
                              <Button
                                size="sm"
                                onClick={() => submitMutation.mutate(plan._id)}
                              >
                                <Send className="mr-2 h-4 w-4" />
                                Submit
                              </Button>
                            ) : null}
                            {isAdmin && plan.status === "PENDING_APPROVAL" ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    approveMutation.mutate(plan._id)
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const remarks =
                                      window.prompt("Rejection remarks");
                                    if (remarks)
                                      rejectMutation.mutate({
                                        id: plan._id,
                                        remarks,
                                      });
                                  }}
                                >
                                  Reject
                                </Button>
                              </>
                            ) : null}
                            {isAdmin && plan.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => unlockMutation.mutate(plan._id)}
                              >
                                Unlock
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="no-print">
                          <AcademicCommentsPanel
                            entityType="LESSON_PLAN"
                            entityId={plan._id}
                            canComment={
                              isAdmin || plan.status !== "APPROVED"
                            }
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div id="lesson-plan-print-area" className="hidden print:block">
        <AcademicPrintHeader
          institutionName={institutionName}
          title="Lesson Plan Report"
          subtitle={
            selectedSubjectMeta
              ? `${selectedSubjectMeta.faculty.label} · ${selectedSubjectMeta.year.label} · ${selectedSubjectMeta.subject.subjectName}`
              : "Filtered Lesson Plans"
          }
          academicYearBs={filters.academicYearBs}
          generatedAt={new Date().toLocaleString()}
        />
        {groupByTeacher(printPlans).map((group) => (
          <div key={group.teacherId} className="mb-8">
            <h3 className="mb-2 font-bold">Teacher: {group.teacherName}</h3>
            {group.items.map((plan) => (
              <div key={plan._id} className="mb-6">
                <p className="font-semibold">
                  {plan.subject?.name} · {plan.month} · {plan.status} ·{" "}
                  {plan.completedPercent}% complete
                </p>
                {plan.monthlyDescription ? (
                  <p className="text-sm mb-1">{plan.monthlyDescription}</p>
                ) : null}
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border p-1 text-left">Topic</th>
                      <th className="border p-1 text-left">Deadline</th>
                      <th className="border p-1 text-left">Classes</th>
                      <th className="border p-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((item) => (
                      <tr key={item._id}>
                        <td className="border p-1">{item.plannedTopic}</td>
                        <td className="border p-1">{item.deadline || "—"}</td>
                        <td className="border p-1">
                          {item.completedClasses}/{item.estimatedClasses}
                        </td>
                        <td className="border p-1">{item.completionStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
