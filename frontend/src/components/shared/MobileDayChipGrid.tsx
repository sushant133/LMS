import { cn } from "lib/utils";

/** Compact tappable day chips for small screens — replaces clipped student×day grids. */
export const MobileDayChipGrid = ({
  days,
  getLabel,
  getSubLabel,
  getColor,
  selectedDay,
  onSelectDay,
  disabled,
}: {
  days: number[];
  getLabel: (day: number) => string;
  getSubLabel?: (day: number) => string;
  getColor?: (day: number) => string | undefined;
  selectedDay?: number | null;
  onSelectDay?: (day: number) => void;
  disabled?: boolean;
}) => (
  <div className="grid grid-cols-4 gap-1.5">
    {days.map((d) => {
      const label = getLabel(d);
      const selected = selectedDay === d;
      return (
        <button
          key={d}
          type="button"
          disabled={disabled || !onSelectDay}
          onClick={() => onSelectDay?.(d)}
          className={cn(
            "min-h-[3.25rem] rounded-xl border px-1 py-1.5 text-center leading-tight",
            selected
              ? "border-brand-500 ring-2 ring-brand-300"
              : "border-slate-200",
            onSelectDay && !disabled && "active:scale-[0.98]",
            (disabled || !onSelectDay) && "cursor-default",
          )}
          style={{ background: getColor?.(d) || "#ffffff" }}
        >
          <div className="text-[10px] font-semibold text-slate-600">{d}</div>
          {getSubLabel ? (
            <div className="text-[9px] text-slate-400">{getSubLabel(d)}</div>
          ) : null}
          <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-slate-900">
            {label || "·"}
          </div>
        </button>
      );
    })}
  </div>
);
