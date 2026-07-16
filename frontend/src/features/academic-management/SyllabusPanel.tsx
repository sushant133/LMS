import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicSyllabusInput,
  type AcademicSyllabusRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  type SyllabusSubUnitStatus,
  canManageInstitution,
} from "@phit-erp/shared";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliSubjectBanner } from "components/shared/NepaliSubjectBanner";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { isNepaliSubject, nepaliTextClass } from "lib/nepaliSubject";
import { cn, parseErrorMessage } from "lib/utils";
import {
  dedupeYearsForSelect,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filtersToParams,
  statusBadgeClass,
} from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicAttachmentUpload } from "./AcademicAttachmentUpload";
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
  dedupePlansByCurriculum,
  groupByTeacher,
  matchSessionPlanKeyword,
  recordsForCurriculumSubject,
  type HierarchyScopeOption,
  type HierarchySubjectNode,
} from "./academicHierarchyUtils";
import { SyllabusHierarchyEditor } from "./SyllabusHierarchyEditor";
import {
  allSubHeadingsFilled,
  blankSyllabusForm,
  formToPayload,
  recordToForm,
  SUB_UNIT_STATUS_OPTIONS,
  subUnitStatusBadgeClass,
  type ChapterDraft,
  type SyllabusFormState,
  type UnitDraft,
} from "./syllabusFormUtils";

interface SyllabusPanelProps {
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
  /** When false, hide create/edit/delete/submit actions (module read-only). */
  writeAccess?: boolean;
}

