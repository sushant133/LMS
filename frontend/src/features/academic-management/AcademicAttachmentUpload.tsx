import { useState } from "react";
import { DOCUMENT_MAX_SIZE_BYTES, type AssignmentAttachment } from "@phit-erp/shared";
import { ExternalLink, FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { resolveApiUrl } from "lib/api";
import { openAuthenticatedAttachment } from "lib/attachments";

interface AcademicAttachmentUploadProps {
  attachmentUrl?: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export const AcademicAttachmentUpload = ({
  attachmentUrl,
  onChange,
  disabled,
}: AcademicAttachmentUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [opening, setOpening] = useState(false);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0]!;
    if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
      setError("File size must be less than 600 KB");
      event.target.value = "";
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    formData.append("files", file);

    try {
      const response = await fetch(
        resolveApiUrl("/uploads/academic-management"),
        {
          method: "POST",
          body: formData,
          credentials: "include",
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      const uploaded = (body.data?.attachments ?? [])[0] as
        | AssignmentAttachment
        | undefined;
      if (!uploaded?.url) throw new Error("Upload failed");
      onChange(uploaded.url);
      setFileName(uploaded.name);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed",
      );
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleOpen = async () => {
    if (!attachmentUrl) return;
    setOpening(true);
    try {
      await openAuthenticatedAttachment(attachmentUrl, fileName || "attachment");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open attachment");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="cursor-pointer">
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          <Upload className="h-4 w-4" />
          {isUploading ? "Uploading..." : "Attach PDF / Document (max 600 KB)"}
        </div>
        <input
          type="file"
          accept=".pdf,.doc,.docx,image/*"
          className="hidden"
          disabled={disabled || isUploading}
          onChange={(e) => void handleUpload(e)}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {attachmentUrl ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-slate-50 p-3 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-slate-500" />
            <button
              type="button"
              onClick={() => void handleOpen()}
              disabled={opening}
              className="truncate text-left text-brand-700 hover:underline disabled:opacity-60"
            >
              {opening ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {fileName || "View attachment"}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </span>
              )}
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
};
