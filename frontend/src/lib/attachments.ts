import type { AssignmentAttachment } from "@phit-erp/shared";
import { getApiBaseUrl } from "./api";

/** Resolve static upload URLs (/uploads/...) for cross-origin production backends. */
export const resolveAttachmentUrl = (url: string): string => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;

  if (url.startsWith("/")) {
    const apiBase = getApiBaseUrl();
    if (apiBase.startsWith("http")) {
      const origin = apiBase.replace(/\/api\/?$/, "");
      return `${origin}${url}`;
    }
    return url;
  }

  return `/uploads/${url.replace(/^uploads\//, "")}`;
};

export const getAttachmentKind = (file: AssignmentAttachment): "IMAGE" | "PDF" | "VIDEO" | "FILE" => {
  if (file.kind === "IMAGE" || file.kind === "PDF" || file.kind === "VIDEO") {
    return file.kind;
  }

  const mime = file.mimeType?.toLowerCase() ?? "";
  const name = file.name.toLowerCase();

  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)) return "IMAGE";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(name)) return "VIDEO";
  return "FILE";
};