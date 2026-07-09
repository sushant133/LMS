import type { Request, Response } from "express";
import mongoose from "mongoose";
import {
  academicApprovalActionSchema,
  academicCommentSchema,
  academicLessonPlanSchema,
  academicLogBookEntrySchema,
  academicLogBookReviewSchema,
  academicRejectActionSchema,
  academicSessionPlanSchema,
  type AcademicManagementFilters
} from "@phit-erp/shared";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { AcademicComment } from "../models/AcademicComment.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  addAcademicComment,
  applyTeacherScopeToFilter,
  assertApprovableStatus,
  assertEditableStatus,
  assertTeacherOwnership,
  buildAcademicFilter,
  buildDashboard,
  getAttendanceForSession,
  getOrCreateLogBook,
  getTodayTimetable,
  isAcademicAdmin,
  notifyAdmins,
  notifyTeacher,
  recordApproval,
  sanitizeTeacherOwnedUpdate,
  serializeLessonPlan,
  serializeLogBookEntry,
  serializeSessionPlan,
  syncLessonPlanItemProgress,
  syncSessionPlanProgress,
  matchesKeyword
} from "../utils/academicManagementService.js";
import { exportAcademicReportCsv, generateAcademicReport, type AcademicReportType } from "../utils/academicManagementReports.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { User } from "../models/User.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { tenantObjectId } from "../utils/tenant.js";
import { sendSuccess } from "../utils/response.js";
import { requireTeacherScope } from "../utils/teacherScope.js";

const getActorName = async (userId: string): Promise<string> => {
  const user = await User.findById(userId).select("fullName email").lean();
  return user?.fullName ?? user?.email ?? "User";
};

const actorObjectId = (req: Request): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(req.user!.userId);

const parseFilters = (req: Request): AcademicManagementFilters => ({
  academicYearBs: typeof req.query.academicYearBs === "string" ? req.query.academicYearBs : undefined,
  session: typeof req.query.session === "string" ? req.query.session : undefined,
  faculty: typeof req.query.faculty === "string" ? req.query.faculty : undefined,
  semesterBs: typeof req.query.semesterBs === "string" ? req.query.semesterBs : undefined,
  subjectId: typeof req.query.subjectId === "string" ? req.query.subjectId : undefined,
  teacherId: typeof req.query.teacherId === "string" ? req.query.teacherId : undefined,
  month: typeof req.query.month === "string" ? req.query.month : undefined,
  dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
  dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
  status: typeof req.query.status === "string" ? (req.query.status as AcademicManagementFilters["status"]) : undefined,
  keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined,
  classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
  sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
  batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
  yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined
});

const withTransaction = async <T>(callback: (session: mongoose.ClientSession) => Promise<T>): Promise<T> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const getAcademicDashboard = asyncHandler(async (req: Request, res: Response) => {
  const dashboard = await buildDashboard(req, parseFilters(req));
  return sendSuccess(res, "Academic management dashboard fetched", dashboard);
});

export const listSessionPlans = asyncHandler(async (req: Request, res: Response) => {
  const filter = buildAcademicFilter(req, parseFilters(req));
  await applyTeacherScopeToFilter(req, filter);

  const filters = parseFilters(req);
  const plans = await AcademicSessionPlan.find(filter).sort({ updatedAt: -1 }).lean();
  const serialized = (await Promise.all(plans.map((plan) => serializeSessionPlan(plan._id.toString())))).filter(Boolean);
  const rows = serialized.filter((plan) =>
    matchesKeyword(filters.keyword, [
      plan?.subject?.name,
      plan?.teacher?.user?.fullName,
      plan?.status,
      plan?.faculty,
      ...(plan?.units ?? []).map((unit) => unit.chapterName)
    ])
  );
  return sendSuccess(res, "Session plans fetched", rows);
});

