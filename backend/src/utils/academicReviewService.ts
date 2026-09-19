import type { Request } from "express";
import mongoose from "mongoose";
import {
  type AcademicApprovalQueue,
  type AcademicBulkReviewResult,
  type AcademicManagementFilters
} from "@phit-erp/shared";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { ApiError } from "./apiError.js";
import { tenantObjectId } from "./tenant.js";
import {
  applyOfficialPlanScopeToFilter,
  applyLogBookListScope,
  assertApprovableStatus,
  assertVerifiablePlanStatus,
  actorIsAcademicAdmin,
  actorIsInstitutionApprover,
  buildAcademicFilter,
  notifyAdminsOfPendingAcademic,
  notifyTeacherOfAcademicDecision,
  recordApproval,
  resyncSessionPlansTouchedByLog,
  serializeLessonPlan,
  serializeLogBookEntry,
  serializeSessionPlan,
  syncLessonPlanItemProgress,
  syncSyllabusCompletionForLogEntry
} from "./academicManagementService.js";
import { getTodayBs } from "./nepaliDate.js";
import { User } from "../models/User.js";

const actorObjectId = (req: Request): mongoose.Types.ObjectId =>
  new mongoose.Types.ObjectId(req.user!.userId);

const actorName = async (req: Request): Promise<string> => {
  const user = await User.findById(req.user!.userId).select("fullName email").lean();
  return user?.fullName ?? user?.email ?? "User";
};

export const assertCanVerifyAcademic = async (req: Request): Promise<void> => {
  if (!(await actorIsAcademicAdmin(req))) {
    throw new ApiError(
      403,
      "Only people with Academic Management access can verify records"
    );
  }
};

export const assertCanApproveAcademic = async (req: Request): Promise<void> => {
  if (!(await actorIsInstitutionApprover(req))) {
    throw new ApiError(403, "Only Administrator and Super Admin can approve records");
  }
};

export const getAcademicApprovalQueue = async (
  req: Request,
  filters: AcademicManagementFilters
): Promise<AcademicApprovalQueue> => {
  await assertCanVerifyAcademic(req);
  const planFilter = buildAcademicFilter(req, filters);
  await applyOfficialPlanScopeToFilter(req, planFilter, filters.teacherId);
  const logFilter = { ...planFilter };
  if (filters.status) {
    delete logFilter.status;
  }
  await applyLogBookListScope(req, logFilter);
  delete logFilter.month;
  delete logFilter.status;

  const [
    sessionAwaitingVerify,
    lessonAwaitingVerify,
    logAwaitingVerify,
    sessionAwaitingApprove,
    lessonAwaitingApprove,
    logAwaitingApprove
  ] = await Promise.all([
    AcademicSessionPlan.countDocuments({
      ...planFilter,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    }),
    AcademicLessonPlan.countDocuments({
      ...planFilter,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    }),
    AcademicLogBookEntry.countDocuments({ ...logFilter, reviewStatus: "PENDING" }),
    AcademicSessionPlan.countDocuments({ ...planFilter, status: "VERIFIED" }),
    AcademicLessonPlan.countDocuments({ ...planFilter, status: "VERIFIED" }),
    AcademicLogBookEntry.countDocuments({
      ...logFilter,
      reviewStatus: { $in: ["VERIFIED", "REVIEWED"] }
    })
  ]);

  return {
    awaitingVerification: {
      sessionPlans: sessionAwaitingVerify,
      lessonPlans: lessonAwaitingVerify,
      logBooks: logAwaitingVerify
    },
    awaitingApproval: {
      sessionPlans: sessionAwaitingApprove,
      lessonPlans: lessonAwaitingApprove,
      logBooks: logAwaitingApprove
    }
  };
};

const stampVerified = async (req: Request) => {
  const name = await actorName(req);
  return {
    name,
    audit: {
      verifiedBy: actorObjectId(req),
      verifiedAt: new Date(),
      updatedBy: actorObjectId(req)
    }
  };
};

export const verifySessionPlanById = async (req: Request, id: string) => {
  await assertCanVerifyAcademic(req);
  const existing = await AcademicSessionPlan.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Session plan not found");
  assertVerifiablePlanStatus(existing.status);
  const stamp = await stampVerified(req);
  existing.status = "VERIFIED";
  existing.verifiedByName = stamp.name;
  existing.audit = { ...existing.audit, ...stamp.audit };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "VERIFIED");
  await notifyTeacherOfAcademicDecision(req, {
    kind: "SESSION_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.academicYearBs,
    action: "VERIFIED",
    entityId: existing._id.toString()
  });
  await notifyAdminsOfPendingAcademic(req, {
    kind: "SESSION_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: `${existing.academicYearBs} · verified, waiting for approval`,
    entityId: existing._id.toString()
  });
  return serializeSessionPlan(existing._id.toString());
};

