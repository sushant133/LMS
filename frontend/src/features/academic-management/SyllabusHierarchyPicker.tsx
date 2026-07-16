import { useQuery } from "@tanstack/react-query";
import type {
  AcademicSyllabusRecord,
  AcademicSyllabusSubUnitRecord,
} from "@phit-erp/shared";
import { useMemo } from "react";
import { Select } from "components/ui/select";
import { FormField } from "components/shared/FormField";
import { api, unwrap } from "lib/api";

export interface SyllabusHierarchySelection {
  syllabusId: string;
  chapterId: string;
  unitId: string;
  subUnitId: string;
  chapterTitle?: string;
  unitTitle?: string;
  subUnitHeading?: string;
  displayNo?: string;
  learningOutcomes?: string;
  description?: string;
}

interface SyllabusHierarchyPickerProps {
  subjectId?: string;
  academicYearBs?: string;
  value: SyllabusHierarchySelection;
  onChange: (value: SyllabusHierarchySelection) => void;
  disabled?: boolean;
  /** Compact single-row layout for dialogs. */
  compact?: boolean;
  /**
   * When true, only show Chapter + Unit (no sub-units).
   * Used when selecting a Session Plan unit heading.
   */
  unitsOnly?: boolean;
}

const emptySelection = (): SyllabusHierarchySelection => ({
  syllabusId: "",
  chapterId: "",
  unitId: "",
  subUnitId: "",
});

/** Flatten nested sub-units for a single select (path labels preserved via displayNo). */
const flattenSubs = (
  subs: AcademicSyllabusSubUnitRecord[],
): AcademicSyllabusSubUnitRecord[] => {
  const out: AcademicSyllabusSubUnitRecord[] = [];
  const walk = (nodes: AcademicSyllabusSubUnitRecord[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(subs);
  return out;
};

/**
 * Cascading picker: Chapter (optional) → Unit → Sub Unit (incl. nested children).
 * Used by Lesson Plan, Homework, and Attendance coverage flows.
 */
export const SyllabusHierarchyPicker = ({
  subjectId,
  academicYearBs,
  value,
  onChange,
  disabled = false,
  compact = false,
  unitsOnly = false,
}: SyllabusHierarchyPickerProps) => {
  const syllabiQuery = useQuery({
    queryKey: ["academic-management", "syllabi-picker", subjectId, academicYearBs],
    queryFn: () =>
      unwrap<AcademicSyllabusRecord[]>(
        api.get("/academic-management/syllabi", {
          params: {
            subjectId: subjectId || undefined,
            academicYearBs: academicYearBs || undefined,
          },
        }),
      ),
    enabled: Boolean(subjectId),
  });

  const syllabi = syllabiQuery.data ?? [];
  const selectedSyllabus = useMemo(
    () => syllabi.find((s) => s._id === value.syllabusId) ?? syllabi[0],
    [syllabi, value.syllabusId],
  );
  const chapters = selectedSyllabus?.chapters ?? [];
  const selectedChapter = chapters.find((c) => c._id === value.chapterId);
  const units = selectedChapter?.units ?? [];
  const selectedUnit = units.find((u) => u._id === value.unitId);
  const flatSubUnits = useMemo(
    () => flattenSubs(selectedUnit?.subUnits ?? []),
    [selectedUnit],
  );

  // When only one chapter (or ungrouped), auto-expose its units
  const chaptersWithUnits = chapters.filter((c) => c.units.length > 0);

  const gridClass = compact
    ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
    : "grid gap-3 md:grid-cols-2";

  if (!subjectId) {
    return (
      <p className="text-xs text-slate-500">
        Select a subject first to link syllabus topics.
      </p>
    );
  }

  return (
    <div className={gridClass}>
      <FormField label="Chapter or Part (optional)">
        <Select
          disabled={disabled || syllabiQuery.isLoading}
          value={value.chapterId}
          onChange={(e) => {
            const chapterId = e.target.value;
            const chapter = chapters.find((c) => c._id === chapterId);
            onChange({
              ...emptySelection(),
              syllabusId: selectedSyllabus?._id || "",
              chapterId,
              chapterTitle: chapter?.title,
            });
          }}
        >
          <option value="">Select section</option>
          {chaptersWithUnits.map((ch) => {
            const kind = ch.sectionKind || (ch.title ? "CHAPTER" : "NONE");
            const label =
              kind === "CHAPTER"
                ? ch.title
                  ? `Chapter ${ch.chapterNo}: ${ch.title}`
                  : `Chapter ${ch.chapterNo}`
                : kind === "PART"
                  ? ch.title
                    ? `Part ${ch.chapterNo}: ${ch.title}`
                    : `Part ${ch.chapterNo}`
                  : ch.title || `Units (section ${ch.chapterNo})`;
            return (
              <option key={ch._id} value={ch._id}>
                {label}
              </option>
            );
          })}
        </Select>
      </FormField>
      <FormField label="Unit">
        <Select
          disabled={disabled || !value.chapterId}
          value={value.unitId}
          onChange={(e) => {
            const unitId = e.target.value;
            const unit = units.find((u) => u._id === unitId);
            onChange({
              ...value,
              syllabusId: selectedSyllabus?._id || value.syllabusId,
              unitId,
              unitTitle: unit?.title,
              subUnitId: "",
              subUnitHeading: undefined,
              displayNo: undefined,
              learningOutcomes: unit?.learningObjective,
              description: unit?.description,
            });
          }}
        >
          <option value="">Select unit</option>
          {units.map((u) => (
            <option key={u._id} value={u._id}>
              Unit {u.unitNo}: {u.title}
            </option>
          ))}
        </Select>
      </FormField>
      {!unitsOnly ? (
        <FormField label="Sub Unit / Child">
          <Select
            disabled={disabled || !value.unitId}
            value={value.subUnitId}
            onChange={(e) => {
              const subUnitId = e.target.value;
              const sub = flatSubUnits.find((s) => s._id === subUnitId);
              onChange({
                ...value,
                syllabusId: selectedSyllabus?._id || value.syllabusId,
                subUnitId,
                subUnitHeading: sub?.heading,
                displayNo: sub?.displayNo,
                learningOutcomes:
                  sub?.learningOutcomes || value.learningOutcomes,
                description: sub?.description || value.description,
              });
            }}
          >
            <option value="">Whole unit (optional sub-unit)</option>
            {flatSubUnits.map((s) => (
              <option key={s._id} value={s._id}>
                {s.displayNo} {s.heading}
                {s.depth > 0 ? ` (depth ${s.depth})` : ""}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {value.unitId || value.subUnitId ? (
        <p className="text-xs text-slate-600 sm:col-span-2">
          Linked:{" "}
          {value.displayNo ? `${value.displayNo} ` : ""}
          {value.subUnitHeading || value.unitTitle || "Selected"}
        </p>
      ) : null}
    </div>
  );
};