export const getSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await AcademicSessionPlan.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();

  if (!plan) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, plan.teacherId.toString());

  const serialized = await serializeSessionPlan(plan._id.toString());
  return sendSuccess(res, "Session plan fetched", serialized);
});

export const createSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSessionPlanSchema.parse(req.body);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) {
      throw new ApiError(403, "Teachers can only create session plans for themselves");
    }
  }

  const result = await withTransaction(async (session) => {
    const plan = await AcademicSessionPlan.create(
      [
        {
          ...payload,
          schoolId: tenantObjectId(req),
          status: "DRAFT",
          audit: { createdBy: actorObjectId(req) }
        }
      ],
      { session }
    );

    const createdPlan = plan[0];
    if (!createdPlan) throw new ApiError(500, "Failed to create session plan");

    await AcademicSessionPlanUnit.insertMany(
      payload.units.map((unit) => ({
        ...unit,
        schoolId: tenantObjectId(req),
        sessionPlanId: createdPlan._id
      })),
      { session }
    );

    await syncSessionPlanProgress(createdPlan._id.toString());
    await recordAudit(req, { action: "academic.session_plan.create", entity: "SESSION_PLAN", entityId: createdPlan._id.toString(), after: createdPlan });
    return createdPlan._id.toString();
  });

  const serialized = await serializeSessionPlan(result);
  return sendSuccess(res, "Session plan created", serialized, 201);
});

export const updateSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSessionPlanSchema.partial().parse(req.body);
  const existing = await AcademicSessionPlan.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });

  if (!existing) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);

  await withTransaction(async (session) => {
    Object.assign(existing, safePayload, {
      audit: { ...existing.audit, updatedBy: actorObjectId(req) }
    });
    await existing.save({ session });

    if (payload.units) {
      const existingUnits = await AcademicSessionPlanUnit.find({ sessionPlanId: existing._id }).session(session);
      const byUnitNo = new Map(existingUnits.map((unit) => [unit.unitNo, unit]));
      const kept = new Set<number>();

      for (const unit of payload.units) {
        kept.add(unit.unitNo);
        const prev = byUnitNo.get(unit.unitNo);
        if (prev) {
          const preservedStatus = prev.status;
          Object.assign(prev, unit, {
            schoolId: tenantObjectId(req),
            sessionPlanId: existing._id,
            status: preservedStatus
          });
          await prev.save({ session });
        } else {
          await AcademicSessionPlanUnit.create(
            [{ ...unit, schoolId: tenantObjectId(req), sessionPlanId: existing._id }],
            { session }
          );
        }
      }

      for (const prev of existingUnits) {
        if (kept.has(prev.unitNo)) continue;
        const linkedItems = await AcademicLessonPlanItem.countDocuments({
          sessionPlanUnitId: prev._id
        }).session(session);
        if (linkedItems > 0) {
          throw new ApiError(
            400,
            `Cannot remove unit ${prev.unitNo} ("${prev.chapterName}") because lesson plan topics are linked to it.`
          );
        }
        await prev.deleteOne({ session });
      }
    }

    await syncSessionPlanProgress(existing._id.toString());
    await recordAudit(req, {
      action: "academic.session_plan.update",
      entity: "SESSION_PLAN",
      entityId: existing._id.toString(),
      after: existing
    });
  });

  const serialized = await serializeSessionPlan(existing._id.toString());
  return sendSuccess(res, "Session plan updated", serialized);
});

export const deleteSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicSessionPlan.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });

  if (!existing) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  existing.isDeleted = true;
  existing.audit = { ...existing.audit, deletedBy: actorObjectId(req), deletedAt: new Date() };
  await existing.save();
  await AcademicProgress.deleteMany({ sessionPlanId: existing._id, schoolId: tenantObjectId(req) });
  await recordAudit(req, { action: "academic.session_plan.delete", entity: "SESSION_PLAN", entityId: existing._id.toString() });
  return sendSuccess(res, "Session plan deleted");
});

