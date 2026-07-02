import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { filterSectionsByClass, filterSubjectsByClass, hasSingleOption } from "lib/teacherScopeUtils";
import { X } from "lucide-react";
import { ASSIGNMENT_TYPES, assignmentSchema } from "@nepal-school-erp/shared";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { toast } from "sonner";
import { ClassroomAttachmentUpload } from "./ClassroomAttachmentUpload";
import { TYPE_LABELS } from "./homeworkUtils";
const defaultForm = {
    type: "HOMEWORK",
    title: "",
    description: "",
    classId: "",
    sectionId: "",
    subjectId: "",
    topic: "",
    dueDateBs: "",
    maxMarks: 10,
    rubric: "",
    visibleTo: ["STUDENT", "PARENT"],
    allowSubmission: true,
    isPinned: false,
    attachments: [],
    links: []
};
export const ComposePostModal = ({ open, editingPost, classes, sections, subjects, topicSuggestions, scopedOnly = false, onClose, onSave, saving }) => {
    const [form, setForm] = useState(defaultForm);
    const [linkDraft, setLinkDraft] = useState({ title: "", url: "" });
    useEffect(() => {
        if (!open)
            return;
        if (editingPost) {
            setForm({
                type: editingPost.type,
                title: editingPost.title,
                description: editingPost.description,
                classId: editingPost.classId,
                sectionId: editingPost.sectionId,
                subjectId: editingPost.subjectId ?? "",
                topic: editingPost.topic ?? "",
                dueDateBs: editingPost.dueDateBs ?? "",
                maxMarks: editingPost.maxMarks ?? 10,
                rubric: editingPost.rubric ?? "",
                visibleTo: editingPost.visibleTo,
                allowSubmission: editingPost.allowSubmission ?? true,
                isPinned: editingPost.isPinned ?? false,
                attachments: editingPost.attachments ?? [],
                links: editingPost.links ?? []
            });
        }
        else {
            setForm(defaultForm);
        }
        setLinkDraft({ title: "", url: "" });
    }, [open, editingPost]);
    const filteredSections = useMemo(() => filterSectionsByClass(sections, form.classId), [sections, form.classId]);
    const filteredSubjects = useMemo(() => filterSubjectsByClass(subjects, form.classId), [subjects, form.classId]);
    useEffect(() => {
        if (!open || editingPost || !scopedOnly) {
            return;
        }
        if (hasSingleOption(classes) && form.classId !== classes[0]._id) {
            setForm((current) => ({ ...current, classId: classes[0]._id, sectionId: "", subjectId: "" }));
        }
    }, [classes, editingPost, form.classId, open, scopedOnly]);
    useEffect(() => {
        if (!open || editingPost || !scopedOnly || !form.classId) {
            return;
        }
        if (hasSingleOption(filteredSections) && form.sectionId !== filteredSections[0]._id) {
            setForm((current) => ({ ...current, sectionId: filteredSections[0]._id, subjectId: "" }));
        }
    }, [editingPost, filteredSections, form.classId, form.sectionId, open, scopedOnly]);
    useEffect(() => {
        if (!open || editingPost || !scopedOnly || !form.classId) {
            return;
        }
        if (hasSingleOption(filteredSubjects) && form.subjectId !== filteredSubjects[0]._id) {
            setForm((current) => ({ ...current, subjectId: filteredSubjects[0]._id }));
        }
    }, [editingPost, filteredSubjects, form.classId, form.subjectId, open, scopedOnly]);
    if (!open)
        return null;
    const addLink = () => {
        if (!linkDraft.title.trim() || !linkDraft.url.trim())
            return;
        setForm((current) => ({
            ...current,
            links: [...(current.links ?? []), { title: linkDraft.title.trim(), url: linkDraft.url.trim() }]
        }));
        setLinkDraft({ title: "", url: "" });
    };
    const handleSubmit = async (event) => {
        event.preventDefault();
        const parsed = assignmentSchema.safeParse(form);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
            return;
        }
        await onSave(parsed.data);
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center", children: _jsxs("div", { className: "max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl", children: [_jsxs("div", { className: "sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4", children: [_jsx("h2", { className: "text-lg font-semibold text-slate-900", children: editingPost ? "Edit post" : "Create post" }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: onClose, children: _jsx(X, { className: "h-4 w-4" }) })] }), _jsxs("form", { className: "space-y-4 p-5", onSubmit: handleSubmit, children: [_jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsx(FormField, { label: "Type", children: _jsx(Select, { value: form.type, onChange: (event) => setForm((current) => ({ ...current, type: event.target.value })), children: ASSIGNMENT_TYPES.map((type) => (_jsx("option", { value: type, children: TYPE_LABELS[type] }, type))) }) }), _jsxs(FormField, { label: "Topic / Unit", children: [_jsx(Input, { list: "topic-suggestions", value: form.topic ?? "", onChange: (event) => setForm((current) => ({ ...current, topic: event.target.value })), placeholder: "e.g. Algebra, Unit 3" }), _jsx("datalist", { id: "topic-suggestions", children: topicSuggestions.map((topic) => (_jsx("option", { value: topic }, topic))) })] })] }), _jsx(FormField, { label: "Title", children: _jsx(Input, { value: form.title, onChange: (event) => setForm((current) => ({ ...current, title: event.target.value })) }) }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-3", children: [scopedOnly && hasSingleOption(classes) ? (_jsx(FormField, { label: "Class", children: _jsx(Input, { value: classes[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Class", children: _jsxs(Select, { value: form.classId, onChange: (event) => setForm((current) => ({ ...current, classId: event.target.value, sectionId: "", subjectId: "" })), children: [_jsx("option", { value: "", children: "Select class" }), classes.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) })), scopedOnly && hasSingleOption(filteredSections) ? (_jsx(FormField, { label: "Section", children: _jsx(Input, { value: filteredSections[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Section", children: _jsxs(Select, { value: form.sectionId, onChange: (event) => setForm((current) => ({ ...current, sectionId: event.target.value, subjectId: "" })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "Select section" }), filteredSections.map((item) => (_jsx("option", { value: item._id, children: item.name }, item._id)))] }) })), scopedOnly && hasSingleOption(filteredSubjects) ? (_jsx(FormField, { label: "Subject", children: _jsx(Input, { value: filteredSubjects[0].code
                                            ? `${filteredSubjects[0].name} (${filteredSubjects[0].code})`
                                            : filteredSubjects[0].name, readOnly: true, disabled: true }) })) : (_jsx(FormField, { label: "Subject", children: _jsxs(Select, { value: form.subjectId, onChange: (event) => setForm((current) => ({ ...current, subjectId: event.target.value })), disabled: !form.classId, children: [_jsx("option", { value: "", children: "Select subject" }), filteredSubjects.map((item) => (_jsxs("option", { value: item._id, children: [item.name, item.code ? ` (${item.code})` : ""] }, item._id)))] }) }))] }), form.type !== "NOTE" ? (_jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsx(FormField, { label: "Due date (BS)", children: _jsx(NepaliDateField, { value: form.dueDateBs ?? "", onChange: (value) => setForm((current) => ({ ...current, dueDateBs: value })) }) }), form.type === "CAS" ? (_jsx(FormField, { label: "Max marks", children: _jsx(Input, { type: "number", value: form.maxMarks ?? "", onChange: (event) => setForm((current) => ({ ...current, maxMarks: Number(event.target.value) })) }) })) : null] })) : null, _jsx(FormField, { label: "Description", children: _jsx(Textarea, { rows: 4, value: form.description, onChange: (event) => setForm((current) => ({ ...current, description: event.target.value })) }) }), form.type !== "NOTE" ? (_jsx(FormField, { label: "Rubric / instructions", children: _jsx(Textarea, { rows: 2, value: form.rubric ?? "", onChange: (event) => setForm((current) => ({ ...current, rubric: event.target.value })) }) })) : null, _jsx(FormField, { label: "Attachments", children: _jsx(ClassroomAttachmentUpload, { attachments: form.attachments ?? [], onChange: (attachments) => setForm((current) => ({ ...current, attachments })) }) }), _jsxs("div", { className: "space-y-2", children: [_jsx("p", { className: "text-sm font-medium text-slate-700", children: "Links" }), _jsxs("div", { className: "grid gap-2 sm:grid-cols-[1fr_1fr_auto]", children: [_jsx(Input, { placeholder: "Link title", value: linkDraft.title, onChange: (event) => setLinkDraft((current) => ({ ...current, title: event.target.value })) }), _jsx(Input, { placeholder: "https://...", value: linkDraft.url, onChange: (event) => setLinkDraft((current) => ({ ...current, url: event.target.value })) }), _jsx(Button, { type: "button", variant: "outline", onClick: addLink, children: "Add" })] }), (form.links ?? []).length > 0 ? (_jsx("ul", { className: "space-y-1 text-sm text-slate-600", children: form.links?.map((link, index) => (_jsxs("li", { className: "flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2", children: [_jsxs("span", { className: "truncate", children: [link.title, " \u2014 ", link.url] }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => setForm((current) => ({
                                                    ...current,
                                                    links: (current.links ?? []).filter((_, i) => i !== index)
                                                })), children: "Remove" })] }, `${link.url}-${index}`))) })) : null] }), _jsxs("div", { className: "flex flex-wrap gap-4 text-sm", children: [form.type !== "NOTE" ? (_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: form.allowSubmission ?? true, onChange: (event) => setForm((current) => ({ ...current, allowSubmission: event.target.checked })) }), "Allow student submissions"] })) : null, _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: form.isPinned ?? false, onChange: (event) => setForm((current) => ({ ...current, isPinned: event.target.checked })) }), "Pin to top of stream"] })] }), _jsxs("div", { className: "flex justify-end gap-2 border-t pt-4", children: [_jsx(Button, { type: "button", variant: "outline", onClick: onClose, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: saving, children: saving ? "Saving..." : editingPost ? "Save changes" : "Post" })] })] })] }) }));
};
