import {
  countPendingRequiredDocuments,
  getRequiredStudentDocumentCategories,
  isPendingStudentDocument,
  STUDENT_DOCUMENT_CATEGORIES,
  STUDENT_DOCUMENT_MAX_SIZE_BYTES,
  type StudentDocument,
} from "@phit-erp/shared";

export {
  countPendingRequiredDocuments,
  getRequiredStudentDocumentCategories,
  isPendingStudentDocument,
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

export const getCategoryLabel = (type: string): string =>
  STUDENT_DOCUMENT_CATEGORIES.find((item) => item.key === type)?.label ?? type;

export const validateDocumentFile = (file: File): string | null => {
  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  if (!allowed.includes(file.type)) {
    return "Only PDF, JPG, JPEG, and PNG files are allowed";
  }
  if (file.size > STUDENT_DOCUMENT_MAX_SIZE_BYTES) {
    return "File size must be less than 600 KB";
  }
  return null;
};

export const isImageDocument = (mimeType?: string, url?: string): boolean => {
  if (mimeType?.startsWith("image/")) return true;
  return Boolean(url && /\.(jpe?g|png)$/i.test(url));
};

export interface PendingStudentDocument {
  id: string;
  type: string;
  name: string;
  file: File;
}

export const pendingToStudentDocument = (
  pending: PendingStudentDocument,
  uploaded: {
    url: string;
    originalName: string;
    size: number;
    mimeType?: string;
  },
  uploadedBy: string,
  uploadedByName: string,
): StudentDocument => ({
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
