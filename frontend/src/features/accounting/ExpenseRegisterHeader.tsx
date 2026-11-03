import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Clock3, FileSpreadsheet, Landmark, Plus, Printer, Receipt, Wallet } from "lucide-react";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { fiscalYearStartBs, isBankPaymentMethod, monthStartBs, npr } from "./bankCashShared";

export interface ExpenseHeaderRecord {
  dateBs: string;
  amountNpr: number;
  paymentMethod: string;
  /** Direct Expense only: PAID / PENDING / PARTIAL */
  paymentStatus?: string;
}

interface ExpenseRegisterHeaderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: "rose" | "amber";
  records: ExpenseHeaderRecord[];
  /** Show the unpaid-bills tile (Direct Expense) */
  showUnpaid?: boolean;
  onNew?: () => void;
  newLabel?: string;
  /** Print / Excel of the register list (as currently filtered). */
  onPrint?: () => void;
  onExport?: () => void;
}

const TONES = {
  rose: {
    frame: "border-rose-100 from-rose-50 via-white to-amber-50",
    badge: "bg-rose-600",
    value: "text-rose-700",
  },
  amber: {
    frame: "border-amber-100 from-amber-50 via-white to-brand-50",
    badge: "bg-amber-600",
    value: "text-amber-700",
  },
} as const;

/**
 * Bank / Cash style header for the Direct and Indirect Expense registers:
 * title, quick "New" action and totals for this month / fiscal year.
 */
export const ExpenseRegisterHeader = ({
  title,
  subtitle,
  icon: Icon,
  tone,
  records,
  showUnpaid,
  onNew,
  newLabel = "New entry",
  onPrint,
  onExport,
}: ExpenseRegisterHeaderProps) => {
  const colors = TONES[tone];

  const stats = useMemo(() => {
    const month = monthStartBs();
    const fiscal = fiscalYearStartBs();
    let monthTotal = 0;
    let fiscalTotal = 0;
    let cash = 0;
    let bank = 0;
    let unpaid = 0;
    let unpaidCount = 0;
    for (const record of records) {
      const value = Number(record.amountNpr) || 0;
      if (record.dateBs >= month) monthTotal += value;
      if (record.dateBs >= fiscal) fiscalTotal += value;
      if (record.paymentStatus && record.paymentStatus !== "PAID") {
        unpaid += value;
        unpaidCount += 1;
        continue;
      }
      if (isBankPaymentMethod(record.paymentMethod)) bank += value;
      else cash += value;
    }
    return { monthTotal, fiscalTotal, cash, bank, unpaid, unpaidCount };
  }, [records]);

  const tiles: Array<{ label: string; value: string; hint: string; icon: LucideIcon; tone: string }> = [
    { label: "This month", value: npr(stats.monthTotal), hint: "From the 1st of this month", icon: CalendarDays, tone: colors.value },
    { label: "This fiscal year", value: npr(stats.fiscalTotal), hint: "Since Shrawan 1", icon: Receipt, tone: "text-slate-900" },
    {
      label: "Paid in cash / bank",
      value: `${npr(stats.cash)} · ${npr(stats.bank)}`,
      hint: "Cash in Hand · Bank",
      icon: Wallet,
      tone: "text-emerald-700",
    },
    showUnpaid
      ? {
          label: "Unpaid bills",
          value: npr(stats.unpaid),
          hint: `${stats.unpaidCount} bill${stats.unpaidCount === 1 ? "" : "s"} still to pay`,
          icon: Clock3,
          tone: stats.unpaid > 0 ? "text-amber-700" : "text-slate-900",
        }
      : {
          label: "Entries",
          value: String(records.length),
          hint: "Recorded in this register",
          icon: Landmark,
          tone: "text-slate-900",
        },
  ];

  return (
    <div className={cn("overflow-hidden rounded-3xl border bg-gradient-to-br p-5 sm:p-6", colors.frame)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm", colors.badge)}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-600">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onPrint ? (
            <Button size="sm" variant="outline" onClick={onPrint}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print / PDF
            </Button>
          ) : null}
          {onExport ? (
            <Button size="sm" variant="outline" onClick={onExport}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
          ) : null}
          {onNew ? (
            <Button size="sm" onClick={onNew}>
              <Plus className="mr-1.5 h-4 w-4" />
              {newLabel}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => {
          const TileIcon = tile.icon;
          return (
            <div key={tile.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <TileIcon className="h-4 w-4 text-slate-400" /> {tile.label}
              </p>
              <p className={cn("mt-1 text-lg font-semibold tabular-nums", tile.tone)}>{tile.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{tile.hint}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
