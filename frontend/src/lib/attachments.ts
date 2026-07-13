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
 * Fetch a protected upload with session cookies and return a blob: URL.
 * Required after /uploads was auth-gated — plain <a href> / <iframe src> often
 * fail for students (new tab without cookie context or cross-origin).
 */
export const fetchAuthenticatedBlobUrl = async (url: string): Promise<string> => {
  const resolved = resolveAttachmentUrl(url);
  if (!resolved) {
    throw new Error("Invalid file URL");
  }

  // External non-upload links: open as-is (caller may use resolved URL).
  if (!isUploadFileUrl(resolved) && /^https?:\/\//i.test(resolved)) {
    return resolved;
  }

  const response = await fetch(resolved, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "*/*",
    },
  });

  if (response.status === 401) {
    throw new Error("Please sign in again to open this file.");
  }
  if (response.status === 403) {
    throw new Error("You do not have permission to open this file.");
  }
  if (!response.ok) {
    throw new Error(`Could not open file (${response.status}).`);
  }

  const blob = await response.blob();
  // Prefer a useful MIME for PDFs when the server omits it
  const type =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : resolved.toLowerCase().includes(".pdf")
        ? "application/pdf"
        : blob.type;
  const typed = type && type !== blob.type ? new Blob([blob], { type }) : blob;
  return URL.createObjectURL(typed);
};

/** Open a protected upload in a new tab using an authenticated blob URL. */
export const openAuthenticatedAttachment = async (url: string): Promise<void> => {
  const resolved = resolveAttachmentUrl(url);
  if (!isUploadFileUrl(resolved) && !resolved.startsWith("/uploads/")) {
    window.open(resolved, "_blank", "noopener,noreferrer");
    return;
  }

  const blobUrl = await fetchAuthenticatedBlobUrl(url);
  const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    // Popup blocked — fall back to same-tab navigation
    window.location.href = blobUrl;
  }
  // Revoke later so the new tab has time to load
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};

/** Download a protected upload via authenticated fetch. */
export const downloadAuthenticatedAttachment = async (
  url: string,
  filename?: string,
): Promise<void> => {
  const resolved = resolveAttachmentUrl(url);
  if (!isUploadFileUrl(resolved) && !resolved.startsWith("/uploads/")) {
    const a = document.createElement("a");
    a.href = resolved;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (filename) a.download = filename;
    a.click();
    return;
  }

  const blobUrl = await fetchAuthenticatedBlobUrl(url);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename?.trim() || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
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
