import multer, { type StorageEngine } from "multer";
import path from "path";
import fs from "fs-extra";
import type { Request } from "express";
import { env } from "../config/env.js";
import { ApiError } from "./apiError.js";
import { tenantObjectId } from "./tenant.js";

const UPLOAD_ROOT = env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

// Ensure base upload directory exists
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
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
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

const bannerMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const bannerFileFilter = createFileFilter(bannerMimeTypes, "Invalid file type. Allowed: JPG, PNG, WEBP");

export const uploadBannerImage = multer({
  storage: createTenantStorage("banners"),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: bannerFileFilter
}).single("image");

export const uploadStaffPhoto = multer({
  storage: createTenantStorage("staff/photos"),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: bannerFileFilter
}).single("photo");

/**
 * Returns a public URL path for a stored file (relative).
 * In production you would return a signed S3/Cloudinary URL.
 */
export function getFilePublicPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^uploads\//, "");
  return `/uploads/${normalized}`;
}

export function getUploadPublicUrl(filePath: string): string {
  const relativeToUploads = path.relative(UPLOAD_ROOT, filePath);
  return getFilePublicPath(relativeToUploads);
}

export function inferAttachmentKind(mimeType: string): "FILE" | "IMAGE" | "PDF" | "VIDEO" {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "FILE";
}
