import { Picker, getTodayBs, parseBsDate, type NepaliDate } from "@munatech/nepali-datepicker";
import "@munatech/nepali-datepicker/styles.css";

interface NepaliDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Use dropdown year/month selectors inside the calendar (faster for birth dates). */
  captionLayout?: "buttons" | "dropdown";
  minDate?: NepaliDate;
  maxDate?: NepaliDate;
}

const formatBsValue = (date: NepaliDate): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

export const NepaliDateField = ({
  value,
  onChange,
  placeholder,
  captionLayout = "buttons",
  minDate,
  maxDate
}: NepaliDateFieldProps) => (
  <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-500 [&_select]:min-w-[4.5rem] [&_select]:cursor-pointer [&_select]:rounded-md [&_select]:border-slate-300 [&_select]:bg-white [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm [&_select]:text-slate-900">
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
      placeholder={placeholder}
      className="w-full justify-between rounded-lg border-none bg-transparent px-0 py-0 text-sm text-slate-900 shadow-none outline-none"
    />
  </div>
);

/** Sensible BS bounds for student date of birth: roughly 5–45 years old. */
export const studentBirthMinDate = (): NepaliDate => {
  const today = getTodayBs();
  return { year: today.year - 45, month: 1, day: 1 };
};

export const studentBirthMaxDate = (): NepaliDate => getTodayBs();