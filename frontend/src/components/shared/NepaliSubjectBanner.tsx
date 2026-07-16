import { Languages } from "lucide-react";
import { cn } from "lib/utils";

interface NepaliSubjectBannerProps {
  subjectName?: string;
  className?: string;
  /** Compact single-line for tight form rows. */
  compact?: boolean;
}

/**
 * Shown only when the selected subject is Nepali — guides Unicode / keyboard entry.
 */
export const NepaliSubjectBanner = ({
  subjectName,
  className,
  compact = false,
}: NepaliSubjectBannerProps) => (
  <div
    className={cn(
      "flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-950",
      compact ? "px-3 py-2" : "px-4 py-3",
      className,
    )}
    role="status"
  >
    <Languages
      className={cn(
        "shrink-0 text-amber-700",
        compact ? "mt-0.5 h-4 w-4" : "mt-0.5 h-5 w-5",
      )}
    />
    <div className="min-w-0">
      <p className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>
        नेपाली विषय — Nepali text enabled
        {subjectName ? (
          <span className="font-normal text-amber-900"> · {subjectName}</span>
        ) : null}
      </p>
      {!compact ? (
        <p className="mt-0.5 text-xs text-amber-900/90">
          Unit titles, headings, and descriptions use Nepali (Devanagari) font.
          Type with a Nepali Unicode keyboard (Windows: Nepali Traditional, Mac:
          Nepali, or Google Input Tools). English subjects keep normal Latin
          input.
        </p>
      ) : (
        <p className="text-[11px] text-amber-900/90">
          Use Nepali Unicode keyboard · Devanagari font applied to content fields
        </p>
      )}
    </div>
  </div>
);
