import { useState } from "react";
import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import type { AssignmentAttachment } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import { resolveApiUrl } from "lib/api";

interface ComplaintAttachmentUploadProps {
  attachments: AssignmentAttachment[];
  onChange: (attachments: AssignmentAttachment[]) => void;
  disabled?: boolean;
}

export const ComplaintAttachmentUpload = ({ attachments, onChange, disabled }: ComplaintAttachmentUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (attachments.length + files.length > 5) {
      setError("You can attach up to 5 files.");
      event.target.value = "";
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(resolveApiUrl("/uploads/complaints"), {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      const uploaded = (body.data?.attachments ?? []) as AssignmentAttachment[];
      onChange([...attachments, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    onChange(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Attach images or PDFs as supporting evidence (max 5 files, 10 MB each).</p>
      <label className="cursor-pointer">
        <div className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 hover:border-brand-400 hover:bg-brand-50/50">
          <Upload className="h-4 w-4" />
          {isUploading ? "Uploading..." : "Attach files"}
        </div>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
          className="hidden"
          disabled={disabled || isUploading || attachments.length >= 5}
          onChange={handleUpload}
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {attachments.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {attachments.map((file, index) => (
            <div key={`${file.url}-${index}`} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                {file.kind === "IMAGE" || file.kind === "PDF" ? (
                  file.kind === "IMAGE" ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-brand-600" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-brand-600" />
                  )
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                <span className="truncate text-slate-700">{file.name}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeAttachment(index)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};