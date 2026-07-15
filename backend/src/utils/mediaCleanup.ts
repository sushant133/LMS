import { v2 as cloudinary } from "cloudinary";
import { env, isCloudinaryEnabled } from "../config/env.js";
import { ensureCloudinaryConfigured } from "./cloudinary.js";
import { logger } from "./logger.js";
import { deleteLocalFileByPublicPath } from "../services/fileStorage/index.js";

type ResourceType = "image" | "video" | "raw";

/**
 * Parse a Cloudinary delivery URL into public_id + resource_type.
 * Kept for backward compatibility with assets uploaded before VPS-local storage.
 */
export const extractCloudinaryPublicId = (
  url: string
): { publicId: string; resourceType: ResourceType } | null => {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.includes("cloudinary.com") && !trimmed.includes("res.cloudinary.com")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx < 1) return null;

    const resourceRaw = parts[uploadIdx - 1] ?? "image";
    const resourceType: ResourceType =
      resourceRaw === "video" ? "video" : resourceRaw === "raw" ? "raw" : "image";

    let rest = parts.slice(uploadIdx + 1);
    if (rest[0]?.startsWith("s--")) {
      rest = rest.slice(1);
    }

    while (rest.length > 0) {
      const seg = rest[0]!;
      if (/^v\d+$/.test(seg)) {
        rest = rest.slice(1);
        break;
      }
      if (
        seg.includes(",") ||
        /^(c_|w_|h_|q_|f_|fl_|t_|e_|b_|r_|a_|dpr_|g_|l_|o_|x_|y_|z_)/.test(seg)
      ) {
        rest = rest.slice(1);
        continue;
      }
      break;
    }

    if (rest.length === 0) return null;

    let publicId = decodeURIComponent(rest.join("/"));
    publicId = publicId.replace(/\.[a-zA-Z0-9]{2,5}$/, "");
    if (!publicId) return null;

    return { publicId, resourceType };
  } catch {
    return null;
  }
};

export const isCloudinaryUrl = (url?: string | null): boolean =>
  Boolean(url && extractCloudinaryPublicId(url));

/**
 * Delete one media URL:
 * - Legacy Cloudinary CDN URLs (when credentials are still configured)
 * - Local/VPS `/uploads/...` relative paths via the file storage service
 *
 * Never throws — deletion failures are logged so business deletes still succeed.
 */
export const deleteStoredMediaUrl = async (url?: string | null): Promise<void> => {
  if (!url || typeof url !== "string" || !url.trim()) return;
  const trimmed = url.trim();

  const cloud = extractCloudinaryPublicId(trimmed);
  if (cloud && isCloudinaryEnabled()) {
    try {
      ensureCloudinaryConfigured();
      const result = await cloudinary.uploader.destroy(cloud.publicId, {
        resource_type: cloud.resourceType,
        invalidate: true
      });
      if (result?.result === "not found") {
        for (const rt of ["image", "raw", "video"] as const) {
          if (rt === cloud.resourceType) continue;
          const retry = await cloudinary.uploader.destroy(cloud.publicId, {
            resource_type: rt,
            invalidate: true
          });
          if (retry?.result === "ok") break;
        }
      }
      logger.debug(`Cloudinary destroy ${cloud.publicId}: ${result?.result ?? "done"}`);
    } catch (error) {
      logger.warn(
        `Cloudinary delete failed for ${cloud.publicId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return;
  }

  // Attempt destroy if URL looks like Cloudinary even when env is partial
  if (cloud && env.CLOUDINARY_CLOUD_NAME) {
    try {
      ensureCloudinaryConfigured();
      await cloudinary.uploader.destroy(cloud.publicId, {
        resource_type: cloud.resourceType,
        invalidate: true
      });
    } catch {
      /* best-effort legacy cleanup */
    }
    return;
  }

  await deleteLocalFileByPublicPath(trimmed);
};

/** Delete many media URLs (deduped). Safe to call with empty/mixed arrays. */
export const deleteStoredMediaUrls = async (
  urls: Array<string | null | undefined>
): Promise<void> => {
  const unique = [...new Set(urls.map((u) => (u ?? "").trim()).filter(Boolean))];
  await Promise.all(unique.map((url) => deleteStoredMediaUrl(url)));
};

/**
 * When a photo/document is replaced or cleared, remove the previous asset if the URL changed.
 * Handles both VPS `/uploads/...` paths and legacy Cloudinary URLs.
 */
export const deleteReplacedMedia = async (
  previousUrl?: string | null,
  nextUrl?: string | null
): Promise<void> => {
  const prev = (previousUrl ?? "").trim();
  const next = (nextUrl ?? "").trim();
  if (!prev || prev === next) return;
  await deleteStoredMediaUrl(prev);
};

/** Collect attachment-like { url } entries. */
export const collectAttachmentUrls = (
  attachments?: Array<{ url?: string | null } | null> | null
): string[] => {
  if (!attachments?.length) return [];
  return attachments.map((a) => a?.url).filter((u): u is string => Boolean(u?.trim()));
};
