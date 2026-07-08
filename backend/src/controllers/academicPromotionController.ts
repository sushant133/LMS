import type { Request, Response } from "express";
import {
  DEFAULT_ACADEMIC_YEAR_BS,
  academicPromotionExecuteSchema,
  academicPromotionRollbackSchema
} from "@phit-erp/shared";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  buildPromotionPreview,
  executePromotion,
  getPromotionById,
  listPromotionHistory,
  rollbackLatestPromotion
} from "../utils/academicPromotionService.js";
import {
  buildPromotionSuccessMessage,
  notifyAcademicPromotionStakeholders
} from "../utils/academicPromotionNotifications.js";
import { requireCollegeInstitution } from "../utils/institution.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const resolveActorName = async (req: Request): Promise<string> => {
  if (!req.user?.userId) {
    return "Administrator";
  }
  const user = await User.findById(req.user.userId).select("fullName").lean();
  return user?.fullName || req.user.email || "Administrator";
};

export const getPromotionPreview = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const academicSessionBs =
    typeof req.query.academicSessionBs === "string" && req.query.academicSessionBs.trim()
      ? req.query.academicSessionBs.trim()
      : DEFAULT_ACADEMIC_YEAR_BS;

  const preview = await buildPromotionPreview({ schoolId, academicSessionBs });
  return sendSuccess(res, "Promotion preview generated", preview);
});

export const listPromotions = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const history = await listPromotionHistory(schoolId);
  return sendSuccess(res, "Promotion history fetched", history);
});

export const getPromotion = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const promotionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!promotionId) {
    throw new ApiError(400, "Promotion id is required");
  }
  const promotion = await getPromotionById(schoolId, promotionId);

  if (!promotion) {
    throw new ApiError(404, "Promotion record not found");
  }

  return sendSuccess(res, "Promotion record fetched", promotion);
});

export const runPromotion = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = academicPromotionExecuteSchema.parse(req.body);
  const promotedByName = await resolveActorName(req);

  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const { promotion, feeStructuresCreated } = await executePromotion({
    schoolId,
    academicSessionBs: payload.academicSessionBs,
    promotedBy: req.user.userId,
    promotedByName,
    remarks: payload.remarks
  });

  await recordAudit(req, {
    action: "academic.promotion.execute",
    entity: "AcademicPromotion",
    entityId: promotion._id,
    before: null,
    after: {
      academicSessionBs: promotion.academicSessionBs,
      totalStudents: promotion.totalStudents,
      groups: promotion.groups.map((group) => ({
        batchName: group.batchName,
        previousYearName: group.previousYearName,
        newYearName: group.newYearName,
        outcome: group.outcome,
        studentCount: group.studentCount
      })),
      feeStructuresCreated
    }
  });

  const message = buildPromotionSuccessMessage(promotion.groups);
  try {
    await notifyAcademicPromotionStakeholders({
      schoolId: schoolId.toString(),
      title: "Academic Promotion Completed",
      message,
      promotionId: promotion._id,
      academicSessionBs: promotion.academicSessionBs
    });
  } catch (error) {
    console.error("Promotion notification failed:", error);
  }

  return sendSuccess(
    res,
    "Academic year promotion completed successfully",
    {
      promotion,
      feeStructuresCreated,
      notificationMessage: message
    },
    201
  );
});

export const rollbackPromotion = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = academicPromotionRollbackSchema.parse(req.body ?? {});
  const rolledBackByName = await resolveActorName(req);

  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const { promotion, restoredStudents } = await rollbackLatestPromotion({
    schoolId,
    rolledBackBy: req.user.userId,
    rolledBackByName,
    remarks: payload.remarks
  });

  await recordAudit(req, {
    action: "academic.promotion.rollback",
    entity: "AcademicPromotion",
    entityId: promotion._id,
    before: {
      status: "COMPLETED",
      totalStudents: promotion.totalStudents,
      academicSessionBs: promotion.academicSessionBs
    },
    after: {
      status: "ROLLED_BACK",
      restoredStudents,
      rollbackRemarks: payload.remarks
    }
  });

  try {
    await notifyAcademicPromotionStakeholders({
      schoolId: schoolId.toString(),
      title: "Academic Promotion Rolled Back",
      message: `The most recent academic promotion for session ${promotion.academicSessionBs} was rolled back. ${restoredStudents} student record(s) were restored.`,
      promotionId: promotion._id,
      academicSessionBs: promotion.academicSessionBs
    });
  } catch (error) {
    console.error("Rollback notification failed:", error);
  }

  return sendSuccess(res, "Promotion rolled back successfully", {
    promotion,
    restoredStudents
  });
});
