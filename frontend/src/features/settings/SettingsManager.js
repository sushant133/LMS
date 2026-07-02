import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { settingsSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useAuth } from "features/auth/AuthProvider";
const defaultSettingsValue = {
    schoolName: "",
    schoolNameNp: "",
    academicYearBs: "2083/2084",
    principalName: "",
    contactEmail: "",
    contactPhone: "",
    address: {
        province: "",
        district: "",
        municipality: "",
        ward: "",
        streetAddress: ""
    },
    holidays: [],
    infrastructure: {
        classrooms: 0,
        usableClassrooms: 0,
        toiletsMale: 0,
        toiletsFemale: 0,
        toiletsDisabled: 0,
        drinkingWater: false,
        electricity: false,
        internet: false,
        libraryBooks: 0,
        hasScienceLab: false,
        hasComputerLab: false,
        hasPlayground: false,
        hasRamp: false,
        midDayMeal: false
    }
};
export const SettingsManager = () => {
    const { user, availableSchools } = useAuth();
    const [form, setForm] = useState(defaultSettingsValue);
    const settingsQuery = useQuery({
        queryKey: ["settings"],
        queryFn: () => unwrap(api.get("/settings"))
    });
    useEffect(() => {
        if (!settingsQuery.data) {
            return;
        }
        setForm({
            schoolName: settingsQuery.data.schoolName,
            schoolNameNp: settingsQuery.data.schoolNameNp,
            academicYearBs: settingsQuery.data.academicYearBs,
            principalName: settingsQuery.data.principalName,
            contactEmail: settingsQuery.data.contactEmail,
            contactPhone: settingsQuery.data.contactPhone,
            address: settingsQuery.data.address,
            holidays: settingsQuery.data.holidays,
            infrastructure: settingsQuery.data.infrastructure || defaultSettingsValue.infrastructure
        });
    }, [settingsQuery.data]);
    const settingsMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.put("/settings", payload)),
        onSuccess: async () => {
            toast.success("Settings updated");
            await queryClient.invalidateQueries({ queryKey: ["settings"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    return (_jsxs("div", { className: "space-y-8", children: [_jsx(PageHeader, { title: "School Settings", description: "Manage your school's profile, contact details, holidays, and infrastructure data required for IEMIS reporting." }), user?.role === "SCHOOL_ADMIN" && availableSchools?.[0] && (_jsxs("div", { className: "-mt-4 text-sm text-emerald-700", children: ["Updating details for ", _jsx("span", { className: "font-medium", children: availableSchools[0].name })] })), _jsxs("form", { onSubmit: (event) => {
                    event.preventDefault();
                    const parsed = settingsSchema.safeParse(form);
                    if (!parsed.success) {
                        toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                        return;
                    }
                    void settingsMutation.mutateAsync(parsed.data);
                }, children: [_jsxs(Card, { className: "mb-6", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "School Profile" }) }), _jsx(CardContent, { children: _jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: "School Name (English)", children: _jsx(Input, { value: form.schoolName, onChange: (event) => setForm((current) => ({ ...current, schoolName: event.target.value })) }) }), _jsx(FormField, { label: "School Name (Nepali)", children: _jsx(Input, { value: form.schoolNameNp, onChange: (event) => setForm((current) => ({ ...current, schoolNameNp: event.target.value })) }) }), _jsx(FormField, { label: "Academic Year (BS)", children: _jsx(Input, { value: form.academicYearBs, onChange: (event) => setForm((current) => ({ ...current, academicYearBs: event.target.value })) }) }), _jsx(FormField, { label: "Principal Name", children: _jsx(Input, { value: form.principalName, onChange: (event) => setForm((current) => ({ ...current, principalName: event.target.value })) }) })] }) })] }), _jsxs(Card, { className: "mb-6", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Contact Information" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: "Contact Email", children: _jsx(Input, { type: "email", value: form.contactEmail, onChange: (event) => setForm((current) => ({ ...current, contactEmail: event.target.value })) }) }), _jsx(FormField, { label: "Contact Phone", children: _jsx(Input, { value: form.contactPhone, onChange: (event) => setForm((current) => ({ ...current, contactPhone: event.target.value })) }) })] }), _jsx(AddressFields, { value: form.address, onChange: (address) => setForm((current) => ({ ...current, address })) })] })] }), _jsxs(Card, { className: "mb-6 border-emerald-200", children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Infrastructure Details (IEMIS)" }), _jsx("p", { className: "text-sm text-slate-600", children: "This data is used for government IEMIS / Flash Report submissions." })] }), _jsx(CardContent, { children: _jsxs("div", { className: "grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2", children: [_jsx(FormField, { label: "Total Classrooms", children: _jsx(Input, { type: "number", value: form.infrastructure.classrooms, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, classrooms: Number(e.target.value) } })) }) }), _jsx(FormField, { label: "Usable Classrooms", children: _jsx(Input, { type: "number", value: form.infrastructure.usableClassrooms, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, usableClassrooms: Number(e.target.value) } })) }) }), _jsxs("div", { className: "md:col-span-2 mt-2", children: [_jsx("div", { className: "text-sm font-medium text-slate-700 mb-2", children: "Toilets" }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsx(FormField, { label: "Male Toilets", children: _jsx(Input, { type: "number", value: form.infrastructure.toiletsMale, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsMale: Number(e.target.value) } })) }) }), _jsx(FormField, { label: "Female Toilets", children: _jsx(Input, { type: "number", value: form.infrastructure.toiletsFemale, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsFemale: Number(e.target.value) } })) }) }), _jsx(FormField, { label: "Disabled Toilets", children: _jsx(Input, { type: "number", value: form.infrastructure.toiletsDisabled, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, toiletsDisabled: Number(e.target.value) } })) }) })] })] }), _jsxs("div", { className: "md:col-span-2 mt-2", children: [_jsx("div", { className: "text-sm font-medium text-slate-700 mb-2", children: "Facilities" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: [
                                                        { key: "drinkingWater", label: "Drinking Water" },
                                                        { key: "electricity", label: "Electricity" },
                                                        { key: "internet", label: "Internet" },
                                                        { key: "hasScienceLab", label: "Science Lab" },
                                                        { key: "hasComputerLab", label: "Computer Lab" },
                                                        { key: "hasPlayground", label: "Playground" },
                                                        { key: "hasRamp", label: "Accessibility Ramp" },
                                                        { key: "midDayMeal", label: "Mid-day Meal" },
                                                    ].map(({ key, label }) => (_jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: form.infrastructure[key], onChange: (e) => setForm(c => ({
                                                                    ...c,
                                                                    infrastructure: { ...c.infrastructure, [key]: e.target.checked }
                                                                })), className: "h-4 w-4 accent-emerald-600" }), label] }, key))) })] }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Library Books Count", children: _jsx(Input, { type: "number", value: form.infrastructure.libraryBooks, onChange: (e) => setForm(c => ({ ...c, infrastructure: { ...c.infrastructure, libraryBooks: Number(e.target.value) } })) }) }) })] }) })] }), _jsxs(Card, { className: "mb-6", children: [_jsx(CardHeader, { children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx(CardTitle, { children: "Holiday Calendar" }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => setForm((current) => ({
                                                ...current,
                                                holidays: [...current.holidays, { title: "", dateBs: "" }]
                                            })), children: "+ Add Holiday" })] }) }), _jsxs(CardContent, { children: [form.holidays.length === 0 && (_jsx("p", { className: "text-sm text-slate-500 py-2", children: "No holidays added yet." })), _jsx("div", { className: "space-y-3", children: form.holidays.map((holiday, index) => (_jsxs("div", { className: "flex flex-col md:flex-row gap-3 items-end rounded-xl border p-3", children: [_jsx("div", { className: "flex-1", children: _jsx(FormField, { label: "Holiday Title", children: _jsx(Input, { value: holiday.title, onChange: (event) => setForm((current) => ({
                                                                ...current,
                                                                holidays: current.holidays.map((item, i) => (i === index ? { ...item, title: event.target.value } : item))
                                                            })) }) }) }), _jsx("div", { className: "w-full md:w-48", children: _jsx(FormField, { label: "Date (BS)", children: _jsx(NepaliDateField, { value: holiday.dateBs, onChange: (value) => setForm((current) => ({
                                                                ...current,
                                                                holidays: current.holidays.map((item, i) => (i === index ? { ...item, dateBs: value } : item))
                                                            })) }) }) }), _jsx(Button, { type: "button", variant: "destructive", size: "sm", onClick: () => setForm((current) => ({
                                                        ...current,
                                                        holidays: current.holidays.filter((_, i) => i !== index)
                                                    })), children: "Remove" })] }, index))) })] })] }), _jsx("div", { className: "flex justify-end pt-2", children: _jsx(Button, { type: "submit", disabled: settingsMutation.isPending, children: settingsMutation.isPending ? "Saving..." : "Save All Settings" }) })] })] }));
};
