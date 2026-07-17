import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanRecord,
  type AcademicLogBookEntryInput,
  type AcademicLogBookEntryRecord,
  type AcademicSessionPlanRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  type TodayTimetableSlot,
  canManageInstitution,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { CalendarPlus, CheckCircle2, Link2 } from "lucide-react";
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
  NEPALI_MONTHS,
  parseSubUnitsFromTopics,
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
  groupByTeacher,
  matchLogBookKeyword,
  recordsForCurriculumSubject,
  type HierarchyScopeOption,
  type HierarchySubjectNode,
} from "./academicHierarchyUtils";

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

/** Map BS month number (1–12) to Nepali month name used by Lesson Plans. */
const nepaliMonthFromBsDate = (dateBs: string): string => {
  const monthNum = Number(dateBs.split("-")[1] ?? 0);
  if (monthNum >= 1 && monthNum <= 12) {
    return NEPALI_MONTHS[monthNum - 1] ?? "";
  }
  return "";
};

interface LogBookPanelProps {
  filters: AcademicManagementFilters;
  teacherId?: string;
  isTeacher: boolean;
  subjects?: Array<
    Pick<
      SubjectRecord,
      "_id" | "name" | "code" | "yearIds" | "classIds" | "isActive"
    > & { masterSubjectId?: string | null }
  >;
  teachers?: Array<{ _id: string; user: { fullName: string } }>;
  years?: HierarchyScopeOption[];
  classes?: HierarchyScopeOption[];
  assignments?: SubjectAssignmentRecord[];
  isCollege?: boolean;
  institutionName?: string;
  writeAccess?: boolean;
}

