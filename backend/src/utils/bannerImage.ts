import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { getUploadPublicUrl } from "./upload.js";

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

export const processBannerImage = async (filePath: string): Promise<ProcessedBannerImage> => {
  const metadata = await sharp(filePath).metadata();
  const ext = path.extname(filePath).toLowerCase();
  const isPng = ext === ".png";
  const isWebp = ext === ".webp";

  const resized = sharp(filePath).rotate().resize({
    width: BANNER_MAX_WIDTH,
    height: BANNER_MAX_WIDTH,
    fit: "inside",
    withoutEnlargement: true
  });

  if (isPng) {
    await resized.png({ compressionLevel: 8, adaptiveFiltering: true }).toFile(filePath);
  } else if (isWebp) {
    await resized.webp({ quality: WEBP_QUALITY }).toFile(filePath);
  } else {
    await resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(filePath);
  }

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
    imageUrl: getUploadPublicUrl(filePath),
    thumbnailUrl: getUploadPublicUrl(thumbnailPath),
    width,
    height,
    fileSizeBytes
  };
};