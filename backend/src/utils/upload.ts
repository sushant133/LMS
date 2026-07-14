import multer, { type StorageEngine } from "multer";
import path from "path";
import fs from "fs-extra";
import type { Request } from "express";
import { getUploadDir, isCloudinaryEnabled } from "../config/env.js";
import { ApiError } from "./apiError.js";
import {
  buildCloudinaryFolder,
  uploadLocalFileToCloudinary
} from "./cloudinary.js";
import { tenantObjectId } from "./tenant.js";

/** Configurable via UPLOAD_DIR — local staging (and fallback when Cloudinary is off). */
const UPLOAD_ROOT = getUploadDir();

// Ensure base upload directory exists (Cloudinary still stages here briefly)
fs.ensureDirSync(UPLOAD_ROOT);

/**
 * Creates tenant-scoped storage.
 * All files are stored under: uploads/{schoolId}/{entity}/{filename}
 */
function createTenantStorage(entity: string): StorageEngine {
  return multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const schoolId = tenantObjectId(req);
        const dest = path.join(UPLOAD_ROOT, schoolId.toString(), entity);
        await fs.ensureDir(dest);
        cb(null, dest);
      } catch (err) {
        cb(err as Error, "");
      }
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      // Sanitize extension: no path segments, lowercase, allowlist
      const rawExt = path.extname(file.originalname || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
      const allowedExt = new Set([
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".pdf",
        ".doc",
        ".docx",
        ".mp4",
        ".webm",
        ".mov"
      ]);
      const ext = allowedExt.has(rawExt) ? rawExt : "";
      // Never use original client filename (path traversal / executable names)
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
  });
}

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

const studentDocumentMimeTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const studentDocumentFileFilter = createFileFilter(
  studentDocumentMimeTypes,
  "Invalid file type. Allowed: PDF, JPG, JPEG, PNG"
);

const classroomMimeTypes = [
  ...allowedMimeTypes,
  "video/mp4",
  "video/webm",
  "video/quicktime"
];

function createFileFilter(mimeTypes: string[], message: string) {
  return (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (mimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, message));
    }
  };
}

const fileFilter = createFileFilter(allowedMimeTypes, "Invalid file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX");
const classroomFileFilter = createFileFilter(
  classroomMimeTypes,
  "Invalid file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, MP4, WEBM, MOV"
);

export const uploadStudentPhoto = multer({
  storage: createTenantStorage("students/photos"),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter
}).single("photo");

export const uploadStudentDocuments = multer({
  storage: createTenantStorage("students/documents"),
  limits: { fileSize: 500 * 1024 }, // 500KB per document
  fileFilter: studentDocumentFileFilter
}).array("documents", 10);

export const uploadClassroomAttachments = multer({
  storage: createTenantStorage("classroom"),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: classroomFileFilter
}).array("files", 10);

const bannerMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const bannerFileFilter = createFileFilter(bannerMimeTypes, "Invalid file type. Allowed: JPG, JPEG, PNG, WEBP");

export const uploadBannerImage = multer({
  storage: createTenantStorage("banners"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: bannerFileFilter
}).single("image");

export const uploadStaffPhoto = multer({
  storage: createTenantStorage("staff/photos"),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: bannerFileFilter
}).single("photo");

const complaintMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const complaintFileFilter = createFileFilter(complaintMimeTypes, "Invalid file type. Allowed: JPG, JPEG, PNG, WEBP, PDF");

export const uploadComplaintAttachments = multer({
  storage: createTenantStorage("complaints"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: complaintFileFilter
}).array("files", 5);

export const uploadAcademicAttachments = multer({
  storage: createTenantStorage("academic-management"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: complaintFileFilter
}).array("files", 5);

/**
 * Returns a public URL path for a stored file (relative local path).
 * Prefer finalizeUploadedFile() so Cloudinary is used when configured.
 */
export function getFilePublicPath(relativePath: string): string {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^uploads\//, "")
    // Never allow path traversal segments in public URLs
    .replace(/^(\.\.\/)+/, "")
    .replace(/\/(\.\.)(\/|$)/g, "/");
  return `/uploads/${normalized}`;
}

export function getUploadPublicUrl(filePath: string): string {
  const rootResolved = path.resolve(UPLOAD_ROOT);
  const absolute = path.resolve(filePath);
  const relativeToUploads = path.relative(rootResolved, absolute);
  // Reject files outside the upload root
  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads) ||
    relativeToUploads === ""
  ) {
    throw new ApiError(500, "Uploaded file path is outside the configured upload directory");
  }
  return getFilePublicPath(relativeToUploads);
}

export function inferAttachmentKind(mimeType: string): "FILE" | "IMAGE" | "PDF" | "VIDEO" {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "FILE";
}

export interface FinalizedUpload {
  /**
   * Images: HTTPS Cloudinary URL when Cloudinary is enabled.
   * PDFs / docs / videos: always local `/uploads/...` path.
   */
  url: string;
  size: number;
  originalName: string;
  mimeType: string;
  kind: "FILE" | "IMAGE" | "PDF" | "VIDEO";
  /** Cloudinary public_id when stored on CDN (images only). */
  publicId?: string;
  width?: number;
  height?: number;
}

/** Cloudinary is used for images only (profile photos, banners, photo attachments). */
const isImageMime = (mimeType: string): boolean => mimeType.startsWith("image/");

/**
 * Finalize a multer disk file:
 * - Images → Cloudinary (when configured)
 * - PDFs, Office docs, videos → local disk under UPLOAD_DIR
 * entityParts e.g. ["students", "photos"] → folder phit-erp/{schoolId}/students/photos
 */
export async function finalizeUploadedFile(
  req: Request,
  file: Express.Multer.File,
  ...entityParts: string[]
): Promise<FinalizedUpload> {
  const kind = inferAttachmentKind(file.mimetype);

  // Cloudinary: images only — PDFs and other files stay on the server
  if (isCloudinaryEnabled() && isImageMime(file.mimetype)) {
    const schoolId = tenantObjectId(req).toString();
    const folder = buildCloudinaryFolder(schoolId, ...entityParts);
    const uploaded = await uploadLocalFileToCloudinary(file.path, {
      folder,
      mimeType: file.mimetype,
      resourceType: "image"
    });

    return {
      url: uploaded.url,
      size: uploaded.bytes || file.size,
      originalName: file.originalname,
      mimeType: file.mimetype,
      kind,
      publicId: uploaded.publicId,
      width: uploaded.width,
      height: uploaded.height
    };
  }

  return {
    url: getUploadPublicUrl(file.path),
    size: file.size,
    originalName: file.originalname,
    mimeType: file.mimetype,
    kind
  };
}

/** Finalize many multer files in parallel. */
export async function finalizeUploadedFiles(
  req: Request,
  files: Express.Multer.File[],
  ...entityParts: string[]
): Promise<FinalizedUpload[]> {
  return Promise.all(files.map((file) => finalizeUploadedFile(req, file, ...entityParts)));
}
