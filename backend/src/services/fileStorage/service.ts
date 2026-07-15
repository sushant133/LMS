import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import type { Request } from "express";
import { getUploadDir } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import { logger } from "../../utils/logger.js";
import { tenantObjectId } from "../../utils/tenant.js";
import {
  LEGACY_UPLOAD_FOLDERS,
  REQUIRED_UPLOAD_FOLDERS,
  normalizeModulePath,
  resolveModulePath,
  type UploadModuleKey
} from "./modules.js";
import {
  extensionFromMime,
  inferAttachmentKind,
  sanitizeExtension
} from "./mime.js";
import type { FileStorageMeta, FinalizeUploadOptions } from "./types.js";

/** Safe path segment: letters, digits, dot, underscore, hyphen */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** Absolute root for all uploads (local + VPS). Configurable via UPLOAD_DIR. */
export const getStorageRoot = (): string => path.resolve(getUploadDir());

/**
 * Absolute path for a tenant's module directory.
 * Creates nothing — use ensureTenantModuleDir / ensureUploadDirectories.
 */
export const getTenantModuleAbsPath = (
  schoolId: string,
  modulePath: string
): string => {
  const school = String(schoolId).trim();
  if (!school || !SAFE_SEGMENT.test(school)) {
    throw new ApiError(400, "Invalid school id for upload path");
  }
  const module = normalizeModulePath(modulePath);
  assertSafeRelativeSegments(module.split("/"));
  return path.join(getStorageRoot(), school, ...module.split("/"));
};

/** Ensure a single tenant module directory exists. */
export const ensureTenantModuleDir = async (
  schoolId: string,
  modulePath: string
): Promise<string> => {
  const abs = getTenantModuleAbsPath(schoolId, modulePath);
  await fs.ensureDir(abs);
  return abs;
};

/**
 * Create the full module folder tree under the upload root and under every
 * existing tenant directory. Safe to call on every server startup.
 */
