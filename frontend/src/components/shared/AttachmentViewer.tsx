import { Download, ExternalLink, FileText, ImageIcon } from "lucide-react";
import type { AssignmentAttachment } from "@nepal-school-erp/shared";
import { Button } from "components/ui/button";
import { getAttachmentKind, resolveAttachmentUrl } from "lib/attachments";

interface AttachmentViewerProps {
  attachments: AssignmentAttachment[];
  title?: string;
}

export const AttachmentViewer = ({ attachments, title = "Materials" }: AttachmentViewerProps) => {
  if (attachments.length === 0) return null;

  return (
    <div className="min-w-0 space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <div className="space-y-4">
        {attachments.map((file, index) => {
          const url = resolveAttachmentUrl(file.url);
          const kind = getAttachmentKind(file);

          return (
            <div key={`${file.url}-${index}`} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                  {kind === "IMAGE" ? <ImageIcon className="h-4 w-4 shrink-0 text-emerald-600" /> : <FileText className="h-4 w-4 shrink-0 text-emerald-600" />}
                  <span className="truncate">{file.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Open
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={url} download={file.name}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>

              {kind === "IMAGE" ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="block bg-slate-50 p-3">
                  <img src={url} alt={file.name} className="mx-auto max-h-80 w-full rounded-xl object-contain" />
                </a>
              ) : null}

              {kind === "PDF" ? (
                <div className="bg-slate-50 p-3">
                  <iframe title={file.name} src={url} className="h-80 max-w-full rounded-xl border border-slate-200 bg-white" />
                </div>
              ) : null}

              {kind === "VIDEO" ? (
                <div className="bg-slate-50 p-3">
                  <video controls className="max-h-80 w-full rounded-xl" src={url}>
                    <track kind="captions" />
                  </video>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};