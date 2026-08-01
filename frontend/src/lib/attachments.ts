import type { AssignmentAttachment, AssignmentAttachmentKind } from "@phit-erp/shared";
// Import from config only — avoid circular import with ./api (axios + attachments consumers)
import { getApiBaseUrl } from "./config";

export type AttachmentDisplayKind = AssignmentAttachmentKind | "IMAGE" | "PDF" | "VIDEO" | "FILE" | "LINK";

/**
 * Resolve stored upload paths for fetch/open.
 *
 * MongoDB stores: `/uploads/{schoolId}/students/documents/file.pdf`
 * Serving is authenticated on the API host:
 *   - preferred (same reverse-proxy as API): `/api/uploads/{schoolId}/...`
 *   - legacy direct: `/uploads/{schoolId}/...`
 *
 * Production Nginx often only proxies `/api` → Node. Using `/api/uploads` avoids 404s
 * from the static frontend host.
 */
export const resolveAttachmentUrl = (url: string): string => {
  if (!url) return "";
  let path = url.trim();
  if (!path) return "";

  // Accidental double api prefix
  if (path.startsWith("/api/api/")) {
    path = path.replace(/^\/api/, "");
  }

  // Already absolute
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      // Normalize absolute URLs that hit the site origin /uploads → /api/uploads
      if (u.pathname.startsWith("/uploads/") && !u.pathname.startsWith("/api/uploads/")) {
        const apiBase = getApiBaseUrl();
        if (apiBase.startsWith("http")) {
          const apiOrigin = apiBase.replace(/\/api\/?$/, "");
          return `${apiOrigin}/api${u.pathname}${u.search}`;
        }
        if (typeof window !== "undefined" && u.origin === window.location.origin) {
          return `/api${u.pathname}${u.search}`;
        }
      }
      // Absolute already under /api/uploads on API host
      return path;
    } catch {
      return path;
    }
  }

  // Strip leading /api/uploads or /uploads to a canonical /uploads/... path first
  if (path.startsWith("/api/uploads/")) {
    path = path.slice(4); // → /uploads/...
  } else if (path.startsWith("api/uploads/")) {
    path = `/${path.slice(3)}`;
  } else if (!path.startsWith("/")) {
    path = path.startsWith("uploads/") ? `/${path}` : `/uploads/${path}`;
  }

  // Canonical storage path must start with /uploads/
  if (!path.startsWith("/uploads/")) {
    return path;
  }

  const apiBase = getApiBaseUrl();

  // Absolute API host: https://api.example.com/api → https://api.example.com/api/uploads/...
  if (apiBase.startsWith("http")) {
    const base = apiBase.replace(/\/$/, "");
    // base ends with /api
    if (base.endsWith("/api")) {
      return `${base}${path}`; // /api + /uploads/... = /api/uploads/...
    }
    // bare API origin without /api suffix
    return `${base}/api${path}`;
  }

  // Same-origin relative API base (/api)
  return `/api${path}`;
};

/** Alternate URL to try if the preferred path 404s (legacy direct /uploads). */
export const resolveAttachmentUrlLegacy = (url: string): string => {
  const preferred = resolveAttachmentUrl(url);
  if (!preferred) return "";
  // /api/uploads/... → /uploads/...
  if (preferred.includes("/api/uploads/")) {
    return preferred.replace("/api/uploads/", "/uploads/");
  }
  // absolute .../api/uploads/ → .../uploads/
  return preferred.replace(/\/api\/uploads\//, "/uploads/");
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
  return (
    path.startsWith("/uploads/") ||
    path.startsWith("/api/uploads/") ||
    /\/uploads\//.test(path)
  );
};

/**
 * Fetch a protected upload with session cookies and return a blob: URL.
 * Required after /uploads was auth-gated — plain <a href> / <iframe src> often
 * fail for students (new tab without cookie context or cross-origin).
 */
const fetchUploadWithAuth = async (resolved: string): Promise<Response> =>
  fetch(resolved, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "*/*",
    },
  });

export const fetchAuthenticatedBlobUrl = async (url: string): Promise<string> => {
  const resolved = resolveAttachmentUrl(url);
  if (!resolved) {
    throw new Error("Invalid file URL");
  }

  // External non-upload links (CDN etc.): open as-is
  const looksLikeUpload =
    isUploadFileUrl(resolved) ||
    resolved.includes("/uploads/") ||
    resolved.includes("/api/uploads/");
  if (!looksLikeUpload && /^https?:\/\//i.test(resolved)) {
    return resolved;
  }

  let response = await fetchUploadWithAuth(resolved);

  // Fallback: try legacy /uploads path if /api/uploads 404s (or reverse)
  if (response.status === 404) {
    const legacy = resolveAttachmentUrlLegacy(url);
    if (legacy && legacy !== resolved) {
      response = await fetchUploadWithAuth(legacy);
    }
  }

  if (response.status === 401) {
    throw new Error("Please sign in again to open this file.");
  }
  if (response.status === 403) {
    throw new Error("You do not have permission to open this file.");
  }
  if (response.status === 404) {
    throw new Error(
      "File not found on the server (404). The document may have been deleted or never saved correctly. Try re-uploading.",
    );
  }
  if (!response.ok) {
    throw new Error(`Could not open file (${response.status}).`);
  }

  // Reject HTML error pages (SPA index.html served as 200 for unknown paths)
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "File route is not reaching the API. Ensure the server proxies /api (and /uploads) to the backend.",
    );
  }

  const blob = await response.blob();
  // Prefer a useful MIME for PDFs when the server omits it
  const type =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : resolved.toLowerCase().includes(".pdf") || url.toLowerCase().includes(".pdf")
        ? "application/pdf"
        : blob.type;
  const typed = type && type !== blob.type ? new Blob([blob], { type }) : blob;
  return URL.createObjectURL(typed);
};

const isProtectedUploadPath = (url: string): boolean => {
  if (!url) return false;
  if (isUploadFileUrl(url)) return true;
  return (
    url.includes("/uploads/") ||
    url.includes("/api/uploads/") ||
    url.startsWith("/uploads/") ||
    url.startsWith("/api/uploads/")
  );
};

/** Open a protected upload in a new tab using an authenticated blob URL. */
export const openAuthenticatedAttachment = async (url: string): Promise<void> => {
  if (!url?.trim()) {
    throw new Error("No file URL provided");
  }
  const resolved = resolveAttachmentUrl(url);
  if (!isProtectedUploadPath(resolved) && !isProtectedUploadPath(url)) {
    window.open(resolved || url, "_blank", "noopener,noreferrer");
    return;
  }

  const blobUrl = await fetchAuthenticatedBlobUrl(url);
  const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    // Popup blocked — force download instead of navigating away from the app
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "document";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke later so the new tab has time to load
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};

/** Download a protected upload via authenticated fetch. */
export const downloadAuthenticatedAttachment = async (
  url: string,
  filename?: string,
): Promise<void> => {
  if (!url?.trim()) {
    throw new Error("No file URL provided");
  }
  const resolved = resolveAttachmentUrl(url);
  if (!isProtectedUploadPath(resolved) && !isProtectedUploadPath(url)) {
    const a = document.createElement("a");
    a.href = resolved || url;
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
  a.rel = "noopener";
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

    // Real uploaded files are never SPA pages (including /api/uploads reverse-proxy path).
    if (path.startsWith("/uploads/") || path.startsWith("/api/uploads/")) {
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
  if (!file?.url) return "FILE";
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
  const name = (file.name ?? "").toLowerCase();
  const resolved = resolveAttachmentUrl(file.url || "");

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
