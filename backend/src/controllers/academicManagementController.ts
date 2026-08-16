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
  academicSyllabusSchema,
  academicSyllabusUpdateSchema,
  academicSyllabusSubUnitProgressSchema,
  academicSyllabusReorderSchema,
  normalizeSubUnitSelection,
  type AcademicManagementFilters,
  type AcademicSyllabusChapterInput
} from "@phit-erp/shared";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { AcademicSyllabusChapter } from "../models/AcademicSyllabusChapter.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicComment } from "../models/AcademicComment.js";
import {
  chaptersHaveRealContent,
  countAllSubsInChapters,
  countUnitsInChapters,
  deleteSyllabusHierarchy,
  isEmptyHierarchyShell,
  legacyUnitsToChapters,
  renumberAfterReorder,
  saveSyllabusHierarchy
} from "../utils/syllabusHierarchyService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { getSessionOption, withTransaction } from "../utils/transaction.js";
import {
  addAcademicComment,
  applyCurriculumSubjectFilter,
  applyTeacherScopeToFilter,
  applyTeacherSubjectScopeToFilter,
  assertApprovableStatus,
  assertApprovedSessionPlanForLesson,
  assertEditableStatus,
  assertLessonPlanItemsBelongToSessionPlan,
  assertLessonPlanItemDatesWithinSessionPlanUnits,
  assertTeachingDateWithinSessionPlanUnits,
  assertUniqueUnitsInLessonPlan,
  assertNoDuplicateLogBookForItemDate,
  nextLogBookPeriodNumber,
  resolveLogBookLessonPlanLink,
  resolveTaughtSyllabusSubUnitIds,
  assertSyllabusAccess,
  assertTeacherOwnership,
  buildAcademicFilter,
  buildDashboard,
  expandCurriculumSubjectIds,
  getAttendanceForSession,
  getNepaliMonthNameFromBsDate,
  getOrCreateLogBook,
  NEPALI_MONTH_NAMES,
  getSessionPlanSyllabusCoverage,
  getTodayTimetable,
  isAcademicAdmin,
  notifyAdmins,
  notifyTeacher,
  recordApproval,
  sanitizeTeacherOwnedUpdate,
  serializeLessonPlan,
  serializeLogBookEntry,
  serializeSessionPlan,
  serializeSyllabus,
  syncLessonPlanItemProgress,
  syncSessionPlanProgress,
  resyncSessionPlanUnitProgress,
  matchesKeyword
} from "../utils/academicManagementService.js";
import { exportAcademicReportCsv, generateAcademicReport, type AcademicReportType } from "../utils/academicManagementReports.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { User } from "../models/User.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { tenantObjectId } from "../utils/tenant.js";
import { sendSuccess } from "../utils/response.js";
import { getTeacherScope, requireTeacherScope } from "../utils/teacherScope.js";

const getActorName = async (userId: string): Promise<string> => {
  const user = await User.findById(userId).select("fullName email").lean();
  return user?.fullName ?? user?.email ?? "User";
};

const actorObjectId = (req: Request): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(req.user!.userId);

/** Drop empty / invalid ObjectId strings so Mongoose never throws BSON cast 500s. */
const optionalObjectId = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  if (!mongoose.Types.ObjectId.isValid(s)) return undefined;
  return s;
};

const optionalObjectIdList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => optionalObjectId(v))
    .filter((v): v is string => Boolean(v));
};

/** Same unit + different sub-units on one day → one row with all sub-units. */
const mergeLessonPlanItemsByUnit = <
  T extends {
    sessionPlanUnitId: string;
    serialNo: number;
    subUnitTitle?: string;
    subUnitTitles?: string[];
    plannedTopic?: string;
    remarks?: string;
    syllabusSubUnitIds?: string[];
    syllabusSubUnitId?: string;
  },
>(
  items: T[],
): T[] => {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = item.sessionPlanUnitId;
    if (!key) continue;
    const titles = [
      ...(item.subUnitTitles ?? []),
      ...(item.subUnitTitle || "")
        .split(/[;\n|]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ].filter(
      (t, i, arr) =>
        arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i,
    );
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...item,
        subUnitTitles: titles,
        subUnitTitle: titles.join("; "),
        plannedTopic: titles.join("; ") || item.plannedTopic,
      });
      continue;
    }
    const merged = [
      ...(prev.subUnitTitles ?? []),
      ...titles,
    ].filter(
      (t, i, arr) =>
        arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i,
    );
    const ids = [
      ...(prev.syllabusSubUnitIds ?? []),
      ...(item.syllabusSubUnitIds ?? []),
      prev.syllabusSubUnitId || "",
      item.syllabusSubUnitId || "",
    ].filter((id, i, arr) => Boolean(id) && arr.indexOf(id) === i);
    map.set(key, {
      ...prev,
      subUnitTitles: merged,
      subUnitTitle: merged.join("; "),
      plannedTopic: merged.join("; ") || prev.plannedTopic,
      remarks: [prev.remarks, item.remarks].filter(Boolean).join("; "),
      syllabusSubUnitIds: ids,
      syllabusSubUnitId: ids[0] || prev.syllabusSubUnitId || "",
    });
  }
  return [...map.values()].map((item, i) => ({ ...item, serialNo: i + 1 }));
};

