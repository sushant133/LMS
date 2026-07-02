import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const Label = ({ className, ...props }) => (_jsx("label", { className: cn("text-sm font-medium text-slate-700", className), ...props }));
