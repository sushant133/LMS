import { useEffect, useState } from "react";
import {
  STUDENT_DOCUMENT_CATEGORIES,
  type StudentDocument,
} from "@phit-erp/shared";
import {
  AlertCircle,
  Download,
  Eye,
  FileText,
  Loader2,
  Replace,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import {
  downloadAuthenticatedAttachment,
  fetchAuthenticatedBlobUrl,
  isUploadFileUrl,
  openAuthenticatedAttachment,
  resolveAttachmentUrl,
  sanitizeDownloadFilename,
} from "lib/attachments";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import {
  countPendingRequiredDocuments,
  formatFileSize,
  getCategoryLabel,
  getDocumentStatusBadgeClass,
  getDocumentStatusLabel,
  isImageDocument,
  isPendingStudentDocument,
  pendingToStudentDocument,
  validateDocumentFile,
  type PendingStudentDocument,
} from "./studentDocumentUtils";

interface StudentDocumentsSectionProps {
  studentId?: string;
  documents: StudentDocument[];
  onChange: (documents: StudentDocument[]) => void;
  canManage: boolean;
  pendingDocuments?: PendingStudentDocument[];
  onPendingChange?: (pending: PendingStudentDocument[]) => void;
  uploadedBy?: string;
  uploadedByName?: string;
  /** Profile only — never show on New Student Registration form. */
  showPendingSummary?: boolean;
}

export const StudentDocumentsSection = ({
  studentId,
  documents,
  onChange,
  canManage,
  pendingDocuments = [],
  onPendingChange,
  uploadedBy = "",
  uploadedByName = "Admin",
  showPendingSummary = false,
}: StudentDocumentsSectionProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>(
    STUDENT_DOCUMENT_CATEGORIES[0]?.key ?? "",
  );
  const [customName, setCustomName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const category = STUDENT_DOCUMENT_CATEGORIES.find(
    (item) => item.key === selectedCategory,
  );

  const pendingRequiredCount = countPendingRequiredDocuments(documents);
  const queuedTypes = new Set(pendingDocuments.map((item) => item.type));

  const uploadFile = async (
    file: File,
    type: string,
    name: string,
    documentId?: string,
  ) => {
    if (!studentId) return null;

    const formData = new FormData();
    formData.append("documents", file);
    formData.append("documentType", type);

    const uploadResponse = await fetch(
      resolveApiUrl(`/uploads/students/${studentId}/documents`),
      {
        method: "POST",
        body: formData,
        credentials: "include",
      },
    );

    if (!uploadResponse.ok) {
      const body = await uploadResponse.json().catch(() => ({}));
      throw new Error(body.message ?? "Upload failed");
    }

    const uploadBody = await uploadResponse.json();
    const uploaded = uploadBody.data?.documents?.[0];
    if (!uploaded) throw new Error("Upload response invalid");

    const payload = {
      type,
      name,
      url: uploaded.url,
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    };

    // Prefer replace when we have an existing document id (including PENDING)
    const pendingPlaceholder = documents.find(
      (doc) =>
        doc.type === type && isPendingStudentDocument(doc) && Boolean(doc._id),
    );
    const targetId = documentId ?? pendingPlaceholder?._id;

    if (targetId) {
      const result = await unwrap<{
        document: StudentDocument;
        student: { documents: StudentDocument[] };
      }>(
        api.put(`/students/${studentId}/documents/replace`, {
          ...payload,
          documentId: targetId,
        }),
      );
      return result.student.documents;
    }

    const result = await unwrap<{
      document: StudentDocument;
      student: { documents: StudentDocument[] };
    }>(api.post(`/students/${studentId}/documents`, payload));
    return result.student.documents;
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    replaceDocumentId?: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = validateDocumentFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const type = replaceDocumentId
      ? (documents.find((doc) => doc._id === replaceDocumentId)?.type ??
        selectedCategory)
      : selectedCategory;
    const categoryMeta = STUDENT_DOCUMENT_CATEGORIES.find(
      (item) => item.key === type,
    );
    const name =
      categoryMeta?.allowCustomName && customName.trim()
        ? customName.trim()
        : getCategoryLabel(type);

    if (
      categoryMeta?.allowCustomName &&
      !replaceDocumentId &&
      !customName.trim()
    ) {
      toast.error("Enter a document name for Other Documents");
      return;
    }

    setUploading(true);
    setReplacingId(replaceDocumentId ?? null);

    try {
      if (studentId) {
        const updated = await uploadFile(file, type, name, replaceDocumentId);
        if (updated) {
          onChange(updated);
          await queryClient.invalidateQueries({
            queryKey: ["student-profile", studentId],
          });
          await queryClient.invalidateQueries({ queryKey: ["students"] });
        }
        toast.success(
          replaceDocumentId ? "Document replaced" : "Document uploaded",
        );
      } else if (onPendingChange) {
        // Avoid queuing two files for the same non-multiple category
        const filtered = categoryMeta?.allowMultiple
          ? pendingDocuments
          : pendingDocuments.filter((item) => item.type !== type);
        onPendingChange([
          ...filtered,
          { id: crypto.randomUUID(), type, name, file },
        ]);
        toast.success("Document queued — will upload when student is saved");
      }
      setCustomName("");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setUploading(false);
      setReplacingId(null);
    }
  };

  const handleDelete = async (documentId: string, documentName?: string) => {
    if (!studentId || !canManage) return;
    const label = documentName?.trim() || "this document";
    if (
      !window.confirm(
        `Delete “${label}”?\n\nThis will remove it from the student profile. You can cancel if you selected the wrong file.`,
      )
    ) {
      return;
    }
    try {
      const result = await unwrap<{
        student: { documents: StudentDocument[] };
      }>(api.delete(`/students/${studentId}/documents/${documentId}`));
      onChange(result.student.documents);
      await queryClient.invalidateQueries({
        queryKey: ["student-profile", studentId],
      });
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      toast.success("Document deleted");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const handleRemovePending = (id: string) => {
    if (
      !window.confirm(
        "Remove this queued document before save?\n\nIt will not be uploaded.",
      )
    ) {
      return;
    }
    onPendingChange?.(pendingDocuments.filter((item) => item.id !== id));
  };

  const docsByCategory = (type: string) =>
    documents.filter(
      (doc) =>
        doc.type === type &&
        !(doc as { isDeleted?: boolean }).isDeleted,
    );

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Documents</h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload student documents (PDF, JPG, JPEG, PNG — max 600 KB each).
          Documents can be added later; the student can still be created without
          them.
          {!studentId
            ? " Queued files will upload after the student is saved."
            : null}
        </p>
      </div>

      {showPendingSummary && pendingRequiredCount > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-medium">
              {pendingRequiredCount} required document
              {pendingRequiredCount === 1 ? "" : "s"} pending
            </span>
            <p className="mt-0.5 text-amber-800/90">
              The student record is active. Upload the missing files when
              available.
            </p>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="Document Category">
            <Select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              {STUDENT_DOCUMENT_CATEGORIES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
          </FormField>
          {category?.allowCustomName ? (
            <FormField label="Document Name">
              <Input
                placeholder="Enter custom document name"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="Upload File">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Choose file"}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                disabled={uploading}
                onChange={(event) => void handleFileSelect(event)}
              />
            </label>
          </FormField>
        </div>
      ) : null}

      <div className="space-y-3">
        {STUDENT_DOCUMENT_CATEGORIES.map((cat) => {
          const categoryDocs = docsByCategory(cat.key);
          const hasQueued = queuedTypes.has(cat.key);
          const realDocs = categoryDocs.filter(
            (doc) => !isPendingStudentDocument(doc),
          );
          const pendingDocs = categoryDocs.filter((doc) =>
            isPendingStudentDocument(doc),
          );
          const isMissingRequired =
            cat.required &&
            realDocs.length === 0 &&
            !hasQueued &&
            pendingDocs.length === 0;

          // Hide optional empty categories
          if (
            !cat.required &&
            categoryDocs.length === 0 &&
            !hasQueued
          ) {
            return null;
          }

          return (
            <div
              key={cat.key}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-800">{cat.label}</span>
                {isMissingRequired || pendingDocs.length > 0 ? (
                  <Badge className="bg-amber-100 text-amber-900">Pending</Badge>
                ) : null}
                {hasQueued ? (
                  <Badge className="bg-sky-100 text-sky-900">Queued</Badge>
                ) : null}
              </div>

              {realDocs.length === 0 &&
              pendingDocs.length === 0 &&
              !hasQueued ? (
                cat.required ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-amber-200 bg-amber-50/60 px-3 py-2">
                    <p className="text-sm text-amber-900">
                      Not submitted — marked as pending
                    </p>
                    {canManage && studentId ? (
                      <label className="inline-flex cursor-pointer items-center">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <span>
                            <Upload className="mr-1 h-3.5 w-3.5" />
                            Upload
                          </span>
                        </Button>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                          className="hidden"
                          disabled={uploading}
                          onChange={(event) => {
                            setSelectedCategory(cat.key);
                            void handleFileSelect(event);
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No document uploaded</p>
                )
              ) : (
                <div className="space-y-2">
                  {pendingDocs.map((doc) => (
                    <PendingDocumentRow
                      key={doc._id ?? `pending-${doc.type}`}
                      doc={doc}
                      canManage={canManage && Boolean(studentId)}
                      uploading={uploading && replacingId === doc._id}
                      onUpload={(event) =>
                        void handleFileSelect(event, doc._id)
                      }
                    />
                  ))}
                  {realDocs.map((doc) => (
                    <DocumentRow
                      key={doc._id ?? doc.url}
                      doc={doc}
                      canManage={canManage}
                      uploading={uploading && replacingId === doc._id}
                      onDelete={() =>
                        doc._id && void handleDelete(doc._id, doc.name)
                      }
                      onReplace={(event) =>
                        void handleFileSelect(event, doc._id)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingDocuments.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-900">
            Queued for upload after save ({pendingDocuments.length})
          </p>
          <div className="space-y-2">
            {pendingDocuments.map((pending) => (
              <div
                key={pending.id}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm"
              >
                <span>
                  {pending.name} — {pending.file.name} (
                  {formatFileSize(pending.file.size)})
                </span>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePending(pending.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface DocumentRowProps {
  doc: StudentDocument;
  canManage: boolean;
  uploading: boolean;
  onDelete: () => void;
  onReplace: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Thumbnail that loads protected /uploads files with session cookies. */
const DocumentThumbnail = ({
  url,
  name,
  mimeType,
}: {
  url: string;
  name: string;
  mimeType?: string;
}) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !isImageDocument(mimeType, url)) {
      setSrc(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const resolved = resolveAttachmentUrl(url);
        if (isUploadFileUrl(resolved) || resolved.startsWith("/uploads/")) {
          const blobUrl = await fetchAuthenticatedBlobUrl(url);
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          revoked = blobUrl;
          setSrc(blobUrl);
        } else {
          setSrc(resolved);
        }
      } catch {
        if (!cancelled) setSrc(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url, mimeType]);

  if (src) {
    return (
      <img src={src} alt={name} className="h-10 w-10 rounded object-cover" />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200">
      <FileText className="h-5 w-5 text-slate-600" />
    </div>
  );
};

/** Full-screen modal preview — works when popups are blocked (mobile WebView). */
const DocumentPreviewModal = ({
  doc,
  onClose,
}: {
  doc: StudentDocument;
  onClose: () => void;
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isImage = isImageDocument(doc.mimeType, doc.url);
  const isPdf =
    doc.mimeType === "application/pdf" ||
    /\.pdf($|\?)/i.test(doc.url || "") ||
    /\.pdf$/i.test(doc.originalName || "");

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!doc.url?.trim()) {
          throw new Error("This document has no file URL. Re-upload it.");
        }
        const url = await fetchAuthenticatedBlobUrl(doc.url);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setBlobUrl(url);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Could not load document",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleDownload = async () => {
    try {
      await downloadAuthenticatedAttachment(
        doc.url,
        doc.originalName || doc.name || "document",
      );
      toast.success("Download started");
    } catch (e) {
      toast.error("Document unavailable.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${doc.name}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92dvh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{doc.name}</p>
            <p className="truncate text-xs text-slate-500">
              {doc.originalName || "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDownload()}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Download
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          {loading ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading document…
            </div>
          ) : error ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-600">
              <FileText className="h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-800">Document unavailable</p>
              <p className="max-w-sm text-slate-500">
                This file cannot be previewed right now. Use{" "}
                <span className="font-medium text-slate-700">Download</span>
                {doc.url ? (
                  <>
                    {" "}
                    or ask an admin to use{" "}
                    <span className="font-medium text-slate-700">Replace</span>{" "}
                    if a new copy is needed.
                  </>
                ) : (
                  "."
                )}
              </p>
            </div>
          ) : blobUrl && isImage ? (
            <img
              src={blobUrl}
              alt={doc.name}
              className="mx-auto max-h-[min(75dvh,800px)] w-auto max-w-full rounded-lg object-contain"
            />
          ) : blobUrl && isPdf ? (
            <iframe
              title={doc.name}
              src={blobUrl}
              className="h-[min(75dvh,800px)] w-full rounded-lg border border-slate-200 bg-white"
            />
          ) : blobUrl ? (
            <div className="space-y-3 py-10 text-center text-sm text-slate-600">
              <FileText className="mx-auto h-10 w-10 text-slate-400" />
              <p>Preview is not available for this file type.</p>
              <Button type="button" onClick={() => void handleDownload()}>
                <Download className="mr-2 h-4 w-4" />
                Download file
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const DocumentRow = ({
  doc,
  canManage,
  uploading,
  onDelete,
  onReplace,
}: DocumentRowProps) => {
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handlePreview = async () => {
    if (!doc.url?.trim()) {
      toast.message("Document unavailable.");
      return;
    }
    // In-app modal is reliable; also try external tab as secondary path for desktop.
    setShowPreview(true);
  };

  const handleOpenExternal = async () => {
    if (!doc.url) return;
    setBusy("preview");
    try {
      await openAuthenticatedAttachment(
        doc.url,
        doc.originalName || doc.name || "document",
      );
    } catch {
      toast.message("Document unavailable.");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (!doc.url?.trim()) {
      toast.message("Document unavailable.");
      return;
    }
    setBusy("download");
    try {
      await downloadAuthenticatedAttachment(
        doc.url,
        sanitizeDownloadFilename(
          doc.originalName || doc.name || "document",
          doc.url,
        ),
      );
      toast.success("Download started");
    } catch {
      toast.message("Document unavailable.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {showPreview ? (
        <DocumentPreviewModal doc={doc} onClose={() => setShowPreview(false)} />
      ) : null}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
        <DocumentThumbnail
          url={doc.url}
          name={doc.name}
          mimeType={doc.mimeType}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">{doc.name}</div>
          <div className="text-xs text-slate-500">
            {doc.originalName} · {formatFileSize(doc.size ?? 0)} ·{" "}
            {doc.uploadedAt
              ? new Date(doc.uploadedAt).toLocaleDateString()
              : "—"}
            {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
          </div>
          <Badge className={`mt-1 ${getDocumentStatusBadgeClass(doc.status)}`}>
            {getDocumentStatusLabel(doc.status)}
          </Badge>
          {!doc.url?.trim() ? (
            <p className="mt-1 text-xs text-slate-500">Document unavailable</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {doc.url ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handlePreview()}
              >
                {busy === "preview" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1 h-3.5 w-3.5" />
                )}
                Preview
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                className="hidden sm:inline-flex"
                title="Open in a new browser tab"
                onClick={() => void handleOpenExternal()}
              >
                Open tab
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleDownload()}
              >
                {busy === "download" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                Download
              </Button>
            </>
          ) : null}
          {canManage ? (
            <>
              <label className="inline-flex cursor-pointer items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  asChild
                >
                  <span>
                    <Replace className="mr-1 h-3.5 w-3.5" />
                    {uploading ? "..." : "Replace"}
                  </span>
                </Button>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="hidden"
                  disabled={uploading}
                  onChange={onReplace}
                />
              </label>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

interface PendingDocumentRowProps {
  doc: StudentDocument;
  canManage: boolean;
  uploading: boolean;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const PendingDocumentRow = ({
  doc,
  canManage,
  uploading,
  onUpload,
}: PendingDocumentRowProps) => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3 py-2 text-sm">
    <div className="flex h-10 w-10 items-center justify-center rounded bg-amber-100">
      <AlertCircle className="h-5 w-5 text-amber-700" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="font-medium text-slate-900">{doc.name}</div>
      <div className="text-xs text-amber-800">
        Document not submitted yet
      </div>
      <Badge className="mt-1 bg-amber-100 text-amber-900">Pending</Badge>
    </div>
    {canManage ? (
      <label className="inline-flex cursor-pointer items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          asChild
        >
          <span>
            <Upload className="mr-1 h-3.5 w-3.5" />
            {uploading ? "..." : "Upload"}
          </span>
        </Button>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="hidden"
          disabled={uploading}
          onChange={onUpload}
        />
      </label>
    ) : null}
  </div>
);

export const uploadPendingDocuments = async (
  studentId: string,
  pending: PendingStudentDocument[],
  uploadedBy: string,
  uploadedByName: string,
): Promise<StudentDocument[]> => {
  const results: StudentDocument[] = [];

  for (const item of pending) {
    const formData = new FormData();
    formData.append("documents", item.file);
    formData.append("documentType", item.type);

    const uploadResponse = await fetch(
      resolveApiUrl(`/uploads/students/${studentId}/documents`),
      {
        method: "POST",
        body: formData,
        credentials: "include",
      },
    );

    if (!uploadResponse.ok) {
      const body = await uploadResponse.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to upload ${item.name}`);
    }

    const uploadBody = await uploadResponse.json();
    const uploaded = uploadBody.data?.documents?.[0];

    await unwrap(
      api.post(`/students/${studentId}/documents`, {
        type: item.type,
        name: item.name,
        url: uploaded.url,
        originalName: uploaded.originalName,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
      }),
    );

    results.push(
      pendingToStudentDocument(item, uploaded, uploadedBy, uploadedByName),
    );
  }

  return results;
};
