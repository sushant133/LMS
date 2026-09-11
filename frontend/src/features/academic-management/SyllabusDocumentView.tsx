import type { AcademicSyllabusRecord } from "@phit-erp/shared";
import {
  formatChapterLabel,
  formatHours,
  formatPartLabel,
  formatStoredSubUnitDisplayNo,
  formatUnitLabel,
  isNepaliSubject,
  nepaliStructuralLabels,
  nepaliTextClass,
  toNepaliDigits,
} from "lib/nepaliSubject";
import { cn } from "lib/utils";

type SubUnitLike = {
  _id?: string;
  displayNo?: string;
  heading?: string;
  description?: string;
  teachingHours?: number;
  status?: string;
  attribution?: {
    source?: string;
    countsTowardSalary?: boolean;
    deliveredByName?: string;
    completedByTeacherName?: string;
  };
  children?: SubUnitLike[];
};

const renderSubUnits = (
  subs: SubUnitLike[],
  unitNo: number,
  nepali: boolean,
  depth = 0,
) => {
  if (!subs.length) return null;
  return (
    <ul className={cn("list-disc text-sm", depth === 0 ? "ml-4" : "ml-4 mt-0.5")}>
      {subs.map((sub, index) => (
        <li
          key={sub._id || `${depth}-${index}-${sub.heading || ""}`}
          className={cn(nepali && nepaliTextClass)}
        >
          <span className="font-medium">
            {formatStoredSubUnitDisplayNo(
              sub.displayNo || "",
              unitNo,
              nepali,
            )}{" "}
            {sub.heading?.trim() ||
              (nepali ? nepaliStructuralLabels.noHeading : "— (no heading)")}
          </span>
          {sub.teachingHours ? (
            <span className="text-slate-600">
              {" "}
              · {formatHours(sub.teachingHours, nepali)}
            </span>
          ) : null}
          {sub.status === "COMPLETED" || sub.status === "SKIPPED" ? (
            <span className={cn("ml-1 text-xs text-slate-500", nepali && nepaliTextClass)}>
              {sub.attribution?.source === "ADMINISTRATION" ||
              sub.attribution?.countsTowardSalary === false
                ? nepali
                  ? `(${nepaliStructuralLabels.administration}${
                      sub.attribution?.deliveredByName
                        ? `: ${sub.attribution.deliveredByName}`
                        : ""
                    } · ${nepaliStructuralLabels.notSalary})`
                  : `(administration${
                      sub.attribution?.deliveredByName
                        ? `: ${sub.attribution.deliveredByName}`
                        : ""
                    } · not salary)`
                : sub.attribution?.completedByTeacherName
                  ? `(${sub.attribution.completedByTeacherName})`
                  : nepali
                    ? ` (${nepaliStructuralLabels.completed})`
                    : " (completed)"}
            </span>
          ) : null}
          {sub.description?.trim() ? (
            <p className="mt-0.5 text-xs text-slate-600">{sub.description}</p>
          ) : null}
          {sub.children?.length
            ? renderSubUnits(sub.children, unitNo, nepali, depth + 1)
            : null}
        </li>
      ))}
    </ul>
  );
};

interface SyllabusDocumentViewProps {
  plan: AcademicSyllabusRecord;
  /** Compact print layout vs denser on-screen student view. */
  mode?: "print" | "view";
  className?: string;
}

