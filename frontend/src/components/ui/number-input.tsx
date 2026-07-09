import * as React from "react";
import { cn, formatNumberInputValue, parseNumberInput } from "lib/utils";

export type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  /**
   * Controlled numeric value. Empty / null / undefined / NaN render as a blank field
   * so users can clear with Backspace/Delete without the value snapping back to 0.
   */
  value?: number | string | null;
  /**
   * Native-compatible change handler. When the field is empty:
   * `event.target.value === ""` and `event.target.valueAsNumber` is `NaN`.
   * Do not coerce empty to 0 in the parent — validate on submit/blur instead.
   */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /**
   * Preferred callback: `undefined` when cleared, otherwise the numeric value.
   * Prefer this over reading `valueAsNumber` when you want optional empty state.
   */
  onValueChange?: (value: number | undefined) => void;
};

/**
 * Standardized ERP number input.
 * - Keeps the native spinner (type="number")
 * - Allows full clear while editing (empty string, not forced 0)
 * - Typing, spinner, and keyboard all work together
 * - Validation should run on submit/blur, not by auto-filling 0 on change
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onChange, onValueChange, ...props }, ref) => {
    const displayValue = formatNumberInputValue(value);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange?.(parseNumberInput(event));
      onChange?.(event);
    };

    return (
      <input
        ref={ref}
        type="number"
        value={displayValue}
        onChange={handleChange}
        className={cn(
          "flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
          className,
        )}
        {...props}
      />
    );
  },
);

NumberInput.displayName = "NumberInput";
