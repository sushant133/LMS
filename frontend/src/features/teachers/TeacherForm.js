import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { teacherSchema } from "@nepal-school-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
const createDefaultTeacherValue = () => ({
    fullName: "",
    email: "",
    phone: "",
    teacherCode: "",
    qualification: "",
    joinedDateBs: "",
    address: {
        province: "",
        district: "",
        municipality: "",
        ward: "",
        streetAddress: ""
    },
    subjects: [],
    assignedClassIds: [],
    assignedSectionIds: [],
    basicSalaryNpr: 0
});
export const TeacherForm = ({ initialValue, classes, sections, subjects, submitting, onSubmit, onCancel }) => {
    const [form, setForm] = useState(initialValue ?? createDefaultTeacherValue());
    const filteredSections = useMemo(() => sections.filter((section) => form.assignedClassIds.length === 0 || form.assignedClassIds.includes(section.classId)), [form.assignedClassIds, sections]);
    const handleSubmit = async (event) => {
        event.preventDefault();
        const parsed = teacherSchema.safeParse(form);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
        }
        await onSubmit(parsed.data);
        setForm(createDefaultTeacherValue());
    };
    const readMultiSelect = (selectedOptions) => Array.from(selectedOptions)
        .filter((option) => option.selected)
        .map((option) => option.value);
    return (_jsxs("form", { className: "space-y-4", onSubmit: handleSubmit, children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "Full Name", children: _jsx(Input, { value: form.fullName, onChange: (event) => setForm((current) => ({ ...current, fullName: event.target.value })) }) }), _jsx(FormField, { label: "Email", children: _jsx(Input, { type: "email", value: form.email, onChange: (event) => setForm((current) => ({ ...current, email: event.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: form.phone ?? "", onChange: (event) => setForm((current) => ({ ...current, phone: event.target.value })) }) }), _jsx(FormField, { label: "Teacher Code", children: _jsx(Input, { value: form.teacherCode, onChange: (event) => setForm((current) => ({ ...current, teacherCode: event.target.value })) }) }), _jsx(FormField, { label: "Qualification", children: _jsx(Input, { value: form.qualification, onChange: (event) => setForm((current) => ({ ...current, qualification: event.target.value })) }) }), _jsx(FormField, { label: "Joined Date (BS)", children: _jsx(NepaliDateField, { value: form.joinedDateBs, onChange: (value) => setForm((current) => ({ ...current, joinedDateBs: value })) }) }), _jsx(FormField, { label: "Basic Salary (NPR)", children: _jsx(Input, { type: "number", value: form.basicSalaryNpr, onChange: (event) => setForm((current) => ({ ...current, basicSalaryNpr: Number(event.target.value) })) }) })] }), _jsx(AddressFields, { value: form.address, onChange: (address) => setForm((current) => ({ ...current, address })) }), _jsxs("div", { className: "grid gap-4 md:grid-cols-3", children: [_jsx(FormField, { label: "Subjects", children: _jsx(Select, { multiple: true, className: "h-36", value: form.subjects, onChange: (event) => setForm((current) => ({ ...current, subjects: readMultiSelect(event.target.selectedOptions) })), children: subjects.map((subject) => (_jsx("option", { value: subject._id, children: subject.name }, subject._id))) }) }), _jsx(FormField, { label: "Assigned Classes", children: _jsx(Select, { multiple: true, className: "h-36", value: form.assignedClassIds, onChange: (event) => setForm((current) => ({ ...current, assignedClassIds: readMultiSelect(event.target.selectedOptions), assignedSectionIds: [] })), children: classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id))) }) }), _jsx(FormField, { label: "Assigned Sections", children: _jsx(Select, { multiple: true, className: "h-36", value: form.assignedSectionIds, onChange: (event) => setForm((current) => ({ ...current, assignedSectionIds: readMultiSelect(event.target.selectedOptions) })), children: filteredSections.map((section) => (_jsx("option", { value: section._id, children: section.name }, section._id))) }) })] }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [onCancel ? (_jsx(Button, { type: "button", variant: "outline", onClick: onCancel, children: "Cancel" })) : null, _jsx(Button, { disabled: submitting, type: "submit", children: submitting ? "Saving..." : "Save Teacher" })] })] }));
};
