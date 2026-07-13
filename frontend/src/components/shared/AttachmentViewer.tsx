import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, ImageIcon, Link2, Loader2 } from "lucide-react";
import type { AssignmentAttachment } from "@phit-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import {
  canPreviewAttachmentInline,
  downloadAuthenticatedAttachment,
  fetchAuthenticatedBlobUrl,
  getAttachmentKind,
  isUploadFileUrl,
  openAuthenticatedAttachment,
  resolveAttachmentUrl,
} from "lib/attachments";

interface AttachmentViewerProps {
  attachments: AssignmentAttachment[];
  title?: string;
  /**
   * `full` — open/download + inline image/pdf/video when safe.
   * `compact` — name + open link only (for list cards; avoids huge iframes / login embeds).
   */
  mode?: "full" | "compact";
}

const PreviewMedia = ({
  file,
  kind,
}: {
  file: AssignmentAttachment;
  kind: ReturnType<typeof getAttachmentKind>;
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolved = resolveAttachmentUrl(file.url);
        // Protected LMS uploads need credentials; external media can load directly
        if (isUploadFileUrl(resolved) || resolved.startsWith("/uploads/")) {
          const url = await fetchAuthenticatedBlobUrl(file.url);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          revoked = url;
          setBlobUrl(url);
        } else {
          setBlobUrl(resolved);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load preview");
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
  }, [file.url]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 bg-slate-50 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading preview…
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
        {error ?? "Preview unavailable. Use Open or Download."}
      </div>
    );
  }

  if (kind === "IMAGE") {
    return (
      <div className="bg-slate-50 p-3">
        <img
          src={blobUrl}
          alt={file.name}
          className="mx-auto max-h-80 w-full rounded-xl object-contain"
        />
      </div>
    );
  }

  if (kind === "PDF") {
    return (
      <div className="bg-slate-50 p-3">
        <iframe
          title={file.name || "PDF preview"}
          src={blobUrl}
          className="h-80 w-full max-w-full rounded-xl border border-slate-200 bg-white"
        />
      </div>
    );
  }

  if (kind === "VIDEO") {
    return (
      <div className="bg-slate-50 p-3">
        <video controls className="max-h-80 w-full rounded-xl" src={blobUrl}>
          <track kind="captions" />
        </video>
      </div>
    );
  }

  return null;
};

export const AttachmentViewer = ({
  attachments,
  title = "Materials",
  mode = "full",
}: AttachmentViewerProps) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const runOpen = async (file: AssignmentAttachment, key: string) => {
    setBusyKey(key);
    try {
      const kind = getAttachmentKind(file);
      if (kind === "LINK") {
        window.open(resolveAttachmentUrl(file.url), "_blank", "noopener,noreferrer");
        return;
      }
      await openAuthenticatedAttachment(file.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open file");
    } finally {
      setBusyKey(null);
    }
  };

  const runDownload = async (file: AssignmentAttachment, key: string) => {
    setBusyKey(key);
    try {
      await downloadAuthenticatedAttachment(file.url, file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download file");
    } finally {
      setBusyKey(null);
    }
  };

  if (mode === "compact") {
    return (
      <div className="min-w-0 space-y-2">
        {title ? (
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </h4>
        ) : null}
        <ul className="space-y-1.5">
          {attachments.map((file, index) => {
            const kind = getAttachmentKind(file);
            const Icon =
              kind === "IMAGE" ? ImageIcon : kind === "LINK" ? Link2 : FileText;
            const key = `c-${file.url}-${index}`;

            return (
              <li key={key}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm text-brand-700 transition hover:border-brand-200 hover:bg-brand-50/50 disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    void runOpen(file, key);
                  }}
                  disabled={busyKey === key}
                >
                  {busyKey === key ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate">{file.name || "Open link"}</span>
                  <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <div className="space-y-4">
        {attachments.map((file, index) => {
          const kind = getAttachmentKind(file);
          const canPreview = canPreviewAttachmentInline(file);
          const Icon =
            kind === "IMAGE" ? ImageIcon : kind === "LINK" ? Link2 : FileText;
          const openKey = `o-${file.url}-${index}`;
          const dlKey = `d-${file.url}-${index}`;

          return (
            <div
              key={`${file.url}-${index}`}
              className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                  <Icon className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="truncate">
                    {file.name || (kind === "LINK" ? "Link" : "Attachment")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={busyKey === openKey}
                    onClick={() => void runOpen(file, openKey)}
                  >
                    {busyKey === openKey ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    )}
                    Open
                  </Button>
                  {kind !== "LINK" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busyKey === dlKey}
                      onClick={() => void runDownload(file, dlKey)}
                    >
                      {busyKey === dlKey ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3.5 w-3.5" />
                      )}
                      Download
                    </Button>
                  ) : null}
                </div>
              </div>

              {canPreview &&
              (kind === "IMAGE" || kind === "PDF" || kind === "VIDEO") ? (
                <PreviewMedia file={file} kind={kind} />
              ) : null}

              {!canPreview && kind === "LINK" ? (
                <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Web link — opens in a new tab (not embedded here).
                </div>
              ) : null}

              {!canPreview && kind === "FILE" ? (
                <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Use Open or Download to view this file.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
