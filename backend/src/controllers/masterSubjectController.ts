import type { Request, Response } from "express";
import { masterSubjectSchema } from "@nepal-school-erp/shared";
import { MasterSubject } from "../models/MasterSubject.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { requireCollegeInstitution } from "../utils/institution.js";
import { sendSuccess } from "../utils/response.js";
import {
  deleteProvisionedSubjectsForMaster,
  isMasterSubjectInUse,
  migrateLegacyCollegeSubjects,
  provisionMasterSubjectToAllBatches,
  syncMasterSubjectToInstances
} from "../utils/masterSubjectProvisioning.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listMasterSubjects = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const masterSubjects = await MasterSubject.find(withTenantScope(req)).sort({ yearLevel: 1, name: 1 });
  return sendSuccess(res, "Master subjects fetched", masterSubjects);
});

export const createMasterSubject = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = masterSubjectSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  if (payload.passMarks > payload.fullMarks) {
    throw new ApiError(400, "Pass marks cannot exceed full marks");
  }

  const masterSubject = await MasterSubject.create({
    ...payload,
    schoolId
  });

  await provisionMasterSubjectToAllBatches(schoolId, masterSubject.toObject());

  return sendSuccess(res, "Master subject created and assigned to all batches", masterSubject, 201);
});

export const updateMasterSubject = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = masterSubjectSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  if (payload.passMarks > payload.fullMarks) {
    throw new ApiError(400, "Pass marks cannot exceed full marks");
  }

  const existing = await MasterSubject.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) {
    throw new ApiError(404, "Master subject not found");
  }

  if (payload.yearLevel !== existing.yearLevel) {
    const inUse = await isMasterSubjectInUse(schoolId, existing._id);
    if (inUse) {
      throw new ApiError(400, "Cannot change year level while this subject is in use");
    }
    await deleteProvisionedSubjectsForMaster(schoolId, existing._id);
  }

  const masterSubject = await MasterSubject.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    payload,
    { new: true }
  );

  if (!masterSubject) {
    throw new ApiError(404, "Master subject not found");
  }

  await syncMasterSubjectToInstances(schoolId, masterSubject.toObject());

  if (payload.isActive) {
    await provisionMasterSubjectToAllBatches(schoolId, masterSubject.toObject());
  }

  return sendSuccess(res, "Master subject updated across all batches", masterSubject);
});

export const reconcileMasterSubjects = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const result = await migrateLegacyCollegeSubjects(schoolId);
  return sendSuccess(res, "Curriculum reconciled across all batches", result);
});

export const deleteMasterSubject = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const masterSubject = await MasterSubject.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!masterSubject) {
    throw new ApiError(404, "Master subject not found");
  }

  const inUse = await isMasterSubjectInUse(schoolId, masterSubject._id);
  if (inUse) {
    throw new ApiError(400, "Cannot delete master subject while it is in use. Deactivate it instead.");
  }

  await deleteProvisionedSubjectsForMaster(schoolId, masterSubject._id);
  await masterSubject.deleteOne();

  return sendSuccess(res, "Master subject deleted");
});