import * as React from "react";
import { cn, formatNumberInputValue } from "lib/utils";

/**
 * Generic text/file/etc input. Prefer `NumberInput` for all numeric fields so
 * empty-while-editing behavior stays consistent ERP-wide.
 *
 * If `type="number"` is used here for legacy reasons, empty/NaN still display blank
 * and are not coerced to 0 by this component.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, value, onChange, ...props }, ref) => {
  const isNumberInput = type === "number";
  const resolvedValue = isNumberInput
    ? formatNumberInputValue(
        typeof value === "number" ||
          typeof value === "string" ||
          value === null ||
          value === undefined
          ? value
          : String(value),
      )
    : value;

  return (
    <input
      ref={ref}
      type={type}
      value={resolvedValue}
      onChange={onChange}
      className={cn(
        "flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
