import type { AcademicCalendarEventRecord } from "@phit-erp/shared";
import { cn } from "lib/utils";
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  formatMonthKey,
  getAdDayParts,
  getBsMonthAdRangeLabel,
  getDateCellClass,
  getDateCellStyle,
  getEventTypeColor,
  getEventTypeLabel,
  isSaturdayBs,
  listEventsForBsMonth,
  pickPrimaryEvent,
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
  onDateClick,
}: AcademicCalendarMonthProps) => {
  const cells = buildMonthGrid(year, month);
  const adRangeLabel = getBsMonthAdRangeLabel(year, month);
  const monthPrefix = formatMonthKey(year, month);
  const isCurrentMonth = todayBs.startsWith(monthPrefix);

  // Stored calendar events only — Saturday is a fixed holiday (not listed here)
  const monthEvents = listEventsForBsMonth(eventsByDate, year, month).filter(
    (event) => !event.isSystemGenerated,
  );

  return (
    <div
      className={cn(
        "group/month flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(12,45,107,0.12)] transition duration-300",
        "hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(12,45,107,0.18)]",
        isCurrentMonth
          ? "border-brand-200/80 ring-1 ring-brand-500/15"
          : "border-slate-200/90",
      )}
    >
      {/* Premium brand gradient header — all months */}
      <div className="relative border-b border-brand-700/30 bg-gradient-to-br from-brand-600 via-brand-600 to-brand-800 px-3.5 py-3">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:12px_12px]" />
        <div className="relative flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-white">
              {monthName}
              {adRangeLabel ? (
                <span className="ml-1.5 text-[13px] font-medium text-brand-100">
                  · {adRangeLabel}
                </span>
              ) : null}
            </h3>
            {isCurrentMonth ? (
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-100/90">
                Current month
              </p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold tabular-nums tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
            BS {monthPrefix}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3 pt-2.5">
        {/* Weekday headers */}
        <div className="mb-1.5 grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className={cn(
                "py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                label === "Sat"
                  ? "text-rose-500"
                  : "text-slate-400",
              )}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Date grid */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, index) => {
            if (!day) {
              return <div key={`empty-${index}`} className="h-12" />;
            }

            const dateBs = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsByDate.get(dateBs) ?? [];
            const primaryEvent = pickPrimaryEvent(dayEvents);
            const isToday = dateBs === todayBs;
            const isSelected = Boolean(
              selectedDateBs && dateBs === selectedDateBs,
            );
            const saturday = isSaturdayBs(dateBs);
            const adParts = getAdDayParts(dateBs);
            const hasEvents = dayEvents.length > 0;
            const title = [
              ...dayEvents.map(
                (event) =>
                  `${event.name} (${getEventTypeLabel(event.eventType)})`,
              ),
              saturday && dayEvents.length === 0
                ? "Public Holiday (Saturday)"
                : "",
              adParts
                ? `AD ${adParts.year}-${String(adParts.month).padStart(2, "0")}-${String(adParts.day).padStart(2, "0")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n");

            return (
              <button
                key={dateBs}
                type="button"
                title={title || undefined}
                onClick={() => onDateClick(dateBs, dayEvents)}
                style={getDateCellStyle(primaryEvent)}
                className={cn(
                  "relative flex h-12 flex-col items-center justify-center rounded-xl px-0.5 pb-2.5 pt-1 text-[13px] font-semibold tabular-nums transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-200/80",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
                  getDateCellClass(primaryEvent, isToday, saturday),
                  !primaryEvent &&
                    !saturday &&
                    !isToday &&
                    "bg-slate-50/60 text-slate-700 hover:bg-brand-50/80",
                  isToday &&
                    !primaryEvent?.isHoliday &&
                    "shadow-[0_0_0_1px_rgba(43,93,168,0.25),0_4px_12px_-2px_rgba(12,45,107,0.25)]",
                  isSelected &&
                    "ring-2 ring-brand-600 ring-offset-2 ring-offset-white",
                )}
              >
                <span className="leading-none">{day}</span>

                {/* Event density dots */}
                {hasEvents ? (
                  <span className="absolute left-1/2 top-1 flex -translate-x-1/2 gap-0.5">
                    {dayEvents.slice(0, 3).map((event, i) => (
                      <span
                        key={`${event._id}-${i}`}
                        className="h-1 w-1 rounded-full"
                        style={{
                          backgroundColor:
                            getEventTypeColor(event.eventType) || "#64748b",
                        }}
                      />
                    ))}
                  </span>
                ) : null}

                {adParts ? (
                  <span
                    className={cn(
                      "absolute bottom-1 right-1 text-[8px] font-medium leading-none tabular-nums",
                      saturday || primaryEvent?.isHoliday
                        ? "text-rose-700/70"
                        : "text-slate-400",
                    )}
                  >
                    {adParts.label}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Month events panel */}
        <div className="mt-3 min-h-0 flex-1 border-t border-slate-100/90 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Month events
            </p>
            {monthEvents.length > 0 ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                {monthEvents.length}
              </span>
            ) : null}
          </div>

          {monthEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center">
              <p className="text-xs text-slate-400">No events this month</p>
            </div>
          ) : (
            <ul className="max-h-44 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
              {monthEvents.map((event) => {
                const start = event.startDateBs || event.dateBs;
                const end = event.endDateBs || event.dateBs;
                const range = start === end ? start : `${start} → ${end}`;
                const color = getEventTypeColor(event.eventType);
                return (
                  <li
                    key={event._id}
                    className="group/event relative overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-r from-white to-slate-50/80 px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-200 hover:shadow-sm"
                  >
                    <span
                      className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
                      style={{ backgroundColor: color }}
                    />
                    <div className="pl-2">
                      <p className="text-xs font-semibold leading-snug text-slate-900">
                        {event.name}
                      </p>
                      <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                        <span style={{ color }}>{getEventTypeLabel(event.eventType)}</span>
                        {event.isHoliday ? (
                          <span className="text-rose-600"> · Holiday</span>
                        ) : null}
                        <span className="text-slate-400"> · {range}</span>
                        {event.totalDays && event.totalDays > 1
                          ? ` · ${event.totalDays}d`
                          : ""}
                      </p>
                      {event.reason?.trim() ? (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                          {event.reason}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
