import type { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { getUploadDir } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { serveComplaintAttachment } from "./complaintFileController.js";

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

/**
 * Authenticated file serving for all tenant uploads.
 * Path: /uploads/:schoolId/{*filePath}
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
      throw new ApiError(403, "Access denied");
    }
  }

  // Complaints: stricter ACL
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

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    res.setHeader("Content-Type", "application/pdf");
  }

  return res.sendFile(filePath);
});
