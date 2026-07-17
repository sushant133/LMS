import { WeeklyTimetableGrid } from "./WeeklyTimetableGrid";
import type { WeeklyMatrix } from "./timetableMatrixUtils";

export type TimetablePrintMeta = {
  collegeName: string;
  collegeNameNp?: string;
  logoUrl?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  academicYearBs?: string;
  generatedAt: string;
  principalName?: string;
  viewTitle: string;
};

interface TimetablePrintViewProps {
  matrix: WeeklyMatrix;
  meta: TimetablePrintMeta;
  printId?: string;
}

export const TimetablePrintView = ({
  matrix,
  meta,
  printId = "timetable-print-root",
}: TimetablePrintViewProps) => (
  <div
    id={printId}
    className="hidden print:block space-y-4 bg-white p-6 text-slate-900"
  >
    <header className="border-b-2 border-slate-800 pb-4 text-center">
      {meta.logoUrl ? (
        <img
          src={meta.logoUrl}
          alt=""
          className="mx-auto mb-2 h-14 w-14 object-contain"
        />
      ) : null}
      <h1 className="text-xl font-bold uppercase tracking-wide">
        {meta.collegeName}
      </h1>
      {meta.collegeNameNp ? (
        <p className="text-sm text-slate-600">{meta.collegeNameNp}</p>
      ) : null}
      <p className="mt-2 text-lg font-semibold">Weekly Class Timetable</p>
      <p className="text-sm text-slate-700">{meta.viewTitle}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {meta.batchName ? <span>Batch: {meta.batchName}</span> : null}
        {meta.yearName ? <span>Year: {meta.yearName}</span> : null}
        {meta.className ? <span>Class: {meta.className}</span> : null}
        {meta.sectionName ? <span>Section: {meta.sectionName}</span> : null}
        {meta.academicYearBs ? (
          <span>Academic Year (BS): {meta.academicYearBs}</span>
        ) : null}
        <span>Generated: {meta.generatedAt}</span>
      </div>
    </header>

    <WeeklyTimetableGrid matrix={matrix} compact />

    <footer className="mt-10 grid grid-cols-3 gap-6 pt-8 text-center text-xs">
      <div>
        <div className="mx-auto mb-8 h-12 border-b border-slate-400" />
        <p className="font-semibold">Administrator</p>
        <p className="text-slate-500">Signature</p>
      </div>
      <div>
        <div className="mx-auto mb-8 flex h-12 items-end justify-center">
          <span className="rounded-full border border-dashed border-slate-400 px-4 py-2 text-[10px] text-slate-400">
            Optional Stamp
          </span>
        </div>
        <p className="font-semibold">Official Seal</p>
      </div>
      <div>
        <div className="mx-auto mb-8 h-12 border-b border-slate-400" />
        <p className="font-semibold">
          {meta.principalName || "Principal"}
        </p>
        <p className="text-slate-500">Signature</p>
      </div>
    </footer>
  </div>
);
