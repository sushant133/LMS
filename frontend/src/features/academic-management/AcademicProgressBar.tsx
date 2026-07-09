interface AcademicProgressBarProps {
  completedPercent: number;
  remainingPercent?: number;
  className?: string;
  compact?: boolean;
}

/** Compact progress bar: completed (green) + remaining (amber). */
export const AcademicProgressBar = ({
  completedPercent,
  remainingPercent,
  className = "",
  compact = false,
}: AcademicProgressBarProps) => {
  const completed = Math.min(100, Math.max(0, completedPercent));
  const remaining = remainingPercent ?? Math.max(0, 100 - completed);
  return (
    <div className={`space-y-1 ${className}`}>
      <div
        className={`flex w-full overflow-hidden rounded-full bg-slate-200 ${compact ? "h-1.5" : "h-2"}`}
      >
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${completed}%` }}
        />
        <div
          className="h-full bg-amber-400/80 transition-all"
          style={{
            width: `${Math.min(remaining, Math.max(0, 100 - completed))}%`,
          }}
        />
      </div>
      {!compact ? (
        <p className="text-xs text-slate-600">
          {completed}% complete ·{" "}
          <span className="font-medium text-amber-700">
            {remaining}% remaining
          </span>
        </p>
      ) : null}
    </div>
  );
};
