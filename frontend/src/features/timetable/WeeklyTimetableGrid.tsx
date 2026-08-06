import { Clock } from "lucide-react";
import { cn } from "lib/utils";
import { TimetableCellView } from "./TimetableCell";
import type {
  MatrixCell,
  PeriodColumn,
  TimetableSlotRow,
  WeeklyMatrix,
} from "./timetableMatrixUtils";

interface WeeklyTimetableGridProps {
  matrix: WeeklyMatrix;
  title?: string;
  /** Open edit form for a slot (admin / teacher with permission). */
  onEditSlot?: (slot: TimetableSlotRow) => void;
  onDeleteSlot?: (slot: TimetableSlotRow) => void;
  /**
   * Change start/end time for an entire period column (all weekdays).
   * When set, period headers become clickable.
   */
  onChangePeriodTime?: (period: PeriodColumn) => void;
  /** Print-friendly denser cells (no action buttons). */
  compact?: boolean;
  className?: string;
  id?: string;
}

export const WeeklyTimetableGrid = ({
  matrix,
  title,
  onEditSlot,
  onDeleteSlot,
  onChangePeriodTime,
  compact,
  className,
  id,
}: WeeklyTimetableGridProps) => {
  const { periods, cells, days } = matrix;

  if (periods.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No periods to display. Add timetable slots to generate the weekly matrix.
      </p>
    );
  }

  return (
    <div id={id} className={cn("tt-print-grid space-y-2", className)}>
      {title ? (
        <h3 className="text-base font-semibold text-slate-900 print:text-sm print:text-black">
          {title}
        </h3>
      ) : null}
      {(onEditSlot || onChangePeriodTime) && !compact ? (
        <p className="no-print text-xs text-slate-500">
          {onChangePeriodTime
            ? "Click a column header (P1, P2…) to change that period’s time for every day of the week. "
            : null}
          {onEditSlot
            ? "Click a cell or use Edit to change subject, teacher, or room."
            : null}
        </p>
      ) : null}
      <div className="relative overflow-x-auto rounded-xl border border-slate-300 bg-white shadow-sm print:overflow-visible print:rounded-none print:border-black print:shadow-none">
        <table className="tt-print-table w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th
                className={cn(
                  "tt-print-th sticky left-0 z-20 border border-slate-400 bg-slate-900 px-2 py-2 text-left text-xs font-bold uppercase tracking-wide text-white",
                  "print:static print:border-black print:bg-slate-900 print:text-white",
                )}
                style={{
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust: "exact",
                  backgroundColor: "#0f172a",
                  color: "#ffffff",
                }}
              >
                Day / Period
              </th>
              {periods.map((period) => {
                // Teaching periods: 1–12. Breaks use synthetic ≥1000 (time only).
                const isBreakColumn =
                  period.periodNumber < 1 || period.periodNumber > 12;
                const headerBg = isBreakColumn ? "#92400e" : "#1e293b";
                const canEditColumn = Boolean(onChangePeriodTime) && !compact;
                return (
                <th
                  key={period.key}
                  className={cn(
                    "tt-print-th sticky top-0 z-10 min-w-[7.5rem] border border-slate-400 px-1.5 py-2 text-center text-[11px] font-bold text-white",
                    "print:static print:border-black print:text-white",
                    isBreakColumn
                      ? "bg-amber-800 print:bg-amber-800"
                      : "bg-slate-800 print:bg-slate-800",
                    canEditColumn && "hover:brightness-110",
                  )}
                  style={{
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                    backgroundColor: headerBg,
                    color: "#ffffff",
                    cursor: canEditColumn ? "pointer" : undefined,
                  }}
                  title={
                    canEditColumn
                      ? "Click to change this period time for all days"
                      : undefined
                  }
                  onClick={
                    canEditColumn
                      ? () => onChangePeriodTime?.(period)
                      : undefined
                  }
                >
                  <div className="text-white">{period.label}</div>
                  <div
                    className="mt-0.5 text-[10px] font-semibold text-white"
                    style={{ color: "#ffffff" }}
                  >
                    {isBreakColumn ? "Break" : `P${period.periodNumber}`}
                  </div>
                  {canEditColumn ? (
                    <div className="no-print mt-1 flex items-center justify-center gap-0.5 text-[9px] font-normal text-sky-100">
                      <Clock className="h-3 w-3" />
                      Change time
                    </div>
                  ) : null}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {days.map((day, dayIndex) => (
              <tr key={day}>
                <th
                  className={cn(
                    "tt-print-day sticky left-0 z-10 border border-slate-300 bg-slate-100 px-2 py-2 text-left text-xs font-bold text-slate-900",
                    "print:static print:border-black print:bg-slate-100 print:text-black",
                    dayIndex === 6 && "bg-rose-100 text-rose-950 print:bg-rose-100 print:text-rose-950",
                  )}
                  style={{
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                    backgroundColor: dayIndex === 6 ? "#ffe4e6" : "#f1f5f9",
                    color: dayIndex === 6 ? "#4c0519" : "#0f172a",
                  }}
                >
                  {day}
                </th>
                {(cells[dayIndex] ?? []).map((cell: MatrixCell, periodIndex) => (
                  <td
                    key={`${dayIndex}-${periodIndex}`}
                    className="border border-slate-300 p-0 align-top print:border-black"
                  >
                    <TimetableCellView
                      cell={cell}
                      compact={compact}
                      onEdit={compact ? undefined : onEditSlot}
                      onDelete={compact ? undefined : onDeleteSlot}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
