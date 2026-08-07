import type { Request, Response } from "express";
import {
  libraryIssueLimitConfigUpdateSchema,
  libraryIssueLimitExceptionSchema,
  libraryIssueLimitExceptionUpdateSchema
} from "@phit-erp/shared";
import { LibraryIssueLimitConfig } from "../models/LibraryIssueLimitConfig.js";
import { LibraryIssueLimitException } from "../models/LibraryIssueLimitException.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  enrichException,
  getOrCreateIssueLimitConfig,
  resolveStudentBorrowStatus
} from "../utils/libraryIssueLimits.js";

/** GET year-wise issue limits (admin + library staff). */
export const getIssueLimits = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req).toString();
  const config = await getOrCreateIssueLimitConfig(schoolId);

  let updatedByName: string | undefined;
  if (config.updatedBy) {
    try {
      const u = await User.findById(config.updatedBy).select("fullName").lean();
      updatedByName = u?.fullName;
    } catch {
      // non-fatal
    }
  }

  return sendSuccess(res, "Library issue limits fetched", {
    _id: config._id,
    schoolId,
    limits: config.limits,
    updatedBy: config.updatedBy,
    updatedByName,
    updatedAt: config.updatedAt ?? null,
    createdAt: config.createdAt ?? null
  });
});

/** PUT year-wise issue limits (admin / super admin only). */
export const updateIssueLimits = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryIssueLimitConfigUpdateSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const before = await getOrCreateIssueLimitConfig(schoolId.toString());

  const doc = await LibraryIssueLimitConfig.findOneAndUpdate(
    { schoolId },
    {
      $set: {
        limits: payload.limits,
        updatedBy: req.user!.userId
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (!doc) throw new ApiError(500, "Could not save issue limits");

  await recordAudit(req, {
    action: "library.issue_limits.update",
    entity: "LibraryIssueLimitConfig",
    entityId: doc._id.toString(),
    before: { limits: before.limits },
    after: { limits: doc.limits }
  });

  let updatedByName: string | undefined;
  if (doc.updatedBy) {
    const u = await User.findById(doc.updatedBy).select("fullName").lean();
    updatedByName = u?.fullName;
  }

  return sendSuccess(res, "Library issue limits updated", {
    _id: doc._id.toString(),
    schoolId: schoolId.toString(),
    limits: doc.limits,
    updatedBy: doc.updatedBy?.toString(),
    updatedByName,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt
  });
});

/** GET student exceptions (admin full list; library staff may list for context if needed — admin only for management UI). */
export const listIssueLimitExceptions = asyncHandler(
  async (req: Request, res: Response) => {
    const schoolId = tenantObjectId(req);
    const filter: Record<string, unknown> = { schoolId };

    if (typeof req.query.studentId === "string" && req.query.studentId.trim()) {
      filter.studentId = req.query.studentId.trim();
    }
    if (req.query.includeRevoked !== "1" && req.query.includeRevoked !== "true") {
      filter.isRevoked = false;
    }

    const rows = await LibraryIssueLimitException.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const enriched = await Promise.all(
      rows.map((r) => enrichException(schoolId.toString(), r as Record<string, unknown>))
    );

    return sendSuccess(res, "Issue limit exceptions fetched", {
      records: enriched,
      total: enriched.length
    });
  }
);

export const createIssueLimitException = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = libraryIssueLimitExceptionSchema.parse(req.body);
    ensureValidBsDate(payload.effectiveFromBs);
    if (payload.effectiveUntilBs?.trim()) {
      ensureValidBsDate(payload.effectiveUntilBs.trim());
    }

    const schoolId = tenantObjectId(req);
    const student = await Student.findOne(
      withTenantScope(req, { _id: payload.studentId })
    ).lean();
    if (!student) throw new ApiError(404, "Student not found");

    const created = await LibraryIssueLimitException.create({
      schoolId,
      studentId: payload.studentId,
      additionalBooks: payload.additionalBooks,
      reason: payload.reason.trim(),
      effectiveFromBs: payload.effectiveFromBs,
      effectiveUntilBs: (payload.effectiveUntilBs ?? "").trim(),
      remarks: (payload.remarks ?? "").trim(),
      isRevoked: false,
      createdBy: req.user!.userId,
      updatedBy: req.user!.userId
    });

    await recordAudit(req, {
      action: "library.issue_limit_exception.create",
      entity: "LibraryIssueLimitException",
      entityId: created._id.toString(),
      after: created.toObject()
    });

    const enriched = await enrichException(
      schoolId.toString(),
      created.toObject() as Record<string, unknown>
    );
    return sendSuccess(res, "Issue limit exception granted", enriched, 201);
  }
);

