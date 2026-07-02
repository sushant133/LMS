import { useEffect, useMemo, useState } from "react";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  hasSingleOption,
  type ScopeOption
} from "lib/teacherScopeUtils";
import { X } from "lucide-react";
import {
  ASSIGNMENT_TYPES,
  assignmentSchema,
  type AssignmentInput,
  type AssignmentLink,
  type ClassroomPost
} from "@nepal-school-erp/shared";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { toast } from "sonner";
import { ClassroomAttachmentUpload } from "./ClassroomAttachmentUpload";
import { TYPE_LABELS } from "./homeworkUtils";

const defaultForm: AssignmentInput = {
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

interface ComposePostModalProps {
  open: boolean;
  editingPost?: ClassroomPost | null;
  classes: ScopeOption[];
  sections: ScopeOption[];
  subjects: ScopeOption[];
  topicSuggestions: string[];
  scopedOnly?: boolean;
  onClose: () => void;
  onSave: (payload: AssignmentInput) => Promise<void>;
  saving?: boolean;
}

export const ComposePostModal = ({
  open,
  editingPost,
  classes,
  sections,
  subjects,
  topicSuggestions,
  scopedOnly = false,
  onClose,
  onSave,
  saving
}: ComposePostModalProps) => {
  const [form, setForm] = useState<AssignmentInput>(defaultForm);
  const [linkDraft, setLinkDraft] = useState<AssignmentLink>({ title: "", url: "" });

  useEffect(() => {
    if (!open) return;
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
    } else {
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

    if (hasSingleOption(classes) && form.classId !== classes[0]!._id) {
      setForm((current) => ({ ...current, classId: classes[0]!._id, sectionId: "", subjectId: "" }));
    }
  }, [classes, editingPost, form.classId, open, scopedOnly]);

  useEffect(() => {
    if (!open || editingPost || !scopedOnly || !form.classId) {
      return;
    }

    if (hasSingleOption(filteredSections) && form.sectionId !== filteredSections[0]!._id) {
      setForm((current) => ({ ...current, sectionId: filteredSections[0]!._id, subjectId: "" }));
    }
  }, [editingPost, filteredSections, form.classId, form.sectionId, open, scopedOnly]);

  useEffect(() => {
    if (!open || editingPost || !scopedOnly || !form.classId) {
      return;
    }

    if (hasSingleOption(filteredSubjects) && form.subjectId !== filteredSubjects[0]!._id) {
      setForm((current) => ({ ...current, subjectId: filteredSubjects[0]!._id }));
    }
  }, [editingPost, filteredSubjects, form.classId, form.subjectId, open, scopedOnly]);

  if (!open) return null;

  const addLink = () => {
    if (!linkDraft.title.trim() || !linkDraft.url.trim()) return;
    setForm((current) => ({
      ...current,
      links: [...(current.links ?? []), { title: linkDraft.title.trim(), url: linkDraft.url.trim() }]
    }));
    setLinkDraft({ title: "", url: "" });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = assignmentSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingPost ? "Edit post" : "Create post"}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form className="space-y-4 p-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type">
              <Select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as AssignmentInput["type"] }))}
              >
                {ASSIGNMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Topic / Unit">
              <Input
                list="topic-suggestions"
                value={form.topic ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))}
                placeholder="e.g. Algebra, Unit 3"
              />
              <datalist id="topic-suggestions">
                {topicSuggestions.map((topic) => (
                  <option key={topic} value={topic} />
                ))}
              </datalist>
            </FormField>
          </div>

          <FormField label="Title">
            <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            {scopedOnly && hasSingleOption(classes) ? (
              <FormField label="Class">
                <Input value={classes[0]!.name} readOnly disabled />
              </FormField>
            ) : (
              <FormField label="Class">
                <Select
                  value={form.classId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, classId: event.target.value, sectionId: "", subjectId: "" }))
                  }
                >
                  <option value="">Select class</option>
                  {classes.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            {scopedOnly && hasSingleOption(filteredSections) ? (
              <FormField label="Section">
                <Input value={filteredSections[0]!.name} readOnly disabled />
              </FormField>
            ) : (
              <FormField label="Section">
                <Select
                  value={form.sectionId}
                  onChange={(event) => setForm((current) => ({ ...current, sectionId: event.target.value, subjectId: "" }))}
                  disabled={!form.classId}
                >
                  <option value="">Select section</option>
                  {filteredSections.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            {scopedOnly && hasSingleOption(filteredSubjects) ? (
              <FormField label="Subject">
                <Input
                  value={
                    filteredSubjects[0]!.code
                      ? `${filteredSubjects[0]!.name} (${filteredSubjects[0]!.code})`
                      : filteredSubjects[0]!.name
                  }
                  readOnly
                  disabled
                />
              </FormField>
            ) : (
              <FormField label="Subject">
                <Select
                  value={form.subjectId}
                  onChange={(event) => setForm((current) => ({ ...current, subjectId: event.target.value }))}
                  disabled={!form.classId}
                >
                  <option value="">Select subject</option>
                  {filteredSubjects.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                      {item.code ? ` (${item.code})` : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
          </div>

          {form.type !== "NOTE" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Due date (BS)">
                <NepaliDateField
                  value={form.dueDateBs ?? ""}
                  onChange={(value) => setForm((current) => ({ ...current, dueDateBs: value }))}
                />
              </FormField>
              {form.type === "CAS" ? (
                <FormField label="Max marks">
                  <Input
                    type="number"
                    value={form.maxMarks ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, maxMarks: Number(event.target.value) }))}
                  />
                </FormField>
              ) : null}
            </div>
          ) : null}

          <FormField label="Description">
            <Textarea
              rows={4}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </FormField>

          {form.type !== "NOTE" ? (
            <FormField label="Rubric / instructions">
              <Textarea
                rows={2}
                value={form.rubric ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, rubric: event.target.value }))}
              />
            </FormField>
          ) : null}

          <FormField label="Attachments">
            <ClassroomAttachmentUpload
              attachments={form.attachments ?? []}
              onChange={(attachments) => setForm((current) => ({ ...current, attachments }))}
            />
          </FormField>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Links</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder="Link title"
                value={linkDraft.title}
                onChange={(event) => setLinkDraft((current) => ({ ...current, title: event.target.value }))}
              />
              <Input
                placeholder="https://..."
                value={linkDraft.url}
                onChange={(event) => setLinkDraft((current) => ({ ...current, url: event.target.value }))}
              />
              <Button type="button" variant="outline" onClick={addLink}>
                Add
              </Button>
            </div>
            {(form.links ?? []).length > 0 ? (
              <ul className="space-y-1 text-sm text-slate-600">
                {form.links?.map((link, index) => (
                  <li key={`${link.url}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <span className="truncate">
                      {link.title} — {link.url}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          links: (current.links ?? []).filter((_, i) => i !== index)
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            {form.type !== "NOTE" ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.allowSubmission ?? true}
                  onChange={(event) => setForm((current) => ({ ...current, allowSubmission: event.target.checked }))}
                />
                Allow student submissions
              </label>
            ) : null}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isPinned ?? false}
                onChange={(event) => setForm((current) => ({ ...current, isPinned: event.target.checked }))}
              />
              Pin to top of stream
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editingPost ? "Save changes" : "Post"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};