export const submitSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicSessionPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, existing.teacherId.toString());
  assertEditableStatus(existing.status);

  existing.status = "PENDING_APPROVAL";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "SUBMITTED");
  await notifyAdmins(req, "Session Plan Submitted", "A teacher submitted a session plan for approval.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeSessionPlan(existing._id.toString());
  return sendSuccess(res, "Session plan submitted", serialized);
});

export const approveSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can approve plans");
  const { remarks } = academicApprovalActionSchema.parse(req.body);

  const existing = await AcademicSessionPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Session plan not found");
  assertApprovableStatus(existing.status);

  existing.status = "APPROVED";
  existing.adminRemarks = remarks;
  existing.audit = {
    ...existing.audit,
    approvedBy: actorObjectId(req),
    approvedAt: new Date(),
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "APPROVED", remarks);
  await notifyTeacher(req, existing.teacherId.toString(), "Session Plan Approved", "Your session plan has been approved.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeSessionPlan(existing._id.toString());
  return sendSuccess(res, "Session plan approved", serialized);
});

export const rejectSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can reject plans");
  const { remarks } = academicRejectActionSchema.parse(req.body);

  const existing = await AcademicSessionPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Session plan not found");
  assertApprovableStatus(existing.status);

  existing.status = "REJECTED";
  existing.adminRemarks = remarks;
  existing.audit = {
    ...existing.audit,
    rejectedBy: actorObjectId(req),
    rejectedAt: new Date(),
    rejectionReason: remarks,
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "REJECTED", remarks);
  await notifyTeacher(req, existing.teacherId.toString(), "Session Plan Rejected", remarks, { entityId: existing._id.toString() });

  const serialized = await serializeSessionPlan(existing._id.toString());
  return sendSuccess(res, "Session plan rejected", serialized);
});

export const unlockSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can unlock plans");
  const existing = await AcademicSessionPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Session plan not found");

  existing.status = "DRAFT";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "SESSION_PLAN", existing._id.toString(), "UNLOCKED");
  await notifyTeacher(req, existing.teacherId.toString(), "Session Plan Unlocked", "Your session plan has been unlocked for corrections.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeSessionPlan(existing._id.toString());
  return sendSuccess(res, "Session plan unlocked", serialized);
});

export const listLessonPlans = asyncHandler(async (req: Request, res: Response) => {
  const filter = buildAcademicFilter(req, parseFilters(req));
  await applyTeacherScopeToFilter(req, filter);

  const filters = parseFilters(req);
  const plans = await AcademicLessonPlan.find(filter).sort({ updatedAt: -1 }).lean();
  const serialized = (await Promise.all(plans.map((plan) => serializeLessonPlan(plan._id.toString())))).filter(Boolean);
  const rows = serialized.filter((plan) =>
    matchesKeyword(filters.keyword, [
      plan?.subject?.name,
      plan?.teacher?.user?.fullName,
      plan?.status,
      plan?.month,
      ...(plan?.items ?? []).map((item) => item.plannedTopic)
    ])
  );
  return sendSuccess(res, "Lesson plans fetched", rows);
});

export const createLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicLessonPlanSchema.parse(req.body);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) throw new ApiError(403, "Teachers can only create lesson plans for themselves");
  }

  const result = await withTransaction(async (session) => {
    const plan = await AcademicLessonPlan.create(
      [
        {
          ...payload,
          schoolId: tenantObjectId(req),
          status: "DRAFT",
          preparedBy: await getActorName(req.user!.userId),
          audit: { createdBy: actorObjectId(req) }
        }
      ],
      { session }
    );

    const createdPlan = plan[0];
    if (!createdPlan) throw new ApiError(500, "Failed to create lesson plan");

    await AcademicLessonPlanItem.insertMany(
      payload.items.map((item) => ({
        ...item,
        schoolId: tenantObjectId(req),
        lessonPlanId: createdPlan._id
      })),
      { session }
    );

    if (createdPlan.sessionPlanId) {
      await syncSessionPlanProgress(createdPlan.sessionPlanId.toString());
    }

    await recordAudit(req, { action: "academic.lesson_plan.create", entity: "LESSON_PLAN", entityId: createdPlan._id.toString(), after: createdPlan });
    return createdPlan._id.toString();
  });

  const serialized = await serializeLessonPlan(result);
  return sendSuccess(res, "Lesson plan created", serialized, 201);
});

