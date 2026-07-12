import type { AssignmentAttachment, AssignmentAttachmentKind } from "@phit-erp/shared";
import { getApiBaseUrl } from "./api";

export type AttachmentDisplayKind = AssignmentAttachmentKind | "IMAGE" | "PDF" | "VIDEO" | "FILE" | "LINK";

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

const pathFromUrl = (url: string): string => {
  try {
    return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname;
  } catch {
    return url;
  }
};

/** True when the URL points at a stored upload file path. */
export const isUploadFileUrl = (url: string): boolean => {
  const path = pathFromUrl(url);
  return path.startsWith("/uploads/");
};

/**
 * True when the URL is likely an HTML app page (LMS routes, login, dashboards, etc.).
 * Embedding these in an iframe shows the SPA — often the login page — inside class notes.
 */
export const isLikelyAppPageUrl = (url: string): boolean => {
  if (!url) return false;

  try {
    const resolved = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const path = resolved.pathname;

    // Real uploaded files are never SPA pages.
    if (path.startsWith("/uploads/")) {
      return false;
    }

    // File-like paths with a media extension are fine.
    if (/\.(png|jpe?g|gif|webp|pdf|mp4|webm|mov|docx?|xlsx?|pptx?|zip|txt)$/i.test(path)) {
      return false;
    }

    // Same-origin non-upload routes are always the SPA (/, /login, /dashboard/..., etc.).
    if (typeof window !== "undefined" && resolved.origin === window.location.origin) {
      return true;
    }

    // External URL with no file extension → treat as a webpage link, not a file preview.
    if (!/\.[a-z0-9]{2,5}$/i.test(path) || path === "/" || path.endsWith("/")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
};

export const getAttachmentKind = (file: AssignmentAttachment): AttachmentDisplayKind => {
  if (file.kind === "LINK") return "LINK";
  if (file.kind === "IMAGE" || file.kind === "PDF" || file.kind === "VIDEO") {
    // Trust declared kind only when the URL still looks like a real file/upload.
    const resolved = resolveAttachmentUrl(file.url);
    if (!isLikelyAppPageUrl(resolved)) {
      return file.kind;
    }
    return "LINK";
  }

  const mime = file.mimeType?.toLowerCase() ?? "";
  const name = file.name.toLowerCase();
  const resolved = resolveAttachmentUrl(file.url);

  if (mime.startsWith("text/html") || isLikelyAppPageUrl(resolved)) {
    return "LINK";
  }

  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name) || /\.(png|jpe?g|gif|webp)$/i.test(resolved)) {
    return "IMAGE";
  }
  if (mime === "application/pdf" || name.endsWith(".pdf") || /\.pdf($|\?)/i.test(resolved)) {
    return "PDF";
  }
  if (mime.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(name) || /\.(mp4|webm|mov)($|\?)/i.test(resolved)) {
    return "VIDEO";
  }
  return "FILE";
};

/**
 * Whether it is safe to render an inline preview (img / pdf iframe / video).
 * Never embed app pages — that is what caused the login UI inside Class Notes.
 */
export const canPreviewAttachmentInline = (file: AssignmentAttachment): boolean => {
  const url = resolveAttachmentUrl(file.url);
  if (!url || isLikelyAppPageUrl(url)) {
    return false;
  }

  const kind = getAttachmentKind(file);
  if (kind === "LINK" || kind === "FILE") {
    return false;
  }

  // Prefer previews for known upload files; still allow absolute media URLs with clear extensions.
  if (isUploadFileUrl(url)) {
    return kind === "IMAGE" || kind === "PDF" || kind === "VIDEO";
  }

  return kind === "IMAGE" || kind === "PDF" || kind === "VIDEO";
};
