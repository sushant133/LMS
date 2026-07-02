import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const Table = ({ className, ...props }) => (_jsx("table", { className: cn("min-w-full divide-y divide-slate-200 text-left text-sm", className), ...props }));
export const TableHead = ({ className, ...props }) => (_jsx("thead", { className: cn("bg-slate-50", className), ...props }));
export const TableBody = ({ className, ...props }) => (_jsx("tbody", { className: cn("divide-y divide-slate-100 bg-white", className), ...props }));
export const Th = ({ className, ...props }) => (_jsx("th", { className: cn("px-4 py-3 font-medium text-slate-600", className), ...props }));
export const Td = ({ className, ...props }) => (_jsx("td", { className: cn("px-4 py-3 text-slate-700", className), ...props }));