/** Build a lesson-plan item document free of empty ObjectId strings (update + create). */
const buildLessonPlanItemDoc = (
  item: {
    serialNo: number;
    sessionPlanUnitId: string;
    subjectLabel?: string;
    plannedTopic?: string;
    description?: string;
    learningObjectives?: string;
    teachingMethod?: string;
    teachingAids?: string;
    assessmentMethod?: string;
    deadline?: string;
    itemStartDateBs?: string;
    itemEndDateBs?: string;
    estimatedClasses?: number;
    remarks?: string;
    syllabusId?: string;
    syllabusChapterId?: string;
    syllabusUnitId?: string;
    syllabusSubUnitId?: string;
    syllabusSubUnitIds?: string[];
    subUnitTitle?: string;
    subUnitTitles?: string[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unit: any,
  schoolId: mongoose.Types.ObjectId,
  lessonPlanId: mongoose.Types.ObjectId
) => {
  const subUnitTitles = Array.isArray(item.subUnitTitles)
    ? item.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
    : item.subUnitTitle
      ? String(item.subUnitTitle)
          .split(/[;\n|]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const syllabusSubUnitIds = optionalObjectIdList(
    Array.isArray(item.syllabusSubUnitIds) && item.syllabusSubUnitIds.length > 0
      ? item.syllabusSubUnitIds
      : item.syllabusSubUnitId
        ? [item.syllabusSubUnitId]
        : []
  );
  const unitSyllabusId =
    unit?.syllabusId == null
      ? undefined
      : typeof unit.syllabusId === "string"
        ? unit.syllabusId
        : unit.syllabusId?.toString?.();
  const unitChapterId =
    unit?.syllabusChapterId == null
      ? undefined
      : typeof unit.syllabusChapterId === "string"
        ? unit.syllabusChapterId
        : unit.syllabusChapterId?.toString?.();
  const unitSyllabusUnitId =
    unit?.syllabusUnitId == null
      ? undefined
      : typeof unit.syllabusUnitId === "string"
        ? unit.syllabusUnitId
        : unit.syllabusUnitId?.toString?.();

  const plannedTopic = (
    item.plannedTopic ||
    (subUnitTitles.length > 0 ? subUnitTitles.join("; ") : "") ||
    unit?.topicsCovered ||
    unit?.chapterName ||
    `Unit ${item.serialNo}`
  ).trim();
  // Daily lesson rows default to 1 class — do not treat teaching hours as class count
  const estimatedClasses =
    Number.isFinite(item.estimatedClasses) && (item.estimatedClasses as number) >= 1
      ? Math.round(item.estimatedClasses as number)
      : 1;

  return {
    serialNo: item.serialNo,
    sessionPlanUnitId: item.sessionPlanUnitId,
    subjectLabel: item.subjectLabel || (unit ? `Unit ${unit.unitNo}` : ""),
    plannedTopic,
    description: item.description || "",
    learningObjectives: item.learningObjectives || unit?.learningOutcomes || "",
    teachingMethod: item.teachingMethod || "",
    teachingAids: item.teachingAids || "",
    assessmentMethod: item.assessmentMethod || "",
    deadline: item.deadline || "",
    itemStartDateBs: item.itemStartDateBs || unit?.startDateBs || "",
    itemEndDateBs: item.itemEndDateBs || unit?.endDateBs || "",
    estimatedClasses,
    remarks: item.remarks || "",
    syllabusId: optionalObjectId(item.syllabusId) || optionalObjectId(unitSyllabusId),
    syllabusChapterId:
      optionalObjectId(item.syllabusChapterId) || optionalObjectId(unitChapterId),
    syllabusUnitId:
      optionalObjectId(item.syllabusUnitId) || optionalObjectId(unitSyllabusUnitId),
    syllabusSubUnitId: syllabusSubUnitIds[0],
    subUnitTitles,
    subUnitTitle:
      subUnitTitles.length > 0
        ? subUnitTitles.join("; ")
        : item.subUnitTitle?.trim() || "",
    syllabusSubUnitIds,
    schoolId,
    lessonPlanId
  };
};

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

export const getAcademicDashboard = asyncHandler(async (req: Request, res: Response) => {
  try {
    const dashboard = await buildDashboard(req, parseFilters(req));
    return sendSuccess(res, "Academic management dashboard fetched", dashboard);
  } catch (error) {
    // Surface real cause in logs; rethrow so errorHandler formats the response
    console.error("[academic-management/dashboard]", error);
    throw error;
  }
});

export const listSessionPlans = asyncHandler(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const filter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
  await applyTeacherScopeToFilter(req, filter);

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

/** Strip empty strings so Mongoose does not CastError on optional ObjectId fields. */
const sanitizeSessionPlanScope = <
  T extends {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    attachmentUrl?: string;
    faculty?: string;
    semesterBs?: string;
  }
>(
  fields: T
) => ({
  ...fields,
  classId: fields.classId?.trim() || undefined,
  sectionId: fields.sectionId?.trim() || undefined,
  batchId: fields.batchId?.trim() || undefined,
  yearId: fields.yearId?.trim() || undefined,
  attachmentUrl: fields.attachmentUrl?.trim() || undefined,
  faculty: fields.faculty?.trim() || undefined,
  semesterBs: fields.semesterBs?.trim() || undefined
});

const sanitizeSessionPlanUnit = <
  T extends {
    estimatedTeachingHours?: number;
    learningOutcomes?: string;
    topicsCovered?: string;
    references?: string;
    internalAssessment?: string;
    tentativeCompletionMonth?: string;
    startDateBs?: string;
    endDateBs?: string;
    attachmentUrl?: string;
    syllabusId?: string;
    syllabusChapterId?: string;
    syllabusUnitId?: string;
  }
>(
  unit: T
) => ({
  ...unit,
  estimatedTeachingHours: Number.isFinite(unit.estimatedTeachingHours)
    ? unit.estimatedTeachingHours
    : 0,
  learningOutcomes: unit.learningOutcomes ?? "",
  topicsCovered: unit.topicsCovered ?? "",
  references: unit.references ?? "",
  internalAssessment: unit.internalAssessment ?? "",
  tentativeCompletionMonth: unit.tentativeCompletionMonth ?? "",
  startDateBs: unit.startDateBs?.trim() || "",
  endDateBs: unit.endDateBs?.trim() || "",
  attachmentUrl: unit.attachmentUrl?.trim() || undefined,
  syllabusId: unit.syllabusId?.trim() || undefined,
  syllabusChapterId: unit.syllabusChapterId?.trim() || undefined,
  syllabusUnitId: unit.syllabusUnitId?.trim() || undefined
});

export const createSessionPlan = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSessionPlanSchema.parse(req.body);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) {
      throw new ApiError(403, "Teachers can only create session plans for themselves");
    }
  }

  const header = sanitizeSessionPlanScope(payload);

  let result: string;
  try {
    result = await withTransaction(async (session) => {
      const sessionOpt = getSessionOption(session);
      // Destructure so nested units never hit the plan schema
      const { units: _units, ...planFields } = header as typeof header & {
        units?: unknown;
      };
      const plan = await AcademicSessionPlan.create(
        [
          {
            ...planFields,
            schoolId: tenantObjectId(req),
            status: "DRAFT",
            audit: { createdBy: actorObjectId(req) }
          }
        ],
        sessionOpt
      );

      const createdPlan = plan[0];
      if (!createdPlan) throw new ApiError(500, "Failed to create session plan");

      await AcademicSessionPlanUnit.insertMany(
        payload.units.map((unit) => ({
          ...sanitizeSessionPlanUnit(unit),
          // Progress is driven by Log Book → Lesson Plan sync only (never manual COMPLETED)
          status: "PENDING",
          schoolId: tenantObjectId(req),
          sessionPlanId: createdPlan._id
        })),
        sessionOpt
      );

      await syncSessionPlanProgress(createdPlan._id.toString());
      await recordAudit(req, {
        action: "academic.session_plan.create",
        entity: "SESSION_PLAN",
        entityId: createdPlan._id.toString(),
        after: createdPlan
      });
      return createdPlan._id.toString();
    });
  } catch (error) {
    const { throwIfDuplicateKey } = await import("../utils/mongoErrors.js");
    throwIfDuplicateKey(error);
    throw error;
  }

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

  const safePayload = sanitizeTeacherOwnedUpdate(
    req,
    sanitizeSessionPlanScope(payload as Record<string, unknown> & {
      classId?: string;
      sectionId?: string;
      batchId?: string;
      yearId?: string;
      attachmentUrl?: string;
      faculty?: string;
      semesterBs?: string;
    }) as Record<string, unknown>
  );
  // units are handled separately below
  delete safePayload.units;

  try {
    await withTransaction(async (session) => {
      const sessionOpt = getSessionOption(session);
      Object.assign(existing, safePayload, {
        audit: { ...existing.audit, updatedBy: actorObjectId(req) }
      });
      await existing.save(sessionOpt);

      if (payload.units) {
        const unitsQuery = AcademicSessionPlanUnit.find({ sessionPlanId: existing._id });
        if (session) unitsQuery.session(session);
        const existingUnits = await unitsQuery;
        const byUnitNo = new Map(existingUnits.map((unit) => [unit.unitNo, unit]));
        const kept = new Set<number>();

        for (const unit of payload.units) {
          kept.add(unit.unitNo);
          const prev = byUnitNo.get(unit.unitNo);
          const cleanUnit = sanitizeSessionPlanUnit(unit);
          if (prev) {
            const preservedStatus = prev.status;
            Object.assign(prev, cleanUnit, {
              schoolId: tenantObjectId(req),
              sessionPlanId: existing._id,
              status: preservedStatus
            });
            await prev.save(sessionOpt);
          } else {
            await AcademicSessionPlanUnit.create(
              [
                {
                  ...cleanUnit,
                  status: "PENDING",
                  schoolId: tenantObjectId(req),
                  sessionPlanId: existing._id
                }
              ],
              sessionOpt
            );
          }
        }

        for (const prev of existingUnits) {
          if (kept.has(prev.unitNo)) continue;
          const linkedQuery = AcademicLessonPlanItem.countDocuments({
            sessionPlanUnitId: prev._id
          });
          if (session) linkedQuery.session(session);
          const linkedItems = await linkedQuery;
          if (linkedItems > 0) {
            throw new ApiError(
              400,
              `Cannot remove unit ${prev.unitNo} ("${prev.chapterName}") because lesson plan topics are linked to it.`
            );
          }
          await prev.deleteOne(sessionOpt);
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
  } catch (error) {
    const { throwIfDuplicateKey } = await import("../utils/mongoErrors.js");
    throwIfDuplicateKey(error);
    throw error;
  }

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

// ─── Syllabus (official subject units; same box UI as Session Plan) ─────────

export const listSyllabi = asyncHandler(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const filter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
  // Teachers see syllabi for subjects they are assigned (not only their teacherId)
  await applyTeacherSubjectScopeToFilter(req, filter);

  /**
   * Syllabus is curriculum-level (shared). For teachers, drop filters that commonly
   * hide admin-created rows: session (often duplicates AY with spacing differences),
   * faculty free-text, teacherId, and batch/class/year instance ids.
   * Subject + school + (optional) academic year remain.
   */
  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    delete filter.session;
    delete filter.faculty;
    delete filter.teacherId;
    delete filter.classId;
    delete filter.sectionId;
    delete filter.batchId;
    delete filter.yearId;
    // Soft academic year: match ignoring whitespace/case differences
    if (typeof filter.academicYearBs === "string" && filter.academicYearBs.trim()) {
      const raw = filter.academicYearBs.trim();
      const compact = raw.replace(/\s+/g, "");
      filter.academicYearBs = {
        $in: [...new Set([raw, compact, raw.replace(/\s*\/\s*/g, "/")])]
      };
    }
  }

  const rows = await AcademicSyllabus.find(filter).sort({ updatedAt: -1 }).lean();
  const serialized = (await Promise.all(rows.map((row) => serializeSyllabus(row._id.toString())))).filter(Boolean);
  const filtered = serialized.filter((plan) => {
    const chapterTitles = (plan?.chapters ?? []).map((c) => c.title);
    const chapterDescriptions = (plan?.chapters ?? []).map((c) => c.description);
    const unitTitles = (plan?.chapters ?? []).flatMap((c) => c.units.map((u) => u.title));
    const unitDescriptions = (plan?.chapters ?? []).flatMap((c) =>
      c.units.map((u) => u.description)
    );
    const unitOutcomes = (plan?.chapters ?? []).flatMap((c) =>
      c.units.map((u) => u.learningObjective)
    );
    const unitRefs = (plan?.chapters ?? []).flatMap((c) =>
      c.units.map((u) => u.references)
    );
    const flattenSubs = <T extends { children?: T[] }>(subs: T[]): T[] => {
      const out: T[] = [];
      const walk = (nodes: T[]) => {
        for (const n of nodes) {
          out.push(n);
          if (n.children?.length) walk(n.children);
        }
      };
      walk(subs);
      return out;
    };
    const allSubs = (plan?.chapters ?? []).flatMap((c) =>
      c.units.flatMap((u) => flattenSubs(u.subUnits ?? []))
    );
    const subHeadings = allSubs.map((s) => s.heading);
    const subDescriptions = allSubs.map((s) => s.description);
    const subOutcomes = allSubs.map((s) => s.learningOutcomes);
    return matchesKeyword(filters.keyword, [
      plan?.subject?.name,
      plan?.subject?.code,
      plan?.subjectCode,
      plan?.teacher?.user?.fullName,
      plan?.status,
      plan?.faculty,
      plan?.remarks,
      ...(plan?.units ?? []).map((unit) => unit.chapterName),
      ...(plan?.units ?? []).map((unit) => unit.topicsCovered),
      ...chapterTitles,
      ...chapterDescriptions,
      ...unitTitles,
      ...unitDescriptions,
      ...unitOutcomes,
      ...unitRefs,
      ...subHeadings,
      ...subDescriptions,
      ...subOutcomes
    ]);
  });
  return sendSuccess(res, "Syllabi fetched", filtered);
});

/** Read unit title from hierarchical or legacy-shaped rows. */
const unitTitleOf = (unit: Record<string, unknown> | undefined | null): string => {
  if (!unit || typeof unit !== "object") return "";
  const raw =
    unit.title ??
    unit.chapterName ??
    unit.name ??
    unit.heading ??
    unit.unitTitle ??
    unit.unitName;
  return String(raw ?? "").trim();
};

const resolveSyllabusChapters = (payload: {
  chapters?: AcademicSyllabusChapterInput[];
  units?: Array<{
    unitNo: number;
    chapterName: string;
    estimatedTeachingHours?: number;
    learningOutcomes?: string;
    topicsCovered?: string;
    references?: string;
    practicalRequired?: boolean;
    internalAssessment?: string;
    tentativeCompletionMonth?: string;
    status?: string;
    attachmentUrl?: string;
  }>;
}): AcademicSyllabusChapterInput[] => {
  if (payload.chapters && payload.chapters.length > 0) {
    // Keep all unit rows (including blank titles) so partial drafts and
    // "sub-unit filled, unit title empty" cases persist correctly.
    const fromHierarchy = payload.chapters.map((chapter, cIndex) => {
      const rawUnits = (chapter.units ?? []) as Array<Record<string, unknown>>;
      const units = rawUnits.map((u) => {
        // Blank title is valid — store as "" (do not drop the unit)
        const title = unitTitleOf(u);
        return {
          ...u,
          // Temporary; reassigned continuously across chapters below
          unitNo:
            typeof u.unitNo === "number" && Number.isFinite(u.unitNo) && u.unitNo > 0
              ? Math.floor(u.unitNo)
              : 0,
          title,
          description: String(u.description ?? ""),
          teachingHours:
            typeof u.teachingHours === "number" && Number.isFinite(u.teachingHours)
              ? u.teachingHours
              : 0,
          learningObjective: String(u.learningObjective ?? u.learningOutcomes ?? ""),
          references: String(u.references ?? ""),
          remarks: String(u.remarks ?? ""),
          practicalRequired: Boolean(u.practicalRequired),
          subUnits: Array.isArray(u.subUnits) ? u.subUnits : []
        };
      });

      // If client sent a chapter/part heading but no nested units, add one blank unit
      // (or promote heading only when they explicitly typed a section title).
      if (
        units.length === 0 &&
        (chapter.title ?? "").trim() &&
        (chapter.sectionKind === "CHAPTER" ||
          chapter.sectionKind === "PART" ||
          (chapter.title ?? "").trim().length > 0)
      ) {
        units.push({
          unitNo: 0,
          title: "",
          description: chapter.description || "",
          teachingHours: chapter.estimatedHours ?? 0,
          learningObjective: "",
          references: chapter.references || "",
          remarks: "",
          practicalRequired: false,
          subUnits: []
        });
      }

      // Sections with zero units still keep a blank unit so the row is editable later
      if (units.length === 0) {
        units.push({
          unitNo: 0,
          title: "",
          description: "",
          teachingHours: 0,
          learningObjective: "",
          references: "",
          remarks: "",
          practicalRequired: false,
          subUnits: []
        });
      }

      return {
        ...chapter,
        chapterNo: chapter.chapterNo || cIndex + 1,
        units
      } as AcademicSyllabusChapterInput;
    });

    // Always renumber chapters 1..N and units continuously (ignore client duplicates)
    let unitSeq = 0;
    return fromHierarchy.map((chapter, cIndex) => ({
      ...chapter,
      chapterNo: cIndex + 1,
      units: (chapter.units ?? []).map((unit) => {
        unitSeq += 1;
        return { ...unit, unitNo: unitSeq };
      })
    }));
  }
  if (payload.units && payload.units.length > 0) {
    return legacyUnitsToChapters(payload.units);
  }
  return [];
};

export const getSyllabus = asyncHandler(async (req: Request, res: Response) => {
  const plan = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();

  if (!plan) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: plan.teacherId?.toString(),
    subjectId: plan.subjectId.toString()
  });

  const serialized = await serializeSyllabus(plan._id.toString());
  return sendSuccess(res, "Syllabus fetched", serialized);
});

export const createSyllabus = asyncHandler(async (req: Request, res: Response) => {
  // Official syllabus is admin-owned; teachers only view and plan from it
  if (req.user?.role === "TEACHER") {
    throw new ApiError(
      403,
      "Teachers cannot create syllabi. View the syllabus for your assigned subjects and create Session Plan, Lesson Plan, and Log Book instead."
    );
  }

  const payload = academicSyllabusSchema.parse(req.body);
  const optionalTeacherId = payload.teacherId?.trim() || undefined;
  // Deep-clone structure so later header mutations cannot drop units/subs
  const structureSource = {
    chapters: Array.isArray(payload.chapters)
      ? (JSON.parse(JSON.stringify(payload.chapters)) as AcademicSyllabusChapterInput[])
      : payload.chapters,
    units: Array.isArray(payload.units)
      ? (JSON.parse(JSON.stringify(payload.units)) as NonNullable<typeof payload.units>)
      : payload.units
  };
  // Unit titles are optional. Never reject with the old
  // "At least one unit with a title is required…" message — blank titles save as "".
  let chapters = resolveSyllabusChapters(structureSource);
  if (chapters.length === 0) {
    // Soft fallback: keep a single blank unit so create never hard-fails structure
    chapters = [
      {
        chapterNo: 1,
        sectionKind: "NONE" as const,
        title: "",
        description: "",
        estimatedHours: 0,
        weightagePercent: 0,
        references: "",
        remarks: "",
        tentativeCompletionMonth: "",
        units: [
          {
            unitNo: 1,
            title: "",
            description: "",
            teachingHours: 0,
            learningObjective: "",
            references: "",
            remarks: "",
            practicalRequired: false,
            subUnits: []
          }
        ]
      }
    ];
  }
  // Ensure every unit has a title string (may be "") for persistence
  chapters = chapters.map((ch, ci) => ({
    ...ch,
    chapterNo: ci + 1,
    units: (ch.units ?? []).map((u, ui) => ({
      ...u,
      unitNo: u.unitNo || ui + 1,
      title: typeof u.title === "string" ? u.title : String(u.title ?? "")
    }))
  }));

  // Avoid empty strings for ObjectId fields
  const yearId = payload.yearId?.trim() || undefined;
  const batchId = payload.batchId?.trim() || undefined;
  const classId = payload.classId?.trim() || undefined;
  const sectionId = payload.sectionId?.trim() || undefined;

  /**
   * Resume flow: one syllabus per subject+year (or class). If a DRAFT/REJECTED
   * already exists, update its hierarchy instead of failing with duplicate key.
   * Also match curriculum sibling subject ids (batch-year subject instances).
   */
  const schoolOid = tenantObjectId(req);
  const subjectIds = await expandCurriculumSubjectIds(schoolOid, payload.subjectId);
  const existingDraftFilter: Record<string, unknown> = {
    schoolId: schoolOid,
    subjectId: { $in: subjectIds },
    academicYearBs: payload.academicYearBs,
    isDeleted: false,
    status: { $in: ["DRAFT", "REJECTED"] }
  };
  if (yearId) existingDraftFilter.yearId = yearId;
  if (classId) existingDraftFilter.classId = classId;

  const existingDraft = await AcademicSyllabus.findOne(existingDraftFilter).sort({
    updatedAt: -1
  });
  if (existingDraft) {
    await assertSyllabusAccess(req, {
      teacherId: existingDraft.teacherId?.toString(),
      subjectId: existingDraft.subjectId.toString()
    });

    const draftId = existingDraft._id.toString();
    // Never resume-write an empty shell over an existing draft hierarchy.
    // Multi-unit partial drafts (even "Unit N" titles) still rewrite so units grow.
    const incomingEmptyShell = isEmptyHierarchyShell(chapters);
    const [draftTopicCount, draftChapterCount, draftSubCount] = await Promise.all([
      AcademicSyllabusTopic.countDocuments({ syllabusId: existingDraft._id }),
      AcademicSyllabusChapter.countDocuments({ syllabusId: existingDraft._id }),
      AcademicSyllabusSubUnit.countDocuments({ syllabusId: existingDraft._id })
    ]);
    const draftHasHierarchy =
      draftTopicCount > 0 || draftChapterCount > 0 || draftSubCount > 0;
    const shouldRewriteHierarchy = !draftHasHierarchy || !incomingEmptyShell;

    await withTransaction(async (session) => {
      const sessionOpt = getSessionOption(session);
      existingDraft.session = payload.session || existingDraft.session;
      existingDraft.faculty = payload.faculty ?? existingDraft.faculty;
      existingDraft.semesterBs = payload.semesterBs ?? existingDraft.semesterBs;
      existingDraft.subjectCode = payload.subjectCode ?? existingDraft.subjectCode;
      existingDraft.totalTheoryHours =
        payload.totalTheoryHours ?? existingDraft.totalTheoryHours;
      existingDraft.totalPracticalHours =
        payload.totalPracticalHours ?? existingDraft.totalPracticalHours;
      existingDraft.creditHours = payload.creditHours ?? existingDraft.creditHours;
      existingDraft.remarks = payload.remarks ?? existingDraft.remarks;
      existingDraft.attachmentUrl =
        payload.attachmentUrl ?? existingDraft.attachmentUrl;
      if (optionalTeacherId) existingDraft.teacherId = optionalTeacherId as never;
      if (shouldRewriteHierarchy) {
        existingDraft.hierarchyMigratedAt = new Date();
      }
      existingDraft.audit = {
        ...existingDraft.audit,
        updatedBy: actorObjectId(req)
      };
      await existingDraft.save(sessionOpt);

      if (shouldRewriteHierarchy) {
        await saveSyllabusHierarchy(
          {
            schoolId: tenantObjectId(req).toString(),
            syllabusId: draftId,
            chapters
          },
          session ?? undefined
        );
      }

      await recordAudit(req, {
        action: "academic.syllabus.resumeDraft",
        entity: "SYLLABUS",
        entityId: draftId,
        after: existingDraft
      });
    });

    const serialized = await serializeSyllabus(draftId);
    return sendSuccess(res, "Draft syllabus updated", serialized);
  }

  let result: string;
  try {
    result = await withTransaction(async (session) => {
      const sessionOpt = getSessionOption(session);
      const {
        units: _legacyUnits,
        chapters: _chapterPayload,
        teacherId: _teacherId,
        ...headerFields
      } = payload;

      const created = await AcademicSyllabus.create(
        [
          {
            ...headerFields,
            yearId,
            batchId,
            classId,
            sectionId,
            teacherId: optionalTeacherId || undefined,
            schoolId: tenantObjectId(req),
            status: "DRAFT",
            hierarchyMigratedAt: new Date(),
            audit: { createdBy: actorObjectId(req) }
          }
        ],
        sessionOpt
      );

      const doc = created[0];
      if (!doc) throw new ApiError(500, "Failed to create syllabus");

      await saveSyllabusHierarchy(
        {
          schoolId: tenantObjectId(req).toString(),
          syllabusId: doc._id.toString(),
          chapters
        },
        session ?? undefined
      );

      await recordAudit(req, {
        action: "academic.syllabus.create",
        entity: "SYLLABUS",
        entityId: doc._id.toString(),
        after: doc
      });
      return doc._id.toString();
    });
  } catch (error) {
    const { throwIfDuplicateKey } = await import("../utils/mongoErrors.js");
    throwIfDuplicateKey(error);
    throw error;
  }

  const serialized = await serializeSyllabus(result);
  return sendSuccess(res, "Syllabus created", serialized, 201);
});

export const updateSyllabus = asyncHandler(async (req: Request, res: Response) => {
  let payload: ReturnType<typeof academicSyllabusUpdateSchema.parse>;
  try {
    payload = academicSyllabusUpdateSchema.parse(req.body ?? {});
  } catch (error) {
    // Re-throw Zod as-is (errorHandler → 400 with field paths)
    throw error;
  }

  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });

  if (!existing) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: existing.teacherId?.toString(),
    subjectId: existing.subjectId.toString()
  });
  if (req.user?.role === "TEACHER") {
    throw new ApiError(
      403,
      "Teachers cannot edit the syllabus. Use Session Plan, Lesson Plan, and Log Book for teaching work. Sub-unit progress can be updated from the syllabus view if needed."
    );
  }
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  // Rewrite hierarchy when client sends structure (including blank unit titles).
  const hasChaptersField = payload.chapters !== undefined;
  const hasUnitsField = payload.units !== undefined;
  const structureChanging = hasChaptersField || hasUnitsField;

  /**
   * Deep-clone structure BEFORE any sanitize/delete.
   * Shallow clone of payload is not enough if a later step mutates nested arrays;
   * hierarchy rewrite must always see the original units/sub-units from the request.
   */
  const chaptersSnapshot: AcademicSyllabusChapterInput[] | undefined = Array.isArray(
    payload.chapters
  )
    ? (JSON.parse(JSON.stringify(payload.chapters)) as AcademicSyllabusChapterInput[])
    : undefined;
  const unitsSnapshot = Array.isArray(payload.units)
    ? (JSON.parse(JSON.stringify(payload.units)) as NonNullable<typeof payload.units>)
    : undefined;

  // ALWAYS shallow-clone header fields so delete of chapters/units cannot touch payload.
  const safePayload = {
    ...sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>)
  } as Record<string, unknown>;
  // Never assign empty strings to ObjectId fields (mongoose CastError → 400)
  for (const key of ["classId", "sectionId", "batchId", "yearId", "teacherId"] as const) {
    if (safePayload[key] === "" || safePayload[key] === null) {
      safePayload[key] = undefined;
    }
  }
  if (safePayload.teacherId === "") {
    safePayload.teacherId = undefined;
  }
  delete safePayload.units;
  delete safePayload.chapters;

  await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    Object.assign(existing, safePayload, {
      audit: { ...existing.audit, updatedBy: actorObjectId(req) }
    });
    if (payload.teacherId !== undefined && !payload.teacherId?.trim()) {
      existing.teacherId = undefined;
    }
    // Clear ObjectId fields when client sent empty
    for (const key of ["classId", "sectionId", "batchId", "yearId"] as const) {
      if (safePayload[key] === undefined && key in (req.body ?? {})) {
        const raw = (req.body as Record<string, unknown>)[key];
        if (raw === "" || raw === null) {
          (existing as unknown as Record<string, unknown>)[key] = undefined;
        }
      }
    }
    existing.hierarchyMigratedAt = new Date();
    await existing.save(sessionOpt);

    if (structureChanging) {
      // Prefer hierarchical chapters; fall back to legacy units when needed
      const resolved =
        hasChaptersField &&
        Array.isArray(chaptersSnapshot) &&
        chaptersSnapshot.length > 0
          ? resolveSyllabusChapters({ chapters: chaptersSnapshot })
          : resolveSyllabusChapters({
              chapters: chaptersSnapshot,
              units: unitsSnapshot
            });

      // Hierarchy rewrite is ALWAYS scoped to this one syllabus document only.
      const syllabusIdStr = existing._id.toString();
      const countFilter = { syllabusId: existing._id };
      const countOpts = getSessionOption(session);
      const [existingTopicCount, existingChapterCount, existingSubCount] =
        await Promise.all([
          AcademicSyllabusTopic.countDocuments(countFilter, countOpts),
          AcademicSyllabusChapter.countDocuments(countFilter, countOpts),
          AcademicSyllabusSubUnit.countDocuments(countFilter, countOpts)
        ]);
      const existingHasHierarchy =
        existingTopicCount > 0 || existingChapterCount > 0 || existingSubCount > 0;

      const incomingUnitCount = countUnitsInChapters(resolved);
      const incomingSubCount = countAllSubsInChapters(resolved);
      const incomingEmptyShell = isEmptyHierarchyShell(resolved);
      // Growth: more units/subs than DB → always rewrite (never treat as empty shell)
      const isGrowing =
        incomingUnitCount > existingTopicCount ||
        incomingSubCount > existingSubCount;

      /**
       * CRITICAL SAFETY (VPS wipe bug):
       * Never wipe with an empty shell. Multi-unit drafts and growth always save.
       */
      if (
        existingHasHierarchy &&
        !isGrowing &&
        (!resolved.length || incomingEmptyShell)
      ) {
        // Keep existing hierarchy; only metadata above was updated.
      } else if (
        existingHasHierarchy &&
        !isGrowing &&
        existingTopicCount >= 2 &&
        incomingUnitCount <= 1 &&
        incomingSubCount === 0 &&
        existingSubCount > 0 &&
        !chaptersHaveRealContent(resolved)
      ) {
        throw new ApiError(
          400,
          "Cannot replace syllabus structure with empty units. Reload the syllabus and try again, or keep existing units in the form before saving."
        );
      } else if (resolved.length > 0) {
        await saveSyllabusHierarchy(
          {
            schoolId: tenantObjectId(req).toString(),
            syllabusId: syllabusIdStr,
            chapters: resolved
          },
          session ?? undefined
        );
      }
    }

    await recordAudit(req, {
      action: "academic.syllabus.update",
      entity: "SYLLABUS",
      entityId: existing._id.toString(),
      after: existing
    });
  });

  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus updated", serialized);
});

