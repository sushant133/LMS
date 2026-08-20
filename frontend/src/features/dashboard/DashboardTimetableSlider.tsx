import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { SESSION_COLORS, SESSION_LABELS } from "features/timetable/timetableColors";
import {
  nameOf,
  resolveSessionType,
  type MatrixCell,
  type PeriodColumn,
  type WeeklyMatrix,
} from "features/timetable/timetableMatrixUtils";

interface DashboardTimetableSliderProps {
  matrix: WeeklyMatrix;
}

const cellSlots = (cell: MatrixCell | undefined) => {
  if (!cell) return [];
  if (cell.kind === "slot") return [cell.slot];
  if (cell.kind === "multi") return cell.slots;
  return [];
};

const PeriodCard = ({
  period,
  cell,
}: {
  period: PeriodColumn;
  cell: MatrixCell | undefined;
}) => {
  if (!cell || cell.kind === "empty") {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-[11px] font-medium text-slate-400">{period.label}</p>
        <p className="text-sm text-slate-400">Free</p>
      </div>
    );
  }

  if (cell.kind === "holiday") {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-center text-sm font-semibold text-rose-800">
        Holiday
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {cellSlots(cell).map((slot) => {
        const type = resolveSessionType(slot);
        const colors = SESSION_COLORS[type] ?? SESSION_COLORS.THEORY;
        return (
          <div
            key={slot._id}
            className={cn(
              "rounded-xl border px-3 py-2.5",
              colors.bg,
              colors.border,
              colors.text,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {period.label}
              </p>
              <span
                className={cn(
                  "rounded px-1.5 py-px text-[10px] font-semibold uppercase",
                  colors.badge,
                )}
              >
                {slot.breakLabel?.trim() || SESSION_LABELS[type] || type}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold leading-snug">
              {type === "BREAK"
                ? slot.breakLabel?.trim() || "Break"
                : type === "HOLIDAY"
                  ? "Holiday"
                  : nameOf(slot.subjectId, "Class")}
            </p>
            {slot.teacherId ? (
              <p className="mt-0.5 text-xs text-slate-600">
                {nameOf(slot.teacherId)}
              </p>
            ) : null}
            {slot.room ? (
              <p className="text-xs text-slate-500">{slot.room}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export const DashboardTimetableSlider = ({
  matrix,
}: DashboardTimetableSliderProps) => {
  const { days, periods, cells } = matrix;
  const today = new Date().getDay();
  const startIndex = days.length > 0 ? Math.min(today, days.length - 1) : 0;
  const [active, setActive] = useState(startIndex);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollSlideIntoView = (index: number, behavior: ScrollBehavior = "auto") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const width = scroller.clientWidth;
    if (width <= 0) return;
    // Scroll the row only — never scrollIntoView, which jumps the whole page
    // down to this widget when the dashboard opens on mobile.
    scroller.scrollTo({ left: index * width, behavior });
  };

  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(days.length - 1, index));
    setActive(next);
    scrollSlideIntoView(next, "smooth");
  };

  useEffect(() => {
    const id = window.requestAnimationFrame(() =>
      scrollSlideIntoView(startIndex, "auto"),
    );
    return () => window.cancelAnimationFrame(id);
  }, [startIndex]);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const width = scroller.clientWidth || 1;
    const index = Math.round(scroller.scrollLeft / width);
    if (index !== active && index >= 0 && index < days.length) {
      setActive(index);
    }
  };

  if (periods.length === 0) {
    return (
      <p className="text-sm text-slate-500">No periods to display.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 w-9 shrink-0 px-0"
          onClick={() => goTo(active - 1)}
          disabled={active <= 0}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold text-slate-900">{days[active]}</p>
          <p className="text-[11px] text-slate-500">
            Swipe or tap to change day
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 w-9 shrink-0 px-0"
          onClick={() => goTo(active + 1)}
          disabled={active >= days.length - 1}
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {days.map((day, index) => (
          <button
            key={day}
            type="button"
            onClick={() => goTo(index)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              index === active
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600",
            )}
          >
            {day.slice(0, 3)}
          </button>
        ))}
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="-mx-1 flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {days.map((day, dayIndex) => (
          <div
            key={day}
            className="min-w-full w-full shrink-0 snap-start px-1"
          >
            <div className="space-y-2">
              {periods.map((period, periodIndex) => (
                <PeriodCard
                  key={period.key}
                  period={period}
                  cell={cells[dayIndex]?.[periodIndex]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
