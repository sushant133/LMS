import type { Request, Response } from "express";
import { z } from "zod";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const rejectionSchema = z.object({
  rejectionReason: z.string().min(3, "Rejection reason must be at least 3 characters").optional()
});

export const listPendingParentRegistrations = asyncHandler(async (req: Request, res: Response) => {
  const pending = await ParentChildLink.find(withTenantScope(req, { status: "PENDING" }))
    .populate("parentUserId", "fullName email phone createdAt")
    .populate({
      path: "studentId",
      populate: { path: "user", select: "fullName" },
      select: "admissionNumber rollNumber user"
    })
    .sort({ createdAt: -1 });

  return sendSuccess(res, "Pending parent registrations fetched", pending);
});

export const approveParentRegistration = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const link = await ParentChildLink.findOne({
    _id: req.params.id,
    schoolId,
    status: "PENDING"
  });

  if (!link) {
    throw new ApiError(404, "Pending registration not found");
  }

  const parentUser = await User.findById(link.parentUserId);
  if (!parentUser || parentUser.role !== "PARENT") {
    throw new ApiError(404, "Parent account not found");
  }

  const duplicateApproved = await ParentChildLink.findOne({
    schoolId,
    parentUserId: link.parentUserId,
    studentId: link.studentId,
    status: "APPROVED",
    _id: { $ne: link._id }
  }).lean();

  if (duplicateApproved) {
    throw new ApiError(409, "This parent is already linked to the student");
  }

  link.status = "APPROVED";
  link.reviewedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  link.reviewedAt = new Date();
  link.rejectionReason = undefined;
  await link.save();

  parentUser.isActive = true;
  await parentUser.save();

  return sendSuccess(res, "Parent registration approved", {
    link,
    parent: {
      _id: parentUser._id.toString(),
      fullName: parentUser.fullName,
      email: parentUser.email
    }
  });
});

export const rejectParentRegistration = asyncHandler(async (req: Request, res: Response) => {
  const payload = rejectionSchema.parse(req.body ?? {});
  const schoolId = tenantObjectId(req);

  const link = await ParentChildLink.findOne({
    _id: req.params.id,
    schoolId,
    status: "PENDING"
  });

  if (!link) {
    throw new ApiError(404, "Pending registration not found");
  }

  link.status = "REJECTED";
  link.reviewedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  link.reviewedAt = new Date();
  link.rejectionReason = payload.rejectionReason ?? "Not approved by administrator";
  await link.save();

  return sendSuccess(res, "Parent registration rejected", link);
});