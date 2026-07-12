import { Download, ExternalLink, FileText, ImageIcon, Link2 } from "lucide-react";
import type { AssignmentAttachment } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import {
  canPreviewAttachmentInline,
  getAttachmentKind,
  resolveAttachmentUrl
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

export const AttachmentViewer = ({
  attachments,
  title = "Materials",
  mode = "full"
}: AttachmentViewerProps) => {
  if (attachments.length === 0) return null;

  if (mode === "compact") {
    return (
      <div className="min-w-0 space-y-2">
        {title ? <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4> : null}
        <ul className="space-y-1.5">
          {attachments.map((file, index) => {
            const url = resolveAttachmentUrl(file.url);
            const kind = getAttachmentKind(file);
            const Icon = kind === "IMAGE" ? ImageIcon : kind === "LINK" ? Link2 : FileText;

            return (
              <li key={`${file.url}-${index}`}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-brand-700 transition hover:border-brand-200 hover:bg-brand-50/50"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{file.name || "Open link"}</span>
                  <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                </a>
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
          const url = resolveAttachmentUrl(file.url);
          const kind = getAttachmentKind(file);
          const canPreview = canPreviewAttachmentInline(file);
          const Icon = kind === "IMAGE" ? ImageIcon : kind === "LINK" ? Link2 : FileText;

          return (
            <div
              key={`${file.url}-${index}`}
              className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                  <Icon className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="truncate">{file.name || (kind === "LINK" ? "Link" : "Attachment")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Open
                    </a>
                  </Button>
                  {kind !== "LINK" ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={url} download={file.name || undefined}>
                        <Download className="mr-1 h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>

              {canPreview && kind === "IMAGE" ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-slate-50 p-3"
                >
                  <img
                    src={url}
                    alt={file.name}
                    className="mx-auto max-h-80 w-full rounded-xl object-contain"
                  />
                </a>
              ) : null}

              {canPreview && kind === "PDF" ? (
                <div className="bg-slate-50 p-3">
                  <iframe
                    title={file.name || "PDF preview"}
                    src={url}
                    className="h-80 w-full max-w-full rounded-xl border border-slate-200 bg-white"
                    // No scripts: if a mistaken SPA/login URL is ever loaded, it cannot run.
                    sandbox="allow-same-origin allow-popups allow-downloads"
                  />
                </div>
              ) : null}

              {canPreview && kind === "VIDEO" ? (
                <div className="bg-slate-50 p-3">
                  <video controls className="max-h-80 w-full rounded-xl" src={url}>
                    <track kind="captions" />
                  </video>
                </div>
              ) : null}

              {!canPreview && kind === "LINK" ? (
                <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Web link — opens in a new tab (not embedded here).
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