export const deleteSyllabus = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: existing.teacherId?.toString(),
    subjectId: existing.subjectId.toString()
  });

  existing.isDeleted = true;
  existing.audit = { ...existing.audit, deletedBy: actorObjectId(req), deletedAt: new Date() };
  await existing.save();
  await deleteSyllabusHierarchy(existing._id.toString());
  await AcademicSyllabusUnit.deleteMany({ syllabusId: existing._id });
  await recordAudit(req, {
    action: "academic.syllabus.delete",
    entity: "SYLLABUS",
    entityId: existing._id.toString()
  });
  return sendSuccess(res, "Syllabus deleted", { deleted: true });
});

/** Teacher progress update on a single sub-unit (no structure changes). */
export const updateSyllabusSubUnitProgress = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSyllabusSubUnitProgressSchema.parse(req.body ?? {});
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: existing.teacherId?.toString(),
    subjectId: existing.subjectId.toString()
  });

  const subUnit = await AcademicSyllabusSubUnit.findOne({
    _id: req.params.subUnitId,
    syllabusId: existing._id,
    schoolId: tenantObjectId(req)
  });
  if (!subUnit) throw new ApiError(404, "Sub unit not found");

  if (payload.status !== undefined) subUnit.status = payload.status;
  if (payload.teachingNotes !== undefined) subUnit.teachingNotes = payload.teachingNotes;
  if (payload.teacherAttachments !== undefined) {
    subUnit.set("teacherAttachments", payload.teacherAttachments);
  }
  if (payload.todaysCoverage !== undefined) subUnit.todaysCoverage = payload.todaysCoverage;
  if (payload.remarks !== undefined) subUnit.remarks = payload.remarks;
  await subUnit.save();

  // Keep legacy flat unit status in sync for THIS topic (unitNo), not chapter number
  const topic = await AcademicSyllabusTopic.findById(subUnit.unitId).lean();
  if (topic) {
    const unitSubs = await AcademicSyllabusSubUnit.find({ unitId: topic._id }).lean();
    const allDone =
      unitSubs.length > 0 &&
      unitSubs.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
    const anyProgress = unitSubs.some(
      (s) =>
        s.status === "IN_PROGRESS" || s.status === "COMPLETED" || s.status === "SKIPPED"
    );
    const legacyStatus = allDone
      ? "COMPLETED"
      : anyProgress
        ? "IN_PROGRESS"
        : "PENDING";
    await AcademicSyllabusUnit.updateOne(
      { syllabusId: existing._id, unitNo: topic.unitNo },
      { $set: { status: legacyStatus } }
    );
  }

  await recordAudit(req, {
    action: "academic.syllabus.subUnit.progress",
    entity: "SYLLABUS",
    entityId: existing._id.toString(),
    after: { subUnitId: subUnit._id.toString(), status: subUnit.status }
  });

  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Sub unit progress updated", serialized);
});

