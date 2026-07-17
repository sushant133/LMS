import type { Request, Response } from "express";
import { z } from "zod";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  addHrDocument,
  assertHrDocumentManageAccess,
  deleteHrDocument,
  getHrProfilePermissions,
  hrDocumentMutationSchema,
  hrReplaceDocumentSchema,
  replaceHrDocument
} from "../utils/hrDocuments.js";
import { deleteReplacedMedia } from "../utils/mediaCleanup.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

const photoUrlSchema = z.object({
  photoUrl: z.string().min(1, "photoUrl is required")
});

/** Persist staff profile photo immediately after file storage upload. */
export const setCollegeStaffPhoto = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const { photoUrl } = photoUrlSchema.parse(req.body);
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) throw new ApiError(404, "College staff not found");

  const previous = staff.photoUrl;
  staff.photoUrl = photoUrl.trim();
  await staff.save();
  await deleteReplacedMedia(previous, staff.photoUrl);

  await recordAudit(req, {
    action: "collegeStaff.photo.update",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    after: { photoUrl: staff.photoUrl }
  });

  return sendSuccess(res, "Staff photo updated", { staff, photoUrl: staff.photoUrl });
});

/** Full staff profile for admin view (documents + permissions). */
export const getCollegeStaffProfile = asyncHandler(async (req: Request, res: Response) => {
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  )
    .populate("user", "-password")
    .lean();

  if (!staff) throw new ApiError(404, "College staff not found");

  const user = staff.user as Record<string, unknown> | null | undefined;
  const permissions = getHrProfilePermissions(req);

  return sendSuccess(res, "Staff profile fetched", {
    staff: {
      ...staff,
      _id: staff._id.toString(),
      schoolId: staff.schoolId.toString(),
      user: user
        ? {
            _id: String(user._id),
            schoolId: user.schoolId ? String(user.schoolId) : undefined,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            phone: user.phone,
            isActive: user.isActive,
            mustChangePassword: user.mustChangePassword,
            designation: user.designation,
            department: user.department
          }
        : undefined,
      userId: staff.user ? String((staff.user as { _id?: unknown })._id ?? staff.user) : undefined,
      documents: staff.documents ?? [],
      createdAt: staff.createdAt?.toISOString?.() ?? staff.createdAt,
      updatedAt: staff.updatedAt?.toISOString?.() ?? staff.updatedAt,
      credentialsEmailSentAt: staff.credentialsEmailSentAt
        ? new Date(staff.credentialsEmailSentAt).toISOString()
        : undefined
    },
    permissions
  });
});

export const addCollegeStaffDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const payload = hrDocumentMutationSchema.parse(req.body);
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) throw new ApiError(404, "College staff not found");

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const document = await addHrDocument({
    entity: staff as never,
    payload,
    actorUserId: req.user!.userId,
    actorName: actor?.fullName ?? "Admin"
  });

  await recordAudit(req, {
    action: "collegeStaff.document.upload",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    after: { documentId: document._id, type: document.type, name: document.name }
  });

  return sendSuccess(
    res,
    "Document added",
    { document, staff, documents: staff.documents ?? [] },
    201
  );
});

export const replaceCollegeStaffDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const payload = hrReplaceDocumentSchema.parse(req.body);
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) throw new ApiError(404, "College staff not found");

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const document = await replaceHrDocument({
    entity: staff as never,
    payload,
    actorUserId: req.user!.userId,
    actorName: actor?.fullName ?? "Admin"
  });

  await recordAudit(req, {
    action: "collegeStaff.document.replace",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    after: { documentId: document._id, url: document.url }
  });

  return sendSuccess(res, "Document replaced", {
    document,
    staff,
    documents: staff.documents ?? []
  });
});

export const deleteCollegeStaffDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) throw new ApiError(404, "College staff not found");

  const removed = await deleteHrDocument({
    entity: staff as never,
    documentId: String(req.params.documentId)
  });

  await recordAudit(req, {
    action: "collegeStaff.document.delete",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    before: { documentId: removed._id, type: removed.type, name: removed.name }
  });

  return sendSuccess(res, "Document deleted", {
    staff,
    documents: staff.documents ?? []
  });
});
