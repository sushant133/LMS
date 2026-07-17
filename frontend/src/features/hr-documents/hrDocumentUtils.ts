import {
  HR_DOCUMENT_CATEGORIES,
  HR_DOCUMENT_MAX_SIZE_BYTES,
  type HrDocument,
} from "@phit-erp/shared";

export { HR_DOCUMENT_CATEGORIES };

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getHrCategoryLabel = (type: string): string =>
  HR_DOCUMENT_CATEGORIES.find((item) => item.key === type)?.label ?? type;

export const validateHrDocumentFile = (file: File): string | null => {
  const allowed = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  // Some browsers leave type empty for Office files — allow by extension fallback
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const extOk = ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx"].includes(ext);
  if (file.type && !allowed.includes(file.type) && !extOk) {
    return "Only PDF, JPG, PNG, WEBP, DOC, and DOCX files are allowed";
  }
  if (!file.type && !extOk) {
    return "Only PDF, JPG, PNG, WEBP, DOC, and DOCX files are allowed";
  }
  if (file.size > HR_DOCUMENT_MAX_SIZE_BYTES) {
    return "File size must be less than 600 KB";
  }
  if (file.size <= 0) {
    return "File is empty";
  }
  return null;
};

export const isImageDocument = (mimeType?: string, url?: string): boolean => {
  if (mimeType?.startsWith("image/")) return true;
  return Boolean(url && /\.(jpe?g|png|webp)$/i.test(url));
};

export const isPendingHrDocument = (doc: {
  status?: string;
  url?: string;
}): boolean => doc.status === "PENDING" || !doc.url;

export interface PendingHrDocument {
  id: string;
  type: string;
  name: string;
  file: File;
}

export const pendingToHrDocument = (
  pending: PendingHrDocument,
  uploaded: {
    url: string;
    originalName: string;
    size: number;
    mimeType?: string;
  },
  uploadedBy: string,
  uploadedByName: string,
): HrDocument => ({
  type: pending.type,
  name: pending.name,
  url: uploaded.url,
  originalName: uploaded.originalName,
  mimeType: uploaded.mimeType,
  size: uploaded.size,
  status: "UPLOADED",
  uploadedAt: new Date().toISOString(),
  uploadedBy,
  uploadedByName,
});

export const getDocumentStatusBadgeClass = (status: string): string => {
  switch (status) {
    case "PENDING":
      return "bg-amber-100 text-amber-900";
    case "VERIFIED":
      return "bg-emerald-100 text-emerald-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "UPLOADED":
    default:
      return "bg-slate-100 text-slate-700";
  }
};

export const getDocumentStatusLabel = (status: string): string => {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "VERIFIED":
      return "Verified";
    case "REJECTED":
      return "Rejected";
    case "UPLOADED":
    default:
      return "Uploaded";
  }
};

export type HrEntityKind = "teacher" | "staff";

export const hrEntityApiBase = (kind: HrEntityKind, entityId: string): string =>
  kind === "teacher" ? `/teachers/${entityId}` : `/college-staff/${entityId}`;

export const hrUploadEndpoint = (_kind: HrEntityKind): string =>
  "/uploads/teachers/documents";

export const hrPhotoUploadEndpoint = (_kind: HrEntityKind): string =>
  "/uploads/teachers/photo";
