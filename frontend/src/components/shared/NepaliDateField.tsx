import {
  adToBs,
  bsToAd,
  Picker,
  getTodayBs,
  parseBsDate,
  type NepaliDate,
} from "@munatech/nepali-datepicker";
import "@munatech/nepali-datepicker/styles.css";
import { Input } from "components/ui/input";

interface NepaliDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Calendar header: dropdown year/month selectors (default) or prev/next buttons. */
  captionLayout?: "buttons" | "dropdown";
  minDate?: NepaliDate;
  maxDate?: NepaliDate;
}

const AD_BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatBsValue = (date: NepaliDate): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

const formatAdParts = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Convert BS YYYY-MM-DD → AD YYYY-MM-DD. Returns "" if invalid. */
export const bsDateToAdString = (dateBs: string): string => {
  const trimmed = dateBs?.trim() ?? "";
  if (!AD_BS_DATE_RE.test(trimmed)) return "";
  try {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (!year || !month || !day) return "";
    const ad = bsToAd(year, month, day);
    return formatAdParts(ad.year, ad.month, ad.day);
  } catch {
    return "";
  }
};

/** Convert AD YYYY-MM-DD → BS YYYY-MM-DD. Returns "" if invalid. */
export const adDateToBsString = (dateAd: string): string => {
  const trimmed = dateAd?.trim() ?? "";
  if (!AD_BS_DATE_RE.test(trimmed)) return "";
  try {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (!year || !month || !day) return "";
    const bs = adToBs(year, month, day);
    return formatBsValue(bs);
  } catch {
    return "";
  }
};

export const NepaliDateField = ({
  value,
  onChange,
  placeholder,
  captionLayout = "dropdown",
  minDate,
  maxDate,
}: NepaliDateFieldProps) => (
  <div className="relative z-0 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-brand-500 focus-within:z-10 [&_select]:min-w-[4.5rem] [&_select]:cursor-pointer [&_select]:rounded-md [&_select]:border-slate-300 [&_select]:bg-white [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm [&_select]:text-slate-900">
    <Picker
      language="en"
      captionLayout={captionLayout}
      minDate={minDate}
      maxDate={maxDate}
      value={value ? (parseBsDate(value) ?? undefined) : undefined}
      onChange={(date) => {
        if (!date) {
          onChange("");
          return;
        }

        onChange(formatBsValue(date));
      }}
      placeholder={placeholder ?? "Select BS date"}
      // Calendar is portaled to body; keep it above sticky app chrome
      calendarClassName="z-[200]"
      className="w-full justify-between rounded-lg border-none bg-transparent px-0 py-0 text-sm text-slate-900 shadow-none outline-none"
    />
  </div>
);

/**
 * Paired BS + AD date inputs. Entering either calendar updates the other
 * automatically. `valueBs` / `onChangeBs` are always BS (YYYY-MM-DD) for API storage.
 */
interface DualBsAdDateFieldProps {
  valueBs: string;
  onChangeBs: (valueBs: string) => void;
  minDate?: NepaliDate;
  maxDate?: NepaliDate;
  /** Optional AD bounds (YYYY-MM-DD) for the native date input. */
  minAd?: string;
  maxAd?: string;
  bsPlaceholder?: string;
  disabled?: boolean;
}

export const DualBsAdDateField = ({
  valueBs,
  onChangeBs,
  minDate,
  maxDate,
  minAd,
  maxAd,
  bsPlaceholder,
  disabled = false,
}: DualBsAdDateFieldProps) => {
  const valueAd = valueBs ? bsDateToAdString(valueBs) : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-slate-500">BS (Bikram Sambat)</p>
        <NepaliDateField
          value={valueBs}
          onChange={(bs) => onChangeBs(bs)}
          placeholder={bsPlaceholder ?? "Select BS date"}
          minDate={minDate}
          maxDate={maxDate}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-slate-500">AD (Gregorian)</p>
        <Input
          type="date"
          value={valueAd}
          disabled={disabled}
          min={minAd}
          max={maxAd}
          onChange={(event) => {
            const ad = event.target.value;
            if (!ad) {
              onChangeBs("");
              return;
            }
            const bs = adDateToBsString(ad);
            // Prefer converted BS so both stay in sync; clear when conversion fails.
            onChangeBs(bs);
          }}
          className="h-[2.625rem] rounded-xl border-slate-300"
        />
        {valueBs && valueAd ? (
          <p className="text-[11px] text-slate-400">
            BS {valueBs} · AD {valueAd}
          </p>
        ) : null}
      </div>
    </div>
  );
};

/** Sensible BS bounds for student date of birth: roughly 5–45 years old. */
export const studentBirthMinDate = (): NepaliDate => {
  const today = getTodayBs();
  return { year: today.year - 45, month: 1, day: 1 };
};

export const studentBirthMaxDate = (): NepaliDate => getTodayBs();

/** AD YYYY-MM-DD bounds matching student birth min/max (for native date input). */
export const studentBirthMinAd = (): string => {
  const minBs = studentBirthMinDate();
  return bsDateToAdString(formatBsValue(minBs)) || "";
};

export const studentBirthMaxAd = (): string => {
  const maxBs = studentBirthMaxDate();
  return bsDateToAdString(formatBsValue(maxBs)) || "";
};
