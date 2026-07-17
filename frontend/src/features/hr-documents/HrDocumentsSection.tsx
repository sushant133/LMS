import { useState } from "react";
import type { HrDocument } from "@phit-erp/shared";
import {
  Download,
  Eye,
  FileText,
  Replace,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { api, resolveApiUrl, resolveMediaUrl, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import {
  formatFileSize,
  getDocumentStatusBadgeClass,
  getDocumentStatusLabel,
  getHrCategoryLabel,
  HR_DOCUMENT_CATEGORIES,
  hrEntityApiBase,
  hrUploadEndpoint,
  isImageDocument,
  isPendingHrDocument,
  type HrEntityKind,
  type PendingHrDocument,
  validateHrDocumentFile,
} from "./hrDocumentUtils";

interface HrDocumentsSectionProps {
  entityKind: HrEntityKind;
  entityId?: string;
  documents: HrDocument[];
  onChange: (documents: HrDocument[]) => void;
  canManage: boolean;
  pendingDocuments?: PendingHrDocument[];
  onPendingChange?: (pending: PendingHrDocument[]) => void;
  title?: string;
  description?: string;
  onAfterMutation?: () => void | Promise<void>;
}

export const HrDocumentsSection = ({
  entityKind,
  entityId,
  documents,
  onChange,
  canManage,
  pendingDocuments = [],
  onPendingChange,
  title = "Documents",
  description = "Upload CV, degree, certificates and other documents (PDF, JPG, PNG, DOC — max 10 MB each).",
  onAfterMutation,
}: HrDocumentsSectionProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>(
    HR_DOCUMENT_CATEGORIES[0]?.key ?? "CV",
  );
  const [customName, setCustomName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const category = HR_DOCUMENT_CATEGORIES.find(
    (item) => item.key === selectedCategory,
  );
  const queuedTypes = new Set(pendingDocuments.map((item) => item.type));

  const uploadFile = async (
    file: File,
    type: string,
    name: string,
    documentId?: string,
  ) => {
    if (!entityId) return null;

    const formData = new FormData();
    formData.append("documents", file);
    formData.append("documentType", type);

    const uploadResponse = await fetch(
      resolveApiUrl(hrUploadEndpoint(entityKind)),
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

    const pendingPlaceholder = documents.find(
      (doc) =>
        doc.type === type && isPendingHrDocument(doc) && Boolean(doc._id),
    );
    const targetId = documentId ?? pendingPlaceholder?._id;
    const base = hrEntityApiBase(entityKind, entityId);

    if (targetId) {
      const result = await unwrap<{
        document: HrDocument;
        documents?: HrDocument[];
        teacher?: { documents: HrDocument[] };
        staff?: { documents: HrDocument[] };
      }>(
        api.put(`${base}/documents/replace`, {
          ...payload,
          documentId: targetId,
        }),
      );
      return (
        result.documents ??
        result.teacher?.documents ??
        result.staff?.documents ??
        documents
      );
    }

    const result = await unwrap<{
      document: HrDocument;
      documents?: HrDocument[];
      teacher?: { documents: HrDocument[] };
      staff?: { documents: HrDocument[] };
    }>(api.post(`${base}/documents`, payload));

    return (
      result.documents ??
      result.teacher?.documents ??
      result.staff?.documents ??
      documents
    );
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    replaceDocumentId?: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = validateHrDocumentFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const type = replaceDocumentId
      ? (documents.find((doc) => doc._id === replaceDocumentId)?.type ??
        selectedCategory)
      : selectedCategory;
    const categoryMeta = HR_DOCUMENT_CATEGORIES.find((item) => item.key === type);
    const name =
      categoryMeta?.allowCustomName && customName.trim()
        ? customName.trim()
        : getHrCategoryLabel(type);

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
      if (entityId) {
        const updated = await uploadFile(file, type, name, replaceDocumentId);
        if (updated) {
          onChange(updated);
          await onAfterMutation?.();
        }
        toast.success(
          replaceDocumentId ? "Document replaced" : "Document uploaded",
        );
      } else if (onPendingChange) {
        const filtered = categoryMeta?.allowMultiple
          ? pendingDocuments
          : pendingDocuments.filter((item) => item.type !== type);
        onPendingChange([
          ...filtered,
          { id: crypto.randomUUID(), type, name, file },
        ]);
        toast.success("Document queued — will upload after save");
      }
      setCustomName("");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setUploading(false);
      setReplacingId(null);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!entityId || !canManage) return;
    try {
      const result = await unwrap<{
        documents?: HrDocument[];
        teacher?: { documents: HrDocument[] };
        staff?: { documents: HrDocument[] };
      }>(
        api.delete(
          `${hrEntityApiBase(entityKind, entityId)}/documents/${documentId}`,
        ),
      );
      onChange(
        result.documents ??
          result.teacher?.documents ??
          result.staff?.documents ??
          documents,
      );
      await onAfterMutation?.();
      toast.success("Document deleted");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const handleRemovePending = (id: string) => {
    onPendingChange?.(pendingDocuments.filter((item) => item.id !== id));
  };

  const docsByCategory = (type: string) =>
    documents.filter((doc) => doc.type === type);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {description}
          {!entityId
            ? " Queued files upload after the record is saved."
            : null}
        </p>
      </div>

      {canManage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="Document Category">
            <Select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              {HR_DOCUMENT_CATEGORIES.map((item) => (
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
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                disabled={uploading}
                onChange={(event) => void handleFileSelect(event)}
              />
            </label>
          </FormField>
        </div>
      ) : null}

      {pendingDocuments.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Queued for upload</p>
          {pendingDocuments.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm"
            >
              <span>
                {item.name}{" "}
                <span className="text-slate-500">({item.file.name})</span>
              </span>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleRemovePending(item.id)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {HR_DOCUMENT_CATEGORIES.map((cat) => {
          const categoryDocs = docsByCategory(cat.key);
          const hasQueued = queuedTypes.has(cat.key);
          const realDocs = categoryDocs.filter(
            (doc) => !isPendingHrDocument(doc),
          );

          if (categoryDocs.length === 0 && !hasQueued) {
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
                {hasQueued ? (
                  <Badge className="bg-sky-100 text-sky-900">Queued</Badge>
                ) : null}
              </div>

              {realDocs.length === 0 && !hasQueued ? (
                <p className="text-sm text-slate-400">No document uploaded</p>
              ) : (
                <div className="space-y-2">
                  {realDocs.map((doc) => (
                    <DocumentRow
                      key={doc._id ?? `${doc.type}-${doc.url}`}
                      doc={doc}
                      canManage={canManage && Boolean(entityId)}
                      uploading={uploading && replacingId === doc._id}
                      onReplace={(event) =>
                        void handleFileSelect(event, doc._id)
                      }
                      onDelete={() => {
                        if (doc._id) void handleDelete(doc._id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {documents.length === 0 && pendingDocuments.length === 0 ? (
          <p className="text-sm text-slate-500">
            No documents yet. Use the uploader above to add CV, certificates,
            degree, or other files.
          </p>
        ) : null}
      </div>
    </div>
  );
};

const DocumentRow = ({
  doc,
  canManage,
  uploading,
  onReplace,
  onDelete,
}: {
  doc: HrDocument;
  canManage: boolean;
  uploading: boolean;
  onReplace: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
}) => {
  // Served at /uploads/* (authenticated), never under /api
  const url = resolveMediaUrl(doc.url) ?? "";
  const image = isImageDocument(doc.mimeType, doc.url);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {image && url ? (
          <img
            src={url}
            alt={doc.name}
            className="h-10 w-10 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-200">
            <FileText className="h-5 w-5 text-slate-600" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-slate-900">
              {doc.name || getHrCategoryLabel(doc.type)}
            </span>
            <Badge className={getDocumentStatusBadgeClass(doc.status)}>
              {getDocumentStatusLabel(doc.status)}
            </Badge>
          </div>
          <p className="truncate text-xs text-slate-500">
            {doc.originalName || "—"}
            {doc.size ? ` · ${formatFileSize(doc.size)}` : ""}
            {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {url ? (
          <>
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer" title="View in new tab">
                <Eye className="mr-1 h-3.5 w-3.5" />
                View
              </a>
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <a
                href={url}
                download={doc.originalName || doc.name || "document"}
                title="Download file"
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Download
              </a>
            </Button>
          </>
        ) : null}
        {canManage ? (
          <>
            <label className="inline-flex cursor-pointer">
              <Button type="button" size="sm" variant="outline" asChild>
                <span>
                  <Replace className="mr-1 h-3.5 w-3.5" />
                  {uploading ? "..." : "Replace"}
                </span>
              </Button>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={onReplace}
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
};