export const updateLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicLessonPlanSchema.partial().parse(req.body);
  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);

  await withTransaction(async (session) => {
    Object.assign(existing, safePayload, { audit: { ...existing.audit, updatedBy: actorObjectId(req) } });
    await existing.save({ session });

    if (payload.items) {
      const existingItems = await AcademicLessonPlanItem.find({ lessonPlanId: existing._id }).session(session);
      const bySerial = new Map(existingItems.map((item) => [item.serialNo, item]));
      const keptSerials = new Set<number>();

      for (const item of payload.items) {
        keptSerials.add(item.serialNo);
        const prev = bySerial.get(item.serialNo);
        if (prev) {
          // Preserve progress fields; re-sync after save if needed
          const completedClasses = prev.completedClasses;
          const completionStatus = prev.completionStatus;
          Object.assign(prev, item, {
            schoolId: tenantObjectId(req),
            lessonPlanId: existing._id,
            completedClasses,
            completionStatus
          });
          await prev.save({ session });
        } else {
          await AcademicLessonPlanItem.create(
            [{ ...item, schoolId: tenantObjectId(req), lessonPlanId: existing._id }],
            { session }
          );
        }
      }

      for (const prev of existingItems) {
        if (keptSerials.has(prev.serialNo)) continue;
        const linkedLogs = await AcademicLogBookEntry.countDocuments({
          lessonPlanItemId: prev._id,
          isDeleted: false
        }).session(session);
        if (linkedLogs > 0) {
          throw new ApiError(
            400,
            `Cannot remove topic "${prev.plannedTopic}" (SN ${prev.serialNo}) because log book entries are linked to it.`
          );
        }
        await prev.deleteOne({ session });
      }
    }

    if (existing.sessionPlanId) await syncSessionPlanProgress(existing.sessionPlanId.toString());
    await recordAudit(req, { action: "academic.lesson_plan.update", entity: "LESSON_PLAN", entityId: existing._id.toString(), after: existing });
  });

  const serialized = await serializeLessonPlan(existing._id.toString());
  return sendSuccess(res, "Lesson plan updated", serialized);
});

export const deleteLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  existing.isDeleted = true;
  existing.audit = { ...existing.audit, deletedBy: actorObjectId(req), deletedAt: new Date() };
  await existing.save();
  return sendSuccess(res, "Lesson plan deleted");
});

export const submitLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  assertEditableStatus(existing.status);

  existing.status = "PENDING_APPROVAL";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "SUBMITTED");
  await notifyAdmins(req, "Lesson Plan Pending Approval", "A teacher submitted a lesson plan for review.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeLessonPlan(existing._id.toString());
  return sendSuccess(res, "Lesson plan submitted", serialized);
});

export const approveLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can approve plans");
  const { remarks } = academicApprovalActionSchema.parse(req.body);

  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");
  assertApprovableStatus(existing.status);

  existing.status = "APPROVED";
  existing.adminRemarks = remarks;
  existing.approvedByName = await getActorName(req.user!.userId);
  existing.approvalDate = getTodayBs();
  existing.audit = { ...existing.audit, approvedBy: actorObjectId(req), approvedAt: new Date(), updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "APPROVED", remarks);
  await notifyTeacher(req, existing.teacherId.toString(), "Lesson Plan Approved", "Your lesson plan has been approved.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeLessonPlan(existing._id.toString());
  return sendSuccess(res, "Lesson plan approved", serialized);
});

