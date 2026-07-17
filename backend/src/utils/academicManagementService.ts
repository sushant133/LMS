import type { Request } from "express";
import mongoose from "mongoose";
import {
  canManageInstitution,
  type AcademicManagementDashboard,
  type AcademicManagementFilters,
  type AcademicPlanStatus,
  type LessonPlanItemStatus,
  type SessionPlanSyllabusCoverage,
  type SyllabusUnitPlanningStatus
} from "@phit-erp/shared";
import { AcademicApproval } from "../models/AcademicApproval.js";
import { AcademicComment } from "../models/AcademicComment.js";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import {
  computeHierarchyStats,
  ensureSyllabusHierarchy,
  loadSyllabusHierarchy
} from "./syllabusHierarchyService.js";
import { Attendance } from "../models/Attendance.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";
import { recordAudit } from "./audit.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { compareBsDates, getDayOfWeekFromBs, getOffsetFromBsDate, getTodayBs } from "./nepaliDate.js";
import { sendNotification, getSchoolIdFromRequest } from "./notificationService.js";
import { getTeacherScope, requireTeacherScope } from "./teacherScope.js";
import { tenantObjectId } from "./tenant.js";

/** BS date pattern YYYY-MM-DD (used for lesson plan item deadlines). */
const BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Nepali month names aligned with BS month index 1–12 (Baisakh=1 … Chaitra=12). */
export const NEPALI_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra"
] as const;

export const isBsDateString = (value?: string | null): value is string => Boolean(value && BS_DATE_RE.test(value.trim()));

/**
 * Map a BS date (YYYY-MM-DD) to the Nepali month name used by Lesson Plans / Log Books.
 * Falls back to the raw YYYY-MM fragment only if the month number is out of range.
 */
export const getNepaliMonthNameFromBsDate = (dateBs: string): string => {
  const parts = dateBs.trim().split("-");
  const monthNum = Number(parts[1] ?? 0);
  if (monthNum >= 1 && monthNum <= 12) {
    return NEPALI_MONTH_NAMES[monthNum - 1] ?? parts[1] ?? "";
  }
  return dateBs.slice(0, 7);
};

/**
 * Compute lesson-plan item status from completed classes and optional BS deadline.
 * - COMPLETED when classes done
 * - DELAYED when incomplete and deadline is today or in the past (not on time)
 * - IN_PROGRESS when some classes done (and not yet due)
 * - PENDING otherwise
 */
export const computeItemStatus = (
  estimated: number,
  completed: number,
  deadline?: string,
  todayBs: string = getTodayBs()
): LessonPlanItemStatus => {
  if (estimated > 0 && completed >= estimated) return "COMPLETED";

  if (isBsDateString(deadline) && compareBsDates(deadline.trim(), todayBs) <= 0 && completed < Math.max(estimated, 1)) {
    return "DELAYED";
  }

  if (completed > 0) return "IN_PROGRESS";
  return "PENDING";
};

export const calcRemainingPercent = (estimated: number, completed: number): number => {
  if (estimated <= 0) return 100;
  const remaining = Math.max(estimated - completed, 0);
  return Math.round((remaining / estimated) * 100);
};

export const calcCompletedPercent = (estimated: number, completed: number): number => {
  if (estimated <= 0) return 0;
  return Math.min(100, Math.round((completed / estimated) * 100));
};

/**
 * Incomplete item with deadline after today and within the next `withinDays` days.
 * Deadline day itself is treated as delayed/overdue (not "approaching").
 */
export const isDeadlineApproaching = (
  deadline: string | undefined,
  estimated: number,
  completed: number,
  withinDays = 3,
  todayBs: string = getTodayBs()
): boolean => {
  if (!isBsDateString(deadline)) return false;
  if (estimated > 0 && completed >= estimated) return false;
  const d = deadline.trim();
  // Future only — today/past are overdue/delayed
  if (compareBsDates(d, todayBs) <= 0) return false;
  const horizon = getOffsetFromBsDate(todayBs, withinDays);
  return compareBsDates(d, horizon) <= 0;
};

/** Incomplete and deadline is today or earlier (aligned with DELAYED status). */
export const isDeadlineOverdue = (
  deadline: string | undefined,
  estimated: number,
  completed: number,
  todayBs: string = getTodayBs()
): boolean => {
  if (!isBsDateString(deadline)) return false;
  if (estimated > 0 && completed >= estimated) return false;
  return compareBsDates(deadline.trim(), todayBs) <= 0;
};

const APPROVED_STATUSES: AcademicPlanStatus[] = ["APPROVED"];
/** Statuses locked for teacher edit until admin unlocks (or rejects). */
const LOCKED_EDIT_STATUSES: AcademicPlanStatus[] = ["APPROVED", "SUBMITTED", "PENDING_APPROVAL"];
const APPROVABLE_STATUSES: AcademicPlanStatus[] = ["SUBMITTED", "PENDING_APPROVAL"];

export const isAcademicAdmin = (role: string): boolean => canManageInstitution(role);

/**
 * Expand a subject instance id to all curriculum siblings in the same school
 * (same masterSubjectId, else same code, else same normalized name).
 * College provisions one Subject doc per batch year — plans may reference any sibling.
 */
export const expandCurriculumSubjectIds = async (
  schoolId: mongoose.Types.ObjectId,
  subjectId: string
): Promise<string[]> => {
  if (!mongoose.Types.ObjectId.isValid(subjectId)) return [subjectId];
  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId
  })
    .select("_id name code masterSubjectId")
    .lean();
  if (!subject) return [subjectId];

  const or: Record<string, unknown>[] = [];
  if (subject.masterSubjectId) {
    or.push({ masterSubjectId: subject.masterSubjectId });
  }
  const code = (subject.code ?? "").trim();
  if (code) {
    or.push({ code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  }
  const name = (subject.name ?? "").trim();
  if (name && !code && !subject.masterSubjectId) {
    or.push({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  }

  if (or.length === 0) return [subjectId];

  const siblings = await Subject.find({
    schoolId,
    $or: or
  })
    .select("_id")
    .lean();

  const ids = siblings.map((s) => s._id.toString());
  if (!ids.includes(subjectId)) ids.push(subjectId);
  return ids;
};

export const buildAcademicFilter = (req: Request, query: AcademicManagementFilters): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    schoolId: tenantObjectId(req),
    isDeleted: false
  };

  if (query.academicYearBs) filter.academicYearBs = query.academicYearBs;
  if (query.session) filter.session = query.session;
  if (query.faculty) filter.faculty = query.faculty;
  if (query.semesterBs) filter.semesterBs = query.semesterBs;
  // subjectId applied async via applyCurriculumSubjectFilter (siblings share curriculum)
  if (query.teacherId) filter.teacherId = query.teacherId;
  if (query.month) filter.month = query.month;
  if (query.classId) filter.classId = query.classId;
  if (query.sectionId) filter.sectionId = query.sectionId;
  if (query.batchId) filter.batchId = query.batchId;
  if (query.yearId) filter.yearId = query.yearId;
  if (query.status) filter.status = query.status;

  return filter;
};

/** Attach curriculum-expanded subjectId ($in) when a subject filter is present. */
export const applyCurriculumSubjectFilter = async (
  req: Request,
  filter: Record<string, unknown>,
  subjectId?: string
): Promise<void> => {
  if (!subjectId) return;
  const schoolId = tenantObjectId(req);
  const ids = await expandCurriculumSubjectIds(schoolId, subjectId);
  filter.subjectId = ids.length === 1 ? ids[0] : { $in: ids };
};

export const applyTeacherScopeToFilter = async (req: Request, filter: Record<string, unknown>): Promise<void> => {
  const scope = await getTeacherScope(req);
  if (scope) {
    filter.teacherId = scope.teacherId;
  }
};

/**
 * Syllabus is subject-level: teachers see records for their assigned subjects
 * (not only rows that name them as teacherId).
 * When a subject filter is already present (possibly curriculum-expanded),
 * intersect with teacher assignments so filters still apply.
 */
export const applyTeacherSubjectScopeToFilter = async (
  req: Request,
  filter: Record<string, unknown>
): Promise<void> => {
  const scope = await getTeacherScope(req);
  if (!scope) return;
  const allowed = new Set(scope.subjectIds.map(String));
  const existing = filter.subjectId;
  if (existing == null) {
    filter.subjectId = { $in: scope.subjectIds };
    return;
  }
  const existingIds: string[] =
    typeof existing === "string"
      ? [existing]
      : existing &&
          typeof existing === "object" &&
          Array.isArray((existing as { $in?: unknown[] }).$in)
        ? (existing as { $in: unknown[] }).$in.map(String)
        : [];
  // Prefer intersection of curriculum-expanded filter with teacher subjects.
  // If none match (sibling id only in filter, assigned sibling not expanded yet),
  // expand filter ids once more against assignments.
  let intersected = existingIds.filter((id) => allowed.has(id));
  if (intersected.length === 0 && existingIds.length > 0) {
    const schoolId = tenantObjectId(req);
    const expanded = new Set<string>();
    for (const id of existingIds) {
      for (const sib of await expandCurriculumSubjectIds(schoolId, id)) {
        if (allowed.has(sib)) expanded.add(sib);
      }
    }
    intersected = [...expanded];
  }
  filter.subjectId =
    intersected.length === 0
      ? { $in: [] }
      : intersected.length === 1
        ? intersected[0]
        : { $in: intersected };
};

export const assertTeacherOwnership = async (req: Request, teacherId: string): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (isAcademicAdmin(req.user.role)) return;

  const scope = await requireTeacherScope(req);
  if (scope.teacherId !== teacherId) {
    throw new ApiError(403, "You can only access your own academic records");
  }
};

