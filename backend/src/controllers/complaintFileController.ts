import type { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { hasInstitutionAccess } from "@phit-erp/shared";
import { Complaint } from "../models/Complaint.js";
import { getUploadDir } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";

export const serveComplaintAttachment = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  const schoolId = typeof req.params.schoolId === "string" ? req.params.schoolId : "";
  const filename = typeof req.params.filename === "string" ? req.params.filename : "";
  if (!schoolId || !filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new ApiError(400, "Invalid file path");
  }

  if (req.user.role !== "SUPER_ADMIN" && req.user.schoolId !== schoolId) {
    throw new ApiError(403, "Access denied");
  }

  const publicPath = `/uploads/${schoolId}/complaints/${filename}`;
  const canViewAll = hasInstitutionAccess(req.user.role);

  if (!canViewAll) {
    const complaint = await Complaint.findOne({
      schoolId,
      submittedBy: req.user.userId,
      attachments: { $elemMatch: { url: publicPath } }
    }).lean();

    if (!complaint) {
      throw new ApiError(403, "Access denied");
    }
  }

  const uploadsDir = getUploadDir();
  const filePath = path.join(uploadsDir, schoolId, "complaints", filename);

  if (!(await fs.pathExists(filePath))) {
    throw new ApiError(404, "File not found");
  }

  return res.sendFile(filePath);
});