export const updateIssueLimitException = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = libraryIssueLimitExceptionUpdateSchema.parse(req.body);
    const schoolId = tenantObjectId(req);

    const doc = await LibraryIssueLimitException.findOne({
      _id: req.params.id,
      schoolId
    });
    if (!doc) throw new ApiError(404, "Exception not found");

    const before = doc.toObject();

    if (payload.additionalBooks !== undefined) {
      doc.additionalBooks = payload.additionalBooks;
    }
    if (payload.reason !== undefined) doc.reason = payload.reason.trim();
    if (payload.effectiveFromBs !== undefined) {
      ensureValidBsDate(payload.effectiveFromBs);
      doc.effectiveFromBs = payload.effectiveFromBs;
    }
    if (payload.effectiveUntilBs !== undefined) {
      const until = payload.effectiveUntilBs.trim();
      if (until) ensureValidBsDate(until);
      doc.effectiveUntilBs = until;
    }
    if (payload.remarks !== undefined) doc.remarks = payload.remarks.trim();

    if (payload.isRevoked === true && !doc.isRevoked) {
      doc.isRevoked = true;
      doc.revokedAt = new Date();
      doc.revokedBy = req.user!.userId as never;
    }
    if (payload.isRevoked === false && doc.isRevoked) {
      doc.isRevoked = false;
      doc.revokedAt = undefined;
      doc.revokedBy = undefined;
    }

    doc.updatedBy = req.user!.userId as never;
    await doc.save();

    await recordAudit(req, {
      action: doc.isRevoked
        ? "library.issue_limit_exception.revoke"
        : "library.issue_limit_exception.update",
      entity: "LibraryIssueLimitException",
      entityId: doc._id.toString(),
      before,
      after: doc.toObject()
    });

    const enriched = await enrichException(
      schoolId.toString(),
      doc.toObject() as Record<string, unknown>
    );
    return sendSuccess(
      res,
      doc.isRevoked ? "Exception revoked" : "Exception updated",
      enriched
    );
  }
);

export const revokeIssueLimitException = asyncHandler(
  async (req: Request, res: Response) => {
    const schoolId = tenantObjectId(req);
    const doc = await LibraryIssueLimitException.findOne({
      _id: req.params.id,
      schoolId
    });
    if (!doc) throw new ApiError(404, "Exception not found");
    if (doc.isRevoked) {
      return sendSuccess(res, "Exception already revoked", await enrichException(
        schoolId.toString(),
        doc.toObject() as Record<string, unknown>
      ));
    }

    const before = doc.toObject();
    doc.isRevoked = true;
    doc.revokedAt = new Date();
    doc.revokedBy = req.user!.userId as never;
    doc.updatedBy = req.user!.userId as never;
    await doc.save();

    await recordAudit(req, {
      action: "library.issue_limit_exception.revoke",
      entity: "LibraryIssueLimitException",
      entityId: doc._id.toString(),
      before,
      after: doc.toObject()
    });

    const enriched = await enrichException(
      schoolId.toString(),
      doc.toObject() as Record<string, unknown>
    );
    return sendSuccess(res, "Exception revoked", enriched);
  }
);

/** Borrowing status for issue screen / validation. */
export const getStudentBorrowStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const schoolId = tenantObjectId(req).toString();
    const studentId = String(req.params.studentId ?? "").trim();
    if (!studentId) throw new ApiError(400, "studentId is required");

    const student = await Student.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw new ApiError(404, "Student not found");

    const status = await resolveStudentBorrowStatus({ schoolId, studentId });
    return sendSuccess(res, "Student borrow status fetched", status);
  }
);