export const verifyLessonPlanById = async (req: Request, id: string) => {
  await assertCanVerifyAcademic(req);
  const existing = await AcademicLessonPlan.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Lesson plan not found");
  assertVerifiablePlanStatus(existing.status);
  const stamp = await stampVerified(req);
  existing.status = "VERIFIED";
  existing.checkedBy = stamp.name;
  existing.set("verifiedByName", stamp.name);
  existing.audit = { ...existing.audit, ...stamp.audit };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "VERIFIED");
  await notifyTeacherOfAcademicDecision(req, {
    kind: "LESSON_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.teachingDateBs || existing.month,
    action: "VERIFIED",
    entityId: existing._id.toString()
  });
  await notifyAdminsOfPendingAcademic(req, {
    kind: "LESSON_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: `${existing.teachingDateBs || existing.month || ""} · verified, waiting for approval`.trim(),
    entityId: existing._id.toString()
  });
  return serializeLessonPlan(existing._id.toString());
};

export const verifyLogBookById = async (req: Request, id: string, remarks?: string) => {
  await assertCanVerifyAcademic(req);
  const existing = await AcademicLogBookEntry.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Log book entry not found");
  const status = String(existing.reviewStatus || "");
  if (status !== "PENDING") {
    throw new ApiError(400, "Only pending log book entries can be verified");
  }
  const stamp = await stampVerified(req);
  existing.reviewStatus = "VERIFIED";
  existing.verifiedByName = stamp.name;
  if (remarks?.trim()) existing.adminRemarks = remarks.trim();
  existing.audit = { ...existing.audit, ...stamp.audit };
  await existing.save();
  await recordApproval(req, "LOG_BOOK_ENTRY", existing._id.toString(), "VERIFIED", remarks);
  await notifyTeacherOfAcademicDecision(req, {
    kind: "LOG_BOOK",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.dateBs,
    action: "VERIFIED",
    remarks,
    entityId: existing._id.toString()
  });
  return serializeLogBookEntry(existing._id.toString());
};

const approveSessionPlanDoc = async (
  req: Request,
  existing: InstanceType<typeof AcademicSessionPlan>,
  remarks?: string
) => {
  assertApprovableStatus(existing.status);
  existing.status = "APPROVED";
  if (remarks) existing.adminRemarks = remarks;
  existing.audit = {
    ...existing.audit,
    approvedBy: actorObjectId(req),
    approvedAt: new Date(),
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "APPROVED", remarks);
  await notifyTeacherOfAcademicDecision(req, {
    kind: "SESSION_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.academicYearBs,
    action: "APPROVED",
    entityId: existing._id.toString()
  });
};

export const approveSessionPlanById = async (req: Request, id: string, remarks?: string) => {
  await assertCanApproveAcademic(req);
  const existing = await AcademicSessionPlan.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Session plan not found");
  await approveSessionPlanDoc(req, existing, remarks);
  return serializeSessionPlan(existing._id.toString());
};

const approveLessonPlanDoc = async (
  req: Request,
  existing: InstanceType<typeof AcademicLessonPlan>,
  remarks?: string
) => {
  assertApprovableStatus(existing.status);
  existing.status = "APPROVED";
  if (remarks) existing.adminRemarks = remarks;
  existing.approvedByName = await actorName(req);
  existing.approvalDate = getTodayBs();
  existing.audit = {
    ...existing.audit,
    approvedBy: actorObjectId(req),
    approvedAt: new Date(),
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "APPROVED", remarks);
  await notifyTeacherOfAcademicDecision(req, {
    kind: "LESSON_PLAN",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.teachingDateBs || existing.month,
    action: "APPROVED",
    entityId: existing._id.toString()
  });
};

export const approveLessonPlanById = async (req: Request, id: string, remarks?: string) => {
  await assertCanApproveAcademic(req);
  const existing = await AcademicLessonPlan.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Lesson plan not found");
  await approveLessonPlanDoc(req, existing, remarks);
  return serializeLessonPlan(existing._id.toString());
};

