import type { LucideIcon } from "lucide-react";
import { cn } from "lib/utils";

/** Heading used by every Bank / Cash card: tinted icon, title, optional subtitle. */
export const BankCashSectionTitle = ({
  icon: Icon,
  title,
  subtitle,
  tone = "brand",
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone?: "brand" | "emerald" | "sky" | "amber";
}) => (
  <div className="flex items-start gap-3">
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
        tone === "brand" && "bg-brand-50 text-brand-600",
        tone === "emerald" && "bg-emerald-50 text-emerald-600",
        tone === "sky" && "bg-sky-50 text-sky-600",
        tone === "amber" && "bg-amber-50 text-amber-600",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
    <div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  </div>
);