export const SyllabusPanel = ({
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
}: SyllabusPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const canMutate = writeAccess;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState<string | null>(
    null,
  );
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<HierarchySubjectNode | null>(null);
  const [form, setForm] = useState<SyllabusFormState>(() =>
    blankSyllabusForm(filters),
  );
  const [viewExpanded, setViewExpanded] = useState<Record<string, boolean>>({});
  const [globalExpand, setGlobalExpand] = useState(false);

  const yearOptions = useMemo(() => dedupeYearsForSelect(years), [years]);
  const subjectOptions = useMemo(() => {
    if (isCollege || yearOptions.length > 0) {
      return filterSubjectsByYear(subjects, years, form.yearId);
    }
    return filterSubjectsByClass(subjects, form.classId);
  }, [subjects, years, form.yearId, form.classId, isCollege, yearOptions.length]);

  const selectedFormSubject = useMemo(
    () => subjectOptions.find((s) => s._id === form.subjectId),
    [subjectOptions, form.subjectId],
  );
  const formNepaliText = isNepaliSubject(selectedFormSubject);

  const queryKey = ["academic-management", "syllabi", filters];
  const plansQuery = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<AcademicSyllabusRecord[]>(
        api.get("/academic-management/syllabi", {
          params: filtersToParams(filters),
        }),
      ),
  });

  const resetForm = () => {
    setEditingId(null);
    setForm(blankSyllabusForm(filters));
  };

  const openCreateSyllabusForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (plan: AcademicSyllabusRecord) => {
    if (!canMutate) {
      toast.error("You do not have write access to edit this syllabus");
      return;
    }
    if (
      !isAdmin &&
      plan.status !== "DRAFT" &&
      plan.status !== "REJECTED"
    ) {
      toast.error(
        plan.status === "APPROVED"
          ? "This syllabus is approved. Ask an administrator to Unlock it before editing structure."
          : "This syllabus is submitted. Ask an administrator to unlock or reject it before editing.",
      );
      return;
    }
    setEditingId(plan._id);
    setForm(recordToForm(plan));
    setShowForm(true);
    // Scroll to the editor so full hierarchy is visible for editing
    window.setTimeout(() => {
      document
        .getElementById("syllabus-edit-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const createMutation = useMutation({
    mutationFn: (payload: AcademicSyllabusInput) =>
      unwrap(api.post("/academic-management/syllabi", payload)),
    onSuccess: () => {
      toast.success("Syllabus saved as draft");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: AcademicSyllabusInput;
    }) => unwrap(api.put(`/academic-management/syllabi/${id}`, payload)),
    onSuccess: () => {
      toast.success("Syllabus updated");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const progressMutation = useMutation({
    mutationFn: ({
      syllabusId,
      subUnitId,
      status,
      teachingNotes,
      todaysCoverage,
    }: {
      syllabusId: string;
      subUnitId: string;
      status?: SyllabusSubUnitStatus;
      teachingNotes?: string;
      todaysCoverage?: string;
    }) =>
      unwrap(
        api.patch(
          `/academic-management/syllabi/${syllabusId}/sub-units/${subUnitId}/progress`,
          { status, teachingNotes, todaysCoverage },
        ),
      ),
    onSuccess: () => {
      toast.success("Progress updated");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const saveSyllabus = () => {
    if (!form.subjectId) {
      toast.error("Subject is required");
      return;
    }
    if (!form.chapters.length) {
      toast.error("Add at least one section with units");
      return;
    }
    for (const ch of form.chapters as ChapterDraft[]) {
      const kind = ch.sectionKind || "NONE";
      if ((kind === "CHAPTER" || kind === "PART") && !ch.title?.trim()) {
        toast.error(
          kind === "CHAPTER"
            ? "Chapter title is required when section type is Chapter"
            : "Part title is required when section type is Part",
        );
        return;
      }
      if (!ch.units?.length) {
        toast.error("Each section needs at least one unit");
        return;
      }
      for (const u of ch.units as UnitDraft[]) {
        if (!u.title?.trim()) {
          toast.error("Every unit needs a title");
          return;
        }
        if (!allSubHeadingsFilled(u.subUnits ?? [])) {
          toast.error(
            "Every sub-unit and child heading must be filled (or remove empty rows)",
          );
          return;
        }
      }
    }
    const optionalTeacher = (form.teacherId || teacherId || "").trim();
    const payload = formToPayload({
      ...form,
      teacherId: optionalTeacher,
    });
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/syllabi/${id}/submit`)),
    onSuccess: () => {
      toast.success("Syllabus submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks?: string }) =>
      unwrap(
        api.post(`/academic-management/syllabi/${id}/approve`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Syllabus approved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) =>
      unwrap(
        api.post(`/academic-management/syllabi/${id}/reject`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Syllabus rejected");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/syllabi/${id}/unlock`)),
    onSuccess: () => {
      toast.success("Syllabus unlocked");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academic-management/syllabi/${id}`)),
    onSuccess: () => {
      toast.success("Syllabus deleted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const allPlans = plansQuery.data ?? [];

  const keywordFilteredPlans = useMemo(
    () => allPlans.filter((plan) => matchSessionPlanKeyword(plan, filters.keyword ?? "")),
    [allPlans, filters.keyword],
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
        records: keywordFilteredPlans.map((plan) => ({
          subjectId: plan.subjectId,
          yearId: plan.yearId,
          classId: plan.classId,
          teacherId: plan.teacherId || "",
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
      keywordFilteredPlans,
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
    return selectedSubject
      ? {
          faculty: { key: selectedFacultyKey ?? "", label: selectedSubject.facultyLabel },
          year: { key: selectedYearKey ?? "", label: selectedSubject.yearLabel },
          subject: selectedSubject,
        }
      : null;
  }, [faculties, selectedSubject, selectedYearKey, selectedFacultyKey]);

  const selectedPlans = useMemo(() => {
    if (!selectedSubject) return [];
    const matched = recordsForCurriculumSubject(
      keywordFilteredPlans,
      selectedSubject.subjectIds,
      selectedYearKey,
      yearIdToLevelKey,
      isCollege,
    );
    // One syllabus per curriculum subject (not one per batch-provisioned subject id)
    return dedupePlansByCurriculum(matched, subjects, false);
  }, [
    keywordFilteredPlans,
    selectedSubject,
    selectedYearKey,
    yearIdToLevelKey,
    isCollege,
    subjects,
  ]);

  const teacherGroups = useMemo(
    () => groupByTeacher(selectedPlans),
    [selectedPlans],
  );

  const printPlans = useMemo(() => {
    if (selectedSubject && selectedPlans.length > 0) return selectedPlans;
    return keywordFilteredPlans;
  }, [selectedSubject, selectedPlans, keywordFilteredPlans]);

  const isExpanded = (key: string, defaultOpen = false) => {
    if (viewExpanded[key] !== undefined) return viewExpanded[key];
    return globalExpand || defaultOpen;
  };

  const toggleView = (key: string) => {
    setViewExpanded((prev) => ({ ...prev, [key]: !isExpanded(key) }));
  };

  const canEditStructure = (plan: AcademicSyllabusRecord) =>
    canMutate &&
    (isAdmin || plan.status === "DRAFT" || plan.status === "REJECTED");

  const canUpdateProgress = (plan: AcademicSyllabusRecord) =>
    canMutate &&
    (isAdmin ||
      plan.status === "APPROVED" ||
      plan.status === "SUBMITTED" ||
      plan.status === "PENDING_APPROVAL" ||
      plan.status === "DRAFT");

  const renderPlanCard = (plan: AcademicSyllabusRecord, compact = false) => {
    const chapters = plan.chapters ?? [];
    const totalSub = plan.totalSubUnits ?? 0;
    const completedSub = plan.completedSubUnits ?? 0;
    const editable = canEditStructure(plan);
    const planNepali = isNepaliSubject({
      name: plan.subject?.name,
      code: plan.subjectCode || plan.subject?.code,
    });

    return (
      <Card key={plan._id} className={compact ? "border-slate-200 shadow-none" : undefined}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">
              {plan.subject?.name}
              {plan.subjectCode || plan.subject?.code
                ? ` (${plan.subjectCode || plan.subject?.code})`
                : ""}{" "}
              · {plan.academicYearBs}
            </CardTitle>
            <p className="text-sm text-slate-600">
              Teacher:{" "}
              {plan.teacher?.user?.fullName ?? "Shared (by subject)"}
              {plan.totalTheoryHours || plan.totalPracticalHours || plan.creditHours
                ? ` · Theory ${plan.totalTheoryHours ?? 0}h · Practical ${plan.totalPracticalHours ?? 0}h · Credit ${plan.creditHours ?? 0}`
                : null}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {plan.totalChapters ?? chapters.length} chapters ·{" "}
              {plan.totalTopics ?? 0} units · {totalSub} sub-units · Completed:{" "}
              {completedSub} · Remaining: {plan.remainingSubUnits ?? totalSub - completedSub}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <Badge className={statusBadgeClass(plan.status)}>
              {plan.status.replace(/_/g, " ")}
            </Badge>
            {editable ? (
              <Button
                size="sm"
                onClick={() => openEditForm(plan)}
                title="Edit all sections, units, sub-units and nested children"
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit full syllabus
              </Button>
            ) : canMutate && isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  unlockMutation.mutate(plan._id, {
                    onSuccess: () => {
                      toast.success("Unlocked — opening editor");
                      // Open edit after unlock; list will refresh
                      void queryClient
                        .invalidateQueries({ queryKey: ["academic-management"] })
                        .then(() => {
                          openEditForm({ ...plan, status: "DRAFT" });
                        });
                    },
                  });
                }}
              >
                Unlock &amp; edit
              </Button>
            ) : canMutate ? (
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Unlock required from administrator to edit structure"
              >
                Locked
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AcademicProgressBar
            className="max-w-md"
            completedPercent={plan.completedPercent}
            remainingPercent={plan.remainingPercent}
          />
          <div className="flex flex-wrap items-center gap-2 no-print">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = !globalExpand;
                setGlobalExpand(next);
                const map: Record<string, boolean> = {};
                for (const ch of chapters) {
                  map[`${plan._id}-ch-${ch._id}`] = next;
                  for (const u of ch.units) {
                    map[`${plan._id}-u-${u._id}`] = next;
                  }
                }
                setViewExpanded((prev) => ({ ...prev, ...map }));
              }}
            >
              {globalExpand ? (
                <>
                  <ChevronsDownUp className="mr-1 h-4 w-4" />
                  Collapse tree
                </>
              ) : (
                <>
                  <ChevronsUpDown className="mr-1 h-4 w-4" />
                  Expand tree
                </>
              )}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 text-sm no-print">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Chapters</p>
              <p className="font-semibold">{plan.totalChapters ?? chapters.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Sub-units</p>
              <p className="font-semibold">{totalSub}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
              <p className="text-xs text-emerald-700">Completed</p>
              <p className="font-semibold text-emerald-900">{completedSub}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
              <p className="text-xs text-amber-700">Hours covered</p>
              <p className="font-semibold text-amber-900">
                {plan.teachingHoursCovered ?? 0}
                {plan.remainingTeachingHours != null
                  ? ` / rem. ${plan.remainingTeachingHours}`
                  : ""}
              </p>
            </div>
          </div>

          {chapters.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hierarchy yet. Edit to add chapters, units, and sub-units.
            </p>
          ) : (
            <div className="space-y-3">
              {chapters.map((chapter) => {
                const chKey = `${plan._id}-ch-${chapter._id}`;
                const chOpen = isExpanded(chKey, true);
                return (
                  <div
                    key={chapter._id}
                    className="rounded-2xl border border-slate-200 overflow-hidden"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100/80"
                      onClick={() => toggleView(chKey)}
                    >
                      {chOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-semibold text-slate-900",
                            planNepali && nepaliTextClass,
                          )}
                        >
                          {chapter.sectionKind === "PART"
                            ? `Part ${chapter.chapterNo}`
                            : chapter.sectionKind === "NONE" && !chapter.title
                              ? `Units`
                              : `Chapter ${chapter.chapterNo}`}
                          {chapter.title ? `: ${chapter.title}` : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {chapter.units.length} unit(s) · {chapter.totalSubUnits}{" "}
                          sub-unit(s) · {chapter.completedPercent}% complete
                          {chapter.tentativeCompletionMonth
                            ? ` · Expected: ${chapter.tentativeCompletionMonth}`
                            : ""}
                        </p>
                      </div>
                      <div className="hidden sm:block w-28">
                        <AcademicProgressBar
                          completedPercent={chapter.completedPercent}
                          remainingPercent={chapter.remainingPercent}
                        />
                      </div>
                    </button>
                    {chOpen ? (
                      <div className="space-y-2 border-t border-slate-100 p-3">
                        {chapter.description ? (
                          <p
                            className={cn(
                              "text-sm text-slate-600",
                              planNepali && nepaliTextClass,
                            )}
                          >
                            {chapter.description}
                          </p>
                        ) : null}
                        {chapter.units.map((unit) => {
                          const uKey = `${plan._id}-u-${unit._id}`;
                          const uOpen = isExpanded(uKey, false);
                          return (
                            <div
                              key={unit._id}
                              className="rounded-xl border border-slate-200 bg-white"
                            >
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                                onClick={() => toggleView(uKey)}
                              >
                                {uOpen ? (
                                  <ChevronDown className="h-4 w-4 text-slate-500" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-slate-500" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={cn(
                                      "text-sm font-medium text-slate-800",
                                      planNepali && nepaliTextClass,
                                    )}
                                  >
                                    Unit {unit.unitNo}: {unit.title}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {unit.totalSubUnits} sub-unit(s) ·{" "}
                                    {unit.completedPercent}%
                                  </p>
                                </div>
                              </button>
                              {uOpen ? (
                                <div className="space-y-2 border-t border-slate-100 p-3">
                                  {(function flattenView(
                                    nodes: typeof unit.subUnits,
                                  ): typeof unit.subUnits {
                                    const out: typeof unit.subUnits = [];
                                    const walk = (list: typeof unit.subUnits) => {
                                      for (const n of list) {
                                        out.push(n);
                                        if (n.children?.length) walk(n.children);
                                      }
                                    };
                                    walk(nodes);
                                    return out;
                                  })(unit.subUnits).map((sub) => (
                                    <div
                                      key={sub._id}
                                      className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2"
                                      style={{
                                        marginLeft: Math.min(sub.depth || 0, 6) * 12,
                                      }}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p
                                          className={cn(
                                            "min-w-0 text-sm font-medium text-slate-900",
                                            planNepali && nepaliTextClass,
                                          )}
                                        >
                                          <span className="mr-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-800">
                                            {sub.displayNo}
                                          </span>
                                          {sub.heading || "—"}
                                        </p>
                                        {canUpdateProgress(plan) ? (
                                          <Select
                                            className="h-8 w-[160px] shrink-0 text-xs no-print"
                                            value={sub.status}
                                            disabled={progressMutation.isPending}
                                            onChange={(e) => {
                                              progressMutation.mutate({
                                                syllabusId: plan._id,
                                                subUnitId: sub._id,
                                                status: e.target
                                                  .value as SyllabusSubUnitStatus,
                                              });
                                            }}
                                          >
                                            {SUB_UNIT_STATUS_OPTIONS.map((opt) => (
                                              <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                              </option>
                                            ))}
                                          </Select>
                                        ) : (
                                          <Badge
                                            className={subUnitStatusBadgeClass(sub.status)}
                                          >
                                            {sub.status.replace(/_/g, " ")}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {canMutate ? (
            <div className="flex flex-wrap gap-2 no-print">
              {editable ? (
                <Button size="sm" onClick={() => openEditForm(plan)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit units &amp; sub-units
                </Button>
              ) : isAdmin ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    unlockMutation.mutate(plan._id, {
                      onSuccess: () => {
                        openEditForm({ ...plan, status: "DRAFT" });
                      },
                    });
                  }}
                >
                  Unlock &amp; edit all
                </Button>
              ) : null}
              {plan.status === "DRAFT" || plan.status === "REJECTED" ? (
                <Button size="sm" onClick={() => submitMutation.mutate(plan._id)}>
                  <Send className="mr-2 h-4 w-4" />
                  Submit
                </Button>
              ) : null}
              {isAdmin &&
              (plan.status === "SUBMITTED" ||
                plan.status === "PENDING_APPROVAL") ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => approveMutation.mutate({ id: plan._id })}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const remarks = window.prompt("Rejection remarks");
                      if (remarks)
                        rejectMutation.mutate({ id: plan._id, remarks });
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
                  Unlock only
                </Button>
              ) : null}
              {(plan.status === "DRAFT" ||
                plan.status === "REJECTED" ||
                isAdmin) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteMutation.mutate(plan._id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          ) : null}
          {plan.attachmentUrl ? (
            <a
              href={plan.attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand-700 hover:underline no-print"
            >
              View attachment
            </a>
          ) : null}
          <div className="no-print">
            <AcademicCommentsPanel
              entityType="SYLLABUS"
              entityId={plan._id}
              canComment={isAdmin || plan.status !== "APPROVED"}
            />
          </div>
        </CardContent>
      </Card>
    );
  };

  if (plansQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Complete Syllabus
          </h2>
          <p className="text-sm text-slate-600">
            Hierarchical syllabus: Chapter → Unit → Sub Unit with progress tracking,
            auto-numbering, and integration-ready links for lesson plans, attendance,
            and homework.
          </p>
        </div>
        {canMutate ? (
          <Button
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                resetForm();
              } else {
                openCreateSyllabusForm();
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {showForm ? "Close Form" : "New Syllabus"}
          </Button>
        ) : null}
      </div>

      {showForm && canMutate ? (
        <Card id="syllabus-edit-form" className="no-print border-brand-200 shadow-md">
          <CardHeader>
            <CardTitle>
              {editingId
                ? "Edit Syllabus — sections, units, sub-units & children"
                : "Create Complete Syllabus"}
            </CardTitle>
            <p className="text-sm text-slate-600">
              {editingId
                ? "Change any Chapter/Part, Unit title, and every Sub-unit / Child heading. Numbers update automatically. Click Update Syllabus to save."
                : "Define subject metadata, then build units and nested sub-units. Save as draft anytime; submit when ready for review."}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              {yearOptions.length > 0 ? (
                <FormField label="Year">
                  <Select
                    value={form.yearId || ""}
                    onChange={(event) => {
                      const yearId = event.target.value;
                      setForm((current) => ({
                        ...current,
                        yearId,
                        subjectId: "",
                      }));
                    }}
                  >
                    <option value="">Select year first</option>
                    {yearOptions.map((year) => (
                      <option key={year._id} value={year._id}>
                        {year.name}
                        {year.level != null ? ` (Year ${year.level})` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : classes.length > 0 ? (
                <FormField label="Class">
                  <Select
                    value={form.classId || ""}
                    onChange={(event) => {
                      const classId = event.target.value;
                      setForm((current) => ({
                        ...current,
                        classId,
                        subjectId: "",
                      }));
                    }}
                  >
                    <option value="">Select class first</option>
                    {classes.map((klass) => (
                      <option key={klass._id} value={klass._id}>
                        {klass.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Subject">
                <Select
                  value={form.subjectId}
                  onChange={(event) => {
                    const subjectId = event.target.value;
                    const subject = subjectOptions.find((s) => s._id === subjectId);
                    setForm((current) => ({
                      ...current,
                      subjectId,
                      subjectCode: subject?.code || current.subjectCode || "",
                    }));
                  }}
                  disabled={
                    yearOptions.length > 0
                      ? !form.yearId
                      : classes.length > 0
                        ? !form.classId
                        : false
                  }
                >
                  <option value="">
                    {yearOptions.length > 0 && !form.yearId
                      ? "Select year first"
                      : classes.length > 0 && !form.classId
                        ? "Select class first"
                        : subjectOptions.length === 0
                          ? "No subjects for this year"
                          : "Select subject"}
                  </option>
                  {subjectOptions.map((subject) => (
                    <option key={subject._id} value={subject._id}>
                      {subject.name}
                      {subject.code ? ` (${subject.code})` : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
              {teachers.length > 0 ? (
                <FormField label="Teacher (optional)">
                  <Select
                    value={form.teacherId || ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teacherId: event.target.value,
                      }))
                    }
                  >
                    <option value="">No specific teacher — shared syllabus</option>
                    {teachers.map((teacher) => (
                      <option key={teacher._id} value={teacher._id}>
                        {teacher.user.fullName}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Academic Year (BS)">
                <Input
                  value={form.academicYearBs}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      academicYearBs: event.target.value,
                      session: event.target.value,
                    }))
                  }
                  placeholder="e.g. 2082/083"
                />
              </FormField>
              <FormField label="Faculty / Program">
                <Input
                  value={form.faculty ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      faculty: event.target.value,
                    }))
                  }
                  placeholder="e.g. Health Assistant / Nursing"
                />
              </FormField>
              <FormField label="Semester (optional)">
                <Input
                  value={form.semesterBs ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      semesterBs: event.target.value,
                    }))
                  }
                  placeholder="e.g. 1st / Odd"
                />
              </FormField>
              <FormField label="Subject Code">
                <Input
                  value={form.subjectCode ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subjectCode: event.target.value,
                    }))
                  }
                  placeholder="Auto from subject if empty"
                />
              </FormField>
              <FormField label="Total Theory Hours">
                <NumberInput
                  min={0}
                  value={form.totalTheoryHours ?? 0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      totalTheoryHours: event.target.valueAsNumber || 0,
                    }))
                  }
                />
              </FormField>
              <FormField label="Total Practical Hours">
                <NumberInput
                  min={0}
                  value={form.totalPracticalHours ?? 0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      totalPracticalHours: event.target.valueAsNumber || 0,
                    }))
                  }
                />
              </FormField>
              <FormField label="Credit Hours">
                <NumberInput
                  min={0}
                  value={form.creditHours ?? 0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      creditHours: event.target.valueAsNumber || 0,
                    }))
                  }
                />
              </FormField>
              <div className="md:col-span-3">
                <FormField label="Remarks">
                  <Textarea
                    value={form.remarks ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                    placeholder="Optional syllabus remarks"
                  />
                </FormField>
              </div>
            </div>

            {formNepaliText ? (
              <NepaliSubjectBanner
                subjectName={
                  selectedFormSubject
                    ? `${selectedFormSubject.name}${selectedFormSubject.code ? ` (${selectedFormSubject.code})` : ""}`
                    : undefined
                }
              />
            ) : null}

            <SyllabusHierarchyEditor
              key={editingId || "new-syllabus"}
              chapters={form.chapters}
              defaultExpandAll={Boolean(editingId)}
              nepaliText={formNepaliText}
              onChange={(chapters) =>
                setForm((current) => ({
                  ...current,
                  chapters:
                    typeof chapters === "function"
                      ? chapters(current.chapters)
                      : chapters,
                }))
              }
            />

            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) =>
                setForm((current) => ({ ...current, attachmentUrl: url }))
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={saveSyllabus}
                disabled={
                  !form.subjectId ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
              >
                {editingId ? "Update Syllabus" : "Save Complete Syllabus"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
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
              description="Choose Faculty → Year → Subject to view Syllabi. Curriculum is shared across student batches."
            />
          ) : selectedPlans.length === 0 ? (
            <EmptyState
              title={`No Syllabi for ${selectedSubjectMeta.subject.subjectName}`}
              description={
                isAdmin
                  ? "No syllabus created for this subject yet."
                  : "Create a Syllabus for this subject to start yearly planning."
              }
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
                    Assigned teacher(s):{" "}
                    {selectedSubjectMeta.subject.teacherNames.length > 0
                      ? selectedSubjectMeta.subject.teacherNames.join(", ")
                      : "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedPlans.length} Syllabus
                    {selectedPlans.length === 1 ? "" : "s"} · Hierarchical Chapter →
                    Unit → Sub Unit structure
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
                  {group.items.map((plan) => renderPlanCard(plan))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div id="syllabus-print-area" className="hidden print:block">
        <AcademicPrintHeader
          institutionName={institutionName}
          title="Syllabus Report"
          subtitle={
            selectedSubjectMeta
              ? `${selectedSubjectMeta.faculty.label} · ${selectedSubjectMeta.year.label} · ${selectedSubjectMeta.subject.subjectName}`
              : "Filtered Syllabi"
          }
        />
        {printPlans.map((plan) => (
          <div key={plan._id} className="mb-6 break-inside-avoid">
            <h3 className="font-semibold">
              {plan.subject?.name} ({plan.subjectCode || plan.subject?.code || "—"}) ·{" "}
              {plan.academicYearBs} · {plan.completedPercent}%
            </h3>
            {(plan.chapters ?? []).map((chapter) => (
              <div key={chapter._id} className="mt-2">
                <p className="font-medium">
                  {chapter.sectionKind === "PART"
                    ? `Part ${chapter.chapterNo}`
                    : chapter.sectionKind === "NONE" && !chapter.title
                      ? "Units"
                      : `Chapter ${chapter.chapterNo}`}
                  {chapter.title ? `: ${chapter.title}` : ""}
                </p>
                {chapter.units.map((unit) => (
                  <div key={unit._id} className="ml-3 mt-1">
                    <p>
                      Unit {unit.unitNo}: {unit.title}
                    </p>
                    <ul className="ml-4 list-disc text-sm">
                      {unit.subUnits.map((sub) => (
                        <li key={sub._id}>
                          {sub.displayNo} {sub.heading} — {sub.status} (
                          {sub.teachingHours}h)
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
