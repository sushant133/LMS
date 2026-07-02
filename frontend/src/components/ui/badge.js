import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const Badge = ({ className, ...props }) => (_jsx("span", { className: cn("inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700", className), ...props }));
