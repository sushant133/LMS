import * as React from "react";
import { cn, formatNumberInputValue } from "lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, value, onChange, ...props }, ref) => {
    const isNumberInput = type === "number";
    const resolvedValue = isNumberInput
      ? formatNumberInputValue(typeof value === "number" ? value : value === "" ? NaN : Number(value))
      : value;

    return (
      <input
        ref={ref}
        type={type}
        value={resolvedValue}
        onChange={onChange}
        className={cn(
          "flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";