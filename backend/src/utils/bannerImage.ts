import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { toPublicRelativePath } from "../services/fileStorage/index.js";

const BANNER_MAX_WIDTH = 1920;
const THUMBNAIL_WIDTH = 320;
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 85;

export interface ProcessedBannerImage {
  imagePath: string;
  thumbnailPath: string;
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

/**
 * Optimize banner with sharp and keep both full + thumbnail on local/VPS disk.
 * Relative `/uploads/...` paths are returned for MongoDB storage.
 */
export const processBannerImage = async (
  filePath: string,
  _schoolId?: string
): Promise<ProcessedBannerImage> => {
  const metadata = await sharp(filePath).metadata();
  const ext = path.extname(filePath).toLowerCase();
  const isPng = ext === ".png";
  const isWebp = ext === ".webp";

  // Write optimized image to a sibling temp path (avoid sharp in-place overwrite issues)
  const optimizedPath = filePath.replace(
    path.extname(filePath),
    `-opt${path.extname(filePath)}`
  );

  const resized = sharp(filePath).rotate().resize({
    width: BANNER_MAX_WIDTH,
    height: BANNER_MAX_WIDTH,
    fit: "inside",
    withoutEnlargement: true
  });

  if (isPng) {
    await resized.png({ compressionLevel: 8, adaptiveFiltering: true }).toFile(optimizedPath);
  } else if (isWebp) {
    await resized.webp({ quality: WEBP_QUALITY }).toFile(optimizedPath);
  } else {
    await resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(optimizedPath);
  }

  // Replace original with optimized
  await fs.remove(filePath).catch(() => undefined);
  await fs.move(optimizedPath, filePath, { overwrite: true });

  const optimizedMeta = await sharp(filePath).metadata();
  const width = optimizedMeta.width ?? metadata.width ?? 0;
  const height = optimizedMeta.height ?? metadata.height ?? 0;

  const thumbnailPath = filePath.replace(path.extname(filePath), `-thumb${path.extname(filePath)}`);
  await sharp(filePath)
    .resize({ width: THUMBNAIL_WIDTH, fit: "inside", withoutEnlargement: true })
    .toFile(thumbnailPath);

  const fileSizeBytes = (await fs.stat(filePath)).size;

  return {
    imagePath: filePath,
    thumbnailPath,
    imageUrl: toPublicRelativePath(filePath),
    thumbnailUrl: toPublicRelativePath(thumbnailPath),
    width,
    height,
    fileSizeBytes
  };
};