/** Reorder chapters / units / sub-units and renumber automatically. */
export const reorderSyllabusHierarchy = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSyllabusReorderSchema.parse(req.body ?? {});
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: existing.teacherId?.toString(),
    subjectId: existing.subjectId.toString()
  });
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    if (payload.chapterIds?.length) {
      for (let i = 0; i < payload.chapterIds.length; i++) {
        await AcademicSyllabusChapter.updateOne(
          { _id: payload.chapterIds[i], syllabusId: existing._id },
          { $set: { sortOrder: i } },
          sessionOpt
        );
      }
    }
    if (payload.unitIdsByChapter) {
      for (const [chapterId, unitIds] of Object.entries(payload.unitIdsByChapter)) {
        for (let i = 0; i < unitIds.length; i++) {
          await AcademicSyllabusTopic.updateOne(
            { _id: unitIds[i], chapterId, syllabusId: existing._id },
            { $set: { sortOrder: i } },
            sessionOpt
          );
        }
      }
    }
    if (payload.subUnitIdsByUnit) {
      for (const [unitId, subIds] of Object.entries(payload.subUnitIdsByUnit)) {
        for (let i = 0; i < subIds.length; i++) {
          await AcademicSyllabusSubUnit.updateOne(
            { _id: subIds[i], unitId, syllabusId: existing._id },
            { $set: { sortOrder: i } },
            sessionOpt
          );
        }
      }
    }
    await renumberAfterReorder(existing._id.toString(), session ?? undefined);
    // Rebuild legacy units from current hierarchy numbers via serialize path after commit
  });

  // Rebuild legacy flat units from hierarchy
  const serialized = await serializeSyllabus(existing._id.toString());
  if (serialized?.chapters) {
    const { chaptersToLegacyUnits } = await import("../utils/syllabusHierarchyService.js");
    const mapSubInput = (
      s: (typeof serialized.chapters)[number]["units"][number]["subUnits"][number]
    ): import("@phit-erp/shared").AcademicSyllabusSubUnitInputShape => ({
      subUnitNo: s.subUnitNo,
      heading: s.heading,
      description: s.description,
      learningOutcomes: s.learningOutcomes,
      internalAssessment: s.internalAssessment,
      practicalRequired: s.practicalRequired,
      labName: s.labName,
      requiredEquipment: s.requiredEquipment,
      hospitalPosting: s.hospitalPosting,
      clinicalHours: s.clinicalHours,
      references: s.references,
      teachingHours: s.teachingHours,
      attachments: s.attachments,
      remarks: s.remarks,
      status: s.status,
      teachingNotes: s.teachingNotes,
      teacherAttachments: s.teacherAttachments,
      todaysCoverage: s.todaysCoverage,
      children: (s.children ?? []).map(mapSubInput)
    });
    const legacy = chaptersToLegacyUnits(
      serialized.chapters.map((c) => ({
        chapterNo: c.chapterNo,
        sectionKind: c.sectionKind || (c.title ? "CHAPTER" : "NONE"),
        title: c.title,
        description: c.description,
        estimatedHours: c.estimatedHours,
        weightagePercent: c.weightagePercent,
        references: c.references,
        remarks: c.remarks,
        tentativeCompletionMonth: c.tentativeCompletionMonth,
        units: c.units.map((u) => ({
          unitNo: u.unitNo,
          title: u.title,
          description: u.description,
          teachingHours: u.teachingHours,
          learningObjective: u.learningObjective,
          references: u.references,
          remarks: u.remarks,
          practicalRequired: Boolean(u.practicalRequired),
          subUnits: u.subUnits.map(mapSubInput)
        }))
      })),
      existing._id.toString()
    );
    await AcademicSyllabusUnit.deleteMany({ syllabusId: existing._id });
    if (legacy.length) {
      await AcademicSyllabusUnit.insertMany(
        legacy.map((unit) => ({
          ...unit,
          schoolId: tenantObjectId(req),
          syllabusId: existing._id
        }))
      );
    }
  }

  await recordAudit(req, {
    action: "academic.syllabus.reorder",
    entity: "SYLLABUS",
    entityId: existing._id.toString()
  });

  const refreshed = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus hierarchy reordered", refreshed);
});

