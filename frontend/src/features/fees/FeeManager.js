import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { feeCollectionSchema, feeStructureSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
const defaultStructureValue = {
    title: "",
    classIds: [],
    feeType: "MONTHLY",
    frequency: "MONTHLY",
    academicYearBs: "2083/2084",
    amountNpr: 0,
    isOptional: false
};
const defaultCollectionValue = {
    studentId: "",
    feeStructureId: "",
    receiptNumber: "",
    paidDateBs: "",
    amountPaidNpr: 0,
    discountNpr: 0,
    scholarshipNpr: 0,
    lateFeeNpr: 0,
    notes: ""
};
export const FeeManager = () => {
    const [structureForm, setStructureForm] = useState(defaultStructureValue);
    const [collectionForm, setCollectionForm] = useState(defaultCollectionValue);
    const [editingStructureId, setEditingStructureId] = useState(null);
    const structuresQuery = useQuery({ queryKey: ["fee-structures"], queryFn: () => unwrap(api.get("/fees/structures")) });
    const collectionsQuery = useQuery({ queryKey: ["fee-collections"], queryFn: () => unwrap(api.get("/fees/collections")) });
    const studentsQuery = useQuery({ queryKey: ["students"], queryFn: () => unwrap(api.get("/students")) });
    const classesQuery = useQuery({ queryKey: ["classes"], queryFn: () => unwrap(api.get("/academics/classes")) });
    const structureMutation = useMutation({
        mutationFn: async (payload) => editingStructureId
            ? unwrap(api.put(`/fees/structures/${editingStructureId}`, payload))
            : unwrap(api.post("/fees/structures", payload)),
        onSuccess: async () => {
            toast.success(editingStructureId ? "Fee structure updated" : "Fee structure created");
            setStructureForm(defaultStructureValue);
            setEditingStructureId(null);
            await queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const collectionMutation = useMutation({
        mutationFn: async (payload) => unwrap(api.post("/fees/collections", payload)),
        onSuccess: async () => {
            toast.success("Fee collected successfully");
            setCollectionForm(defaultCollectionValue);
            await queryClient.invalidateQueries({ queryKey: ["fee-collections"] });
            await queryClient.invalidateQueries({ queryKey: ["students"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Fee Management", description: "Set fee structures, apply discounts and scholarships, record NPR receipts, and monitor due balances." }), _jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingStructureId ? "Edit Fee Structure" : "Create Fee Structure" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: (event) => {
                                        event.preventDefault();
                                        const parsed = feeStructureSchema.safeParse(structureForm);
                                        if (!parsed.success) {
                                            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                            return;
                                        }
                                        void structureMutation.mutateAsync(parsed.data);
                                    }, children: [_jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Title", children: _jsx(Input, { value: structureForm.title, onChange: (event) => setStructureForm((current) => ({ ...current, title: event.target.value })) }) }) }), _jsx(FormField, { label: "Fee Type", children: _jsx(Select, { value: structureForm.feeType, onChange: (event) => setStructureForm((current) => ({ ...current, feeType: event.target.value })), children: ["ADMISSION", "MONTHLY", "EXAM", "ANNUAL", "TRANSPORT", "HOSTEL", "OTHER"].map((item) => (_jsx("option", { value: item, children: item }, item))) }) }), _jsx(FormField, { label: "Frequency", children: _jsx(Select, { value: structureForm.frequency, onChange: (event) => setStructureForm((current) => ({ ...current, frequency: event.target.value })), children: ["MONTHLY", "ANNUAL", "ONE_TIME"].map((item) => (_jsx("option", { value: item, children: item }, item))) }) }), _jsx(FormField, { label: "Academic Year", children: _jsx(Input, { value: structureForm.academicYearBs, onChange: (event) => setStructureForm((current) => ({ ...current, academicYearBs: event.target.value })) }) }), _jsx(FormField, { label: "Amount (NPR)", children: _jsx(Input, { type: "number", value: structureForm.amountNpr, onChange: (event) => setStructureForm((current) => ({ ...current, amountNpr: Number(event.target.value) })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Class IDs (comma separated)", children: _jsx(Input, { value: structureForm.classIds.join(", "), onChange: (event) => setStructureForm((current) => ({
                                                        ...current,
                                                        classIds: event.target.value
                                                            .split(",")
                                                            .map((item) => item.trim())
                                                            .filter(Boolean)
                                                    })) }) }) }), _jsxs("div", { className: "md:col-span-2 flex justify-end gap-2", children: [editingStructureId ? (_jsx(Button, { type: "button", variant: "outline", onClick: () => {
                                                        setEditingStructureId(null);
                                                        setStructureForm(defaultStructureValue);
                                                    }, children: "Cancel" })) : null, _jsx(Button, { type: "submit", children: editingStructureId ? "Update Fee Structure" : "Create Fee Structure" })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Collect Fee" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: (event) => {
                                        event.preventDefault();
                                        const parsed = feeCollectionSchema.safeParse(collectionForm);
                                        if (!parsed.success) {
                                            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                                            return;
                                        }
                                        void collectionMutation.mutateAsync(parsed.data);
                                    }, children: [_jsx(FormField, { label: "Student", children: _jsxs(Select, { value: collectionForm.studentId, onChange: (event) => setCollectionForm((current) => ({ ...current, studentId: event.target.value })), children: [_jsx("option", { value: "", children: "Select student" }), (studentsQuery.data ?? []).map((student) => (_jsx("option", { value: student._id, children: student.user.fullName }, student._id)))] }) }), _jsx(FormField, { label: "Fee Structure", children: _jsxs(Select, { value: collectionForm.feeStructureId, onChange: (event) => setCollectionForm((current) => ({ ...current, feeStructureId: event.target.value })), children: [_jsx("option", { value: "", children: "Select structure" }), (structuresQuery.data ?? []).map((structure) => (_jsx("option", { value: structure._id, children: structure.title }, structure._id)))] }) }), _jsx(FormField, { label: "Receipt Number", children: _jsx(Input, { value: collectionForm.receiptNumber, onChange: (event) => setCollectionForm((current) => ({ ...current, receiptNumber: event.target.value })) }) }), _jsx(FormField, { label: "Paid Date (BS)", children: _jsx(NepaliDateField, { value: collectionForm.paidDateBs, onChange: (value) => setCollectionForm((current) => ({ ...current, paidDateBs: value })) }) }), _jsx(FormField, { label: "Amount Paid", children: _jsx(Input, { type: "number", value: collectionForm.amountPaidNpr, onChange: (event) => setCollectionForm((current) => ({ ...current, amountPaidNpr: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Discount", children: _jsx(Input, { type: "number", value: collectionForm.discountNpr, onChange: (event) => setCollectionForm((current) => ({ ...current, discountNpr: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Scholarship", children: _jsx(Input, { type: "number", value: collectionForm.scholarshipNpr, onChange: (event) => setCollectionForm((current) => ({ ...current, scholarshipNpr: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Late Fee", children: _jsx(Input, { type: "number", value: collectionForm.lateFeeNpr, onChange: (event) => setCollectionForm((current) => ({ ...current, lateFeeNpr: Number(event.target.value) })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Notes", children: _jsx(Input, { value: collectionForm.notes ?? "", onChange: (event) => setCollectionForm((current) => ({ ...current, notes: event.target.value })) }) }) }), _jsx("div", { className: "md:col-span-2 flex justify-end", children: _jsx(Button, { type: "submit", children: "Collect Fee" }) })] }) })] })] }), _jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Fee Structures" }) }), _jsx(CardContent, { className: "space-y-3", children: (structuresQuery.data ?? []).map((structure) => (_jsx("div", { className: "rounded-2xl border border-slate-200 p-4", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-slate-900", children: structure.title }), _jsxs("p", { className: "text-sm text-slate-500", children: [structure.feeType, " / ", structure.academicYearBs] })] }), _jsx(Badge, { children: formatCurrencyNpr(structure.amountNpr) })] }) }, structure._id))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Receipts" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Receipt" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Paid" }), _jsx(Th, { children: "Date" })] }) }), _jsx(TableBody, { children: (collectionsQuery.data ?? []).map((collection) => (_jsxs("tr", { children: [_jsx(Td, { children: collection.receiptNumber }), _jsx(Td, { children: (studentsQuery.data ?? []).find((student) => student._id === collection.studentId)?.user.fullName ?? collection.studentId }), _jsx(Td, { children: formatCurrencyNpr(collection.amountPaidNpr) }), _jsx(Td, { children: collection.paidDateBs })] }, collection._id))) })] }) })] })] })] }));
};
