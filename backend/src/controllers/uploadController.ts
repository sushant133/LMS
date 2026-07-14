import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import { ApiError } from "../utils/apiError.js";
import { getUploadPublicUrl, inferAttachmentKind } from "../utils/upload.js";
import { recordAudit } from "../utils/audit.js";

export const uploadStudentPhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No photo file uploaded");
  }

  // Always derive public URL from UPLOAD_ROOT (not process.cwd()) so custom UPLOAD_DIR works
  const publicUrl = getUploadPublicUrl(file.path);

  // Audit the upload
  if (req.params.studentId) {
    await recordAudit(req, {
      action: "student.photo.upload",
      entity: "Student",
      entityId: String(req.params.studentId),
      after: { photoUrl: publicUrl }
    });
  }

  return sendSuccess(res, "Photo uploaded successfully", {
    url: publicUrl,
    originalName: file.originalname,
    size: file.size
  });
});

export const uploadDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No document files uploaded");
  }

  const uploaded = files.map((file) => ({
    url: getUploadPublicUrl(file.path),
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
    type: (Array.isArray(req.body.documentType) ? req.body.documentType[0] : req.body.documentType) || "OTHER"
  }));

  await recordAudit(req, {
    action: "document.upload",
    entity: "StudentDocument",
    entityId: String(req.params.studentId || "batch"),
    after: { count: uploaded.length }
  });

  return sendSuccess(res, "Documents uploaded successfully", { documents: uploaded });
});

export const uploadClassroomAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const attachments = files.map((file) => ({
    url: getUploadPublicUrl(file.path),
    name: file.originalname,
    mimeType: file.mimetype,
    kind: inferAttachmentKind(file.mimetype)
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

  return sendSuccess(res, "Staff photo uploaded successfully", {
    url: getUploadPublicUrl(file.path),
    originalName: file.originalname,
    size: file.size
  });
});

export const uploadAcademicAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const attachments = files.map((file) => ({
    url: getUploadPublicUrl(file.path),
    name: file.originalname,
    mimeType: file.mimetype,
    kind: inferAttachmentKind(file.mimetype)
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

  const attachments = files.map((file) => ({
    url: getUploadPublicUrl(file.path),
    name: file.originalname,
    mimeType: file.mimetype,
    kind: inferAttachmentKind(file.mimetype)
  }));

  return sendSuccess(res, "Complaint attachments uploaded", { attachments });
});

export const uploadBannerImageHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No banner image uploaded");
  }

  const { processBannerImage } = await import("../utils/bannerImage.js");
  const processed = await processBannerImage(file.path);

  return sendSuccess(res, "Banner image uploaded successfully", {
    url: processed.imageUrl,
    thumbnailUrl: processed.thumbnailUrl,
    originalName: file.originalname,
    size: processed.fileSizeBytes,
    width: processed.width,
    height: processed.height
  });
});
