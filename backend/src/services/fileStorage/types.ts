/**
 * Metadata stored in MongoDB for every uploaded file.
 * Binary content always lives on the VPS filesystem — never in MongoDB.
 */
export interface FileStorageMeta {
  /** Relative public path, e.g. `/uploads/{schoolId}/students/photos/abc.jpg` */
  path: string;
  /**
   * Alias of `path` for backward compatibility with existing models
   * that store `url` / `photoUrl` / `imageUrl`.
   */
  url: string;
  /** Client-provided original filename (not used on disk). */
  originalName: string;
  mimeType: string;
  size: number;
  /** ISO-8601 upload timestamp */
  uploadedAt: string;
  /** User id of the uploader when available */
  uploadedBy?: string;
  /** Related module/entity id when the upload is tied to a record */
  entityId?: string;
  /** Coarse kind for UI previews */
  kind: AttachmentKind;
  width?: number;
  height?: number;
}

export type AttachmentKind = "FILE" | "IMAGE" | "PDF" | "VIDEO" | "LINK";

/** Options for finalize / delete helpers */
export interface FinalizeUploadOptions {
  uploadedBy?: string;
  entityId?: string;
}

export interface FileSizeLimit {
  /** Max bytes for this upload category */
  maxBytes: number;
  /** Human-readable label for error messages */
  label: string;
}

export const FILE_SIZE_LIMITS = {
  photo: { maxBytes: 2 * 1024 * 1024, label: "2MB" } satisfies FileSizeLimit,
  studentDocument: { maxBytes: 500 * 1024, label: "500KB" } satisfies FileSizeLimit,
  document: { maxBytes: 10 * 1024 * 1024, label: "10MB" } satisfies FileSizeLimit,
  assignment: { maxBytes: 25 * 1024 * 1024, label: "25MB" } satisfies FileSizeLimit,
  banner: { maxBytes: 5 * 1024 * 1024, label: "5MB" } satisfies FileSizeLimit,
  complaint: { maxBytes: 10 * 1024 * 1024, label: "10MB" } satisfies FileSizeLimit,
  ebook: { maxBytes: 50 * 1024 * 1024, label: "50MB" } satisfies FileSizeLimit,
  general: { maxBytes: 15 * 1024 * 1024, label: "15MB" } satisfies FileSizeLimit
} as const;
