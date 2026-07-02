import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Download, ExternalLink, FileText, ImageIcon } from "lucide-react";
import { Button } from "components/ui/button";
import { getAttachmentKind, resolveAttachmentUrl } from "lib/attachments";
export const AttachmentViewer = ({ attachments, title = "Materials" }) => {
    if (attachments.length === 0)
        return null;
    return (_jsxs("div", { className: "min-w-0 space-y-3", children: [_jsx("h4", { className: "text-sm font-semibold text-slate-800", children: title }), _jsx("div", { className: "space-y-4", children: attachments.map((file, index) => {
                    const url = resolveAttachmentUrl(file.url);
                    const kind = getAttachmentKind(file);
                    return (_jsxs("div", { className: "min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800", children: [kind === "IMAGE" ? _jsx(ImageIcon, { className: "h-4 w-4 shrink-0 text-emerald-600" }) : _jsx(FileText, { className: "h-4 w-4 shrink-0 text-emerald-600" }), _jsx("span", { className: "truncate", children: file.name })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { asChild: true, size: "sm", variant: "outline", children: _jsxs("a", { href: url, target: "_blank", rel: "noopener noreferrer", children: [_jsx(ExternalLink, { className: "mr-1 h-3.5 w-3.5" }), "Open"] }) }), _jsx(Button, { asChild: true, size: "sm", variant: "outline", children: _jsxs("a", { href: url, download: file.name, children: [_jsx(Download, { className: "mr-1 h-3.5 w-3.5" }), "Download"] }) })] })] }), kind === "IMAGE" ? (_jsx("a", { href: url, target: "_blank", rel: "noopener noreferrer", className: "block bg-slate-50 p-3", children: _jsx("img", { src: url, alt: file.name, className: "mx-auto max-h-80 w-full rounded-xl object-contain" }) })) : null, kind === "PDF" ? (_jsx("div", { className: "bg-slate-50 p-3", children: _jsx("iframe", { title: file.name, src: url, className: "h-80 max-w-full rounded-xl border border-slate-200 bg-white" }) })) : null, kind === "VIDEO" ? (_jsx("div", { className: "bg-slate-50 p-3", children: _jsx("video", { controls: true, className: "max-h-80 w-full rounded-xl", src: url, children: _jsx("track", { kind: "captions" }) }) })) : null] }, `${file.url}-${index}`));
                }) })] }));
};
