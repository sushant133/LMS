import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "features/auth/AuthProvider";
import { api } from "lib/api";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageHeader } from "components/shared/PageHeader";
import { toast } from "sonner";
export const ReportsPage = () => {
    const { t } = useTranslation();
    const { user, activeSchoolId } = useAuth();
    const [loading, setLoading] = useState(null);
    const canExport = user?.role === "SUPER_ADMIN" || user?.role === "SCHOOL_ADMIN";
    const downloadExport = async (endpoint, label) => {
        if (!activeSchoolId && user?.role !== "SUPER_ADMIN") {
            toast.error("Please select a school context first");
            return;
        }
        setLoading(endpoint);
        try {
            const response = await api.get(`/exports/${endpoint}`, {
                responseType: "blob"
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const disposition = response.headers["content-disposition"];
            let filename = `${label.replace(/\s+/g, "_")}_${Date.now()}.csv`;
            if (disposition) {
                const match = disposition.match(/filename="(.+)"/);
                if (match)
                    filename = match[1];
            }
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(`${label} downloaded successfully`);
        }
        catch (error) {
            toast.error(error?.message || `Failed to download ${label}`);
        }
        finally {
            setLoading(null);
        }
    };
    if (!canExport) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: t("reports") || "Reports & IEMIS Compliance" }), _jsx(Card, { children: _jsx(CardContent, { className: "py-10 text-center text-slate-600", children: "This section is only available to School Administrators and Super Admins." }) })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: t("reports") || "Reports & IEMIS Compliance", description: user?.role === "SCHOOL_ADMIN"
                    ? "Official IEMIS & Flash Report exports for your school. Use these for mandatory government submissions."
                    : "Generate official exports for Nepal's Integrated Education Management Information System (IEMIS / CEHRD Flash Reports)." }), _jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold mb-3 text-slate-800", children: "Flash I \u2013 Input Data" }), _jsxs("div", { className: "grid gap-6 md:grid-cols-2 lg:grid-cols-3", children: [_jsxs(Card, { className: "border-emerald-100", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-emerald-800", children: "Student Master Data" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Full student roster with disability, ethnicity, and guardian details." }), _jsx(Button, { onClick: () => downloadExport("iemis/student-master", "IEMIS_Student_Master"), disabled: !!loading, className: "w-full", children: loading === "iemis/student-master" ? "Generating..." : "Download Student Master (CSV)" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Teacher Master Data" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Teacher qualifications, subjects taught, and salary data for staffing reports." }), _jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/teacher-master", "IEMIS_Teacher_Master"), disabled: !!loading, className: "w-full", children: loading === "iemis/teacher-master" ? "Generating..." : "Download Teacher Master (CSV)" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Infrastructure Report" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Classrooms, WASH facilities, labs, accessibility, and mid-day meal status." }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/infrastructure", "IEMIS_Infrastructure"), disabled: !!loading, className: "flex-1", children: loading === "iemis/infrastructure" ? "..." : "JSON" }), _jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/infrastructure?format=csv", "IEMIS_Infrastructure"), disabled: !!loading, className: "flex-1", children: loading === "iemis/infrastructure?format=csv" ? "..." : "CSV" })] })] })] })] })] }), _jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold mb-3 text-slate-800", children: "Flash II \u2013 Performance & Efficiency" }), _jsxs("div", { className: "grid gap-6 md:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Performance Indicators" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Average attendance, GPA, exam participation, estimated promotion rate, and identification of low performers." }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { onClick: () => downloadExport("iemis/flash-ii", "IEMIS_Flash_II"), disabled: !!loading, className: "flex-1", children: loading === "iemis/flash-ii" ? "Generating..." : "JSON" }), _jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/flash-ii?format=csv", "IEMIS_Flash_II"), disabled: !!loading, className: "flex-1", children: loading === "iemis/flash-ii?format=csv" ? "..." : "CSV" })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Enrollment Summary (Legacy)" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx("p", { className: "text-sm text-slate-600", children: "Gender, class, disability, and ethnicity aggregates (original export)." }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/enrollment-summary", "IEMIS_Enrollment"), disabled: !!loading, className: "flex-1", children: "JSON" }), _jsx(Button, { variant: "outline", onClick: () => downloadExport("iemis/enrollment-summary?format=csv", "IEMIS_Enrollment"), disabled: !!loading, className: "flex-1", children: "CSV" })] })] })] })] })] }), _jsx(Card, { className: "bg-amber-50 border-amber-200", children: _jsxs(CardContent, { className: "pt-6 text-sm text-amber-800", children: [_jsx("strong", { children: "Important:" }), " These exports are aligned with current IEMIS requirements from CEHRD. Always cross-check the latest data dictionary and upload templates on ", _jsx("strong", { children: "emis.cehrd.gov.np" }), ". All exports are logged in the audit trail for accountability."] }) })] }));
};