export const submitSyllabus = asyncHandler(async (req: Request, res: Response) => {
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");
  await assertSyllabusAccess(req, {
    teacherId: existing.teacherId?.toString(),
    subjectId: existing.subjectId.toString()
  });

  // Submit is status-only. Never touch hierarchy here (prevents wipe-on-submit).
  // Client may PUT first when the editor is open with a full safe payload.
  const [topicCount, chapterCount] = await Promise.all([
    AcademicSyllabusTopic.countDocuments({ syllabusId: existing._id }),
    AcademicSyllabusChapter.countDocuments({ syllabusId: existing._id })
  ]);
  if (topicCount === 0 && chapterCount === 0) {
    throw new ApiError(
      400,
      "Cannot submit an empty syllabus. Add at least one unit, Save draft, then Submit."
    );
  }

  existing.status = "PENDING_APPROVAL";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await notifyAdmins(req, "Syllabus Submitted", "A syllabus was submitted for approval.", {
    entityId: existing._id.toString()
  });
  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus submitted", serialized);
});

export const approveSyllabus = asyncHandler(async (req: Request, res: Response) => {
  academicApprovalActionSchema.parse(req.body ?? {});
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can approve");
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");
  assertApprovableStatus(existing.status);

  existing.status = "APPROVED";
  existing.adminRemarks = req.body?.remarks;
  existing.audit = {
    ...existing.audit,
    approvedBy: actorObjectId(req),
    approvedAt: new Date(),
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "SYLLABUS", existing._id.toString(), "APPROVED", req.body?.remarks);
  if (existing.teacherId) {
    await notifyTeacher(
      req,
      existing.teacherId.toString(),
      "Syllabus Approved",
      "Your syllabus has been approved.",
      { entityId: existing._id.toString() }
    );
  }
  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus approved", serialized);
});

export const rejectSyllabus = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicRejectActionSchema.parse(req.body);
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can reject");
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");

  existing.status = "REJECTED";
  existing.adminRemarks = payload.remarks;
  existing.audit = {
    ...existing.audit,
    rejectedBy: actorObjectId(req),
    rejectedAt: new Date(),
    rejectionReason: payload.remarks,
    updatedBy: actorObjectId(req)
  };
  await existing.save();
  await recordApproval(req, "SYLLABUS", existing._id.toString(), "REJECTED", payload.remarks);
  if (existing.teacherId) {
    await notifyTeacher(
      req,
      existing.teacherId.toString(),
      "Syllabus Rejected",
      payload.remarks,
      { entityId: existing._id.toString() }
    );
  }
  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus rejected", serialized);
});

export const unlockSyllabus = asyncHandler(async (req: Request, res: Response) => {
  if (!isAcademicAdmin(req.user?.role ?? "")) throw new ApiError(403, "Only administrators can unlock");
  const existing = await AcademicSyllabus.findOne({
    _id: req.params.id,
    schoolId: tenantObjectId(req),
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");

  existing.status = "DRAFT";
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();
  await recordApproval(req, "SYLLABUS", existing._id.toString(), "UNLOCKED");
  if (existing.teacherId) {
    await notifyTeacher(
      req,
      existing.teacherId.toString(),
      "Syllabus Unlocked",
      "Your syllabus has been unlocked for corrections.",
      { entityId: existing._id.toString() }
    );
  }
  const serialized = await serializeSyllabus(existing._id.toString());
  return sendSuccess(res, "Syllabus unlocked", serialized);
});

export const listLessonPlans = asyncHandler(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const filter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
  await applyTeacherScopeToFilter(req, filter);

  const plans = await AcademicLessonPlan.find(filter).sort({ updatedAt: -1 }).lean();
  const serialized = (
    await Promise.all(
      plans.map(async (plan) => {
        try {
          return await serializeLessonPlan(plan._id.toString());
        } catch (error) {
          console.error(
            "[academic-management/lesson-plans] serialize failed",
            plan._id.toString(),
            error
          );
          return null;
        }
      })
    )
  ).filter(Boolean);
  const rows = serialized.filter((plan) =>
    matchesKeyword(filters.keyword, [
      plan?.subject?.name,
      plan?.teacher?.user?.fullName,
      plan?.status,
      plan?.month,
      plan?.teachingDateBs,
      ...(plan?.items ?? []).map((item) => item.plannedTopic)
    ])
  );
  return sendSuccess(res, "Lesson plans fetched", rows);
});

export const createLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const parsed = academicLessonPlanSchema.parse(req.body);
  const payload = {
    ...parsed,
    items: parsed.items.map((item) => normalizeSubUnitSelection(item))
  };

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) throw new ApiError(403, "Teachers can only create lesson plans for themselves");
  }

  // Hierarchical rule: Lesson Plan must come from a usable Session Plan (draft OK for owning teacher)
  await assertApprovedSessionPlanForLesson(req, payload.sessionPlanId, {
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    academicYearBs: payload.academicYearBs
  });
  await assertLessonPlanItemsBelongToSessionPlan(req, payload.sessionPlanId, payload.items);
  // One lesson plan = one teaching day
  const teachingDateBs =
    (payload.teachingDateBs || payload.startDateBs || payload.endDateBs || "").trim();
  const derivedMonth =
    payload.month || getNepaliMonthNameFromBsDate(teachingDateBs) || "";
  payload.items = mergeLessonPlanItemsByUnit(payload.items);
  const unitIds = payload.items.map((item) => item.sessionPlanUnitId);
  assertUniqueUnitsInLessonPlan(unitIds);
  // Same unit may span many teaching days; date must stay inside Session Plan unit window
  await assertTeachingDateWithinSessionPlanUnits(
    req,
    payload.sessionPlanId,
    teachingDateBs,
    unitIds
  );
  // Sub-unit rows carry their own dates — hold those to the unit window too
  await assertLessonPlanItemDatesWithinSessionPlanUnits(
    req,
    payload.sessionPlanId,
    payload.items
  );

  const result = await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    // Never spread raw payload (includes `items` + empty ObjectId strings that can 500).
    const plan = await AcademicLessonPlan.create(
      [
        {
          schoolId: tenantObjectId(req),
          sessionPlanId: payload.sessionPlanId,
          academicYearBs: payload.academicYearBs,
          session: payload.session,
          faculty: payload.faculty || undefined,
          semesterBs: payload.semesterBs || undefined,
          classId: optionalObjectId(payload.classId),
          sectionId: optionalObjectId(payload.sectionId),
          batchId: optionalObjectId(payload.batchId),
          yearId: optionalObjectId(payload.yearId),
          subjectId: payload.subjectId,
          teacherId: payload.teacherId,
          teachingDateBs,
          startDateBs: teachingDateBs,
          endDateBs: teachingDateBs,
          month: derivedMonth,
          monthlyDescription: payload.monthlyDescription || "",
          status: "DRAFT",
          preparedBy: await getActorName(req.user!.userId),
          audit: { createdBy: actorObjectId(req) }
        }
      ],
      sessionOpt
    );

    const createdPlan = plan[0];
    if (!createdPlan) throw new ApiError(500, "Failed to create lesson plan");

    // Inherit unit title / topics from Session Plan when client omits free text
    const unitsQuery = AcademicSessionPlanUnit.find({
      _id: { $in: unitIds },
      sessionPlanId: payload.sessionPlanId
    });
    if (session) unitsQuery.session(session);
    const units = await unitsQuery.lean();
    const unitMap = new Map(units.map((unit) => [unit._id.toString(), unit]));

    await AcademicLessonPlanItem.insertMany(
      payload.items.map((item) =>
        buildLessonPlanItemDoc(
          item,
          unitMap.get(item.sessionPlanUnitId),
          tenantObjectId(req),
          createdPlan._id
        )
      ),
      sessionOpt
    );

    await syncSessionPlanProgress(createdPlan.sessionPlanId!.toString());

    await recordAudit(req, { action: "academic.lesson_plan.create", entity: "LESSON_PLAN", entityId: createdPlan._id.toString(), after: createdPlan });
    return createdPlan._id.toString();
  });

  const serialized = await serializeLessonPlan(result);
  return sendSuccess(res, "Lesson plan created", serialized, 201);
});

