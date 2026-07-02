import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const Card = ({ className, ...props }) => (_jsx("div", { className: cn("rounded-3xl border border-slate-200 bg-white shadow-sm", className), ...props }));
export const CardHeader = ({ className, ...props }) => (_jsx("div", { className: cn("flex flex-col gap-1 border-b border-slate-100 px-6 py-5", className), ...props }));
export const CardTitle = ({ className, ...props }) => (_jsx("h3", { className: cn("text-lg font-semibold text-slate-900", className), ...props }));
export const CardContent = ({ className, ...props }) => (_jsx("div", { className: cn("px-6 py-5", className), ...props }));