export const LogBookPanel = ({
  filters,
  teacherId,
  isTeacher,
  subjects = [],
  teachers = [],
  years = [],
  classes = [],
  assignments = [],
  isCollege = false,
  institutionName = "Institution",
  writeAccess = true,
}: LogBookPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const canMutate = writeAccess;
  const [showForm, setShowForm] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TodayTimetableSlot | null>(
    null,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState<string | null>(
    null,
  );
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<HierarchySubjectNode | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(
    () =>
      filters.month ||
      nepaliMonthFromBsDate(formatTodayBs()) ||
      NEPALI_MONTHS[0] ||
      "Baisakh",
  );
  const [form, setForm] = useState<AcademicLogBookEntryInput>({
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
    dateBs: filters.dateFrom || formatTodayBs(),
    lessonPlanItemId: "",
    lessonPlanId: undefined,
    sessionPlanUnitId: "",
    subUnitTitle: "",
    syllabusId: "",
    syllabusChapterId: "",
    syllabusUnitId: "",
    syllabusSubUnitId: "",
    topicCovered: "",
    unit: "",
    objectives: "",
    teachingMethod: "",
    teachingAids: "",
    theoryPractical: "THEORY",
    periodNumber: 1,
    homeworkGiven: "",
    assignment: "",
    feedback: "",
    difficultiesFaced: "",
    nextClassPlan: "",
    attachmentUrl: "",
  });

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

  // Keep teacherId once teacher scope resolves
  useEffect(() => {
    if (!teacherId) return;
    setForm((current) =>
      current.teacherId === teacherId
        ? current
        : { ...current, teacherId },
    );
  }, [teacherId]);

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

  const effectiveTeacherId =
    teacherId || form.teacherId || filters.teacherId || "";

  const listParams = useMemo(
    () => academicListApiParams(filters, { isCollege }),
    [filters, isCollege],
  );

  const entriesQuery = useQuery({
    queryKey: ["academic-management", "log-book", listParams],
    queryFn: () =>
      unwrap<AcademicLogBookEntryRecord[]>(
        api.get("/academic-management/log-book-entries", {
          params: listParams,
        }),
      ),
  });

  const effectiveDateBs = form.dateBs || formatTodayBs();

  const timetableQuery = useQuery({
    queryKey: ["academic-management", "timetable-today", effectiveDateBs],
    queryFn: () =>
      unwrap<TodayTimetableSlot[]>(
        api.get("/academic-management/timetable/today", {
          params: { dateBs: effectiveDateBs },
        }),
      ),
    enabled: isTeacher && showForm,
  });

  // Session Plan units — do not reuse hub month/status/batch filters (Session Plans are yearly)
  const sessionPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "session-plans-for-log",
      form.subjectId,
      effectiveTeacherId,
      form.academicYearBs,
    ],
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: filtersToParams({
            academicYearBs: form.academicYearBs || filters.academicYearBs,
            subjectId: form.subjectId || filters.subjectId || undefined,
            teacherId: effectiveTeacherId || undefined,
          }),
        }),
      ),
    enabled: showForm && Boolean(form.subjectId || filters.subjectId),
  });

  // All Lesson Plans for subject/year (no month/status filter) so topics cascade into Log Book
  const lessonPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "lesson-plans-for-log",
      form.subjectId,
      effectiveTeacherId,
      form.academicYearBs,
    ],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: filtersToParams({
            academicYearBs: form.academicYearBs || filters.academicYearBs,
            subjectId: form.subjectId || filters.subjectId || undefined,
            teacherId: effectiveTeacherId || undefined,
          }),
        }),
      ),
    enabled: showForm && Boolean(form.subjectId || filters.subjectId),
  });

  const sessionUnits = useMemo(() => {
    const plans = sessionPlansQuery.data ?? [];
    return plans.flatMap((plan) =>
      plan.units.map((unit) => ({
        ...unit,
        planId: plan._id,
        planStatus: plan.status,
      })),
    );
  }, [sessionPlansQuery.data]);

  const selectedSessionUnit = useMemo(
    () => sessionUnits.find((unit) => unit._id === form.sessionPlanUnitId),
    [sessionUnits, form.sessionPlanUnitId],
  );

  const logSubUnits = useMemo(
    () => parseSubUnitsFromTopics(selectedSessionUnit?.topicsCovered),
    [selectedSessionUnit?.topicsCovered],
  );

  const lessonItemOptions = useMemo(() => {
    const plans = lessonPlansQuery.data ?? [];
    const options = plans.flatMap((plan) =>
      plan.items.map((item) => ({
        id: item._id,
        planId: plan._id,
        month: plan.month || plan.startDateBs || "",
        label: `${plan.startDateBs || plan.month || "Plan"}${plan.endDateBs ? `→${plan.endDateBs}` : ""} · ${item.unit ? `Ch ${item.unit.unitNo}` : item.subjectLabel || "Chapter"}${item.subUnitTitle ? ` · ${item.subUnitTitle}` : ""} · ${item.plannedTopic}`,
        topic: item.plannedTopic,
        subUnitTitle: item.subUnitTitle || "",
        unit: item.unit
          ? `Chapter ${item.unit.unitNo}: ${item.unit.chapterName}`
          : item.subjectLabel || "",
        objectives: item.learningObjectives || "",
        teachingMethod: item.teachingMethod || "",
        teachingAids: item.teachingAids || "",
        subjectId: plan.subjectId,
        sessionPlanUnitId: item.sessionPlanUnitId || "",
        syllabusId: item.syllabusId || item.unit?.syllabusId || "",
        syllabusChapterId:
          item.syllabusChapterId || item.unit?.syllabusChapterId || "",
        syllabusUnitId: item.syllabusUnitId || "",
        syllabusSubUnitId: item.syllabusSubUnitId || "",
        completionStatus: item.completionStatus,
        completedPercent: item.completedPercent,
        remainingPercent: item.remainingPercent,
      })),
    );
    // Incomplete topics first so teachers pick the next class faster
    return options.sort((a, b) => {
      const aDone = a.completionStatus === "COMPLETED" ? 1 : 0;
      const bDone = b.completionStatus === "COMPLETED" ? 1 : 0;
      return aDone - bDone;
    });
  }, [lessonPlansQuery.data]);

  const selectedLessonPlan = useMemo(() => {
    const plans = lessonPlansQuery.data ?? [];
    if (plans.length === 1) return plans[0];
    if (form.lessonPlanId) {
      return plans.find((p) => p._id === form.lessonPlanId);
    }
    return plans[0];
  }, [lessonPlansQuery.data, form.lessonPlanId]);

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLogBookEntryInput) =>
      unwrap(api.post("/academic-management/log-book-entries", payload)),
    onSuccess: () => {
      toast.success("Log book entry saved — progress updated automatically");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      setSelectedSlot(null);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      reviewStatus,
    }: {
      id: string;
      reviewStatus: "REVIEWED" | "APPROVED" | "NEEDS_IMPROVEMENT";
    }) =>
      unwrap(
        api.post(`/academic-management/log-book-entries/${id}/review`, {
          reviewStatus,
        }),
      ),
    onSuccess: () => {
      toast.success("Log book entry reviewed");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const applyTimetableSlot = async (slot: TodayTimetableSlot) => {
    setSelectedSlot(slot);
    const attendance = await unwrap<{
      present: number;
      absent: number;
      percent: number;
      marked: boolean;
    }>(
      api.get("/academic-management/attendance/summary", {
        params: {
          subjectId: slot.subjectId,
          teacherId: teacherId || form.teacherId,
          dateBs: form.dateBs,
          classId: slot.classId,
          sectionId: slot.sectionId,
          batchId: slot.batchId,
          yearId: slot.yearId,
        },
      }),
    );

    setForm((current) => ({
      ...current,
      subjectId: slot.subjectId,
      classId: slot.classId,
      sectionId: slot.sectionId,
      batchId: slot.batchId,
      yearId: slot.yearId,
      periodNumber: slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      timetableSlotId: slot._id,
      // Clear topic link when subject changes via timetable
      lessonPlanItemId:
        current.subjectId === slot.subjectId
          ? current.lessonPlanItemId
          : "",
      lessonPlanId:
        current.subjectId === slot.subjectId
          ? current.lessonPlanId
          : undefined,
    }));

    if (attendance.marked) {
      toast.message(
        `Attendance loaded: ${attendance.present} present, ${attendance.absent} absent (${attendance.percent}%)`,
      );
    }
  };

  const applyLessonItemToForm = (
    itemId: string,
    options: typeof lessonItemOptions,
    quiet = false,
  ) => {
    if (!itemId) {
      setForm((current) => ({
        ...current,
        lessonPlanItemId: "",
        lessonPlanId: undefined,
      }));
      return;
    }
    const option = options.find((row) => row.id === itemId);
    if (!option) return;
    // Full cascade: Lesson Plan → Log Book (+ hierarchical syllabus links)
    setForm((current) => ({
      ...current,
      lessonPlanItemId: itemId,
      lessonPlanId: option.planId,
      subjectId: option.subjectId || current.subjectId,
      sessionPlanUnitId:
        option.sessionPlanUnitId || current.sessionPlanUnitId || "",
      subUnitTitle: option.subUnitTitle || "",
      syllabusId: option.syllabusId || current.syllabusId || "",
      syllabusChapterId:
        option.syllabusChapterId || current.syllabusChapterId || "",
      syllabusUnitId: option.syllabusUnitId || current.syllabusUnitId || "",
      syllabusSubUnitId:
        option.syllabusSubUnitId || current.syllabusSubUnitId || "",
      unit: option.unit || current.unit,
      topicCovered: option.topic || option.subUnitTitle || current.topicCovered,
      objectives: option.objectives || current.objectives,
      teachingMethod: option.teachingMethod || current.teachingMethod,
      teachingAids: option.teachingAids || current.teachingAids,
    }));
    if (!quiet) {
      toast.success(
        option.syllabusSubUnitId
          ? "Filled from Lesson Plan · linked to syllabus sub-unit"
          : "Filled from Lesson Plan",
      );
    }
  };

  const selectLessonItem = (itemId: string) => {
    applyLessonItemToForm(itemId, lessonItemOptions, false);
  };

  // Auto-pick next incomplete Lesson Plan topic when opening form / changing subject
  useEffect(() => {
    if (!showForm) return;
    if (form.lessonPlanItemId) return;
    if (lessonItemOptions.length === 0) return;
    const openTopics = lessonItemOptions.filter(
      (row) => row.completionStatus !== "COMPLETED",
    );
    const auto =
      openTopics.length === 1
        ? openTopics[0]
        : lessonItemOptions.length === 1
          ? lessonItemOptions[0]
          : null;
    if (!auto) return;
    applyLessonItemToForm(auto.id, lessonItemOptions, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when options appear
  }, [showForm, form.subjectId, lessonItemOptions, form.lessonPlanItemId]);

  const selectSessionUnit = (unitId: string) => {
    const unit = sessionUnits.find((row) => row._id === unitId);
    setForm((current) => ({
      ...current,
      sessionPlanUnitId: unitId,
      subUnitTitle: "",
      syllabusId: unit?.syllabusId || "",
      syllabusChapterId: unit?.syllabusChapterId || "",
      syllabusUnitId: "",
      syllabusSubUnitId: "",
      unit: unit ? `Chapter ${unit.unitNo}: ${unit.chapterName}` : "",
      topicCovered: unit?.topicsCovered || unit?.chapterName || "",
      objectives: unit?.learningOutcomes || current.objectives,
      // Manual unit pick clears lesson-plan link (user can re-link)
      lessonPlanItemId: "",
      lessonPlanId: undefined,
    }));
  };

  const filteredEntries = useMemo(
    () =>
      (entriesQuery.data ?? []).filter((entry) =>
        matchLogBookKeyword(entry, filters.keyword ?? ""),
      ),
    [entriesQuery.data, filters.keyword],
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
        records: filteredEntries.map((entry) => ({
          subjectId: entry.subjectId,
          yearId: entry.yearId,
          classId: entry.classId,
          teacherId: entry.teacherId,
          faculty: entry.faculty,
          subjectName: entry.subject?.name,
          teacherName: entry.teacher?.user?.fullName,
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
      filteredEntries,
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

  const selectedEntries = useMemo(() => {
    if (!selectedSubject) return [];
    return recordsForCurriculumSubject(
      filteredEntries,
      selectedSubject.subjectIds,
      selectedYearKey,
      yearIdToLevelKey,
      isCollege,
    );
  }, [
    filteredEntries,
    selectedSubject,
    selectedYearKey,
    yearIdToLevelKey,
    isCollege,
  ]);

  const teacherGroups = useMemo(
    () => groupByTeacher(selectedEntries),
    [selectedEntries],
  );

  const printEntries = useMemo(() => {
    if (selectedSubject && selectedEntries.length > 0) return selectedEntries;
    return filteredEntries;
  }, [selectedSubject, selectedEntries, filteredEntries]);

  const logBookStats = useMemo(() => {
    const rows = selectedEntries.length > 0 ? selectedEntries : filteredEntries;
    const topics = new Set(rows.map((r) => r.topicCovered).filter(Boolean));
    return {
      dailyEntries: rows.length,
      topicsCovered: topics.size,
    };
  }, [selectedEntries, filteredEntries]);

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Log Book</h2>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? "Centralized daily teaching records for all teachers, by year and subject."
              : "Daily teaching record linked to your monthly Lesson Plan — unit and topic are selected, not retyped."}
          </p>
        </div>
        {canMutate ? (
          <Button onClick={() => setShowForm((current) => !current)}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            New Entry
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 no-print">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Daily entries</p>
            <p className="text-2xl font-semibold text-slate-900">
              {logBookStats.dailyEntries}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Topics covered</p>
            <p className="text-2xl font-semibold text-slate-900">
              {logBookStats.topicsCovered}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Selected month plan progress</p>
            {selectedLessonPlan ? (
              <div className="mt-1">
                <p className="text-sm font-medium text-slate-800">
                  {selectedLessonPlan.completedPercent}% complete
                </p>
                <AcademicProgressBar
                  className="mt-1"
                  completedPercent={selectedLessonPlan.completedPercent}
                  remainingPercent={selectedLessonPlan.remainingPercent}
                  compact
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-1">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {showForm && canMutate ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>Create Log Book Entry</CardTitle>
            <p className="text-sm text-slate-600">
              Pick the <strong>Lesson Plan topic</strong> you taught — unit,
              sub-unit, topic, and objectives fill in automatically. Only add
              what is new for today.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Date taught (BS)">
                <NepaliDateField
                  value={form.dateBs}
                  onChange={(value) => {
                    const month = nepaliMonthFromBsDate(value);
                    setForm((current) => ({ ...current, dateBs: value }));
                    if (month) setSelectedMonth(month);
                  }}
                  placeholder="Select date"
                />
              </FormField>
              <FormField label="Period number">
                <NumberInput
                  min={1}
                  value={form.periodNumber}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      periodNumber: event.target.valueAsNumber,
                    }))
                  }
                  placeholder="e.g. 1"
                />
              </FormField>
              <FormField label="Theory / Practical">
                <Select
                  value={form.theoryPractical}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      theoryPractical: event.target
                        .value as AcademicLogBookEntryInput["theoryPractical"],
                    }))
                  }
                >
                  <option value="THEORY">Theory</option>
                  <option value="PRACTICAL">Practical</option>
                  <option value="BOTH">Both</option>
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
                        lessonPlanItemId: "",
                        lessonPlanId: undefined,
                        sessionPlanUnitId: "",
                        subUnitTitle: "",
                        topicCovered: "",
                        unit: "",
                        objectives: "",
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
                        lessonPlanItemId: "",
                        lessonPlanId: undefined,
                        sessionPlanUnitId: "",
                        subUnitTitle: "",
                        topicCovered: "",
                        unit: "",
                        objectives: "",
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
                        lessonPlanItemId: "",
                        lessonPlanId: undefined,
                        sessionPlanUnitId: "",
                        subUnitTitle: "",
                        topicCovered: "",
                        unit: "",
                        objectives: "",
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
                      lessonPlanItemId: "",
                      lessonPlanId: undefined,
                      sessionPlanUnitId: "",
                      subUnitTitle: "",
                      topicCovered: "",
                      unit: "",
                      objectives: "",
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
              <FormField label="Start time (optional)">
                <Input
                  value={form.startTime ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                  placeholder="e.g. 10:00"
                />
              </FormField>
              <FormField label="End time (optional)">
                <Input
                  value={form.endTime ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      endTime: event.target.value,
                    }))
                  }
                  placeholder="e.g. 10:45"
                />
              </FormField>
            </div>

            {formNepaliText ? (
              <NepaliSubjectBanner
                compact
                subjectName={
                  selectedFormSubject
                    ? `${selectedFormSubject.name}${selectedFormSubject.code ? ` (${selectedFormSubject.code})` : ""}`
                    : undefined
                }
              />
            ) : null}

            {isTeacher && (timetableQuery.data?.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="mb-2 text-sm font-medium text-brand-900">
                  Today&apos;s Timetable
                </p>
                <div className="flex flex-wrap gap-2">
                  {timetableQuery.data?.map((slot) => (
                    <Button
                      key={slot._id}
                      size="sm"
                      variant={
                        selectedSlot?._id === slot._id ? "default" : "outline"
                      }
                      onClick={() => void applyTimetableSlot(slot)}
                    >
                      P{slot.periodNumber} · {slot.subjectName}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 space-y-3">
              <p className="text-sm font-semibold text-brand-950 flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                From Lesson Plan (recommended)
              </p>
              <FormField label="Lesson Plan topic taught *">
                <Select
                  value={form.lessonPlanItemId ?? ""}
                  onChange={(event) => selectLessonItem(event.target.value)}
                >
                  <option value="">
                    {lessonPlansQuery.isLoading
                      ? "Loading Lesson Plan topics…"
                      : lessonItemOptions.length === 0
                        ? "No Lesson Plan topics — create a Lesson Plan first"
                        : "Select topic from Lesson Plan"}
                  </option>
                  {lessonItemOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.completionStatus === "COMPLETED"
                        ? " ✓ done"
                        : ""}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-600">
                  Chapter, sub-unit, topic, and objectives fill from Lesson Plan
                  (synced from hierarchical Syllabus). Saving marks the linked
                  syllabus sub-unit completed.
                </p>
              </FormField>

              {form.lessonPlanItemId ? (
                <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-emerald-100 bg-white p-3">
                  <FormField label="Unit">
                    <Input value={form.unit} readOnly className="bg-slate-50" />
                  </FormField>
                  <FormField label="Sub-unit / topic">
                    <Input
                      value={form.subUnitTitle || form.topicCovered}
                      readOnly
                      className="bg-slate-50"
                    />
                  </FormField>
                </div>
              ) : null}
            </div>

            {!form.lessonPlanItemId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  Or pick unit from Session Plan (if no Lesson Plan yet)
                </p>
                <FormField label="Unit (Session Plan)">
                  <Select
                    value={form.sessionPlanUnitId || ""}
                    onChange={(event) => selectSessionUnit(event.target.value)}
                  >
                    <option value="">
                      {sessionPlansQuery.isLoading
                        ? "Loading units…"
                        : sessionUnits.length === 0
                          ? "No Session Plan units"
                          : "Select unit"}
                    </option>
                    {sessionUnits.map((unit) => (
                      <option key={unit._id} value={unit._id}>
                        Chapter {unit.unitNo}: {unit.chapterName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Sub-unit / topic">
                  {logSubUnits.length > 0 ? (
                    <Select
                      value={form.subUnitTitle || ""}
                      onChange={(event) => {
                        const sub = event.target.value;
                        setForm((current) => ({
                          ...current,
                          subUnitTitle: sub,
                          topicCovered:
                            sub ||
                            selectedSessionUnit?.topicsCovered ||
                            selectedSessionUnit?.chapterName ||
                            current.topicCovered,
                        }));
                      }}
                    >
                      <option value="">Whole unit / chapter</option>
                      {logSubUnits.map((sub) => (
                        <option key={sub} value={sub}>
                          {sub}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={form.topicCovered}
                      nepali={formNepaliText}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          topicCovered: event.target.value,
                        }))
                      }
                      placeholder={
                        formNepaliText ? "पढाइएको विषय" : "Topic taught"
                      }
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Teaching method">
                <Input
                  value={form.teachingMethod}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      teachingMethod: event.target.value,
                    }))
                  }
                  placeholder={
                    formNepaliText
                      ? "प्रवचन, छलफल…"
                      : "Lecture, discussion, demo…"
                  }
                />
              </FormField>
              <FormField label="Objectives">
                <Textarea
                  value={form.objectives}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      objectives: event.target.value,
                    }))
                  }
                  placeholder={
                    formNepaliText
                      ? "विद्यार्थीहरू सक्षम हुनेछन्:\n• …"
                      : "Students will be able to:\n• Explain the skeletal system.\n• Identify different bones.\n• Understand bone functions."
                  }
                />
              </FormField>
              <FormField label="Feedback">
                <Textarea
                  value={form.feedback}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      feedback: event.target.value,
                    }))
                  }
                  placeholder={
                    formNepaliText
                      ? "विद्यार्थी प्रतिक्रिया"
                      : "Student feedback / class response"
                  }
                />
              </FormField>
              <FormField label="Additional remarks (optional)">
                <Textarea
                  value={form.difficultiesFaced}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      difficultiesFaced: event.target.value,
                    }))
                  }
                  placeholder={
                    formNepaliText
                      ? "अतिरिक्त टिप्पणी"
                      : "Difficulties or extra notes"
                  }
                />
              </FormField>
              <FormField label="Homework given">
                <Textarea
                  value={form.homeworkGiven}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      homeworkGiven: event.target.value,
                    }))
                  }
                  placeholder={formNepaliText ? "गृहकार्य" : "Optional"}
                />
              </FormField>
              <FormField label="Next class plan">
                <Textarea
                  value={form.nextClassPlan}
                  nepali={formNepaliText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nextClassPlan: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </FormField>
            </div>
            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) =>
                setForm((current) => ({ ...current, attachmentUrl: url }))
              }
            />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!form.dateBs) {
                    toast.error("Select the date taught");
                    return;
                  }
                  if (!form.lessonPlanItemId && !form.sessionPlanUnitId) {
                    toast.error(
                      "Select a Lesson Plan topic (or a Session Plan unit)",
                    );
                    return;
                  }
                  createMutation.mutate({
                    ...form,
                    teacherId: teacherId || form.teacherId,
                    lessonPlanItemId: form.lessonPlanItemId || "",
                    sessionPlanUnitId: form.sessionPlanUnitId || "",
                    subUnitTitle: form.subUnitTitle || "",
                    topicCovered:
                      form.topicCovered ||
                      form.subUnitTitle ||
                      form.unit ||
                      "Topic taught",
                  });
                }}
                disabled={
                  !form.dateBs ||
                  (!form.lessonPlanItemId && !form.sessionPlanUnitId) ||
                  !form.subjectId ||
                  !(teacherId || form.teacherId) ||
                  createMutation.isPending
                }
              >
                Save Entry
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setSelectedSlot(null);
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
              setSelectedEntryId(null);
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
          ) : selectedEntries.length === 0 ? (
            <EmptyState
              title={`No Log Book entries for ${selectedSubjectMeta.subject.subjectName}`}
              description="Record a class by selecting a topic from the monthly Lesson Plan."
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
                  <Card>
                    <CardContent className="overflow-x-auto pt-6">
                      <Table>
                        <TableHead>
                          <tr>
                            <Th>Date</Th>
                            <Th>Unit</Th>
                            <Th>Topic</Th>
                            <Th>Objectives</Th>
                            <Th>Method</Th>
                            <Th>T/P</Th>
                            <Th>Time</Th>
                            <Th>Feedback</Th>
                            <Th>Review</Th>
                            <Th className="no-print">Actions</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {group.items.map((entry) => (
                            <tr key={entry._id}>
                              <Td className="whitespace-nowrap">
                                {entry.dateBs}
                              </Td>
                              <Td>{entry.unit || "—"}</Td>
                              <Td>{entry.topicCovered}</Td>
                              <Td className="max-w-[140px] truncate">
                                {entry.objectives || "—"}
                              </Td>
                              <Td>{entry.teachingMethod || "—"}</Td>
                              <Td>{entry.theoryPractical}</Td>
                              <Td className="whitespace-nowrap text-xs">
                                {entry.startTime || entry.endTime
                                  ? `${entry.startTime ?? ""}–${entry.endTime ?? ""}`
                                  : `P${entry.periodNumber}`}
                              </Td>
                              <Td className="max-w-[120px] truncate">
                                {entry.feedback || "—"}
                              </Td>
                              <Td>
                                <Badge
                                  className={statusBadgeClass(
                                    entry.reviewStatus,
                                  )}
                                >
                                  {entry.reviewStatus}
                                </Badge>
                              </Td>
                              <Td className="no-print">
                                <div className="flex flex-wrap gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setSelectedEntryId(entry._id)
                                    }
                                  >
                                    Notes
                                  </Button>
                                  {isAdmin && canMutate ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          reviewMutation.mutate({
                                            id: entry._id,
                                            reviewStatus: "APPROVED",
                                          })
                                        }
                                      >
                                        <CheckCircle2 className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          reviewMutation.mutate({
                                            id: entry._id,
                                            reviewStatus: "NEEDS_IMPROVEMENT",
                                          })
                                        }
                                      >
                                        Review
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </Td>
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              ))}

              {selectedEntryId ? (
                <div className="no-print">
                  <AcademicCommentsPanel
                    entityType="LOG_BOOK_ENTRY"
                    entityId={selectedEntryId}
                    canComment={isAdmin || isTeacher}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div id="log-book-print-area" className="hidden print:block">
        <AcademicPrintHeader
          institutionName={institutionName}
          title="Log Book Report"
          subtitle={
            selectedSubjectMeta
              ? `${selectedSubjectMeta.faculty.label} · ${selectedSubjectMeta.year.label} · ${selectedSubjectMeta.subject.subjectName}`
              : "Filtered Log Book entries"
          }
          academicYearBs={filters.academicYearBs}
          generatedAt={new Date().toLocaleString()}
        />
        {groupByTeacher(printEntries).map((group) => (
          <div key={group.teacherId} className="mb-8">
            <h3 className="mb-2 font-bold">Teacher: {group.teacherName}</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border p-1 text-left">Date</th>
                  <th className="border p-1 text-left">Unit</th>
                  <th className="border p-1 text-left">Topic</th>
                  <th className="border p-1 text-left">Method</th>
                  <th className="border p-1 text-left">T/P</th>
                  <th className="border p-1 text-left">Time</th>
                  <th className="border p-1 text-left">Feedback</th>
                  <th className="border p-1 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((entry) => (
                  <tr key={entry._id}>
                    <td className="border p-1">{entry.dateBs}</td>
                    <td className="border p-1">{entry.unit}</td>
                    <td className="border p-1">{entry.topicCovered}</td>
                    <td className="border p-1">{entry.teachingMethod}</td>
                    <td className="border p-1">{entry.theoryPractical}</td>
                    <td className="border p-1">
                      {entry.startTime || entry.endTime
                        ? `${entry.startTime ?? ""}–${entry.endTime ?? ""}`
                        : `P${entry.periodNumber}`}
                    </td>
                    <td className="border p-1">{entry.feedback}</td>
                    <td className="border p-1">{entry.reviewStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
