import { ChevronDown, ChevronRight, BookOpen, GraduationCap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "components/ui/badge";
import { cn } from "lib/utils";
import type {
  HierarchyFacultyNode,
  HierarchySubjectNode,
  HierarchyYearNode,
} from "./academicHierarchyUtils";

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
}: AcademicYearSubjectTreeProps) => {
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
              {showFacultyLevel ? (
                <button
                  type="button"
                  onClick={() => toggleFaculty(faculty.key)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 transition"
                >
                  {facultyOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <GraduationCap className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="font-semibold text-slate-900">
                    {faculty.label}
                  </span>
                  <Badge className="ml-auto bg-slate-100 text-slate-700">
                    {faculty.years.length} year
                    {faculty.years.length === 1 ? "" : "s"}
                  </Badge>
                </button>
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
                              return (
                                <li key={`${yearComposite}-${subject.subjectKey}`}>
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
                                      {subject.teacherNames.length > 0 ? (
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