export const rejectLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can reject plans");
  const { remarks } = academicRejectActionSchema.parse(req.body);

  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");
  assertApprovableStatus(existing.status);

  existing.status = "REJECTED";
  existing.adminRemarks = remarks;
  existing.audit = {
    ...existing.audit,
    rejectedBy: actorObjectId(req),
    rejectedAt: new Date(),
    rejectionReason: remarks,
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "REJECTED", remarks);
  await notifyTeacher(req, existing.teacherId.toString(), "Lesson Plan Rejected", remarks, { entityId: existing._id.toString() });

  const serialized = await serializeLessonPlan(existing._id.toString());
  return sendSuccess(res, "Lesson plan rejected", serialized);
});

export const listLogBookEntries = asyncHandler(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const filter = buildAcademicFilter(req, filters);
  if (filters.status) {
    filter.reviewStatus = filters.status;
  }
  delete filter.status;
  await applyTeacherScopeToFilter(req, filter);

  if (filters.dateFrom || filters.dateTo) {
    filter.dateBs = {
      ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { $lte: filters.dateTo } : {})
    };
  }

  const entries = await AcademicLogBookEntry.find(filter).sort({ dateBs: -1, periodNumber: 1 }).lean();
  const serialized = (await Promise.all(entries.map((entry) => serializeLogBookEntry(entry._id.toString())))).filter(Boolean);
  const rows = serialized.filter((entry) =>
    matchesKeyword(filters.keyword, [
      entry?.topicCovered,
      entry?.unit,
      entry?.subject?.name,
      entry?.teacher?.user?.fullName,
      entry?.reviewStatus
    ])
  );
  return sendSuccess(res, "Log book entries fetched", rows);
});

export const createLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = academicLogBookEntrySchema.parse(req.body);
  const dateBs = ensureValidBsDate(parsed.dateBs);
  const payload = { ...parsed, dateBs };

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) throw new ApiError(403, "Teachers can only create their own log book entries");
  }

  // Validate optional lesson-plan item link belongs to school / teacher / subject
  if (payload.lessonPlanItemId) {
    const item = await AcademicLessonPlanItem.findById(payload.lessonPlanItemId).lean();
    if (!item || item.schoolId.toString() !== tenantObjectId(req).toString()) {
      throw new ApiError(400, "Invalid lesson plan item");
    }
    const plan = await AcademicLessonPlan.findOne({
      _id: item.lessonPlanId,
      schoolId: tenantObjectId(req),
      isDeleted: false
    }).lean();
    if (!plan) throw new ApiError(400, "Lesson plan for this item was not found");
    if (plan.teacherId.toString() !== payload.teacherId) {
      throw new ApiError(400, "Lesson plan item does not belong to the selected teacher");
    }
    if (plan.subjectId.toString() !== payload.subjectId) {
      throw new ApiError(400, "Lesson plan item subject does not match this log entry");
    }
    payload.lessonPlanId = plan._id.toString();
    if (item.sessionPlanUnitId) payload.sessionPlanUnitId = item.sessionPlanUnitId.toString();
  }

  const month = dateBs.slice(0, 7);
  const logBookId = await getOrCreateLogBook(req, { ...payload, month });

  const attendance = await getAttendanceForSession(req, {
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    dateBs,
    classId: payload.classId,
    sectionId: payload.sectionId,
    batchId: payload.batchId,
    yearId: payload.yearId
  });

  const count = await AcademicLogBookEntry.countDocuments({ logBookId, isDeleted: false });

  const entry = await AcademicLogBookEntry.create({
    ...payload,
    schoolId: tenantObjectId(req),
    logBookId,
    serialNo: count + 1,
    attendancePresent: attendance.present,
    attendanceAbsent: attendance.absent,
    attendancePercent: attendance.percent,
    teacherSignature: await getActorName(req.user!.userId),
    audit: { createdBy: actorObjectId(req) }
  });

  if (entry.lessonPlanItemId) {
    await syncLessonPlanItemProgress(entry.lessonPlanItemId.toString());
  }

  await recordAudit(req, { action: "academic.log_book.create", entity: "LOG_BOOK_ENTRY", entityId: entry._id.toString(), after: entry });
  const serialized = await serializeLogBookEntry(entry._id.toString());
  return sendSuccess(res, "Log book entry created", serialized, 201);
});