/** Teachers may access a syllabus if they teach the subject (or are the named teacher). */
export const assertSyllabusAccess = async (
  req: Request,
  params: { teacherId?: string | null; subjectId: string }
): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (isAcademicAdmin(req.user.role)) return;

  const scope = await requireTeacherScope(req);
  if (params.teacherId && params.teacherId === scope.teacherId) return;
  if (scope.subjectIds.includes(params.subjectId)) return;
  throw new ApiError(403, "You can only access syllabi for subjects assigned to you");
};

export const assertEditableStatus = (status: AcademicPlanStatus): void => {
  if (LOCKED_EDIT_STATUSES.includes(status)) {
    throw new ApiError(
      403,
      status === "APPROVED"
        ? "Approved records cannot be modified. Contact an administrator to unlock."
        : "Submitted plans cannot be modified until an administrator unlocks or rejects them."
    );
  }
};

export const assertApprovableStatus = (status: AcademicPlanStatus): void => {
  if (!APPROVABLE_STATUSES.includes(status)) {
    throw new ApiError(400, "Only submitted plans can be approved or rejected.");
  }
};

/** Strip ownership fields teachers must not reassign on update. */
export const sanitizeTeacherOwnedUpdate = <T extends Record<string, unknown>>(
  req: Request,
  payload: T
): T => {
  if (isAcademicAdmin(req.user?.role ?? "")) return payload;
  const next = { ...payload };
  delete next.teacherId;
  return next;
};

export const recordApproval = async (
  req: Request,
  entityType: "SYLLABUS" | "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY",
  entityId: string,
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "UNLOCKED",
  remarks?: string
): Promise<void> => {
  if (!req.user) return;

  await AcademicApproval.create({
    schoolId: tenantObjectId(req),
    entityType,
    entityId,
    action,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    remarks
  });
};

export const notifyTeacher = async (
  req: Request,
  teacherId: string,
  title: string,
  message: string,
  metadata?: Record<string, string>
): Promise<void> => {
  const teacher = await Teacher.findById(teacherId).select("user").lean();
  if (!teacher?.user) return;

  await sendNotification({
    schoolId: getSchoolIdFromRequest(req),
    recipientUserId: teacher.user.toString(),
    title,
    message,
    type: "ACADEMIC_MANAGEMENT",
    metadata
  });
};

export const notifyAdmins = async (req: Request, title: string, message: string, metadata?: Record<string, string>): Promise<void> => {
  const admins = await User.find({
    schoolId: tenantObjectId(req),
    role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] }
  })
    .select("_id")
    .lean();

  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId: getSchoolIdFromRequest(req),
        recipientUserId: admin._id.toString(),
        title,
        message,
        type: "ACADEMIC_MANAGEMENT",
        metadata
      })
    )
  );
};

/** Session Plan statuses that may feed Lesson Plans for the owning teacher. */
const SESSION_PLAN_USABLE_FOR_LESSON: AcademicPlanStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED"
];

/**
 * Resolve and validate a Session Plan for Lesson Plan creation.
 * Teachers may use their own non-rejected plans (including DRAFT) so they can
 * complete yearly Session Plans and monthly Lesson Plans without waiting for admin approval.
 * REJECTED plans cannot be used. Subject/teacher/year must still match.
 */
