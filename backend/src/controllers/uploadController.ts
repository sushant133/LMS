import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import { ApiError } from "../utils/apiError.js";
import { finalizeUploadedFile, finalizeUploadedFiles } from "../utils/upload.js";
import { recordAudit } from "../utils/audit.js";
import { tenantObjectId } from "../utils/tenant.js";
import { UPLOAD_MODULES } from "../services/fileStorage/index.js";

/** Map finalized storage meta → stable API payload (MongoDB-safe fields only). */
const toFileResponse = (
  file: Awaited<ReturnType<typeof finalizeUploadedFile>>,
  extras: Record<string, unknown> = {}
) => ({
  path: file.path,
  url: file.url,
  originalName: file.originalName,
  mimeType: file.mimeType,
  size: file.size,
  uploadedAt: file.uploadedAt,
  uploadedBy: file.uploadedBy,
  entityId: file.entityId,
  kind: file.kind,
  ...extras
});

export const uploadStudentPhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No photo file uploaded");
  }

  const finalized = await finalizeUploadedFile(req, file, UPLOAD_MODULES.STUDENTS_PHOTOS);

  if (req.params.studentId) {
    await recordAudit(req, {
      action: "student.photo.upload",
      entity: "Student",
      entityId: String(req.params.studentId),
      after: { photoUrl: finalized.url, path: finalized.path }
    });
  }

  return sendSuccess(res, "Photo uploaded successfully", toFileResponse(finalized));
});

export const uploadDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No document files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.STUDENTS_DOCUMENTS);

  const documents = finalized.map((file, index) =>
    toFileResponse(file, {
      type:
        (Array.isArray(req.body.documentType)
          ? req.body.documentType[index] ?? req.body.documentType[0]
          : req.body.documentType) || "OTHER"
    })
  );

  await recordAudit(req, {
    action: "document.upload",
    entity: "StudentDocument",
    entityId: String(req.params.studentId || "batch"),
    after: { count: documents.length }
  });

  return sendSuccess(res, "Documents uploaded successfully", { documents });
});

export const uploadClassroomAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.ASSIGNMENTS);

  const attachments = finalized.map((file) => ({
    url: file.url,
    path: file.path,
    name: file.originalName,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    kind: file.kind,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy
  }));

  await recordAudit(req, {
    action: "classroom.attachment.upload",
    entity: "Assignment",
    entityId: "batch",
    after: { count: attachments.length }
  });

  return sendSuccess(res, "Classroom attachments uploaded", { attachments });
});

export const uploadStaffPhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No staff photo uploaded");
  }

  // Staff / teacher photos share teachers/photos module
  const finalized = await finalizeUploadedFile(req, file, UPLOAD_MODULES.TEACHERS_PHOTOS);

  return sendSuccess(res, "Staff photo uploaded successfully", toFileResponse(finalized));
});

export const uploadTeacherPhotoHandler = uploadStaffPhotoHandler;

export const uploadTeacherDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No document files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.TEACHERS_DOCUMENTS);
  const documents = finalized.map((file) => toFileResponse(file));

  return sendSuccess(res, "Teacher documents uploaded successfully", { documents });
});

export const uploadAcademicAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.ACADEMIC_MANAGEMENT);

  const attachments = finalized.map((file) => ({
    url: file.url,
    path: file.path,
    name: file.originalName,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    kind: file.kind,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy
  }));

  await recordAudit(req, {
    action: "academic.attachment.upload",
    entity: "AcademicManagement",
    entityId: "batch",
    after: { count: attachments.length }
  });

  return sendSuccess(res, "Academic attachments uploaded", { attachments });
});

export const uploadComplaintAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.COMPLAINTS);

  const attachments = finalized.map((file) => ({
    url: file.url,
    path: file.path,
    name: file.originalName,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    kind: file.kind,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy
  }));

  return sendSuccess(res, "Complaint attachments uploaded", { attachments });
});

export const uploadBannerImageHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No banner image uploaded");
  }

  const schoolId = tenantObjectId(req).toString();
  const { processBannerImage } = await import("../utils/bannerImage.js");
  const processed = await processBannerImage(file.path, schoolId);

  return sendSuccess(res, "Banner image uploaded successfully", {
    path: processed.imageUrl,
    url: processed.imageUrl,
    thumbnailUrl: processed.thumbnailUrl,
    originalName: file.originalname,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    size: processed.fileSizeBytes,
    width: processed.width,
    height: processed.height,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user?.userId ? String(req.user.userId) : undefined
  });
});

export const uploadProfilePhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No profile photo uploaded");
  }

  const finalized = await finalizeUploadedFile(req, file, UPLOAD_MODULES.PROFILE);
  return sendSuccess(res, "Profile photo uploaded successfully", toFileResponse(finalized));
});

export const uploadLibraryBookCoverHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No book cover uploaded");
  }

  const finalized = await finalizeUploadedFile(req, file, UPLOAD_MODULES.LIBRARY_BOOK_COVERS);
  return sendSuccess(res, "Book cover uploaded successfully", toFileResponse(finalized));
});

export const uploadLibraryEbookHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No ebook uploaded");
  }

  const finalized = await finalizeUploadedFile(req, file, UPLOAD_MODULES.LIBRARY_EBOOKS);
  return sendSuccess(res, "Ebook uploaded successfully", toFileResponse(finalized));
});

export const uploadLibraryDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.LIBRARY_DOCUMENTS);
  return sendSuccess(res, "Library documents uploaded", {
    documents: finalized.map((f) => toFileResponse(f))
  });
});

export const uploadResultsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.RESULTS);
  return sendSuccess(res, "Result files uploaded", {
    files: finalized.map((f) => toFileResponse(f))
  });
});

export const uploadLaboratoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.LABORATORY);
  return sendSuccess(res, "Laboratory files uploaded", {
    files: finalized.map((f) => toFileResponse(f))
  });
});

export const uploadInventoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.INVENTORY);
  return sendSuccess(res, "Inventory files uploaded", {
    files: finalized.map((f) => toFileResponse(f))
  });
});

export const uploadAccountingHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, UPLOAD_MODULES.ACCOUNTING);
  return sendSuccess(res, "Accounting files uploaded", {
    files: finalized.map((f) => toFileResponse(f))
  });
});
