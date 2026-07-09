import { useState } from "react";
import {
  STUDENT_DOCUMENT_CATEGORIES,
  type StudentDocument,
} from "@phit-erp/shared";
import { Download, Eye, FileText, Replace, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import {
  formatFileSize,
  getCategoryLabel,
  isImageDocument,
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

    if (documentId) {
      const result = await unwrap<{
        document: StudentDocument;
        student: { documents: StudentDocument[] };
      }>(
        api.put(`/students/${studentId}/documents/replace`, {
          ...payload,
          documentId,
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
        onPendingChange([
          ...pendingDocuments,
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

  const handleDelete = async (documentId: string) => {
    if (!studentId || !canManage) return;
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
    onPendingChange?.(pendingDocuments.filter((item) => item.id !== id));
  };

  const docsByCategory = (type: string) =>
    documents.filter((doc) => doc.type === type);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Documents</h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload student documents (PDF, JPG, JPEG, PNG — max 500 KB each).
          {!studentId
            ? " Documents will be uploaded after the student is saved."
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
              {STUDENT_DOCUMENT_CATEGORIES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                  {item.required ? " *" : ""}
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
          if (categoryDocs.length === 0 && !cat.required) return null;

          return (
            <div
              key={cat.key}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-800">{cat.label}</span>
                {cat.required ? (
                  <Badge className="bg-blue-100 text-blue-800">Required</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-700">
                    Optional
                  </Badge>
                )}
              </div>

              {categoryDocs.length === 0 ? (
                <p className="text-sm text-slate-400">No document uploaded</p>
              ) : (
                <div className="space-y-2">
                  {categoryDocs.map((doc) => (
                    <DocumentRow
                      key={doc._id ?? doc.url}
                      doc={doc}
                      canManage={canManage}
                      uploading={uploading && replacingId === doc._id}
                      onDelete={() => doc._id && void handleDelete(doc._id)}
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
            Pending uploads ({pendingDocuments.length})
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

const DocumentRow = ({
  doc,
  canManage,
  uploading,
  onDelete,
  onReplace,
}: DocumentRowProps) => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
    {isImageDocument(doc.mimeType, doc.url) ? (
      <img
        src={doc.url}
        alt={doc.name}
        className="h-10 w-10 rounded object-cover"
      />
    ) : (
      <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200">
        <FileText className="h-5 w-5 text-slate-600" />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="font-medium text-slate-900">{doc.name}</div>
      <div className="text-xs text-slate-500">
        {doc.originalName} · {formatFileSize(doc.size)} ·{" "}
        {new Date(doc.uploadedAt).toLocaleDateString()}
        {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
      </div>
      <Badge className="mt-1 bg-slate-100 text-slate-700">{doc.status}</Badge>
    </div>
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="sm" asChild>
        <a href={doc.url} target="_blank" rel="noreferrer">
          <Eye className="mr-1 h-3.5 w-3.5" />
          Preview
        </a>
      </Button>
      <Button type="button" variant="outline" size="sm" asChild>
        <a href={doc.url} download={doc.originalName}>
          <Download className="mr-1 h-3.5 w-3.5" />
          Download
        </a>
      </Button>
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
