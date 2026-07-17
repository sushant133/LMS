import { cn } from "lib/utils";
import { TimetableCellView } from "./TimetableCell";
import type { MatrixCell, TimetableSlotRow, WeeklyMatrix } from "./timetableMatrixUtils";

interface WeeklyTimetableGridProps {
  matrix: WeeklyMatrix;
  title?: string;
  onCellClick?: (slot: TimetableSlotRow) => void;
  /** Print-friendly denser cells */
  compact?: boolean;
  className?: string;
  id?: string;
}

export const WeeklyTimetableGrid = ({
  matrix,
  title,
  onCellClick,
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
    <div id={id} className={cn("space-y-2", className)}>
      {title ? (
        <h3 className="text-base font-semibold text-slate-900 print:text-sm">{title}</h3>
      ) : null}
      <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm print:overflow-visible print:rounded-none print:shadow-none">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th
                className={cn(
                  "sticky left-0 z-20 border border-slate-200 bg-slate-800 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white",
                  "print:static print:bg-slate-800",
                )}
              >
                Day / Period
              </th>
              {periods.map((period) => (
                <th
                  key={period.key}
                  className={cn(
                    "sticky top-0 z-10 min-w-[7.5rem] border border-slate-200 bg-slate-700 px-1.5 py-2 text-center text-[11px] font-semibold text-white",
                    "print:static print:bg-slate-700",
                  )}
                >
                  <div>{period.label}</div>
                  <div className="mt-0.5 text-[10px] font-normal text-slate-200">
                    P{period.periodNumber}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, dayIndex) => (
              <tr key={day}>
                <th
                  className={cn(
                    "sticky left-0 z-10 border border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-bold text-slate-800",
                    "print:static",
                    dayIndex === 6 && "bg-rose-50 text-rose-900",
                  )}
                >
                  {day}
                </th>
                {(cells[dayIndex] ?? []).map((cell: MatrixCell, periodIndex) => (
                  <td
                    key={`${dayIndex}-${periodIndex}`}
                    className="border border-slate-150 p-0 align-top"
                  >
                    <TimetableCellView
                      cell={cell}
                      compact={compact}
                      onClick={onCellClick}
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
