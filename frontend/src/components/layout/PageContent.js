import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "lib/utils";
export const PageContent = ({ children, className }) => (_jsx("div", { className: cn("min-w-0 w-full", className), children: children }));
