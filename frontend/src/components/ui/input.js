import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "lib/utils";
export const Input = React.forwardRef(({ className, ...props }, ref) => (_jsx("input", { ref: ref, className: cn("flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-emerald-500", className), ...props })));
Input.displayName = "Input";