const approveLogBookDoc = async (
  req: Request,
  existing: InstanceType<typeof AcademicLogBookEntry>,
  remarks?: string
) => {
  const status = String(existing.reviewStatus || "");
  if (status !== "VERIFIED" && status !== "REVIEWED") {
    throw new ApiError(
      400,
      status === "PENDING"
        ? "This log book entry must be verified before an Administrator or Super Admin can approve it."
        : "Only verified log book entries can be approved."
    );
  }
  const name = await actorName(req);
  existing.reviewStatus = "APPROVED";
  existing.adminSignature = name;
  if (remarks?.trim()) existing.adminRemarks = remarks.trim();
  existing.audit = {
    ...existing.audit,
    approvedBy: actorObjectId(req),
    approvedAt: new Date(),
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  if (existing.lessonPlanItemId) {
    await syncLessonPlanItemProgress(existing.lessonPlanItemId.toString());
  }
  // Approval is the moment the class reaches the official syllabus.
  await syncSyllabusCompletionForLogEntry(tenantObjectId(req), existing);
  await resyncSessionPlansTouchedByLog({
    schoolId: tenantObjectId(req).toString(),
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    sessionPlanUnitId: existing.sessionPlanUnitId?.toString(),
    syllabusUnitId: existing.syllabusUnitId?.toString()
  });
  await recordApproval(req, "LOG_BOOK_ENTRY", existing._id.toString(), "APPROVED", remarks);
  await notifyTeacherOfAcademicDecision(req, {
    kind: "LOG_BOOK",
    teacherId: existing.teacherId.toString(),
    subjectId: existing.subjectId.toString(),
    extra: existing.dateBs,
    action: "APPROVED",
    remarks,
    entityId: existing._id.toString()
  });
};

export const approveLogBookById = async (req: Request, id: string, remarks?: string) => {
  await assertCanApproveAcademic(req);
  const existing = await AcademicLogBookEntry.findOne({
    _id: id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Log book entry not found");
  await approveLogBookDoc(req, existing, remarks);
  return serializeLogBookEntry(existing._id.toString());
};

export const bulkVerifyAcademic = async (
  req: Request,
  filters: AcademicManagementFilters
): Promise<AcademicBulkReviewResult> => {
  await assertCanVerifyAcademic(req);
  const planFilter = buildAcademicFilter(req, filters);
  await applyOfficialPlanScopeToFilter(req, planFilter, filters.teacherId);
  const logFilter = { ...planFilter };
  delete logFilter.status;
  await applyLogBookListScope(req, logFilter);
  delete logFilter.month;
  delete logFilter.status;

  const [sessionPlans, lessonPlans, logBooks] = await Promise.all([
    AcademicSessionPlan.find({
      ...planFilter,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    }),
    AcademicLessonPlan.find({
      ...planFilter,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    }),
    AcademicLogBookEntry.find({ ...logFilter, reviewStatus: "PENDING" })
  ]);

  for (const plan of sessionPlans) {
    await verifySessionPlanById(req, plan._id.toString());
  }
  for (const plan of lessonPlans) {
    await verifyLessonPlanById(req, plan._id.toString());
  }
  for (const entry of logBooks) {
    await verifyLogBookById(req, entry._id.toString());
  }

  return {
    sessionPlans: sessionPlans.length,
    lessonPlans: lessonPlans.length,
    logBooks: logBooks.length
  };
};

export const bulkApproveAcademic = async (
  req: Request,
  filters: AcademicManagementFilters,
  remarks?: string
): Promise<AcademicBulkReviewResult> => {
  await assertCanApproveAcademic(req);
  const planFilter = buildAcademicFilter(req, filters);
  await applyOfficialPlanScopeToFilter(req, planFilter, filters.teacherId);
  const logFilter = { ...planFilter };
  delete logFilter.status;
  await applyLogBookListScope(req, logFilter);
  delete logFilter.month;
  delete logFilter.status;

  const [sessionPlans, lessonPlans, logBooks] = await Promise.all([
    AcademicSessionPlan.find({ ...planFilter, status: "VERIFIED" }),
    AcademicLessonPlan.find({ ...planFilter, status: "VERIFIED" }),
    AcademicLogBookEntry.find({
      ...logFilter,
      reviewStatus: { $in: ["VERIFIED", "REVIEWED"] }
    })
  ]);

  for (const plan of sessionPlans) {
    await approveSessionPlanDoc(req, plan, remarks);
  }
  for (const plan of lessonPlans) {
    await approveLessonPlanDoc(req, plan, remarks);
  }
  for (const entry of logBooks) {
    await approveLogBookDoc(req, entry, remarks);
  }

  return {
    sessionPlans: sessionPlans.length,
    lessonPlans: lessonPlans.length,
    logBooks: logBooks.length
  };
};
