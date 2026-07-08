import type { SelectHTMLAttributes } from "react";
import { cn } from "lib/utils";

export const Select = ({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "flex h-10 w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 disabled:cursor-not-allowed",
      className
    )}
    {...props}
  >
    {children}
  </select>
);

