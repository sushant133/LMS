import type { Dirent } from "node:fs";
import type { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { getBackendRoot, getUploadDir } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { serveComplaintAttachment } from "./complaintFileController.js";
import { logger } from "../utils/logger.js";

/** Safe path segments: letters, digits, dot, underscore, hyphen */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * Module directory whose files carry an extra owner/admin ACL
 * (see serveComplaintAttachment). Tenant isolation alone is not enough there,
 * so these files must never be reached through the basename fallback below.
 */
const RESTRICTED_ACL_DIR = "complaints";

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

const isInsideRoot = (rootResolved: string, candidate: string): boolean => {
  const relativeToRoot = path.relative(rootResolved, candidate);
  return (
    relativeToRoot !== "" &&
    !relativeToRoot.startsWith("..") &&
    !path.isAbsolute(relativeToRoot)
  );
};

/**
 * Candidate upload roots: configured root first, then common legacy locations
 * when process.cwd() previously differed from the backend package directory.
 */
const getCandidateUploadRoots = (): string[] => {
  const primary = path.resolve(getUploadDir());
  const fromEnv = (process.env.UPLOAD_LEGACY_DIRS ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = [
    primary,
    path.join(getBackendRoot(), "uploads"),
    path.join(process.cwd(), "uploads"),
    path.join(process.cwd(), "backend", "uploads"),
    path.join(getBackendRoot(), "..", "uploads"),
    path.join(getBackendRoot(), "dist", "uploads"),
    ...fromEnv,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const n = path.resolve(c);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

/**
 * When the exact path is missing (deploy / cwd drift), search by basename
 * under that school's folder only (tenant isolation preserved).
 */
const findFileByBasenameUnderSchool = async (
  rootResolved: string,
  schoolId: string,
  basename: string,
): Promise<string | null> => {
  if (!SAFE_SEGMENT.test(basename)) return null;
  const schoolRoot = path.join(rootResolved, schoolId);
  if (!(await fs.pathExists(schoolRoot))) return null;

  const queue: string[] = [schoolRoot];
  let visited = 0;
  const maxVisit = 8_000;

  while (queue.length > 0 && visited < maxVisit) {
    const dir = queue.shift()!;
    visited += 1;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      // Only traverse safe directory / file names
      if (!SAFE_SEGMENT.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (!isInsideRoot(rootResolved, full)) continue;
      if (entry.isFile() && entry.name === basename) {
        return full;
      }
      if (entry.isDirectory()) {
        /**
         * Never remap a request into the complaints tree. The stricter
         * complaint ACL only runs when the *requested* path starts with
         * "complaints"; letting the fallback reach those files would serve
         * another user's attachment to any same-school account that knows
         * the filename.
         */
        if (entry.name.toLowerCase() === RESTRICTED_ACL_DIR) continue;
        queue.push(full);
      }
    }
  }
  return null;
};

const resolveExistingFile = async (
  schoolId: string,
  relativeParts: string[],
): Promise<{ filePath: string; rootResolved: string } | null> => {
  const basename = relativeParts[relativeParts.length - 1] ?? "";
  const roots = getCandidateUploadRoots();

  for (const rootResolved of roots) {
    const exact = path.resolve(rootResolved, schoolId, ...relativeParts);
    if (!isInsideRoot(rootResolved, exact)) {
      continue;
    }

    if (await fs.pathExists(exact)) {
      const st = await fs.stat(exact);
      if (st.isFile()) {
        return { filePath: exact, rootResolved };
      }
    }

    // Exact path missing — try basename under this school (same tenant only)
    if (basename) {
      const found = await findFileByBasenameUnderSchool(
        rootResolved,
        schoolId,
        basename,
      );
      if (found) {
        logger.warn(
          `Upload path remapped by basename: expected=${exact} found=${found} root=${rootResolved}`,
        );
        return { filePath: found, rootResolved };
      }
    }
  }

  return null;
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
  let relativeParts = parseWildcardPath(req.params.filePath ?? req.params[0]);

  if (!schoolId || !SAFE_SEGMENT.test(schoolId)) {
    throw new ApiError(400, "Invalid file path (school)");
  }

  // Tolerate accidental double schoolId prefix in stored URLs
  if (relativeParts[0] === schoolId) {
    relativeParts = relativeParts.slice(1);
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
        `Upload access denied: user ${req.user.userId} school=${userSchool} tried schoolId=${schoolId}`,
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

  const publicRelative = `/uploads/${schoolId}/${relativeParts.join("/")}`;
  const resolved = await resolveExistingFile(schoolId, relativeParts);

  if (!resolved) {
    const primaryRoot = path.resolve(getUploadDir());
    const expected = path.join(primaryRoot, schoolId, ...relativeParts);
    const parentDir = path.dirname(expected);
    const parentExists = await fs.pathExists(parentDir);
    let parentSample: string[] = [];
    if (parentExists) {
      try {
        parentSample = (await fs.readdir(parentDir)).slice(0, 8);
      } catch {
        parentSample = [];
      }
    }
    // Detailed path stays in server logs only — never expose UPLOAD_DIR to clients
    logger.warn(
      `Upload 404: public=${publicRelative} expected=${expected} root=${primaryRoot} parentDirExists=${parentExists} parentSample=${JSON.stringify(parentSample)} rootsTried=${getCandidateUploadRoots().join(" | ")}`,
    );
    throw new ApiError(404, "Document unavailable.");
  }

  const { filePath } = resolved;

  /**
   * Defense in depth: whatever the requested path looked like, a file that
   * actually lives under a complaints directory may only be served through
   * serveComplaintAttachment (owner / institution-admin ACL). Requests that
   * reach here never ran that check.
   */
  if (
    filePath
      .split(/[/\\]+/)
      .some((segment) => segment.toLowerCase() === RESTRICTED_ACL_DIR)
  ) {
    logger.warn(
      `Blocked non-ACL access to complaint attachment: user=${req.user.userId} path=${publicRelative}`,
    );
    throw new ApiError(403, "Access denied");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");

  const contentType = contentTypeForPath(filePath);
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }

  // ?download=1 → force save-as; default is inline for in-app / blob preview
  const forceDownload =
    String(req.query.download ?? "").toLowerCase() === "1" ||
    String(req.query.download ?? "").toLowerCase() === "true";
  const basename = path.basename(filePath);
  const safeAscii = basename.replace(/[^\w.\-()+ ]+/g, "_");
  if (forceDownload) {
    res.setHeader("Content-Disposition", `attachment; filename="${safeAscii}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${safeAscii}"`);
  }

  // Allow same-origin SPA to fetch blob and embed (override global CORP if set)
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  return res.sendFile(filePath);
});
