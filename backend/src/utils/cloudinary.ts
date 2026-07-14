import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import fs from "fs-extra";
import { env, isCloudinaryEnabled } from "../config/env.js";
import { ApiError } from "./apiError.js";
import { logger } from "./logger.js";

let configured = false;

/** Configure Cloudinary SDK once (no-op when credentials are missing). */
export const ensureCloudinaryConfigured = (): void => {
  if (!isCloudinaryEnabled()) return;
  if (configured) return;

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true
  });
  configured = true;
  logger.info(`Cloudinary enabled (cloud: ${env.CLOUDINARY_CLOUD_NAME})`);
};

export type CloudinaryResourceType = "image" | "video" | "raw" | "auto";

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  bytes: number;
  width?: number;
  height?: number;
  format?: string;
  resourceType: string;
}

/** Cloudinary is images-only in this app — never upload PDF/video/raw via this helper. */
const pickResourceType = (mimeType: string): CloudinaryResourceType => {
  if (mimeType.startsWith("image/")) return "image";
  // Defensive: callers should only pass images; default to image resource type
  return "image";
};

/**
 * Build a tenant-scoped Cloudinary folder:
 * {CLOUDINARY_FOLDER}/{schoolId}/{entity...}
 */
export const buildCloudinaryFolder = (schoolId: string, ...entityParts: string[]): string => {
  const root = env.CLOUDINARY_FOLDER || "phit-erp";
  const safe = [schoolId, ...entityParts]
    .map((part) =>
      String(part)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean);
  return [root, ...safe].join("/");
};

/**
 * Upload a local temp file to Cloudinary, then remove the local file.
 */
export const uploadLocalFileToCloudinary = async (
  localPath: string,
  options: {
    folder: string;
    mimeType?: string;
    resourceType?: CloudinaryResourceType;
    publicId?: string;
  }
): Promise<CloudinaryUploadResult> => {
  if (!isCloudinaryEnabled()) {
    throw new ApiError(500, "Cloudinary is not configured");
  }

  ensureCloudinaryConfigured();

  if (!(await fs.pathExists(localPath))) {
    throw new ApiError(400, "Upload file is missing on server");
  }

  const resourceType =
    options.resourceType ?? (options.mimeType ? pickResourceType(options.mimeType) : "auto");

  try {
    const result: UploadApiResponse = await cloudinary.uploader.upload(localPath, {
      folder: options.folder,
      public_id: options.publicId,
      resource_type: resourceType,
      overwrite: false,
      unique_filename: true,
      use_filename: false
    });

    // Staging file no longer needed on the VPS disk
    await fs.remove(localPath).catch(() => undefined);

    return {
      url: result.secure_url || result.url,
      publicId: result.public_id,
      bytes: result.bytes ?? 0,
      width: result.width,
      height: result.height,
      format: result.format,
      resourceType: result.resource_type ?? resourceType
    };
  } catch (error) {
    logger.error("Cloudinary upload failed", error);
    const message = error instanceof Error ? error.message : "Unknown Cloudinary error";
    throw new ApiError(502, `Failed to upload file to Cloudinary: ${message}`);
  }
};

/**
 * Upload an in-memory buffer (e.g. after sharp processing) to Cloudinary.
 */
export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  options: {
    folder: string;
    mimeType?: string;
    resourceType?: CloudinaryResourceType;
    filename?: string;
  }
): Promise<CloudinaryUploadResult> => {
  if (!isCloudinaryEnabled()) {
    throw new ApiError(500, "Cloudinary is not configured");
  }

  ensureCloudinaryConfigured();

  const resourceType =
    options.resourceType ?? (options.mimeType ? pickResourceType(options.mimeType) : "image");

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: resourceType,
        overwrite: false,
        unique_filename: true,
        use_filename: false
      },
      (error, result) => {
        if (error || !result) {
          logger.error("Cloudinary buffer upload failed", error);
          reject(
            new ApiError(
              502,
              `Failed to upload to Cloudinary: ${error?.message ?? "Unknown error"}`
            )
          );
          return;
        }
        resolve({
          url: result.secure_url || result.url,
          publicId: result.public_id,
          bytes: result.bytes ?? buffer.length,
          width: result.width,
          height: result.height,
          format: result.format,
          resourceType: result.resource_type ?? resourceType
        });
      }
    );
    stream.end(buffer);
  });
};

export { isCloudinaryEnabled };
