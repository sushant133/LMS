import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanInput,
  type AcademicLessonPlanRecord,
  type AcademicSessionPlanRecord,
  type AcademicSessionPlanUnitRecord,
  type AcademicSyllabusRecord,
  type SessionPlanSyllabusCoverage,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import {
  getTodayBs,
  parseBsDate,
  type NepaliDate,
} from "@munatech/nepali-datepicker";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
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
  joinSubUnitTitles,
  matchSyllabusSubUnit,
  normalizeSubUnitTitles,
  parseSubUnitsFromTopics,
  resolveSubjectSelectValue,
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
  dedupePlansByCurriculum,
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

const normText = (value?: string | null) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** BS YYYY-MM-DD strings compare lexicographically. Empty unit window = always allowed. */
const unitAllowsTeachingDate = (
  unit: Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">,
  teachingDateBs?: string | null,
): boolean => {
  const date = (teachingDateBs || "").trim();
  if (!date) return true;
  const start = (unit.startDateBs || "").trim();
  const end = (unit.endDateBs || "").trim();
  if (!start && !end) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

const formatUnitDateWindow = (
  unit: Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">,
): string => {
  const start = (unit.startDateBs || "").trim();
  const end = (unit.endDateBs || "").trim();
  if (start && end) return `${start} → ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return "no date limit";
};

const formatTodayBs = (): string => {
  const t = getTodayBs();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

const titleKey = (t: string) => t.trim().toLowerCase();

const emptyItem = (
  serialNo: number,
  unit?: AcademicSessionPlanUnitRecord,
  subUnitTitles: string[] = [],
  syllabusMatch?: {
    syllabusId?: string;
    syllabusChapterId?: string;
    syllabusUnitId?: string;
    syllabusSubUnitId?: string;
    syllabusSubUnitIds?: string[];
    learningOutcomes?: string;
    description?: string;
  } | null,
): AcademicLessonPlanInput["items"][number] => {
  const titles = normalizeSubUnitTitles(subUnitTitles);
  const joined = joinSubUnitTitles(titles);
  const ids =
    syllabusMatch?.syllabusSubUnitIds?.filter(Boolean) ||
    (syllabusMatch?.syllabusSubUnitId
      ? [syllabusMatch.syllabusSubUnitId]
      : []);
  return {
    serialNo,
    sessionPlanUnitId: unit?._id ?? "",
    subUnitTitle: joined,
    subUnitTitles: titles,
    syllabusId: syllabusMatch?.syllabusId || unit?.syllabusId || "",
    syllabusChapterId:
      syllabusMatch?.syllabusChapterId || unit?.syllabusChapterId || "",
    syllabusUnitId: syllabusMatch?.syllabusUnitId || "",
    syllabusSubUnitId: ids[0] || syllabusMatch?.syllabusSubUnitId || "",
    syllabusSubUnitIds: ids,
    subjectLabel: unit ? `Unit ${unit.unitNo}` : "",
    plannedTopic: joined
      ? joined
      : unit
        ? unit.chapterName || unit.topicsCovered
        : "",
    description: syllabusMatch?.description || "",
    learningObjectives:
      syllabusMatch?.learningOutcomes || unit?.learningOutcomes || "",
    teachingMethod: "",
    teachingAids: "",
    assessmentMethod: "",
    deadline: "",
    /*
     * Left blank on purpose — a sub-unit sits on one day, and the form fills it
     * from the lesson's teaching date. Seeding the unit's window here would make
     * a new row look like it spans the whole unit.
     */
    itemStartDateBs: "",
    itemEndDateBs: "",
    // One daily plan row = 1 class by default (hours ≠ classes)
    estimatedClasses: 1,
    remarks: "",
  };
};

/** Resolve syllabus matches for multiple selected sub-unit titles. */
const matchMultipleSubUnits = (
  matchedSyllabus: Parameters<typeof matchSyllabusSubUnit>[0],
  chapterId: string | undefined,
  titles: string[],
) => {
  const ids: string[] = [];
  let firstMatch: ReturnType<typeof matchSyllabusSubUnit> = null;
  const outcomes: string[] = [];
  const descriptions: string[] = [];
  for (const title of titles) {
    const match = matchSyllabusSubUnit(matchedSyllabus, {
      syllabusChapterId: chapterId,
      heading: title,
    });
    if (match && !firstMatch) firstMatch = match;
    if (match?.syllabusSubUnitId) ids.push(match.syllabusSubUnitId);
    if (match?.learningOutcomes) outcomes.push(match.learningOutcomes);
    if (match?.description) descriptions.push(match.description);
  }
  return {
    firstMatch,
    syllabusSubUnitIds: ids.filter(
      (id, i, arr) => arr.indexOf(id) === i,
    ),
    learningOutcomes: outcomes.join("\n"),
    description: descriptions.join("\n"),
  };
};

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState("");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  /** Expand optional fields per unit row in the simplified form. */
  const [expandedItemKeys, setExpandedItemKeys] = useState<string[]>([]);
  /** Tracks which session plan already had units auto-selected (so Clear stays cleared). */
  const autoSelectedForPlanRef = useRef<string>("");
  /** Last teachingDate|sessionPlanId key we auto-selected units for (avoid wipe on refetch). */
  const autoSelectUnitsKeyRef = useRef<string>("");
  const formTopRef = useRef<HTMLDivElement | null>(null);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState<string | null>(
    null,
  );
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<HierarchySubjectNode | null>(null);
  const blankForm = (): AcademicLessonPlanInput => ({
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
    month: "",
    teachingDateBs: "",
    startDateBs: "",
    endDateBs: "",
    sessionPlanId: "",
    monthlyDescription: "",
    items: [],
  });
  const [form, setForm] = useState<AcademicLessonPlanInput>(blankForm);

  const resetLessonForm = () => {
    setEditingId(null);
    setForm(blankForm());
    setSelectedUnitIds([]);
    setUnitSearch("");
    setExpandedItemKeys([]);
    autoSelectedForPlanRef.current = "";
    autoSelectUnitsKeyRef.current = "";
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

  // Keep teacherId once teacher scope resolves
  useEffect(() => {
    if (!teacherId) return;
    setForm((current) =>
      current.teacherId === teacherId
        ? current
        : { ...current, teacherId },
    );
  }, [teacherId]);

  // Admin: auto-select sole teacher so session plans resolve for that teacher
  useEffect(() => {
    if (teacherId) return;
    if (teachers.length !== 1) return;
    const onlyId = teachers[0]!._id;
    setForm((current) =>
      current.teacherId ? current : { ...current, teacherId: onlyId },
    );
  }, [teacherId, teachers]);

  // Keep academic year in sync with hub settings (do not stick on placeholder 2082/083)
  useEffect(() => {
    if (!filters.academicYearBs?.trim()) return;
    setForm((current) => {
      const nextYear = filters.academicYearBs!;
      const nextSession = filters.session || nextYear;
      // Update when empty, placeholder, or still matching the previous settings default
      if (
        !current.academicYearBs?.trim() ||
        current.academicYearBs === "2082/083" ||
        current.academicYearBs === filters.academicYearBs
      ) {
        if (
          current.academicYearBs === nextYear &&
          (current.session || "") === nextSession
        ) {
          return current;
        }
        return {
          ...current,
          academicYearBs: nextYear,
          session: nextSession,
        };
      }
      return current;
    });
  }, [filters.academicYearBs, filters.session]);

  /** Teacher for cascade: logged-in teacher, or admin selection — not the hub filter bar. */
  const effectiveTeacherId = teacherId || form.teacherId || "";

  /** Curriculum sibling subject ids for matching session plans. */
  const formCurriculumSubjectIds = useMemo(() => {
    const ids = new Set<string>();
    if (!form.subjectId) return [] as string[];
    ids.add(form.subjectId);
    const fromOption = (selectedFormSubject as { subjectIds?: string[] } | undefined)
      ?.subjectIds;
    for (const id of fromOption ?? []) ids.add(id);

    const selected =
      subjects.find((s) => s._id === form.subjectId) ?? selectedFormSubject;
    if (!selected) return [...ids];

    const keyCode = normText(selected.code);
    const keyName = normText(selected.name);
    const rawMaster = selected.masterSubjectId as
      | string
      | { _id?: string }
      | null
      | undefined;
    const keyMaster =
      typeof rawMaster === "object" && rawMaster
        ? String(rawMaster._id ?? "")
        : rawMaster
          ? String(rawMaster)
          : "";

    for (const s of subjects) {
      if (s._id === form.subjectId) {
        ids.add(s._id);
        continue;
      }
      const sMaster = s.masterSubjectId as
        | string
        | { _id?: string }
        | null
        | undefined;
      const sMasterStr =
        typeof sMaster === "object" && sMaster
          ? String(sMaster._id ?? "")
          : sMaster
            ? String(sMaster)
            : "";
      if (keyMaster && sMasterStr && sMasterStr === keyMaster) {
        ids.add(s._id);
        continue;
      }
      if (keyCode && normText(s.code) === keyCode) {
        ids.add(s._id);
        continue;
      }
      if (keyName && normText(s.name) === keyName) {
        ids.add(s._id);
      }
    }
    return [...ids];
  }, [form.subjectId, selectedFormSubject, subjects]);

  const listParams = useMemo(
    () => academicListApiParams(filters, { isCollege }),
    [filters, isCollege],
  );

  /**
   * Load Session Plans broadly for the form.
   * - No month/status/batch (those empty the list)
   * - No subjectId on the API (curriculum sibling expand can miss; we match client-side)
   * - No academicYearBs on the API (placeholder year was hiding real plans)
   * Teacher scope is still applied server-side for TEACHER users.
   */
  const sessionPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "session-plans-for-lesson",
      "all-for-form",
      // Invalidate when teacher scope / selection changes
      teacherId || form.teacherId || "any-teacher",
    ],
    queryFn: async () => {
      // Optional teacher pin for admin; teachers are scoped on the server
      const params: Record<string, string> = {};
      if (effectiveTeacherId) params.teacherId = effectiveTeacherId;
      return unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", { params }),
      );
    },
    enabled: showForm,
  });

  /**
   * Match Session Plans to the selected subject by:
   * 1) curriculum subject instance ids
   * 2) subject name / code (covers missing siblings in the subjects list)
   * Prefer same academic year; if none, still show matching subject plans.
   */
  const usableSessionPlans = useMemo(() => {
    const all = (sessionPlansQuery.data ?? []).filter(
      (plan) => plan.status !== "REJECTED",
    );
    if (!form.subjectId) return all;

    const subjectSet = new Set(formCurriculumSubjectIds);
    const selectedName = normText(selectedFormSubject?.name);
    const selectedCode = normText(selectedFormSubject?.code);
    // Names/codes for every sibling instance we know
    const siblingNames = new Set<string>();
    const siblingCodes = new Set<string>();
    for (const s of subjects) {
      if (subjectSet.has(s._id)) {
        if (normText(s.name)) siblingNames.add(normText(s.name));
        if (normText(s.code)) siblingCodes.add(normText(s.code));
      }
    }
    if (selectedName) siblingNames.add(selectedName);
    if (selectedCode) siblingCodes.add(selectedCode);

    const matched = all.filter((plan) => {
      if (effectiveTeacherId && plan.teacherId !== effectiveTeacherId) {
        return false;
      }
      if (subjectSet.has(plan.subjectId)) return true;
      const planName = normText(plan.subject?.name);
      const planCode = normText(plan.subject?.code);
      if (planName && siblingNames.has(planName)) return true;
      if (planCode && siblingCodes.has(planCode)) return true;
      // Last resort: plan subject id appears on any subject with same name as selection
      if (selectedName) {
        const planSubjectRow = subjects.find((s) => s._id === plan.subjectId);
        if (planSubjectRow && normText(planSubjectRow.name) === selectedName) {
          return true;
        }
      }
      return false;
    });

    const formYear = (
      form.academicYearBs ||
      filters.academicYearBs ||
      ""
    ).trim();
    if (!formYear) return matched;

    const sameYear = matched.filter(
      (plan) => (plan.academicYearBs || "").trim() === formYear,
    );
    // Prefer same year, but never hide valid subject plans if year strings differ
    return sameYear.length > 0 ? sameYear : matched;
  }, [
    sessionPlansQuery.data,
    form.subjectId,
    form.academicYearBs,
    filters.academicYearBs,
    formCurriculumSubjectIds,
    effectiveTeacherId,
    selectedFormSubject,
    subjects,
  ]);

  // Auto-select the only usable Session Plan when subject/teacher/year change
  useEffect(() => {
    if (!showForm || editingId) return;
    if (
      usableSessionPlans.length === 1 &&
      form.sessionPlanId !== usableSessionPlans[0]!._id
    ) {
      const plan = usableSessionPlans[0]!;
      const starts = plan.units
        .map((u) => u.startDateBs)
        .filter(Boolean) as string[];
      setForm((current) => {
        const defaultTeaching =
          current.teachingDateBs ||
          current.startDateBs ||
          (starts.length ? [...starts].sort()[0]! : "");
        return {
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
          teachingDateBs: defaultTeaching,
          startDateBs: defaultTeaching,
          endDateBs: defaultTeaching,
        };
      });
      // Daily plan: do not pre-select all units — teacher picks units for this day
      autoSelectedForPlanRef.current = plan._id;
      setSelectedUnitIds([]);
    }
  }, [usableSessionPlans, form.sessionPlanId, showForm, teacherId, editingId]);

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

  /** Matching official syllabus for hierarchy auto-link (Chapter → Unit → Sub Unit). */
  const syllabiQuery = useQuery({
    queryKey: [
      "academic-management",
      "syllabi-for-lesson",
      form.subjectId,
      form.academicYearBs,
      selectedFormSubject
        ? ((selectedFormSubject as { subjectIds?: string[] }).subjectIds ?? [
            form.subjectId,
          ]).join(",")
        : form.subjectId,
    ],
    queryFn: async () => {
      // Curriculum-shared: do not pin yearId/batchId; match subject client-side
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

  const matchedSyllabus = useMemo(() => {
    const list = syllabiQuery.data ?? [];
    if (list.length === 0) return null;
    return (
      list.find((s) => s.status === "APPROVED") ||
      list.find((s) => s.status !== "REJECTED") ||
      list[0] ||
      null
    );
  }, [syllabiQuery.data]);

  const plansQuery = useQuery({
    queryKey: ["academic-management", "lesson-plans", listParams],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: listParams,
        }),
      ),
  });

  // Mark session plan as ready once units load
  useEffect(() => {
    if (!form.sessionPlanId || !showForm) return;
    if (autoSelectedForPlanRef.current === form.sessionPlanId) return;
    const loaded = unitsQuery.data ?? coverageQuery.data?.units ?? [];
    if (loaded.length === 0) return;
    autoSelectedForPlanRef.current = form.sessionPlanId;
  }, [
    form.sessionPlanId,
    showForm,
    unitsQuery.data,
    coverageQuery.data?.units,
  ]);

  /**
   * Future schedule rule: teaching date fixes which Session Plan units apply.
   * On create (not continue-draft), auto-select every unit open on that date —
   * only once per date+sessionPlan key so React Query refetches do not wipe
   * manual unchecks / sub-unit work.
   */
  useEffect(() => {
    if (!showForm || editingId) return;
    const teachingDate = form.teachingDateBs || form.startDateBs || "";
    if (!teachingDate || !form.sessionPlanId) return;
    const loaded = unitsQuery.data ?? coverageQuery.data?.units ?? [];
    if (loaded.length === 0) return;
    const key = `${form.sessionPlanId}|${teachingDate}`;
    if (autoSelectUnitsKeyRef.current === key) return;
    autoSelectUnitsKeyRef.current = key;
    const available = loaded
      .filter((u) => unitAllowsTeachingDate(u, teachingDate))
      .map((u) => u._id);
    setSelectedUnitIds(available);
  }, [
    showForm,
    editingId,
    form.teachingDateBs,
    form.startDateBs,
    form.sessionPlanId,
    unitsQuery.data,
    coverageQuery.data?.units,
  ]);

  // Rebuild form items when selected units change — inherit Session Plan + syllabus hierarchy
  useEffect(() => {
    if (!form.sessionPlanId) return;
    if (selectedUnitIds.length === 0) {
      setForm((current) =>
        current.items.length === 0 ? current : { ...current, items: [] },
      );
      return;
    }
    const units = unitsQuery.data ?? coverageQuery.data?.units ?? [];
    // Wait for units to load so Continue-draft does not wipe items
    if (units.length === 0) return;
    const unitMap = new Map(units.map((unit) => [unit._id, unit]));
    setForm((current) => {
      const nextItems = selectedUnitIds
        .map((unitId, index) => {
          const unit = unitMap.get(unitId);
          const prev = current.items.find(
            (item) => item.sessionPlanUnitId === unitId,
          );
          // Keep existing draft row if unit metadata is not yet available
          if (!unit) {
            return prev
              ? { ...prev, serialNo: index + 1 }
              : null;
          }
          const subUnits = parseSubUnitsFromTopics(unit.topicsCovered);
          const prevTitles = normalizeSubUnitTitles(
            prev?.subUnitTitles,
            prev?.subUnitTitle,
          );
          // New unit row: leave sub-units empty so teacher fixes them to this date
          // (remaining / already-planned hints are shown in the UI).
          const defaultTitles = prevTitles.length > 0 ? prevTitles : [];
          const multi = matchMultipleSubUnits(
            matchedSyllabus,
            unit.syllabusChapterId,
            defaultTitles,
          );
          const match = multi.firstMatch;
          const syllabusMatch = match
            ? {
                syllabusId: matchedSyllabus?._id,
                syllabusChapterId:
                  match.syllabusChapterId || unit.syllabusChapterId,
                syllabusUnitId: match.syllabusUnitId,
                syllabusSubUnitId: multi.syllabusSubUnitIds[0] || match.syllabusSubUnitId,
                syllabusSubUnitIds: multi.syllabusSubUnitIds,
                learningOutcomes:
                  multi.learningOutcomes || match.learningOutcomes,
                description: multi.description || match.description,
              }
            : {
                syllabusId: unit.syllabusId || matchedSyllabus?._id || "",
                syllabusChapterId: unit.syllabusChapterId || "",
                syllabusSubUnitIds: multi.syllabusSubUnitIds,
              };
          const joined = joinSubUnitTitles(defaultTitles);
          return {
            ...emptyItem(index + 1, unit, defaultTitles, syllabusMatch),
            ...prev,
            serialNo: index + 1,
            sessionPlanUnitId: unit._id,
            subjectLabel: `Unit ${unit.unitNo}`,
            subUnitTitles: defaultTitles,
            subUnitTitle: joined,
            plannedTopic:
              prev?.plannedTopic ||
              joined ||
              unit.chapterName ||
              unit.topicsCovered,
            syllabusId:
              prev?.syllabusId ||
              syllabusMatch.syllabusId ||
              unit.syllabusId ||
              "",
            syllabusChapterId:
              prev?.syllabusChapterId ||
              syllabusMatch.syllabusChapterId ||
              unit.syllabusChapterId ||
              "",
            syllabusUnitId:
              prev?.syllabusUnitId || match?.syllabusUnitId || "",
            syllabusSubUnitId:
              prev?.syllabusSubUnitId ||
              multi.syllabusSubUnitIds[0] ||
              match?.syllabusSubUnitId ||
              "",
            syllabusSubUnitIds:
              prev?.syllabusSubUnitIds?.length
                ? prev.syllabusSubUnitIds
                : multi.syllabusSubUnitIds,
            // One fixed day per sub-unit: keep what was set, else the teaching date.
            itemStartDateBs:
              prev?.itemStartDateBs || current.teachingDateBs || current.startDateBs || "",
            itemEndDateBs:
              prev?.itemStartDateBs || current.teachingDateBs || current.startDateBs || "",
            learningObjectives:
              prev?.learningObjectives ||
              multi.learningOutcomes ||
              match?.learningOutcomes ||
              unit.learningOutcomes ||
              "",
            estimatedClasses: prev?.estimatedClasses || 1,
          };
        })
        .filter(Boolean) as AcademicLessonPlanInput["items"];

      // Daily plan: keep a single teaching day (do not expand to unit date ranges)
      const teaching =
        current.teachingDateBs || current.startDateBs || current.endDateBs || "";
      return {
        ...current,
        items: nextItems,
        teachingDateBs: teaching,
        startDateBs: teaching,
        endDateBs: teaching,
      };
    });
  }, [
    selectedUnitIds,
    unitsQuery.data,
    coverageQuery.data?.units,
    form.sessionPlanId,
    matchedSyllabus,
  ]);

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLessonPlanInput) =>
      unwrap(api.post("/academic-management/lesson-plans", payload)),
    onSuccess: () => {
      toast.success("Lesson plan saved as draft");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetLessonForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: AcademicLessonPlanInput;
    }) => unwrap(api.put(`/academic-management/lesson-plans/${id}`, payload)),
    onSuccess: () => {
      toast.success("Draft lesson plan updated");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetLessonForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const openContinueDraft = (plan: AcademicLessonPlanRecord) => {
    const teaching =
      plan.teachingDateBs || plan.startDateBs || plan.endDateBs || "";
    const unitIds = plan.items
      .map((item) => item.sessionPlanUnitId)
      .filter((id): id is string => Boolean(id));
    autoSelectedForPlanRef.current = plan.sessionPlanId || "";
    autoSelectUnitsKeyRef.current = `${plan.sessionPlanId || ""}|${teaching}`;
    setEditingId(plan._id);
    setSelectedUnitIds(unitIds);
    setExpandedItemKeys([]);
    setUnitSearch("");
    setForm({
      academicYearBs: plan.academicYearBs || filters.academicYearBs || "",
      session: plan.session || plan.academicYearBs || "",
      faculty: plan.faculty || "",
      semesterBs: plan.semesterBs || "",
      classId: plan.classId,
      sectionId: plan.sectionId,
      batchId: plan.batchId,
      yearId: plan.yearId,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId || teacherId || "",
      month: plan.month || "",
      teachingDateBs: teaching,
      startDateBs: teaching,
      endDateBs: teaching,
      sessionPlanId: plan.sessionPlanId || "",
      monthlyDescription: plan.monthlyDescription || "",
      items: plan.items.map((item, index) => {
        const titles = normalizeSubUnitTitles(
          item.subUnitTitles,
          item.subUnitTitle,
        );
        return {
          serialNo: item.serialNo || index + 1,
          sessionPlanUnitId: item.sessionPlanUnitId || "",
          subUnitTitle: joinSubUnitTitles(titles) || item.subUnitTitle || "",
          subUnitTitles: titles,
          syllabusId: item.syllabusId || item.unit?.syllabusId || "",
          syllabusChapterId:
            item.syllabusChapterId || item.unit?.syllabusChapterId || "",
          syllabusUnitId: item.syllabusUnitId || item.unit?.syllabusUnitId || "",
          syllabusSubUnitId: item.syllabusSubUnitId || "",
          syllabusSubUnitIds: item.syllabusSubUnitIds ?? [],
          subjectLabel:
            item.subjectLabel ||
            (item.unit ? `Unit ${item.unit.unitNo}` : ""),
          plannedTopic: item.plannedTopic || "",
          description: item.description || "",
          learningObjectives: item.learningObjectives || "",
          teachingMethod: item.teachingMethod || "",
          teachingAids: item.teachingAids || "",
          assessmentMethod: item.assessmentMethod || "",
          deadline: item.deadline || "",
          // Reopening a draft: keep the stored day, else the plan's teaching date.
          itemStartDateBs: item.itemStartDateBs || teaching || "",
          itemEndDateBs: item.itemStartDateBs || teaching || "",
          estimatedClasses: item.estimatedClasses || 1,
          remarks: item.remarks || "",
        };
      }),
    });
    setShowForm(true);
    requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    toast.message("Continue editing this draft");
  };

  const saveLessonPlan = () => {
    if (!form.sessionPlanId || form.items.length === 0) {
      toast.error("Select a Session Plan and at least one unit before saving");
      return;
    }
    const sessionPlan = usableSessionPlans.find(
      (p) => p._id === form.sessionPlanId,
    );
    // Teacher must match Session Plan — fall back to the plan’s teacher
    const resolvedTeacherId =
      teacherId ||
      form.teacherId ||
      sessionPlan?.teacherId ||
      "";
    const teachingDate = form.teachingDateBs || form.startDateBs || "";
    if (!teachingDate) {
      toast.error("Select the teaching date (BS)");
      return;
    }
    if (!resolvedTeacherId) {
      toast.error("Teacher is required — select a teacher or Session Plan");
      return;
    }
    if (
      sessionPlan?.teacherId &&
      resolvedTeacherId !== sessionPlan.teacherId
    ) {
      toast.error(
        "Selected teacher does not match the Session Plan teacher. Use the same teacher as the Session Plan.",
      );
      return;
    }
    const outOfWindow = form.items
      .map((item) => units.find((u) => u._id === item.sessionPlanUnitId))
      .filter(
        (unit): unit is AcademicSessionPlanUnitRecord =>
          Boolean(unit) && !unitAllowsTeachingDate(unit!, teachingDate),
      );
    if (outOfWindow.length > 0) {
      const u = outOfWindow[0]!;
      toast.error(
        `Unit ${u.unitNo} (${u.chapterName}) is scheduled ${formatUnitDateWindow(u)}. Teaching date ${teachingDate} is outside that range.`,
      );
      return;
    }
    const missingSubs = form.items.filter((item) => {
      const unit = units.find((u) => u._id === item.sessionPlanUnitId);
      const available = parseSubUnitsFromTopics(unit?.topicsCovered);
      if (available.length === 0) return false;
      const selected = normalizeSubUnitTitles(
        item.subUnitTitles,
        item.subUnitTitle,
      );
      return selected.length === 0;
    });
    if (missingSubs.length > 0) {
      toast.error(
        "Assign at least one sub-unit to each selected unit for this teaching date.",
      );
      return;
    }
    if (teachingDate < formatTodayBs()) {
      toast.message(
        "Note: this teaching date is in the past. Prefer future dates for scheduling.",
      );
    }

    // Sanitize payload so empty optionals / NaN classes never cause API 400s
    const sanitizedItems = form.items.map((item, index) => {
      const unit = units.find((u) => u._id === item.sessionPlanUnitId);
      const titles = normalizeSubUnitTitles(
        item.subUnitTitles,
        item.subUnitTitle,
      );
      const joined = joinSubUnitTitles(titles);
      const plannedTopic = (
        item.plannedTopic ||
        joined ||
        unit?.chapterName ||
        unit?.topicsCovered ||
        `Unit ${item.serialNo || index + 1}`
      ).trim();
      const estimatedClasses =
        Number.isFinite(item.estimatedClasses) && item.estimatedClasses >= 1
          ? Math.round(item.estimatedClasses)
          : 1;
      const subUnitDate =
        item.itemStartDateBs?.trim() ||
        teachingDate ||
        unit?.startDateBs ||
        "";
      return {
        serialNo: item.serialNo || index + 1,
        sessionPlanUnitId: item.sessionPlanUnitId,
        subUnitTitle: joined || item.subUnitTitle || "",
        subUnitTitles: titles,
        syllabusId: item.syllabusId?.trim() || "",
        syllabusChapterId: item.syllabusChapterId?.trim() || "",
        syllabusUnitId: item.syllabusUnitId?.trim() || "",
        syllabusSubUnitId: item.syllabusSubUnitId?.trim() || "",
        syllabusSubUnitIds: (item.syllabusSubUnitIds ?? []).filter(Boolean),
        subjectLabel:
          item.subjectLabel ||
          (unit ? `Unit ${unit.unitNo}` : `Unit ${index + 1}`),
        plannedTopic,
        description: item.description || "",
        learningObjectives: item.learningObjectives || "",
        teachingMethod: item.teachingMethod || "",
        teachingAids: item.teachingAids || "",
        assessmentMethod: item.assessmentMethod || "",
        deadline: item.deadline || "",
        /*
         * A sub-unit sits on ONE day. Both stored fields carry that same date —
         * untouched rows fall back to the lesson's teaching date rather than
         * spanning the unit's whole window.
         */
        itemStartDateBs: subUnitDate,
        itemEndDateBs: subUnitDate,
        estimatedClasses,
        remarks: item.remarks || "",
      };
    });

    const payload: AcademicLessonPlanInput = {
      academicYearBs: form.academicYearBs,
      session: form.session || form.academicYearBs,
      faculty: form.faculty || undefined,
      semesterBs: form.semesterBs || undefined,
      classId: form.classId || undefined,
      sectionId: form.sectionId || undefined,
      batchId: form.batchId || undefined,
      yearId: form.yearId || undefined,
      subjectId: form.subjectId,
      teacherId: resolvedTeacherId,
      month: form.month || "",
      teachingDateBs: teachingDate,
      startDateBs: teachingDate,
      endDateBs: teachingDate,
      sessionPlanId: form.sessionPlanId,
      monthlyDescription: form.monthlyDescription || "",
      items: sanitizedItems,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/submit`)),
    onSuccess: () => {
      toast.success("Lesson plan submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  /**
   * Soft-deletes on the server and resyncs unit / session progress, so the
   * removed day stops counting towards Session Plan coverage.
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academic-management/lesson-plans/${id}`)),
    onSuccess: () => {
      toast.success("Lesson plan deleted");
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
    const matched = recordsForCurriculumSubject(
      filteredPlans,
      selectedSubject.subjectIds,
      selectedYearKey,
      yearIdToLevelKey,
      isCollege,
    );
    // Collapse batch-instance duplicates; keep separate plans per teacher
    return dedupePlansByCurriculum(matched, subjects, true);
  }, [
    filteredPlans,
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
    return filteredPlans;
  }, [selectedSubject, selectedPlans, filteredPlans]);

  const units = unitsQuery.data ?? coverageQuery.data?.units ?? [];

  /**
   * Outer bounds of the Session Plan: earliest unit start → latest unit end.
   *
   * The teaching date picker is clamped to this so a teacher cannot choose a day
   * the Session Plan does not cover. Per-unit windows are narrower still and are
   * enforced by the API; this only stops the obviously-out-of-range picks before
   * a save round-trip. Units with no dates set leave the corresponding bound open.
   */
  const sessionPlanDateBounds = useMemo(() => {
    const open: {
      minBs: string;
      maxBs: string;
      minDate?: NepaliDate;
      maxDate?: NepaliDate;
    } = { minBs: "", maxBs: "" };
    if (units.length === 0) return open;
    let min = "";
    let max = "";
    for (const unit of units) {
      const start = (unit.startDateBs || "").trim();
      const end = (unit.endDateBs || "").trim();
      /*
       * A unit with no window is unconstrained server-side, so one dateless unit
       * means the whole picker has to stay open — clamping to the units that do
       * have dates would block a legitimately schedulable day.
       */
      if (!start || !end) return open;
      if (!min || start < min) min = start;
      if (!max || end > max) max = end;
    }
    return {
      minBs: min,
      maxBs: max,
      minDate: parseBsDate(min) ?? undefined,
      maxDate: parseBsDate(max) ?? undefined,
    };
  }, [units]);

  const teachingDateForForm =
    form.teachingDateBs || form.startDateBs || "";
  const todayBs = useMemo(() => formatTodayBs(), []);
  const teachingDateIsPast =
    Boolean(teachingDateForForm) && teachingDateForForm < todayBs;

  /** Sub-units already fixed on other Lesson Plan dates (same Session Plan). */
  const plannedSubUnitSchedule = useMemo(() => {
    const byUnit = new Map<
      string,
      Array<{ title: string; dateBs: string; planId: string }>
    >();
    for (const plan of plansQuery.data ?? []) {
      if (editingId && plan._id === editingId) continue;
      if (
        form.sessionPlanId &&
        plan.sessionPlanId &&
        plan.sessionPlanId !== form.sessionPlanId
      ) {
        continue;
      }
      if (
        form.subjectId &&
        plan.subjectId &&
        plan.subjectId !== form.subjectId
      ) {
        // still allow if same curriculum teacher year — subject filter is soft
      }
      const dateBs =
        plan.teachingDateBs || plan.startDateBs || plan.endDateBs || "";
      for (const item of plan.items) {
        const unitId = item.sessionPlanUnitId || "";
        if (!unitId) continue;
        const titles = normalizeSubUnitTitles(
          item.subUnitTitles,
          item.subUnitTitle,
        );
        const rows = byUnit.get(unitId) ?? [];
        for (const title of titles) {
          rows.push({ title, dateBs, planId: plan._id });
        }
        byUnit.set(unitId, rows);
      }
    }
    return byUnit;
  }, [
    plansQuery.data,
    editingId,
    form.sessionPlanId,
    form.subjectId,
  ]);

  const futureScheduleForSession = useMemo(() => {
    if (!form.sessionPlanId) return [];
    return (plansQuery.data ?? [])
      .filter((p) => p.sessionPlanId === form.sessionPlanId)
      .map((p) => ({
        plan: p,
        dateBs: p.teachingDateBs || p.startDateBs || p.endDateBs || "",
      }))
      .sort((a, b) => a.dateBs.localeCompare(b.dateBs));
  }, [plansQuery.data, form.sessionPlanId]);

  const unitsAvailableToday = useMemo(
    () =>
      units.filter((unit) =>
        unitAllowsTeachingDate(unit, teachingDateForForm),
      ),
    [units, teachingDateForForm],
  );
  const filteredUnits = useMemo(() => {
    const q = unitSearch.toLowerCase().trim();
    const list = teachingDateForForm ? unitsAvailableToday : units;
    if (!q) return list;
    return list.filter(
      (unit) =>
        String(unit.unitNo).includes(q) ||
        unit.chapterName.toLowerCase().includes(q) ||
        (unit.topicsCovered || "").toLowerCase().includes(q),
    );
  }, [unitSearch, units, unitsAvailableToday, teachingDateForForm]);

  const unitsOutOfWindow = useMemo(() => {
    if (!teachingDateForForm) return [];
    return units.filter(
      (unit) => !unitAllowsTeachingDate(unit, teachingDateForForm),
    );
  }, [units, teachingDateForForm]);

  const toggleUnit = (unitId: string) => {
    const unit = units.find((u) => u._id === unitId);
    if (
      unit &&
      teachingDateForForm &&
      !unitAllowsTeachingDate(unit, teachingDateForForm)
    ) {
      toast.error(
        `Unit ${unit.unitNo} is scheduled ${formatUnitDateWindow(unit)}. Teaching date ${teachingDateForForm} is outside that range.`,
      );
      return;
    }
    setSelectedUnitIds((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId],
    );
  };

  const selectAllSessionUnits = () => {
    const available = teachingDateForForm ? unitsAvailableToday : units;
    if (available.length === 0) {
      toast.message(
        teachingDateForForm
          ? "No Session Plan units allow this teaching date"
          : "No units on this Session Plan",
      );
      return;
    }
    setSelectedUnitIds(available.map((u) => u._id));
    toast.success(
      `Selected ${available.length} unit${available.length === 1 ? "" : "s"} available for this day`,
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
            Plan teaching <strong>in advance</strong>. Units and sub-units are
            fixed by the Session Plan date windows — pick a future date, then
            assign which sub-units fall on that day.
          </p>
        </div>
        {canMutate ? (
          <Button
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                resetLessonForm();
                return;
              }
              resetLessonForm();
              setShowForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {showForm ? "Close form" : "Schedule future day"}
          </Button>
        ) : null}
      </div>

      {showForm && canMutate ? (
        <div ref={formTopRef}>
        <Card className="no-print border-brand-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle>
              {editingId
                ? "Continue draft schedule"
                : "Schedule a future teaching day"}
            </CardTitle>
            <p className="text-sm text-slate-600">
              <strong>1)</strong> Pick the Session Plan ·{" "}
              <strong>2)</strong> Pick a teaching date inside it ·{" "}
              <strong>3)</strong> Units open on that date load automatically ·{" "}
              <strong>4)</strong> Tick the sub-units taught that day. Save draft;{" "}
              <strong>Continue</strong> next to Submit later.
            </p>
            {editingId ? (
              <Badge className="w-fit bg-amber-100 text-amber-900">
                Editing draft
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {/*
              Step 1 — the Session Plan comes first because everything after it
              depends on it: it fixes the subject and teacher, and its unit
              windows are what bound the teaching date in Step 2. The four fields
              here only narrow the Session Plan list; the plan itself overwrites
              them on selection.
            */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 1 · Session Plan
              </p>
              <p className="text-xs text-slate-500">
                Pick the Session Plan this day belongs to. Subject, teacher, and
                the allowed dates all come from it — the fields below just narrow
                the list.
              </p>
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
                        sessionPlanId: "",
                      }));
                      setSelectedUnitIds([]);
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
                        sessionPlanId: "",
                      }));
                      setSelectedUnitIds([]);
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
                      sessionPlanId: "",
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
                        sessionPlanId: "",
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

              <FormField label="Session Plan *">
                <Select
                  value={form.sessionPlanId}
                  disabled={Boolean(editingId)}
                  onChange={(event) => {
                    const plan = usableSessionPlans.find(
                      (row) => row._id === event.target.value,
                    );
                    const starts = (plan?.units ?? [])
                      .map((u) => u.startDateBs)
                      .filter(Boolean) as string[];
                    autoSelectedForPlanRef.current = event.target.value || "";
                    // Daily plan: teacher chooses units for this day (not all units)
                    setSelectedUnitIds([]);
                    const fromUnits =
                      starts.length ? [...starts].sort()[0]! : "";
                    setForm((current) => {
                      const defaultTeaching =
                        current.teachingDateBs ||
                        current.startDateBs ||
                        fromUnits ||
                        "";
                      return {
                        ...current,
                        sessionPlanId: event.target.value,
                        academicYearBs:
                          plan?.academicYearBs || current.academicYearBs,
                        session: plan?.session || current.session,
                        faculty: plan?.faculty || current.faculty,
                        yearId: plan?.yearId || current.yearId,
                        classId: plan?.classId || current.classId,
                        batchId: plan?.batchId || current.batchId,
                        subjectId: plan?.subjectId || current.subjectId,
                        teacherId:
                          plan?.teacherId ||
                          current.teacherId ||
                          teacherId ||
                          "",
                        teachingDateBs: defaultTeaching,
                        startDateBs: defaultTeaching,
                        endDateBs: defaultTeaching,
                      };
                    });
                    if (plan?.units?.length) {
                      toast.success(
                        `Session Plan loaded (${plan.units.length} units). Pick units for this teaching day.`,
                      );
                    }
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
                      {plan.subject?.name ?? "Subject"} ·{" "}
                      {plan.teacher?.user?.fullName
                        ? `${plan.teacher.user.fullName} · `
                        : ""}
                      {plan.academicYearBs} · {plan.status} (
                      {plan.units.length} units)
                    </option>
                  ))}
                </Select>
                {!sessionPlansQuery.isLoading &&
                form.subjectId &&
                usableSessionPlans.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No matching Session Plan for this subject
                    {effectiveTeacherId ? " and teacher" : ""}. Create a Session
                    Plan first (draft is enough), using the same academic year
                    and subject.
                  </p>
                ) : null}
              </FormField>
            </div>

            {/* Step 2 — the date, now bounded by the plan chosen above */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 2 · Teaching date
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Teaching date (BS) *">
                  <NepaliDateField
                    value={form.teachingDateBs || form.startDateBs || ""}
                    minDate={sessionPlanDateBounds.minDate}
                    maxDate={sessionPlanDateBounds.maxDate}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        teachingDateBs: value,
                        startDateBs: value,
                        endDateBs: value,
                      }))
                    }
                    placeholder={
                      form.sessionPlanId
                        ? "Pick a day inside the plan"
                        : "Choose a Session Plan first"
                    }
                  />
                  {!form.sessionPlanId ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Choose a Session Plan in Step 1 — it decides which dates
                      are available here.
                    </p>
                  ) : sessionPlanDateBounds.minBs &&
                    sessionPlanDateBounds.maxBs ? (
                    <p className="mt-1 text-xs text-slate-500">
                      This Session Plan runs{" "}
                      <strong>{sessionPlanDateBounds.minBs}</strong> →{" "}
                      <strong>{sessionPlanDateBounds.maxBs}</strong>. Today BS:{" "}
                      {todayBs}.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Units are fixed by Session Plan start–end for this date.
                      Prefer a future date (today BS: {todayBs}).
                    </p>
                  )}
                  {teachingDateIsPast ? (
                    <p className="mt-1 text-xs text-amber-700">
                      This date is in the past. Lesson plans are meant for future
                      scheduling.
                    </p>
                  ) : null}
                </FormField>
                <FormField label="Day notes (optional)">
                  <Input
                    value={form.monthlyDescription ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthlyDescription: event.target.value,
                      }))
                    }
                    placeholder="Optional short note for this day"
                  />
                </FormField>
              </div>
            </div>

            {form.sessionPlanId && futureScheduleForSession.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fixed schedule (this Session Plan)
                </p>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Date</th>
                        <th className="px-2 py-1.5 text-left font-medium">Units / sub-units</th>
                        <th className="px-2 py-1.5 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {futureScheduleForSession.map(({ plan, dateBs }) => (
                        <tr
                          key={plan._id}
                          className={
                            dateBs === teachingDateForForm
                              ? "bg-brand-50/60"
                              : "border-t border-slate-100"
                          }
                        >
                          <td className="px-2 py-1.5 whitespace-nowrap font-medium text-slate-800">
                            {dateBs || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">
                            {plan.items
                              .map((item) => {
                                const subs = normalizeSubUnitTitles(
                                  item.subUnitTitles,
                                  item.subUnitTitle,
                                );
                                const unitLabel = item.unit
                                  ? `U${item.unit.unitNo}`
                                  : item.subjectLabel || "Unit";
                                return subs.length > 0
                                  ? `${unitLabel}: ${subs.join(", ")}`
                                  : unitLabel;
                              })
                              .join(" · ")}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge className={statusBadgeClass(plan.status)}>
                              {plan.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {form.sessionPlanId ? (
              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step 3 · Units fixed for this date
                  </p>
                  {teachingDateForForm ? (
                    <span className="text-xs text-slate-600">
                      {unitsAvailableToday.length} unit
                      {unitsAvailableToday.length === 1 ? "" : "s"} open on{" "}
                      {teachingDateForForm}
                      {unitsOutOfWindow.length > 0
                        ? ` · ${unitsOutOfWindow.length} outside window (hidden)`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  Only Session Plan units whose start–end includes this teaching
                  date appear. They are selected automatically for this day —
                  uncheck any you will not cover today.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      value={unitSearch}
                      onChange={(event) => setUnitSearch(event.target.value)}
                      placeholder="Search unit…"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllSessionUnits}
                  >
                    Select all for date
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedUnitIds([])}
                  >
                    Clear
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {filteredUnits.length === 0 ? (
                    <p className="col-span-full rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                      {teachingDateForForm
                        ? "No units are scheduled for this date on the Session Plan. Pick a date inside a unit’s start–end window."
                        : "Pick a future teaching date to load fixed units."}
                    </p>
                  ) : (
                    filteredUnits.map((unit) => {
                      const selected = selectedUnitIds.includes(unit._id);
                      const subs = parseSubUnitsFromTopics(unit.topicsCovered);
                      const scheduled = plannedSubUnitSchedule.get(unit._id) ?? [];
                      const scheduledCount = new Set(
                        scheduled.map((s) => titleKey(s.title)),
                      ).size;
                      return (
                        <button
                          key={unit._id}
                          type="button"
                          onClick={() => toggleUnit(unit._id)}
                          className={`rounded-xl border p-3 text-left transition ${
                            selected
                              ? "border-brand-500 bg-brand-50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                selected
                                  ? "border-brand-600 bg-brand-600 text-white"
                                  : "border-slate-300"
                              }`}
                            >
                              {selected ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 text-sm">
                                Unit {unit.unitNo}: {unit.chapterName}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-600">
                                Fixed window: {formatUnitDateWindow(unit)}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {subs.length} sub-unit
                                {subs.length === 1 ? "" : "s"}
                                {scheduledCount > 0
                                  ? ` · ${scheduledCount} already dated`
                                  : " · none dated yet"}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {form.sessionPlanId && form.items.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Step 4 · Fix sub-units on{" "}
                  {form.teachingDateBs || form.startDateBs || "this day"}
                </p>
                <p className="text-xs text-slate-500">
                  Sub-units come from the Session Plan. Tick which ones are
                  taught on this date. Ones already fixed on another day are
                  marked — leave them for that day or reassign carefully.
                </p>
                {form.items.map((item, index) => {
                  const unit = units.find(
                    (u) => u._id === item.sessionPlanUnitId,
                  );
                  const subUnits = parseSubUnitsFromTopics(unit?.topicsCovered);
                  /** Bounds every date on this row is held to. */
                  const unitWindowMin = unit?.startDateBs
                    ? (parseBsDate(unit.startDateBs) ?? undefined)
                    : undefined;
                  const unitWindowMax = unit?.endDateBs
                    ? (parseBsDate(unit.endDateBs) ?? undefined)
                    : undefined;
                  const itemKey = item.sessionPlanUnitId || String(index);
                  const expanded = expandedItemKeys.includes(itemKey);
                  const selectedTitles = normalizeSubUnitTitles(
                    item.subUnitTitles,
                    item.subUnitTitle,
                  );
                  const scheduledRows =
                    plannedSubUnitSchedule.get(item.sessionPlanUnitId || "") ??
                    [];
                  const scheduledByTitle = new Map<string, string[]>();
                  for (const row of scheduledRows) {
                    const k = titleKey(row.title);
                    const dates = scheduledByTitle.get(k) ?? [];
                    if (row.dateBs && !dates.includes(row.dateBs)) {
                      dates.push(row.dateBs);
                    }
                    scheduledByTitle.set(k, dates);
                  }
                  const remainingSubs = subUnits.filter(
                    (t) => !scheduledByTitle.has(titleKey(t)),
                  );
                  const applySubUnitTitles = (titles: string[]) => {
                    const multi = matchMultipleSubUnits(
                      matchedSyllabus,
                      unit?.syllabusChapterId || item.syllabusChapterId,
                      titles,
                    );
                    const match = multi.firstMatch;
                    const joined = joinSubUnitTitles(titles);
                    setForm((current) => ({
                      ...current,
                      items: current.items.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              subUnitTitles: titles,
                              subUnitTitle: joined,
                              plannedTopic:
                                joined || unit?.chapterName || row.plannedTopic,
                              syllabusId:
                                matchedSyllabus?._id ||
                                unit?.syllabusId ||
                                row.syllabusId ||
                                "",
                              syllabusChapterId:
                                match?.syllabusChapterId ||
                                unit?.syllabusChapterId ||
                                row.syllabusChapterId ||
                                "",
                              syllabusUnitId:
                                match?.syllabusUnitId ||
                                row.syllabusUnitId ||
                                "",
                              syllabusSubUnitId:
                                multi.syllabusSubUnitIds[0] || "",
                              syllabusSubUnitIds: multi.syllabusSubUnitIds,
                              learningObjectives:
                                multi.learningOutcomes ||
                                row.learningObjectives,
                              description:
                                multi.description || row.description,
                            }
                          : row,
                      ),
                    }));
                  };
                  return (
                    <div
                      key={itemKey}
                      className="rounded-xl border border-slate-200 bg-white p-3 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900 text-sm">
                            {unit
                              ? `Unit ${unit.unitNo}: ${unit.chapterName}`
                              : item.subjectLabel || `Unit ${index + 1}`}
                          </p>
                          <p className="text-xs text-slate-500">
                            Session window:{" "}
                            {unit
                              ? formatUnitDateWindow(unit)
                              : "—"}{" "}
                            · Fixed on:{" "}
                            {form.teachingDateBs || form.startDateBs || "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                            Classes
                            <NumberInput
                              className="w-16 h-8"
                              min={1}
                              value={item.estimatedClasses}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "estimatedClasses",
                                  event.target.valueAsNumber || 1,
                                )
                              }
                            />
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpandedItemKeys((current) =>
                                current.includes(itemKey)
                                  ? current.filter((k) => k !== itemKey)
                                  : [...current, itemKey],
                              )
                            }
                          >
                            {expanded ? (
                              <>
                                <ChevronUp className="mr-1 h-3.5 w-3.5" />
                                Less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="mr-1 h-3.5 w-3.5" />
                                More
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      <FormField label="Sub-units fixed for this date">
                        {subUnits.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {subUnits.map((title) => {
                                const on = selectedTitles.some(
                                  (t) => titleKey(t) === titleKey(title),
                                );
                                const otherDates =
                                  scheduledByTitle.get(titleKey(title)) ?? [];
                                return (
                                  <button
                                    key={title}
                                    type="button"
                                    onClick={() => {
                                      const titles = on
                                        ? selectedTitles.filter(
                                            (t) =>
                                              titleKey(t) !== titleKey(title),
                                          )
                                        : [...selectedTitles, title];
                                      applySubUnitTitles(titles);
                                    }}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                      on
                                        ? "border-brand-600 bg-brand-600 text-white"
                                        : otherDates.length > 0
                                          ? "border-slate-300 bg-slate-100 text-slate-600"
                                          : "border-slate-300 bg-white text-slate-700 hover:border-brand-400"
                                    }`}
                                    title={
                                      otherDates.length > 0
                                        ? `Already planned on: ${otherDates.join(", ")}`
                                        : "Assign to this teaching date"
                                    }
                                  >
                                    {on ? "✓ " : ""}
                                    {title}
                                    {otherDates.length > 0 ? (
                                      <span
                                        className={
                                          on
                                            ? " opacity-90"
                                            : " text-slate-500"
                                        }
                                      >
                                        {" "}
                                        · {otherDates[0]}
                                        {otherDates.length > 1 ? "…" : ""}
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {remainingSubs.length > 0 ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-full text-xs"
                                  onClick={() =>
                                    applySubUnitTitles(remainingSubs)
                                  }
                                >
                                  Assign all remaining ({remainingSubs.length})
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-full text-xs"
                                onClick={() => applySubUnitTitles(subUnits)}
                              >
                                Assign all sub-units
                              </Button>
                              {selectedTitles.length > 0 ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 rounded-full text-xs"
                                  onClick={() => applySubUnitTitles([])}
                                >
                                  Clear
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-700">
                            No sub-units listed on the Session Plan for this unit.
                            Add topics on the Session Plan so they can be fixed by
                            date.
                          </p>
                        )}
                        {selectedTitles.length > 0 ? (
                          <p className="mt-1 text-xs text-emerald-700">
                            Fixed on this date: {selectedTitles.join(" · ")}
                          </p>
                        ) : subUnits.length > 0 ? (
                          <p className="mt-1 text-xs text-amber-700">
                            Select at least one sub-unit to fix on this date.
                          </p>
                        ) : null}
                      </FormField>

                      {expanded ? (
                        <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2">
                          <FormField label="Planned topic label">
                            <Input
                              value={item.plannedTopic}
                              nepali={formNepaliText}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "plannedTopic",
                                  event.target.value,
                                )
                              }
                              placeholder="Auto-filled from sub-units"
                            />
                          </FormField>
                          <FormField label="Learning objectives">
                            <Input
                              value={item.learningObjectives}
                              nepali={formNepaliText}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "learningObjectives",
                                  event.target.value,
                                )
                              }
                              placeholder="Optional"
                            />
                          </FormField>
                          <FormField label="Teaching method">
                            <Input
                              value={item.teachingMethod}
                              nepali={formNepaliText}
                              onChange={(event) =>
                                updateItemField(
                                  index,
                                  "teachingMethod",
                                  event.target.value,
                                )
                              }
                              placeholder="Lecture, demo…"
                            />
                          </FormField>
                          {/*
                            A sub-unit is taught on ONE fixed day, not over a
                            range. The single picker below writes that day to
                            both stored date fields, matching how the lesson plan
                            itself mirrors teachingDateBs into start/end — that
                            keeps the model and the API validation unchanged.
                            It defaults to the lesson's teaching date and can be
                            nudged a day or two, but never outside the unit window.
                          */}
                          <FormField label="Sub-unit date (BS)">
                            <NepaliDateField
                              value={
                                item.itemStartDateBs ||
                                teachingDateForForm ||
                                ""
                              }
                              minDate={unitWindowMin}
                              maxDate={unitWindowMax}
                              onChange={(value) => {
                                updateItemField(index, "itemStartDateBs", value);
                                updateItemField(index, "itemEndDateBs", value);
                              }}
                              placeholder="Defaults to the teaching date"
                            />
                          </FormField>
                          <FormField label="Deadline (BS)">
                            <NepaliDateField
                              value={item.deadline}
                              minDate={unitWindowMin}
                              maxDate={unitWindowMax}
                              onChange={(value) =>
                                updateItemField(index, "deadline", value)
                              }
                              placeholder="Optional"
                            />
                          </FormField>
                          {unit?.startDateBs || unit?.endDateBs ? (
                            <p className="text-xs text-slate-500 sm:col-span-2">
                              Dates above must stay inside the Session Plan
                              window for Unit {unit.unitNo}:{" "}
                              <strong>{formatUnitDateWindow(unit)}</strong>
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : form.sessionPlanId ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Step 2: select at least one unit above to plan sub-units for this
                day.
              </p>
            ) : form.subjectId ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
                {sessionPlansQuery.isLoading ? (
                  <p>Looking for your Session Plan…</p>
                ) : sessionPlansQuery.isError ? (
                  <p>
                    Could not load Session Plans. Check your connection and try
                    again.
                  </p>
                ) : (sessionPlansQuery.data?.length ?? 0) === 0 ? (
                  <p>
                    No Session Plans exist yet. Open the{" "}
                    <strong>Session Plan</strong> tab, create one for this
                    subject (draft is enough), then return here.
                  </p>
                ) : (
                  <>
                    <p>
                      No Session Plan matches{" "}
                      <strong>
                        {selectedFormSubject?.name || "this subject"}
                      </strong>
                      {effectiveTeacherId
                        ? " for the selected teacher"
                        : ""}
                      .
                    </p>
                    <p className="text-xs text-amber-800">
                      Tip: use the same subject name and teacher as on the
                      Session Plan. Found{" "}
                      {sessionPlansQuery.data?.length ?? 0} other plan(s) for
                      different subjects
                      {teacherId ? "" : " / teachers"}.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button
                onClick={() => saveLessonPlan()}
                disabled={
                  !form.sessionPlanId ||
                  form.items.length === 0 ||
                  !form.subjectId ||
                  !(form.teachingDateBs || form.startDateBs) ||
                  !(teacherId || form.teacherId) ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving…"
                  : editingId
                    ? "Update draft"
                    : "Save as draft"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  resetLessonForm();
                }}
              >
                Cancel
              </Button>
              <p className="w-full text-xs text-slate-500">
                Saved plans stay in <strong>Draft</strong> until you press{" "}
                <strong>Submit</strong> on the plan card. Use{" "}
                <strong>Continue</strong> next to Submit to keep editing.
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
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
              description="Schedule future teaching days: pick a date, units open on that date are fixed from the Session Plan, then assign sub-units to that date."
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
                            {(plan.teachingDateBs ||
                              plan.startDateBs ||
                              plan.month) ?? "—"}{" "}
                            · {plan.academicYearBs}
                          </CardTitle>
                          <p className="text-sm text-slate-600">
                            {plan.teacher?.user?.fullName}
                            {plan.month ? ` · ${plan.month}` : ""} · Topics:{" "}
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
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openContinueDraft(plan)}
                                >
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Continue
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => submitMutation.mutate(plan._id)}
                                  disabled={submitMutation.isPending}
                                >
                                  <Send className="mr-2 h-4 w-4" />
                                  Submit
                                </Button>
                              </>
                            ) : null}
                            {/* Admins may remove an approved plan too; teachers
                                only while it is still editable (DRAFT/REJECTED),
                                which is what the API enforces. */}
                            {isAdmin ||
                            plan.status === "DRAFT" ||
                            plan.status === "REJECTED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                disabled={deleteMutation.isPending}
                                onClick={() => {
                                  const dateLabel =
                                    plan.teachingDateBs ||
                                    plan.startDateBs ||
                                    plan.month ||
                                    "this day";
                                  if (
                                    !window.confirm(
                                      `Delete the lesson plan for ${dateLabel}?\n\nIts topics stop counting towards Session Plan coverage. This cannot be undone from here.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  deleteMutation.mutate(plan._id);
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
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

      {/*
        Print / PDF area — deliberately mirrors the Session Plan report so the
        two documents file together: same table rules, same column treatment,
        repeating header row across pages.
      */}
      <div
        id="lesson-plan-print-area"
        className="hidden print:block"
        style={{ background: "#ffffff", color: "#0f172a", width: "100%" }}
      >
        <style>
          {`
            #lesson-plan-print-area .lp-print-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              font-size: 11px;
              line-height: 1.35;
              color: #0f172a;
            }
            #lesson-plan-print-area .lp-print-table thead {
              display: table-header-group;
            }
            #lesson-plan-print-area .lp-print-table tr {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            #lesson-plan-print-area .lp-print-table th,
            #lesson-plan-print-area .lp-print-table td {
              border: 1px solid #94a3b8 !important;
              padding: 5px 6px;
              vertical-align: top;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            #lesson-plan-print-area .lp-print-table thead th,
            #lesson-plan-print-area .lp-print-table th {
              background: transparent !important;
              background-color: transparent !important;
              color: #0f172a !important;
              font-weight: 700 !important;
              text-align: center;
              white-space: nowrap;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            #lesson-plan-print-area .lp-print-table td.lp-num {
              text-align: center;
              white-space: nowrap;
            }
            #lesson-plan-print-area .lp-print-table td.lp-text {
              text-align: left;
            }
            #lesson-plan-print-area .lp-print-meta {
              margin: 0 0 6px;
              font-size: 12px;
              line-height: 1.4;
            }
            #lesson-plan-print-area .lp-print-section {
              margin-bottom: 14px;
              page-break-inside: auto;
              break-inside: auto;
            }
          `}
        </style>
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
        {printPlans.length === 0 ? (
          <p className="text-sm text-slate-600">No lesson plans to export.</p>
        ) : (
          groupByTeacher(printPlans).map((group) => (
            <div key={group.teacherId} className="lp-print-section">
              <h3
                className="lp-print-meta"
                style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}
              >
                Teacher: {group.teacherName}
              </h3>
              {group.items.map((plan) => (
                <div key={plan._id} className="lp-print-section">
                  <p className="lp-print-meta" style={{ fontWeight: 600 }}>
                    Subject: {plan.subject?.name ?? "—"}
                    {plan.subject?.code ? ` (${plan.subject.code})` : ""} ·
                    Teaching Date:{" "}
                    {plan.teachingDateBs || plan.startDateBs || plan.month || "—"}{" "}
                    · Status: {plan.status}
                  </p>
                  {plan.monthlyDescription ? (
                    <p className="lp-print-meta" style={{ color: "#475569" }}>
                      {plan.monthlyDescription}
                    </p>
                  ) : null}
                  <table className="lp-print-table">
                    <colgroup>
                      <col style={{ width: "5%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "28%" }} />
                      <col style={{ width: "34%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "17%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>S.N</th>
                        <th>Unit No.</th>
                        <th>Units</th>
                        <th>Sub Units</th>
                        <th>C/Hr</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.items.map((item, itemIndex) => {
                        const subUnits = normalizeSubUnitTitles(
                          item.subUnitTitles,
                          item.subUnitTitle,
                        );
                        return (
                          <tr key={item._id || `${plan._id}-${itemIndex}`}>
                            <td className="lp-num">{itemIndex + 1}</td>
                            <td className="lp-num">
                              {item.unit?.unitNo ?? "—"}
                            </td>
                            <td className="lp-text">
                              {item.unit?.chapterName ||
                                item.subjectLabel ||
                                "—"}
                            </td>
                            <td className="lp-text">
                              {subUnits.length > 0
                                ? subUnits.join(", ")
                                : item.plannedTopic || "—"}
                            </td>
                            <td className="lp-num">
                              {Number.isFinite(item.estimatedClasses)
                                ? item.estimatedClasses
                                : "—"}
                            </td>
                            <td className="lp-text">
                              {item.remarks?.trim() || ""}
                            </td>
                          </tr>
                        );
                      })}
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
