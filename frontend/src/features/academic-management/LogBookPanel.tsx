import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanRecord,
  type AcademicLogBookEntryInput,
  type AcademicLogBookEntryRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { CalendarPlus, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
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
import { cn, parseErrorMessage } from "lib/utils";
import { StickyTableScroll } from "components/ui/StickyTableScroll";
import {
  academicListApiParams,
  dedupeYearsForSelect,
  ensureSubjectInOptions,
  filterSubjectsByClass,
  filterSubjectsByYear,
  joinSubUnitTitles,
  normalizeSubUnitTitles,
  parseSubUnitsFromTopics,
  resolveSubjectSelectValue,
  statusBadgeClass,
} from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";
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
import { SubUnitMultiSelect } from "./SubUnitMultiSelect";

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

const titleKey = (value: string) => value.trim().toLowerCase();
const normText = (value?: string | null) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const formatTp = (value?: string) => {
  if (value === "PRACTICAL") return "P";
  if (value === "BOTH") return "T/P";
  if (value === "THEORY") return "T";
  return "—";
};

const formatTime = (start?: string, end?: string) => {
  const a = (start || "").trim();
  const b = (end || "").trim();
  if (a && b) return `${a}–${b}`;
  return a || b || "—";
};

const parseTimeRange = (
  value: string,
): { startTime?: string; endTime?: string } => {
  const t = value.trim();
  if (!t) return {};
  const parts = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { startTime: parts[0], endTime: parts[1] };
  return { startTime: t };
};

const entryTimeValue = (entry: AcademicLogBookEntryRecord) => {
  const a = (entry.startTime || "").trim();
  const b = (entry.endTime || "").trim();
  if (a && b) return `${a}-${b}`;
  return a || b || "";
};

const entrySubUnits = (entry: AcademicLogBookEntryRecord) =>
  normalizeSubUnitTitles(entry.subUnitTitles, entry.subUnitTitle);

type LessonPlanPick = {
  unitId: string;
  label: string;
  unitNo: string;
  unitName: string;
  dateBs: string;
  lessonPlanId: string;
  lessonPlanItemId: string;
  sessionPlanUnitId: string;
  subUnitTitles: string[];
  teachingMethod: string;
  syllabusId: string;
  syllabusChapterId: string;
  syllabusUnitId: string;
  syllabusSubUnitIds: string[];
  titleToId: Record<string, string>;
};

const lessonPlanDateOf = (plan: AcademicLessonPlanRecord, itemStart?: string) =>
  (itemStart || plan.teachingDateBs || plan.startDateBs || plan.endDateBs || "").trim();

/** Session Plan headings are often already "Unit 1 : …" — do not prefix again. */
const formatLogUnitLabel = (unitNo: string, unitName: string) => {
  const name = unitName.trim();
  if (name && /^unit\s*\d+/i.test(name)) return name.replace(/\s+/g, " ").trim();
  if (unitNo && name) return `Unit ${unitNo}: ${name}`;
  if (unitNo) return `Unit ${unitNo}`;
  return name || "Unit";
};

const cleanDuplicatedUnitLabel = (value?: string) => {
  const s = (value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.replace(
    /^(unit\s*\d+\s*[:.\-]?\s*)(?:unit\s*\d+\s*[:.\-]?\s*)+/i,
    "$1",
  );
};

const flattenLessonPlanPicks = (
  plans: AcademicLessonPlanRecord[],
): LessonPlanPick[] => {
  const out: LessonPlanPick[] = [];
  for (const plan of plans) {
    for (const item of plan.items ?? []) {
      const dateBs = lessonPlanDateOf(plan, item.itemStartDateBs);
      const unitId =
        item.sessionPlanUnitId || item.unit?._id || item._id || "";
      if (!unitId) continue;
      const unitNo =
        item.unit?.unitNo != null ? String(item.unit.unitNo) : "";
      const unitName = (
        item.unit?.chapterName ||
        item.subjectLabel ||
        ""
      ).trim();
      const label = formatLogUnitLabel(unitNo, unitName);
      const subUnitTitles = [
        ...normalizeSubUnitTitles(
          item.subUnitTitles,
          item.subUnitTitle || item.plannedTopic,
        ),
        ...parseSubUnitsFromTopics(item.unit?.topicsCovered),
      ].filter(
        (t, i, arr) => arr.findIndex((x) => titleKey(x) === titleKey(t)) === i,
      );
      const syllabusSubUnitIds = (item.syllabusSubUnitIds ?? [])
        .map((id) => String(id))
        .filter(Boolean);
      if (item.syllabusSubUnitId && !syllabusSubUnitIds.includes(item.syllabusSubUnitId)) {
        syllabusSubUnitIds.unshift(item.syllabusSubUnitId);
      }
      const titleToId: Record<string, string> = {};
      subUnitTitles.forEach((title, index) => {
        const id = syllabusSubUnitIds[index];
        if (id) titleToId[titleKey(title)] = id;
      });
      out.push({
        unitId,
        label,
        unitNo,
        unitName,
        dateBs,
        lessonPlanId: plan._id,
        lessonPlanItemId: item._id,
        sessionPlanUnitId: item.sessionPlanUnitId || item.unit?._id || "",
        subUnitTitles,
        teachingMethod: item.teachingMethod || "",
        syllabusId: item.syllabusId || item.unit?.syllabusId || "",
        syllabusChapterId:
          item.syllabusChapterId || item.unit?.syllabusChapterId || "",
        syllabusUnitId: item.syllabusUnitId || item.unit?.syllabusUnitId || "",
        syllabusSubUnitIds,
        titleToId,
      });
    }
  }
  return out;
};

const uniqueUnits = (picks: LessonPlanPick[]) => {
  const seen = new Map<string, LessonPlanPick>();
  for (const pick of picks) {
    if (!seen.has(pick.unitId)) seen.set(pick.unitId, pick);
  }
  return [...seen.values()].sort((a, b) => {
    const an = Number(a.unitNo);
    const bn = Number(b.unitNo);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.label.localeCompare(b.label);
  });
};

const mergeSubs = (picks: LessonPlanPick[]) =>
  picks
    .flatMap((pick) => pick.subUnitTitles)
    .filter((t, i, arr) => arr.findIndex((x) => titleKey(x) === titleKey(t)) === i);

type DraftLogRow = {
  key: string;
  dateBs: string;
  sessionPlanUnitId: string;
  lessonPlanId?: string;
  lessonPlanItemId: string;
  unit: string;
  subUnitTitles: string[];
  teachingMethod: string;
  theoryPractical: AcademicLogBookEntryInput["theoryPractical"];
  time: string;
  feedback: string;
  signature: string;
};

const newRowKey = () =>
  `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  /** Academic Management admin hub (not teacher My Work). */
  isAdminView?: boolean;
}

/**
 * Entries table layout. The row is wider than most screens, so the header sits
 * in its own strip with a reachable scrollbar (no scrolling to the bottom of the
 * page to move sideways) and the Actions column is pinned to the right edge so
 * Edit / Approve / Delete stay on screen at any scroll position.
 */
const logTableClass = "w-full table-fixed min-w-[1520px]";
const logThClass = "bg-slate-50 whitespace-nowrap";
const stickyActionsBase =
  "sticky right-0 border-l border-slate-200 shadow-[-2px_0_4px_-2px_rgba(15,23,42,0.08)]";
const stickyActionsTh = cn(stickyActionsBase, "z-20 bg-slate-50");
const stickyActionsTd = cn(stickyActionsBase, "z-10 bg-white");
const logColGroup = (
  <colgroup>
    <col style={{ width: 56 }} />
    <col style={{ width: 104 }} />
    <col style={{ width: 176 }} />
    <col style={{ width: 208 }} />
    <col style={{ width: 120 }} />
    <col style={{ width: 72 }} />
    <col style={{ width: 116 }} />
    <col style={{ width: 168 }} />
    <col style={{ width: 136 }} />
    <col style={{ width: 116 }} />
    <col style={{ width: 248 }} />
  </colgroup>
);

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
  isAdminView = false,
}: LogBookPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "") || isAdminView;
  const canMutate = writeAccess;
  const canEditDelete =
    writeAccess && (canManageInstitution(user?.role ?? "") || !isAdminView);
  const defaultSignature = user?.fullName || "";

  const makeBlankRow = (dateBs = formatTodayBs()): DraftLogRow => ({
    key: newRowKey(),
    dateBs,
    sessionPlanUnitId: "",
    lessonPlanId: undefined,
    lessonPlanItemId: "",
    unit: "",
    subUnitTitles: [],
    teachingMethod: "",
    theoryPractical: "THEORY",
    time: "",
    feedback: "",
    signature: defaultSignature,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState<string | null>(
    null,
  );
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<HierarchySubjectNode | null>(null);
  const [rows, setRows] = useState<DraftLogRow[]>(() => [makeBlankRow()]);
  const [scope, setScope] = useState({
    academicYearBs: filters.academicYearBs || "",
    session: filters.session || filters.academicYearBs || "",
    faculty: filters.faculty || "",
    semesterBs: filters.semesterBs || "",
    classId: filters.classId,
    sectionId: filters.sectionId,
    batchId: filters.batchId,
    yearId: filters.yearId,
    subjectId: filters.subjectId || "",
    teacherId: teacherId || filters.teacherId || "",
  });

  const yearOptions = useMemo(() => dedupeYearsForSelect(years), [years]);
  const subjectOptions = useMemo(() => {
    const base =
      isCollege || yearOptions.length > 0
        ? filterSubjectsByYear(subjects, years, scope.yearId)
        : filterSubjectsByClass(subjects, scope.classId);
    return ensureSubjectInOptions(base, scope.subjectId, subjects);
  }, [
    subjects,
    years,
    scope.yearId,
    scope.classId,
    scope.subjectId,
    isCollege,
    yearOptions.length,
  ]);

  const subjectSelectValue = useMemo(
    () => resolveSubjectSelectValue(subjectOptions, scope.subjectId),
    [subjectOptions, scope.subjectId],
  );

  const selectedFormSubject = useMemo(() => {
    if (!scope.subjectId) return undefined;
    return (
      subjectOptions.find(
        (s) =>
          s._id === scope.subjectId ||
          ((s as { subjectIds?: string[] }).subjectIds ?? []).includes(
            scope.subjectId,
          ),
      ) ?? subjects.find((s) => s._id === scope.subjectId)
    );
  }, [subjectOptions, scope.subjectId, subjects]);
  const formNepaliText = isNepaliSubject(selectedFormSubject);

  useEffect(() => {
    if (!teacherId) return;
    setScope((current) =>
      current.teacherId === teacherId
        ? current
        : { ...current, teacherId },
    );
  }, [teacherId]);

  useEffect(() => {
    if (!filters.academicYearBs) return;
    setScope((current) => {
      if (current.academicYearBs === filters.academicYearBs) return current;
      return {
        ...current,
        academicYearBs: filters.academicYearBs!,
        session: filters.session || filters.academicYearBs!,
      };
    });
  }, [filters.academicYearBs, filters.session]);

  const effectiveTeacherId =
    teacherId || scope.teacherId || filters.teacherId || "";

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

  const formCurriculumSubjectIds = useMemo(() => {
    const ids = new Set<string>();
    if (scope.subjectId) ids.add(scope.subjectId);
    const fromOption = (
      selectedFormSubject as { subjectIds?: string[] } | undefined
    )?.subjectIds;
    for (const id of fromOption ?? []) ids.add(id);

    const selected =
      subjects.find((s) => s._id === scope.subjectId) ?? selectedFormSubject;
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
      if (s._id === scope.subjectId) {
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
      if (keyName && normText(s.name) === keyName) ids.add(s._id);
    }
    return [...ids];
  }, [scope.subjectId, selectedFormSubject, subjects]);

  /**
   * Load every Lesson Plan for the form (same approach as Lesson Plan tab).
   * Do not pin subjectId / academicYearBs on the API — those hide valid units.
   */
  const lessonPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "lesson-plans-for-log",
      "all-for-form",
      effectiveTeacherId || "any-teacher",
    ],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (effectiveTeacherId) params.teacherId = effectiveTeacherId;
      return unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", { params }),
      );
    },
    enabled: showForm,
  });

  const matchedLessonPlans = useMemo(() => {
    const all = (lessonPlansQuery.data ?? []).filter(
      (plan) => plan.status !== "REJECTED",
    );
    if (!scope.subjectId) return all;

    const subjectSet = new Set(formCurriculumSubjectIds);
    const selectedName = normText(selectedFormSubject?.name);
    const selectedCode = normText(selectedFormSubject?.code);
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
      if (selectedName) {
        const planSubjectRow = subjects.find((s) => s._id === plan.subjectId);
        if (planSubjectRow && normText(planSubjectRow.name) === selectedName) {
          return true;
        }
      }
      return false;
    });

    const formYear = (
      scope.academicYearBs ||
      filters.academicYearBs ||
      ""
    ).trim();
    if (!formYear) return matched;
    const sameYear = matched.filter(
      (plan) => (plan.academicYearBs || "").trim() === formYear,
    );
    return sameYear.length > 0 ? sameYear : matched;
  }, [
    lessonPlansQuery.data,
    scope.subjectId,
    scope.academicYearBs,
    filters.academicYearBs,
    formCurriculumSubjectIds,
    selectedFormSubject,
    subjects,
    effectiveTeacherId,
  ]);

  const lessonPicks = useMemo(
    () => flattenLessonPlanPicks(matchedLessonPlans),
    [matchedLessonPlans],
  );

  const unitsForDate = (dateBs: string) => {
    const onDate = uniqueUnits(lessonPicks.filter((p) => p.dateBs === dateBs));
    if (onDate.length > 0) return { units: onDate, fromDate: true };
    return { units: uniqueUnits(lessonPicks), fromDate: false };
  };

  const picksForUnit = (dateBs: string, unitId: string) => {
    const onDate = lessonPicks.filter(
      (p) => p.unitId === unitId && p.dateBs === dateBs,
    );
    if (onDate.length > 0) return onDate;
    return lessonPicks.filter((p) => p.unitId === unitId);
  };

  const saveMutation = useMutation({
    mutationFn: async (payloads: AcademicLogBookEntryInput[]) => {
      const results: unknown[] = [];
      for (let i = 0; i < payloads.length; i += 1) {
        if (editingId && i === 0) {
          results.push(
            await unwrap(
              api.put(
                `/academic-management/log-book-entries/${editingId}`,
                payloads[i],
              ),
            ),
          );
        } else {
          results.push(
            await unwrap(
              api.post("/academic-management/log-book-entries", payloads[i]),
            ),
          );
        }
      }
      return results;
    },
    onSuccess: (results) => {
      toast.success(
        results.length === 1
          ? "Log book entry saved"
          : `${results.length} log book entries saved`,
      );
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      setEditingId(null);
      setRows([makeBlankRow()]);
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

  /**
   * Soft-deletes on the server, then rolls the syllabus sub-units and the
   * Session Plan back so the removed class stops counting as taught.
   * Administrators may delete an APPROVED entry (mistaken approval);
   * teachers can only remove their own entries before approval.
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academic-management/log-book-entries/${id}`)),
    onSuccess: () => {
      toast.success("Log book entry deleted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateRow = (index: number, patch: Partial<DraftLogRow>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const applyRowDate = (index: number, dateBs: string) => {
    const row = rows[index];
    const { units } = unitsForDate(dateBs);
    const stillValid = units.some((u) => u.unitId === row?.sessionPlanUnitId);
    if (stillValid && row) {
      const picks = picksForUnit(dateBs, row.sessionPlanUnitId);
      const first = picks[0];
      updateRow(index, {
        dateBs,
        lessonPlanId: first?.lessonPlanId,
        lessonPlanItemId: first?.lessonPlanItemId || "",
        subUnitTitles: row.subUnitTitles.filter((t) =>
          mergeSubs(picks).some((opt) => titleKey(opt) === titleKey(t)),
        ),
      });
      return;
    }
    updateRow(index, {
      dateBs,
      sessionPlanUnitId: "",
      lessonPlanId: undefined,
      lessonPlanItemId: "",
      unit: "",
      subUnitTitles: [],
    });
  };

  const applyRowUnit = (index: number, unitId: string) => {
    const dateBs = rows[index]?.dateBs || "";
    if (!unitId) {
      updateRow(index, {
        sessionPlanUnitId: "",
        lessonPlanId: undefined,
        lessonPlanItemId: "",
        unit: "",
        subUnitTitles: [],
      });
      return;
    }
    const picks = picksForUnit(dateBs, unitId);
    const first = picks[0];
    const currentMethod = (rows[index]?.teachingMethod || "").trim();
    updateRow(index, {
      sessionPlanUnitId: unitId,
      lessonPlanId: first?.lessonPlanId,
      lessonPlanItemId: first?.lessonPlanItemId || "",
      unit: first?.label || "",
      subUnitTitles: [],
      teachingMethod: currentMethod || first?.teachingMethod || "",
    });
  };

  const openNewForm = () => {
    setEditingId(null);
    const nextScope = { ...scope };
    if (selectedSubject?.subjectIds[0]) {
      nextScope.subjectId = selectedSubject.subjectIds[0];
    } else if (filters.subjectId && !nextScope.subjectId) {
      nextScope.subjectId = filters.subjectId;
    }
    if (filters.academicYearBs) {
      nextScope.academicYearBs = filters.academicYearBs;
      nextScope.session = filters.session || filters.academicYearBs;
    }
    setScope(nextScope);
    setRows([makeBlankRow()]);
    setShowForm(true);
  };

  const openEdit = (entry: AcademicLogBookEntryRecord) => {
    setEditingId(entry._id);
    setScope((current) => ({
      ...current,
      academicYearBs: entry.academicYearBs || current.academicYearBs,
      session: entry.session || current.session,
      faculty: entry.faculty || current.faculty,
      semesterBs: entry.semesterBs || current.semesterBs,
      classId: entry.classId || current.classId,
      sectionId: entry.sectionId || current.sectionId,
      batchId: entry.batchId || current.batchId,
      yearId: entry.yearId || current.yearId,
      subjectId: entry.subjectId || current.subjectId,
      teacherId: entry.teacherId || current.teacherId,
    }));
    setRows([
      {
        key: entry._id,
        dateBs: entry.dateBs,
        sessionPlanUnitId: entry.sessionPlanUnitId || "",
        lessonPlanId: entry.lessonPlanId,
        lessonPlanItemId: entry.lessonPlanItemId || "",
        unit: entry.unit || "",
        subUnitTitles: entrySubUnits(entry),
        teachingMethod: entry.teachingMethod || "",
        theoryPractical: entry.theoryPractical || "THEORY",
        time: entryTimeValue(entry),
        feedback: entry.feedback || "",
        signature: entry.teacherSignature || defaultSignature,
      },
    ]);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!scope.subjectId) {
      toast.error("Select a subject");
      return;
    }
    const teacher = teacherId || scope.teacherId;
    if (!teacher) {
      toast.error("Select a teacher");
      return;
    }
    const ready = rows.filter((row) => row.dateBs.trim());
    if (ready.length === 0) {
      toast.error("Add at least one row with a date");
      return;
    }
    const oid = (value?: string) => {
      const s = (value || "").trim();
      return /^[a-fA-F0-9]{24}$/.test(s) ? s : "";
    };
    const payloads: AcademicLogBookEntryInput[] = ready.map((row, index) => {
      const taught = normalizeSubUnitTitles(row.subUnitTitles);
      const times = parseTimeRange(row.time);
      const picks = row.sessionPlanUnitId
        ? picksForUnit(row.dateBs, row.sessionPlanUnitId)
        : [];
      const first = picks[0];
      const unitLabel = row.unit.trim() || first?.label || "";
      const year =
        (scope.academicYearBs || filters.academicYearBs || "").trim() ||
        "2082/083";
      return {
        academicYearBs: year,
        session: (scope.session || year).trim() || year,
        faculty: scope.faculty || "",
        semesterBs: scope.semesterBs || "",
        classId: oid(scope.classId) || undefined,
        sectionId: oid(scope.sectionId) || undefined,
        batchId: oid(scope.batchId) || undefined,
        yearId: oid(scope.yearId) || undefined,
        subjectId: scope.subjectId,
        teacherId: teacher,
        dateBs: row.dateBs,
        lessonPlanItemId: oid(row.lessonPlanItemId || first?.lessonPlanItemId),
        lessonPlanId: oid(row.lessonPlanId || first?.lessonPlanId) || undefined,
        sessionPlanUnitId: oid(first?.sessionPlanUnitId),
        subUnitTitles: taught,
        subUnitTitle: joinSubUnitTitles(taught),
        syllabusId: oid(first?.syllabusId),
        syllabusChapterId: oid(first?.syllabusChapterId),
        syllabusUnitId: oid(first?.syllabusUnitId),
        syllabusSubUnitId: oid(
          taught.map((title) => first?.titleToId[titleKey(title)]).find(Boolean),
        ),
        syllabusSubUnitIds: taught
          .map((title) => first?.titleToId[titleKey(title)] || "")
          .filter((id) => /^[a-fA-F0-9]{24}$/.test(id)),
        unit: unitLabel,
        topicCovered: joinSubUnitTitles(taught) || unitLabel || "Class taught",
        objectives: "",
        teachingMethod: row.teachingMethod.trim(),
        teachingAids: "",
        theoryPractical: row.theoryPractical || "THEORY",
        periodNumber: index + 1,
        startTime: times.startTime,
        endTime: times.endTime,
        homeworkGiven: "",
        assignment: "",
        feedback: row.feedback.trim(),
        difficultiesFaced: "",
        nextClassPlan: "",
        attachmentUrl: "",
        teacherSignature: row.signature.trim(),
      };
    });
    saveMutation.mutate(payloads);
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

  /**
   * Row actions, shared by the desktop table cell and the mobile cards so both
   * stay in step (a button added here shows up in both layouts).
   */
  const renderEntryActions = (entry: AcademicLogBookEntryRecord) => (
    <div className="flex flex-wrap gap-1">
      {canEditDelete ? (
        <Button
          size="sm"
          variant="outline"
          title="Edit this log book row"
          onClick={() => openEdit(entry)}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        title="Open comments for this row"
        onClick={() =>
          setSelectedEntryId(entry._id)
        }
      >
        Comments
      </Button>
      {isAdmin && canMutate ? (
        <>
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-700"
            title="Approve this log book entry"
            onClick={() =>
              reviewMutation.mutate({
                id: entry._id,
                reviewStatus: "APPROVED",
              })
            }
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-amber-700"
            title="Mark as needs improvement"
            onClick={() =>
              reviewMutation.mutate({
                id: entry._id,
                reviewStatus:
                  "NEEDS_IMPROVEMENT",
              })
            }
          >
            Needs improvement
          </Button>
        </>
      ) : null}
      {canEditDelete &&
      (isAdmin ||
        entry.reviewStatus !== "APPROVED") ? (
        <Button
          size="sm"
          variant="outline"
          className="border-rose-200 text-rose-700 hover:bg-rose-50"
          disabled={deleteMutation.isPending}
          title={
            entry.reviewStatus === "APPROVED"
              ? "Delete this approved entry (approved by mistake)"
              : "Delete this log book row"
          }
          onClick={() => {
            const label = entry.dateBs || "this row";
            const warning =
              entry.reviewStatus === "APPROVED"
                ? " It is already approved, and the sub-units it covered will go back to not started."
                : "";
            if (
              !window.confirm(
                `Delete the log book entry for ${label}?${warning}`,
              )
            ) {
              return;
            }
            deleteMutation.mutate(entry._id);
          }}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>
      ) : null}
    </div>
  );

  const sortEntries = (list: AcademicLogBookEntryRecord[]) =>
    [...list].sort((a, b) => {
      const dateCmp = (a.dateBs || "").localeCompare(b.dateBs || "");
      if (dateCmp !== 0) return dateCmp;
      return (a.serialNo || 0) - (b.serialNo || 0);
    });

  const teacherGroups = useMemo(
    () =>
      groupByTeacher(selectedEntries).map((group) => ({
        ...group,
        items: sortEntries(group.items),
      })),
    [selectedEntries],
  );

  const printEntries = useMemo(() => {
    if (selectedSubject && selectedEntries.length > 0) return selectedEntries;
    return filteredEntries;
  }, [selectedSubject, selectedEntries, filteredEntries]);

  const logBookStats = useMemo(() => {
    const list = selectedEntries.length > 0 ? selectedEntries : filteredEntries;
    return {
      dailyEntries: list.length,
      unitsLogged: new Set(list.map((r) => r.unit).filter(Boolean)).size,
    };
  }, [selectedEntries, filteredEntries]);

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Log Book</h2>
          <p className="text-sm text-slate-600">
            Fill whenever you taught — the same day, or later if you missed it.
            Pick Date, then Unit and Sub-unit from the Lesson Plan, then write
            method and the rest.
          </p>
        </div>
        {canMutate ? (
          <Button onClick={() => (showForm ? setShowForm(false) : openNewForm())}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            {showForm ? "Close" : "New Entry"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 no-print">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Entries</p>
            <p className="text-2xl font-semibold text-slate-900">
              {logBookStats.dailyEntries}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Units logged</p>
            <p className="text-2xl font-semibold text-slate-900">
              {logBookStats.unitsLogged}
            </p>
          </CardContent>
        </Card>
      </div>

      {showForm && canMutate ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>
              {editingId ? "Edit Log Book Entry" : "Create Log Book"}
            </CardTitle>
            <p className="text-sm text-slate-600">
              Select the date you taught, then Unit and Sub-unit from that
              subject&apos;s Lesson Plan. Then write Method, T/P, Time,
              Feedback and Signature. You can fill a missed day later.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {isAdmin && teachers.length > 0 ? (
                <FormField label="Teacher">
                  <Select
                    value={scope.teacherId}
                    onChange={(event) => {
                      setScope((current) => ({
                        ...current,
                        teacherId: event.target.value,
                      }));
                      setRows((current) =>
                        current.map((row) => ({
                          ...row,
                          sessionPlanUnitId: "",
                          lessonPlanId: undefined,
                          lessonPlanItemId: "",
                          unit: "",
                          subUnitTitles: [],
                        })),
                      );
                    }}
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
                    value={scope.yearId || ""}
                    onChange={(event) => {
                      setScope((current) => ({
                        ...current,
                        yearId: event.target.value,
                        subjectId: "",
                      }));
                      setRows((current) =>
                        current.map((row) => ({
                          ...row,
                          sessionPlanUnitId: "",
                          lessonPlanId: undefined,
                          lessonPlanItemId: "",
                          unit: "",
                          subUnitTitles: [],
                        })),
                      );
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
                    value={scope.classId || ""}
                    onChange={(event) => {
                      setScope((current) => ({
                        ...current,
                        classId: event.target.value,
                        subjectId: "",
                      }));
                      setRows((current) =>
                        current.map((row) => ({
                          ...row,
                          sessionPlanUnitId: "",
                          lessonPlanId: undefined,
                          lessonPlanItemId: "",
                          unit: "",
                          subUnitTitles: [],
                        })),
                      );
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
                  onChange={(event) => {
                    setScope((current) => ({
                      ...current,
                      subjectId: event.target.value,
                    }));
                    setRows((current) =>
                      current.map((row) => ({
                        ...row,
                        sessionPlanUnitId: "",
                        lessonPlanId: undefined,
                        lessonPlanItemId: "",
                        unit: "",
                        subUnitTitles: [],
                      })),
                    );
                  }}
                  disabled={
                    yearOptions.length > 0
                      ? !scope.yearId
                      : classes.length > 0
                        ? !scope.classId
                        : false
                  }
                >
                  <option value="">
                    {yearOptions.length > 0 && !scope.yearId
                      ? "Select year first"
                      : classes.length > 0 && !scope.classId
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

            <div className="overflow-x-auto rounded-xl border border-slate-300">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="w-12 border border-slate-300 px-2 py-2 text-center text-xs font-semibold">
                      S.N
                    </th>
                    <th className="w-[13rem] border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Date
                    </th>
                    <th className="w-44 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Unit
                    </th>
                    <th className="border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Sub-unit
                    </th>
                    <th className="w-32 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Method
                    </th>
                    <th className="w-20 border border-slate-300 px-2 py-2 text-center text-xs font-semibold">
                      T/P
                    </th>
                    <th className="w-28 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Time
                    </th>
                    <th className="w-36 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Feedback
                    </th>
                    <th className="w-32 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                      Signature
                    </th>
                    <th className="w-10 border border-slate-300 px-1 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const dateUnits = unitsForDate(row.dateBs);
                    const unitPicks = row.sessionPlanUnitId
                      ? picksForUnit(row.dateBs, row.sessionPlanUnitId)
                      : [];
                    const subOptions = mergeSubs(unitPicks);
                    const unitReady = Boolean(row.dateBs);
                    return (
                      <tr key={row.key}>
                        <td className="border border-slate-300 px-2 py-2 text-center tabular-nums text-slate-700">
                          {index + 1}
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <NepaliDateField
                            value={row.dateBs}
                            onChange={(value) => applyRowDate(index, value)}
                            placeholder="Date taught"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          {!scope.subjectId ? (
                            <p className="py-2 text-xs text-slate-400">
                              Select subject first
                            </p>
                          ) : !unitReady ? (
                            <p className="py-2 text-xs text-slate-400">
                              Select date first
                            </p>
                          ) : lessonPlansQuery.isLoading ? (
                            <p className="py-2 text-xs text-slate-400">
                              Loading Lesson Plan…
                            </p>
                          ) : lessonPlansQuery.isError ? (
                            <p className="py-2 text-xs text-rose-700">
                              Could not load Lesson Plans. Try again.
                            </p>
                          ) : dateUnits.units.length === 0 ? (
                            <p className="py-2 text-xs text-amber-700">
                              {(lessonPlansQuery.data?.length ?? 0) > 0
                                ? "No units on the Lesson Plan for this subject."
                                : "No Lesson Plan units. Create a Lesson Plan first."}
                            </p>
                          ) : (
                            <>
                              <Select
                                value={row.sessionPlanUnitId}
                                onChange={(event) =>
                                  applyRowUnit(index, event.target.value)
                                }
                              >
                                <option value="">Select unit</option>
                                {dateUnits.units.map((u) => (
                                  <option key={u.unitId} value={u.unitId}>
                                    {u.label}
                                  </option>
                                ))}
                              </Select>
                              {!dateUnits.fromDate && row.dateBs ? (
                                <p className="mt-1 text-[11px] text-amber-700">
                                  No Lesson Plan on this date. Units are from
                                  the Lesson Plan so you can fill a missed day.
                                </p>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          {!row.sessionPlanUnitId ? (
                            <p className="py-2 text-xs text-slate-400">
                              Select unit first
                            </p>
                          ) : subOptions.length === 0 ? (
                            <p className="py-2 text-xs text-slate-400">
                              No sub-units in this Lesson Plan unit
                            </p>
                          ) : (
                            <SubUnitMultiSelect
                              options={subOptions}
                              value={row.subUnitTitles}
                              onChange={(next) =>
                                updateRow(index, { subUnitTitles: next })
                              }
                              allowCustom={false}
                              nepali={formNepaliText}
                              placeholder="Select sub-unit"
                            />
                          )}
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <Input
                            value={row.teachingMethod}
                            nepali={formNepaliText}
                            onChange={(event) =>
                              updateRow(index, {
                                teachingMethod: event.target.value,
                              })
                            }
                            placeholder="Optional"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <Select
                            value={row.theoryPractical}
                            onChange={(event) =>
                              updateRow(index, {
                                theoryPractical: event.target
                                  .value as DraftLogRow["theoryPractical"],
                              })
                            }
                          >
                            <option value="THEORY">T</option>
                            <option value="PRACTICAL">P</option>
                            <option value="BOTH">T/P</option>
                          </Select>
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <Input
                            value={row.time}
                            onChange={(event) =>
                              updateRow(index, { time: event.target.value })
                            }
                            placeholder="10:00-10:45"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <Input
                            value={row.feedback}
                            nepali={formNepaliText}
                            onChange={(event) =>
                              updateRow(index, { feedback: event.target.value })
                            }
                            placeholder="Optional"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-2 align-top">
                          <Input
                            value={row.signature}
                            nepali={formNepaliText}
                            onChange={(event) =>
                              updateRow(index, {
                                signature: event.target.value,
                              })
                            }
                            placeholder="Optional"
                          />
                        </td>
                        <td className="border border-slate-300 px-1 py-2 align-top text-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-rose-600"
                            title="Remove this row"
                            onClick={() =>
                              setRows((current) =>
                                current.length <= 1
                                  ? [makeBlankRow()]
                                  : current.filter((_, i) => i !== index),
                              )
                            }
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    makeBlankRow(current[current.length - 1]?.dateBs || formatTodayBs()),
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add row
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  !scope.subjectId ||
                  !(teacherId || scope.teacherId) ||
                  saveMutation.isPending
                }
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
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
              description="Add a row for the day you taught. You can fill it the same day or later if you missed it."
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
                    <CardContent className="p-0">
                      {/*
                        Phone layout: one card per entry. A 1520px row cannot be
                        made readable on a phone, so drop the table entirely and
                        stack the same fields — no horizontal scrolling at all.
                      */}
                      <div className="space-y-3 p-3 md:hidden">
                        {group.items.map((entry, index) => {
                          const subs = entrySubUnits(entry);
                          return (
                            <div
                              key={entry._id}
                              className="rounded-xl border border-slate-200 bg-white p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-900">
                                    {index + 1}. {entry.dateBs}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {cleanDuplicatedUnitLabel(entry.unit) || "—"}
                                  </p>
                                </div>
                                <Badge
                                  className={cn(
                                    statusBadgeClass(entry.reviewStatus),
                                    "no-print shrink-0",
                                  )}
                                >
                                  {entry.reviewStatus}
                                </Badge>
                              </div>
                              {subs.length > 0 ? (
                                <ul className="mt-2 list-disc pl-4 text-sm text-slate-700">
                                  {subs.map((title) => (
                                    <li key={title}>{title}</li>
                                  ))}
                                </ul>
                              ) : null}
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                                <div>
                                  <dt className="text-slate-400">Method</dt>
                                  <dd>{entry.teachingMethod || "—"}</dd>
                                </div>
                                <div>
                                  <dt className="text-slate-400">T/P</dt>
                                  <dd>{formatTp(entry.theoryPractical)}</dd>
                                </div>
                                <div>
                                  <dt className="text-slate-400">Time</dt>
                                  <dd>
                                    {formatTime(entry.startTime, entry.endTime)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-slate-400">Signature</dt>
                                  <dd>
                                    {entry.teacherSignature ||
                                      entry.teacher?.user?.fullName ||
                                      "—"}
                                  </dd>
                                </div>
                                {entry.feedback ? (
                                  <div className="col-span-2">
                                    <dt className="text-slate-400">Feedback</dt>
                                    <dd>{entry.feedback}</dd>
                                  </div>
                                ) : null}
                              </dl>
                              <div className="mt-3 no-print">
                                {renderEntryActions(entry)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <StickyTableScroll
                        className="hidden md:flex"
                        maxHeightClassName="max-h-[min(65vh,640px)]"
                        showHeaderScrollbar
                        header={
                          <Table className={logTableClass}>
                            {logColGroup}
                            <TableHead>
                              <tr>
                                <Th className={logThClass}>S.N</Th>
                                <Th className={logThClass}>Date</Th>
                                <Th className={logThClass}>Unit</Th>
                                <Th className={logThClass}>Sub-unit</Th>
                                <Th className={logThClass}>Method</Th>
                                <Th className={logThClass}>T/P</Th>
                                <Th className={logThClass}>Time</Th>
                                <Th className={logThClass}>Feedback</Th>
                                <Th className={logThClass}>Signature</Th>
                                <Th className={cn(logThClass, "no-print")}>
                                  Review
                                </Th>
                                <Th
                                  className={cn(
                                    logThClass,
                                    "no-print",
                                    stickyActionsTh,
                                  )}
                                >
                                  Actions
                                </Th>
                              </tr>
                            </TableHead>
                          </Table>
                        }
                        body={
                          <Table className={logTableClass}>
                            {logColGroup}
                            <TableBody>
                              {group.items.map((entry, index) => {
                                const subs = entrySubUnits(entry);
                                return (
                                  <tr key={entry._id} className="align-top">
                                    <Td className="tabular-nums">{index + 1}</Td>
                                    <Td className="whitespace-nowrap">
                                      {entry.dateBs}
                                    </Td>
                                    <Td>
                                      {cleanDuplicatedUnitLabel(entry.unit) || "—"}
                                    </Td>
                                    <Td>
                                      {subs.length > 0 ? (
                                        <div className="space-y-0.5">
                                          {subs.map((title) => (
                                            <div key={title}>{title}</div>
                                          ))}
                                        </div>
                                      ) : (
                                        "—"
                                      )}
                                    </Td>
                                    <Td>{entry.teachingMethod || "—"}</Td>
                                    <Td>{formatTp(entry.theoryPractical)}</Td>
                                    <Td className="whitespace-nowrap text-xs">
                                      {formatTime(entry.startTime, entry.endTime)}
                                    </Td>
                                    <Td className="max-w-[140px] truncate">
                                      {entry.feedback || "—"}
                                    </Td>
                                    <Td>
                                      {entry.teacherSignature ||
                                        entry.teacher?.user?.fullName ||
                                        "—"}
                                    </Td>
                                    <Td className="no-print">
                                      <Badge
                                        className={statusBadgeClass(
                                          entry.reviewStatus,
                                        )}
                                      >
                                        {entry.reviewStatus}
                                      </Badge>
                                    </Td>
                                    <Td className={cn("no-print", stickyActionsTd)}>
                                      {renderEntryActions(entry)}
                                    </Td>
                                  </tr>
                                );
                              })}
                            </TableBody>
                          </Table>
                        }
                      />
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
        />
        {groupByTeacher(printEntries).map((group) => (
          <div key={group.teacherId} className="mb-8">
            <h3 className="mb-2 font-bold">Teacher: {group.teacherName}</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border p-1 text-left">S.N</th>
                  <th className="border p-1 text-left">Date</th>
                  <th className="border p-1 text-left">Unit</th>
                  <th className="border p-1 text-left">Sub-unit</th>
                  <th className="border p-1 text-left">Method</th>
                  <th className="border p-1 text-left">T/P</th>
                  <th className="border p-1 text-left">Time</th>
                  <th className="border p-1 text-left">Feedback</th>
                  <th className="border p-1 text-left">Signature</th>
                </tr>
              </thead>
              <tbody>
                {sortEntries(group.items).map((entry, index) => {
                  const subs = entrySubUnits(entry);
                  return (
                    <tr key={entry._id}>
                      <td className="border p-1">{index + 1}</td>
                      <td className="border p-1">{entry.dateBs}</td>
                      <td className="border p-1">
                        {cleanDuplicatedUnitLabel(entry.unit)}
                      </td>
                      <td className="border p-1">
                        {subs.length > 0
                          ? subs.map((title) => (
                              <div key={title}>{title}</div>
                            ))
                          : ""}
                      </td>
                      <td className="border p-1">{entry.teachingMethod || ""}</td>
                      <td className="border p-1">
                        {formatTp(entry.theoryPractical)}
                      </td>
                      <td className="border p-1">
                        {formatTime(entry.startTime, entry.endTime) === "—"
                          ? ""
                          : formatTime(entry.startTime, entry.endTime)}
                      </td>
                      <td className="border p-1">{entry.feedback || ""}</td>
                      <td className="border p-1">
                        {entry.teacherSignature ||
                          entry.teacher?.user?.fullName ||
                          ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
