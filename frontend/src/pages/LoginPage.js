import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { School } from "lucide-react";
import { loginSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { roleRedirectMap } from "lib/auth";
import { resetAppShell } from "lib/resetAppShell";
import { parseErrorMessage } from "lib/utils";
const LoginHero = () => {
    const { t } = useTranslation();
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-col items-center gap-3 px-6 pt-8 text-center text-white lg:hidden", children: [_jsx("div", { className: "rounded-2xl bg-white/10 p-3", children: _jsx(School, { className: "h-7 w-7" }) }), _jsx("h1", { className: "text-2xl font-semibold", children: t("appName") }), _jsx("p", { className: "max-w-sm text-sm text-emerald-50/85", children: "BS calendar, streamlined workflows, and school operations in one place." })] }), _jsxs("div", { className: "hidden p-12 text-white lg:flex lg:flex-col lg:justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "rounded-2xl bg-white/10 p-3", children: _jsx(School, { className: "h-7 w-7" }) }), _jsx("div", { children: _jsx("h1", { className: "text-2xl font-semibold", children: t("appName") }) })] }), _jsxs("div", { className: "max-w-xl", children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3em] text-emerald-200", children: "2026 Nepal-ready" }), _jsx("h2", { className: "mt-4 text-5xl font-semibold leading-tight", children: "BS calendar, streamlined workflows, and school operations in one place." }), _jsx("p", { className: "mt-6 text-lg text-emerald-50/85", children: "Built for private schools, community schools, government-aided institutions, and +2 colleges across Nepal." })] })] })] }));
};
export const LoginPage = () => {
    const [form, setForm] = useState({ email: "", password: "" });
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { login, user, loading } = useAuth();
    useLayoutEffect(() => {
        resetAppShell();
    }, []);
    useEffect(() => {
        if (!loading && user) {
            navigate(roleRedirectMap[user.role], { replace: true });
        }
    }, [loading, navigate, user]);
    const handleSubmit = async (event) => {
        event.preventDefault();
        const parsed = loginSchema.safeParse(form);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
        }
        try {
            const result = await login(parsed.data);
            toast.success(t("login"));
            navigate(result.redirectTo);
        }
        catch (error) {
            toast.error(parseErrorMessage(error));
        }
    };
    if (!loading && user) {
        return _jsx(Navigate, { to: roleRedirectMap[user.role], replace: true });
    }
    return (_jsxs("div", { className: "grid min-h-screen w-full bg-[linear-gradient(135deg,_#0f172a_0%,_#064e3b_45%,_#dcfce7_100%)] lg:grid-cols-[1.2fr_0.8fr]", children: [_jsx(LoginHero, {}), _jsx("div", { className: "flex items-center justify-center p-6 lg:col-start-2", children: _jsxs(Card, { className: "w-full max-w-md border-white/60 bg-white/95 shadow-2xl", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: t("login") }) }), _jsxs(CardContent, { children: [_jsxs("form", { className: "space-y-4", onSubmit: handleSubmit, children: [_jsx(FormField, { label: t("email"), children: _jsx(Input, { type: "email", value: form.email, onChange: (event) => setForm((current) => ({ ...current, email: event.target.value })) }) }), _jsx(FormField, { label: t("password"), children: _jsx(Input, { type: "password", value: form.password, onChange: (event) => setForm((current) => ({ ...current, password: event.target.value })) }) }), _jsx(Button, { className: "w-full", type: "submit", children: t("login") })] }), import.meta.env.DEV ? (_jsxs("div", { className: "mt-4 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900", children: [_jsxs("p", { children: ["Demo admin: ", _jsx("span", { className: "font-medium", children: "admin@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Demo teacher: ", _jsx("span", { className: "font-medium", children: "ram.sharma@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Demo student: ", _jsx("span", { className: "font-medium", children: "student01@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Demo parent: ", _jsx("span", { className: "font-medium", children: "parent.sharma@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Library staff: ", _jsx("span", { className: "font-medium", children: "maya.poudel@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Laboratory staff: ", _jsx("span", { className: "font-medium", children: "binod.shrestha@demoerp.nepal-school.com" }), " / ", _jsx("span", { className: "font-medium", children: "Demo@123456" })] }), _jsxs("p", { children: ["Demo accountant: ", _jsx("span", { className: "font-medium", children: "accountant@demo.school" }), " / ", _jsx("span", { className: "font-medium", children: "12345678" })] })] })) : null, _jsxs("p", { className: "mt-4 text-sm text-slate-600", children: ["No account?", " ", _jsx(Link, { className: "font-semibold text-emerald-700", to: "/register", children: t("register") })] })] })] }) })] }));
};