export const updateLessonPlan = asyncHandler(async (req: Request, res: Response) => {
  const parsed = academicLessonPlanSchema.partial().parse(req.body);
  const payload = {
    ...parsed,
    ...(parsed.items
      ? { items: parsed.items.map((item) => normalizeSubUnitSelection(item)) }
      : {})
  };
  const existing = await AcademicLessonPlan.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Lesson plan not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "")) assertEditableStatus(existing.status);

  const sessionPlanId = payload.sessionPlanId ?? existing.sessionPlanId?.toString();
  if (!sessionPlanId) {
    throw new ApiError(400, "Lesson Plan must be linked to a Session Plan.");
  }

  const subjectId = payload.subjectId ?? existing.subjectId.toString();
  const teacherId = payload.teacherId ?? existing.teacherId.toString();
  const academicYearBs = payload.academicYearBs ?? existing.academicYearBs;
  const teachingDateBs =
    (payload.teachingDateBs ||
      payload.startDateBs ||
      (existing as { teachingDateBs?: string }).teachingDateBs ||
      (existing as { startDateBs?: string }).startDateBs ||
      "").trim();
  const month =
    payload.month ||
    existing.month ||
    (teachingDateBs ? getNepaliMonthNameFromBsDate(teachingDateBs) : "");

  await assertApprovedSessionPlanForLesson(req, sessionPlanId, {
    subjectId,
    teacherId,
    academicYearBs
  });

  if (payload.items) {
    payload.items = mergeLessonPlanItemsByUnit(payload.items);
    await assertLessonPlanItemsBelongToSessionPlan(req, sessionPlanId, payload.items);
    const unitIds = payload.items.map((item) => item.sessionPlanUnitId);
    assertUniqueUnitsInLessonPlan(unitIds);
    if (teachingDateBs) {
      await assertTeachingDateWithinSessionPlanUnits(
        req,
        sessionPlanId,
        teachingDateBs,
        unitIds
      );
    }
    await assertLessonPlanItemDatesWithinSessionPlanUnits(
      req,
      sessionPlanId,
      payload.items
    );
  } else if (teachingDateBs) {
    // Date changed without re-sending items — still enforce window against existing items
    const existingItems = await AcademicLessonPlanItem.find({
      lessonPlanId: existing._id
    })
      .select("sessionPlanUnitId")
      .lean();
    const unitIds = existingItems
      .map((item) => item.sessionPlanUnitId?.toString?.() || String(item.sessionPlanUnitId || ""))
      .filter(Boolean);
    if (unitIds.length > 0) {
      await assertTeachingDateWithinSessionPlanUnits(
        req,
        sessionPlanId,
        teachingDateBs,
        unitIds
      );
    }
  }

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);
  // Never assign nested `items` or empty ObjectId strings onto the plan document
  const {
    items: _itemsIgnored,
    classId: rawClassId,
    sectionId: rawSectionId,
    batchId: rawBatchId,
    yearId: rawYearId,
    subjectId: rawSubjectId,
    teacherId: rawTeacherId,
    sessionPlanId: _rawSp,
    ...restPlanFields
  } = safePayload;

  await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    Object.assign(existing, restPlanFields, {
      sessionPlanId,
      subjectId: optionalObjectId(rawSubjectId) || existing.subjectId,
      teacherId: optionalObjectId(rawTeacherId) || existing.teacherId,
      classId: optionalObjectId(rawClassId) ?? existing.classId,
      sectionId: optionalObjectId(rawSectionId) ?? existing.sectionId,
      batchId: optionalObjectId(rawBatchId) ?? existing.batchId,
      yearId: optionalObjectId(rawYearId) ?? existing.yearId,
      month,
      teachingDateBs,
      startDateBs: teachingDateBs,
      endDateBs: teachingDateBs,
      audit: { ...existing.audit, updatedBy: actorObjectId(req) }
    });
    // Clear optional refs when client explicitly sends empty string
    if (rawClassId !== undefined && !optionalObjectId(rawClassId)) existing.classId = undefined;
    if (rawSectionId !== undefined && !optionalObjectId(rawSectionId)) existing.sectionId = undefined;
    if (rawBatchId !== undefined && !optionalObjectId(rawBatchId)) existing.batchId = undefined;
    if (rawYearId !== undefined && !optionalObjectId(rawYearId)) existing.yearId = undefined;
    await existing.save(sessionOpt);

    if (payload.items) {
      const unitIds = payload.items.map((item) => item.sessionPlanUnitId).filter(Boolean);
      const unitsQuery = AcademicSessionPlanUnit.find({
        _id: { $in: unitIds },
        sessionPlanId
      });
      if (session) unitsQuery.session(session);
      const units = await unitsQuery.lean();
      const unitMap = new Map(units.map((unit) => [unit._id.toString(), unit]));

      const itemsQuery = AcademicLessonPlanItem.find({ lessonPlanId: existing._id });
      if (session) itemsQuery.session(session);
      const existingItems = await itemsQuery;
      const bySerial = new Map(existingItems.map((item) => [item.serialNo, item]));
      const keptSerials = new Set<number>();

      for (const item of payload.items) {
        keptSerials.add(item.serialNo);
        const prev = bySerial.get(item.serialNo);
        const unit = unitMap.get(item.sessionPlanUnitId);
        const doc = buildLessonPlanItemDoc(
          item,
          unit,
          tenantObjectId(req),
          existing._id
        );
        if (prev) {
          // Preserve progress fields — never allow manual COMPLETED without Log Book
          const completedClasses = prev.completedClasses;
          const completionStatus = prev.completionStatus;
          // Unset empty ObjectId paths so Mongoose does not cast ""
          prev.set({
            serialNo: doc.serialNo,
            sessionPlanUnitId: doc.sessionPlanUnitId,
            subjectLabel: doc.subjectLabel,
            plannedTopic: doc.plannedTopic,
            description: doc.description,
            learningObjectives: doc.learningObjectives,
            teachingMethod: doc.teachingMethod,
            teachingAids: doc.teachingAids,
            assessmentMethod: doc.assessmentMethod,
            deadline: doc.deadline,
            itemStartDateBs: doc.itemStartDateBs,
            itemEndDateBs: doc.itemEndDateBs,
            estimatedClasses: doc.estimatedClasses,
            remarks: doc.remarks,
            subUnitTitles: doc.subUnitTitles,
            subUnitTitle: doc.subUnitTitle,
            syllabusSubUnitIds: doc.syllabusSubUnitIds,
            completedClasses,
            completionStatus
          });
          if (doc.syllabusId) prev.set("syllabusId", doc.syllabusId);
          else prev.set("syllabusId", undefined);
          if (doc.syllabusChapterId) prev.set("syllabusChapterId", doc.syllabusChapterId);
          else prev.set("syllabusChapterId", undefined);
          if (doc.syllabusUnitId) prev.set("syllabusUnitId", doc.syllabusUnitId);
          else prev.set("syllabusUnitId", undefined);
          if (doc.syllabusSubUnitId) prev.set("syllabusSubUnitId", doc.syllabusSubUnitId);
          else prev.set("syllabusSubUnitId", undefined);
          await prev.save(sessionOpt);
        } else {
          await AcademicLessonPlanItem.create([doc], sessionOpt);
        }
      }

      for (const prev of existingItems) {
        if (keptSerials.has(prev.serialNo)) continue;
        const linkedQuery = AcademicLogBookEntry.countDocuments({
          lessonPlanItemId: prev._id,
          isDeleted: false
        });
        if (session) linkedQuery.session(session);
        const linkedLogs = await linkedQuery;
        if (linkedLogs > 0) {
          throw new ApiError(
            400,
            `Cannot remove topic "${prev.plannedTopic}" (SN ${prev.serialNo}) because log book entries are linked to it.`
          );
        }
        await prev.deleteOne(sessionOpt);
      }
    }

    await syncSessionPlanProgress(sessionPlanId);
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

  const items = await AcademicLessonPlanItem.find({ lessonPlanId: existing._id })
    .select("sessionPlanUnitId")
    .lean();
  const unitIds = [
    ...new Set(
      items
        .map((item) => item.sessionPlanUnitId?.toString())
        .filter(Boolean) as string[]
    )
  ];

  existing.isDeleted = true;
  existing.audit = { ...existing.audit, deletedBy: actorObjectId(req), deletedAt: new Date() };
  await existing.save();

  // Recompute unit/session progress so soft-deleted plans stop counting
  for (const unitId of unitIds) {
    await resyncSessionPlanUnitProgress(unitId);
  }
  if (existing.sessionPlanId) {
    await syncSessionPlanProgress(existing.sessionPlanId.toString());
  }

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
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
  if (filters.status) {
    filter.reviewStatus = filters.status;
  }
  delete filter.status;
  // Log book entries store dateBs only — never filter on plan-style month string
  const monthName = typeof filter.month === "string" ? filter.month : undefined;
  delete filter.month;
  await applyTeacherScopeToFilter(req, filter);

  if (filters.dateFrom || filters.dateTo) {
    filter.dateBs = {
      ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { $lte: filters.dateTo } : {})
    };
  } else if (monthName) {
    // Map Nepali month name → BS month number for dateBs prefix filter
    const monthIdx = NEPALI_MONTH_NAMES.findIndex(
      (m) => m.toLowerCase() === monthName.toLowerCase()
    );
    if (monthIdx >= 0) {
      const mm = String(monthIdx + 1).padStart(2, "0");
      filter.dateBs = { $regex: `^\\d{4}-${mm}-` };
    }
  }

  const entries = await AcademicLogBookEntry.find(filter).sort({ dateBs: -1, periodNumber: 1 }).lean();
  const serialized = (await Promise.all(entries.map((entry) => serializeLogBookEntry(entry._id.toString())))).filter(Boolean);
  const rows = serialized.filter((entry) =>
    matchesKeyword(filters.keyword, [
      entry?.topicCovered,
      entry?.unit,
      entry?.subUnitTitle,
      ...(entry?.subUnitTitles ?? []),
      entry?.subject?.name,
      entry?.teacher?.user?.fullName,
      entry?.reviewStatus
    ])
  );
  return sendSuccess(res, "Log book entries fetched", rows);
});

