import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Upload, X, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "components/ui/button";
export function FileUpload({ label = "Upload File", accept = "image/*,.pdf,.doc,.docx", multiple = false, maxFiles = 6, onUploadComplete, uploadUrl, headers = {}, disabled = false }) {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [error, setError] = useState(null);
    const handleFileChange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0)
            return;
        setError(null);
        setIsUploading(true);
        const formData = new FormData();
        Array.from(files).slice(0, maxFiles).forEach((file) => {
            formData.append(multiple ? "documents" : "photo", file);
        });
        try {
            const res = await fetch(uploadUrl, {
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
            const newFiles = multiple
                ? data.data?.documents || []
                : [data.data];
            const updated = [...uploadedFiles, ...newFiles].slice(0, maxFiles);
            setUploadedFiles(updated);
            onUploadComplete(updated);
        }
        catch (err) {
            setError(err.message || "Upload failed. Please try again.");
        }
        finally {
            setIsUploading(false);
            // Reset input
            e.target.value = "";
        }
    };
    const removeFile = (index) => {
        const updated = uploadedFiles.filter((_, i) => i !== index);
        setUploadedFiles(updated);
        onUploadComplete(updated);
    };
    return (_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: label }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("label", { className: "cursor-pointer", children: [_jsxs("div", { className: "flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50", children: [_jsx(Upload, { className: "h-4 w-4" }), isUploading ? "Uploading..." : label] }), _jsx("input", { type: "file", accept: accept, multiple: multiple, onChange: handleFileChange, disabled: disabled || isUploading, className: "hidden" })] }), uploadedFiles.length > 0 && (_jsxs("span", { className: "text-xs text-emerald-600", children: [uploadedFiles.length, " file(s) uploaded"] }))] }), error && _jsx("p", { className: "text-sm text-red-600", children: error }), uploadedFiles.length > 0 && (_jsx("div", { className: "space-y-2 rounded-xl border bg-slate-50 p-3", children: uploadedFiles.map((file, index) => (_jsxs("div", { className: "flex items-center justify-between gap-2 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2 truncate", children: [file.url.match(/\.(jpg|jpeg|png|webp)$/i) ? (_jsx(ImageIcon, { className: "h-4 w-4 text-slate-500" })) : (_jsx(FileText, { className: "h-4 w-4 text-slate-500" })), _jsx("a", { href: file.url, target: "_blank", rel: "noopener noreferrer", className: "truncate text-emerald-700 hover:underline", children: file.originalName })] }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => removeFile(index), className: "h-6 w-6 p-0 text-slate-500 hover:text-red-600", children: _jsx(X, { className: "h-3.5 w-3.5" }) })] }, index))) }))] }));
}