export const ensureUploadDirectories = async (): Promise<void> => {
  const root = getStorageRoot();
  await fs.ensureDir(root);

  // Global template (no tenant) — documents layout for operators / empty installs
  for (const folder of REQUIRED_UPLOAD_FOLDERS) {
    await fs.ensureDir(path.join(root, "_template", ...folder.split("/")));
  }
  for (const folder of LEGACY_UPLOAD_FOLDERS) {
    await fs.ensureDir(path.join(root, "_template", ...folder.split("/")));
  }

  // Existing tenant folders (Mongo ObjectId-like directory names)
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    logger.warn(
      `Could not read upload root for tenant folder bootstrap: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  for (const name of entries) {
    if (name.startsWith(".") || name === "_template") continue;
    if (!SAFE_SEGMENT.test(name)) continue;

    const tenantRoot = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(tenantRoot);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    for (const folder of REQUIRED_UPLOAD_FOLDERS) {
      await fs.ensureDir(path.join(tenantRoot, ...folder.split("/")));
    }
    // Keep legacy dirs so existing relative paths keep resolving
    for (const folder of LEGACY_UPLOAD_FOLDERS) {
      await fs.ensureDir(path.join(tenantRoot, ...folder.split("/")));
    }
  }

  logger.info(`Upload directories ready at ${root}`);
};

/**
 * Ensure all module folders exist for one tenant (e.g. after school create).
 */
export const ensureTenantUploadDirectories = async (schoolId: string): Promise<void> => {
  const school = String(schoolId).trim();
  if (!school || !SAFE_SEGMENT.test(school)) {
    throw new ApiError(400, "Invalid school id for upload directories");
  }
  const tenantRoot = path.join(getStorageRoot(), school);
  await fs.ensureDir(tenantRoot);
  for (const folder of REQUIRED_UPLOAD_FOLDERS) {
    await fs.ensureDir(path.join(tenantRoot, ...folder.split("/")));
  }
  for (const folder of LEGACY_UPLOAD_FOLDERS) {
    await fs.ensureDir(path.join(tenantRoot, ...folder.split("/")));
  }
};

/** Reject path-traversal and unsafe segments. */
export const assertSafeRelativeSegments = (parts: string[]): void => {
  for (const part of parts) {
    if (!part || part === "." || part === ".." || !SAFE_SEGMENT.test(part)) {
      throw new ApiError(400, `Invalid path segment: ${part || "(empty)"}`);
    }
  }
};

/**
 * Convert an absolute filesystem path under UPLOAD_DIR into a relative public path.
 * Always uses forward slashes and the `/uploads/...` prefix.
 */
export const toPublicRelativePath = (absoluteFilePath: string): string => {
  const rootResolved = getStorageRoot();
  const absolute = path.resolve(absoluteFilePath);
  const relativeToUploads = path.relative(rootResolved, absolute);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads) ||
    relativeToUploads === ""
  ) {
    throw new ApiError(500, "Uploaded file path is outside the configured upload directory");
  }

  const normalized = relativeToUploads
    .replace(/\\/g, "/")
    .replace(/^uploads\//, "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/\/(\.\.)(\/|$)/g, "/");

  return `/uploads/${normalized}`;
};

/**
 * Resolve a public relative path (or legacy absolute path string) to an absolute
 * filesystem path, with path-traversal protection.
 */
export const resolvePublicPathToAbsolute = (publicPath: string): string | null => {
  if (!publicPath || typeof publicPath !== "string") return null;
  let relative = publicPath.trim();

  // Ignore external CDN / absolute URLs (handled by mediaCleanup for Cloudinary legacy)
  if (/^https?:\/\//i.test(relative)) return null;

  if (relative.startsWith("/uploads/")) {
    relative = relative.slice("/uploads/".length);
  } else if (relative.startsWith("uploads/")) {
    relative = relative.slice("uploads/".length);
  } else {
    return null;
  }

  const parts = relative.split(/[/\\]+/).filter(Boolean);
  try {
    assertSafeRelativeSegments(parts);
  } catch {
    return null;
  }

  const root = getStorageRoot();
  const target = path.resolve(root, ...parts);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    return null;
  }
  return target;
};

/**
 * Generate a collision-resistant filename. Original client name is never used on disk.
 */
export const generateUniqueFilename = (
  originalName: string,
  mimeType?: string
): string => {
  const fromName = sanitizeExtension(originalName);
  const fromMime = mimeType ? extensionFromMime(mimeType) : "";
  const ext = fromName || fromMime;
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  return `${unique}${ext}`;
};

/**
 * Finalize a multer disk file into MongoDB-safe metadata.
 * Files stay on the VPS filesystem under UPLOAD_DIR — never written to MongoDB as binary.
 */
export const finalizeLocalUpload = async (
  req: Request,
  file: Express.Multer.File,
  modulePath: string | string[],
  options: FinalizeUploadOptions = {}
): Promise<FileStorageMeta> => {
  if (!file?.path) {
    throw new ApiError(400, "No file uploaded");
  }

  const module =
    typeof modulePath === "string"
      ? resolveModulePath(modulePath)
      : resolveModulePath(...modulePath);

  // Ensure tenant module dir exists (multer should have written here already)
  const schoolId = tenantObjectId(req).toString();
  await ensureTenantModuleDir(schoolId, module);

  // Verify the multer path is still inside our storage root
  const absolute = path.resolve(file.path);
  const root = getStorageRoot();
  const rel = path.relative(root, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    logger.error(`Upload path outside storage root: ${absolute}`);
    await fs.remove(absolute).catch(() => undefined);
    throw new ApiError(500, "Uploaded file path is outside the configured upload directory");
  }

  if (!(await fs.pathExists(absolute))) {
    throw new ApiError(400, "Upload file is missing on server");
  }

  const publicPath = toPublicRelativePath(absolute);
  const kind = inferAttachmentKind(file.mimetype);
  const uploadedBy =
    options.uploadedBy ??
    (req.user?.userId ? String(req.user.userId) : undefined);

  const meta: FileStorageMeta = {
    path: publicPath,
    url: publicPath,
    originalName: file.originalname || "file",
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    entityId: options.entityId,
    kind
  };

  logger.debug(`Stored upload ${publicPath} (${meta.size} bytes, ${meta.mimeType})`);
  return meta;
};

export const finalizeLocalUploads = async (
  req: Request,
  files: Express.Multer.File[],
  modulePath: string | string[],
  options: FinalizeUploadOptions = {}
): Promise<FileStorageMeta[]> =>
  Promise.all(files.map((file) => finalizeLocalUpload(req, file, modulePath, options)));

/**
 * Delete a file from the VPS by its public relative path.
 * No-op for external URLs (Cloudinary legacy handled elsewhere).
 * Never throws — logs failures so business deletes still succeed.
 */
export const deleteLocalFileByPublicPath = async (
  publicPath?: string | null
): Promise<boolean> => {
  if (!publicPath) return false;
  try {
    const absolute = resolvePublicPathToAbsolute(publicPath);
    if (!absolute) return false;

    if (await fs.pathExists(absolute)) {
      await fs.remove(absolute);
      logger.debug(`Deleted local upload ${publicPath}`);

      // Banner thumbnails share the base name with `-thumb` suffix
      const ext = path.extname(absolute);
      const thumb = absolute.replace(ext, `-thumb${ext}`);
      if (await fs.pathExists(thumb)) {
        await fs.remove(thumb);
      }
      return true;
    }
  } catch (error) {
    logger.warn(
      `Local file delete failed for ${publicPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return false;
};

/**
 * When a file is replaced, remove the previous path if it differs.
 */
export const deleteReplacedLocalFile = async (
  previousPath?: string | null,
  nextPath?: string | null
): Promise<void> => {
  const prev = (previousPath ?? "").trim();
  const next = (nextPath ?? "").trim();
  if (!prev || prev === next) return;
  await deleteLocalFileByPublicPath(prev);
};

/** Type-safe helper: module path is a known UploadModuleKey. */
export const isKnownModule = (modulePath: string): modulePath is UploadModuleKey =>
  (REQUIRED_UPLOAD_FOLDERS as readonly string[]).includes(normalizeModulePath(modulePath));
