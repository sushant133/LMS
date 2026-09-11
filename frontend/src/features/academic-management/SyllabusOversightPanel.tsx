import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcademicManagementFilters,
  AcademicSyllabusChapterRecord,
  AcademicSyllabusSubUnitRecord,
  AcademicSyllabusTopicRecord,
  SubjectAssignmentRecord,
  SubjectRecord,
  SyllabusCompletionSource,
  SyllabusOversightDetail,
  SyllabusOversightListRow,
} from "@phit-erp/shared";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  ListChecks,
  UserRound,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { api, unwrap } from "lib/api";
import { cn, parseErrorMessage } from "lib/utils";
import { AcademicProgressBar } from "./AcademicProgressBar";
import {
  AcademicPrintFooter,
  AcademicPrintHeader,
} from "./AcademicPrintHeader";
import { academicListApiParams } from "./academicManagementUtils";
import { subUnitStatusBadgeClass } from "./syllabusFormUtils";
import type { HierarchyScopeOption } from "./academicHierarchyUtils";

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

const collectLeafIds = (nodes: AcademicSyllabusSubUnitRecord[]): string[] => {
  const ids: string[] = [];
  const walk = (list: AcademicSyllabusSubUnitRecord[]) => {
    for (const node of list) {
      if (node.children?.length) walk(node.children);
      else ids.push(node._id);
    }
  };
  walk(nodes);
  return ids;
};

const attributionLabel = (
  source?: SyllabusCompletionSource,
  countsTowardSalary?: boolean,
): string => {
  if (source === "ADMINISTRATION" || countsTowardSalary === false) {
    return "Administration";
  }
  if (source === "TEACHER") return "Teacher";
  return "";
};

interface SyllabusOversightPanelProps {
  filters: AcademicManagementFilters;
  subjects: Array<
    Pick<SubjectRecord, "_id" | "name" | "code"> & { masterSubjectId?: string | null }
  >;
  teachers: Array<{ _id: string; user: { fullName: string } }>;
  years?: HierarchyScopeOption[];
  classes?: HierarchyScopeOption[];
  assignments?: SubjectAssignmentRecord[];
  isCollege?: boolean;
  institutionName?: string;
  writeAccess?: boolean;
}

