import { Clock } from "lucide-react";
import { cn } from "lib/utils";
import {
  TimetableCellView,
  type TimetableDensity,
} from "./TimetableCell";
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
  /**
   * Print-friendly denser cells (no action buttons).
   * Prefer `density` for finer control.
   */
  compact?: boolean;
  /** Cell / header density. Defaults from compact when omitted. */
  density?: TimetableDensity;
  className?: string;
  id?: string;
}

/** Pick print density from period count so wide grids still fit A4 landscape. */
export const densityForPeriodCount = (periodCount: number): TimetableDensity => {
  if (periodCount >= 11) return "ultra";
  if (periodCount >= 8) return "dense";
  if (periodCount >= 1) return "compact";
  return "compact";
};

const headerPad: Record<TimetableDensity, string> = {
  screen: "px-1.5 py-2",
  compact: "px-0.5 py-1",
  dense: "px-0.5 py-0.5",
  ultra: "px-px py-0.5",
};

const dayPad: Record<TimetableDensity, string> = {
  screen: "px-2 py-2",
  compact: "px-1 py-1",
  dense: "px-0.5 py-0.5",
  ultra: "px-0.5 py-px",
};

const headerLabel: Record<TimetableDensity, string> = {
  screen: "text-[11px]",
  compact: "text-[9px]",
  dense: "text-[8px]",
  ultra: "text-[7.5px]",
};

const headerSub: Record<TimetableDensity, string> = {
  screen: "text-[10px]",
  compact: "text-[8px]",
  dense: "text-[7.5px]",
  ultra: "text-[7px]",
};

const dayLabel: Record<TimetableDensity, string> = {
  screen: "text-xs",
  compact: "text-[10px]",
  dense: "text-[9px]",
  ultra: "text-[8px]",
};

export const WeeklyTimetableGrid = ({
  matrix,
  title,
  onEditSlot,
  onDeleteSlot,
  onChangePeriodTime,
  compact,
  density: densityProp,
  className,
  id,
}: WeeklyTimetableGridProps) => {
  const { periods, cells, days } = matrix;
  const density: TimetableDensity =
    densityProp ?? (compact ? densityForPeriodCount(periods.length) : "screen");
  const isPrint = density !== "screen";

  if (periods.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No periods to display. Add timetable slots to generate the weekly matrix.
      </p>
    );
  }

  return (
    <div
      id={id}
      className={cn(
        "tt-print-grid",
        isPrint ? "space-y-1" : "space-y-2",
        className,
      )}
      data-tt-density={density}
      data-tt-period-count={periods.length}
    >
      {title ? (
        <h3
          className={cn(
            "font-semibold text-slate-900 print:text-black",
            isPrint ? "text-xs" : "text-base",
          )}
        >
          {title}
        </h3>
      ) : null}
      {(onEditSlot || onChangePeriodTime) && !isPrint ? (
        <p className="no-print text-xs text-slate-500">
          {onChangePeriodTime
            ? "Click a column header (P1, P2…) to change that period’s time for every day of the week. "
            : null}
          {onEditSlot
            ? "Click a cell or use Edit to change subject, teacher, or room."
            : null}
        </p>
      ) : null}
      <div
        className={cn(
          "relative bg-white",
          isPrint
            ? "overflow-visible rounded-none border border-black shadow-none"
            : "overflow-x-auto rounded-xl border border-slate-300 shadow-sm",
        )}
      >
        <table
          className={cn(
            "tt-print-table w-full border-collapse",
            isPrint
              ? "table-fixed text-[9px]"
              : "min-w-[720px] text-sm",
          )}
          style={
            isPrint
              ? {
                  // No min-width: the print/PDF fit pass owns the sheet width,
                  // and anything wider than it gets clipped off the page.
                  width: "100%",
                  minWidth: 0,
                  tableLayout: "fixed",
                }
              : undefined
          }
        >
          <colgroup>
            {/* Day column — fixed narrow strip */}
            <col
              style={{
                width: isPrint
                  ? density === "ultra"
                    ? "9%"
                    : "10%"
                  : "7.5rem",
              }}
            />
            {periods.map((period) => (
              <col key={period.key} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className={cn(
                  "tt-print-th sticky left-0 z-20 border border-slate-400 bg-slate-900 text-left font-bold uppercase tracking-wide text-white",
                  "print:static print:border-black print:bg-slate-900 print:text-white",
                  headerPad[density],
                  isPrint ? "text-[8px]" : "text-xs",
                )}
                style={{
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust: "exact",
                  backgroundColor: "#0f172a",
                  color: "#ffffff",
                }}
              >
                {isPrint ? "Day" : "Day / Period"}
              </th>
              {periods.map((period) => {
                // Teaching periods: 1–12. Breaks use synthetic ≥1000 (time only).
                const isBreakColumn =
                  period.periodNumber < 1 || period.periodNumber > 12;
                const headerBg = isBreakColumn ? "#92400e" : "#1e293b";
                const canEditColumn = Boolean(onChangePeriodTime) && !isPrint;
                return (
                  <th
                    key={period.key}
                    className={cn(
                      "tt-print-th sticky top-0 z-10 border border-slate-400 text-center font-bold text-white",
                      "print:static print:border-black print:text-white",
                      headerPad[density],
                      headerLabel[density],
                      isBreakColumn
                        ? "bg-amber-800 print:bg-amber-800"
                        : "bg-slate-800 print:bg-slate-800",
                      !isPrint && "min-w-[7.5rem]",
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
                        : period.label
                    }
                    onClick={
                      canEditColumn
                        ? () => onChangePeriodTime?.(period)
                        : undefined
                    }
                  >
                    <div className="leading-tight text-white">
                      {period.label}
                    </div>
                    <div
                      className={cn(
                        "font-semibold leading-tight text-white",
                        headerSub[density],
                        isPrint ? "mt-px" : "mt-0.5",
                      )}
                      style={{ color: "#ffffff" }}
                    >
                      {isBreakColumn
                        ? density === "ultra"
                          ? "Brk"
                          : "Break"
                        : `P${period.periodNumber}`}
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
                    "tt-print-day sticky left-0 z-10 border border-slate-300 bg-slate-100 text-left font-bold text-slate-900",
                    "print:static print:border-black print:bg-slate-100 print:text-black",
                    dayIndex === 6 &&
                      "bg-rose-100 text-rose-950 print:bg-rose-100 print:text-rose-950",
                    dayPad[density],
                    dayLabel[density],
                  )}
                  style={{
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                    backgroundColor: dayIndex === 6 ? "#ffe4e6" : "#f1f5f9",
                    color: dayIndex === 6 ? "#4c0519" : "#0f172a",
                  }}
                >
                  {isPrint && day.length > 3 ? day.slice(0, 3) : day}
                </th>
                {(cells[dayIndex] ?? []).map((cell: MatrixCell, periodIndex) => {
                  const period = periods[periodIndex];
                  const isBreakColumn =
                    period &&
                    (period.periodNumber < 1 || period.periodNumber > 12);
                  return (
                    <td
                      key={`${dayIndex}-${periodIndex}`}
                      className={cn(
                        "border border-slate-300 p-0 align-top print:border-black",
                        isBreakColumn && "bg-amber-50/40",
                      )}
                    >
                      <TimetableCellView
                        cell={cell}
                        density={density}
                        onEdit={isPrint ? undefined : onEditSlot}
                        onDelete={isPrint ? undefined : onDeleteSlot}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