/** Renders one syllabus hierarchy for on-screen view or print/PDF. */
export const SyllabusDocumentView = ({
  plan,
  mode = "view",
  className,
}: SyllabusDocumentViewProps) => {
  const nepali = isNepaliSubject({
    name: plan.subject?.name,
    code: plan.subjectCode || plan.subject?.code,
  });
  const chapters = plan.chapters ?? [];
  const isPrint = mode === "print";

  /** Devanagari needs the language tag for correct shaping in print/PDF. */
  const langProps = nepali ? ({ lang: "ne" } as const) : {};

  const summaryLine =
    plan.totalTheoryHours || plan.totalPracticalHours || plan.creditHours
      ? nepali
        ? [
            `${nepaliStructuralLabels.theory} ${toNepaliDigits(plan.totalTheoryHours ?? 0)} ${nepaliStructuralLabels.hours}`,
            `${nepaliStructuralLabels.practical} ${toNepaliDigits(plan.totalPracticalHours ?? 0)} ${nepaliStructuralLabels.hours}`,
            `${nepaliStructuralLabels.credit} ${toNepaliDigits(plan.creditHours ?? 0)}`,
          ].join(" · ")
        : `Theory ${plan.totalTheoryHours ?? 0}h · Practical ${plan.totalPracticalHours ?? 0}h · Credit ${plan.creditHours ?? 0}`
      : null;

  return (
    <div
      {...langProps}
      className={cn(
        isPrint ? "mb-6 break-inside-avoid" : "space-y-3",
        nepali && nepaliTextClass,
        className,
      )}
    >
      <div className={cn(isPrint ? "" : "space-y-1")}>
        <h3 className={cn("font-semibold text-slate-900", nepali && nepaliTextClass)}>
          {plan.subject?.name || "Subject"}
          {plan.subjectCode || plan.subject?.code
            ? ` (${plan.subjectCode || plan.subject?.code})`
            : ""}
          {plan.academicYearBs ? ` · ${plan.academicYearBs}` : ""}
        </h3>
        <p className={cn("text-sm text-slate-600", nepali && nepaliTextClass)}>
          {summaryLine}
          {plan.remarks?.trim() ? (
            <span className="block mt-0.5">
              {nepali ? nepaliStructuralLabels.remarks : "Remarks"}: {plan.remarks}
            </span>
          ) : null}
        </p>
      </div>

      {chapters.length === 0 ? (
        <p className={cn("text-sm text-slate-500", nepali && nepaliTextClass)}>
          {nepali
            ? nepaliStructuralLabels.emptyHierarchy
            : "No chapters or units in this syllabus yet."}
        </p>
      ) : (
        chapters.map((chapter) => (
          <div
            key={chapter._id}
            className={cn(isPrint ? "mt-2" : "rounded-lg border border-slate-100 bg-slate-50/60 p-3")}
          >
            <p className={cn("font-medium text-slate-900", nepali && nepaliTextClass)}>
              {chapter.sectionKind === "PART"
                ? formatPartLabel(chapter.chapterNo, {
                    title: chapter.title,
                    nepali,
                  })
                : chapter.sectionKind === "NONE" && !chapter.title
                  ? nepali
                    ? nepaliStructuralLabels.units
                    : "Units"
                  : formatChapterLabel(chapter.chapterNo, {
                      title: chapter.title,
                      nepali,
                    })}
            </p>
            {chapter.description?.trim() ? (
              <p className={cn("mt-0.5 text-xs text-slate-600", nepali && nepaliTextClass)}>
                {chapter.description}
              </p>
            ) : null}
            {(chapter.units ?? []).map((unit) => (
              <div key={unit._id} className={cn(isPrint ? "ml-3 mt-1" : "mt-2 ml-1")}>
                <p className={cn("text-sm font-medium text-slate-800", nepali && nepaliTextClass)}>
                  {formatUnitLabel(unit.unitNo, {
                    title: unit.title,
                    nepali,
                  })}
                  {unit.teachingHours ? (
                    <span className="font-normal text-slate-500">
                      {" "}
                      · {formatHours(unit.teachingHours, nepali)}
                    </span>
                  ) : null}
                  {unit.practicalRequired ? (
                    <span className="ml-1 text-xs font-normal text-amber-700">
                      ({nepali ? nepaliStructuralLabels.practical : "Practical"})
                    </span>
                  ) : null}
                </p>
                {unit.description?.trim() ? (
                  <p className={cn("ml-1 text-xs text-slate-600", nepali && nepaliTextClass)}>
                    {unit.description}
                  </p>
                ) : null}
                {unit.learningObjective?.trim() ? (
                  <p className={cn("ml-1 text-xs text-slate-600", nepali && nepaliTextClass)}>
                    {nepali ? nepaliStructuralLabels.objective : "Objective"}:{" "}
                    {unit.learningObjective}
                  </p>
                ) : null}
                {renderSubUnits(unit.subUnits ?? [], unit.unitNo, nepali)}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