export const SyllabusOversightPanel = ({
  filters,
  teachers,
  isCollege = true,
  institutionName = "Institution",
  writeAccess = true,
}: SyllabusOversightPanelProps) => {
  const queryClient = useQueryClient();
  const listParams = useMemo(
    () => academicListApiParams(filters, { isCollege, adminScope: true }),
    [filters, isCollege],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<SyllabusCompletionSource>("ADMINISTRATION");
  const [teacherId, setTeacherId] = useState("");
  const [deliveredByName, setDeliveredByName] = useState("");
  const [dateBs, setDateBs] = useState(formatTodayBs);
  const [note, setNote] = useState("");
  const [selectedLeaves, setSelectedLeaves] = useState<Set<string>>(new Set());
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const listQuery = useQuery({
    queryKey: ["academic-management", "syllabus-oversight", listParams],
    queryFn: () =>
      unwrap<SyllabusOversightListRow[]>(
        api.get("/academic-management/syllabus-oversight", { params: listParams }),
      ),
  });

  const detailQuery = useQuery({
    queryKey: ["academic-management", "syllabus-oversight", selectedId],
    queryFn: () =>
      unwrap<SyllabusOversightDetail>(
        api.get(`/academic-management/syllabus-oversight/${selectedId}`),
      ),
    enabled: Boolean(selectedId),
  });

  const completeMutation = useMutation({
    mutationFn: (payload: {
      source: SyllabusCompletionSource;
      teacherId?: string;
      deliveredByName?: string;
      dateBs: string;
      note?: string;
      subUnitIds: string[];
    }) =>
      unwrap<SyllabusOversightDetail>(
        api.post(`/academic-management/syllabus-oversight/${selectedId}/complete`, payload),
      ),
    onSuccess: (detail) => {
      toast.success(
        source === "TEACHER"
          ? "Marked complete for the teacher — syllabus, log book, and salary"
          : "Marked complete by administration — syllabus and log book only (not salary)",
      );
      setSelectedLeaves(new Set());
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      queryClient.setQueryData(
        ["academic-management", "syllabus-oversight", selectedId],
        detail,
      );
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rows = listQuery.data ?? [];
  const detail = detailQuery.data;
  const syllabus = detail?.syllabus;

  const assignedTeachers = detail?.assignedTeachers ?? [];
  const teacherOptions = useMemo(() => {
    if (assignedTeachers.length > 0) {
      return assignedTeachers.map((row) => ({
        _id: row.teacherId,
        name: row.teacherName,
      }));
    }
    return teachers.map((row) => ({
      _id: row._id,
      name: row.user?.fullName || "Teacher",
    }));
  }, [assignedTeachers, teachers]);

  const toggleLeaf = (id: string, checked: boolean) => {
    setSelectedLeaves((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectableLeaf = (sub: AcademicSyllabusSubUnitRecord): boolean => {
    const done = sub.status === "COMPLETED" || sub.status === "SKIPPED";
    return includeCompleted || !done;
  };

  const selectUnitLeaves = (unit: AcademicSyllabusTopicRecord, checked: boolean) => {
    const ids = collectLeafIds(unit.subUnits ?? []).filter((id) => {
      const leaf = (detail?.leaves ?? []).find((row) => row.subUnitId === id);
      if (!leaf) return checked;
      const done = leaf.status === "COMPLETED" || leaf.status === "SKIPPED";
      return includeCompleted || !done;
    });
    setSelectedLeaves((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!selectedId) return;
    if (selectedLeaves.size === 0) {
      toast.error("Select at least one unit or sub-unit");
      return;
    }
    if (source === "TEACHER" && !teacherId) {
      toast.error("Select the subject teacher so this counts toward their salary");
      return;
    }
    completeMutation.mutate({
      source,
      teacherId: teacherId || undefined,
      deliveredByName: source === "ADMINISTRATION" ? deliveredByName : undefined,
      dateBs,
      note,
      subUnitIds: [...selectedLeaves],
    });
  };

  const renderSubTree = (
    nodes: AcademicSyllabusSubUnitRecord[],
    depth = 0,
  ): ReactNode =>
    nodes.map((node) => {
      const isLeaf = !node.children?.length;
      const done = node.status === "COMPLETED" || node.status === "SKIPPED";
      const sourceLabel = attributionLabel(
        node.attribution?.source,
        node.attribution?.countsTowardSalary,
      );
      return (
        <div key={node._id} className={cn(depth > 0 && "ml-4")}>
          <label
            className={cn(
              "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm",
              isLeaf ? "hover:bg-slate-50" : "font-medium text-slate-800",
            )}
          >
            {isLeaf ? (
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={selectedLeaves.has(node._id)}
                disabled={!writeAccess || !selectableLeaf(node)}
                onChange={(event) => toggleLeaf(node._id, event.target.checked)}
              />
            ) : (
              <span className="mt-0.5 h-4 w-4" />
            )}
            <span className="min-w-0 flex-1">
              <span className="text-slate-900">
                {node.displayNo} {node.heading || "—"}
              </span>
              {node.teachingHours ? (
                <span className="text-slate-500"> · {node.teachingHours}h</span>
              ) : null}
              <span className="ml-2 inline-flex flex-wrap gap-1">
                <Badge className={subUnitStatusBadgeClass(node.status)}>{node.status}</Badge>
                {sourceLabel ? (
                  <Badge
                    className={
                      sourceLabel === "Administration"
                        ? "bg-violet-100 text-violet-800"
                        : "bg-sky-100 text-sky-800"
                    }
                  >
                    {sourceLabel}
                    {node.attribution?.countsTowardSalary === false
                      ? " · not salary"
                      : node.attribution?.source === "TEACHER"
                        ? " · salary"
                        : ""}
                  </Badge>
                ) : null}
                {done && node.attribution?.completedByTeacherName ? (
                  <span className="text-xs text-slate-500">
                    {node.attribution.completedByTeacherName}
                  </span>
                ) : null}
                {done && node.attribution?.deliveredByName ? (
                  <span className="text-xs text-slate-500">
                    Extra: {node.attribution.deliveredByName}
                  </span>
                ) : null}
              </span>
            </span>
          </label>
          {node.children?.length ? renderSubTree(node.children, depth + 1) : null}
        </div>
      );
    });

  const renderChapter = (chapter: AcademicSyllabusChapterRecord) =>
    (chapter.units ?? []).map((unit) => {
      const leafIds = collectLeafIds(unit.subUnits ?? []);
      const open = expandedUnits.has(unit._id) || leafIds.some((id) => selectedLeaves.has(id));
      const unitDone = unit.totalSubUnits > 0 && unit.completedSubUnits === unit.totalSubUnits;
      return (
        <div key={unit._id} className="rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              onClick={() =>
                setExpandedUnits((current) => {
                  const next = new Set(current);
                  if (next.has(unit._id)) next.delete(unit._id);
                  else next.add(unit._id);
                  return next;
                })
              }
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              disabled={!writeAccess}
              checked={leafIds.length > 0 && leafIds.every((id) => selectedLeaves.has(id))}
              onChange={(event) => selectUnitLeaves(unit, event.target.checked)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Unit {unit.unitNo}
                {chapter.title ? ` · ${chapter.title}` : ""}: {unit.title || "—"}
              </p>
              <p className="text-xs text-slate-500">
                {unit.completedSubUnits}/{unit.totalSubUnits} sub-units · {unit.completedPercent}%
                {unitDone ? " · complete" : ""}
              </p>
            </div>
          </div>
          {open ? (
            <div className="border-t border-slate-100 px-2 py-2">
              {unit.subUnits?.length ? (
                renderSubTree(unit.subUnits)
              ) : (
                <p className="px-2 text-xs text-slate-500">No sub-units in this unit.</p>
              )}
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <div className="space-y-6" id="syllabus-oversight-print-area">
      <AcademicPrintHeader
        title="Syllabus Completion Oversight"
        institutionName={institutionName}
        academicYearBs={filters.academicYearBs}
      />

      <div className="no-print">
        <h2 className="text-lg font-semibold text-slate-900">Syllabus Completion Oversight</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Administrator and Super Admin only. Mark units and sub-units complete in two ways:
          extra lectures from administration (counts on the official syllabus and log book, not
          the assigned teacher&apos;s salary) or on behalf of the subject teacher (syllabus, that
          teacher&apos;s completion, and salary).
        </p>
      </div>

      {listQuery.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No syllabi found"
          description="Create official subject syllabi first, then oversee completion here."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>All subjects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((row) => (
                <button
                  key={row._id}
                  type="button"
                  onClick={() => {
                    setSelectedId(row._id);
                    setSelectedLeaves(new Set());
                    const assigned = row.assignedTeachers[0]?.teacherId ?? "";
                    setTeacherId(assigned);
                  }}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2.5 text-left transition",
                    selectedId === row._id
                      ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {row.subjectName}
                        {row.subjectCode ? ` (${row.subjectCode})` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[row.yearLabel, row.className, row.faculty].filter(Boolean).join(" · ") ||
                          "Curriculum"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-800">
                      {row.completedPercent}%
                    </span>
                  </div>
                  <AcademicProgressBar
                    completedPercent={row.completedPercent}
                    remainingPercent={row.remainingPercent}
                    compact
                    className="mt-2"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Teacher {row.teacherPercent}% · Admin {row.administrationPercent}% · Remaining{" "}
                    {row.remainingPercent}%
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {!selectedId ? (
              <EmptyState
                title="Select a subject"
                description="Choose a syllabus on the left to review units, sub-units, who completed what, and to fill completion."
              />
            ) : detailQuery.isLoading ? (
              <LoadingState />
            ) : !detail || !syllabus ? (
              <EmptyState title="Could not load this syllabus" />
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {syllabus.subject?.name || "Subject"}
                      {syllabus.subject?.code ? ` (${syllabus.subject.code})` : ""}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500">Official syllabus</p>
                        <p className="text-2xl font-semibold text-slate-900">
                          {detail.summary.completedPercent}%
                        </p>
                        <p className="text-xs text-slate-500">
                          {detail.summary.completedLeaves}/{detail.summary.totalLeaves} leaves
                        </p>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                        <p className="text-xs font-medium text-sky-700">Teacher (salary)</p>
                        <p className="text-2xl font-semibold text-sky-900">
                          {detail.summary.teacherPercent}%
                        </p>
                        <p className="text-xs text-sky-700">
                          {detail.summary.teacherLeaves} leaves on assigned teachers
                        </p>
                      </div>
                      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                        <p className="text-xs font-medium text-violet-700">Administration</p>
                        <p className="text-2xl font-semibold text-violet-900">
                          {detail.summary.administrationPercent}%
                        </p>
                        <p className="text-xs text-violet-700">
                          {detail.summary.administrationLeaves} extra-lecture leaves (not salary)
                        </p>
                      </div>
                    </div>
                    <AcademicProgressBar
                      completedPercent={detail.summary.completedPercent}
                      remainingPercent={detail.summary.remainingPercent}
                    />
                  </CardContent>
                </Card>

                {writeAccess ? (
                  <Card className="no-print">
                    <CardHeader>
                      <CardTitle>Record completion</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setSource("ADMINISTRATION")}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left text-sm",
                            source === "ADMINISTRATION"
                              ? "border-violet-600 bg-violet-50 font-semibold text-violet-900 ring-1 ring-violet-600"
                              : "border-slate-200 bg-white text-slate-700",
                          )}
                        >
                          <Building2 className="mb-1 h-4 w-4" />
                          By administration
                          <span className="mt-1 block text-xs font-normal text-slate-500">
                            Extra lectures / other person. Adds to syllabus and log book. Does not
                            add to the assigned teacher&apos;s salary.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSource("TEACHER")}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left text-sm",
                            source === "TEACHER"
                              ? "border-sky-600 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-600"
                              : "border-slate-200 bg-white text-slate-700",
                          )}
                        >
                          <UserRound className="mb-1 h-4 w-4" />
                          By subject teacher
                          <span className="mt-1 block text-xs font-normal text-slate-500">
                            Files the log book under that teacher and counts toward their
                            completion and salary.
                          </span>
                        </button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <FormField
                          label={
                            source === "TEACHER"
                              ? "Subject teacher (salary)"
                              : "Log book teacher (not paid)"
                          }
                        >
                          <Select
                            value={teacherId}
                            onChange={(event) => setTeacherId(event.target.value)}
                          >
                            <option value="">
                              {source === "TEACHER" ? "Select teacher" : "Assigned teacher (default)"}
                            </option>
                            {teacherOptions.map((teacher) => (
                              <option key={teacher._id} value={teacher._id}>
                                {teacher.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label="Completion date (BS)">
                          <NepaliDateField value={dateBs} onChange={setDateBs} />
                        </FormField>
                        {source === "ADMINISTRATION" ? (
                          <FormField label="Delivered by (optional)">
                            <Input
                              value={deliveredByName}
                              onChange={(event) => setDeliveredByName(event.target.value)}
                              placeholder="Guest / extra-lecture instructor"
                            />
                          </FormField>
                        ) : null}
                        <FormField label="Remarks">
                          <Textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder={
                              source === "ADMINISTRATION"
                                ? "e.g. Extra lectures arranged by administration for Units 1–2"
                                : "e.g. Recorded on behalf of the assigned teacher"
                            }
                          />
                        </FormField>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={includeCompleted}
                          onChange={(event) => setIncludeCompleted(event.target.checked)}
                        />
                        Include already completed leaves (re-attribute who taught them)
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          onClick={handleSubmit}
                          disabled={completeMutation.isPending}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {completeMutation.isPending
                            ? "Saving…"
                            : `Mark ${selectedLeaves.size || ""} selected complete`.trim()}
                        </Button>
                        <p className="text-xs text-slate-500">
                          The assigned teacher continues the log book from the next remaining
                          units.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle>Units and sub-units</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(syllabus.chapters ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">No hierarchical units in this syllabus.</p>
                    ) : (
                      (syllabus.chapters ?? []).flatMap((chapter) => renderChapter(chapter))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4" />
                      Completed by whom
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {assignedTeachers.length > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {assignedTeachers.map((teacher) => (
                          <div
                            key={teacher.teacherId}
                            className="rounded-xl border border-slate-200 p-3"
                          >
                            <p className="font-medium text-slate-900">{teacher.teacherName}</p>
                            <p className="text-xs text-slate-500">
                              {teacher.assignmentType === "UNIT" && teacher.unitFrom
                                ? `Units ${teacher.unitFrom}–${teacher.unitTo}`
                                : teacher.assignmentType === "PERCENTAGE"
                                  ? `Allotted ${teacher.assignedPercentage}%`
                                  : "Full subject"}
                              {teacher.handoverBaselinePercent != null
                                ? ` · leftover from ${teacher.handoverBaselinePercent}%`
                                : ""}
                            </p>
                            <p className="mt-2 text-sm text-slate-700">
                              Salary completion {teacher.salaryPercent}% ({teacher.completedLeaves}/
                              {teacher.allottedLeaves} allotted)
                            </p>
                            <p className="text-xs text-violet-700">
                              Administration extra lectures in allotment:{" "}
                              {teacher.administrationLeaves}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No active subject assignment yet.</p>
                    )}

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs uppercase tracking-wide text-slate-500">
                            <th className="py-2 pr-3">Unit / sub-unit</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Completed by</th>
                            <th className="py-2">Salary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.leaves ?? []).map((leaf) => {
                            const who = leaf.attribution?.source
                              ? leaf.attribution.source === "ADMINISTRATION"
                                ? `Administration${
                                    leaf.attribution.deliveredByName
                                      ? ` (${leaf.attribution.deliveredByName})`
                                      : ""
                                  }`
                                : leaf.attribution.completedByTeacherName || "Teacher"
                              : leaf.status === "COMPLETED"
                                ? "Completed"
                                : "—";
                            return (
                              <tr key={leaf.subUnitId} className="border-b border-slate-100">
                                <td className="py-2 pr-3">
                                  <span className="font-medium">
                                    {leaf.displayNo} {leaf.heading || "—"}
                                  </span>
                                  <span className="block text-xs text-slate-500">
                                    Unit {leaf.unitNo}: {leaf.unitTitle || "—"}
                                  </span>
                                </td>
                                <td className="py-2 pr-3">
                                  <Badge className={subUnitStatusBadgeClass(leaf.status)}>
                                    {leaf.status}
                                  </Badge>
                                </td>
                                <td className="py-2 pr-3">{who}</td>
                                <td className="py-2">
                                  {leaf.status === "COMPLETED" || leaf.status === "SKIPPED"
                                    ? leaf.attribution?.countsTowardSalary === false ||
                                      leaf.attribution?.source === "ADMINISTRATION"
                                      ? "No"
                                      : "Yes"
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4" />
                      Related academic details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Session plans</p>
                      {detail.related.sessionPlans.length === 0 ? (
                        <p className="text-sm text-slate-600">None yet</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm">
                          {detail.related.sessionPlans.map((plan) => (
                            <li key={plan._id}>
                              {plan.teacherName}: {plan.completedPercent}% ({plan.status})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Lesson plans</p>
                      <p className="text-sm text-slate-800">{detail.related.lessonPlanCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Log book</p>
                      <p className="text-sm text-slate-800">
                        Teacher entries {detail.related.logBookTeacherEntries} · Administration{" "}
                        {detail.related.logBookAdministrationEntries}
                      </p>
                      {detail.related.lastLogBookDateBs ? (
                        <p className="text-xs text-slate-500">
                          Last entry {detail.related.lastLogBookDateBs}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Assigned teachers</p>
                      {assignedTeachers.length === 0 ? (
                        <p className="text-sm text-slate-600">None active</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm">
                          {assignedTeachers.map((teacher) => (
                            <li key={teacher.teacherId}>{teacher.teacherName}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
      <AcademicPrintFooter />
    </div>
  );
};
