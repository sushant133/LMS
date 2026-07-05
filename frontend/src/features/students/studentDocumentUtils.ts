import {
  STUDENT_DOCUMENT_CATEGORIES,
  STUDENT_DOCUMENT_MAX_SIZE_BYTES,
  type StudentDocument
} from "@phit-erp/shared";

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
    return "File size must be less than 500 KB";
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
  uploaded: { url: string; originalName: string; size: number; mimeType?: string },
  uploadedBy: string,
  uploadedByName: string
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
  uploadedByName
});