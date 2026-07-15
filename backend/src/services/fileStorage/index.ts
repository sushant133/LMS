/**
 * Centralized VPS file storage service for PHIT ERP.
 *
 * - Binary files → filesystem under UPLOAD_DIR (default: ./uploads)
 * - MongoDB → relative path + metadata only (never binary)
 * - Public URLs → `/uploads/{schoolId}/{module}/unique-name.ext`
 * - Works identically in local development and production (set UPLOAD_DIR on VPS)
 */

export {
  UPLOAD_MODULES,
  REQUIRED_UPLOAD_FOLDERS,
  LEGACY_UPLOAD_FOLDERS,
  LEGACY_MODULE_ALIASES,
  normalizeModulePath,
  resolveModulePath,
  type UploadModuleKey
} from "./modules.js";

export {
  type FileStorageMeta,
  type FinalizeUploadOptions,
  type AttachmentKind,
  type FileSizeLimit,
  FILE_SIZE_LIMITS
} from "./types.js";

export {
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  VIDEO_MIME_TYPES,
  STANDARD_MIME_TYPES,
  ASSIGNMENT_MIME_TYPES,
  STUDENT_DOCUMENT_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  normalizeMimeType,
  sanitizeExtension,
  extensionFromMime,
  inferAttachmentKind,
  assertMimeAllowed
} from "./mime.js";

export {
  getStorageRoot,
  getTenantModuleAbsPath,
  ensureTenantModuleDir,
  ensureUploadDirectories,
  ensureTenantUploadDirectories,
  assertSafeRelativeSegments,
  toPublicRelativePath,
  resolvePublicPathToAbsolute,
  generateUniqueFilename,
  finalizeLocalUpload,
  finalizeLocalUploads,
  deleteLocalFileByPublicPath,
  deleteReplacedLocalFile,
  isKnownModule
} from "./service.js";

export {
  uploadStudentPhoto,
  uploadStudentDocuments,
  uploadTeacherPhoto,
  uploadStaffPhoto,
  uploadTeacherDocuments,
  uploadLibraryBookCover,
  uploadLibraryEbook,
  uploadLibraryDocuments,
  uploadNoticeImage,
  uploadBannerImage,
  uploadAssignmentAttachments,
  uploadClassroomAttachments,
  uploadResultsAttachments,
  uploadLaboratoryAttachments,
  uploadInventoryAttachments,
  uploadAccountingAttachments,
  uploadProfilePhoto,
  uploadComplaintAttachments,
  uploadAcademicAttachments,
  uploadTempFiles
} from "./multerConfig.js";
