import { ChevronDown, ChevronRight, BookOpen, GraduationCap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "components/ui/badge";
import { useIsFullAdministrator } from "hooks/useModuleAccess";
import { cn } from "lib/utils";
import type {
  HierarchyFacultyNode,
  HierarchySubjectNode,
  HierarchyYearNode,
} from "./academicHierarchyUtils";
import {
  FacultyDeleteForm,
  FacultyRenameForm,
  facultyValueOf,
  SubjectMoveForm,
  TreeRowMenu,
} from "./FacultyTreeActions";

interface AcademicYearSubjectTreeProps {
  /** Faculty → Year → Subject hierarchy (preferred). */
  faculties?: HierarchyFacultyNode[];
  /** Flat years (used when faculties not provided — merged across faculties). */
  hierarchy?: HierarchyYearNode[];
  selectedFacultyKey?: string | null;
  selectedYearKey?: string | null;
  selectedSubjectKey?: string | null;
  onSelectSubject: (
    facultyKey: string,
    yearKey: string,
    subject: HierarchySubjectNode,
  ) => void;
  emptyMessage?: string;
  defaultExpandAll?: boolean;
  className?: string;
  /** Teacher-facing syllabus / official plans: never show a teacher name. */
  hideTeacherNames?: boolean;
  /** Show the ⋮ menus (rename / delete faculty, move / delete subject). Administrator only. */
  allowStructureEdits?: boolean;
}

export const AcademicYearSubjectTree = ({
  faculties,
  hierarchy,
  selectedFacultyKey,
  selectedYearKey,
  selectedSubjectKey,
  onSelectSubject,
  emptyMessage = "No years or subjects match the current filters.",
  defaultExpandAll = true,
  className,
  hideTeacherNames = false,
  allowStructureEdits = true,
}: AcademicYearSubjectTreeProps) => {
  const isFullAdmin = useIsFullAdministrator();
  const [renamingFaculty, setRenamingFaculty] = useState<string | null>(null);
  const [movingSubject, setMovingSubject] = useState<string | null>(null);
  // Faculty key, or the subject composite key, whose delete confirmation is open
  const [deleting, setDeleting] = useState<string | null>(null);
  const facultyNodes: HierarchyFacultyNode[] = useMemo(() => {
    if (faculties && faculties.length > 0) return faculties;
    if (hierarchy && hierarchy.length > 0) {
      return [
        {
          key: "faculty:general",
          label: "Program",
          years: hierarchy,
          recordCount: hierarchy.reduce((s, y) => s + y.recordCount, 0),
        },
      ];
    }
    return [];
  }, [faculties, hierarchy]);

  const showFacultyLevel =
    facultyNodes.length > 1 ||
    (facultyNodes.length === 1 && facultyNodes[0]!.key !== "faculty:general");
  // Rename / move only make sense once faculties are shown as their own level
  const canEditStructure = allowStructureEdits && isFullAdmin && showFacultyLevel;

  const allFacultyKeys = useMemo(
    () => facultyNodes.map((f) => f.key),
    [facultyNodes],
  );
  const allYearKeys = useMemo(
    () => facultyNodes.flatMap((f) => f.years.map((y) => `${f.key}::${y.key}`)),
    [facultyNodes],
  );

  const [expandedFaculties, setExpandedFaculties] = useState<Set<string>>(
    () => new Set(defaultExpandAll ? allFacultyKeys : []),
  );
  const [expandedYears, setExpandedYears] = useState<Set<string>>(
    () => new Set(defaultExpandAll ? allYearKeys : []),
  );

  useEffect(() => {
    if (defaultExpandAll) {
      setExpandedFaculties(new Set(allFacultyKeys));
      setExpandedYears(new Set(allYearKeys));
    }
  }, [allFacultyKeys.join("|"), allYearKeys.join("|"), defaultExpandAll]);

  const toggleFaculty = (key: string) => {
    setExpandedFaculties((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleYear = (compositeKey: string) => {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(compositeKey)) next.delete(compositeKey);
      else next.add(compositeKey);
      return next;
    });
  };

  if (facultyNodes.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden",
        className,
      )}
    >
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">
          Academic structure
        </p>
        <p className="text-xs text-slate-500">
          {showFacultyLevel
            ? "Faculty / Program → Year → Subject (shared across batches)"
            : "Year → Subject (shared curriculum, not by student batch)"}
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {facultyNodes.map((faculty) => {
          const facultyOpen =
            !showFacultyLevel || expandedFaculties.has(faculty.key);
          return (
            <li key={faculty.key}>
              {showFacultyLevel && renamingFaculty === faculty.key ? (
                <FacultyRenameForm
                  facultyValue={facultyValueOf(faculty.key, faculty.label)}
                  initialLabel={faculty.label}
                  onClose={() => setRenamingFaculty(null)}
                />
              ) : showFacultyLevel ? (
                <div className="flex items-center gap-1 pr-2 transition hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => toggleFaculty(faculty.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-3 pl-4 text-left"
                  >
                    {facultyOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <GraduationCap className="h-4 w-4 shrink-0 text-brand-600" />
                    <span className="min-w-0 break-words font-semibold text-slate-900">
                      {faculty.label}
                    </span>
                    <Badge className="ml-auto shrink-0 bg-slate-100 text-slate-700">
                      {faculty.years.length} year
                      {faculty.years.length === 1 ? "" : "s"}
                    </Badge>
                  </button>
                  {canEditStructure ? (
                    <TreeRowMenu
                      label={`Options for ${faculty.label}`}
                      items={[
                        {
                          label:
                            faculty.key === "faculty:general"
                              ? "Name this program"
                              : "Rename",
                          onSelect: () => setRenamingFaculty(faculty.key),
                        },
                        // General holds every record without a faculty: never deleted whole
                        ...(faculty.key === "faculty:general"
                          ? []
                          : [
                              {
                                label: "Delete",
                                danger: true,
                                onSelect: () => setDeleting(faculty.key),
                              },
                            ]),
                      ]}
                    />
                  ) : null}
                </div>
              ) : null}
              {canEditStructure && deleting === faculty.key ? (
                <FacultyDeleteForm
                  className="mx-4 mb-3"
                  facultyValue={facultyValueOf(faculty.key, faculty.label)}
                  facultyLabel={faculty.label}
                  onClose={() => setDeleting(null)}
                />
              ) : null}

              {facultyOpen ? (
                <ul
                  className={cn(
                    showFacultyLevel && "border-t border-slate-50 bg-slate-50/30",
                  )}
                >
                  {faculty.years.map((year) => {
                    const yearComposite = `${faculty.key}::${year.key}`;
                    const yearOpen = expandedYears.has(yearComposite);
                    return (
                      <li key={yearComposite}>
                        <button
                          type="button"
                          onClick={() => toggleYear(yearComposite)}
                          className={cn(
                            "flex w-full items-center gap-2 py-2.5 text-left hover:bg-slate-50 transition",
                            showFacultyLevel ? "px-4 pl-8" : "px-4",
                          )}
                        >
                          {yearOpen ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                          )}
                          <span className="font-semibold text-slate-800">
                            {year.label}
                          </span>
                          <Badge className="ml-auto bg-slate-100 text-slate-700">
                            {year.subjects.length} subject
                            {year.subjects.length === 1 ? "" : "s"}
                            {year.recordCount > 0
                              ? ` · ${year.recordCount}`
                              : ""}
                          </Badge>
                        </button>
                        {yearOpen ? (
                          <ul className="pb-2">
                            {year.subjects.map((subject) => {
                              const active =
                                selectedSubjectKey === subject.subjectKey &&
                                selectedYearKey === year.key &&
                                (!selectedFacultyKey ||
                                  selectedFacultyKey === faculty.key);
                              const subjectComposite = `${yearComposite}-${subject.subjectKey}`;
                              const moveTargets = facultyNodes
                                .filter(
                                  (other) =>
                                    other.key !== faculty.key &&
                                    other.key !== "faculty:general",
                                )
                                .map((other) => ({
                                  value: other.label,
                                  label: other.label,
                                }));
                              return (
                                <li
                                  key={subjectComposite}
                                  className={cn(canEditStructure && "relative")}
                                >
                                  {canEditStructure ? (
                                    <div className="absolute right-2 top-2 z-10">
                                      <TreeRowMenu
                                        label={`Options for ${subject.subjectName}`}
                                        items={[
                                          {
                                            label: "Move to another faculty / program",
                                            onSelect: () =>
                                              setMovingSubject(subjectComposite),
                                          },
                                          {
                                            label: "Delete",
                                            danger: true,
                                            onSelect: () =>
                                              setDeleting(subjectComposite),
                                          },
                                        ]}
                                      />
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onSelectSubject(
                                        faculty.key,
                                        year.key,
                                        subject,
                                      )
                                    }
                                    className={cn(
                                      "flex w-full items-start gap-2 py-2.5 text-left text-sm transition",
                                      showFacultyLevel ? "pl-14 pr-4" : "pl-10 pr-4",
                                      // Room for the ⋮ menu
                                      canEditStructure && "pr-10",
                                      active
                                        ? "bg-brand-50 text-brand-900 border-l-2 border-brand-600"
                                        : "hover:bg-white text-slate-700",
                                    )}
                                  >
                                    <BookOpen
                                      className={cn(
                                        "mt-0.5 h-4 w-4 shrink-0",
                                        active
                                          ? "text-brand-600"
                                          : "text-slate-400",
                                      )}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="font-medium">
                                        {subject.subjectName}
                                      </span>
                                      {subject.subjectCode ? (
                                        <span className="ml-1 text-xs text-slate-500">
                                          ({subject.subjectCode})
                                        </span>
                                      ) : null}
                                      {hideTeacherNames ? null : subject.teacherNames.length > 0 ? (
                                        <span className="mt-0.5 block text-xs text-slate-500 truncate">
                                          {subject.teacherNames.length === 1
                                            ? subject.teacherNames[0]
                                            : `${subject.teacherNames.length} teachers: ${subject.teacherNames.join(" · ")}`}
                                        </span>
                                      ) : (
                                        <span className="mt-0.5 block text-xs text-slate-400">
                                          No teacher assignment yet
                                        </span>
                                      )}
                                    </span>
                                    {subject.recordCount > 0 ? (
                                      <Badge
                                        className={cn(
                                          "shrink-0",
                                          active
                                            ? "bg-brand-100 text-brand-800"
                                            : "bg-white text-slate-600 border border-slate-200",
                                        )}
                                      >
                                        {subject.recordCount}
                                      </Badge>
                                    ) : null}
                                  </button>
                                  {movingSubject === subjectComposite ? (
                                    <SubjectMoveForm
                                      className={cn(
                                        "mb-2 mr-4",
                                        showFacultyLevel ? "ml-14" : "ml-10",
                                      )}
                                      subjectName={subject.subjectName}
                                      subjectIds={subject.subjectIds}
                                      fromFaculty={facultyValueOf(
                                        faculty.key,
                                        faculty.label,
                                      )}
                                      faculties={moveTargets}
                                      onClose={() => setMovingSubject(null)}
                                    />
                                  ) : null}
                                  {deleting === subjectComposite ? (
                                    <FacultyDeleteForm
                                      className={cn(
                                        "mb-2 mr-4",
                                        showFacultyLevel ? "ml-14" : "ml-10",
                                      )}
                                      facultyValue={facultyValueOf(
                                        faculty.key,
                                        faculty.label,
                                      )}
                                      facultyLabel={faculty.label}
                                      subjectName={subject.subjectName}
                                      subjectIds={subject.subjectIds}
                                      onClose={() => setDeleting(null)}
                                    />
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
