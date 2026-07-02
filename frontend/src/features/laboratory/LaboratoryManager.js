import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { laboratoryEquipmentSchema, laboratoryIssueSchema, laboratorySchema, moduleStaffSchema } from "@nepal-school-erp/shared";
import { Beaker, FlaskConical, LayoutDashboard, Package, Users } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
const labTypeOptions = [
    { value: "COMPUTER", label: "Computer Lab" },
    { value: "PHYSICS", label: "Physics Lab" },
    { value: "CHEMISTRY", label: "Chemistry Lab" },
    { value: "BIOLOGY", label: "Biology Lab" },
    { value: "OTHER", label: "Other (Custom Lab)" }
];
const defaultLab = { type: "COMPUTER", customName: "", isActive: true };
const defaultEquipment = {
    laboratoryId: "",
    categoryId: "",
    name: "",
    itemCode: "",
    quantity: 1,
    description: ""
};
const defaultIssue = { equipmentId: "", teacherId: "", quantity: 1, issuedDateBs: "", dueDateBs: "" };
const defaultStaff = { fullName: "", email: "", phone: "" };
const issueStatusStyles = {
    ISSUED: "bg-sky-100 text-sky-800",
    RETURNED: "bg-emerald-100 text-emerald-800",
    OVERDUE: "bg-rose-100 text-rose-800"
};
const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "labs", label: "Laboratories", icon: FlaskConical },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "issues", label: "Issue & Return", icon: Beaker },
    { id: "staff", label: "Staff", icon: Users, adminOnly: true }
];
export const LaboratoryManager = () => {
    const { user } = useAuth();
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const [tab, setTab] = useState("dashboard");
    const [labForm, setLabForm] = useState(defaultLab);
    const [equipmentForm, setEquipmentForm] = useState(defaultEquipment);
    const [issueForm, setIssueForm] = useState(defaultIssue);
    const [staffForm, setStaffForm] = useState(defaultStaff);
    const [search, setSearch] = useState("");
    const [labFilter, setLabFilter] = useState("");
    const [newCategoryName, setNewCategoryName] = useState("");
    const [selectedLabForCategories, setSelectedLabForCategories] = useState("");
    const dashboardQuery = useQuery({
        queryKey: ["laboratory-dashboard"],
        queryFn: () => unwrap(api.get("/laboratory/dashboard")),
        enabled: tab === "dashboard"
    });
    const labsQuery = useQuery({
        queryKey: ["laboratory-labs"],
        queryFn: () => unwrap(api.get("/laboratory/labs"))
    });
    const equipmentQuery = useQuery({
        queryKey: ["laboratory-equipment", labFilter, search],
        queryFn: () => unwrap(api.get("/laboratory/equipment", { params: { laboratoryId: labFilter || undefined, search: search || undefined } }))
    });
    const issuesQuery = useQuery({
        queryKey: ["laboratory-issues"],
        queryFn: () => unwrap(api.get("/laboratory/issues"))
    });
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers"))
    });
    const staffQuery = useQuery({
        queryKey: ["laboratory-staff"],
        queryFn: () => unwrap(api.get("/laboratory/staff")),
        enabled: isAdmin && tab === "staff"
    });
    const categoriesQuery = useQuery({
        queryKey: ["laboratory-categories", equipmentForm.laboratoryId || selectedLabForCategories],
        queryFn: () => unwrap(api.get(`/laboratory/labs/${equipmentForm.laboratoryId || selectedLabForCategories}/categories`)),
        enabled: Boolean(equipmentForm.laboratoryId || selectedLabForCategories)
    });
    const invalidateLab = async () => {
        await queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] });
        await queryClient.invalidateQueries({ queryKey: ["laboratory-equipment"] });
        await queryClient.invalidateQueries({ queryKey: ["laboratory-issues"] });
        await queryClient.invalidateQueries({ queryKey: ["laboratory-dashboard"] });
        await queryClient.invalidateQueries({ queryKey: ["laboratory-categories"] });
    };
    const createLab = useMutation({
        mutationFn: (payload) => unwrap(api.post("/laboratory/labs", payload)),
        onSuccess: async () => {
            toast.success("Laboratory created with default categories");
            setLabForm(defaultLab);
            await invalidateLab();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createEquipment = useMutation({
        mutationFn: (payload) => unwrap(api.post("/laboratory/equipment", payload)),
        onSuccess: async () => {
            toast.success("Equipment added");
            setEquipmentForm(defaultEquipment);
            await invalidateLab();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const issueEquipment = useMutation({
        mutationFn: (payload) => unwrap(api.post("/laboratory/issues", payload)),
        onSuccess: async () => {
            toast.success("Equipment issued");
            setIssueForm(defaultIssue);
            await invalidateLab();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const returnEquipment = useMutation({
        mutationFn: (id) => unwrap(api.put(`/laboratory/issues/${id}/return`, { returnedDateBs: issueForm.issuedDateBs || "2082-01-01" })),
        onSuccess: async () => {
            toast.success("Equipment returned");
            await invalidateLab();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createCategory = useMutation({
        mutationFn: ({ labId, name }) => unwrap(api.post(`/laboratory/labs/${labId}/categories`, { name })),
        onSuccess: async () => {
            toast.success("Category added");
            setNewCategoryName("");
            await queryClient.invalidateQueries({ queryKey: ["laboratory-categories"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createStaff = useMutation({
        mutationFn: (payload) => unwrap(api.post("/laboratory/staff", payload)),
        onSuccess: async () => {
            toast.success("Laboratory staff created");
            setStaffForm(defaultStaff);
            await queryClient.invalidateQueries({ queryKey: ["laboratory-staff"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);
    const categories = categoriesQuery.data ?? [];
    const labOptions = useMemo(() => labsQuery.data ?? [], [labsQuery.data]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Laboratory", description: "Create laboratories, manage equipment inventory, and issue items to teachers." }), _jsx("div", { className: "flex flex-wrap gap-2", children: visibleTabs.map((item) => {
                    const Icon = item.icon;
                    return (_jsxs(Button, { variant: tab === item.id ? "default" : "secondary", size: "sm", onClick: () => setTab(item.id), className: cn(tab === item.id && "bg-emerald-600 hover:bg-emerald-700"), children: [_jsx(Icon, { className: "mr-2 h-4 w-4" }), item.label] }, item.id));
                }) }), tab === "dashboard" && (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [
                            { label: "Total Equipment", value: dashboardQuery.data?.totalEquipment ?? 0 },
                            { label: "Available", value: dashboardQuery.data?.availableEquipment ?? 0 },
                            { label: "Issued", value: dashboardQuery.data?.issuedEquipment ?? 0 },
                            { label: "Remaining Stock", value: dashboardQuery.data?.remainingStock ?? 0 }
                        ].map((stat) => (_jsx(Card, { className: "bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]", children: _jsxs(CardContent, { className: "py-6", children: [_jsx("p", { className: "text-sm text-slate-500", children: stat.label }), _jsx("p", { className: "text-3xl font-semibold text-slate-900", children: stat.value })] }) }, stat.label))) }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Low stock items" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Item" }), _jsx(Th, { children: "Laboratory" }), _jsx(Th, { children: "Available" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (dashboardQuery.data?.lowStockItems ?? []).map((item) => (_jsxs("tr", { children: [_jsx(Td, { children: item.name }), _jsx(Td, { children: item.laboratoryName ?? "—" }), _jsx(Td, { children: item.availableQuantity }), _jsx(Td, { children: _jsx(StockStatusBadge, { status: item.status }) })] }, item._id))) })] }) })] })] })), tab === "labs" && (_jsxs("div", { className: "grid gap-6 xl:grid-cols-[360px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Create laboratory" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Laboratory type", children: _jsx(Select, { value: labForm.type, onChange: (e) => setLabForm((c) => ({ ...c, type: e.target.value })), children: labTypeOptions.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value))) }) }), labForm.type === "OTHER" ? (_jsx(FormField, { label: "Custom name", children: _jsx(Input, { value: labForm.customName, onChange: (e) => setLabForm((c) => ({ ...c, customName: e.target.value })) }) })) : null, _jsx(Button, { onClick: () => {
                                            const parsed = laboratorySchema.safeParse(labForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid laboratory details");
                                            createLab.mutate(parsed.data);
                                        }, children: "Create laboratory" }), _jsx("p", { className: "text-xs text-slate-500", children: "Suitable inventory categories are created automatically." })] })] }), _jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Laboratories" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Type" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: labOptions.map((lab) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: lab.name }), _jsx(Td, { children: lab.type }), _jsx(Td, { children: _jsx(Badge, { className: lab.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600", children: lab.isActive ? "Active" : "Inactive" }) })] }, lab._id))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Manage categories" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Laboratory", children: _jsxs(Select, { value: selectedLabForCategories, onChange: (e) => setSelectedLabForCategories(e.target.value), children: [_jsx("option", { value: "", children: "Select laboratory" }), labOptions.map((lab) => (_jsx("option", { value: lab._id, children: lab.name }, lab._id)))] }) }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Input, { placeholder: "New category name", value: newCategoryName, onChange: (e) => setNewCategoryName(e.target.value) }), _jsx(Button, { variant: "secondary", disabled: !selectedLabForCategories || !newCategoryName.trim(), onClick: () => createCategory.mutate({ labId: selectedLabForCategories, name: newCategoryName.trim() }), children: "Add" })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: categories.map((cat) => (_jsx(Badge, { className: "bg-slate-100 text-slate-700", children: cat.name }, cat._id))) })] })] })] })] })), tab === "inventory" && (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Search & filter" }) }), _jsxs(CardContent, { className: "grid gap-3 md:grid-cols-2", children: [_jsx(FormField, { label: "Laboratory", children: _jsxs(Select, { value: labFilter, onChange: (e) => setLabFilter(e.target.value), children: [_jsx("option", { value: "", children: "All laboratories" }), labOptions.map((lab) => (_jsx("option", { value: lab._id, children: lab.name }, lab._id)))] }) }), _jsx(FormField, { label: "Search by name or code", children: _jsx(Input, { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "e.g. Microscope" }) })] })] }), _jsxs("div", { className: "grid gap-6 xl:grid-cols-[360px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Add equipment" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Laboratory", children: _jsxs(Select, { value: equipmentForm.laboratoryId, onChange: (e) => setEquipmentForm((c) => ({ ...c, laboratoryId: e.target.value, categoryId: "" })), children: [_jsx("option", { value: "", children: "Select laboratory" }), labOptions.map((lab) => (_jsx("option", { value: lab._id, children: lab.name }, lab._id)))] }) }), _jsx(FormField, { label: "Category", children: _jsxs(Select, { value: equipmentForm.categoryId, onChange: (e) => setEquipmentForm((c) => ({ ...c, categoryId: e.target.value })), children: [_jsx("option", { value: "", children: "Select category" }), categories.map((cat) => (_jsx("option", { value: cat._id, children: cat.name }, cat._id)))] }) }), _jsx(FormField, { label: "Item name", children: _jsx(Input, { value: equipmentForm.name, onChange: (e) => setEquipmentForm((c) => ({ ...c, name: e.target.value })) }) }), _jsx(FormField, { label: "Item code", children: _jsx(Input, { value: equipmentForm.itemCode, onChange: (e) => setEquipmentForm((c) => ({ ...c, itemCode: e.target.value })) }) }), _jsx(FormField, { label: "Quantity", children: _jsx(Input, { type: "number", value: equipmentForm.quantity, onChange: (e) => setEquipmentForm((c) => ({ ...c, quantity: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Description (optional)", children: _jsx(Textarea, { value: equipmentForm.description, onChange: (e) => setEquipmentForm((c) => ({ ...c, description: e.target.value })) }) }), _jsx(Button, { onClick: () => {
                                                    const parsed = laboratoryEquipmentSchema.safeParse(equipmentForm);
                                                    if (!parsed.success)
                                                        return toast.error("Invalid equipment details");
                                                    createEquipment.mutate(parsed.data);
                                                }, children: "Add equipment" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Equipment inventory" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Item" }), _jsx(Th, { children: "Lab" }), _jsx(Th, { children: "Category" }), _jsx(Th, { children: "Code" }), _jsx(Th, { children: "Qty" }), _jsx(Th, { children: "Available" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (equipmentQuery.data ?? []).map((item) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: item.name }), _jsx(Td, { children: item.laboratoryName ?? "—" }), _jsx(Td, { children: item.categoryName ?? "—" }), _jsx(Td, { children: item.itemCode }), _jsx(Td, { children: item.quantity }), _jsx(Td, { children: item.availableQuantity }), _jsx(Td, { children: item.issuedQuantity }), _jsx(Td, { children: _jsx(StockStatusBadge, { status: item.status }) })] }, item._id))) })] }) })] })] })] })), tab === "issues" && (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Issue equipment to teacher" }) }), _jsxs(CardContent, { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3", children: [_jsx(FormField, { label: "Equipment", children: _jsxs(Select, { value: issueForm.equipmentId, onChange: (e) => setIssueForm((c) => ({ ...c, equipmentId: e.target.value })), children: [_jsx("option", { value: "", children: "Select equipment" }), (equipmentQuery.data ?? [])
                                                    .filter((item) => item.availableQuantity > 0)
                                                    .map((item) => (_jsxs("option", { value: item._id, children: [item.name, " (", item.availableQuantity, " available)"] }, item._id)))] }) }), _jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: issueForm.teacherId, onChange: (e) => setIssueForm((c) => ({ ...c, teacherId: e.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), (teachersQuery.data ?? []).map((t) => (_jsx("option", { value: t._id, children: t.user.fullName }, t._id)))] }) }), _jsx(FormField, { label: "Quantity", children: _jsx(Input, { type: "number", value: issueForm.quantity, onChange: (e) => setIssueForm((c) => ({ ...c, quantity: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Issued (BS)", children: _jsx(NepaliDateField, { value: issueForm.issuedDateBs, onChange: (v) => setIssueForm((c) => ({ ...c, issuedDateBs: v })) }) }), _jsx(FormField, { label: "Due (BS)", children: _jsx(NepaliDateField, { value: issueForm.dueDateBs, onChange: (v) => setIssueForm((c) => ({ ...c, dueDateBs: v })) }) }), _jsx("div", { className: "flex items-end", children: _jsx(Button, { onClick: () => {
                                                const parsed = laboratoryIssueSchema.safeParse(issueForm);
                                                if (!parsed.success)
                                                    return toast.error("Invalid issue details");
                                                issueEquipment.mutate(parsed.data);
                                            }, children: "Issue equipment" }) })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Equipment issues" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Item" }), _jsx(Th, { children: "Teacher" }), _jsx(Th, { children: "Qty" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Returned" }), _jsx(Th, { children: "Status" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (issuesQuery.data ?? []).map((issue) => (_jsxs("tr", { children: [_jsx(Td, { children: issue.equipmentName ?? "—" }), _jsx(Td, { children: issue.teacherName ?? "—" }), _jsx(Td, { children: issue.quantity }), _jsx(Td, { children: issue.issuedDateBs }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: issue.returnedDateBs ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) }), _jsx(Td, { children: issue.status !== "RETURNED" ? (_jsx(Button, { size: "sm", variant: "secondary", onClick: () => returnEquipment.mutate(issue._id), children: "Return" })) : null })] }, issue._id))) })] }) })] })] })), tab === "staff" && isAdmin && (_jsxs("div", { className: "grid gap-6 xl:grid-cols-[360px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Create laboratory staff" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Full name", children: _jsx(Input, { value: staffForm.fullName, onChange: (e) => setStaffForm((c) => ({ ...c, fullName: e.target.value })) }) }), _jsx(FormField, { label: "Email", children: _jsx(Input, { value: staffForm.email, onChange: (e) => setStaffForm((c) => ({ ...c, email: e.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: staffForm.phone, onChange: (e) => setStaffForm((c) => ({ ...c, phone: e.target.value })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = moduleStaffSchema.safeParse(staffForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid staff details");
                                            createStaff.mutate(parsed.data);
                                        }, children: "Create account" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Laboratory staff accounts" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Email" }), _jsx(Th, { children: "Phone" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (staffQuery.data ?? []).map((member) => (_jsxs("tr", { children: [_jsx(Td, { children: member.fullName }), _jsx(Td, { children: member.email }), _jsx(Td, { children: member.phone ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: member.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600", children: member.isActive ? "Active" : "Inactive" }) })] }, member._id))) })] }) })] })] }))] }));
};
