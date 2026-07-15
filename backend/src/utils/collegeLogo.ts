import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const LOGO_FILENAME = "college-logo.png";

/** Email CID must look like an address; bare names break in many clients (esp. spam). */
export const COLLEGE_LOGO_EMAIL_CID = "college-logo@phit-lms";

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

  if (!collegeLogoExists()) {
    emailLogoCache = null;
    return null;
  }

  try {
    const sourcePath = getCollegeLogoPath();
    const buffer = await sharp(sourcePath)
      .rotate()
      .resize(128, 128, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10, palette: true })
      .toBuffer();

    emailLogoCache = {
      buffer,
      contentType: "image/png",
      filename: LOGO_FILENAME
    };

    return {
      filename: LOGO_FILENAME,
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
