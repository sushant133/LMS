import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { Button } from "components/ui/button";
import { resolveApiUrl } from "lib/api";
export const ClassroomAttachmentUpload = ({ attachments, onChange, disabled }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState(null);
    const handleUpload = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0)
            return;
        setError(null);
        setIsUploading(true);
        const formData = new FormData();
        Array.from(files).forEach((file) => formData.append("files", file));
        try {
            const response = await fetch(resolveApiUrl("/uploads/classroom"), {
                method: "POST",
                body: formData,
                credentials: "include"
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.message ?? "Upload failed");
            }
            const body = await response.json();
            const uploaded = (body.data?.attachments ?? []);
            onChange([...attachments, ...uploaded]);
        }
        catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
        }
        finally {
            setIsUploading(false);
            event.target.value = "";
        }
    };
    const removeAttachment = (index) => {
        onChange(attachments.filter((_, i) => i !== index));
    };
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("label", { className: "cursor-pointer", children: [_jsxs("div", { className: "inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50", children: [_jsx(Upload, { className: "h-4 w-4" }), isUploading ? "Uploading..." : "Attach files"] }), _jsx("input", { type: "file", multiple: true, accept: "image/*,.pdf,.doc,.docx,video/mp4,video/webm,video/quicktime", className: "hidden", disabled: disabled || isUploading, onChange: handleUpload })] }), error ? _jsx("p", { className: "text-sm text-red-600", children: error }) : null, attachments.length > 0 ? (_jsx("div", { className: "space-y-2 rounded-xl border bg-slate-50 p-3", children: attachments.map((file, index) => (_jsxs("div", { className: "flex items-center justify-between gap-2 text-sm", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [file.kind === "IMAGE" || file.url.match(/\.(jpg|jpeg|png|webp)$/i) ? (_jsx(ImageIcon, { className: "h-4 w-4 shrink-0 text-slate-500" })) : (_jsx(FileText, { className: "h-4 w-4 shrink-0 text-slate-500" })), _jsx("a", { href: file.url, target: "_blank", rel: "noopener noreferrer", className: "truncate text-emerald-700 hover:underline", children: file.name })] }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", className: "h-6 w-6 p-0", onClick: () => removeAttachment(index), children: _jsx(X, { className: "h-3.5 w-3.5" }) })] }, `${file.url}-${index}`))) })) : null] }));
};
