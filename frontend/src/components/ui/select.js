import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const Select = ({ className, children, ...props }) => (_jsx("select", { className: cn("flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500", className), ...props, children: children }));
