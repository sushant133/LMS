import { useQuery } from "@tanstack/react-query";
import type { AcademicSyllabusRecord } from "@phit-erp/shared";
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
}

interface SyllabusHierarchyPickerProps {
  subjectId?: string;
  academicYearBs?: string;
  value: SyllabusHierarchySelection;
  onChange: (value: SyllabusHierarchySelection) => void;
  disabled?: boolean;
  /** Compact single-row layout for dialogs. */
  compact?: boolean;
}

const emptySelection = (): SyllabusHierarchySelection => ({
  syllabusId: "",
  chapterId: "",
  unitId: "",
  subUnitId: "",
});

/**
 * Cascading picker: Syllabus → Chapter → Unit → Sub Unit.
 * Used by Lesson Plan, Homework, and Attendance coverage flows.
 */
export const SyllabusHierarchyPicker = ({
  subjectId,
  academicYearBs,
  value,
  onChange,
  disabled = false,
  compact = false,
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
  const subUnits = selectedUnit?.subUnits ?? [];

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
      <FormField label="Chapter">
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
          <option value="">Select chapter</option>
          {chapters.map((ch) => (
            <option key={ch._id} value={ch._id}>
              Ch {ch.chapterNo}: {ch.title}
            </option>
          ))}
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
              unitId,
              unitTitle: unit?.title,
              subUnitId: "",
              subUnitHeading: undefined,
              displayNo: undefined,
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
      <FormField label="Sub Unit">
        <Select
          disabled={disabled || !value.unitId}
          value={value.subUnitId}
          onChange={(e) => {
            const subUnitId = e.target.value;
            const sub = subUnits.find((s) => s._id === subUnitId);
            onChange({
              ...value,
              syllabusId: selectedSyllabus?._id || value.syllabusId,
              subUnitId,
              subUnitHeading: sub?.heading,
              displayNo: sub?.displayNo,
            });
          }}
        >
          <option value="">Select sub unit</option>
          {subUnits.map((s) => (
            <option key={s._id} value={s._id}>
              {s.displayNo} {s.heading}
            </option>
          ))}
        </Select>
      </FormField>
      {value.subUnitHeading ? (
        <div className="flex items-end">
          <p className="rounded-xl border border-brand-100 bg-brand-50/50 px-3 py-2 text-xs text-brand-900">
            Linked: {value.displayNo} {value.subUnitHeading}
          </p>
        </div>
      ) : null}
    </div>
  );
};
