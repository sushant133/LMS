import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "lib/utils";
export const Textarea = React.forwardRef(({ className, ...props }, ref) => (_jsx("textarea", { ref: ref, className: cn("min-h-[110px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500", className), ...props })));
Textarea.displayName = "Textarea";
