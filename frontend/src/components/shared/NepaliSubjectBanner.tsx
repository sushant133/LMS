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
        <div className="mt-0.5 space-y-1 text-xs text-amber-900/90">
          <p>
            Numbering: <strong className="font-semibold">एकाइ १</strong>, then{" "}
            <strong className="font-semibold">क. ख. ग. घ.</strong> Type with a
            Nepali Unicode keyboard (Windows: Nepali Traditional / Romanized,
            Mac: Nepali, or Google Input Tools) — all letters and matras
            (क ख ग घ ङ … ा ि ी ु ू े ै ो ौ ँ ं ्) display correctly. Paste
            Unicode from Word/Docs is never rewritten. Legacy Preeti converts
            on blur/save only.
          </p>
          <p className="text-amber-800/90">
            Font: Noto Sans Devanagari. English subjects are unchanged.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-amber-900/90">
          एकाइ १ · क. ख. ग. · Unicode paste · Noto Sans Devanagari
        </p>
      )}
    </div>
  </div>
);
