import { resolveApiUrl } from "lib/api";

export const BANNER_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp";
export const BANNER_RECOMMENDED_SIZES = [
  "1920 × 1080",
  "1600 × 900",
  "1200 × 675",
];

export interface UploadedBannerImage {
  imageUrl: string;
  thumbnailUrl?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  originalFileName?: string;
}

export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatResolution = (width?: number, height?: number): string => {
  if (!width || !height) return "—";
  return `${width} × ${height}`;
};

export const uploadBannerImage = async (
  file: File,
): Promise<UploadedBannerImage> => {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(resolveApiUrl("/uploads/banners"), {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? "Upload failed");
  }

  const body = await response.json();
  const data = body.data ?? {};

  return {
    imageUrl: data.url ?? "",
    thumbnailUrl: data.thumbnailUrl,
    fileSizeBytes: data.size,
    width: data.width,
    height: data.height,
    originalFileName: data.originalName ?? file.name,
  };
};