export const assertApprovedSessionPlanForLesson = async (
  req: Request,
  sessionPlanId: string,
  payload: { subjectId: string; teacherId: string; academicYearBs?: string }
): Promise<{ _id: mongoose.Types.ObjectId; status: AcademicPlanStatus }> => {
  const plan = await AcademicSessionPlan.findOne({
    _id: sessionPlanId,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();

  if (!plan) {
    throw new ApiError(400, "Session Plan not found. Create a yearly Session Plan first.");
  }
  if (!SESSION_PLAN_USABLE_FOR_LESSON.includes(plan.status as AcademicPlanStatus)) {
    throw new ApiError(
      400,
      `Cannot create a Lesson Plan from a Session Plan with status ${plan.status}. Use a draft, submitted, or approved Session Plan (not rejected).`
    );
  }
  // Curriculum subjects are provisioned per batch — allow sibling subject ids
  const schoolId = tenantObjectId(req);
  const lessonSubjectIds = await expandCurriculumSubjectIds(schoolId, payload.subjectId);
  const planSubjectId = plan.subjectId.toString();
  if (!lessonSubjectIds.includes(planSubjectId)) {
    // Also expand from the plan side in case naming differs
    const planSubjectIds = await expandCurriculumSubjectIds(schoolId, planSubjectId);
    if (!planSubjectIds.includes(payload.subjectId)) {
      throw new ApiError(400, "Session Plan subject does not match the Lesson Plan subject.");
    }
  }
  if (plan.teacherId.toString() !== payload.teacherId) {
    throw new ApiError(400, "Session Plan teacher does not match the Lesson Plan teacher.");
  }
  if (payload.academicYearBs && plan.academicYearBs !== payload.academicYearBs) {
    throw new ApiError(400, "Session Plan academic year does not match the Lesson Plan academic year.");
  }

  return { _id: plan._id, status: plan.status as AcademicPlanStatus };
};

/**
 * Ensure every lesson-plan item maps to a real unit on the given Session Plan,
 * and reject free-typed units that do not exist in the yearly syllabus.
 */
export const assertLessonPlanItemsBelongToSessionPlan = async (
  req: Request,
  sessionPlanId: string,
  items: Array<{ sessionPlanUnitId: string; plannedTopic: string; serialNo: number }>
): Promise<void> => {
  const unitIds = items.map((item) => item.sessionPlanUnitId).filter(Boolean);
  if (unitIds.length !== items.length) {
    throw new ApiError(400, "Every Lesson Plan topic must be selected from the Session Plan units.");
  }

  const uniqueIds = [...new Set(unitIds)];
  const units = await AcademicSessionPlanUnit.find({
    _id: { $in: uniqueIds },
    schoolId: tenantObjectId(req),
    sessionPlanId
  })
    .select("_id unitNo chapterName")
    .lean();

  if (units.length !== uniqueIds.length) {
    throw new ApiError(400, "One or more selected units do not belong to the Session Plan.");
  }
};

/**
 * Prevent the same Session Plan unit from appearing twice in the same month
 * for the same teacher/subject (within this plan or another plan for that month).
 */
export const assertNoDuplicateLessonPlanUnitsInMonth = async (
  req: Request,
  params: {
    sessionPlanId: string;
    teacherId: string;
    subjectId: string;
    month: string;
    academicYearBs: string;
    unitIds: string[];
    excludeLessonPlanId?: string;
  }
): Promise<void> => {
  const seen = new Set<string>();
  for (const unitId of params.unitIds) {
    if (seen.has(unitId)) {
      throw new ApiError(400, "Duplicate unit selected in this Lesson Plan. Each unit can only appear once per month.");
    }
    seen.add(unitId);
  }

  const otherPlans = await AcademicLessonPlan.find({
    schoolId: tenantObjectId(req),
    sessionPlanId: params.sessionPlanId,
    teacherId: params.teacherId,
    subjectId: params.subjectId,
    month: params.month,
    academicYearBs: params.academicYearBs,
    isDeleted: false,
    ...(params.excludeLessonPlanId ? { _id: { $ne: params.excludeLessonPlanId } } : {})
  })
    .select("_id")
    .lean();

  if (otherPlans.length === 0) return;

  const existingItems = await AcademicLessonPlanItem.find({
    lessonPlanId: { $in: otherPlans.map((plan) => plan._id) },
    sessionPlanUnitId: { $in: params.unitIds }
  })
    .select("sessionPlanUnitId plannedTopic")
    .lean();

  if (existingItems.length > 0) {
    const first = existingItems[0];
    throw new ApiError(
      400,
      `Unit/topic "${first?.plannedTopic ?? "selected"}" is already planned for ${params.month}. Duplicate Lesson Plan entries for the same unit in the same month are not allowed.`
    );
  }
};

/**
 * Prevent two Log Book entries for the same Lesson Plan topic on the same BS date.
 */
export const assertNoDuplicateLogBookForItemDate = async (
  req: Request,
  lessonPlanItemId: string,
  dateBs: string,
  excludeEntryId?: string
): Promise<void> => {
  const existing = await AcademicLogBookEntry.findOne({
    schoolId: tenantObjectId(req),
    lessonPlanItemId,
    dateBs,
    isDeleted: false,
    ...(excludeEntryId ? { _id: { $ne: excludeEntryId } } : {})
  })
    .select("_id")
    .lean();

  if (existing) {
    throw new ApiError(400, "A Log Book entry already exists for this Lesson Plan topic on the selected date.");
  }
};

/**
 * Build hierarchical syllabus coverage for a Session Plan:
 * planned (in any Lesson Plan), remaining (not yet planned), completed (via Log Book progress).
 */
export const getSessionPlanSyllabusCoverage = async (
  req: Request,
  sessionPlanId: string
): Promise<SessionPlanSyllabusCoverage> => {
  const plan = await AcademicSessionPlan.findOne({
    _id: sessionPlanId,
    schoolId: tenantObjectId(req),
    isDeleted: false
  }).lean();

  if (!plan) throw new ApiError(404, "Session plan not found");
  await assertTeacherOwnership(req, plan.teacherId.toString());

  const units = await AcademicSessionPlanUnit.find({ sessionPlanId: plan._id }).sort({ unitNo: 1 }).lean();
  const lessonPlans = await AcademicLessonPlan.find({
    schoolId: tenantObjectId(req),
    sessionPlanId: plan._id,
    isDeleted: false
  })
    .select("_id month")
    .lean();

  const planMonthMap = new Map(lessonPlans.map((lp) => [lp._id.toString(), lp.month]));
  const lessonPlanIds = lessonPlans.map((lp) => lp._id);

  const items =
    lessonPlanIds.length > 0
      ? await AcademicLessonPlanItem.find({ lessonPlanId: { $in: lessonPlanIds } }).lean()
      : [];

  const itemsByUnit = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.sessionPlanUnitId) continue;
    const key = item.sessionPlanUnitId.toString();
    const list = itemsByUnit.get(key) ?? [];
    list.push(item);
    itemsByUnit.set(key, list);
  }

  const enriched = units.map((unit) => {
    const unitItems = itemsByUnit.get(unit._id.toString()) ?? [];
    const plannedInMonths = [
      ...new Set(
        unitItems
          .map((item) => planMonthMap.get(item.lessonPlanId.toString()))
          .filter((month): month is string => Boolean(month))
      )
    ];
    const estimatedClasses = unitItems.reduce((sum, item) => sum + (item.estimatedClasses || 0), 0);
    const completedClasses = unitItems.reduce((sum, item) => sum + (item.completedClasses || 0), 0);

    let planningStatus: SyllabusUnitPlanningStatus = "UNPLANNED";
    if (unit.status === "COMPLETED") planningStatus = "COMPLETED";
    else if (unit.status === "DELAYED") planningStatus = "DELAYED";
    else if (unit.status === "IN_PROGRESS" || completedClasses > 0) planningStatus = "IN_PROGRESS";
    else if (unitItems.length > 0) planningStatus = "PLANNED";

    return {
      _id: unit._id.toString(),
      sessionPlanId: unit.sessionPlanId.toString(),
      unitNo: unit.unitNo,
      chapterName: unit.chapterName,
      estimatedTeachingHours: unit.estimatedTeachingHours,
      learningOutcomes: unit.learningOutcomes,
      topicsCovered: unit.topicsCovered,
      references: unit.references,
      practicalRequired: unit.practicalRequired,
      internalAssessment: unit.internalAssessment,
      tentativeCompletionMonth: unit.tentativeCompletionMonth,
      status: unit.status as LessonPlanItemStatus,
      attachmentUrl: unit.attachmentUrl ?? undefined,
      plannedInMonths,
      planningStatus,
      lessonPlanItemCount: unitItems.length,
      completedClasses,
      estimatedClasses
    };
  });

  const planned = enriched.filter((u) => u.planningStatus !== "UNPLANNED");
  const remaining = enriched.filter((u) => u.planningStatus === "UNPLANNED");
  const completed = enriched.filter((u) => u.planningStatus === "COMPLETED");
  const inProgress = enriched.filter((u) => u.planningStatus === "IN_PROGRESS" || u.planningStatus === "PLANNED");
  const delayed = enriched.filter((u) => u.planningStatus === "DELAYED");
  const total = enriched.length;
  const completedCount = completed.length;
  const completedPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return {
    sessionPlanId: plan._id.toString(),
    subjectId: plan.subjectId.toString(),
    teacherId: plan.teacherId.toString(),
    academicYearBs: plan.academicYearBs,
    status: plan.status,
    totalUnits: total,
    plannedUnits: planned.length,
    remainingUnits: remaining.length,
    completedUnits: completedCount,
    inProgressUnits: inProgress.length,
    delayedUnits: delayed.length,
    completedPercent,
    remainingPercent: 100 - completedPercent,
    units: enriched,
    planned: planned.map(({ lessonPlanItemCount: _c, completedClasses: _cc, estimatedClasses: _ec, ...unit }) => unit),
    remaining: remaining.map(({ lessonPlanItemCount: _c, completedClasses: _cc, estimatedClasses: _ec, ...unit }) => unit),
    completed: completed.map(({ lessonPlanItemCount: _c, completedClasses: _cc, estimatedClasses: _ec, ...unit }) => unit)
  };
};

