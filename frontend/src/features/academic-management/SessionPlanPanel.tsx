import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicSessionPlanInput,
  type AcademicSessionPlanRecord,
  type AcademicSyllabusRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import { BookOpen, Download, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
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
import { NepaliSubjectBanner } from "components/shared/NepaliSubjectBanner";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { isNepaliSubject } from "lib/nepaliSubject";
import { parseErrorMessage } from "lib/utils";
import {
  academicListApiParams,
  dedupeYearsForSelect,
  ensureSubjectInOptions,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filtersToParams,
  mapSyllabusHierarchyToSessionUnits,
  NEPALI_MONTHS,
  resolveSubjectSelectValue,
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

interface SessionPlanPanelProps {
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

const emptyUnit = (unitNo = 1) => ({
  unitNo,
  chapterName: "",
  estimatedTeachingHours: 0,
  learningOutcomes: "",
  topicsCovered: "",
  references: "",
  practicalRequired: false,
  internalAssessment: "",
  tentativeCompletionMonth: "",
  startDateBs: "",
  endDateBs: "",
  status: "PENDING" as const,
  syllabusId: "",
  syllabusChapterId: "",
  syllabusUnitId: "",
});

const blankSessionForm = (
  filters: AcademicManagementFilters,
  teacherId?: string,
): AcademicSessionPlanInput => ({
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
  attachmentUrl: "",
  units: [emptyUnit()],
});

export const SessionPlanPanel = ({
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
}: SessionPlanPanelProps) => {
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
  const [form, setForm] = useState<AcademicSessionPlanInput>(() =>
    blankSessionForm(filters, teacherId),
  );
  /** Which syllabus to pull unit names from (linked to selected subject). */
  const [selectedSyllabusId, setSelectedSyllabusId] = useState("");

  // Keep teacherId on the form once teacher scope resolves (async)
  useEffect(() => {
    if (!teacherId) return;
    setForm((current) =>
      current.teacherId === teacherId
        ? current
        : { ...current, teacherId },
    );
  }, [teacherId]);

  // Admin: auto-select the only teacher so Save is not left disabled with no feedback
  useEffect(() => {
    if (teacherId) return;
    if (teachers.length !== 1) return;
    const onlyId = teachers[0]!._id;
    setForm((current) =>
      current.teacherId ? current : { ...current, teacherId: onlyId },
    );
  }, [teacherId, teachers]);

  // Sync academic year from filter bar when settings load
  useEffect(() => {
    if (!filters.academicYearBs) return;
    setForm((current) => {
      if (current.academicYearBs?.trim()) return current;
      return {
        ...current,
        academicYearBs: filters.academicYearBs!,
        session: filters.session || filters.academicYearBs!,
      };
    });
  }, [filters.academicYearBs, filters.session]);

  const listParams = useMemo(
    () => academicListApiParams(filters, { isCollege }),
    [filters, isCollege],
  );

  const queryKey = ["academic-management", "session-plans", listParams];
  const plansQuery = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: listParams,
        }),
      ),
  });

  const resetForm = () => {
    setEditingId(null);
    setForm(blankSessionForm(filters, teacherId));
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (plan: AcademicSessionPlanRecord) => {
    setEditingId(plan._id);
    setForm({
      academicYearBs: plan.academicYearBs,
      session: plan.session || plan.academicYearBs,
      faculty: plan.faculty || "",
      semesterBs: plan.semesterBs || "",
      classId: plan.classId,
      sectionId: plan.sectionId,
      batchId: plan.batchId,
      yearId: plan.yearId,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId || teacherId || "",
      attachmentUrl: plan.attachmentUrl || "",
      units:
        plan.units.length > 0
          ? plan.units.map((unit) => ({
              unitNo: unit.unitNo,
              chapterName: unit.chapterName,
              estimatedTeachingHours: unit.estimatedTeachingHours ?? 0,
              learningOutcomes: unit.learningOutcomes || "",
              topicsCovered: unit.topicsCovered || "",
              references: unit.references || "",
              practicalRequired: unit.practicalRequired ?? false,
              internalAssessment: unit.internalAssessment || "",
              tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
              startDateBs: unit.startDateBs || "",
              endDateBs: unit.endDateBs || "",
              status: unit.status || "PENDING",
              attachmentUrl: unit.attachmentUrl,
              syllabusId: unit.syllabusId || "",
              syllabusChapterId: unit.syllabusChapterId || "",
              syllabusUnitId: unit.syllabusUnitId || "",
            }))
          : [emptyUnit()],
    });
    setShowForm(true);
  };

  const yearOptions = useMemo(() => dedupeYearsForSelect(years), [years]);
  const subjectOptions = useMemo(() => {
    const base =
      isCollege || yearOptions.length > 0
        ? filterSubjectsByYear(subjects, years, form.yearId)
        : filterSubjectsByClass(subjects, form.classId);
    return ensureSubjectInOptions(base, form.subjectId, subjects);
  }, [
    subjects,
    years,
    form.yearId,
    form.classId,
    form.subjectId,
    isCollege,
    yearOptions.length,
  ]);

  const subjectSelectValue = useMemo(
    () => resolveSubjectSelectValue(subjectOptions, form.subjectId),
    [subjectOptions, form.subjectId],
  );

  const selectedFormSubject = useMemo(() => {
    if (!form.subjectId) return undefined;
    return (
      subjectOptions.find(
        (s) =>
          s._id === form.subjectId ||
          ((s as { subjectIds?: string[] }).subjectIds ?? []).includes(
            form.subjectId,
          ),
      ) ?? subjects.find((s) => s._id === form.subjectId)
    );
  }, [subjectOptions, form.subjectId, subjects]);
  const formNepaliText = isNepaliSubject(selectedFormSubject);

  /**
   * Matching official syllabi for subject — curriculum-shared (do not pin yearId
   * so batch-independent syllabi still load for import).
   */
  const syllabiQuery = useQuery({
    queryKey: [
      "academic-management",
      "syllabi-for-session",
      form.subjectId,
      form.academicYearBs,
      selectedFormSubject
        ? ((selectedFormSubject as { subjectIds?: string[] }).subjectIds ?? [
            form.subjectId,
          ]).join(",")
        : form.subjectId,
    ],
    queryFn: async () => {
      // Fetch by academic year only; match subject client-side across curriculum ids
      const list = await unwrap<AcademicSyllabusRecord[]>(
        api.get("/academic-management/syllabi", {
          params: filtersToParams({
            academicYearBs: form.academicYearBs,
            classId: form.classId,
          }),
        }),
      );
      const subjectIds = new Set(
        (selectedFormSubject as { subjectIds?: string[] } | undefined)
          ?.subjectIds ?? [form.subjectId],
      );
      subjectIds.add(form.subjectId);
      return list.filter((s) => subjectIds.has(s.subjectId));
    },
    enabled: showForm && Boolean(form.subjectId),
  });

  const availableSyllabi = useMemo(() => {
    const list = syllabiQuery.data ?? [];
    // Prefer usable syllabi; hide rejected unless nothing else
    const usable = list.filter((s) => s.status !== "REJECTED");
    return usable.length > 0 ? usable : list;
  }, [syllabiQuery.data]);

  const matchedSyllabus = useMemo(() => {
    if (availableSyllabi.length === 0) return null;
    if (selectedSyllabusId) {
      const picked = availableSyllabi.find((s) => s._id === selectedSyllabusId);
      if (picked) return picked;
    }
    return (
      availableSyllabi.find((s) => s.status === "APPROVED") ||
      availableSyllabi.find((s) => s.status !== "REJECTED") ||
      availableSyllabi[0] ||
      null
    );
  }, [availableSyllabi, selectedSyllabusId]);

  /** Unit name options from the linked syllabus (for dropdowns). */
  const syllabusUnitOptions = useMemo(() => {
    if (!matchedSyllabus) return [] as Array<{
      key: string;
      unitNo: number;
      heading: string;
      syllabusId: string;
      syllabusChapterId: string;
      syllabusUnitId: string;
      learningOutcomes: string;
      teachingHours: number;
      practicalRequired: boolean;
      references: string;
      topicsCovered: string;
    }>;
    const imported = mapSyllabusHierarchyToSessionUnits(matchedSyllabus);
    return imported.map((u, index) => ({
      key: u.syllabusUnitId || `${u.syllabusChapterId}-${index}`,
      unitNo: u.unitNo || index + 1,
      heading: u.chapterName,
      syllabusId: u.syllabusId || matchedSyllabus._id,
      syllabusChapterId: u.syllabusChapterId || "",
      syllabusUnitId: u.syllabusUnitId || "",
      learningOutcomes: u.learningOutcomes || "",
      teachingHours: u.estimatedTeachingHours ?? 0,
      practicalRequired: Boolean(u.practicalRequired),
      references: u.references || "",
      topicsCovered: u.topicsCovered || "",
    }));
  }, [matchedSyllabus]);

  // Keep selected syllabus in sync when subject / list changes
  useEffect(() => {
    if (!showForm) return;
    if (!availableSyllabi.length) {
      setSelectedSyllabusId("");
      return;
    }
    if (
      selectedSyllabusId &&
      availableSyllabi.some((s) => s._id === selectedSyllabusId)
    ) {
      return;
    }
    const preferred =
      availableSyllabi.find((s) => s.status === "APPROVED") ||
      availableSyllabi[0];
    setSelectedSyllabusId(preferred?._id || "");
  }, [availableSyllabi, showForm, form.subjectId, selectedSyllabusId]);

  const importFromSyllabus = (
    syllabus: AcademicSyllabusRecord,
    replace = true,
  ) => {
    const hasHierarchy = Boolean(syllabus.chapters?.length);
    const hasLegacy = Boolean(syllabus.units?.length);
    if (!hasHierarchy && !hasLegacy) {
      toast.message("Selected syllabus has no units to import");
      return;
    }
    const imported = mapSyllabusHierarchyToSessionUnits(syllabus);
    if (imported.length === 0) {
      toast.message("Selected syllabus has no unit headings to import");
      return;
    }
    if (replace) {
      setForm((current) => ({
        ...current,
        subjectId: syllabus.subjectId || current.subjectId,
        yearId: syllabus.yearId || current.yearId,
        classId: syllabus.classId || current.classId,
        batchId: syllabus.batchId || current.batchId,
        faculty: syllabus.faculty || current.faculty,
        academicYearBs: syllabus.academicYearBs || current.academicYearBs,
        session: syllabus.session || current.session,
        semesterBs: syllabus.semesterBs || current.semesterBs,
        units: imported,
      }));
      toast.success(
        `Loaded ${imported.length} unit name${imported.length === 1 ? "" : "s"} from syllabus`,
      );
      return;
    }

    // Append only units not already present (by syllabusUnitId or heading)
    const existingKeys = new Set(
      form.units.flatMap((u) =>
        [u.syllabusUnitId, u.chapterName.trim().toLowerCase()].filter(
          Boolean,
        ) as string[],
      ),
    );
    const toAdd = imported.filter((u) => {
      const byId = u.syllabusUnitId && existingKeys.has(u.syllabusUnitId);
      const byName = existingKeys.has(u.chapterName.trim().toLowerCase());
      return !byId && !byName;
    });
    if (toAdd.length === 0) {
      toast.message("All syllabus unit names are already in this plan");
      return;
    }
    setForm((current) => {
      const base = current.units.filter((u) => u.chapterName.trim());
      return {
        ...current,
        units: [
          ...base,
          ...toAdd.map((u, i) => ({
            ...u,
            unitNo: base.length + i + 1,
          })),
        ],
      };
    });
    toast.success(
      `Added ${toAdd.length} unit name${toAdd.length === 1 ? "" : "s"} from syllabus`,
    );
  };

  // Auto-import unit names when creating a new plan and subject is chosen
  useEffect(() => {
    if (!showForm || editingId || !matchedSyllabus) return;
    const onlyBlank =
      form.units.length === 1 &&
      !form.units[0]?.chapterName?.trim() &&
      !form.units[0]?.topicsCovered?.trim();
    if (!onlyBlank) return;
    importFromSyllabus(matchedSyllabus, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot import when syllabus appears
  }, [matchedSyllabus?._id, showForm, editingId, form.subjectId]);

  const createMutation = useMutation({
    mutationFn: (payload: AcademicSessionPlanInput) =>
      unwrap(api.post("/academic-management/session-plans", payload)),
    onSuccess: () => {
      toast.success("Session plan saved as draft");
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
      payload: AcademicSessionPlanInput;
    }) => unwrap(api.put(`/academic-management/session-plans/${id}`, payload)),
    onSuccess: () => {
      toast.success("Session plan updated");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const saveSessionPlan = () => {
    const resolvedTeacherId = (teacherId || form.teacherId || "").trim();
    if (!form.subjectId?.trim()) {
      toast.error("Select a subject before saving");
      return;
    }
    if (!resolvedTeacherId) {
      toast.error(
        isAdmin
          ? "Select a teacher before saving"
          : "Teacher profile is still loading — wait a moment and try again",
      );
      return;
    }
    if (!form.academicYearBs?.trim()) {
      toast.error("Academic year (BS) is required — set it in filters or form");
      return;
    }
    const unitsWithHeadings = form.units.filter((unit) =>
      Boolean(unit.chapterName?.trim()),
    );
    if (unitsWithHeadings.length === 0) {
      toast.error(
        "Add at least one unit with a heading (load from Syllabus or type a unit name)",
      );
      return;
    }
    // Omit empty ObjectId-like fields so Mongo does not reject "" casts
    const emptyToUndef = (value?: string) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const payload: AcademicSessionPlanInput = {
      academicYearBs: form.academicYearBs.trim(),
      session: (form.session || form.academicYearBs).trim(),
      faculty: form.faculty?.trim() || undefined,
      semesterBs: form.semesterBs?.trim() || undefined,
      classId: emptyToUndef(form.classId),
      sectionId: emptyToUndef(form.sectionId),
      // Curriculum-shared: do not pin empty batch; only send when explicitly set
      batchId: emptyToUndef(form.batchId),
      yearId: emptyToUndef(form.yearId),
      subjectId: form.subjectId.trim(),
      teacherId: resolvedTeacherId,
      attachmentUrl: emptyToUndef(form.attachmentUrl),
      units: unitsWithHeadings.map((unit, index) => {
        const unitNo =
          Number.isFinite(unit.unitNo) && unit.unitNo >= 1
            ? Math.floor(unit.unitNo)
            : index + 1;
        return {
          unitNo,
          chapterName: unit.chapterName.trim(),
          estimatedTeachingHours: Number.isFinite(unit.estimatedTeachingHours)
            ? unit.estimatedTeachingHours
            : 0,
          learningOutcomes: unit.learningOutcomes || "",
          topicsCovered: unit.topicsCovered || "",
          references: unit.references || "",
          practicalRequired: Boolean(unit.practicalRequired),
          internalAssessment: unit.internalAssessment || "",
          tentativeCompletionMonth: unit.tentativeCompletionMonth || "",
          startDateBs: unit.startDateBs || "",
          endDateBs: unit.endDateBs || "",
          status: unit.status || "PENDING",
          attachmentUrl: emptyToUndef(unit.attachmentUrl),
          syllabusId: emptyToUndef(unit.syllabusId) || "",
          syllabusChapterId: emptyToUndef(unit.syllabusChapterId) || "",
          syllabusUnitId: emptyToUndef(unit.syllabusUnitId) || "",
        };
      }),
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/session-plans/${id}/submit`)),
    onSuccess: () => {
      toast.success("Session plan submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks?: string }) =>
      unwrap(
        api.post(`/academic-management/session-plans/${id}/approve`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Session plan approved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) =>
      unwrap(
        api.post(`/academic-management/session-plans/${id}/reject`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Session plan rejected");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/session-plans/${id}/unlock`)),
    onSuccess: () => {
      toast.success("Session plan unlocked");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academic-management/session-plans/${id}`)),
    onSuccess: () => {
      toast.success("Session plan deleted");
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
      keywordFilteredPlans,
    ],
  );

  const yearIdToLevelKey = useMemo(
    () => buildYearIdToLevelKeyMap(years),
    [years],
  );

  // Auto-select first subject when hierarchy loads / filters change
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
    // Collapse batch-instance duplicates; keep separate plans per teacher
    return dedupePlansByCurriculum(matched, subjects, true);
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

  // PDF export includes all filtered plans (or selected subject when chosen)
  const printPlans = useMemo(() => {
    if (selectedSubject && selectedPlans.length > 0) return selectedPlans;
    return keywordFilteredPlans;
  }, [selectedSubject, selectedPlans, keywordFilteredPlans]);

  const renderPlanCard = (plan: AcademicSessionPlanRecord, compact = false) => (
    <Card key={plan._id} className={compact ? "border-slate-200 shadow-none" : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {plan.subject?.name} · {plan.academicYearBs}
          </CardTitle>
          <p className="text-sm text-slate-600">
            Teacher: {plan.teacher?.user?.fullName ?? "—"} · Completed:{" "}
            {plan.completedUnits} · Remaining: {plan.remainingUnits}
          </p>
          <AcademicProgressBar
            className="mt-2 max-w-md"
            completedPercent={plan.completedPercent}
            remainingPercent={plan.remainingPercent}
          />
        </div>
        <Badge className={statusBadgeClass(plan.status)}>{plan.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3 text-sm no-print">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Total units</p>
            <p className="font-semibold">
              {plan.completedUnits + plan.remainingUnits}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
            <p className="text-xs text-emerald-700">Completed</p>
            <p className="font-semibold text-emerald-900">{plan.completedUnits}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
            <p className="text-xs text-amber-700">Remaining</p>
            <p className="font-semibold text-amber-900">{plan.remainingUnits}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <Th>Unit</Th>
                <Th>Title</Th>
                <Th>Topics</Th>
                <Th>Start (BS)</Th>
                <Th>End (BS)</Th>
                <Th>Hours</Th>
                <Th>Status</Th>
              </tr>
            </TableHead>
            <TableBody>
              {plan.units.map((unit) => (
                <tr key={unit._id}>
                  <Td>{unit.unitNo}</Td>
                  <Td>{unit.chapterName}</Td>
                  <Td className="max-w-xs">{unit.topicsCovered || "—"}</Td>
                  <Td>{unit.startDateBs || "—"}</Td>
                  <Td>{unit.endDateBs || "—"}</Td>
                  <Td>{unit.estimatedTeachingHours}</Td>
                  <Td>
                    <Badge className={statusBadgeClass(unit.status)}>
                      {unit.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
        {canMutate ? (
          <div className="flex flex-wrap gap-2 no-print">
            {(plan.status === "DRAFT" || plan.status === "REJECTED") && (
              <Button size="sm" variant="outline" onClick={() => openEditForm(plan)}>
                Edit / Complete
              </Button>
            )}
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
                Unlock
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
            entityType="SESSION_PLAN"
            entityId={plan._id}
            canComment={isAdmin || plan.status !== "APPROVED"}
          />
        </div>
      </CardContent>
    </Card>
  );

  if (plansQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Session Plan</h2>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? "Centralized view of all teachers' yearly syllabus plans, organized by year and subject."
              : "Create and save your complete yearly syllabus (units, topics, hours, outcomes). You can build Lesson Plans from your draft without waiting for admin approval."}
          </p>
        </div>
        {canMutate ? (
          <Button
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                resetForm();
              } else {
                openCreateForm();
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {showForm ? "Close Form" : "New Session Plan"}
          </Button>
        ) : null}
      </div>

      {showForm && canMutate ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>
              {editingId ? "Edit Session Plan" : "Create Complete Session Plan"}
            </CardTitle>
            <p className="text-sm text-slate-600">
              Choose year and subject — units load automatically from the official
              Syllabus when available. You can still edit or add boxes.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {matchedSyllabus && showForm ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
                <span>
                  Hierarchical syllabus found
                  {matchedSyllabus.status === "APPROVED" ? " (approved)" : ""}.{" "}
                  {matchedSyllabus.chapters?.length
                    ? `${matchedSyllabus.chapters.length} chapter(s) · ${matchedSyllabus.totalSubUnits ?? 0} sub-unit(s)`
                    : `${matchedSyllabus.units.length} unit(s)`}{" "}
                  — Session Plan units map 1:1 to chapters; topics = sub-units.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => importFromSyllabus(matchedSyllabus, true)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Load from Syllabus
                </Button>
              </div>
            ) : null}
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
                        units: [emptyUnit()],
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
                  value={subjectSelectValue}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subjectId: event.target.value,
                      // Reset units so auto-import from syllabus can run
                      units: [emptyUnit()],
                    }))
                  }
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
              {!teacherId && teachers.length > 0 ? (
                <FormField label="Teacher *">
                  <Select
                    value={form.teacherId || ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teacherId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select teacher</option>
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
                  placeholder="Faculty (optional)"
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

            {/* Load unit names directly from linked Syllabus */}
            <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Unit names from Syllabus
                    </p>
                    <p className="text-xs text-slate-600">
                      Session Plan is linked to the subject syllabus. Load unit
                      headings only (sub-units stay in Lesson Plan).
                    </p>
                  </div>
                </div>
                {matchedSyllabus ? (
                  <Badge className={statusBadgeClass(matchedSyllabus.status)}>
                    {matchedSyllabus.status.replace(/_/g, " ")}
                  </Badge>
                ) : null}
              </div>

              {!form.subjectId ? (
                <p className="text-sm text-amber-800">
                  Select a subject first to load its syllabus unit names.
                </p>
              ) : syllabiQuery.isLoading ? (
                <p className="text-sm text-slate-600">Loading syllabus…</p>
              ) : availableSyllabi.length === 0 ? (
                <p className="text-sm text-amber-800">
                  No syllabus found for this subject. Create a Syllabus first,
                  then return here to import unit names.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <FormField label="Syllabus for this subject">
                      <Select
                        value={selectedSyllabusId || matchedSyllabus?._id || ""}
                        onChange={(event) =>
                          setSelectedSyllabusId(event.target.value)
                        }
                      >
                        {availableSyllabi.map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.subject?.name || "Subject"} · {s.academicYearBs}
                            {s.status === "APPROVED" ? " (Approved)" : ` (${s.status})`}
                            {" · "}
                            {s.totalTopics ??
                              s.chapters?.reduce(
                                (n, c) => n + c.units.length,
                                0,
                              ) ??
                              s.units?.length ??
                              0}{" "}
                            units
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          if (!matchedSyllabus) {
                            toast.error("Select a syllabus first");
                            return;
                          }
                          importFromSyllabus(matchedSyllabus, true);
                        }}
                        disabled={!matchedSyllabus || syllabusUnitOptions.length === 0}
                      >
                        <RefreshCw className="mr-1.5 h-4 w-4" />
                        Load all unit names
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (!matchedSyllabus) {
                            toast.error("Select a syllabus first");
                            return;
                          }
                          importFromSyllabus(matchedSyllabus, false);
                        }}
                        disabled={!matchedSyllabus || syllabusUnitOptions.length === 0}
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Add missing only
                      </Button>
                    </div>
                  </div>
                  {syllabusUnitOptions.length > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Available unit names ({syllabusUnitOptions.length})
                      </p>
                      <ul className="max-h-36 space-y-1 overflow-y-auto text-sm text-slate-700">
                        {syllabusUnitOptions.map((opt) => (
                          <li
                            key={opt.key}
                            className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-slate-50"
                          >
                            <span className="min-w-0 truncate">
                              <span className="mr-2 font-mono text-xs font-semibold text-brand-700">
                                {opt.unitNo}.
                              </span>
                              {opt.heading}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 text-xs"
                              title="Add this unit name to the plan"
                              onClick={() => {
                                setForm((current) => {
                                  const already = current.units.some(
                                    (u) =>
                                      (opt.syllabusUnitId &&
                                        u.syllabusUnitId ===
                                          opt.syllabusUnitId) ||
                                      u.chapterName.trim().toLowerCase() ===
                                        opt.heading.trim().toLowerCase(),
                                  );
                                  if (already) {
                                    toast.message(
                                      "This unit name is already in the plan",
                                    );
                                    return current;
                                  }
                                  const base = current.units.filter((u) =>
                                    u.chapterName.trim(),
                                  );
                                  return {
                                    ...current,
                                    units: [
                                      ...base,
                                      {
                                        ...emptyUnit(base.length + 1),
                                        unitNo: base.length + 1,
                                        chapterName: opt.heading,
                                        estimatedTeachingHours:
                                          opt.teachingHours,
                                        learningOutcomes: opt.learningOutcomes,
                                        topicsCovered: opt.topicsCovered,
                                        references: opt.references,
                                        practicalRequired: opt.practicalRequired,
                                        syllabusId: opt.syllabusId,
                                        syllabusChapterId:
                                          opt.syllabusChapterId,
                                        syllabusUnitId: opt.syllabusUnitId,
                                      },
                                    ],
                                  };
                                });
                              }}
                            >
                              + Add
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">
                      This syllabus has no unit headings yet. Open Syllabus and
                      add Units first.
                    </p>
                  )}
                </>
              )}
            </div>

            {form.units.map((unit, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-2"
              >
                <div className="md:col-span-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Unit {unit.unitNo || index + 1}
                    {unit.syllabusUnitId ? (
                      <span className="ml-2 text-xs font-normal text-emerald-700">
                        · linked from syllabus
                      </span>
                    ) : null}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 shrink-0 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 border-rose-200"
                    title={
                      form.units.length <= 1
                        ? "At least one unit is required"
                        : "Delete this unit"
                    }
                    aria-label="Delete unit"
                    disabled={form.units.length <= 1}
                    onClick={() => {
                      if (form.units.length <= 1) {
                        toast.error("At least one unit is required");
                        return;
                      }
                      setForm((current) => ({
                        ...current,
                        units: current.units
                          .filter((_, rowIndex) => rowIndex !== index)
                          .map((row, rowIndex) => ({
                            ...row,
                            unitNo: rowIndex + 1,
                          })),
                      }));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <FormField label="Unit number">
                  <NumberInput
                    min={1}
                    value={unit.unitNo}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, unitNo: event.target.valueAsNumber }
                            : row,
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField label="Unit heading (from Syllabus)">
                  {syllabusUnitOptions.length > 0 ? (
                    <Select
                      value={
                        unit.syllabusUnitId &&
                        syllabusUnitOptions.some(
                          (o) => o.syllabusUnitId === unit.syllabusUnitId,
                        )
                          ? unit.syllabusUnitId
                          : syllabusUnitOptions.find(
                              (o) =>
                                o.heading.trim().toLowerCase() ===
                                unit.chapterName.trim().toLowerCase(),
                            )?.syllabusUnitId ||
                            (unit.chapterName ? "__custom__" : "")
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "__custom__") {
                          setForm((current) => ({
                            ...current,
                            units: current.units.map((row, rowIndex) =>
                              rowIndex === index
                                ? {
                                    ...row,
                                    syllabusUnitId: "",
                                    syllabusChapterId: "",
                                    syllabusId: "",
                                  }
                                : row,
                            ),
                          }));
                          return;
                        }
                        if (!value) {
                          setForm((current) => ({
                            ...current,
                            units: current.units.map((row, rowIndex) =>
                              rowIndex === index
                                ? {
                                    ...row,
                                    chapterName: "",
                                    syllabusUnitId: "",
                                    syllabusChapterId: "",
                                    syllabusId: "",
                                  }
                                : row,
                            ),
                          }));
                          return;
                        }
                        const opt = syllabusUnitOptions.find(
                          (o) => o.syllabusUnitId === value || o.key === value,
                        );
                        if (!opt) return;
                        setForm((current) => ({
                          ...current,
                          units: current.units.map((row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  chapterName: opt.heading,
                                  unitNo: row.unitNo || opt.unitNo,
                                  estimatedTeachingHours:
                                    opt.teachingHours ||
                                    row.estimatedTeachingHours,
                                  learningOutcomes:
                                    opt.learningOutcomes ||
                                    row.learningOutcomes,
                                  topicsCovered:
                                    opt.topicsCovered || row.topicsCovered,
                                  references:
                                    opt.references || row.references,
                                  practicalRequired: opt.practicalRequired,
                                  syllabusId: opt.syllabusId,
                                  syllabusChapterId: opt.syllabusChapterId,
                                  syllabusUnitId: opt.syllabusUnitId,
                                }
                              : row,
                          ),
                        }));
                      }}
                    >
                      <option value="">Select unit from syllabus…</option>
                      {syllabusUnitOptions.map((opt) => (
                        <option
                          key={opt.key}
                          value={opt.syllabusUnitId || opt.key}
                        >
                          {opt.heading}
                        </option>
                      ))}
                      {unit.chapterName &&
                      !syllabusUnitOptions.some(
                        (o) =>
                          o.syllabusUnitId === unit.syllabusUnitId ||
                          o.heading.trim().toLowerCase() ===
                            unit.chapterName.trim().toLowerCase(),
                      ) ? (
                        <option value="__custom__">
                          Custom: {unit.chapterName}
                        </option>
                      ) : (
                        <option value="__custom__">Custom (type below)</option>
                      )}
                    </Select>
                  ) : (
                    <Input
                      value={unit.chapterName}
                      nepali={formNepaliText}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          units: current.units.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, chapterName: event.target.value }
                              : row,
                          ),
                        }))
                      }
                      placeholder={
                        formNepaliText
                          ? "एकाइ १ : शीर्षक (नेपालीमा)"
                          : "Unit 1 : Introduction to Human Anatomy"
                      }
                    />
                  )}
                  {syllabusUnitOptions.length > 0 &&
                  (!unit.syllabusUnitId ||
                    unit.chapterName === "" ||
                    !syllabusUnitOptions.some(
                      (o) => o.syllabusUnitId === unit.syllabusUnitId,
                    )) ? (
                    <Input
                      className="mt-2"
                      value={unit.chapterName}
                      nepali={formNepaliText}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          units: current.units.map((row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  chapterName: event.target.value,
                                  syllabusUnitId: "",
                                  syllabusChapterId: row.syllabusChapterId,
                                }
                              : row,
                          ),
                        }))
                      }
                      placeholder={
                        formNepaliText
                          ? "वा अनुकूल शीर्षक लेख्नुहोस्"
                          : "Or type a custom unit heading"
                      }
                    />
                  ) : null}
                </FormField>
                <FormField label="Sub-unit topics (from syllabus, optional)">
                  <Textarea
                    value={unit.topicsCovered}
                    nepali={formNepaliText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, topicsCovered: event.target.value }
                            : row,
                        ),
                      }))
                    }
                    placeholder="Auto-filled from syllabus for Lesson Plan selection — not shown as Session Plan rows"
                  />
                </FormField>
                <FormField label="Estimated teaching hours">
                  <NumberInput
                    min={0}
                    value={
                      Number.isFinite(unit.estimatedTeachingHours)
                        ? unit.estimatedTeachingHours
                        : 0
                    }
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                estimatedTeachingHours: Number.isFinite(
                                  event.target.valueAsNumber,
                                )
                                  ? event.target.valueAsNumber
                                  : 0,
                              }
                            : row,
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField label="Unit start date (BS)">
                  <NepaliDateField
                    value={unit.startDateBs || ""}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                startDateBs: value,
                                endDateBs:
                                  row.endDateBs && row.endDateBs >= value
                                    ? row.endDateBs
                                    : value,
                              }
                            : row,
                        ),
                      }))
                    }
                    placeholder="Start date"
                  />
                </FormField>
                <FormField label="Unit end date (BS)">
                  <NepaliDateField
                    value={unit.endDateBs || ""}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, endDateBs: value }
                            : row,
                        ),
                      }))
                    }
                    placeholder="End date"
                  />
                </FormField>
                <FormField label="Tentative completion month">
                  <Select
                    value={unit.tentativeCompletionMonth || ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                tentativeCompletionMonth: event.target.value,
                              }
                            : row,
                        ),
                      }))
                    }
                  >
                    <option value="">Select month (optional)</option>
                    {NEPALI_MONTHS.map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Internal assessment">
                  <Input
                    value={unit.internalAssessment || ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                internalAssessment: event.target.value,
                              }
                            : row,
                        ),
                      }))
                    }
                    placeholder="IA / assignment notes"
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(unit.practicalRequired)}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                practicalRequired: event.target.checked,
                              }
                            : row,
                        ),
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Practical required for this unit
                </label>
              </div>
            ))}
            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) =>
                setForm((current) => ({ ...current, attachmentUrl: url }))
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    units: [
                      ...current.units,
                      emptyUnit(current.units.length + 1),
                    ],
                  }))
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Unit
              </Button>
              <Button
                type="button"
                onClick={() => {
                  try {
                    saveSessionPlan();
                  } catch (error) {
                    toast.error(parseErrorMessage(error));
                  }
                }}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving…"
                  : editingId
                    ? "Update Session Plan"
                    : "Save Complete Session Plan"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </div>
            {!form.subjectId || !(form.teacherId || teacherId) ? (
              <p className="text-xs text-amber-700">
                {!form.subjectId
                  ? "Select a subject to enable a complete save."
                  : "Select a teacher to enable a complete save."}
              </p>
            ) : null}
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
              description="Choose Faculty → Year → Subject to view Session Plans. Curriculum is shared across student batches."
            />
          ) : selectedPlans.length === 0 ? (
            <EmptyState
              title={`No Session Plans for ${selectedSubjectMeta.subject.subjectName}`}
              description={
                isAdmin
                  ? "Teachers have not created a Session Plan for this subject yet."
                  : "Create a Session Plan for this subject to start yearly planning."
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
                    {selectedPlans.length} Session Plan
                    {selectedPlans.length === 1 ? "" : "s"} · One curriculum
                    subject · Teachers listed separately (not by batch)
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

      {/* Dedicated print / PDF area (filtered or selected subject) */}
      <div id="session-plan-print-area" className="hidden print:block">
        <AcademicPrintHeader
          institutionName={institutionName}
          title="Session Plan Report"
          subtitle={
            selectedSubjectMeta
              ? `${selectedSubjectMeta.faculty.label} · ${selectedSubjectMeta.year.label} · ${selectedSubjectMeta.subject.subjectName}`
              : "Filtered Session Plans"
          }
          academicYearBs={filters.academicYearBs}
          generatedAt={new Date().toLocaleString()}
        />
        {printPlans.length === 0 ? (
          <p className="text-sm text-slate-600">No session plans to export.</p>
        ) : (
          groupByTeacher(printPlans).map((group) => (
            <div key={group.teacherId} className="mb-8 break-inside-avoid">
              <h3 className="mb-2 text-base font-bold text-slate-900">
                Teacher: {group.teacherName}
              </h3>
              {group.items.map((plan) => (
                <div key={plan._id} className="mb-6">
                  <p className="font-semibold">
                    {plan.subject?.name} · {plan.academicYearBs} · {plan.status}
                  </p>
                  <p className="text-sm text-slate-600 mb-2">
                    Completion: {plan.completedPercent}% · Units:{" "}
                    {plan.completedUnits}/
                    {plan.completedUnits + plan.remainingUnits}
                  </p>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border p-1 text-left">Unit</th>
                        <th className="border p-1 text-left">Title</th>
                        <th className="border p-1 text-left">Topics</th>
                        <th className="border p-1 text-left">Hours</th>
                        <th className="border p-1 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.units.map((unit) => (
                        <tr key={unit._id}>
                          <td className="border p-1">{unit.unitNo}</td>
                          <td className="border p-1">{unit.chapterName}</td>
                          <td className="border p-1">{unit.topicsCovered}</td>
                          <td className="border p-1">
                            {unit.estimatedTeachingHours}
                          </td>
                          <td className="border p-1">{unit.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))
        )}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
