/**
 * Upload facade — delegates to the centralized VPS file storage service.
 *
 * All new uploads are stored on the local/VPS filesystem under UPLOAD_DIR.
 * MongoDB receives only relative paths and metadata (never binary data).
 *
 * Existing import sites can keep using this module; implementation lives in
 * `services/fileStorage`.
 */

import type { Request } from "express";
import {
  finalizeLocalUpload,
  finalizeLocalUploads,
  inferAttachmentKind,
  toPublicRelativePath,
  UPLOAD_MODULES,
  type FileStorageMeta,
  type FinalizeUploadOptions
} from "../services/fileStorage/index.js";

// ─── Multer middlewares (module-scoped) ─────────────────────────────────────
export {
  uploadStudentPhoto,
  uploadStudentDocuments,
  uploadTeacherPhoto,
  uploadStaffPhoto,
  uploadTeacherDocuments,
  uploadLibraryBookCover,
  uploadLibraryEbook,
  uploadLibraryDocuments,
  uploadNoticeImage,
  uploadBannerImage,
  uploadAssignmentAttachments,
  uploadClassroomAttachments,
  uploadResultsAttachments,
  uploadLaboratoryAttachments,
  uploadInventoryAttachments,
  uploadAccountingAttachments,
  uploadProfilePhoto,
  uploadComplaintAttachments,
  uploadAcademicAttachments,
  uploadTempFiles
} from "../services/fileStorage/index.js";

export { UPLOAD_MODULES };

/**
 * Returns a public URL path for a stored file (relative local path).
 * Prefer finalizeUploadedFile() for full metadata.
 */
export function getFilePublicPath(relativePath: string): string {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^uploads\//, "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/\/(\.\.)(\/|$)/g, "/");
  return `/uploads/${normalized}`;
}

export function getUploadPublicUrl(filePath: string): string {
  return toPublicRelativePath(filePath);
}

export { inferAttachmentKind };

/**
 * Finalized upload shape returned to controllers / API responses.
 * `url` is always a relative `/uploads/...` path (never an absolute filesystem path).
 */
export type FinalizedUpload = FileStorageMeta & {
  /** @deprecated Cloudinary no longer used for new uploads; kept optional for API shape. */
  publicId?: string;
};

/**
 * Finalize a multer disk file into MongoDB-safe metadata.
 * Always stores on VPS/local disk under UPLOAD_DIR — never Cloudinary, never MongoDB binary.
 *
 * @param entityParts e.g. ["students", "photos"] or ["assignments"]
 */
export async function finalizeUploadedFile(
  req: Request,
  file: Express.Multer.File,
  ...entityParts: string[]
): Promise<FinalizedUpload> {
  const options: FinalizeUploadOptions = {
    entityId:
      typeof req.params.studentId === "string"
        ? req.params.studentId
        : typeof req.params.id === "string"
          ? req.params.id
          : undefined
  };
  return finalizeLocalUpload(req, file, entityParts, options);
}

/** Finalize many multer files in parallel. */
export async function finalizeUploadedFiles(
  req: Request,
  files: Express.Multer.File[],
  ...entityParts: string[]
): Promise<FinalizedUpload[]> {
  const options: FinalizeUploadOptions = {
    entityId:
      typeof req.params.studentId === "string"
        ? req.params.studentId
        : typeof req.params.id === "string"
          ? req.params.id
          : undefined
  };
  return finalizeLocalUploads(req, files, entityParts, options);
}
