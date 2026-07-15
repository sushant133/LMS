import path from "path";
import { ApiError } from "../../utils/apiError.js";

/** Image formats required by the centralized storage policy. */
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

/** Document formats required by the centralized storage policy. */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed"
] as const;

/** Video formats kept for assignment / classroom attachments (existing feature). */
export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime"
] as const;

export const STANDARD_MIME_TYPES = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES] as const;

export const ASSIGNMENT_MIME_TYPES = [
  ...STANDARD_MIME_TYPES,
  ...VIDEO_MIME_TYPES
] as const;

export const STUDENT_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf"
] as const;

export const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".zip",
  // Assignment / classroom video (existing feature)
  ".mp4",
  ".webm",
  ".mov"
]);

/** Normalize browser quirks before allowlist checks. */
export const normalizeMimeType = (mimeType: string): string => {
  const lower = (mimeType || "").toLowerCase().trim();
  if (lower === "image/jpg") return "image/jpeg";
  if (lower === "image/pjpeg") return "image/jpeg";
  if (lower === "image/x-png") return "image/png";
  if (lower === "application/x-zip") return "application/zip";
  return lower;
};

/**
 * Sanitize and allowlist the file extension from the client original name.
 * Returns "" when the extension is unknown (unique name still generated).
 */
export const sanitizeExtension = (originalName: string): string => {
  const rawExt = path
    .extname(originalName || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  return ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : "";
};

/** Extension preferred when MIME is known but original name has no safe extension. */
export const extensionFromMime = (mimeType: string): string => {
  const mime = normalizeMimeType(mimeType);
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov"
  };
  return map[mime] ?? "";
};

export type AttachmentKind = "FILE" | "IMAGE" | "PDF" | "VIDEO";

export const inferAttachmentKind = (mimeType: string): AttachmentKind => {
  const mime = normalizeMimeType(mimeType);
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("video/")) return "VIDEO";
  return "FILE";
};

export const assertMimeAllowed = (
  mimeType: string,
  allowed: readonly string[],
  message: string
): string => {
  const mime = normalizeMimeType(mimeType);
  if (allowed.map((m) => m.toLowerCase()).includes(mime)) {
    return mime;
  }
  if (mime === "image/heic" || mime === "image/heif") {
    throw new ApiError(
      400,
      "HEIC/HEIF photos are not supported. Please convert to JPG or PNG and try again."
    );
  }
  throw new ApiError(400, `${message} (received: ${mimeType || "unknown"})`);
};
