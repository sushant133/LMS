import crypto from "crypto";
import type { Request } from "express";
import { z } from "zod";
import {
  getHrDocumentCategoryLabel,
  HR_DOCUMENT_CATEGORIES
} from "@phit-erp/shared";
import { ApiError } from "./apiError.js";
import { deleteReplacedMedia, deleteStoredMediaUrl } from "./mediaCleanup.js";

export const hrDocumentMutationSchema = z.object({
  type: z.string(),
  name: z.string().min(1),
  url: z.string().min(1),
  originalName: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().min(0),
  status: z.enum(["UPLOADED", "VERIFIED", "REJECTED", "PENDING"]).optional()
});

export const hrReplaceDocumentSchema = hrDocumentMutationSchema.extend({
  documentId: z.string().min(1)
});

export type HrDocFields = {
  _id?: string;
  type: string;
  name: string;
  url?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  status?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  uploadedByName?: string;
  notes?: string;
};

type EntityWithDocs = {
  photoUrl?: string | null;
  documents: HrDocFields[];
  markModified: (path: string) => void;
  save: () => Promise<unknown>;
  _id: { toString: () => string };
};

export const assertHrDocumentManageAccess = (req: Request): void => {
  const role = req.user?.role;
  if (role !== "SUPER_ADMIN" && role !== "COLLEGE_ADMIN") {
    throw new ApiError(403, "Only admins can manage documents");
  }
};

export const getHrProfilePermissions = (req: Request) => {
  const role = req.user?.role ?? "";
  const isAdminLike = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"].includes(role);
  return {
    canManageDocuments: role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN",
    canViewDocuments: isAdminLike
  };
};

const isPhotoType = (type: string) => type === "PROFILE_PHOTOGRAPH";

export const addHrDocument = async (params: {
  entity: EntityWithDocs;
  payload: z.infer<typeof hrDocumentMutationSchema>;
  actorUserId: string;
  actorName: string;
}): Promise<HrDocFields> => {
  const { entity, payload, actorUserId, actorName } = params;
  const category = HR_DOCUMENT_CATEGORIES.find((item) => item.key === payload.type);
  if (!category) throw new ApiError(400, "Invalid document category");

  if (!Array.isArray(entity.documents)) {
    entity.documents = [];
  }

  const uploadedFields: HrDocFields = {
    type: payload.type,
    name: payload.name || getHrDocumentCategoryLabel(payload.type),
    url: payload.url,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    size: payload.size,
    status: payload.status ?? "UPLOADED",
    uploadedAt: new Date().toISOString(),
    uploadedBy: actorUserId,
    uploadedByName: actorName
  };

  const pendingIndex = entity.documents.findIndex(
    (doc) => doc.type === payload.type && (doc.status === "PENDING" || !doc.url)
  );

  let document: HrDocFields;
  let previousMediaUrl: string | undefined;

  if (pendingIndex >= 0) {
    const existing = entity.documents[pendingIndex]!;
    previousMediaUrl = existing.url || undefined;
    Object.assign(existing, uploadedFields);
    document = existing;
    entity.markModified("documents");
  } else {
    const existingOfType = entity.documents.filter((doc) => doc.type === payload.type);
    if (!category.allowMultiple && existingOfType.length > 0) {
      throw new ApiError(409, "A document of this category already exists. Use replace instead.");
    }

    document = {
      _id: crypto.randomUUID(),
      ...uploadedFields
    };
    entity.documents.push(document);
  }

  if (isPhotoType(payload.type)) {
    previousMediaUrl = previousMediaUrl || entity.photoUrl || undefined;
    entity.photoUrl = payload.url;
  }

  await entity.save();
  await deleteReplacedMedia(previousMediaUrl, payload.url);
  return document;
};

export const replaceHrDocument = async (params: {
  entity: EntityWithDocs;
  payload: z.infer<typeof hrReplaceDocumentSchema>;
  actorUserId: string;
  actorName: string;
}): Promise<HrDocFields> => {
  const { entity, payload, actorUserId, actorName } = params;
  if (!Array.isArray(entity.documents)) {
    entity.documents = [];
  }

  const index = entity.documents.findIndex((doc) => doc._id === payload.documentId);
  if (index < 0) throw new ApiError(404, "Document not found");

  const previous = entity.documents[index]!;
  const previousUrl = previous.url;
  Object.assign(previous, {
    type: payload.type || previous.type,
    name: payload.name || previous.name,
    url: payload.url,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    size: payload.size,
    status: payload.status ?? "UPLOADED",
    uploadedAt: new Date().toISOString(),
    uploadedBy: actorUserId,
    uploadedByName: actorName
  });

  entity.markModified("documents");
  if (isPhotoType(previous.type ?? "")) {
    entity.photoUrl = previous.url;
  }
  await entity.save();
  await deleteReplacedMedia(previousUrl, payload.url);
  return previous;
};

export const deleteHrDocument = async (params: {
  entity: EntityWithDocs;
  documentId: string;
}): Promise<HrDocFields> => {
  const { entity, documentId } = params;
  if (!Array.isArray(entity.documents)) {
    entity.documents = [];
  }

  const index = entity.documents.findIndex((doc) => doc._id === documentId);
  if (index < 0) throw new ApiError(404, "Document not found");

  const removed = entity.documents[index]!;
  const removedUrl = removed.url;
  entity.documents.splice(index, 1);

  if (isPhotoType(removed.type ?? "")) {
    const photoDoc = entity.documents.find(
      (doc) => isPhotoType(doc.type ?? "") && doc.status !== "PENDING" && doc.url
    );
    entity.photoUrl = photoDoc?.url || undefined;
  }

  await entity.save();
  if (removedUrl && entity.photoUrl !== removedUrl) {
    await deleteStoredMediaUrl(removedUrl);
  } else if (removedUrl && !entity.photoUrl) {
    await deleteStoredMediaUrl(removedUrl);
  }

  return removed;
};