export const createLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = normalizeSubUnitSelection(academicLogBookEntrySchema.parse(req.body));
  const dateBs = ensureValidBsDate(parsed.dateBs);
  const payload = { ...parsed, dateBs };

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (payload.teacherId !== scope.teacherId) throw new ApiError(403, "Teachers can only create their own log book entries");
  }

  // Unit / Lesson Plan links are resolved so Log Book updates completion %
  const unitId = optionalObjectId(payload.sessionPlanUnitId);
  let unitDoc = unitId ? await AcademicSessionPlanUnit.findById(unitId).lean() : null;
  if (unitDoc && unitDoc.schoolId.toString() !== tenantObjectId(req).toString()) {
    unitDoc = null;
  }

  let unitLabel =
    (payload.unit || "").trim() ||
    (unitDoc ? `Unit ${unitDoc.unitNo}: ${unitDoc.chapterName}` : "");
  let lessonPlanId: string | undefined = optionalObjectId(payload.lessonPlanId);
  let lessonPlanItemId: string | undefined = optionalObjectId(payload.lessonPlanItemId);

  const link = await resolveLogBookLessonPlanLink(req, {
    lessonPlanItemId,
    sessionPlanUnitId: unitId || payload.sessionPlanUnitId,
    teacherId: payload.teacherId,
    subjectId: payload.subjectId,
    dateBs
  });
  if (link) {
    lessonPlanItemId = link.itemId;
    lessonPlanId = link.planId;
    if (!unitDoc && link.sessionPlanUnitId) {
      const linkedUnit = await AcademicSessionPlanUnit.findById(link.sessionPlanUnitId).lean();
      if (linkedUnit && linkedUnit.schoolId.toString() === tenantObjectId(req).toString()) {
        unitDoc = linkedUnit;
        unitLabel =
          unitLabel || `Unit ${linkedUnit.unitNo}: ${linkedUnit.chapterName}`;
      }
    }
    unitLabel = unitLabel || unitDoc?.chapterName || "";
    payload.topicCovered = payload.topicCovered || link.subUnitTitles.join("; ") || unitLabel;
    if (!payload.syllabusId && link.syllabusId) payload.syllabusId = link.syllabusId;
    if (!payload.syllabusChapterId && link.syllabusChapterId) {
      payload.syllabusChapterId = link.syllabusChapterId;
    }
    if (!payload.syllabusUnitId && link.syllabusUnitId) {
      payload.syllabusUnitId = link.syllabusUnitId;
    }
    const payloadTitles = Array.isArray(payload.subUnitTitles)
      ? payload.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
      : [];
    if (payloadTitles.length > 0) {
      payload.subUnitTitles = payloadTitles;
      payload.subUnitTitle = payloadTitles.join("; ");
    } else if (link.subUnitTitles.length > 0) {
      payload.subUnitTitles = link.subUnitTitles;
      payload.subUnitTitle = link.subUnitTitles.join("; ");
    }
    const payloadIds = Array.isArray(payload.syllabusSubUnitIds)
      ? payload.syllabusSubUnitIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (payloadIds.length > 0) {
      payload.syllabusSubUnitIds = payloadIds;
      payload.syllabusSubUnitId = payloadIds[0] || "";
    } else if (link.syllabusSubUnitIds.length > 0 && payloadTitles.length === 0) {
      payload.syllabusSubUnitIds = link.syllabusSubUnitIds;
      payload.syllabusSubUnitId = link.syllabusSubUnitIds[0] || "";
    }
  }

  // Inherit chapter link from Session Plan unit when not set
  if (unitDoc) {
    const unitAny = unitDoc as {
      syllabusId?: { toString(): string };
      syllabusChapterId?: { toString(): string };
    };
    if (!payload.syllabusId && unitAny.syllabusId) payload.syllabusId = unitAny.syllabusId.toString();
    if (!payload.syllabusChapterId && unitAny.syllabusChapterId) {
      payload.syllabusChapterId = unitAny.syllabusChapterId.toString();
    }
  }

  const taughtTitles = Array.isArray(payload.subUnitTitles)
    ? payload.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
    : payload.subUnitTitle
      ? String(payload.subUnitTitle)
          .split(/[;\n|]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  payload.subUnitTitles = taughtTitles;
  payload.subUnitTitle = taughtTitles.join("; ");

  if (taughtTitles.length > 0) {
    const unitName = unitDoc?.chapterName || unitLabel;
    payload.topicCovered =
      payload.topicCovered ||
      (unitName ? `${unitName} — ${taughtTitles.join("; ")}` : taughtTitles.join("; "));
  } else {
    payload.topicCovered =
      payload.topicCovered || unitDoc?.topicsCovered || unitDoc?.chapterName || unitLabel || "";
  }
  payload.unit = unitLabel;
  if (unitDoc) payload.sessionPlanUnitId = unitDoc._id.toString();
  else delete (payload as { sessionPlanUnitId?: string }).sessionPlanUnitId;
  // Never assign "" to ObjectId fields — use undefined when unlinked
  if (lessonPlanId) payload.lessonPlanId = lessonPlanId;
  else delete (payload as { lessonPlanId?: string }).lessonPlanId;
  if (lessonPlanItemId) {
    payload.lessonPlanItemId = lessonPlanItemId;
  } else {
    delete (payload as { lessonPlanItemId?: string }).lessonPlanItemId;
  }

  // Use Nepali month name so Log Book groups align with Lesson Plan period
  const month = getNepaliMonthNameFromBsDate(dateBs);
  const logBookId = await getOrCreateLogBook(req, {
    academicYearBs: payload.academicYearBs,
    session: payload.session,
    faculty: payload.faculty?.trim() || undefined,
    semesterBs: payload.semesterBs?.trim() || undefined,
    classId: optionalObjectId(payload.classId),
    sectionId: optionalObjectId(payload.sectionId),
    batchId: optionalObjectId(payload.batchId),
    yearId: optionalObjectId(payload.yearId),
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    month
  });

  const attendance = await getAttendanceForSession(req, {
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    dateBs,
    classId: optionalObjectId(payload.classId),
    sectionId: optionalObjectId(payload.sectionId),
    batchId: optionalObjectId(payload.batchId),
    yearId: optionalObjectId(payload.yearId)
  });

  const count = await AcademicLogBookEntry.countDocuments({ logBookId, isDeleted: false });
  const periodNumber = await nextLogBookPeriodNumber(
    req,
    payload.teacherId,
    payload.subjectId,
    dateBs
  );

  const taughtSubUnitIds = await resolveTaughtSyllabusSubUnitIds(req, {
    taughtTitles,
    knownIds: [
      ...(Array.isArray(payload.syllabusSubUnitIds) ? payload.syllabusSubUnitIds : []),
      payload.syllabusSubUnitId || ""
    ],
    syllabusId:
      payload.syllabusId ||
      (unitDoc as { syllabusId?: { toString(): string } } | null)?.syllabusId?.toString?.(),
    syllabusUnitId: payload.syllabusUnitId,
    syllabusChapterId:
      payload.syllabusChapterId ||
      (unitDoc as { syllabusChapterId?: { toString(): string } } | null)?.syllabusChapterId?.toString?.(),
    subjectId: payload.subjectId
  });

  const entry = await AcademicLogBookEntry.create({
    schoolId: tenantObjectId(req),
    logBookId,
    lessonPlanId: lessonPlanId || undefined,
    lessonPlanItemId: lessonPlanItemId || undefined,
    sessionPlanUnitId: unitDoc?._id,
    subUnitTitles: taughtTitles,
    subUnitTitle: taughtTitles.join("; "),
    syllabusId: optionalObjectId(payload.syllabusId),
    syllabusChapterId: optionalObjectId(payload.syllabusChapterId),
    syllabusUnitId: optionalObjectId(payload.syllabusUnitId),
    syllabusSubUnitId: taughtSubUnitIds[0],
    syllabusSubUnitIds: taughtSubUnitIds,
    academicYearBs: payload.academicYearBs,
    session: payload.session,
    faculty: payload.faculty?.trim() || undefined,
    semesterBs: payload.semesterBs?.trim() || undefined,
    classId: optionalObjectId(payload.classId),
    sectionId: optionalObjectId(payload.sectionId),
    batchId: optionalObjectId(payload.batchId),
    yearId: optionalObjectId(payload.yearId),
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    timetableSlotId: optionalObjectId(payload.timetableSlotId),
    serialNo: count + 1,
    dateBs,
    unit: unitLabel,
    topicCovered: payload.topicCovered || "",
    objectives: payload.objectives || "",
    teachingMethod: payload.teachingMethod || "",
    teachingAids: payload.teachingAids || "",
    theoryPractical: payload.theoryPractical || "THEORY",
    periodNumber,
    startTime: payload.startTime?.trim() || undefined,
    endTime: payload.endTime?.trim() || undefined,
    attendancePresent: attendance.present,
    attendanceAbsent: attendance.absent,
    attendancePercent: attendance.percent,
    homeworkGiven: payload.homeworkGiven || "",
    assignment: payload.assignment || "",
    feedback: payload.feedback || "",
    difficultiesFaced: payload.difficultiesFaced || "",
    nextClassPlan: payload.nextClassPlan || "",
    attachmentUrl: payload.attachmentUrl?.trim() || undefined,
    teacherSignature: payload.teacherSignature?.trim() || "",
    audit: { createdBy: actorObjectId(req) }
  });

  // Auto progress when linked to a Lesson Plan item
  if (entry.lessonPlanItemId) {
    await syncLessonPlanItemProgress(entry.lessonPlanItemId.toString());
  }

  // Mark all linked syllabus sub-units completed when a class log is recorded
  if (taughtSubUnitIds.length > 0) {
    try {
      const { AcademicSyllabusSubUnit } = await import("../models/AcademicSyllabusSubUnit.js");
      await AcademicSyllabusSubUnit.updateMany(
        {
          _id: { $in: taughtSubUnitIds },
          schoolId: tenantObjectId(req)
        },
        {
          $set: {
            status: "COMPLETED",
            todaysCoverage: payload.topicCovered || taughtTitles.join("; ") || ""
          }
        }
      );
    } catch {
      // Non-blocking — log book entry is still valid without syllabus progress
    }
  }

  await recordAudit(req, { action: "academic.log_book.create", entity: "LOG_BOOK_ENTRY", entityId: entry._id.toString(), after: entry });
  const serialized = await serializeLogBookEntry(entry._id.toString());
  return sendSuccess(res, "Log book entry created", serialized, 201);
});

