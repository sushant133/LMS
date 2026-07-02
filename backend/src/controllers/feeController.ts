import type { Request, Response } from "express";
import { feeCollectionSchema, feeStructureSchema } from "@nepal-school-erp/shared";
import { FeeCollection } from "../models/FeeCollection";
import { FeeStructure } from "../models/FeeStructure";
import { Student } from "../models/Student";
import { User } from "../models/User";
import { calculateFeeTotals } from "../utils/accountingCalculations";
import { recordAudit } from "../utils/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { ensureValidBsDate } from "../utils/nepaliDate";
import { sendSuccess } from "../utils/response";
import { tenantObjectId, withTenantScope } from "../utils/tenant";

export const listFeeStructures = asyncHandler(async (req: Request, res: Response) => {
  const structures = await FeeStructure.find(withTenantScope(req)).sort({ createdAt: -1 });
  return sendSuccess(res, "Fee structures fetched", structures);
});

export const createFeeStructure = asyncHandler(async (req: Request, res: Response) => {
  const payload = feeStructureSchema.parse(req.body);
  const structure = await FeeStructure.create({
    ...payload,
    schoolId: tenantObjectId(req)
  });
  return sendSuccess(res, "Fee structure created successfully", structure, 201);
});

export const updateFeeStructure = asyncHandler(async (req: Request, res: Response) => {
  const payload = feeStructureSchema.parse(req.body);
  const structure = await FeeStructure.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });

  if (!structure) {
    throw new ApiError(404, "Fee structure not found");
  }

  return sendSuccess(res, "Fee structure updated successfully", structure);
});

export const deleteFeeStructure = asyncHandler(async (req: Request, res: Response) => {
  const structure = await FeeStructure.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!structure) {
    throw new ApiError(404, "Fee structure not found");
  }

  return sendSuccess(res, "Fee structure deleted successfully");
});

export const listFeeCollections = asyncHandler(async (req: Request, res: Response) => {
  const collections = await FeeCollection.find(withTenantScope(req)).sort({ paidDateBs: -1 });
  return sendSuccess(res, "Fee collections fetched", collections);
});

export const collectFee = asyncHandler(async (req: Request, res: Response) => {
  const payload = feeCollectionSchema.parse(req.body);
  ensureValidBsDate(payload.paidDateBs);

  const schoolId = tenantObjectId(req);
  const [student, structure] = await Promise.all([
    Student.findOne({ _id: payload.studentId, schoolId }),
    FeeStructure.findOne({ _id: payload.feeStructureId, schoolId })
  ]);

  if (!student) {
    throw new ApiError(404, "Student not found in this school");
  }

  if (!structure) {
    throw new ApiError(404, "Fee structure not found in this school");
  }

  const previousDueNpr = student.feesDueNpr ?? 0;
  const currentChargesNpr = structure.amountNpr;
  const totals = calculateFeeTotals({
    previousDueNpr,
    currentChargesNpr,
    amountPaidNpr: payload.amountPaidNpr,
    discountNpr: payload.discountNpr,
    scholarshipNpr: payload.scholarshipNpr,
    lateFeeNpr: payload.lateFeeNpr
  });

  const actor = req.user?.userId ? await User.findById(req.user.userId).select("fullName").lean() : null;

  const collection = await FeeCollection.create({
    ...payload,
    schoolId,
    previousDueNpr,
    currentChargesNpr,
    remainingDueNpr: totals.remainingDueNpr,
    advancePaymentNpr: totals.advancePaymentNpr,
    paymentMethod: "CASH",
    feeBreakdown: [{ feeType: structure.feeType, title: structure.title, amountNpr: currentChargesNpr }],
    accountantName: actor?.fullName ?? "",
    createdBy: req.user!.userId
  });

  student.feesDueNpr = totals.remainingDueNpr;
  await student.save();

  await recordAudit(req, {
    action: "fee.collect",
    entity: "FeeCollection",
    entityId: collection._id.toString(),
    after: collection
  });

  return sendSuccess(res, "Fee collected successfully", collection, 201);
});

export const deleteFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  const collection = await FeeCollection.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!collection) {
    throw new ApiError(404, "Fee collection not found");
  }

  return sendSuccess(res, "Fee collection deleted successfully");
});