export const syncLessonPlanItemProgress = async (lessonPlanItemId: string): Promise<void> => {
  const item = await AcademicLessonPlanItem.findById(lessonPlanItemId);
  if (!item) return;

  // Count submitted teaching logs (pending admin review still means class was taught)
  const completed = await AcademicLogBookEntry.countDocuments({
    lessonPlanItemId: item._id,
    isDeleted: false,
    reviewStatus: { $ne: "NEEDS_IMPROVEMENT" }
  });

  item.completedClasses = completed;
  item.completionStatus = computeItemStatus(item.estimatedClasses, completed, item.deadline);
  await item.save();

  const lessonPlan = await AcademicLessonPlan.findById(item.lessonPlanId);
  if (lessonPlan?.sessionPlanId && item.sessionPlanUnitId) {
    await syncSessionPlanUnitFromLessonItem(item.sessionPlanUnitId.toString());
    await syncSessionPlanProgress(lessonPlan.sessionPlanId.toString());
  }
};

const syncSessionPlanUnitFromLessonItem = async (unitId: string): Promise<void> => {
  const unit = await AcademicSessionPlanUnit.findById(unitId);
  if (!unit) return;

  const items = await AcademicLessonPlanItem.find({ sessionPlanUnitId: unitId });
  if (items.length === 0) return;

  const allCompleted = items.every((item) => item.completionStatus === "COMPLETED");
  const anyStarted = items.some((item) => item.completedClasses > 0);
  const anyDelayed = items.some((item) => item.completionStatus === "DELAYED");

  unit.status = allCompleted ? "COMPLETED" : anyDelayed ? "DELAYED" : anyStarted ? "IN_PROGRESS" : "PENDING";
  await unit.save();
};

export const syncSessionPlanProgress = async (sessionPlanId: string): Promise<void> => {
  const units = await AcademicSessionPlanUnit.find({ sessionPlanId });
  const total = units.length;
  const completed = units.filter((unit) => unit.status === "COMPLETED").length;
  const delayed = units.filter((unit) => unit.status === "DELAYED").length;
  const completedPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const plan = await AcademicSessionPlan.findById(sessionPlanId);
  if (!plan) return;

  await AcademicProgress.findOneAndUpdate(
    { sessionPlanId },
    {
      schoolId: plan.schoolId,
      sessionPlanId: plan._id,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId,
      academicYearBs: plan.academicYearBs,
      completedPercent,
      remainingPercent: 100 - completedPercent,
      completedUnits: completed,
      remainingUnits: total - completed,
      delayedUnits: delayed
    },
    { upsert: true, new: true }
  );
};

export const getOrCreateLogBook = async (
  req: Request,
  payload: {
    academicYearBs: string;
    session: string;
    faculty?: string;
    semesterBs?: string;
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    subjectId: string;
    teacherId: string;
    month: string;
  }
): Promise<mongoose.Types.ObjectId> => {
  const existing = await AcademicLogBook.findOne({
    schoolId: tenantObjectId(req),
    ...payload,
    isDeleted: false
  }).lean();

  if (existing) return existing._id;

  const created = await AcademicLogBook.create({
    schoolId: tenantObjectId(req),
    ...payload
  });
  return created._id;
};

