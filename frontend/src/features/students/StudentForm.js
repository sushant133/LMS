import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BLOOD_GROUPS, DISABILITY_CATEGORIES, ETHNICITY_CATEGORIES, studentSchema } from "@nepal-school-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
const createDefaultValue = () => ({
    fullName: "",
    email: "",
    phone: "",
    admissionNumber: "",
    rollNumber: 1,
    classId: "",
    sectionId: "",
    admissionDateBs: "",
    dateOfBirthBs: "",
    gender: "Male",
    bloodGroup: "A+",
    disabilityCategory: "None",
    ethnicityCategory: "Other",
    address: {
        province: "",
        district: "",
        municipality: "",
        ward: "",
        streetAddress: ""
    },
    fatherName: "",
    motherName: "",
    guardianName: "",
    guardianPhone: "",
    feesDueNpr: 0,
    remarks: ""
});
export const StudentForm = ({ initialValue, classes, sections, submitting, onSubmit, onCancel }) => {
    const [form, setForm] = useState(initialValue ?? createDefaultValue());
    const filteredSections = useMemo(() => sections.filter((section) => section.classId === form.classId), [form.classId, sections]);
    const handleSubmit = async (event) => {
        event.preventDefault();
        const parsed = studentSchema.safeParse(form);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
            return;
        }
        await onSubmit(parsed.data);
        setForm(createDefaultValue());
    };
    return (_jsxs("form", { className: "space-y-4", onSubmit: handleSubmit, children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "Full Name", children: _jsx(Input, { value: form.fullName, onChange: (event) => setForm((current) => ({ ...current, fullName: event.target.value })) }) }), _jsx(FormField, { label: "Email", children: _jsx(Input, { type: "email", value: form.email, onChange: (event) => setForm((current) => ({ ...current, email: event.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: form.phone ?? "", onChange: (event) => setForm((current) => ({ ...current, phone: event.target.value })) }) }), _jsx(FormField, { label: "Admission No.", children: _jsx(Input, { value: form.admissionNumber, onChange: (event) => setForm((current) => ({ ...current, admissionNumber: event.target.value })) }) }), _jsx(FormField, { label: "Roll No.", children: _jsx(Input, { type: "number", value: form.rollNumber, onChange: (event) => setForm((current) => ({ ...current, rollNumber: Number(event.target.value) })) }) }), _jsx(FormField, { label: "Class", children: _jsxs(Select, { value: form.classId, onChange: (event) => setForm((current) => ({ ...current, classId: event.target.value, sectionId: "" })), children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Section", children: _jsxs(Select, { value: form.sectionId, onChange: (event) => setForm((current) => ({ ...current, sectionId: event.target.value })), children: [_jsx("option", { value: "", children: "Select section" }), filteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) }), _jsx(FormField, { label: "Gender", children: _jsx(Select, { value: form.gender, onChange: (event) => setForm((current) => ({ ...current, gender: event.target.value })), children: ["Male", "Female", "Other"].map((gender) => (_jsx("option", { value: gender, children: gender }, gender))) }) }), _jsx(FormField, { label: "Admission Date (BS)", children: _jsx(NepaliDateField, { value: form.admissionDateBs, onChange: (value) => setForm((current) => ({ ...current, admissionDateBs: value })) }) }), _jsx(FormField, { label: "DOB (BS)", children: _jsx(NepaliDateField, { value: form.dateOfBirthBs, onChange: (value) => setForm((current) => ({ ...current, dateOfBirthBs: value })) }) }), _jsx(FormField, { label: "Blood Group", children: _jsx(Select, { value: form.bloodGroup ?? "", onChange: (event) => setForm((current) => ({ ...current, bloodGroup: event.target.value })), children: BLOOD_GROUPS.map((group) => (_jsx("option", { value: group, children: group }, group))) }) }), _jsx(FormField, { label: "Disability Category (IEMIS)", children: _jsx(Select, { value: form.disabilityCategory ?? "None", onChange: (event) => setForm((current) => ({ ...current, disabilityCategory: event.target.value })), children: DISABILITY_CATEGORIES.map((cat) => (_jsx("option", { value: cat, children: cat }, cat))) }) }), _jsx(FormField, { label: "Ethnicity / Caste (IEMIS)", children: _jsx(Select, { value: form.ethnicityCategory ?? "Other", onChange: (event) => setForm((current) => ({ ...current, ethnicityCategory: event.target.value })), children: ETHNICITY_CATEGORIES.map((cat) => (_jsx("option", { value: cat, children: cat }, cat))) }) }), _jsx(FormField, { label: "Fees Due (NPR)", children: _jsx(Input, { type: "number", value: form.feesDueNpr, onChange: (event) => setForm((current) => ({ ...current, feesDueNpr: Number(event.target.value) })) }) })] }), _jsx(AddressFields, { value: form.address, onChange: (address) => setForm((current) => ({ ...current, address })) }), _jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(FormField, { label: "Father Name", children: _jsx(Input, { value: form.fatherName, onChange: (event) => setForm((current) => ({ ...current, fatherName: event.target.value })) }) }), _jsx(FormField, { label: "Mother Name", children: _jsx(Input, { value: form.motherName, onChange: (event) => setForm((current) => ({ ...current, motherName: event.target.value })) }) }), _jsx(FormField, { label: "Guardian Name", children: _jsx(Input, { value: form.guardianName, onChange: (event) => setForm((current) => ({ ...current, guardianName: event.target.value })) }) }), _jsx(FormField, { label: "Guardian Phone", children: _jsx(Input, { value: form.guardianPhone, onChange: (event) => setForm((current) => ({ ...current, guardianPhone: event.target.value })) }) })] }), _jsx(FormField, { label: "Remarks", children: _jsx(Input, { value: form.remarks ?? "", onChange: (event) => setForm((current) => ({ ...current, remarks: event.target.value })) }) }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [onCancel ? (_jsx(Button, { type: "button", variant: "outline", onClick: onCancel, children: "Cancel" })) : null, _jsx(Button, { disabled: submitting, type: "submit", children: submitting ? "Saving..." : "Save Student" })] }), _jsx("p", { className: "text-xs text-slate-500", children: "Photo and document uploads (for IEMIS compliance) will be available after saving the student record." })] }));
};
