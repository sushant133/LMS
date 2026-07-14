import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import { ApiError } from "../utils/apiError.js";
import { finalizeUploadedFile, finalizeUploadedFiles } from "../utils/upload.js";
import { recordAudit } from "../utils/audit.js";
import { tenantObjectId } from "../utils/tenant.js";

export const uploadStudentPhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ApiError(400, "No photo file uploaded");
  }

  const finalized = await finalizeUploadedFile(req, file, "students", "photos");

  if (req.params.studentId) {
    await recordAudit(req, {
      action: "student.photo.upload",
      entity: "Student",
      entityId: String(req.params.studentId),
      after: { photoUrl: finalized.url, publicId: finalized.publicId }
    });
  }

  return sendSuccess(res, "Photo uploaded successfully", {
    url: finalized.url,
    originalName: finalized.originalName,
    size: finalized.size,
    publicId: finalized.publicId
  });
});

export const uploadDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No document files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, "students", "documents");

  const uploaded = finalized.map((file, index) => ({
    url: file.url,
    originalName: file.originalName,
    size: file.size,
    mimeType: file.mimeType,
    type:
      (Array.isArray(req.body.documentType)
        ? req.body.documentType[index] ?? req.body.documentType[0]
        : req.body.documentType) || "OTHER",
    publicId: file.publicId
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

  const finalized = await finalizeUploadedFiles(req, files, "classroom");

  const attachments = finalized.map((file) => ({
    url: file.url,
    name: file.originalName,
    mimeType: file.mimeType,
    kind: file.kind,
    publicId: file.publicId
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

  const finalized = await finalizeUploadedFile(req, file, "staff", "photos");

  return sendSuccess(res, "Staff photo uploaded successfully", {
    url: finalized.url,
    originalName: finalized.originalName,
    size: finalized.size,
    publicId: finalized.publicId
  });
});

export const uploadAcademicAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const files = (req as { files?: Express.Multer.File[] }).files;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const finalized = await finalizeUploadedFiles(req, files, "academic-management");

  const attachments = finalized.map((file) => ({
    url: file.url,
    name: file.originalName,
    mimeType: file.mimeType,
    kind: file.kind,
    publicId: file.publicId
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

  const finalized = await finalizeUploadedFiles(req, files, "complaints");

  const attachments = finalized.map((file) => ({
    url: file.url,
    name: file.originalName,
    mimeType: file.mimeType,
    kind: file.kind,
    publicId: file.publicId
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
    url: processed.imageUrl,
    thumbnailUrl: processed.thumbnailUrl,
    originalName: file.originalname,
    size: processed.fileSizeBytes,
    width: processed.width,
    height: processed.height,
    publicId: processed.publicId
  });
});
