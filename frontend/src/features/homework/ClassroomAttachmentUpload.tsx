import { useState } from "react";
import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import type { AssignmentAttachment } from "@nepal-school-erp/shared";
import { Button } from "components/ui/button";
import { resolveApiUrl } from "lib/api";

interface ClassroomAttachmentUploadProps {
  attachments: AssignmentAttachment[];
  onChange: (attachments: AssignmentAttachment[]) => void;
  disabled?: boolean;
}

export const ClassroomAttachmentUpload = ({ attachments, onChange, disabled }: ClassroomAttachmentUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(resolveApiUrl("/api/uploads/classroom"), {
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
      <label className="cursor-pointer">
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          <Upload className="h-4 w-4" />
          {isUploading ? "Uploading..." : "Attach files"}
        </div>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,video/mp4,video/webm,video/quicktime"
          className="hidden"
          disabled={disabled || isUploading}
          onChange={handleUpload}
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {attachments.length > 0 ? (
        <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
          {attachments.map((file, index) => (
            <div key={`${file.url}-${index}`} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                {file.kind === "IMAGE" || file.url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-slate-500" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                <a href={file.url} target="_blank" rel="noopener noreferrer" className="truncate text-emerald-700 hover:underline">
                  {file.name}
                </a>
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