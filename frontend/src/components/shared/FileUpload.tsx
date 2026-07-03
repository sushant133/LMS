import { useState } from "react";
import { Upload, X, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "components/ui/button";
import { resolveApiUrl } from "lib/api";

interface UploadedFile {
  url: string;
  originalName: string;
  type?: string;
}

interface FileUploadProps {
  label?: string;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  onUploadComplete: (files: UploadedFile[]) => void;
  uploadUrl: string; // e.g. /uploads/students/xxx/photo (relative to API base)
  headers?: Record<string, string>;
  disabled?: boolean;
}

export function FileUpload({
  label = "Upload File",
  accept = "image/*,.pdf,.doc,.docx",
  multiple = false,
  maxFiles = 6,
  onUploadComplete,
  uploadUrl,
  headers = {},
  disabled = false
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setIsUploading(true);

    const formData = new FormData();
    Array.from(files).slice(0, maxFiles).forEach((file) => {
      formData.append(multiple ? "documents" : "photo", file);
    });

    try {
      const res = await fetch(resolveApiUrl(uploadUrl), {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: {
          ...headers
        }
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }

      const data = await res.json();
      const newFiles: UploadedFile[] = multiple
        ? data.data?.documents || []
        : [data.data];

      const updated = [...uploadedFiles, ...newFiles].slice(0, maxFiles);
      setUploadedFiles(updated);
      onUploadComplete(updated);
    } catch (err: any) {
      setError(err.message || "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = "";
    }
  };

  const removeFile = (index: number) => {
    const updated = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(updated);
    onUploadComplete(updated);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">{label}</label>

      <div className="flex items-center gap-3">
        <label className="cursor-pointer">
          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            <Upload className="h-4 w-4" />
            {isUploading ? "Uploading..." : label}
          </div>
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleFileChange}
            disabled={disabled || isUploading}
            className="hidden"
          />
        </label>

        {uploadedFiles.length > 0 && (
          <span className="text-xs text-emerald-600">
            {uploadedFiles.length} file(s) uploaded
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {uploadedFiles.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
          {uploadedFiles.map((file, index) => (
            <div key={index} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 truncate">
                {file.url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                  <ImageIcon className="h-4 w-4 text-slate-500" />
                ) : (
                  <FileText className="h-4 w-4 text-slate-500" />
                )}
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-emerald-700 hover:underline"
                >
                  {file.originalName}
                </a>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFile(index)}
                className="h-6 w-6 p-0 text-slate-500 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