export const updateLogBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = academicLogBookEntrySchema.partial().parse(req.body);
  const normalized =
    parsed.subUnitTitle !== undefined ||
    parsed.subUnitTitles !== undefined ||
    parsed.syllabusSubUnitId !== undefined ||
    parsed.syllabusSubUnitIds !== undefined
      ? normalizeSubUnitSelection(parsed as {
          subUnitTitle?: string;
          subUnitTitles?: string[];
          syllabusSubUnitId?: string;
          syllabusSubUnitIds?: string[];
        })
      : parsed;
  const payload = {
    ...parsed,
    ...normalized,
    ...(parsed.dateBs ? { dateBs: ensureValidBsDate(parsed.dateBs) } : {})
  };
  const existing = await AcademicLogBookEntry.findOne({ _id: req.params.id, schoolId: tenantObjectId(req), isDeleted: false });
  if (!existing) throw new ApiError(404, "Log book entry not found");

  await assertTeacherOwnership(req, existing.teacherId.toString());
  if (!isAcademicAdmin(req.user?.role ?? "") && existing.reviewStatus === "APPROVED") {
    throw new ApiError(403, "Approved log book entries cannot be modified");
  }

  // If topic link changed, re-validate and re-populate inherited fields
  if (payload.lessonPlanItemId && payload.lessonPlanItemId !== existing.lessonPlanItemId?.toString()) {
    const item = await AcademicLessonPlanItem.findById(payload.lessonPlanItemId).lean();
    const plan =
      item && item.schoolId.toString() === tenantObjectId(req).toString()
        ? await AcademicLessonPlan.findOne({
            _id: item.lessonPlanId,
            schoolId: tenantObjectId(req),
            isDeleted: false
          }).lean()
        : null;
    if (item && plan) {
      payload.lessonPlanId = plan._id.toString();
      if (item.sessionPlanUnitId) payload.sessionPlanUnitId = item.sessionPlanUnitId.toString();
      if (!payload.topicCovered) payload.topicCovered = item.plannedTopic;
      if (!payload.objectives) payload.objectives = item.learningObjectives || "";
    }
  }

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);
  const previousItemId = existing.lessonPlanItemId?.toString();

  // Apply only safe scalar fields; never write "" into ObjectId paths
  const taughtTitles = Array.isArray(safePayload.subUnitTitles)
    ? (safePayload.subUnitTitles as string[]).map((t) => String(t).trim()).filter(Boolean)
    : typeof safePayload.subUnitTitle === "string"
      ? String(safePayload.subUnitTitle)
          .split(/[;\n|]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
  const taughtIds = optionalObjectIdList(
    safePayload.syllabusSubUnitIds ??
      (typeof safePayload.syllabusSubUnitId === "string"
        ? [safePayload.syllabusSubUnitId]
        : [])
  );

  if (safePayload.dateBs !== undefined && String(safePayload.dateBs) !== existing.dateBs) {
    existing.dateBs = String(safePayload.dateBs);
    existing.periodNumber = await nextLogBookPeriodNumber(
      req,
      existing.teacherId.toString(),
      existing.subjectId.toString(),
      existing.dateBs,
      existing._id.toString()
    );
  } else if (safePayload.dateBs !== undefined) {
    existing.dateBs = String(safePayload.dateBs);
  }
  if (safePayload.unit !== undefined) existing.unit = String(safePayload.unit ?? "");
  if (safePayload.topicCovered !== undefined) {
    existing.topicCovered = String(safePayload.topicCovered);
  }
  if (safePayload.objectives !== undefined) existing.objectives = String(safePayload.objectives ?? "");
  if (safePayload.teachingMethod !== undefined) {
    existing.teachingMethod = String(safePayload.teachingMethod ?? "");
  }
  if (safePayload.teachingAids !== undefined) {
    existing.teachingAids = String(safePayload.teachingAids ?? "");
  }
  if (safePayload.theoryPractical !== undefined) {
    existing.theoryPractical = safePayload.theoryPractical as typeof existing.theoryPractical;
  }
  if (safePayload.periodNumber !== undefined) {
    existing.periodNumber = Number(safePayload.periodNumber) || existing.periodNumber;
  }
  if (safePayload.startTime !== undefined) {
    existing.startTime = String(safePayload.startTime || "") || undefined;
  }
  if (safePayload.endTime !== undefined) {
    existing.endTime = String(safePayload.endTime || "") || undefined;
  }
  if (safePayload.homeworkGiven !== undefined) {
    existing.homeworkGiven = String(safePayload.homeworkGiven ?? "");
  }
  if (safePayload.assignment !== undefined) existing.assignment = String(safePayload.assignment ?? "");
  if (safePayload.feedback !== undefined) existing.feedback = String(safePayload.feedback ?? "");
  if (safePayload.difficultiesFaced !== undefined) {
    existing.difficultiesFaced = String(safePayload.difficultiesFaced ?? "");
  }
  if (safePayload.nextClassPlan !== undefined) {
    existing.nextClassPlan = String(safePayload.nextClassPlan ?? "");
  }
  if (safePayload.attachmentUrl !== undefined) {
    existing.attachmentUrl = String(safePayload.attachmentUrl || "") || undefined;
  }
  if (taughtTitles !== undefined) {
    existing.subUnitTitles = taughtTitles;
    existing.subUnitTitle = taughtTitles.join("; ");
  }
  if (
    safePayload.syllabusSubUnitIds !== undefined ||
    safePayload.syllabusSubUnitId !== undefined
  ) {
    existing.set("syllabusSubUnitIds", taughtIds);
    existing.set("syllabusSubUnitId", taughtIds[0] || undefined);
  }
  if (safePayload.syllabusId !== undefined) {
    existing.set("syllabusId", optionalObjectId(safePayload.syllabusId));
  }
  if (safePayload.syllabusChapterId !== undefined) {
    existing.set("syllabusChapterId", optionalObjectId(safePayload.syllabusChapterId));
  }
  if (safePayload.syllabusUnitId !== undefined) {
    existing.set("syllabusUnitId", optionalObjectId(safePayload.syllabusUnitId));
  }
  if (safePayload.sessionPlanUnitId !== undefined) {
    existing.set("sessionPlanUnitId", optionalObjectId(safePayload.sessionPlanUnitId));
  }
  if (safePayload.lessonPlanId !== undefined) {
    existing.set("lessonPlanId", optionalObjectId(safePayload.lessonPlanId));
  }
  if (safePayload.classId !== undefined) {
    existing.set("classId", optionalObjectId(safePayload.classId));
  }
  if (safePayload.sectionId !== undefined) {
    existing.set("sectionId", optionalObjectId(safePayload.sectionId));
  }
  if (safePayload.batchId !== undefined) {
    existing.set("batchId", optionalObjectId(safePayload.batchId));
  }
  if (safePayload.yearId !== undefined) {
    existing.set("yearId", optionalObjectId(safePayload.yearId));
  }
  if (payload.lessonPlanItemId !== undefined) {
    const linkedItemId = optionalObjectId(payload.lessonPlanItemId);
    if (linkedItemId) existing.set("lessonPlanItemId", linkedItemId);
  }
  if (safePayload.teacherSignature !== undefined) {
    existing.teacherSignature = String(safePayload.teacherSignature ?? "");
  }
  existing.audit = { ...existing.audit, updatedBy: actorObjectId(req) };
  await existing.save();

  if (!existing.lessonPlanItemId) {
    const relink = await resolveLogBookLessonPlanLink(req, {
      lessonPlanItemId: payload.lessonPlanItemId,
      sessionPlanUnitId: existing.sessionPlanUnitId?.toString(),
      teacherId: existing.teacherId.toString(),
      subjectId: existing.subjectId.toString(),
      dateBs: existing.dateBs
    });
    if (relink) {
      existing.set("lessonPlanItemId", relink.itemId);
      existing.set("lessonPlanId", relink.planId);
      if (relink.sessionPlanUnitId) existing.set("sessionPlanUnitId", relink.sessionPlanUnitId);
      await existing.save();
    }
  }

  const updatedTitles = Array.isArray(existing.subUnitTitles)
    ? existing.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const updatedSubIds = await resolveTaughtSyllabusSubUnitIds(req, {
    taughtTitles: updatedTitles,
    knownIds: (existing.syllabusSubUnitIds ?? []).map((id) => id.toString()),
    syllabusId: existing.syllabusId?.toString(),
    syllabusUnitId: existing.syllabusUnitId?.toString(),
    syllabusChapterId: existing.syllabusChapterId?.toString(),
    subjectId: existing.subjectId.toString()
  });
  if (updatedSubIds.length > 0) {
    existing.set("syllabusSubUnitIds", updatedSubIds);
    existing.set("syllabusSubUnitId", updatedSubIds[0]);
    await existing.save();
    await AcademicSyllabusSubUnit.updateMany(
      { _id: { $in: updatedSubIds }, schoolId: tenantObjectId(req) },
      {
        $set: {
          status: "COMPLETED",
          todaysCoverage: existing.topicCovered || updatedTitles.join("; ") || ""
        }
      }
    );
  }

  if (previousItemId) await syncLessonPlanItemProgress(previousItemId);
  if (existing.lessonPlanItemId) {
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

  const coverage = await getSessionPlanSyllabusCoverage(req, sessionPlanId);
  // Return enriched units (with plannedInMonths / planningStatus) for Lesson Plan selectors
  return sendSuccess(res, "Session plan units fetched", coverage.units);
});

export const getSyllabusCoverage = asyncHandler(async (req: Request, res: Response) => {
  const sessionPlanId =
    typeof req.query.sessionPlanId === "string"
      ? req.query.sessionPlanId
      : typeof req.params.sessionPlanId === "string"
        ? req.params.sessionPlanId
        : "";
  if (!sessionPlanId) throw new ApiError(400, "sessionPlanId is required");

  const coverage = await getSessionPlanSyllabusCoverage(req, sessionPlanId);
  return sendSuccess(res, "Syllabus coverage fetched", coverage);
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

const findCommentEntity = async (
  req: Request,
  entityType: string,
  entityId: string
) => {
  const schoolId = tenantObjectId(req);
  // Use $ne: true so older docs without isDeleted still match
  const notDeleted = { isDeleted: { $ne: true } as const };
  const id = String(entityId || "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  switch (entityType) {
    case "SYLLABUS":
      return AcademicSyllabus.findOne({ _id: id, schoolId, ...notDeleted });
    case "SESSION_PLAN":
      return AcademicSessionPlan.findOne({ _id: id, schoolId, ...notDeleted });
    case "LESSON_PLAN":
      return AcademicLessonPlan.findOne({ _id: id, schoolId, ...notDeleted });
    case "LOG_BOOK_ENTRY":
      return AcademicLogBookEntry.findOne({ _id: id, schoolId, ...notDeleted });
    default:
      return null;
  }
};

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicCommentSchema.parse(req.body);

  const entity = await findCommentEntity(req, payload.entityType, payload.entityId);
  if (!entity) throw new ApiError(404, "Entity not found for comment");

  // Access: syllabus is subject-scoped; other entities use teacher ownership
  if (payload.entityType === "SYLLABUS") {
    const syllabus = entity as { teacherId?: { toString(): string }; subjectId: { toString(): string } };
    await assertSyllabusAccess(req, {
      teacherId: syllabus.teacherId?.toString(),
      subjectId: syllabus.subjectId.toString()
    });
  } else if ("teacherId" in entity && entity.teacherId) {
    await assertTeacherOwnership(req, entity.teacherId.toString());
  }

  const comment = await addAcademicComment(req, payload.entityType, payload.entityId, payload.comment);

  if (
    "teacherId" in entity &&
    entity.teacherId &&
    isAcademicAdmin(req.user?.role ?? "")
  ) {
    await notifyTeacher(
      req,
      entity.teacherId.toString(),
      "Admin Comment Added",
      payload.comment,
      { entityId: payload.entityId }
    );
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
  // Support string or single-element array (proxies sometimes duplicate query keys)
  const rawType = req.query.entityType;
  const rawId = req.query.entityId;
  const entityType = Array.isArray(rawType) ? String(rawType[0] ?? "") : String(rawType ?? "");
  const entityId = Array.isArray(rawId) ? String(rawId[0] ?? "") : String(rawId ?? "");
  if (!entityType.trim() || !entityId.trim()) {
    throw new ApiError(400, "entityType and entityId are required");
  }

  const entity = await findCommentEntity(req, entityType, entityId);

  // Soft-fail list: panel should not hard-break if entity lookup fails.
  // Still enforce access when the entity is found.
  if (entity) {
    if (entityType === "SYLLABUS") {
      const syllabus = entity as {
        teacherId?: { toString(): string } | null;
        subjectId: { toString(): string };
      };
      const subjectId =
        typeof syllabus.subjectId === "object" && syllabus.subjectId
          ? syllabus.subjectId.toString()
          : String(syllabus.subjectId ?? "");
      if (subjectId) {
        await assertSyllabusAccess(req, {
          teacherId: syllabus.teacherId?.toString?.() ?? undefined,
          subjectId
        });
      }
    } else if ("teacherId" in entity && entity.teacherId) {
      await assertTeacherOwnership(req, entity.teacherId.toString());
    }
  } else if (!isAcademicAdmin(req.user?.role ?? "")) {
    // Non-admins cannot list comments for unknown entities
    throw new ApiError(404, "Entity not found");
  }

  const comments = await AcademicComment.find({
    schoolId: tenantObjectId(req),
    entityType,
    entityId
  })
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(
    res,
    "Comments fetched",
    comments.map((c) => ({
      ...c,
      _id: c._id.toString(),
      schoolId: c.schoolId?.toString?.() ?? c.schoolId,
      entityId: c.entityId?.toString?.() ?? c.entityId,
      authorUserId: c.authorUserId?.toString?.() ?? c.authorUserId
    }))
  );
});