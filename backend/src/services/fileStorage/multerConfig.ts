import multer, { type StorageEngine } from "multer";
import type { Request } from "express";
import { ApiError } from "../../utils/apiError.js";
import { tenantObjectId } from "../../utils/tenant.js";
import {
  ASSIGNMENT_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  STANDARD_MIME_TYPES,
  STUDENT_DOCUMENT_MIME_TYPES,
  normalizeMimeType,
  type AttachmentKind
} from "./mime.js";
import { UPLOAD_MODULES, resolveModulePath } from "./modules.js";
import { ensureTenantModuleDir, generateUniqueFilename } from "./service.js";
import { FILE_SIZE_LIMITS } from "./types.js";

/**
 * Tenant-scoped disk storage under:
 * {UPLOAD_DIR}/{schoolId}/{modulePath}/{uniqueFilename}
 */
function createModuleStorage(modulePath: string): StorageEngine {
  const resolved = resolveModulePath(modulePath);

  return multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const schoolId = tenantObjectId(req).toString();
        const dest = await ensureTenantModuleDir(schoolId, resolved);
        cb(null, dest);
      } catch (err) {
        cb(err as Error, "");
      }
    },
    filename: (_req, file, cb) => {
      // Never use original client filename on disk (path traversal / collisions)
      cb(null, generateUniqueFilename(file.originalname, file.mimetype));
    }
  });
}

function createFileFilter(mimeTypes: readonly string[], message: string) {
  const allowed = new Set(mimeTypes.map((m) => m.toLowerCase()));
  return (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const mime = normalizeMimeType(file.mimetype);
    file.mimetype = mime;
    if (allowed.has(mime)) {
      cb(null, true);
      return;
    }
    if (mime === "image/heic" || mime === "image/heif") {
      cb(
        new ApiError(
          400,
          "HEIC/HEIF photos are not supported. Please convert to JPG or PNG and try again."
        )
      );
      return;
    }
    cb(new ApiError(400, `${message} (received: ${file.mimetype || "unknown"})`));
  };
}

const imageFilter = createFileFilter(
  IMAGE_MIME_TYPES,
  "Invalid image type. Allowed: JPG, JPEG, PNG, WEBP"
);

const standardFilter = createFileFilter(
  STANDARD_MIME_TYPES,
  "Invalid file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP"
);

const documentFilter = createFileFilter(
  [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES],
  "Invalid file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP"
);

const studentDocumentFilter = createFileFilter(
  STUDENT_DOCUMENT_MIME_TYPES,
  "Invalid file type. Allowed: PDF, JPG, JPEG, PNG (not HEIC/HEIF — convert to JPG first)"
);

const assignmentFilter = createFileFilter(
  ASSIGNMENT_MIME_TYPES,
  "Invalid file type. Allowed: images, PDF, Office docs, TXT, ZIP, MP4, WEBM, MOV"
);

const complaintFilter = createFileFilter(
  [...IMAGE_MIME_TYPES, "application/pdf"],
  "Invalid file type. Allowed: JPG, JPEG, PNG, WEBP, PDF"
);

// ─── Multer middleware per module ───────────────────────────────────────────

export const uploadStudentPhoto = multer({
  storage: createModuleStorage(UPLOAD_MODULES.STUDENTS_PHOTOS),
  limits: { fileSize: FILE_SIZE_LIMITS.photo.maxBytes },
  fileFilter: imageFilter
}).single("photo");

export const uploadStudentDocuments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.STUDENTS_DOCUMENTS),
  limits: { fileSize: FILE_SIZE_LIMITS.studentDocument.maxBytes },
  fileFilter: studentDocumentFilter
}).array("documents", 10);

export const uploadTeacherPhoto = multer({
  storage: createModuleStorage(UPLOAD_MODULES.TEACHERS_PHOTOS),
  limits: { fileSize: FILE_SIZE_LIMITS.photo.maxBytes },
  fileFilter: imageFilter
}).single("photo");

/** @deprecated Alias — staff photos now land in teachers/photos */
export const uploadStaffPhoto = uploadTeacherPhoto;

export const uploadTeacherDocuments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.TEACHERS_DOCUMENTS),
  limits: { fileSize: FILE_SIZE_LIMITS.hrDocument.maxBytes },
  fileFilter: documentFilter
}).array("documents", 10);

export const uploadLibraryBookCover = multer({
  storage: createModuleStorage(UPLOAD_MODULES.LIBRARY_BOOK_COVERS),
  limits: { fileSize: FILE_SIZE_LIMITS.photo.maxBytes },
  fileFilter: imageFilter
}).single("cover");

export const uploadLibraryEbook = multer({
  storage: createModuleStorage(UPLOAD_MODULES.LIBRARY_EBOOKS),
  limits: { fileSize: FILE_SIZE_LIMITS.ebook.maxBytes },
  fileFilter: createFileFilter(
    DOCUMENT_MIME_TYPES,
    "Invalid ebook type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP"
  )
}).single("ebook");

export const uploadLibraryDocuments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.LIBRARY_DOCUMENTS),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: documentFilter
}).array("files", 10);

export const uploadNoticeImage = multer({
  storage: createModuleStorage(UPLOAD_MODULES.NOTICES),
  limits: { fileSize: FILE_SIZE_LIMITS.banner.maxBytes },
  fileFilter: imageFilter
}).single("image");

/** @deprecated Alias — banners store under notices/ */
export const uploadBannerImage = uploadNoticeImage;

export const uploadAssignmentAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.ASSIGNMENTS),
  limits: { fileSize: FILE_SIZE_LIMITS.assignment.maxBytes },
  fileFilter: assignmentFilter
}).array("files", 10);

/** @deprecated Alias — classroom attachments store under assignments/ */
export const uploadClassroomAttachments = uploadAssignmentAttachments;

export const uploadResultsAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.RESULTS),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: documentFilter
}).array("files", 10);

export const uploadLaboratoryAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.LABORATORY),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: documentFilter
}).array("files", 10);

export const uploadInventoryAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.INVENTORY),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: documentFilter
}).array("files", 10);

export const uploadAccountingAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.ACCOUNTING),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: documentFilter
}).array("files", 10);

export const uploadProfilePhoto = multer({
  storage: createModuleStorage(UPLOAD_MODULES.PROFILE),
  limits: { fileSize: FILE_SIZE_LIMITS.photo.maxBytes },
  fileFilter: imageFilter
}).single("photo");

export const uploadComplaintAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.COMPLAINTS),
  limits: { fileSize: FILE_SIZE_LIMITS.complaint.maxBytes },
  fileFilter: complaintFilter
}).array("files", 5);

export const uploadAcademicAttachments = multer({
  storage: createModuleStorage(UPLOAD_MODULES.ACADEMIC_MANAGEMENT),
  limits: { fileSize: FILE_SIZE_LIMITS.document.maxBytes },
  fileFilter: complaintFilter
}).array("files", 5);

export const uploadTempFiles = multer({
  storage: createModuleStorage(UPLOAD_MODULES.TEMP),
  limits: { fileSize: FILE_SIZE_LIMITS.general.maxBytes },
  fileFilter: standardFilter
}).array("files", 10);

// Re-export filters for custom routes if needed
export {
  createFileFilter,
  createModuleStorage,
  imageFilter,
  standardFilter,
  documentFilter,
  assignmentFilter
};

export type { AttachmentKind };
