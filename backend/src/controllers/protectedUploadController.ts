import type { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { getUploadDir } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { serveComplaintAttachment } from "./complaintFileController.js";
import { logger } from "../utils/logger.js";

/** Safe path segments: letters, digits, dot, underscore, hyphen */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * Express 5 `{*filePath}` captures as string[] (e.g. ["classroom","file.pdf"]).
 * Older path-to-regexp may use a single slash-joined string.
 */
const parseWildcardPath = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((part) => String(part).split(/[/\\]+/))
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[/\\]+/)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .filter(Boolean);
  }

  return [];
};

/** Best-effort Content-Type from extension (never trusts client path for authorization). */
const contentTypeForPath = (filePath: string): string | undefined => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return undefined;
};

/**
 * Authenticated file serving for all tenant uploads on the VPS filesystem.
 * Path: /uploads/:schoolId/{*filePath}
 *
 * Security:
 * - Requires authentication
 * - Tenant isolation (non-SUPER_ADMIN may only access own schoolId)
 * - Path traversal blocked via SAFE_SEGMENT + resolve containment check
 * - Complaints: stricter owner/admin ACL
 */
export const serveProtectedUpload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  const schoolId = typeof req.params.schoolId === "string" ? req.params.schoolId.trim() : "";
  // Express 5: filePath is string[] — do NOT String(array) (becomes "a,b")
  const relativeParts = parseWildcardPath(req.params.filePath ?? req.params[0]);

  if (!schoolId || !SAFE_SEGMENT.test(schoolId)) {
    throw new ApiError(400, "Invalid file path (school)");
  }

  if (relativeParts.length === 0) {
    throw new ApiError(400, "Invalid file path (empty)");
  }

  for (const part of relativeParts) {
    if (part === "." || part === ".." || !SAFE_SEGMENT.test(part)) {
      throw new ApiError(400, `Invalid file path segment: ${part}`);
    }
  }

  // Tenant isolation
  if (req.user.role !== "SUPER_ADMIN") {
    const userSchool = req.user.schoolId ? String(req.user.schoolId) : "";
    if (!userSchool || userSchool !== schoolId) {
      logger.warn(
        `Upload access denied: user ${req.user.userId} school=${userSchool} tried schoolId=${schoolId}`
      );
      throw new ApiError(403, "Access denied");
    }
  }

  // Complaints: stricter ACL (owner or institution admin)
  if (relativeParts[0] === "complaints") {
    if (relativeParts.length !== 2) {
      throw new ApiError(400, "Invalid complaint file path");
    }
    req.params.filename = relativeParts[1]!;
    await new Promise<void>((resolve, reject) => {
      serveComplaintAttachment(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return;
  }

  const uploadsDir = getUploadDir();
  const rootResolved = path.resolve(uploadsDir);
  const filePath = path.resolve(rootResolved, schoolId, ...relativeParts);

  // Portable path containment (Windows-safe)
  const relativeToRoot = path.relative(rootResolved, filePath);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot === ""
  ) {
    throw new ApiError(400, "Invalid file path (outside uploads)");
  }

  if (!(await fs.pathExists(filePath))) {
    throw new ApiError(404, "File not found");
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new ApiError(404, "File not found");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Disposition", "inline");

  const contentType = contentTypeForPath(filePath);
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }

  return res.sendFile(filePath);
});
