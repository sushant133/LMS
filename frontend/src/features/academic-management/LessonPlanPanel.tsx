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
  adToBs,
  bsToAd,
  parseBsDate,
  type NepaliDate,
} from "@munatech/nepali-datepicker";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
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
  collectLessonSubUnitOptions,
  joinSubUnitTitles,
  matchSyllabusSubUnit,
  normalizeSubUnitTitles,
  resolveSubjectSelectValue,
  statusBadgeClass,
} from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
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
  /** Academic Management admin hub (not teacher My Work). */
  isAdminView?: boolean;
}

const normText = (value?: string | null) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** BS YYYY-MM-DD strings compare lexicographically. Empty unit window = always allowed. */
const unitAllowsTeachingDate = (
  unit: Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">,
  teachingDateBs?: string | null,
): boolean => {
  const date = normalizeBsDate(teachingDateBs) || (teachingDateBs || "").trim();
  if (!date) return true;
  const start = normalizeBsDate(unit.startDateBs);
  const end = normalizeBsDate(unit.endDateBs);
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

const nextBsDate = (dateBs: string): string => {
  const parts = dateBs.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateBs;
  try {
    const ad = bsToAd(y, m, d);
    const js = new Date(ad.year, ad.month - 1, ad.day, 12, 0, 0);
    js.setDate(js.getDate() + 1);
    const bs = adToBs(js.getFullYear(), js.getMonth() + 1, js.getDate());
    return `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`;
  } catch {
    return dateBs;
  }
};

const enumerateBsDates = (startBs: string, endBs: string): string[] => {
  if (!startBs) return [];
  const end = endBs && endBs >= startBs ? endBs : startBs;
  const out: string[] = [];
  let cur = startBs;
  for (let i = 0; i < 400; i += 1) {
    out.push(cur);
    if (cur >= end) break;
    const next = nextBsDate(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return out;
};

/** Discrete teaching days fixed on a Session Plan unit (start–end, inclusive). */
/** Accept YYYY-MM-DD, YYYY/MM/DD, or unpadded YYYY-M-D. */
const normalizeBsDate = (value?: string | null): string => {
  const raw = String(value ?? "")
    .trim()
    .replace(/\//g, "-");
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";
  const y = m[1]!;
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${d}`;
};

const unitFixedDates = (
  unit: Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">,
): string[] => {
  const start = normalizeBsDate(unit.startDateBs);
  const end = normalizeBsDate(unit.endDateBs);
  if (start && end) {
    return start <= end ? enumerateBsDates(start, end) : enumerateBsDates(end, start);
  }
  if (start) return [start];
  if (end) return [end];
  return [];
};

const sessionPlanFixedDates = (
  units: Array<Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">>,
): string[] => {
  const set = new Set<string>();
  for (const unit of units) {
    for (const date of unitFixedDates(unit)) set.add(date);
  }
  return [...set].sort();
};

const dateRangeFromUnits = (
  units: Array<Pick<AcademicSessionPlanUnitRecord, "startDateBs" | "endDateBs">>,
): {
  minBs: string;
  maxBs: string;
  minDate?: NepaliDate;
  maxDate?: NepaliDate;
} => {
  let min = "";
  let max = "";
  for (const unit of units) {
    const start = normalizeBsDate(unit.startDateBs);
    const end = normalizeBsDate(unit.endDateBs) || start;
    const from = start || end;
    const to = end || start;
    if (!from) continue;
    if (!min || from < min) min = from;
    if (!max || to > max) max = to;
  }
  return {
    minBs: min,
    maxBs: max,
    minDate: min ? (parseBsDate(min) ?? undefined) : undefined,
    maxDate: max ? (parseBsDate(max) ?? undefined) : undefined,
  };
};

const clampBsDate = (dateBs: string, minBs: string, maxBs: string): string => {
  if (!dateBs) return minBs || "";
  if (minBs && dateBs < minBs) return minBs;
  if (maxBs && dateBs > maxBs) return maxBs;
  return dateBs;
};

const titleKey = (t: string) => t.trim().toLowerCase();

/** One table row in the college Lesson Plan (S.N | Date | Unit No. | Unit Name | Sub-Unit | C/Hr | Remarks). */
type LessonPlanTableRow = {
  planId: string;
  dateBs: string;
  unitId: string;
  unitNo: string;
  unitName: string;
  subUnit: string;
  subUnits: string[];
  hours: string;
  remarks: string;
};

const flattenLessonPlanTableRows = (
  plans: AcademicLessonPlanRecord[],
): LessonPlanTableRow[] => {
  const merged = new Map<string, LessonPlanTableRow & { subUnits: string[] }>();
  for (const plan of plans) {
    const planDate =
      plan.teachingDateBs || plan.startDateBs || plan.endDateBs || "";
    const items = [...(plan.items ?? [])].sort(
      (a, b) => (a.serialNo ?? 0) - (b.serialNo ?? 0),
    );
    for (const item of items) {
      const dateBs =
        normalizeBsDate(item.itemStartDateBs) ||
        normalizeBsDate(planDate) ||
        planDate;
      const subUnits = normalizeSubUnitTitles(
        item.subUnitTitles,
        item.subUnitTitle || item.plannedTopic,
      );
      const unitId =
        item.sessionPlanUnitId || item.unit?._id || `${plan._id}:${item._id}`;
      const unitNo =
        item.unit?.unitNo != null && String(item.unit.unitNo).trim()
          ? String(item.unit.unitNo)
          : "—";
      const unitName =
        (item.unit?.chapterName || item.subjectLabel || "").trim() || "—";
      const key = `${dateBs}|${unitId}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, {
          planId: plan._id,
          dateBs,
          unitId,
          unitNo,
          unitName,
          subUnits,
          subUnit: subUnits.join("; ") || (item.plannedTopic || "").trim() || "—",
          hours: Number.isFinite(item.estimatedClasses)
            ? String(item.estimatedClasses)
            : "—",
          remarks: (item.remarks ?? "").trim(),
        });
        continue;
      }
      const allSubs = normalizeSubUnitTitles(
        [...prev.subUnits, ...subUnits],
        "",
      );
      prev.subUnits = allSubs;
      prev.subUnit = allSubs.join("; ") || prev.subUnit;
      if (item.remarks?.trim() && !prev.remarks.includes(item.remarks.trim())) {
        prev.remarks = [prev.remarks, item.remarks.trim()]
          .filter(Boolean)
          .join("; ");
      }
    }
  }
  return [...merged.values()].sort((a, b) => {
      if (a.dateBs !== b.dateBs) return a.dateBs.localeCompare(b.dateBs);
      const an = Number(a.unitNo);
      const bn = Number(b.unitNo);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return 0;
    });
};

