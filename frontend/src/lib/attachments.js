const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
export const resolveAttachmentUrl = (url) => {
    if (!url)
        return "";
    if (/^https?:\/\//i.test(url))
        return url;
    if (url.startsWith("/")) {
        if (apiBase && !apiBase.startsWith("/")) {
            return `${apiBase.replace(/\/api\/?$/, "")}${url}`;
        }
        return url;
    }
    return `/uploads/${url.replace(/^uploads\//, "")}`;
};
export const getAttachmentKind = (file) => {
    if (file.kind === "IMAGE" || file.kind === "PDF" || file.kind === "VIDEO") {
        return file.kind;
    }
    const mime = file.mimeType?.toLowerCase() ?? "";
    const name = file.name.toLowerCase();
    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name))
        return "IMAGE";
    if (mime === "application/pdf" || name.endsWith(".pdf"))
        return "PDF";
    if (mime.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(name))
        return "VIDEO";
    return "FILE";
};
