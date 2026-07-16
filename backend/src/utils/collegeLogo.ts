import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const LOGO_FILENAME = "college-logo.png";
const EMAIL_LOGO_FILENAME = "college-logo-email.png";

/** Email CID must look like an address; bare names break in many clients (esp. spam). */
export const COLLEGE_LOGO_EMAIL_CID = "college-logo@phit-lms.local";

/**
 * Resolve the on-disk college logo across local dev and VPS layouts.
 * process.cwd() alone fails when the service is started from another directory.
 */
const candidateLogoPaths = (): string[] => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // utils → dist or src; walk up a few levels looking for assets/college-logo.png
  const fromModule = [
    path.resolve(here, "..", "..", "assets", LOGO_FILENAME), // dist/utils → backend/assets
    path.resolve(here, "..", "assets", LOGO_FILENAME),
    path.resolve(here, "assets", LOGO_FILENAME)
  ];
  const fromCwd = [
    path.join(process.cwd(), "assets", LOGO_FILENAME),
    path.join(process.cwd(), "backend", "assets", LOGO_FILENAME),
    path.join(process.cwd(), "dist", "assets", LOGO_FILENAME)
  ];
  return [...fromModule, ...fromCwd];
};

const candidateEmailLogoPaths = (): string[] => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "..", "..", "assets", EMAIL_LOGO_FILENAME),
    path.resolve(here, "..", "assets", EMAIL_LOGO_FILENAME),
    path.join(process.cwd(), "assets", EMAIL_LOGO_FILENAME),
    path.join(process.cwd(), "backend", "assets", EMAIL_LOGO_FILENAME)
  ];
};

let resolvedLogoPath: string | null | undefined;

export const getCollegeLogoPath = (): string => {
  if (resolvedLogoPath !== undefined) {
    return resolvedLogoPath ?? path.join(process.cwd(), "assets", LOGO_FILENAME);
  }

  for (const candidate of candidateLogoPaths()) {
    if (fs.existsSync(candidate)) {
      resolvedLogoPath = candidate;
      return candidate;
    }
  }

  resolvedLogoPath = null;
  return path.join(process.cwd(), "assets", LOGO_FILENAME);
};

export const collegeLogoExists = (): boolean => {
  const logoPath = getCollegeLogoPath();
  return Boolean(resolvedLogoPath) || fs.existsSync(logoPath);
};

/** Cached email-sized logo (small + metadata stripped) — large CID attachments push mail into spam. */
let emailLogoCache: { buffer: Buffer; contentType: string; filename: string } | null | undefined;

const loadPrebuiltEmailLogo = (): Buffer | null => {
  for (const candidate of candidateEmailLogoPaths()) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate);
        if (raw.length > 0 && raw.length <= 60_000) {
          return raw;
        }
      }
    } catch {
      // try next path
    }
  }
  return null;
};

/**
 * Returns a compact PNG suitable for inline email (≈10KB, 128px).
 * Strips Canva/XMP metadata and avoids attaching the full 2MB-class asset.
 */
export const getCollegeLogoEmailAttachment = async (): Promise<{
  filename: string;
  content: Buffer;
  cid: string;
  contentType: string;
  contentDisposition: "inline";
} | null> => {
  if (emailLogoCache === null) return null;
  if (emailLogoCache) {
    return {
      filename: emailLogoCache.filename,
      content: emailLogoCache.buffer,
      cid: COLLEGE_LOGO_EMAIL_CID,
      contentType: emailLogoCache.contentType,
      contentDisposition: "inline"
    };
  }

  // Prefer a pre-optimized email asset when present (fast + no sharp failures on host)
  const prebuilt = loadPrebuiltEmailLogo();
  if (prebuilt) {
    emailLogoCache = {
      buffer: prebuilt,
      contentType: "image/png",
      filename: EMAIL_LOGO_FILENAME
    };
    return {
      filename: EMAIL_LOGO_FILENAME,
      content: prebuilt,
      cid: COLLEGE_LOGO_EMAIL_CID,
      contentType: "image/png",
      contentDisposition: "inline"
    };
  }

  if (!collegeLogoExists()) {
    emailLogoCache = null;
    return null;
  }

  try {
    const sourcePath = getCollegeLogoPath();
    // Standard PNG (no palette) — better client compatibility than indexed PNGs
    const buffer = await sharp(sourcePath)
      .rotate()
      .resize(96, 96, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();

    // Persist small email logo next to source for next sends / host restarts
    try {
      const sourceDir = path.dirname(sourcePath);
      const outPath = path.join(sourceDir, EMAIL_LOGO_FILENAME);
      if (!fs.existsSync(outPath) || fs.statSync(outPath).size !== buffer.length) {
        fs.writeFileSync(outPath, buffer);
      }
    } catch {
      // non-fatal — still send with in-memory buffer
    }

    emailLogoCache = {
      buffer,
      contentType: "image/png",
      filename: EMAIL_LOGO_FILENAME
    };

    return {
      filename: EMAIL_LOGO_FILENAME,
      content: buffer,
      cid: COLLEGE_LOGO_EMAIL_CID,
      contentType: "image/png",
      contentDisposition: "inline"
    };
  } catch (error) {
    console.error("[email] Failed to prepare college logo for email:", error);
    // Fallback: raw file only if it is already small enough to attach safely
    try {
      const raw = fs.readFileSync(getCollegeLogoPath());
      if (raw.length > 40_000) {
        emailLogoCache = null;
        return null;
      }
      emailLogoCache = {
        buffer: raw,
        contentType: "image/png",
        filename: LOGO_FILENAME
      };
      return {
        filename: LOGO_FILENAME,
        content: raw,
        cid: COLLEGE_LOGO_EMAIL_CID,
        contentType: "image/png",
        contentDisposition: "inline"
      };
    } catch {
      emailLogoCache = null;
      return null;
    }
  }
};
