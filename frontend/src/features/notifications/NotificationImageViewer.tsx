import { Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { resolveMediaUrl } from "lib/api";
import { downloadAuthenticatedAttachment } from "lib/attachments";

interface NotificationImageViewerProps {
  imageUrl: string;
  title: string;
  onClose: () => void;
}

const fileNameFor = (title: string, url: string): string => {
  const fromUrl = (url.split(/[?#]/)[0] ?? "").split("/").pop() ?? "";
  if (/\.[a-z0-9]{2,5}$/i.test(fromUrl)) return fromUrl;
  return title.trim() || "notification-image";
};

/** Full-screen preview of a notification's image with Cancel and Download. */
export const NotificationImageViewer = ({
  imageUrl,
  title,
  onClose,
}: NotificationImageViewerProps) => {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadAuthenticatedAttachment(imageUrl, fileNameFor(title, imageUrl));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download image");
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-[2px] animate-[fadeIn_0.2s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <p className="min-w-0 truncate font-semibold text-slate-900">{title}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close image"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
          <img
            src={resolveMediaUrl(imageUrl)}
            alt={title}
            className="max-h-[70vh] w-full object-contain"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
