import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { registerSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
export const RegisterPage = () => {
    const [form, setForm] = useState({
        schoolId: "",
        fullName: "",
        email: "",
        password: "",
        phone: "",
        role: "PARENT"
    });
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { register } = useAuth();
    const schoolsQuery = useQuery({
        queryKey: ["public-schools"],
        queryFn: () => unwrap(api.get("/schools/public"))
    });
    const handleSubmit = async (event) => {
        event.preventDefault();
        const parsed = registerSchema.safeParse(form);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
        }
        try {
            const result = await register(parsed.data);
            toast.success("Registration successful");
            navigate(result.redirectTo);
        }
        catch (error) {
            toast.error(parseErrorMessage(error));
        }
    };
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,_#ecfeff_0%,_#f8fafc_50%,_#dcfce7_100%)] p-6", children: _jsxs(Card, { className: "w-full max-w-lg", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: t("register") }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: handleSubmit, children: [_jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "School", children: _jsxs(Select, { value: form.schoolId, onChange: (event) => setForm((current) => ({ ...current, schoolId: event.target.value })), children: [_jsx("option", { value: "", children: "Select school" }), (schoolsQuery.data ?? []).map((school) => (_jsx("option", { value: school._id, children: school.name }, school._id)))] }) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: t("fullName"), children: _jsx(Input, { value: form.fullName, onChange: (event) => setForm((current) => ({ ...current, fullName: event.target.value })) }) }) }), _jsx(FormField, { label: t("email"), children: _jsx(Input, { type: "email", value: form.email, onChange: (event) => setForm((current) => ({ ...current, email: event.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: form.phone ?? "", onChange: (event) => setForm((current) => ({ ...current, phone: event.target.value })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: t("password"), children: _jsx(Input, { type: "password", value: form.password, onChange: (event) => setForm((current) => ({ ...current, password: event.target.value })) }) }) }), _jsx("div", { className: "md:col-span-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800", children: "Public self-registration is enabled for parents only. School admins, teachers, and students are created by school administration." }), _jsxs("div", { className: "md:col-span-2 flex items-center justify-between", children: [_jsx(Link, { className: "text-sm font-medium text-emerald-700", to: "/login", children: t("login") }), _jsx(Button, { type: "submit", children: t("register") })] })] }) })] }) }));
};