export const updateLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = academicLogBookEntrySchema.partial().parse(req.body);
  const payload = {
    ...parsed,
    ...(parsed.dateBs ? { dateBs: ensureValidBsDate(parsed.dateBs) } : {})
  };
  const existing = await AcademicLogBookEntry.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Log book entry not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "") && existing.reviewStatus === "APPROVED") {
    throw new ApiError(403, "Approved log book entries cannot be modified");
  }

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);
  const previousItemId = existing.lessonPlanItemId?.toString();

  Object.assign(existing, safePayload, { audit: { ...existing.audit, updatedBy: actorObjectId(req) } });
  await existing.save();

  if (previousItemId) await syncLessonPlanItemProgress(previousItemId);
  if (existing.lessonPlanItemId && existing.lessonPlanItemId.toString() !== previousItemId) {
    await syncLessonPlanItemProgress(existing.lessonPlanItemId.toString());
  }
  await recordAudit(req, { action: "academic.log_book.update", entity: "LOG_BOOK_ENTRY", entityId: existing._id.toString(), after: existing });

  const serialized = await serializeLogBookEntry(existing._id.toString());
  return sendSuccess(res, "Log book entry updated", serialized);
});

export const deleteLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicLogBookEntry.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Log book entry not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "") && existing.reviewStatus === "APPROVED") {
    throw new ApiError(403, "Approved log book entries cannot be deleted");
  }

  existing.isDeleted = true;
  existing.audit = { ...existing.audit, deletedBy: actorObjectId(req), deletedAt: new Date() };
  await existing.save();

  if (existing.lessonPlanItemId) await syncLessonPlanItemProgress(existing.lessonPlanItemId.toString());
  return sendSuccess(res, "Log book entry deleted");
});

export const reviewLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can review log book entries");
  const payload = academicLogBookReviewSchema.parse(req.body);

  const existing = await AcademicLogBookEntry.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Log book entry not found");

  existing.reviewStatus = payload.reviewStatus;
  existing.adminRemarks = payload.adminRemarks;
  existing.adminSignature = payload.adminSignature ?? (await getActorName(req.user!.userId));
  existing.audit = { ...existing.audit, approvedBy: actorObjectId(req), approvedAt: new Date(), updatedBy: actorObjectId(req) };
  await existing.save();

  if (existing.lessonPlanItemId) await syncLessonPlanItemProgress(existing.lessonPlanItemId.toString());
  await notifyTeacher(req, existing.teacherId.toString(), "Log Book Reviewed", payload.adminRemarks ?? "Your log book entry was reviewed.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeLogBookEntry(existing._id.toString());
  return sendSuccess(res, "Log book entry reviewed", serialized);
});

