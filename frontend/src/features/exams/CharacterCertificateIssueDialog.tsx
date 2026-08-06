import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CHARACTER_CERTIFICATE_CONDUCT_RATINGS,
  type CharacterCertificateRecord,
  type PassedOutStudentRecord,
} from "@phit-erp/shared";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { api } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import {
  CERTIFICATE_API_BASE,
  certificateTemplatesKey,
  fetchCertificateTemplates,
  previewCertificate,
  printCertificatePdf,
} from "./characterCertificateApi";

/**
 * Issue an original certificate for a passed-out student, or record a duplicate
 * against an existing one. Both flows share this dialog because the admin edits
 * the same fields; only the write endpoint and the wording differ.
 */
type DialogMode = "issue" | "duplicate";

interface CharacterCertificateIssueDialogProps {
  open: boolean;
  mode: DialogMode;
  student?: PassedOutStudentRecord | null;
  certificate?: CharacterCertificateRecord | null;
  onClose: () => void;
  onIssued: () => void;
}

export const CharacterCertificateIssueDialog = ({
  open,
  mode,
  student,
  certificate,
  onClose,
  onIssued,
}: CharacterCertificateIssueDialogProps) => {
  const [templateId, setTemplateId] = useState("");
  const [conduct, setConduct] = useState<string>(CHARACTER_CERTIFICATE_CONDUCT_RATINGS[0]);
  const [purpose, setPurpose] = useState("");
  const [remarks, setRemarks] = useState("");
  const [issueDateBs, setIssueDateBs] = useState("");
  const [headingText, setHeadingText] = useState("");
  const [signatoryLabel, setSignatoryLabel] = useState("");
  const [body, setBody] = useState("");
  /** True once the admin edits the body, so a template refresh stops overwriting it. */
  const [bodyTouched, setBodyTouched] = useState(false);

  const studentId = student?.studentId ?? certificate?.student.studentId ?? "";
  const studentName = student?.studentName ?? certificate?.student.studentName ?? "";

  const templatesQuery = useQuery({
    queryKey: certificateTemplatesKey(),
    queryFn: fetchCertificateTemplates,
    enabled: open,
  });

  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.isActive),
    [templatesQuery.data],
  );

  // Reset every time the dialog opens for a different student/certificate.
  useEffect(() => {
    if (!open) return;
    setBodyTouched(false);
    setPurpose("");
    setRemarks("");
    setIssueDateBs("");

    if (mode === "duplicate" && certificate) {
      const latest = certificate.issuances[certificate.issuances.length - 1];
      setConduct(certificate.conduct || CHARACTER_CERTIFICATE_CONDUCT_RATINGS[0]);
      setHeadingText(latest?.headingText ?? "");
      setSignatoryLabel(latest?.signatoryLabel ?? "");
      // Duplicates default to reissuing exactly what was issued last time.
      setBody(latest?.resolvedBody ?? "");
      setTemplateId(latest?.templateId ?? "");
    } else {
      setConduct(CHARACTER_CERTIFICATE_CONDUCT_RATINGS[0]);
      setHeadingText("");
      setSignatoryLabel("");
      setBody("");
      setTemplateId("");
    }
  }, [open, mode, certificate, studentId]);

  // Default to the institution's default template on an original issue.
  useEffect(() => {
    if (!open || mode !== "issue" || templateId || templates.length === 0) return;
    const preferred = templates.find((template) => template.isDefault) ?? templates[0];
    if (preferred) setTemplateId(preferred._id);
  }, [open, mode, templateId, templates]);

  const previewMutation = useMutation({
    mutationFn: previewCertificate,
    onSuccess: (data) => {
      setBody(data.resolvedBody);
      setBodyTouched(false);
      if (!headingText) setHeadingText(data.headingText);
      if (!signatoryLabel) setSignatoryLabel(data.signatoryLabel);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  /**
   * Re-resolve the template whenever the inputs that feed its placeholders
   * change — but never clobber wording the admin has already edited by hand.
   */
  useEffect(() => {
    if (!open || mode !== "issue" || !studentId || !templateId || bodyTouched) return;
    previewMutation.mutate({
      studentId,
      templateId,
      conduct,
      purpose,
      remarks,
      issueDateBs: issueDateBs || undefined,
    });
    // previewMutation is stable enough for this effect; including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, studentId, templateId, conduct, issueDateBs]);

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (mode === "duplicate" && certificate) {
        const response = await api.post(
          `${CERTIFICATE_API_BASE}/${certificate._id}/duplicate`,
          {
            purpose: purpose.trim() || undefined,
            remarks: remarks.trim() || undefined,
            resolvedBody: body.trim(),
            headingText: headingText.trim() || undefined,
            signatoryLabel: signatoryLabel.trim() || undefined,
            issueDateBs: issueDateBs || undefined,
          },
        );
        return response.data.data as CharacterCertificateRecord;
      }

      const response = await api.post(`${CERTIFICATE_API_BASE}/issue`, {
        studentId,
        templateId: templateId || undefined,
        headingText: headingText.trim() || undefined,
        resolvedBody: body.trim(),
        signatoryLabel: signatoryLabel.trim() || undefined,
        conduct: conduct.trim() || undefined,
        purpose: purpose.trim() || undefined,
        remarks: remarks.trim() || undefined,
        issueDateBs: issueDateBs || undefined,
      });
      return response.data.data as CharacterCertificateRecord;
    },
    onSuccess: async (record) => {
      toast.success(
        mode === "duplicate"
          ? `Duplicate recorded for ${record.certificateNumber}`
          : `Certificate ${record.certificateNumber} issued`,
      );
      await queryClient.invalidateQueries({ queryKey: ["passed-out-students"] });
      await queryClient.invalidateQueries({ queryKey: ["character-certificates"] });
      onIssued();
      onClose();

      // Print the freshly recorded issuance so the admin can hand it over now.
      try {
        await printCertificatePdf(record._id, record.issueCount);
      } catch (error) {
        toast.error(parseErrorMessage(error));
      }
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (!open) return null;

  const isDuplicate = mode === "duplicate";
  const canSubmit = body.trim().length >= 20 && !issueMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isDuplicate ? "Generate Duplicate Certificate" : "Issue Character Certificate"}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {studentName}
              {certificate ? ` · ${certificate.certificateNumber}` : ""}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isDuplicate ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This reissue keeps certificate number{" "}
              <strong>{certificate?.certificateNumber}</strong> and will be printed with a{" "}
              <strong>DUPLICATE</strong> mark. It is recorded as a separate entry in the issuance
              history — the original record is not modified.
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {!isDuplicate ? (
              <FormField label="Template">
                <Select
                  value={templateId}
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setBodyTouched(false);
                  }}
                >
                  <option value="">Select a template</option>
                  {templates.map((template) => (
                    <option key={template._id} value={template._id}>
                      {template.name}
                      {template.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <FormField label="Conduct">
              <Select value={conduct} onChange={(event) => setConduct(event.target.value)}>
                {CHARACTER_CERTIFICATE_CONDUCT_RATINGS.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Issue date (BS)">
              <NepaliDateField
                value={issueDateBs}
                onChange={setIssueDateBs}
                placeholder="Defaults to today"
              />
            </FormField>

            <FormField label="Heading">
              <Input
                value={headingText}
                onChange={(event) => setHeadingText(event.target.value)}
                placeholder="CHARACTER CERTIFICATE"
              />
            </FormField>

            <FormField label="Purpose (optional)">
              <Input
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="e.g. Higher studies abroad"
              />
            </FormField>

            <FormField label="Signatory">
              <Input
                value={signatoryLabel}
                onChange={(event) => setSignatoryLabel(event.target.value)}
                placeholder="Principal"
              />
            </FormField>
          </div>

          <FormField label="Remarks (optional)">
            <Input
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Internal note recorded with this issuance"
            />
          </FormField>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-slate-700">
                Certificate body{" "}
                <span className="font-normal text-slate-500">
                  (placeholders already filled — edit freely before issuing)
                </span>
              </label>
              {!isDuplicate && templateId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={previewMutation.isPending}
                  onClick={() => {
                    setBodyTouched(false);
                    previewMutation.mutate({
                      studentId,
                      templateId,
                      conduct,
                      purpose,
                      remarks,
                      issueDateBs: issueDateBs || undefined,
                    });
                  }}
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Reset from template
                </Button>
              ) : null}
            </div>
            <Textarea
              value={body}
              rows={14}
              onChange={(event) => {
                setBody(event.target.value);
                setBodyTouched(true);
              }}
              placeholder="Certificate wording…"
              className="font-serif text-[15px] leading-relaxed"
            />
            {body.trim().length > 0 && body.trim().length < 20 ? (
              <p className="text-sm text-rose-600">
                The certificate body is too short to issue.
              </p>
            ) : null}
            {/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(body) ? (
              <p className="text-sm text-amber-700">
                Unresolved placeholder found — check for a typo, or fill it in by hand before
                issuing.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => issueMutation.mutate()}
            className="bg-brand-600 hover:bg-brand-700"
          >
            {issueMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            {isDuplicate ? "Record duplicate & print" : "Issue certificate & print"}
          </Button>
        </div>
      </div>
    </div>
  );
};
