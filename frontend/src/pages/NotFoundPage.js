import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router-dom";
import { Button } from "components/ui/button";
export const NotFoundPage = () => (_jsxs("div", { className: "flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white", children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3em] text-emerald-300", children: "404" }), _jsx("h1", { className: "text-4xl font-semibold", children: "Page not found" }), _jsx("p", { className: "max-w-md text-slate-300", children: "The page you requested does not exist in the MantraSphere CampusPro workspace." }), _jsx(Button, { asChild: true, children: _jsx(Link, { to: "/", children: "Go home" }) })] }));
