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
  deleteSyllabusHierarchy,
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
  assertNoDuplicateLessonPlanUnitsInMonth,
  assertNoDuplicateLogBookForItemDate,
  assertSyllabusAccess,
  assertTeacherOwnership,
  buildAcademicFilter,
  buildDashboard,
  getAttendanceForSession,
  getNepaliMonthNameFromBsDate,
  getOrCreateLogBook,
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

export const getAcademicDashboard = asyncHandler(async (req: Request, res: Response) => {
  const dashboard = await buildDashboard(req, parseFilters(req));
  return sendSuccess(res, "Academic management dashboard fetched", dashboard);
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
    // Drop blank unit rows; accept alternate title field names from clients
    const fromHierarchy = payload.chapters
      .map((chapter, cIndex) => {
        const rawUnits = (chapter.units ?? []) as Array<Record<string, unknown>>;
        const units = rawUnits
          .map((u) => {
            const title = unitTitleOf(u);
            if (!title) return null;
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
          })
          .filter((u): u is NonNullable<typeof u> => Boolean(u));

        // If client sent a chapter/part heading but forgot nested units, promote heading → unit
        if (
          units.length === 0 &&
          (chapter.title ?? "").trim() &&
          (chapter.sectionKind === "CHAPTER" ||
            chapter.sectionKind === "PART" ||
            (chapter.title ?? "").trim().length > 0)
        ) {
          units.push({
            unitNo: 0,
            title: (chapter.title ?? "").trim(),
            description: chapter.description || "",
            teachingHours: chapter.estimatedHours ?? 0,
            learningObjective: "",
            references: chapter.references || "",
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
      })
      .filter((chapter) => (chapter.units ?? []).length > 0);

    // Continuous unit numbering across chapters: Ch1 units 1–5, Ch2 units 6–10, …
    if (fromHierarchy.length > 0) {
      let unitSeq = 0;
      return fromHierarchy.map((chapter, cIndex) => ({
        ...chapter,
        chapterNo: chapter.chapterNo || cIndex + 1,
        units: (chapter.units ?? []).map((unit) => {
          unitSeq += 1;
          return { ...unit, unitNo: unitSeq };
        })
      }));
    }
    // Fall through: chapters present but empty (e.g. units only in legacy field)
  }
  if (payload.units && payload.units.length > 0) {
    return legacyUnitsToChapters(payload.units);
  }
  return [];
};

const SYLLABUS_STRUCTURE_REQUIRED_MSG =
  "At least one unit with a title is required. Open each Unit row and enter Unit title (Chapter/Part heading alone is not enough).";

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
  const chapters = resolveSyllabusChapters(payload);
  if (chapters.length === 0) {
    throw new ApiError(400, SYLLABUS_STRUCTURE_REQUIRED_MSG);
  }

  // Avoid empty strings for ObjectId fields
  const yearId = payload.yearId?.trim() || undefined;
  const batchId = payload.batchId?.trim() || undefined;
  const classId = payload.classId?.trim() || undefined;
  const sectionId = payload.sectionId?.trim() || undefined;

  /**
   * Resume flow: one syllabus per subject+year (or class). If a DRAFT/REJECTED
   * already exists, update its hierarchy instead of failing with duplicate key.
   * This lets teachers save Unit 1–2, then continue with Unit 3 later.
   */
  const existingDraftFilter: Record<string, unknown> = {
    schoolId: tenantObjectId(req),
    subjectId: payload.subjectId,
    academicYearBs: payload.academicYearBs,
    isDeleted: false,
    status: { $in: ["DRAFT", "REJECTED"] }
  };
  if (yearId) existingDraftFilter.yearId = yearId;
  if (classId) existingDraftFilter.classId = classId;

  const existingDraft = await AcademicSyllabus.findOne(existingDraftFilter);
  if (existingDraft) {
    await assertSyllabusAccess(req, {
      teacherId: existingDraft.teacherId?.toString(),
      subjectId: existingDraft.subjectId.toString()
    });

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
      existingDraft.hierarchyMigratedAt = new Date();
      existingDraft.audit = {
        ...existingDraft.audit,
        updatedBy: actorObjectId(req)
      };
      await existingDraft.save(sessionOpt);

      await saveSyllabusHierarchy(
        {
          schoolId: tenantObjectId(req).toString(),
          syllabusId: existingDraft._id.toString(),
          chapters
        },
        session ?? undefined
      );

      await recordAudit(req, {
        action: "academic.syllabus.resumeDraft",
        entity: "SYLLABUS",
        entityId: existingDraft._id.toString(),
        after: existingDraft
      });
    });

    const serialized = await serializeSyllabus(existingDraft._id.toString());
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
  const payload = academicSyllabusUpdateSchema.parse(req.body);
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

  // Empty array is truthy in JS — only non-empty structure rewrites hierarchy
  const structureChanging =
    (Array.isArray(payload.chapters) && payload.chapters.length > 0) ||
    (Array.isArray(payload.units) && payload.units.length > 0);

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);
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
    await existing.save(sessionOpt);

    if (structureChanging) {
      const chapters = resolveSyllabusChapters({
        chapters: payload.chapters,
        units: payload.units
      });
      if (chapters.length === 0) {
        throw new ApiError(400, SYLLABUS_STRUCTURE_REQUIRED_MSG);
      }
      await saveSyllabusHierarchy(
        {
          schoolId: tenantObjectId(req).toString(),
          syllabusId: existing._id.toString(),
          chapters
        },
        session ?? undefined
      );
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

  // Keep legacy flat unit status roughly in sync
  const chapterSubs = await AcademicSyllabusSubUnit.find({ chapterId: subUnit.chapterId }).lean();
  const allDone = chapterSubs.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
  const anyProgress = chapterSubs.some(
    (s) => s.status === "IN_PROGRESS" || s.status === "COMPLETED" || s.status === "SKIPPED"
  );
  const chapter = await AcademicSyllabusChapter.findById(subUnit.chapterId).lean();
  if (chapter) {
    const legacyStatus = allDone ? "COMPLETED" : anyProgress ? "IN_PROGRESS" : "PENDING";
    await AcademicSyllabusUnit.updateOne(
      { syllabusId: existing._id, unitNo: chapter.chapterNo },
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
  await assertNoDuplicateLessonPlanUnitsInMonth(req, {
    sessionPlanId: payload.sessionPlanId,
    teacherId: payload.teacherId,
    subjectId: payload.subjectId,
    month: derivedMonth,
    academicYearBs: payload.academicYearBs,
    unitIds: payload.items.map((item) => item.sessionPlanUnitId)
  });

  const result = await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    const plan = await AcademicLessonPlan.create(
      [
        {
          ...payload,
          teachingDateBs,
          startDateBs: teachingDateBs,
          endDateBs: teachingDateBs,
          month: derivedMonth,
          schoolId: tenantObjectId(req),
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
    const unitIds = payload.items.map((item) => item.sessionPlanUnitId);
    const unitsQuery = AcademicSessionPlanUnit.find({
      _id: { $in: unitIds },
      sessionPlanId: payload.sessionPlanId
    });
    if (session) unitsQuery.session(session);
    const units = await unitsQuery.lean();
    const unitMap = new Map(units.map((unit) => [unit._id.toString(), unit]));

    await AcademicLessonPlanItem.insertMany(
      payload.items.map((item) => {
        const unit = unitMap.get(item.sessionPlanUnitId);
        const unitAny = unit as
          | {
              syllabusId?: { toString(): string };
              syllabusChapterId?: { toString(): string };
              learningOutcomes?: string;
              estimatedTeachingHours?: number;
              topicsCovered?: string;
              chapterName?: string;
              unitNo?: number;
            }
          | undefined;
        return {
          ...item,
          subjectLabel: item.subjectLabel || (unit ? `Unit ${unit.unitNo}` : ""),
          plannedTopic:
            item.plannedTopic ||
            (unit ? unit.topicsCovered || unit.chapterName : item.plannedTopic),
          learningObjectives: item.learningObjectives || unit?.learningOutcomes || "",
          estimatedClasses:
            item.estimatedClasses ||
            Math.max(1, Math.round(unit?.estimatedTeachingHours || 1)),
          // Inherit syllabus unit link from session unit when client omits hierarchy ids
          syllabusId:
            item.syllabusId?.trim() || unitAny?.syllabusId?.toString?.() || undefined,
          syllabusChapterId:
            item.syllabusChapterId?.trim() ||
            unitAny?.syllabusChapterId?.toString?.() ||
            undefined,
          syllabusUnitId:
            item.syllabusUnitId?.trim() ||
            (unitAny as { syllabusUnitId?: { toString(): string } })?.syllabusUnitId?.toString?.() ||
            undefined,
          syllabusSubUnitId: item.syllabusSubUnitId?.trim() || undefined,
          schoolId: tenantObjectId(req),
          lessonPlanId: createdPlan._id
        };
      }),
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
  const payload = academicLessonPlanSchema.partial().parse(req.body);
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
    await assertLessonPlanItemsBelongToSessionPlan(req, sessionPlanId, payload.items);
    await assertNoDuplicateLessonPlanUnitsInMonth(req, {
      sessionPlanId,
      teacherId,
      subjectId,
      month,
      academicYearBs,
      unitIds: payload.items.map((item) => item.sessionPlanUnitId),
      excludeLessonPlanId: existing._id.toString()
    });
  }

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);

  await withTransaction(async (session) => {
    const sessionOpt = getSessionOption(session);
    Object.assign(existing, safePayload, {
      sessionPlanId,
      month,
      teachingDateBs,
      startDateBs: teachingDateBs,
      endDateBs: teachingDateBs,
      audit: { ...existing.audit, updatedBy: actorObjectId(req) }
    });
    await existing.save(sessionOpt);

    if (payload.items) {
      const itemsQuery = AcademicLessonPlanItem.find({ lessonPlanId: existing._id });
      if (session) itemsQuery.session(session);
      const existingItems = await itemsQuery;
      const bySerial = new Map(existingItems.map((item) => [item.serialNo, item]));
      const keptSerials = new Set<number>();

      for (const item of payload.items) {
        keptSerials.add(item.serialNo);
        const prev = bySerial.get(item.serialNo);
        if (prev) {
          // Preserve progress fields — never allow manual COMPLETED without Log Book
          const completedClasses = prev.completedClasses;
          const completionStatus = prev.completionStatus;
          Object.assign(prev, item, {
            schoolId: tenantObjectId(req),
            lessonPlanId: existing._id,
            completedClasses,
            completionStatus
          });
          await prev.save(sessionOpt);
        } else {
          await AcademicLessonPlanItem.create(
            [{ ...item, schoolId: tenantObjectId(req), lessonPlanId: existing._id }],
            sessionOpt
          );
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
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
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

  // Prefer Session Plan unit; optionally link a Lesson Plan topic
  const unitDoc = await AcademicSessionPlanUnit.findById(payload.sessionPlanUnitId).lean();
  if (!unitDoc || unitDoc.schoolId.toString() !== tenantObjectId(req).toString()) {
    throw new ApiError(400, "Select a valid unit from the Session Plan.");
  }

  let unitLabel = payload.unit || `Unit ${unitDoc.unitNo}: ${unitDoc.chapterName}`;
  let lessonPlanId: string | undefined = payload.lessonPlanId || undefined;
  let lessonPlanItemId: string | undefined =
    payload.lessonPlanItemId && payload.lessonPlanItemId.length > 0
      ? payload.lessonPlanItemId
      : undefined;

  if (lessonPlanItemId) {
    const item = await AcademicLessonPlanItem.findById(lessonPlanItemId).lean();
    if (!item || item.schoolId.toString() !== tenantObjectId(req).toString()) {
      throw new ApiError(400, "Invalid lesson plan topic selected.");
    }
    const plan = await AcademicLessonPlan.findOne({
      _id: item.lessonPlanId,
      schoolId: tenantObjectId(req),
      isDeleted: false
    }).lean();
    if (!plan) throw new ApiError(400, "Lesson plan for this topic was not found");
    if (plan.teacherId.toString() !== payload.teacherId) {
      throw new ApiError(400, "Lesson plan topic does not belong to the selected teacher");
    }
    if (plan.subjectId.toString() !== payload.subjectId) {
      throw new ApiError(400, "Lesson plan topic subject does not match this log entry");
    }
    lessonPlanId = plan._id.toString();
    unitLabel = unitLabel || item.subjectLabel || unitLabel;
    payload.topicCovered = payload.topicCovered || item.plannedTopic;
    payload.objectives = payload.objectives || item.learningObjectives || "";
    // Inherit hierarchical syllabus links from the Lesson Plan item
    const itemAny = item as {
      syllabusId?: { toString(): string };
      syllabusChapterId?: { toString(): string };
      syllabusUnitId?: { toString(): string };
      syllabusSubUnitId?: { toString(): string };
      subUnitTitle?: string;
    };
    if (!payload.syllabusId && itemAny.syllabusId) payload.syllabusId = itemAny.syllabusId.toString();
    if (!payload.syllabusChapterId && itemAny.syllabusChapterId) {
      payload.syllabusChapterId = itemAny.syllabusChapterId.toString();
    }
    if (!payload.syllabusUnitId && itemAny.syllabusUnitId) {
      payload.syllabusUnitId = itemAny.syllabusUnitId.toString();
    }
    if (!payload.syllabusSubUnitId && itemAny.syllabusSubUnitId) {
      payload.syllabusSubUnitId = itemAny.syllabusSubUnitId.toString();
    }
    if (!payload.subUnitTitle && itemAny.subUnitTitle) payload.subUnitTitle = itemAny.subUnitTitle;
    await assertNoDuplicateLogBookForItemDate(req, lessonPlanItemId, dateBs);
  }

  // Inherit chapter link from Session Plan unit when not set
  const unitAny = unitDoc as {
    syllabusId?: { toString(): string };
    syllabusChapterId?: { toString(): string };
  };
  if (!payload.syllabusId && unitAny.syllabusId) payload.syllabusId = unitAny.syllabusId.toString();
  if (!payload.syllabusChapterId && unitAny.syllabusChapterId) {
    payload.syllabusChapterId = unitAny.syllabusChapterId.toString();
  }

  if (payload.subUnitTitle) {
    payload.topicCovered =
      payload.topicCovered ||
      `${unitDoc.chapterName} — ${payload.subUnitTitle}`;
  } else {
    payload.topicCovered =
      payload.topicCovered || unitDoc.topicsCovered || unitDoc.chapterName;
  }
  payload.unit = unitLabel;
  payload.sessionPlanUnitId = unitDoc._id.toString();
  payload.lessonPlanId = lessonPlanId;
  payload.lessonPlanItemId = lessonPlanItemId ?? "";

  // Use Nepali month name so Log Book groups align with Lesson Plan period
  const month = getNepaliMonthNameFromBsDate(dateBs);
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
    syllabusId: payload.syllabusId?.trim() || undefined,
    syllabusChapterId: payload.syllabusChapterId?.trim() || undefined,
    syllabusUnitId: payload.syllabusUnitId?.trim() || undefined,
    syllabusSubUnitId: payload.syllabusSubUnitId?.trim() || undefined,
    schoolId: tenantObjectId(req),
    logBookId,
    serialNo: count + 1,
    attendancePresent: attendance.present,
    attendanceAbsent: attendance.absent,
    attendancePercent: attendance.percent,
    teacherSignature: await getActorName(req.user!.userId),
    audit: { createdBy: actorObjectId(req) }
  });

  // Auto progress when linked to a Lesson Plan item
  if (entry.lessonPlanItemId) {
    await syncLessonPlanItemProgress(entry.lessonPlanItemId.toString());
  }

  // Mark linked syllabus sub-unit as completed when a class log is recorded
  if (payload.syllabusSubUnitId) {
    try {
      const { AcademicSyllabusSubUnit } = await import("../models/AcademicSyllabusSubUnit.js");
      await AcademicSyllabusSubUnit.updateOne(
        {
          _id: payload.syllabusSubUnitId,
          schoolId: tenantObjectId(req)
        },
        {
          $set: {
            status: "COMPLETED",
            todaysCoverage: payload.topicCovered || ""
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

  const lessonPlanItemId = payload.lessonPlanItemId ?? existing.lessonPlanItemId?.toString();
  if (!lessonPlanItemId) {
    throw new ApiError(400, "Log Book entries must remain linked to a Lesson Plan topic.");
  }

  const dateBs = payload.dateBs ?? existing.dateBs;
  await assertNoDuplicateLogBookForItemDate(req, lessonPlanItemId, dateBs, existing._id.toString());

  // If topic link changed, re-validate and re-populate inherited fields
  if (payload.lessonPlanItemId && payload.lessonPlanItemId !== existing.lessonPlanItemId?.toString()) {
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
    payload.lessonPlanId = plan._id.toString();
    if (item.sessionPlanUnitId) payload.sessionPlanUnitId = item.sessionPlanUnitId.toString();
    if (!payload.topicCovered) payload.topicCovered = item.plannedTopic;
    if (!payload.objectives) payload.objectives = item.learningObjectives || "";
  }

  const safePayload = sanitizeTeacherOwnedUpdate(req, payload as Record<string, unknown>);
  const previousItemId = existing.lessonPlanItemId?.toString();

  Object.assign(existing, safePayload, {
    lessonPlanItemId,
    audit: { ...existing.audit, updatedBy: actorObjectId(req) }
  });
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