export const getAttendanceForSession = async (
  req: Request,
  payload: {
    subjectId: string;
    teacherId: string;
    dateBs: string;
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
) => {
  const filter: Record<string, unknown> = {
    schoolId: tenantObjectId(req),
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    dateBs: payload.dateBs
  };

  if (payload.classId) filter.classId = payload.classId;
  if (payload.sectionId) filter.sectionId = payload.sectionId;
  if (payload.batchId) filter.batchId = payload.batchId;
  if (payload.yearId) filter.yearId = payload.yearId;

  const attendance = await Attendance.findOne(filter).lean();
  if (!attendance) {
    return { present: 0, absent: 0, percent: 0, marked: false };
  }

  const present = attendance.entries.filter((entry) => entry.status === "PRESENT" || entry.status === "LATE").length;
  const absent = attendance.entries.filter((entry) => entry.status === "ABSENT").length;
  const total = present + absent;
  const percent = total > 0 ? Math.round((present / total) * 100) : 0;

  return { present, absent, percent, marked: true };
};

export const getTodayTimetable = async (req: Request, dateBs: string) => {
  const scope = await requireTeacherScope(req);
  const dayOfWeek = getDayOfWeekFromBs(dateBs || getTodayBs());

  const slots = await TimetableSlot.find({
    schoolId: tenantObjectId(req),
    teacherId: scope.teacherId,
    dayOfWeek
  })
    .populate("subjectId", "name code")
    .sort({ periodNumber: 1 })
    .lean();

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const enriched = await Promise.all(
    slots.map(async (slot) => {
      let className: string | undefined;
      let sectionName: string | undefined;
      let batchName: string | undefined;
      let yearName: string | undefined;

      if (college && slot.batchId && slot.yearId) {
        const [batch, year] = await Promise.all([
          Batch.findById(slot.batchId).select("name").lean(),
          Year.findById(slot.yearId).select("name").lean()
        ]);
        batchName = batch?.name;
        yearName = year?.name;
      } else if (slot.classId && slot.sectionId) {
        const [schoolClass, section] = await Promise.all([
          SchoolClass.findById(slot.classId).select("name").lean(),
          Section.findById(slot.sectionId).select("name").lean()
        ]);
        className = schoolClass?.name;
        sectionName = section?.name;
      }

      const subject = slot.subjectId as unknown as { _id: mongoose.Types.ObjectId; name: string; code: string } | null;

      return {
        _id: slot._id.toString(),
        subjectId: subject?._id?.toString() ?? "",
        subjectName: subject?.name ?? "",
        periodNumber: slot.periodNumber,
        startTime: slot.startTime,
        endTime: slot.endTime,
        classId: slot.classId?.toString(),
        sectionId: slot.sectionId?.toString(),
        batchId: slot.batchId?.toString(),
        yearId: slot.yearId?.toString(),
        className,
        sectionName,
        batchName,
        yearName,
        dateBs
      };
    })
  );

  return enriched;
};

const formatAudit = (doc: { audit: Record<string, unknown>; createdAt?: Date; updatedAt?: Date }) => ({
  createdBy: String(doc.audit.createdBy ?? ""),
  createdAt: (doc.createdAt ?? new Date()).toISOString(),
  updatedBy: doc.audit.updatedBy ? String(doc.audit.updatedBy) : undefined,
  updatedAt: doc.updatedAt?.toISOString(),
  approvedBy: doc.audit.approvedBy ? String(doc.audit.approvedBy) : undefined,
  approvedAt: doc.audit.approvedAt ? new Date(doc.audit.approvedAt as Date).toISOString() : undefined,
  rejectedBy: doc.audit.rejectedBy ? String(doc.audit.rejectedBy) : undefined,
  rejectedAt: doc.audit.rejectedAt ? new Date(doc.audit.rejectedAt as Date).toISOString() : undefined,
  rejectionReason: doc.audit.rejectionReason as string | undefined,
  deletedBy: doc.audit.deletedBy ? String(doc.audit.deletedBy) : undefined,
  deletedAt: doc.audit.deletedAt ? new Date(doc.audit.deletedAt as Date).toISOString() : undefined
});

export const serializeSessionPlan = async (planId: string) => {
  const plan = await AcademicSessionPlan.findById(planId)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  if (!plan) return null;

  const units = await AcademicSessionPlanUnit.find({ sessionPlanId: plan._id }).sort({ unitNo: 1 }).lean();
  const progress = await AcademicProgress.findOne({ sessionPlanId: plan._id }).lean();
  const total = units.length;
  const completed = units.filter((unit) => unit.status === "COMPLETED").length;

  return {
    _id: plan._id.toString(),
    schoolId: plan.schoolId.toString(),
    academicYearBs: plan.academicYearBs,
    session: plan.session,
    faculty: plan.faculty,
    semesterBs: plan.semesterBs,
    classId: plan.classId?.toString(),
    sectionId: plan.sectionId?.toString(),
    batchId: plan.batchId?.toString(),
    yearId: plan.yearId?.toString(),
    subjectId: plan.subjectId?._id?.toString() ?? plan.subjectId?.toString(),
    teacherId: plan.teacherId?._id?.toString() ?? plan.teacherId?.toString(),
    status: plan.status,
    adminRemarks: plan.adminRemarks,
    attachmentUrl: plan.attachmentUrl,
    units: units.map((unit) => ({
      _id: unit._id.toString(),
      sessionPlanId: unit.sessionPlanId.toString(),
      unitNo: unit.unitNo,
      chapterName: unit.chapterName,
      estimatedTeachingHours: unit.estimatedTeachingHours,
      learningOutcomes: unit.learningOutcomes,
      topicsCovered: unit.topicsCovered,
      references: unit.references,
      practicalRequired: unit.practicalRequired,
      internalAssessment: unit.internalAssessment,
      tentativeCompletionMonth: unit.tentativeCompletionMonth,
      startDateBs: (unit as { startDateBs?: string }).startDateBs ?? "",
      endDateBs: (unit as { endDateBs?: string }).endDateBs ?? "",
      status: unit.status,
      attachmentUrl: unit.attachmentUrl,
      syllabusId: (unit as { syllabusId?: { toString(): string } }).syllabusId?.toString?.() ?? "",
      syllabusChapterId:
        (unit as { syllabusChapterId?: { toString(): string } }).syllabusChapterId?.toString?.() ?? "",
      syllabusUnitId:
        (unit as { syllabusUnitId?: { toString(): string } }).syllabusUnitId?.toString?.() ?? ""
    })),
    completedPercent: progress?.completedPercent ?? (total > 0 ? Math.round((completed / total) * 100) : 0),
    remainingPercent: progress?.remainingPercent ?? (total > 0 ? Math.round(((total - completed) / total) * 100) : 100),
    completedUnits: progress?.completedUnits ?? completed,
    remainingUnits: progress?.remainingUnits ?? total - completed,
    audit: formatAudit(plan),
    subject: plan.subjectId as unknown as { _id: string; name: string; code: string } | undefined,
    teacher: plan.teacherId as unknown as { _id: string; teacherCode: string; user?: { fullName: string } } | undefined
  };
};

export const serializeSyllabus = async (syllabusId: string) => {
  const plan = await AcademicSyllabus.findById(syllabusId)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  if (!plan) return null;

  const schoolId = plan.schoolId.toString();
  // Auto-migrate legacy flat units → Chapter → Unit → SubUnit (idempotent)
  await ensureSyllabusHierarchy(syllabusId, schoolId);

  const chapters = await loadSyllabusHierarchy(syllabusId);
  const stats = computeHierarchyStats(chapters);

  const units = await AcademicSyllabusUnit.find({ syllabusId: plan._id }).sort({ unitNo: 1 }).lean();
  const total = units.length;
  const completed = units.filter((unit) => unit.status === "COMPLETED").length;
  // Prefer sub-unit based progress when hierarchy exists
  const completedPercent =
    stats.totalSubUnits > 0
      ? stats.completedPercent
      : total > 0
        ? Math.round((completed / total) * 100)
        : 0;
  const remainingPercent = Math.max(0, 100 - completedPercent);

  const subject = plan.subjectId as unknown as { _id: string; name: string; code: string } | undefined;
  const subjectCode =
    (plan as { subjectCode?: string }).subjectCode || subject?.code || "";

  return {
    _id: plan._id.toString(),
    schoolId,
    academicYearBs: plan.academicYearBs,
    session: plan.session,
    faculty: plan.faculty,
    semesterBs: plan.semesterBs,
    classId: plan.classId?.toString(),
    sectionId: plan.sectionId?.toString(),
    batchId: plan.batchId?.toString(),
    yearId: plan.yearId?.toString(),
    subjectId: plan.subjectId?._id?.toString() ?? plan.subjectId?.toString(),
    teacherId: plan.teacherId
      ? (plan.teacherId as { _id?: { toString(): string } })._id?.toString() ??
        plan.teacherId.toString()
      : undefined,
    subjectCode,
    totalTheoryHours: (plan as { totalTheoryHours?: number }).totalTheoryHours ?? stats.theoryHours,
    totalPracticalHours:
      (plan as { totalPracticalHours?: number }).totalPracticalHours ?? stats.practicalHours,
    creditHours: (plan as { creditHours?: number }).creditHours ?? 0,
    remarks: (plan as { remarks?: string }).remarks ?? "",
    status: plan.status,
    adminRemarks: plan.adminRemarks,
    attachmentUrl: plan.attachmentUrl,
    chapters,
    units: units.map((unit) => ({
      _id: unit._id.toString(),
      syllabusId: unit.syllabusId.toString(),
      unitNo: unit.unitNo,
      chapterName: unit.chapterName,
      estimatedTeachingHours: unit.estimatedTeachingHours,
      learningOutcomes: unit.learningOutcomes,
      topicsCovered: unit.topicsCovered,
      references: unit.references,
      practicalRequired: unit.practicalRequired,
      internalAssessment: unit.internalAssessment,
      tentativeCompletionMonth: unit.tentativeCompletionMonth,
      startDateBs: (unit as { startDateBs?: string }).startDateBs ?? "",
      endDateBs: (unit as { endDateBs?: string }).endDateBs ?? "",
      status: unit.status,
      attachmentUrl: unit.attachmentUrl
    })),
    completedPercent,
    remainingPercent,
    completedUnits: stats.totalSubUnits > 0 ? stats.completedSubUnits : completed,
    remainingUnits: stats.totalSubUnits > 0 ? stats.remainingSubUnits : total - completed,
    completedSubUnits: stats.completedSubUnits,
    remainingSubUnits: stats.remainingSubUnits,
    totalSubUnits: stats.totalSubUnits,
    totalChapters: stats.totalChapters,
    totalTopics: stats.totalTopics,
    theoryHoursCovered: stats.theoryHoursCovered,
    practicalHoursCovered: stats.practicalHoursCovered,
    teachingHoursCovered: stats.teachingHoursCovered,
    remainingTeachingHours: stats.remainingTeachingHours,
    audit: formatAudit(plan),
    subject,
    teacher: plan.teacherId
      ? (plan.teacherId as unknown as { _id: string; teacherCode: string; user?: { fullName: string } })
      : undefined
  };
};

export const serializeLessonPlan = async (planId: string) => {
  const plan = await AcademicLessonPlan.findById(planId)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  if (!plan) return null;

  const items = await AcademicLessonPlanItem.find({ lessonPlanId: plan._id }).sort({ serialNo: 1 }).lean();
  const units = await AcademicSessionPlanUnit.find({
    _id: { $in: items.map((item) => item.sessionPlanUnitId).filter(Boolean) }
  }).lean();
  const unitMap = new Map(units.map((unit) => [unit._id.toString(), unit]));

  const todayBs = getTodayBs();
  const enrichedItems = items.map((item) => {
    const unit = item.sessionPlanUnitId ? unitMap.get(item.sessionPlanUnitId.toString()) : undefined;
    const completionStatus = computeItemStatus(item.estimatedClasses, item.completedClasses, item.deadline, todayBs);
    const completedPercent = calcCompletedPercent(item.estimatedClasses, item.completedClasses);
    const remainingPercent = calcRemainingPercent(item.estimatedClasses, item.completedClasses);

    return {
      _id: item._id.toString(),
      lessonPlanId: item.lessonPlanId.toString(),
      serialNo: item.serialNo,
      sessionPlanUnitId: item.sessionPlanUnitId?.toString(),
      subUnitTitle: (item as { subUnitTitle?: string }).subUnitTitle ?? "",
      syllabusId: (item as { syllabusId?: { toString(): string } }).syllabusId?.toString?.() ?? "",
      syllabusChapterId:
        (item as { syllabusChapterId?: { toString(): string } }).syllabusChapterId?.toString?.() ?? "",
      syllabusUnitId:
        (item as { syllabusUnitId?: { toString(): string } }).syllabusUnitId?.toString?.() ?? "",
      syllabusSubUnitId:
        (item as { syllabusSubUnitId?: { toString(): string } }).syllabusSubUnitId?.toString?.() ?? "",
      subjectLabel: item.subjectLabel,
      plannedTopic: item.plannedTopic,
      description: item.description,
      learningObjectives: item.learningObjectives,
      teachingMethod: item.teachingMethod,
      teachingAids: item.teachingAids,
      assessmentMethod: item.assessmentMethod,
      deadline: item.deadline,
      itemStartDateBs: (item as { itemStartDateBs?: string }).itemStartDateBs ?? "",
      itemEndDateBs: (item as { itemEndDateBs?: string }).itemEndDateBs ?? "",
      estimatedClasses: item.estimatedClasses,
      completedClasses: item.completedClasses,
      completionStatus,
      remarks: item.remarks,
      completedPercent,
      remainingPercent,
      unit: unit
        ? {
            _id: unit._id.toString(),
            unitNo: unit.unitNo,
            chapterName: unit.chapterName,
            topicsCovered: unit.topicsCovered,
            startDateBs: (unit as { startDateBs?: string }).startDateBs ?? "",
            endDateBs: (unit as { endDateBs?: string }).endDateBs ?? "",
            syllabusId:
              (unit as { syllabusId?: { toString(): string } }).syllabusId?.toString?.() ?? "",
            syllabusChapterId:
              (unit as { syllabusChapterId?: { toString(): string } }).syllabusChapterId?.toString?.() ??
              "",
            syllabusUnitId:
              (unit as { syllabusUnitId?: { toString(): string } }).syllabusUnitId?.toString?.() ?? ""
          }
        : undefined
    };
  });

  const totalClasses = enrichedItems.reduce((sum, item) => sum + item.estimatedClasses, 0);
  const completedClasses = enrichedItems.reduce((sum, item) => sum + item.completedClasses, 0);
  const plannedTopics = enrichedItems.length;
  const completedTopics = enrichedItems.filter((item) => item.completionStatus === "COMPLETED").length;
  const pendingTopics = plannedTopics - completedTopics;
  const pendingUnits = enrichedItems.filter((item) => item.completionStatus === "PENDING").length;
  const delayedUnits = enrichedItems.filter((item) => item.completionStatus === "DELAYED").length;
  const completedPercent = calcCompletedPercent(totalClasses, completedClasses);
  const remainingPercent = calcRemainingPercent(totalClasses, completedClasses);

  const planStart = (plan as { startDateBs?: string }).startDateBs ?? "";
  const planEnd = (plan as { endDateBs?: string }).endDateBs ?? "";
  const teachingDateBs =
    (plan as { teachingDateBs?: string }).teachingDateBs || planStart || planEnd || "";
  const derivedMonth =
    plan.month ||
    (teachingDateBs ? getNepaliMonthNameFromBsDate(teachingDateBs) : "") ||
    (planStart ? getNepaliMonthNameFromBsDate(planStart) : "") ||
    "";

  return {
    _id: plan._id.toString(),
    schoolId: plan.schoolId.toString(),
    sessionPlanId: plan.sessionPlanId?.toString(),
    academicYearBs: plan.academicYearBs,
    session: plan.session,
    faculty: plan.faculty,
    semesterBs: plan.semesterBs,
    classId: plan.classId?.toString(),
    sectionId: plan.sectionId?.toString(),
    batchId: plan.batchId?.toString(),
    yearId: plan.yearId?.toString(),
    subjectId: plan.subjectId?._id?.toString() ?? plan.subjectId?.toString(),
    teacherId: plan.teacherId?._id?.toString() ?? plan.teacherId?.toString(),
    month: derivedMonth,
    teachingDateBs,
    startDateBs: teachingDateBs || planStart,
    endDateBs: teachingDateBs || planEnd,
    monthlyDescription: (plan as { monthlyDescription?: string }).monthlyDescription ?? "",
    status: plan.status,
    preparedBy: plan.preparedBy,
    checkedBy: plan.checkedBy,
    approvedByName: plan.approvedByName,
    approvalDate: plan.approvalDate,
    adminRemarks: plan.adminRemarks,
    items: enrichedItems,
    completedPercent,
    remainingPercent,
    plannedTopics,
    completedTopics,
    pendingTopics,
    pendingUnits,
    delayedUnits,
    audit: formatAudit(plan),
    subject: plan.subjectId as unknown as { _id: string; name: string; code: string } | undefined,
    teacher: plan.teacherId as unknown as { _id: string; teacherCode: string; user?: { fullName: string } } | undefined
  };
};

export const serializeLogBookEntry = async (entryId: string) => {
  const entry = await AcademicLogBookEntry.findById(entryId)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  if (!entry) return null;

  return {
    _id: entry._id.toString(),
    schoolId: entry.schoolId.toString(),
    logBookId: entry.logBookId?.toString(),
    lessonPlanId: entry.lessonPlanId?.toString(),
    lessonPlanItemId: entry.lessonPlanItemId?.toString(),
    sessionPlanUnitId: entry.sessionPlanUnitId?.toString(),
    subUnitTitle: (entry as { subUnitTitle?: string }).subUnitTitle ?? "",
    syllabusId: (entry as { syllabusId?: { toString(): string } }).syllabusId?.toString?.() ?? "",
    syllabusChapterId:
      (entry as { syllabusChapterId?: { toString(): string } }).syllabusChapterId?.toString?.() ?? "",
    syllabusUnitId:
      (entry as { syllabusUnitId?: { toString(): string } }).syllabusUnitId?.toString?.() ?? "",
    syllabusSubUnitId:
      (entry as { syllabusSubUnitId?: { toString(): string } }).syllabusSubUnitId?.toString?.() ?? "",
    academicYearBs: entry.academicYearBs,
    session: entry.session,
    faculty: entry.faculty,
    semesterBs: entry.semesterBs,
    classId: entry.classId?.toString(),
    sectionId: entry.sectionId?.toString(),
    batchId: entry.batchId?.toString(),
    yearId: entry.yearId?.toString(),
    subjectId: entry.subjectId?._id?.toString() ?? entry.subjectId?.toString(),
    teacherId: entry.teacherId?._id?.toString() ?? entry.teacherId?.toString(),
    timetableSlotId: entry.timetableSlotId?.toString(),
    serialNo: entry.serialNo,
    dateBs: entry.dateBs,
    unit: entry.unit,
    topicCovered: entry.topicCovered,
    objectives: entry.objectives,
    teachingMethod: entry.teachingMethod,
    teachingAids: entry.teachingAids,
    theoryPractical: entry.theoryPractical,
    periodNumber: entry.periodNumber,
    startTime: entry.startTime,
    endTime: entry.endTime,
    attendancePresent: entry.attendancePresent,
    attendanceAbsent: entry.attendanceAbsent,
    attendancePercent: entry.attendancePercent,
    homeworkGiven: entry.homeworkGiven,
    assignment: entry.assignment,
    feedback: entry.feedback,
    difficultiesFaced: entry.difficultiesFaced,
    nextClassPlan: entry.nextClassPlan,
    attachmentUrl: entry.attachmentUrl,
    reviewStatus: entry.reviewStatus,
    teacherSignature: entry.teacherSignature,
    adminSignature: entry.adminSignature,
    adminRemarks: entry.adminRemarks,
    audit: formatAudit(entry),
    subject: entry.subjectId as unknown as { _id: string; name: string; code: string } | undefined,
    teacher: entry.teacherId as unknown as { _id: string; teacherCode: string; user?: { fullName: string } } | undefined
  };
};

/**
 * Count curriculum subjects for Academic Management dashboard.
 * College provisions one Subject document per master × batch-year, so raw
 * Subject.countDocuments inflates the total (e.g. 20 masters × years × batches ≈ 200+).
 * Prefer distinct masterSubjectId; fall back to unique code for non-master subjects.
 */
const countCurriculumSubjects = async (
  schoolId: mongoose.Types.ObjectId,
  options?: { subjectIds?: string[] }
): Promise<number> => {
  const match: Record<string, unknown> = {
    schoolId,
    isActive: { $ne: false }
  };
  if (options?.subjectIds?.length) {
    match._id = { $in: options.subjectIds };
  }

  const rows = await Subject.aggregate<{ _id: string }>([
    { $match: match },
    {
      $group: {
        _id: {
          $cond: [
            { $ifNull: ["$masterSubjectId", false] },
            { $concat: ["master:", { $toString: "$masterSubjectId" }] },
            {
              $concat: [
                "code:",
                { $toLower: { $ifNull: ["$code", ""] } },
                "|name:",
                { $toLower: { $ifNull: ["$name", ""] } }
              ]
            }
          ]
        }
      }
    }
  ]);

  return rows.length;
};

export const buildDashboard = async (req: Request, filters: AcademicManagementFilters): Promise<AcademicManagementDashboard> => {
  const baseFilter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, baseFilter, filters.subjectId);
  await applyTeacherScopeToFilter(req, baseFilter);
  const todayBs = getTodayBs();
  const schoolId = tenantObjectId(req);
  const teacherScope = await getTeacherScope(req);

  const liveSessionPlanIds = (
    await AcademicSessionPlan.find({ schoolId, isDeleted: false, ...(teacherScope ? { teacherId: teacherScope.teacherId } : {}) })
      .select("_id")
      .lean()
  ).map((plan) => plan._id);

  const progressQuery: Record<string, unknown> = {
    schoolId,
    sessionPlanId: { $in: liveSessionPlanIds }
  };
  if (teacherScope) progressQuery.teacherId = teacherScope.teacherId;
  if (filters.academicYearBs) progressQuery.academicYearBs = filters.academicYearBs;
  if (filters.teacherId && !teacherScope) progressQuery.teacherId = filters.teacherId;
  if (filters.subjectId) {
    const subjectIds = await expandCurriculumSubjectIds(schoolId, filters.subjectId);
    progressQuery.subjectId = subjectIds.length === 1 ? subjectIds[0] : { $in: subjectIds };
  }

  const [sessionPlans, lessonPlans, logEntries, progressRows, subjects] = await Promise.all([
    AcademicSessionPlan.countDocuments(baseFilter),
    AcademicLessonPlan.countDocuments(baseFilter),
    AcademicLogBookEntry.countDocuments({
      ...baseFilter,
      dateBs: filters.dateFrom || todayBs
    }),
    AcademicProgress.find(progressQuery).lean(),
    countCurriculumSubjects(schoolId, {
      subjectIds: teacherScope?.subjectIds
    })
  ]);

  const [pendingLessonApprovals, pendingSessionApprovals] = await Promise.all([
    AcademicLessonPlan.countDocuments({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } }),
    AcademicSessionPlan.countDocuments({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } })
  ]);
  const pendingApprovals = pendingLessonApprovals + pendingSessionApprovals;
  const approvedPlans = await AcademicLessonPlan.countDocuments({ ...baseFilter, status: "APPROVED" });

  const avgCompletion =
    progressRows.length > 0
      ? Math.round(progressRows.reduce((sum, row) => sum + row.completedPercent, 0) / progressRows.length)
      : 0;
  const avgRemaining = Math.max(0, 100 - avgCompletion);

  const logDateBs = filters.dateFrom || todayBs;
  const logDayOfWeek = getDayOfWeekFromBs(logDateBs);
  const [teachersWithLogToday, scheduledTeacherIds] = await Promise.all([
    AcademicLogBookEntry.distinct("teacherId", {
      schoolId,
      dateBs: logDateBs,
      isDeleted: false
    }),
    TimetableSlot.distinct("teacherId", { schoolId, dayOfWeek: logDayOfWeek })
  ]);
  const scheduledTeacherCount = scheduledTeacherIds.length;
  const scheduledLoggedCount = scheduledTeacherIds.filter((id) =>
    teachersWithLogToday.some((logged) => logged.toString() === id.toString())
  ).length;
  const teachersPendingLogBook = Math.max(scheduledTeacherCount - scheduledLoggedCount, 0);

  // Action alerts + live delayed count (same rules as serializeLessonPlan)
  const teacherAlerts: AcademicManagementDashboard["teacherAlerts"] = [];
  const planTeacherFilter = teacherScope ? { teacherId: teacherScope.teacherId } : {};

  const plansForAlerts = await AcademicLessonPlan.find({
    schoolId,
    isDeleted: false,
    ...planTeacherFilter,
    status: { $in: ["APPROVED", "PENDING_APPROVAL", "SUBMITTED", "DRAFT"] }
  })
    .select("_id teacherId month subjectId")
    .populate("subjectId", "name")
    .lean();

  const planIds = plansForAlerts.map((p) => p._id);
  const planMap = new Map(plansForAlerts.map((p) => [p._id.toString(), p]));
  const alertItems = planIds.length
    ? await AcademicLessonPlanItem.find({
        lessonPlanId: { $in: planIds }
      }).lean()
    : [];

  let delayedItems = 0;
  for (const item of alertItems) {
    const liveStatus = computeItemStatus(item.estimatedClasses, item.completedClasses, item.deadline, todayBs);
    if (liveStatus === "COMPLETED") continue;
    if (liveStatus === "DELAYED") delayedItems += 1;

    const plan = planMap.get(item.lessonPlanId.toString());
    if (!plan) continue;
    const remainingPercent = calcRemainingPercent(item.estimatedClasses, item.completedClasses);
    const completedPercent = calcCompletedPercent(item.estimatedClasses, item.completedClasses);
    const subjectName =
      (plan.subjectId as unknown as { name?: string } | null)?.name ?? "Subject";
    const base = {
      teacherId: plan.teacherId.toString(),
      lessonPlanId: plan._id.toString(),
      lessonPlanItemId: item._id.toString(),
      subjectName,
      topic: item.plannedTopic,
      month: plan.month,
      deadline: item.deadline || undefined,
      completedPercent,
      remainingPercent,
      estimatedClasses: item.estimatedClasses,
      completedClasses: item.completedClasses
    };

    if (liveStatus === "DELAYED" || isDeadlineOverdue(item.deadline, item.estimatedClasses, item.completedClasses, todayBs)) {
      teacherAlerts.push({
        ...base,
        type: "LESSON_PLAN_OVERDUE",
        message: `"${item.plannedTopic}" is overdue or delayed. ${remainingPercent}% remaining (${item.completedClasses}/${item.estimatedClasses} classes).`
      });
    } else if (isDeadlineApproaching(item.deadline, item.estimatedClasses, item.completedClasses, 3, todayBs)) {
      teacherAlerts.push({
        ...base,
        type: "LESSON_PLAN_APPROACHING",
        message: `"${item.plannedTopic}" deadline is near (${item.deadline}). ${remainingPercent}% remaining — complete on time.`
      });
    }
  }

  // Teachers see missing-log only when scheduled today; admins see scheduled pending summary
  if (teacherScope) {
    const isScheduled = scheduledTeacherIds.some((id) => id.toString() === teacherScope.teacherId);
    const hasLog = teachersWithLogToday.some((id) => id.toString() === teacherScope.teacherId);
    if (isScheduled && !hasLog) {
      teacherAlerts.push({
        type: "LOG_BOOK_MISSING",
        teacherId: teacherScope.teacherId,
        subjectName: "",
        topic: "Daily log book",
        month: "",
        completedPercent: 0,
        remainingPercent: 100,
        estimatedClasses: 0,
        completedClasses: 0,
        message: `Log book not submitted for ${logDateBs}. Please submit today's teaching log.`
      });
    }
  } else if (teachersPendingLogBook > 0) {
    teacherAlerts.push({
      type: "LOG_BOOK_MISSING",
      teacherId: "",
      subjectName: "",
      topic: "Daily log book",
      month: "",
      completedPercent: 0,
      remainingPercent: 100,
      estimatedClasses: 0,
      completedClasses: 0,
      message: `${teachersPendingLogBook} scheduled teacher(s) have not submitted the log book for ${logDateBs}.`
    });
  }

  // Sort: overdue → approaching → missing log; cap list for UI
  const typeOrder = { LESSON_PLAN_OVERDUE: 0, LESSON_PLAN_APPROACHING: 1, LOG_BOOK_MISSING: 2 } as const;
  teacherAlerts.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || b.remainingPercent - a.remainingPercent);

  const monthlyMatch: Record<string, unknown> = { schoolId, isDeleted: false };
  if (teacherScope) monthlyMatch.teacherId = teacherScope.teacherId;
  if (filters.teacherId && !teacherScope) monthlyMatch.teacherId = filters.teacherId;
  if (filters.academicYearBs) monthlyMatch.academicYearBs = filters.academicYearBs;
  if (filters.subjectId) monthlyMatch.subjectId = filters.subjectId;

  const monthlyProgress = await AcademicLessonPlan.aggregate([
    { $match: monthlyMatch },
    { $group: { _id: "$month", planned: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } } } },
    { $sort: { _id: 1 } }
  ]);

  const teacherPerformance = await AcademicProgress.aggregate([
    { $match: progressQuery },
    { $group: { _id: "$teacherId", completionPercent: { $avg: "$completedPercent" } } },
    { $limit: 10 }
  ]);

  const teacherDocs = await Teacher.find({ _id: { $in: teacherPerformance.map((row) => row._id) } })
    .populate("user", "fullName")
    .lean();

  const teacherNameMap = new Map(
    teacherDocs.map((teacher) => [
      teacher._id.toString(),
      (teacher.user as { fullName?: string } | undefined)?.fullName ?? teacher.teacherCode
    ])
  );

  const subjectProgress = await AcademicProgress.aggregate([
    { $match: progressQuery },
    { $group: { _id: "$subjectId", completionPercent: { $avg: "$completedPercent" } } },
    { $limit: 10 }
  ]);

  const subjectDocs = await Subject.find({ _id: { $in: subjectProgress.map((row) => row._id) } })
    .select("name")
    .lean();
  const subjectNameMap = new Map(subjectDocs.map((subject) => [subject._id.toString(), subject.name]));

  const facultyMatch: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    faculty: { $exists: true, $ne: "" }
  };
  if (teacherScope) facultyMatch.teacherId = teacherScope.teacherId;
  if (filters.teacherId && !teacherScope) facultyMatch.teacherId = filters.teacherId;
  if (filters.academicYearBs) facultyMatch.academicYearBs = filters.academicYearBs;
  if (filters.subjectId) facultyMatch.subjectId = filters.subjectId;

  const facultyProgressRows = await AcademicSessionPlan.aggregate([
    { $match: facultyMatch },
    {
      $lookup: {
        from: "academicprogresses",
        localField: "_id",
        foreignField: "sessionPlanId",
        as: "progress"
      }
    },
    { $unwind: { path: "$progress", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$faculty",
        completionPercent: { $avg: "$progress.completedPercent" }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return {
    totalSubjects: subjects,
    totalSessionPlans: sessionPlans,
    totalLessonPlans: lessonPlans,
    todaysLogBooks: logEntries,
    approvedPlans,
    pendingApprovals,
    delayedLessonPlans: delayedItems,
    syllabusCompletionPercent: avgCompletion,
    syllabusRemainingPercent: avgRemaining,
    teachersPendingLogBook,
    teacherAlerts: teacherAlerts.slice(0, 30),
    monthlyProgress: monthlyProgress.map((row) => ({
      month: row._id as string,
      planned: row.planned as number,
      completed: row.completed as number
    })),
    teacherPerformance: teacherPerformance.map((row) => ({
      teacherId: row._id.toString(),
      teacherName: teacherNameMap.get(row._id.toString()) ?? "Teacher",
      completionPercent: Math.round(row.completionPercent as number),
      remainingPercent: Math.max(0, 100 - Math.round(row.completionPercent as number))
    })),
    subjectProgress: subjectProgress.map((row) => ({
      subjectId: row._id.toString(),
      subjectName: subjectNameMap.get(row._id.toString()) ?? "Subject",
      completionPercent: Math.round(row.completionPercent as number),
      remainingPercent: Math.max(0, 100 - Math.round(row.completionPercent as number))
    })),
    facultyProgress: facultyProgressRows.map((row) => ({
      faculty: row._id as string,
      completionPercent: Math.round((row.completionPercent as number) || 0),
      remainingPercent: Math.max(0, 100 - Math.round((row.completionPercent as number) || 0))
    })),
    syllabusCompletion: subjectProgress.map((row) => ({
      subjectName: subjectNameMap.get(row._id.toString()) ?? "Subject",
      percent: Math.round(row.completionPercent as number),
      remainingPercent: Math.max(0, 100 - Math.round(row.completionPercent as number))
    }))
  };
};

export const matchesKeyword = (keyword: string | undefined, values: Array<string | undefined | null>): boolean => {
  if (!keyword?.trim()) return true;
  // NFC so Devanagari combining forms (e.g. व्याकरण) match Word/paste variants
  const needle = keyword.trim().normalize("NFC").toLowerCase();
  return values
    .filter(Boolean)
    .some((value) => String(value).normalize("NFC").toLowerCase().includes(needle));
};

export const addAcademicComment = async (
  req: Request,
  entityType: "SYLLABUS" | "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY",
  entityId: string,
  comment: string
) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  const user = await User.findById(req.user.userId).select("fullName").lean();

  const created = await AcademicComment.create({
    schoolId: tenantObjectId(req),
    entityType,
    entityId,
    authorUserId: req.user.userId,
    authorRole: req.user.role,
    authorName: user?.fullName ?? "User",
    comment
  });

  await recordAudit(req, {
    action: "academic.comment.create",
    entity: entityType,
    entityId,
    after: created
  });

  return created;
};