export const listSessionPlanUnits = asyncHandler(async (req: Request, res: Response) => {
  const sessionPlanId = typeof req.query.sessionPlanId === "string" ? req.query.sessionPlanId : "";
  if (!sessionPlanId) throw new ApiError(400, "sessionPlanId is required");

  const plan = await AcademicSessionPlan.findOne({
    _id: sessionPlanId,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();
  if (!plan) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, plan.teacherId.toString());

  const units = await AcademicSessionPlanUnit.find({
    schoolId: tenantObjectId(req),
    sessionPlanId
  })
    .sort({ unitNo: 1 })
    .lean();
  return sendSuccess(res, "Session plan units fetched", units);
});

export const getTodayTimetableSlots = asyncHandler(async (req: Request, res: Response) => {
  const dateBs = typeof req.query.dateBs === "string" && req.query.dateBs ? req.query.dateBs : getTodayBs();
  const slots = await getTodayTimetable(req, dateBs);
  return sendSuccess(res, "Today's timetable fetched", slots);
});

export const getSessionAttendance = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = String(req.query.teacherId ?? "");
  if (teacherId) await assertTeacherOwnership(req, teacherId);
  const dateBsRaw = typeof req.query.dateBs === "string" ? req.query.dateBs : "";
  const dateBs = dateBsRaw ? ensureValidBsDate(dateBsRaw) : getTodayBs();

  const summary = await getAttendanceForSession(req, {
    subjectId: String(req.query.subjectId ?? ""),
    teacherId,
    dateBs,
    classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
    sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
    batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
    yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined
  });
  return sendSuccess(res, "Attendance summary fetched", summary);
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicCommentSchema.parse(req.body);

  const entity =
    payload.entityType === "SESSION_PLAN"
      ? await AcademicSessionPlan.findOne({ _id: payload.entityId, schoolId: tenantObjectId(req), isDeleted: false })
      : payload.entityType === "LESSON_PLAN"
        ? await AcademicLessonPlan.findOne({ _id: payload.entityId, schoolId: tenantObjectId(req), isDeleted: false })
        : await AcademicLogBookEntry.findOne({ _id: payload.entityId, schoolId: tenantObjectId(req), isDeleted: false });

  if (!entity) throw new ApiError(404, "Entity not found for comment");
  if ("teacherId" in entity && entity.teacherId) {
    await assertTeacherOwnership(req, entity.teacherId.toString());
  }

  const comment = await addAcademicComment(req, payload.entityType, payload.entityId, payload.comment);

  if ("teacherId" in entity && entity.teacherId && isAcademicAdmin(req.user?.role ?? "")) {
    await notifyTeacher(req, entity.teacherId.toString(), "Admin Comment Added", payload.comment, { entityId: payload.entityId });
  }

  return sendSuccess(res, "Comment added", comment, 201);
});

export const unlockLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can unlock plans");
  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");

  existing.status = "DRAFT";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "LESSON_PLAN", existing._id.toString(), "UNLOCKED");
  await notifyTeacher(req, existing.teacherId.toString(), "Lesson Plan Unlocked", "Your lesson plan has been unlocked for corrections.", {
    entityId: existing._id.toString()
  });

  const serialized = await serializeLessonPlan(existing._id.toString());
  return sendSuccess(res, "Lesson plan unlocked", serialized);
});

export const getAcademicReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.type as AcademicReportType;
  const report = await generateAcademicReport(req, reportType);
  return sendSuccess(res, "Academic report generated", report);
});

export const exportAcademicReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.type as AcademicReportType;
  await exportAcademicReportCsv(req, res, reportType);
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const entityType = req.query.entityType;
  const entityId = req.query.entityId;
  if (typeof entityType !== "string" || typeof entityId !== "string") {
    throw new ApiError(400, "entityType and entityId are required");
  }

  const entity =
    entityType === "SESSION_PLAN"
      ? await AcademicSessionPlan.findOne({ _id: entityId, schoolId: tenantObjectId(req), isDeleted: false }).select("teacherId").lean()
      : entityType === "LESSON_PLAN"
        ? await AcademicLessonPlan.findOne({ _id: entityId, schoolId: tenantObjectId(req), isDeleted: false }).select("teacherId").lean()
        : await AcademicLogBookEntry.findOne({ _id: entityId, schoolId: tenantObjectId(req), isDeleted: false }).select("teacherId").lean();

  if (!entity) throw new ApiError(404, "Entity not found");
  if (entity.teacherId) await assertTeacherOwnership(req, entity.teacherId.toString());

  const comments = await AcademicComment.find({
    schoolId: tenantObjectId(req),
    entityType,
    entityId
  }).sort({ createdAt: -1 });

  return sendSuccess(res, "Comments fetched", comments);
});