const isLessonPlanPending = (status?: string) =>
  status === "PENDING_APPROVAL" || status === "SUBMITTED";

const lessonPlanStatusRank = (status?: string) => {
  switch (status) {
    case "APPROVED":
      return 5;
    case "PENDING_APPROVAL":
    case "SUBMITTED":
      return 4;
    case "DRAFT":
      return 3;
    case "REJECTED":
      return 2;
    default:
      return 1;
  }
};

/** Keep every teaching day; drop only same-day copies of the same subject/teacher. */
const dedupeLessonPlansByDay = (
  plans: AcademicLessonPlanRecord[],
): AcademicLessonPlanRecord[] => {
  const best = new Map<string, AcademicLessonPlanRecord>();
  for (const plan of plans) {
    const date =
      normalizeBsDate(plan.teachingDateBs) ||
      normalizeBsDate(plan.startDateBs) ||
      plan.teachingDateBs ||
      plan.startDateBs ||
      plan._id;
    const key = `${plan.teacherId || ""}::${plan.subject?.code || plan.subjectId}::${date}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, plan);
      continue;
    }
    const rankNew = lessonPlanStatusRank(plan.status);
    const rankOld = lessonPlanStatusRank(existing.status);
    if (rankNew >= rankOld) best.set(key, plan);
  }
  return [...best.values()];
};

const mergeItemsByUnit = (
  items: AcademicLessonPlanInput["items"],
): AcademicLessonPlanInput["items"] => {
  const map = new Map<string, AcademicLessonPlanInput["items"][number]>();
  for (const item of items) {
    const key = item.sessionPlanUnitId;
    if (!key) continue;
    const titles = normalizeSubUnitTitles(item.subUnitTitles, item.subUnitTitle);
    const prev = map.get(key);
    if (!prev) {
      const joined = joinSubUnitTitles(titles);
      map.set(key, {
        ...item,
        subUnitTitles: titles,
        subUnitTitle: joined,
        plannedTopic: joined || item.plannedTopic,
      });
      continue;
    }
    const mergedTitles = normalizeSubUnitTitles(
      [...(prev.subUnitTitles ?? []), ...titles],
      "",
    );
    const joined = joinSubUnitTitles(mergedTitles);
    map.set(key, {
      ...prev,
      subUnitTitles: mergedTitles,
      subUnitTitle: joined,
      plannedTopic: joined || prev.plannedTopic,
      remarks: [prev.remarks, item.remarks].filter(Boolean).join("; "),
      syllabusSubUnitIds: [
        ...new Set([
          ...(prev.syllabusSubUnitIds ?? []),
          ...(item.syllabusSubUnitIds ?? []),
        ]),
      ],
    });
  }
  return [...map.values()].map((item, i) => ({ ...item, serialNo: i + 1 }));
};

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
  isAdminView = false,
}: LessonPlanPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "") || isAdminView;
  const canMutate = writeAccess;
  const canEditDelete =
    writeAccess && (canManageInstitution(user?.role ?? "") || !isAdminView);
  const [showForm, setShowForm] = useState(false);
  const [savingTable, setSavingTable] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Tracks which session plan was already applied to the form. */
  const autoSelectedForPlanRef = useRef<string>("");
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
    autoSelectedForPlanRef.current = "";
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
      const planDates = sessionPlanFixedDates(plan.units ?? []);
      setForm((current) => {
        const defaultTeaching =
          (current.teachingDateBs &&
          planDates.includes(current.teachingDateBs)
            ? current.teachingDateBs
            : "") ||
          planDates[0] ||
          "";
        const firstRow = {
          ...emptyItem(1),
          itemStartDateBs: defaultTeaching,
          itemEndDateBs: defaultTeaching,
        };
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
          items: current.items.length > 0 ? current.items : [firstRow],
        };
      });
      autoSelectedForPlanRef.current = plan._id;
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
    autoSelectedForPlanRef.current = plan.sessionPlanId || "";
    setEditingId(plan._id);
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

  const applyRowUnit = (index: number, unitId: string) => {
    const unit = units.find((u) => u._id === unitId);
    const range = unit ? dateRangeFromUnits([unit]) : sessionPlanDateRange;
    setForm((current) => ({
      ...current,
      items: current.items.map((row, i) => {
        if (i !== index) return row;
        const currentDate =
          row.itemStartDateBs ||
          current.teachingDateBs ||
          current.startDateBs ||
          "";
        const date = clampBsDate(currentDate, range.minBs, range.maxBs);
        const next = emptyItem(i + 1, unit, []);
        return {
          ...next,
          itemStartDateBs: date,
          itemEndDateBs: date,
          estimatedClasses: row.estimatedClasses || 1,
          remarks: row.remarks || "",
        };
      }),
    }));
  };

  const applyRowSubs = (index: number, titles: string[]) => {
    const item = form.items[index];
    const unit = units.find((u) => u._id === item?.sessionPlanUnitId);
    const multi = matchMultipleSubUnits(
      matchedSyllabus,
      unit?.syllabusChapterId || item?.syllabusChapterId,
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
              plannedTopic: joined || unit?.chapterName || row.plannedTopic,
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
              syllabusUnitId: match?.syllabusUnitId || row.syllabusUnitId || "",
              syllabusSubUnitId: multi.syllabusSubUnitIds[0] || "",
              syllabusSubUnitIds: multi.syllabusSubUnitIds,
            }
          : row,
      ),
    }));
  };

  const addLessonRow = () => {
    setForm((current) => {
      const last = current.items[current.items.length - 1];
      const lastDate =
        last?.itemStartDateBs ||
        current.teachingDateBs ||
        current.startDateBs ||
        sessionPlanDateRange.minBs ||
        "";
      const date = clampBsDate(
        lastDate,
        sessionPlanDateRange.minBs,
        sessionPlanDateRange.maxBs,
      );
      return {
        ...current,
        teachingDateBs: current.teachingDateBs || date,
        startDateBs: current.startDateBs || date,
        endDateBs: current.endDateBs || date,
        items: [
          ...current.items,
          {
            ...emptyItem(current.items.length + 1),
            itemStartDateBs: date,
            itemEndDateBs: date,
          },
        ],
      };
    });
  };

  const removeLessonRow = (index: number) => {
    setForm((current) => ({
      ...current,
      items: current.items
        .filter((_, i) => i !== index)
        .map((row, i) => ({ ...row, serialNo: i + 1 })),
    }));
  };

  const saveLessonPlan = async () => {
    if (!form.sessionPlanId) {
      toast.error("Select a Session Plan first");
      return;
    }
    if (form.items.every((row) => !row.sessionPlanUnitId)) {
      toast.error("Select a unit on at least one row");
      return;
    }
    const sessionPlan = usableSessionPlans.find(
      (p) => p._id === form.sessionPlanId,
    );
    const resolvedTeacherId =
      teacherId || form.teacherId || sessionPlan?.teacherId || "";
    if (!resolvedTeacherId) {
      toast.error("Teacher is required — select a teacher or Session Plan");
      return;
    }
    if (
      sessionPlan?.teacherId &&
      resolvedTeacherId !== sessionPlan.teacherId
    ) {
      toast.error(
        "Selected teacher does not match the Session Plan teacher.",
      );
      return;
    }

    const groups = new Map<
      string,
      AcademicLessonPlanInput["items"]
    >();
    for (let index = 0; index < form.items.length; index += 1) {
      const item = form.items[index]!;
      if (!item.sessionPlanUnitId) {
        continue;
      }
      const unit = units.find((u) => u._id === item.sessionPlanUnitId);
      const date = (
        item.itemStartDateBs ||
        (unit ? dateRangeFromUnits([unit]).minBs : "") ||
        form.teachingDateBs ||
        form.startDateBs ||
        ""
      ).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        toast.error(`Row ${index + 1}: pick a date inside this unit’s range`);
        return;
      }
      if (unit && !unitAllowsTeachingDate(unit, date)) {
        toast.error(
          `Row ${index + 1}: Unit ${unit.unitNo} can only be planned ${formatUnitDateWindow(unit)}.`,
        );
        return;
      }
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
      const sanitized = {
        serialNo: (groups.get(date)?.length ?? 0) + 1,
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
        itemStartDateBs: date,
        itemEndDateBs: date,
        estimatedClasses:
          Number.isFinite(item.estimatedClasses) && item.estimatedClasses >= 1
            ? Math.round(item.estimatedClasses)
            : 1,
        remarks: item.remarks || "",
      };
      const list = groups.get(date) ?? [];
      list.push(sanitized);
      groups.set(date, list);
    }

    if (groups.size === 0) {
      toast.error("Add at least one row with a unit and date");
      return;
    }

    for (const [date, list] of groups) {
      groups.set(date, mergeItemsByUnit(list));
    }

    setSavingTable(true);
    try {
      const latestPlans = await unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", { params: listParams }),
      );
      const existingPlans = latestPlans ?? plansQuery.data ?? [];
      let created = 0;
      let updated = 0;
      const dates = [...groups.keys()].sort();
      for (const date of dates) {
        let items = groups.get(date)!;
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
          teachingDateBs: date,
          startDateBs: date,
          endDateBs: date,
          sessionPlanId: form.sessionPlanId,
          monthlyDescription: form.monthlyDescription || "",
          items,
        };
        const editingPlan = editingId
          ? existingPlans.find((p) => p._id === editingId)
          : undefined;
        const editingDate =
          editingPlan?.teachingDateBs || editingPlan?.startDateBs || "";
        const existing =
          (editingPlan && editingDate === date ? editingPlan : undefined) ||
          existingPlans.find((p) => {
            const pDate = p.teachingDateBs || p.startDateBs || "";
            const sameSession =
              !form.sessionPlanId ||
              !p.sessionPlanId ||
              p.sessionPlanId === form.sessionPlanId;
            const sameTeacher =
              !resolvedTeacherId || p.teacherId === resolvedTeacherId;
            return (
              sameSession &&
              sameTeacher &&
              pDate === date &&
              (p.status === "DRAFT" || p.status === "REJECTED")
            );
          });
        if (existing && existing._id !== editingId) {
          const existingItems: AcademicLessonPlanInput["items"] =
            existing.items.map((item, index) => {
              const titles = normalizeSubUnitTitles(
                item.subUnitTitles,
                item.subUnitTitle,
              );
              return {
                serialNo: item.serialNo || index + 1,
                sessionPlanUnitId: item.sessionPlanUnitId || "",
                subUnitTitle: joinSubUnitTitles(titles),
                subUnitTitles: titles,
                syllabusId: item.syllabusId || "",
                syllabusChapterId: item.syllabusChapterId || "",
                syllabusUnitId: item.syllabusUnitId || "",
                syllabusSubUnitId: item.syllabusSubUnitId || "",
                syllabusSubUnitIds: item.syllabusSubUnitIds ?? [],
                subjectLabel: item.subjectLabel || "",
                plannedTopic: item.plannedTopic || joinSubUnitTitles(titles),
                description: item.description || "",
                learningObjectives: item.learningObjectives || "",
                teachingMethod: item.teachingMethod || "",
                teachingAids: item.teachingAids || "",
                assessmentMethod: item.assessmentMethod || "",
                deadline: item.deadline || "",
                itemStartDateBs: date,
                itemEndDateBs: date,
                estimatedClasses: item.estimatedClasses || 1,
                remarks: item.remarks || "",
              };
            });
          items = mergeItemsByUnit([...existingItems, ...items]);
          payload.items = items;
        }
        if (existing) {
          await unwrap(
            api.put(`/academic-management/lesson-plans/${existing._id}`, payload),
          );
          updated += 1;
        } else {
          try {
            await unwrap(
              api.post("/academic-management/lesson-plans", payload),
            );
            created += 1;
          } catch (error) {
            const message = parseErrorMessage(error);
            if (!/duplicate|already|E11000/i.test(message)) throw error;
            const retryList = await unwrap<AcademicLessonPlanRecord[]>(
              api.get("/academic-management/lesson-plans", { params: listParams }),
            );
            const retry = retryList.find((p) => {
              const pDate = p.teachingDateBs || p.startDateBs || "";
              return pDate === date && (p.status === "DRAFT" || p.status === "REJECTED");
            });
            if (!retry) throw error;
            const existingItems: AcademicLessonPlanInput["items"] =
              retry.items.map((item, index) => {
                const titles = normalizeSubUnitTitles(
                  item.subUnitTitles,
                  item.subUnitTitle,
                );
                return {
                  serialNo: item.serialNo || index + 1,
                  sessionPlanUnitId: item.sessionPlanUnitId || "",
                  subUnitTitle: joinSubUnitTitles(titles),
                  subUnitTitles: titles,
                  syllabusId: item.syllabusId || "",
                  syllabusChapterId: item.syllabusChapterId || "",
                  syllabusUnitId: item.syllabusUnitId || "",
                  syllabusSubUnitId: item.syllabusSubUnitId || "",
                  syllabusSubUnitIds: item.syllabusSubUnitIds ?? [],
                  subjectLabel: item.subjectLabel || "",
                  plannedTopic: item.plannedTopic || joinSubUnitTitles(titles),
                  description: item.description || "",
                  learningObjectives: item.learningObjectives || "",
                  teachingMethod: item.teachingMethod || "",
                  teachingAids: item.teachingAids || "",
                  assessmentMethod: item.assessmentMethod || "",
                  deadline: item.deadline || "",
                  itemStartDateBs: date,
                  itemEndDateBs: date,
                  estimatedClasses: item.estimatedClasses || 1,
                  remarks: item.remarks || "",
                };
              });
            payload.items = mergeItemsByUnit([...existingItems, ...items]);
            await unwrap(
              api.put(`/academic-management/lesson-plans/${retry._id}`, payload),
            );
            updated += 1;
          }
        }
      }
      const parts = [
        created ? `${created} day(s) added` : "",
        updated ? `${updated} day(s) updated` : "",
      ].filter(Boolean);
      toast.success(
        parts.length ? `Lesson plan saved — ${parts.join(", ")}` : "Lesson plan saved",
      );
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      resetLessonForm();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setSavingTable(false);
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
    // Keep every teaching day. Only collapse same-day batch-instance copies.
    return dedupeLessonPlansByDay(matched);
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

  const selectedSessionPlan = useMemo(
    () => usableSessionPlans.find((p) => p._id === form.sessionPlanId),
    [usableSessionPlans, form.sessionPlanId],
  );

  const units = useMemo(() => {
    const byId = new Map<string, AcademicSessionPlanUnitRecord>();
    const add = (list?: AcademicSessionPlanUnitRecord[]) => {
      for (const unit of list ?? []) {
        if (!unit?._id) continue;
        const prev = byId.get(unit._id);
        byId.set(unit._id, {
          ...(prev ?? unit),
          ...unit,
          topicsCovered: unit.topicsCovered?.trim() || prev?.topicsCovered || "",
          chapterName: unit.chapterName?.trim() || prev?.chapterName || "",
          syllabusId: unit.syllabusId || prev?.syllabusId,
          syllabusChapterId: unit.syllabusChapterId || prev?.syllabusChapterId,
          syllabusUnitId: unit.syllabusUnitId || prev?.syllabusUnitId,
          startDateBs:
            normalizeBsDate(unit.startDateBs) ||
            normalizeBsDate(prev?.startDateBs) ||
            unit.startDateBs ||
            prev?.startDateBs ||
            "",
          endDateBs:
            normalizeBsDate(unit.endDateBs) ||
            normalizeBsDate(prev?.endDateBs) ||
            unit.endDateBs ||
            prev?.endDateBs ||
            "",
        });
      }
    };
    add(selectedSessionPlan?.units);
    add(coverageQuery.data?.units);
    add(unitsQuery.data);
    return [...byId.values()].sort((a, b) => (a.unitNo ?? 0) - (b.unitNo ?? 0));
  }, [
    selectedSessionPlan?.units,
    coverageQuery.data?.units,
    unitsQuery.data,
  ]);

  const sessionPlanDateRange = useMemo(
    () => dateRangeFromUnits(units),
    [units],
  );

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
            Fill the college table one row at a time:{" "}
            <strong>Date · Unit No. · Unit Name · Sub-Unit · C/Hr · Remarks</strong>.
            Add as many days as you need, then save.
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
              const subjectId =
                selectedSubject?.subjectIds?.[0] || filters.subjectId || "";
              setForm((current) => ({
                ...current,
                subjectId: subjectId || current.subjectId,
                teacherId:
                  teacherId ||
                  selectedSubject?.teacherIds?.[0] ||
                  current.teacherId,
                academicYearBs:
                  filters.academicYearBs || current.academicYearBs,
              }));
              setShowForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {showForm ? "Close form" : "Make lesson plan"}
          </Button>
        ) : null}
      </div>

      {showForm && canMutate ? (
        <div ref={formTopRef}>
        <Card className="no-print border-brand-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle>
              {editingId ? "Edit lesson plan" : "Make lesson plan"}
            </CardTitle>
            <p className="text-sm text-slate-600">
              Choose the Session Plan, then fill rows like the paper sheet.
              Click <strong>Add row</strong> for the next day.
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
                Session Plan
              </p>
              <p className="text-xs text-slate-500">
                Pick the Session Plan. Units and sub-units for the table come from it.
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
                    const planDates = sessionPlanFixedDates(plan?.units ?? []);
                    autoSelectedForPlanRef.current = event.target.value || "";
                    setForm((current) => {
                      const defaultTeaching =
                        (current.teachingDateBs &&
                        planDates.includes(current.teachingDateBs)
                          ? current.teachingDateBs
                          : "") ||
                        planDates[0] ||
                        "";
                      const firstRow =
                        current.items[0] ??
                        {
                          ...emptyItem(1),
                          itemStartDateBs: defaultTeaching,
                          itemEndDateBs: defaultTeaching,
                        };
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
                        items:
                          current.items.length > 0
                            ? current.items
                            : [firstRow],
                      };
                    });
                    if (plan?.units?.length) {
                      toast.success(
                        `Session Plan loaded. Fill the table: date, unit, sub-unit, hours.`,
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

            {form.sessionPlanId ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lesson plan table
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={addLessonRow}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add row
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setForm((current) => {
                          const last = current.items[current.items.length - 1];
                          const lastDate =
                            last?.itemStartDateBs ||
                            current.teachingDateBs ||
                            sessionPlanDateRange.minBs ||
                            "";
                          const nextDate = clampBsDate(
                            nextBsDate(lastDate || sessionPlanDateRange.minBs),
                            sessionPlanDateRange.minBs,
                            sessionPlanDateRange.maxBs,
                          );
                          return {
                            ...current,
                            items: [
                              ...current.items,
                              {
                                ...emptyItem(current.items.length + 1),
                                itemStartDateBs: nextDate,
                                itemEndDateBs: nextDate,
                              },
                            ],
                          };
                        });
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add next day
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-300">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="w-12 border border-slate-300 px-2 py-2 text-center text-xs font-semibold">
                          S.N
                        </th>
                        <th className="w-20 border border-slate-300 px-2 py-2 text-center text-xs font-semibold">
                          Unit No.
                        </th>
                        <th className="w-56 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                          Unit Name
                        </th>
                        <th className="w-[13.5rem] border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                          Date
                        </th>
                        <th className="border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                          Sub-Unit
                        </th>
                        <th className="w-16 border border-slate-300 px-2 py-2 text-center text-xs font-semibold">
                          C/Hr
                        </th>
                        <th className="w-32 border border-slate-300 px-2 py-2 text-left text-xs font-semibold">
                          Remarks
                        </th>
                        <th className="w-10 border border-slate-300 px-1 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="border border-slate-300 px-3 py-6 text-center text-sm text-slate-500"
                          >
                            Click Add row to start the table.
                          </td>
                        </tr>
                      ) : (
                        form.items.map((item, index) => {
                          const unit = units.find(
                            (u) => u._id === item.sessionPlanUnitId,
                          );
                          const selectedTitles = normalizeSubUnitTitles(
                            item.subUnitTitles,
                            item.subUnitTitle,
                          );
                          const subOptions = [
                            ...collectLessonSubUnitOptions(unit, [
                              matchedSyllabus,
                              ...(syllabiQuery.data ?? []),
                            ]),
                            ...selectedTitles,
                          ].filter(
                            (t, i, arr) =>
                              arr.findIndex(
                                (x) => titleKey(x) === titleKey(t),
                              ) === i,
                          );
                          const rowRange = unit
                            ? dateRangeFromUnits([unit])
                            : { minBs: "", maxBs: "", minDate: undefined, maxDate: undefined };
                          const rowDate =
                            item.itemStartDateBs ||
                            (unit ? rowRange.minBs : "") ||
                            "";
                          const dateValue =
                            unit && rowDate && unitAllowsTeachingDate(unit, rowDate)
                              ? rowDate
                              : unit
                                ? rowRange.minBs
                                : "";
                          return (
                            <tr key={`${item.sessionPlanUnitId || "new"}-${index}`}>
                              <td className="border border-slate-300 px-2 py-2 text-center tabular-nums text-slate-700">
                                {index + 1}
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top">
                                <Select
                                  value={item.sessionPlanUnitId || ""}
                                  onChange={(event) =>
                                    applyRowUnit(index, event.target.value)
                                  }
                                >
                                  <option value="">Select</option>
                                  {units.map((u) => (
                                    <option key={u._id} value={u._id}>
                                      {u.unitNo}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top text-slate-800">
                                {unit?.chapterName || item.subjectLabel || "—"}
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top">
                                {unit ? (
                                  <NepaliDateField
                                    value={dateValue}
                                    minDate={rowRange.minDate}
                                    maxDate={rowRange.maxDate}
                                    onChange={(value) => {
                                      const next = clampBsDate(
                                        value,
                                        rowRange.minBs,
                                        rowRange.maxBs,
                                      );
                                      setForm((current) => ({
                                        ...current,
                                        teachingDateBs:
                                          current.teachingDateBs || next,
                                        startDateBs:
                                          current.startDateBs || next,
                                        endDateBs: current.endDateBs || next,
                                        items: current.items.map((row, i) =>
                                          i === index
                                            ? {
                                                ...row,
                                                itemStartDateBs: next,
                                                itemEndDateBs: next,
                                              }
                                            : row,
                                        ),
                                      }));
                                    }}
                                    placeholder="Pick date"
                                  />
                                ) : (
                                  <p className="py-2 text-xs text-slate-400">
                                    Select unit first
                                  </p>
                                )}
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top">
                                {item.sessionPlanUnitId ? (
                                  subOptions.length > 0 ? (
                                    <div className="max-h-44 space-y-1 overflow-y-auto">
                                      {subOptions.map((title) => {
                                        const on = selectedTitles.some(
                                          (t) =>
                                            titleKey(t) === titleKey(title),
                                        );
                                        return (
                                          <label
                                            key={title}
                                            className="flex cursor-pointer items-start gap-1.5 text-xs text-slate-700"
                                          >
                                            <input
                                              type="checkbox"
                                              className="mt-0.5"
                                              checked={on}
                                              onChange={(event) => {
                                                const next = event.target.checked
                                                  ? [...selectedTitles, title]
                                                  : selectedTitles.filter(
                                                      (t) =>
                                                        titleKey(t) !==
                                                        titleKey(title),
                                                    );
                                                applyRowSubs(index, next);
                                              }}
                                            />
                                            <span>{title}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : (
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
                                      placeholder="Type sub-unit"
                                    />
                                  )
                                ) : (
                                  <p className="text-xs text-slate-400">
                                    Select a unit first
                                  </p>
                                )}
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top">
                                <NumberInput
                                  className="h-9 w-16"
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
                              </td>
                              <td className="border border-slate-300 px-2 py-2 align-top">
                                <Input
                                  value={item.remarks}
                                  onChange={(event) =>
                                    updateItemField(
                                      index,
                                      "remarks",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="—"
                                />
                              </td>
                              <td className="border border-slate-300 px-1 py-2 align-top text-center">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-rose-600"
                                  onClick={() => removeLessonRow(index)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {!form.sessionPlanId && form.subjectId ? (
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
                  !(teacherId || form.teacherId) ||
                  savingTable
                }
              >
                {savingTable
                  ? "Saving…"
                  : editingId
                    ? "Update draft"
                    : "Save lesson plan"}
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
                <strong>Submit</strong>. An administrator must then{" "}
                <strong>Approve</strong> them, the same as Session Plan and Log
                Book. Use <strong>Continue</strong> to keep editing a draft.
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
              description="Build the college lesson plan table: one row per teaching date with Unit No., Unit Name, Sub-Unit, C/Hr, and Remarks."
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

              {teacherGroups.map((group) => {
                const tableRows = flattenLessonPlanTableRows(group.items);
                const planById = new Map(
                  group.items.map((plan) => [plan._id, plan]),
                );
                const firstRowOfPlan = new Set<string>();
                const showActions = canMutate || isAdmin;
                const pendingPlans = group.items.filter((plan) =>
                  isLessonPlanPending(plan.status),
                );
                return (
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
                    <CardHeader>
                      <CardTitle>Lesson Plan</CardTitle>
                      <p className="text-sm text-slate-600">
                        {group.teacherName}
                        {selectedSubjectMeta
                          ? ` · ${selectedSubjectMeta.subject.subjectName}`
                          : ""}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {isAdmin && pendingPlans.length > 0 ? (
                        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 no-print">
                          <p className="text-sm font-semibold text-amber-950">
                            {pendingPlans.length} lesson plan
                            {pendingPlans.length === 1 ? "" : "s"} waiting for
                            approval
                          </p>
                          {pendingPlans
                            .slice()
                            .sort((a, b) =>
                              (a.teachingDateBs || a.startDateBs || "").localeCompare(
                                b.teachingDateBs || b.startDateBs || "",
                              ),
                            )
                            .map((plan) => (
                              <div
                                key={plan._id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900">
                                    {plan.teachingDateBs ||
                                      plan.startDateBs ||
                                      "—"}
                                    {plan.month ? ` · ${plan.month}` : ""}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {plan.teacher?.user?.fullName ||
                                      group.teacherName}{" "}
                                    · submitted, needs admin approval
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Badge className={statusBadgeClass(plan.status)}>
                                    {plan.status === "SUBMITTED"
                                      ? "PENDING APPROVAL"
                                      : plan.status}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      approveMutation.mutate(plan._id)
                                    }
                                    disabled={approveMutation.isPending}
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
                                    disabled={rejectMutation.isPending}
                                  >
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : null}
                      <div className="overflow-x-auto">
                        <Table className="min-w-[880px]">
                          <TableHead>
                            <tr>
                              <Th className="w-12 text-center">S.N</Th>
                              <Th className="w-28">Date</Th>
                              <Th className="w-20 text-center">Unit No.</Th>
                              <Th>Unit Name</Th>
                              <Th>Sub-Unit</Th>
                              <Th className="w-16 text-center">C/Hr</Th>
                              <Th className="w-28">Remarks</Th>
                              <Th className="w-28">Status</Th>
                              {showActions ? (
                                <Th className="w-44 no-print">Actions</Th>
                              ) : null}
                            </tr>
                          </TableHead>
                          <TableBody>
                            {tableRows.length === 0 ? (
                              <tr>
                                <Td
                                  colSpan={showActions ? 9 : 8}
                                  className="py-6 text-center text-slate-500"
                                >
                                  No lesson plan rows yet.
                                </Td>
                              </tr>
                            ) : (
                              tableRows.map((row, i) => {
                                const plan = planById.get(row.planId);
                                const isFirst =
                                  Boolean(row.planId) &&
                                  !firstRowOfPlan.has(row.planId);
                                if (isFirst) firstRowOfPlan.add(row.planId);
                                return (
                                <tr key={`${row.planId}-${i}`}>
                                  <Td className="text-center tabular-nums">{i + 1}</Td>
                                  <Td className="whitespace-nowrap tabular-nums">
                                    {row.dateBs || "—"}
                                  </Td>
                                  <Td className="text-center tabular-nums">{row.unitNo}</Td>
                                  <Td>{row.unitName}</Td>
                                  <Td className="whitespace-pre-wrap">
                                    {(row.subUnits?.length
                                      ? row.subUnits
                                      : row.subUnit && row.subUnit !== "—"
                                        ? [row.subUnit]
                                        : []
                                    ).map((s, si) => (
                                      <div key={`${si}-${s}`}>{s}</div>
                                    ))}
                                    {!row.subUnits?.length &&
                                    (!row.subUnit || row.subUnit === "—")
                                      ? "—"
                                      : null}
                                  </Td>
                                  <Td className="text-center tabular-nums">{row.hours}</Td>
                                  <Td>{row.remarks || ""}</Td>
                                  <Td>
                                    {isFirst && plan ? (
                                      <Badge
                                        className={statusBadgeClass(plan.status)}
                                      >
                                        {plan.status === "SUBMITTED"
                                          ? "PENDING APPROVAL"
                                          : plan.status}
                                      </Badge>
                                    ) : null}
                                  </Td>
                                  {showActions ? (
                                    <Td className="no-print">
                                      {isFirst && plan ? (
                                        <div className="flex flex-wrap gap-1">
                                          {canEditDelete &&
                                          (plan.status === "DRAFT" ||
                                            plan.status === "REJECTED") ? (
                                            <>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                  openContinueDraft(plan)
                                                }
                                              >
                                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                                Continue
                                              </Button>
                                              <Button
                                                size="sm"
                                                onClick={() =>
                                                  submitMutation.mutate(plan._id)
                                                }
                                                disabled={submitMutation.isPending}
                                              >
                                                <Send className="mr-1 h-3.5 w-3.5" />
                                                Submit
                                              </Button>
                                            </>
                                          ) : null}
                                          {canEditDelete &&
                                          (isAdmin ||
                                            plan.status === "DRAFT" ||
                                            plan.status === "REJECTED") ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                              disabled={deleteMutation.isPending}
                                              onClick={() => {
                                                const dateLabel =
                                                  plan.teachingDateBs ||
                                                  plan.startDateBs ||
                                                  row.dateBs ||
                                                  "this day";
                                                if (
                                                  !window.confirm(
                                                    `Delete the lesson plan for ${dateLabel}?`,
                                                  )
                                                ) {
                                                  return;
                                                }
                                                deleteMutation.mutate(plan._id);
                                              }}
                                            >
                                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                                              Delete
                                            </Button>
                                          ) : null}
                                          {isAdmin &&
                                          isLessonPlanPending(plan.status) ? (
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
                                                    window.prompt(
                                                      "Rejection remarks",
                                                    );
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
                                          {isAdmin &&
                                          plan.status === "APPROVED" ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                unlockMutation.mutate(plan._id)
                                              }
                                            >
                                              Unlock
                                            </Button>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </Td>
                                  ) : null}
                                </tr>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                );
              })}
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
              table-layout: auto;
              font-size: 11px;
              line-height: 1.4;
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
              white-space: pre-wrap;
              word-break: break-word;
            }
            #lesson-plan-print-area .lp-print-table td.lp-sub {
              text-align: left;
              white-space: pre-wrap;
              word-break: break-word;
            }
            #lesson-plan-print-area .lp-print-table td.lp-sub div {
              margin: 0 0 2px;
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
          title="Lesson Plan"
          subtitle={
            selectedSubjectMeta
              ? `${selectedSubjectMeta.faculty.label} · ${selectedSubjectMeta.year.label} · ${selectedSubjectMeta.subject.subjectName}`
              : "Filtered Lesson Plans"
          }
          academicYearBs={filters.academicYearBs}
        />
        {printPlans.length === 0 ? (
          <p className="text-sm text-slate-600">No lesson plans to export.</p>
        ) : (
          groupByTeacher(printPlans).map((group) => {
            const tableRows = flattenLessonPlanTableRows(group.items);
            const subjectName =
              group.items[0]?.subject?.name ??
              selectedSubjectMeta?.subject.subjectName ??
              "—";
            const subjectCode = group.items[0]?.subject?.code;
            return (
            <div key={group.teacherId} className="lp-print-section">
              <p className="lp-print-meta" style={{ fontWeight: 600 }}>
                Teacher: {group.teacherName}
                {" · "}
                Subject: {subjectName}
                {subjectCode ? ` (${subjectCode})` : ""}
              </p>
              <table className="lp-print-table">
                <colgroup>
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th>Date</th>
                    <th>Unit No.</th>
                    <th>Unit Name</th>
                    <th>Sub-Unit</th>
                    <th>C/Hr</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="lp-text">
                        No lesson plan rows.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row, i) => {
                      const subs =
                        row.subUnits?.length > 0
                          ? row.subUnits
                          : row.subUnit && row.subUnit !== "—"
                            ? row.subUnit.split(/;\s*/).filter(Boolean)
                            : [];
                      return (
                      <tr key={`${row.planId}-${row.dateBs}-${row.unitId}-${i}`}>
                        <td className="lp-num">{i + 1}</td>
                        <td className="lp-num">{row.dateBs || "—"}</td>
                        <td className="lp-num">{row.unitNo}</td>
                        <td className="lp-text">{row.unitName}</td>
                        <td className="lp-sub">
                          {subs.length > 0
                            ? subs.map((s, si) => <div key={`${si}-${s}`}>{s}</div>)
                            : "—"}
                        </td>
                        <td className="lp-num">{row.hours}</td>
                        <td className="lp-text">{row.remarks || ""}</td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            );
          })
        )}
        <AcademicPrintFooter />
      </div>
    </div>
  );
};
