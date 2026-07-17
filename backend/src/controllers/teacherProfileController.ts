import type { Request, Response } from "express";
import { z } from "zod";
import { Teacher } from "../models/Teacher.js";
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

const loadTeacher = async (req: Request) => {
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id })).populate(
    "user",
    "-password"
  );
  if (!teacher) throw new ApiError(404, "Teacher not found");
  return teacher;
};

export const getTeacherProfile = asyncHandler(async (req: Request, res: Response) => {
  const teacher = await loadTeacher(req);
  const permissions = getHrProfilePermissions(req);

  return sendSuccess(res, "Teacher profile fetched", {
    teacher,
    permissions
  });
});

/** Persist profile photo URL immediately after file storage upload (no full form save). */
export const setTeacherPhoto = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const { photoUrl } = photoUrlSchema.parse(req.body);
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) throw new ApiError(404, "Teacher not found");

  const previous = teacher.photoUrl;
  teacher.photoUrl = photoUrl.trim();
  await teacher.save();
  await deleteReplacedMedia(previous, teacher.photoUrl);

  await recordAudit(req, {
    action: "teacher.photo.update",
    entity: "Teacher",
    entityId: teacher._id.toString(),
    after: { photoUrl: teacher.photoUrl }
  });

  await teacher.populate("user", "-password");
  return sendSuccess(res, "Teacher photo updated", { teacher, photoUrl: teacher.photoUrl });
});

export const addTeacherDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const payload = hrDocumentMutationSchema.parse(req.body);
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) throw new ApiError(404, "Teacher not found");

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const document = await addHrDocument({
    entity: teacher as never,
    payload,
    actorUserId: req.user!.userId,
    actorName: actor?.fullName ?? "Admin"
  });

  await recordAudit(req, {
    action: "teacher.document.upload",
    entity: "Teacher",
    entityId: teacher._id.toString(),
    after: { documentId: document._id, type: document.type, name: document.name }
  });

  await teacher.populate("user", "-password");
  return sendSuccess(
    res,
    "Document added",
    { document, teacher, documents: teacher.documents ?? [] },
    201
  );
});

export const replaceTeacherDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const payload = hrReplaceDocumentSchema.parse(req.body);
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) throw new ApiError(404, "Teacher not found");

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const document = await replaceHrDocument({
    entity: teacher as never,
    payload,
    actorUserId: req.user!.userId,
    actorName: actor?.fullName ?? "Admin"
  });

  await recordAudit(req, {
    action: "teacher.document.replace",
    entity: "Teacher",
    entityId: teacher._id.toString(),
    after: { documentId: document._id, url: document.url }
  });

  await teacher.populate("user", "-password");
  return sendSuccess(res, "Document replaced", {
    document,
    teacher,
    documents: teacher.documents ?? []
  });
});

export const deleteTeacherDocument = asyncHandler(async (req: Request, res: Response) => {
  assertHrDocumentManageAccess(req);
  const teacher = await Teacher.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!teacher) throw new ApiError(404, "Teacher not found");

  const removed = await deleteHrDocument({
    entity: teacher as never,
    documentId: String(req.params.documentId)
  });

  await recordAudit(req, {
    action: "teacher.document.delete",
    entity: "Teacher",
    entityId: teacher._id.toString(),
    before: { documentId: removed._id, type: removed.type, name: removed.name }
  });

  await teacher.populate("user", "-password");
  return sendSuccess(res, "Document deleted", {
    teacher,
    documents: teacher.documents ?? []
  });
});
