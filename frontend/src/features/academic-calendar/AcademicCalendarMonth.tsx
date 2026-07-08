import type { AcademicCalendarEventRecord } from "@phit-erp/shared";
import { cn } from "lib/utils";
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  formatMonthKey,
  getDateCellClass,
  getDateCellStyle,
  getEventTypeLabel
} from "./academicCalendarUtils";

interface AcademicCalendarMonthProps {
  year: number;
  month: number;
  monthName: string;
  eventsByDate: Map<string, AcademicCalendarEventRecord[]>;
  todayBs: string;
  selectedDateBs?: string;
  onDateClick: (dateBs: string, events: AcademicCalendarEventRecord[]) => void;
}

export const AcademicCalendarMonth = ({
  year,
  month,
  monthName,
  eventsByDate,
  todayBs,
  selectedDateBs,
  onDateClick
}: AcademicCalendarMonthProps) => {
  const cells = buildMonthGrid(year, month);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{monthName}</h3>
        <span className="text-xs text-slate-500">{formatMonthKey(year, month)}</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} className="h-8" />;
          }

          const dateBs = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvents = eventsByDate.get(dateBs) ?? [];
          const primaryEvent = dayEvents[0];
          const isToday = dateBs === todayBs;
          const isSelected = Boolean(selectedDateBs && dateBs === selectedDateBs);
          const title = dayEvents.map((event) => `${event.name} (${getEventTypeLabel(event.eventType)})`).join("\n");

          return (
            <button
              key={dateBs}
              type="button"
              title={title || undefined}
              onClick={() => onDateClick(dateBs, dayEvents)}
              style={getDateCellStyle(primaryEvent)}
              className={cn(
                "relative flex h-8 items-center justify-center rounded-md text-xs font-medium transition cursor-pointer",
                getDateCellClass(primaryEvent, isToday),
                isSelected && "ring-2 ring-brand-600 ring-offset-1"
              )}
            >
              {day}
              {dayEvents.length > 1 ? (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-slate-700" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};