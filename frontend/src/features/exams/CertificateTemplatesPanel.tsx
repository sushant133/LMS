import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CHARACTER_CERTIFICATE_PLACEHOLDERS,
  CHARACTER_CERTIFICATE_PLACEHOLDER_LABELS,
  DEFAULT_CHARACTER_CERTIFICATE_BODY,
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
  type CharacterCertificateTemplateRecord,
} from "@phit-erp/shared";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { api } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import {
  CERTIFICATE_API_BASE,
  certificateTemplatesKey,
  fetchCertificateTemplates,
} from "./characterCertificateApi";

interface TemplateForm {
  name: string;
  headingText: string;
  bodyTemplate: string;
  signatoryLabel: string;
  affiliationText: string;
  isDefault: boolean;
  isActive: boolean;
}

const emptyForm = (): TemplateForm => ({
  name: "",
  headingText: DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  bodyTemplate: DEFAULT_CHARACTER_CERTIFICATE_BODY,
  signatoryLabel: DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
  affiliationText: "",
  isDefault: false,
  isActive: true,
});

/**
 * Institution-defined certificate templates. Bodies carry {{token}} placeholders
 * resolved from the student profile at issue time; the admin can still edit the
 * resolved wording before the certificate is issued.
 */
export const CertificateTemplatesPanel = () => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const templatesQuery = useQuery({
    queryKey: certificateTemplatesKey(),
    queryFn: fetchCertificateTemplates,
  });

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        headingText: form.headingText.trim() || DEFAULT_CHARACTER_CERTIFICATE_HEADING,
        bodyTemplate: form.bodyTemplate.trim(),
        signatoryLabel: form.signatoryLabel.trim() || DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
        affiliationText: form.affiliationText.trim(),
        isDefault: form.isDefault,
        isActive: form.isActive,
      };
      if (editingId) {
        return api.put(`${CERTIFICATE_API_BASE}/templates/${editingId}`, payload);
      }
      return api.post(`${CERTIFICATE_API_BASE}/templates`, payload);
    },
    onSuccess: async () => {
      toast.success(editingId ? "Template updated" : "Template created");
      await queryClient.invalidateQueries({ queryKey: certificateTemplatesKey() });
      resetForm();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) =>
      api.delete(`${CERTIFICATE_API_BASE}/templates/${templateId}`),
    onSuccess: async () => {
      toast.success("Template deleted");
      await queryClient.invalidateQueries({ queryKey: certificateTemplatesKey() });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const startEdit = (template: CharacterCertificateTemplateRecord) => {
    setEditingId(template._id);
    setForm({
      name: template.name,
      headingText: template.headingText || DEFAULT_CHARACTER_CERTIFICATE_HEADING,
      bodyTemplate: template.bodyTemplate,
      signatoryLabel: template.signatoryLabel || DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
      affiliationText: template.affiliationText ?? "",
      isDefault: template.isDefault,
      isActive: template.isActive,
    });
    setShowForm(true);
  };

  const insertPlaceholder = (token: string) =>
    setForm((current) => ({
      ...current,
      bodyTemplate: `${current.bodyTemplate}{{${token}}}`,
    }));

  const templates = templatesQuery.data ?? [];
  const canSave =
    form.name.trim().length >= 2 &&
    form.bodyTemplate.trim().length >= 20 &&
    !saveMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Define the certificate wording your institution uses. Use{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{"{{token}}"}</code>{" "}
          placeholders — they are filled from the student profile when a certificate is issued.
        </p>
        {!showForm ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setForm(emptyForm());
              setEditingId(null);
              setShowForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit template" : "New template"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Template name">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="e.g. Character Certificate (Scholarship)"
                />
              </FormField>
              <FormField label="Heading">
                <Input
                  value={form.headingText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, headingText: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Signatory">
                <Input
                  value={form.signatoryLabel}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, signatoryLabel: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Affiliation line (optional)">
                <Input
                  value={form.affiliationText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, affiliationText: event.target.value }))
                  }
                  placeholder="e.g. (Affiliated To CTEVT)"
                />
              </FormField>
              <div className="flex items-end gap-5 pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.isDefault}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, isDefault: event.target.checked }))
                    }
                  />
                  Default template
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.isActive}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, isActive: event.target.checked }))
                    }
                  />
                  Active
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Certificate body</label>
              <Textarea
                value={form.bodyTemplate}
                rows={12}
                onChange={(event) =>
                  setForm((current) => ({ ...current, bodyTemplate: event.target.value }))
                }
                className="font-serif text-[15px] leading-relaxed"
              />
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Click to insert a placeholder
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CHARACTER_CERTIFICATE_PLACEHOLDERS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      title={CHARACTER_CERTIFICATE_PLACEHOLDER_LABELS[token]}
                      onClick={() => insertPlaceholder(token)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700"
                    >
                      {`{{${token}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="button" disabled={!canSave} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {editingId ? "Save changes" : "Create template"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {templatesQuery.isLoading ? (
        <LoadingState />
      ) : templates.length === 0 ? (
        <EmptyState
          title="No certificate templates"
          description="Create a template to define the wording used on character certificates."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template._id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{template.name}</CardTitle>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {template.isDefault ? (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                          Default
                        </span>
                      ) : null}
                      <span
                        className={
                          template.isActive
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                            : "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600"
                        }
                      >
                        {template.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(template)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete template "${template.name}"? Certificates already issued from it are not affected.`,
                          )
                        ) {
                          deleteMutation.mutate(template._id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-600">
                  {template.bodyTemplate}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
