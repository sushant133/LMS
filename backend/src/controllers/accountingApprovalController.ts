import type { Request, Response } from "express";
import { z } from "zod";
import { ACCOUNTING_APPROVER_ROLES, isInstitutionAdmin, normalizeUserRole } from "@phit-erp/shared";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FinancialApproval } from "../models/FinancialApproval.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { voidFeeCollection, voidWithJournalReversal } from "../utils/accountingVoid.js";
import { withFinancialTransaction } from "../utils/financialTransaction.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const approvalRequestSchema = z.object({
  reason: z.string().min(3, "Reason must be at least 3 characters")
});

const rejectionSchema = z.object({
  rejectionReason: z.string().min(3, "Rejection reason must be at least 3 characters")
});

const canApprove = (role: string): boolean =>
  ACCOUNTING_APPROVER_ROLES.includes(normalizeUserRole(role));

const getEntityAmount = async (
  entityType: string,
  entityId: string,
  schoolId: ReturnType<typeof tenantObjectId>
): Promise<{ amountNpr: number; record: unknown; dateBs: string }> => {
  switch (entityType) {
    case "FeeCollection": {
      const record = await FeeCollection.findOne({ _id: entityId, schoolId, isDeleted: false });
      if (!record) throw new ApiError(404, "Fee collection not found");
      return { amountNpr: record.amountPaidNpr, record, dateBs: record.paidDateBs };
    }
    case "AccountingExpense": {
      const record = await AccountingExpense.findOne({ _id: entityId, schoolId, isDeleted: false });
      if (!record) throw new ApiError(404, "Expense not found");
      return { amountNpr: record.amountNpr, record, dateBs: record.dateBs };
    }
    case "AccountingPurchase": {
      const record = await AccountingPurchase.findOne({ _id: entityId, schoolId, isDeleted: false });
      if (!record) throw new ApiError(404, "Purchase not found");
      return { amountNpr: record.totalAmountNpr, record, dateBs: record.purchaseDateBs };
    }
    case "AccountingIncome": {
      const record = await AccountingIncome.findOne({ _id: entityId, schoolId, isDeleted: false });
      if (!record) throw new ApiError(404, "Income record not found");
      return { amountNpr: record.amountNpr, record, dateBs: record.dateBs };
    }
    default:
      throw new ApiError(400, "Unsupported entity type for approval");
  }
};

export const listFinancialApprovals = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { ...withTenantScope(req), isDeleted: false };
  if (typeof req.query.status === "string") {
    filter.status = req.query.status;
  }

  const approvals = await FinancialApproval.find(filter)
    .populate("requestedBy", "fullName email")
    .populate("reviewedBy", "fullName email")
    .sort({ createdAt: -1 })
    .limit(200);

  return sendSuccess(res, "Financial approvals fetched", approvals);
});

export const requestFinancialApproval = asyncHandler(async (req: Request, res: Response) => {
  const payload = approvalRequestSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const entityType = req.body.entityType as string;
  const entityId = String(req.params.entityId);
  const actionType = (req.body.actionType as "REVERSE" | "VOID") ?? "VOID";

  if (!["FeeCollection", "AccountingExpense", "AccountingPurchase", "AccountingIncome"].includes(entityType)) {
    throw new ApiError(400, "Invalid entity type");
  }

  const { amountNpr, record } = await getEntityAmount(entityType, entityId, schoolId);

  const existing = await FinancialApproval.findOne({
    schoolId,
    entityType,
    entityId,
    status: "PENDING",
    isDeleted: false
  });
  if (existing) {
    throw new ApiError(409, "An approval request is already pending for this record");
  }

  const approval = await FinancialApproval.create({
    schoolId,
    entityType,
    entityId,
    actionType,
    amountNpr,
    reason: payload.reason,
    requestedBy: req.user!.userId,
    beforeSnapshot: record
  });

  await recordAudit(req, {
    action: "accounting.approval.request",
    entity: "FinancialApproval",
    entityId: approval._id.toString(),
    after: approval
  });

  return sendSuccess(res, "Approval request submitted", approval, 201);
});

export const approveFinancialApproval = asyncHandler(async (req: Request, res: Response) => {
  if (!canApprove(req.user!.role)) {
    throw new ApiError(403, "Only Principal or Finance Administrator can approve");
  }

  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const approval = await FinancialApproval.findOne({
    _id: req.params.id,
    schoolId,
    status: "PENDING",
    isDeleted: false
  });
  if (!approval) throw new ApiError(404, "Pending approval not found");

  const before = approval.toObject();

  await withFinancialTransaction(async (session) => {
    const { record, dateBs } = await getEntityAmount(
      approval.entityType,
      approval.entityId.toString(),
      schoolId
    );

    if (approval.entityType === "FeeCollection") {
      await voidFeeCollection(req, record as InstanceType<typeof FeeCollection>, schoolId, userId, approval.reason, session);
    } else {
      await voidWithJournalReversal(
        req,
        record as Parameters<typeof voidWithJournalReversal>[1],
        schoolId,
        userId,
        approval.entityType as "AccountingExpense" | "AccountingIncome" | "AccountingPurchase",
        approval.reason,
        dateBs,
        session
      );
    }

    approval.status = "APPROVED";
    approval.reviewedBy = userId;
    approval.reviewedAt = new Date();
    await approval.save(session ? { session } : undefined);
  });

  await recordAudit(req, {
    action: "accounting.approval.approve",
    entity: "FinancialApproval",
    entityId: approval._id.toString(),
    before,
    after: approval
  });

  return sendSuccess(res, "Transaction approved and reversed", approval);
});

export const rejectFinancialApproval = asyncHandler(async (req: Request, res: Response) => {
  if (!canApprove(req.user!.role)) {
    throw new ApiError(403, "Only Principal or Finance Administrator can reject");
  }

  const payload = rejectionSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  const approval = await FinancialApproval.findOne({
    _id: req.params.id,
    schoolId,
    status: "PENDING",
    isDeleted: false
  });
  if (!approval) throw new ApiError(404, "Pending approval not found");

  const before = approval.toObject();
  approval.status = "REJECTED";
  approval.reviewedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  approval.reviewedAt = new Date();
  approval.rejectionReason = payload.rejectionReason;
  await approval.save();

  await recordAudit(req, {
    action: "accounting.approval.reject",
    entity: "FinancialApproval",
    entityId: approval._id.toString(),
    before,
    after: approval
  });

  return sendSuccess(res, "Approval request rejected", approval);
});

/** Returns whether the current user can execute immediately or must request approval */
export const needsApprovalForAmount = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  amountNpr: number,
  userRole: string
): Promise<boolean> => {
  if (isInstitutionAdmin(userRole) || canApprove(userRole)) return false;
  const settings = await AccountingSettings.findOne({ schoolId }).lean();
  const threshold = settings?.approvalThresholdNpr ?? 25000;
  return amountNpr >= threshold;
};