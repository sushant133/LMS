import type { Request, Response } from "express";
import path from "path";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import { ApiError } from "../utils/apiError.js";
import { getFilePublicPath, getUploadPublicUrl, inferAttachmentKind } from "../utils/upload.js";
import { recordAudit } from "../utils/audit.js";

export const uploadStudentPhotoHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    throw new ApiError(400, "No photo file uploaded");
  }

  const relativePath = path.relative(process.cwd(), file.path);
  const publicUrl = getFilePublicPath(relativePath);

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
  const files = (req as any).files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    throw new ApiError(400, "No document files uploaded");
  }

  const uploaded = files.map((file) => {
    const relativePath = path.relative(process.cwd(), file.path);
    return {
      url: getFilePublicPath(relativePath),
      originalName: file.originalname,
      size: file.size,
      type: (Array.isArray(req.body.documentType) ? req.body.documentType[0] : req.body.documentType) || "Other"
    };
  });

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
