import type { Request, Response } from "express";
import { feeStructureSchema } from "@phit-erp/shared";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { recordAudit } from "../utils/audit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

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
  const structure = await FeeStructure.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!structure) {
    throw new ApiError(404, "Fee structure not found");
  }

  const linkedCollections = await FeeCollection.countDocuments({
    schoolId: structure.schoolId,
    feeStructureId: structure._id,
    isDeleted: false
  });
  if (linkedCollections > 0) {
    throw new ApiError(
      400,
      `Cannot delete fee structure with ${linkedCollections} active collection(s). Archive it instead (set inactive via update).`
    );
  }

  await structure.deleteOne();
  await recordAudit(req, {
    action: "fee.structure.delete",
    entity: "FeeStructure",
    entityId: structure._id.toString()
  });
  return sendSuccess(res, "Fee structure deleted successfully");
});

export const listFeeCollections = asyncHandler(async (req: Request, res: Response) => {
  const collections = await FeeCollection.find(withTenantScope(req, { isDeleted: false })).sort({ paidDateBs: -1 });
  return sendSuccess(res, "Fee collections fetched", collections);
});

export const collectFee = asyncHandler(async (_req: Request, _res: Response) => {
  // Legacy endpoint: redirect clients to accounting fee collection (posts GL + cash book)
  throw new ApiError(
    410,
    "Legacy fee collection is disabled. Use POST /accounting/collections so cash book and journal stay in sync."
  );
});

export const deleteFeeCollection = asyncHandler(async (_req: Request, _res: Response) => {
  // Never hard-delete financial documents
  throw new ApiError(
    410,
    "Hard delete of fee collections is disabled. Use POST /accounting/collections/:id/reverse to void with audit trail."
  );
});
