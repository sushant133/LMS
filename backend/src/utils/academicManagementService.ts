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
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
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
import { actorCanAdministerModule, actorMayUseAdminWorkspaceScope } from "./workspaceScope.js";

/** Institution Administrator, staff with Academic Management write, or dual-role teacher. */
export const actorIsAcademicAdmin = async (req: Request): Promise<boolean> =>
  actorCanAdministerModule(req, "academic-management");

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

const BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    or.push({
      code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    });
  }
  // Always match by name too — batch instances sometimes differ on code/master
  // but share the display name (e.g. "English").
  const name = (subject.name ?? "").trim();
  if (name) {
    or.push({
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    });
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
  if (await actorMayUseAdminWorkspaceScope(req)) return;
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
  if (await actorMayUseAdminWorkspaceScope(req)) return;
  const scope = await getTeacherScope(req);
  if (!scope) return;

  // Expand each assigned subject to curriculum siblings so teachers see plans
  // created under any batch-year instance of the same master subject.
  const schoolId = tenantObjectId(req);
  const allowed = new Set<string>();
  for (const id of scope.subjectIds.map(String)) {
    allowed.add(id);
    for (const sib of await expandCurriculumSubjectIds(schoolId, id)) {
      allowed.add(sib);
    }
  }
  const allowedList = [...allowed];

  const existing = filter.subjectId;
  if (existing == null) {
    filter.subjectId = { $in: allowedList };
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
  let intersected = existingIds.filter((id) => allowed.has(id));
  if (intersected.length === 0 && existingIds.length > 0) {
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
  if (await actorIsAcademicAdmin(req)) return;

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
  if (await actorIsAcademicAdmin(req)) return;

  const scope = await requireTeacherScope(req);
  if (params.teacherId && params.teacherId === scope.teacherId) return;
  if (scope.subjectIds.includes(params.subjectId)) return;

  // Curriculum siblings: assignment may be on one batch-year instance while syllabus uses another
  const schoolId = tenantObjectId(req);
  const syllabusExpanded = await expandCurriculumSubjectIds(schoolId, params.subjectId);
  if (syllabusExpanded.some((id) => scope.subjectIds.includes(id))) return;

  // Reverse expand each assigned subject (covers incomplete sibling graphs)
  for (const assignedId of scope.subjectIds) {
    const assignedExpanded = await expandCurriculumSubjectIds(schoolId, assignedId);
    if (assignedExpanded.includes(params.subjectId)) return;
  }

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
export const sanitizeTeacherOwnedUpdate = async <T extends Record<string, unknown>>(
  req: Request,
  payload: T
): Promise<T> => {
  // Always clone so callers can delete structure fields (chapters/units) without
  // mutating the original Zod payload used for hierarchy rewrite.
  const next = { ...payload };
  if (await actorIsAcademicAdmin(req)) return next;
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

export type AcademicNotifyKind = "SYLLABUS" | "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK";

const ACADEMIC_KIND_NOUN: Record<AcademicNotifyKind, string> = {
  SYLLABUS: "syllabus",
  SESSION_PLAN: "session plan",
  LESSON_PLAN: "lesson plan",
  LOG_BOOK: "log book"
};

const ACADEMIC_KIND_TITLE: Record<AcademicNotifyKind, string> = {
  SYLLABUS: "Syllabus",
  SESSION_PLAN: "Session plan",
  LESSON_PLAN: "Lesson plan",
  LOG_BOOK: "Log book"
};

export const academicKindNoun = (kind: AcademicNotifyKind): string => ACADEMIC_KIND_NOUN[kind];
export const academicKindTitle = (kind: AcademicNotifyKind): string => ACADEMIC_KIND_TITLE[kind];

export const academicNotifyNames = async (
  teacherId?: string | null,
  subjectId?: string | null
): Promise<{ teacherName: string; subjectName: string }> => {
  const [teacher, subject] = await Promise.all([
    teacherId
      ? Teacher.findById(teacherId).select("teacherCode user").populate("user", "fullName").lean()
      : null,
    subjectId ? Subject.findById(subjectId).select("name code").lean() : null
  ]);
  const teacherName =
    (teacher?.user as { fullName?: string } | undefined)?.fullName?.trim() ||
    String(teacher?.teacherCode || "").trim() ||
    "a teacher";
  const subjectName = String(subject?.name || "").trim() || "a subject";
  return { teacherName, subjectName };
};

const subjectWithExtra = (subjectName: string, extra?: string): string =>
  extra?.trim() ? `${subjectName} (${extra.trim()})` : subjectName;

export const academicAdminPendingCopy = (
  kind: AcademicNotifyKind,
  teacherName: string,
  subjectName: string,
  extra?: string
): { title: string; message: string } => ({
  title: `${ACADEMIC_KIND_TITLE[kind]} pending review`,
  message: `${teacherName} submitted the ${subjectWithExtra(subjectName, extra)} ${ACADEMIC_KIND_NOUN[kind]} for administrator review.`
});

export const academicTeacherDecisionCopy = (
  kind: AcademicNotifyKind,
  action: "APPROVED" | "REJECTED" | "UNLOCKED" | "REVIEWED" | "COMMENT",
  subjectName: string,
  extra?: string,
  remarks?: string
): { title: string; message: string } => {
  const item = `${subjectWithExtra(subjectName, extra)} ${ACADEMIC_KIND_NOUN[kind]}`;
  const note = remarks?.trim();
  switch (action) {
    case "APPROVED":
      return {
        title: `${ACADEMIC_KIND_TITLE[kind]} approved`,
        message: `Your ${item} has been approved.`
      };
    case "REJECTED":
      return {
        title: `${ACADEMIC_KIND_TITLE[kind]} rejected`,
        message: note
          ? `Your ${item} was rejected. Reason: ${note}`
          : `Your ${item} was rejected. Please review the administrator remarks and resubmit.`
      };
    case "UNLOCKED":
      return {
        title: `${ACADEMIC_KIND_TITLE[kind]} unlocked`,
        message: `Your ${item} has been unlocked so you can make corrections.`
      };
    case "REVIEWED":
      return {
        title: "Log book reviewed",
        message: note ? `Your ${item} was reviewed. Remarks: ${note}` : `Your ${item} was reviewed.`
      };
    case "COMMENT":
      return {
        title: `Comment on ${ACADEMIC_KIND_NOUN[kind]}`,
        message: note
          ? `An administrator commented on your ${item}: ${note}`
          : `An administrator commented on your ${item}.`
      };
  }
};

export const notifyAdminsOfPendingAcademic = async (
  req: Request,
  input: {
    kind: AcademicNotifyKind;
    teacherId?: string | null;
    subjectId?: string | null;
    extra?: string;
    entityId: string;
  }
): Promise<void> => {
  const names = await academicNotifyNames(input.teacherId, input.subjectId);
  const copy = academicAdminPendingCopy(
    input.kind,
    names.teacherName,
    names.subjectName,
    input.extra
  );
  await notifyAdmins(req, copy.title, copy.message, {
    entityId: input.entityId,
    kind: input.kind,
    teacherId: input.teacherId ? String(input.teacherId) : "",
    subjectId: input.subjectId ? String(input.subjectId) : ""
  });
};

export const notifyTeacherOfAcademicDecision = async (
  req: Request,
  input: {
    kind: AcademicNotifyKind;
    teacherId: string;
    subjectId?: string | null;
    extra?: string;
    action: "APPROVED" | "REJECTED" | "UNLOCKED" | "REVIEWED" | "COMMENT";
    remarks?: string;
    entityId: string;
  }
): Promise<void> => {
  if (!input.teacherId) return;
  const names = await academicNotifyNames(input.teacherId, input.subjectId);
  const copy = academicTeacherDecisionCopy(
    input.kind,
    input.action,
    names.subjectName,
    input.extra,
    input.remarks
  );
  await notifyTeacher(req, input.teacherId, copy.title, copy.message, {
    entityId: input.entityId,
    kind: input.kind,
    subjectId: input.subjectId ? String(input.subjectId) : ""
  });
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
 * Within one daily Lesson Plan, each Session Plan unit may appear only once.
 * The same unit may be planned on many different teaching days (daily spread).
 */
export const assertUniqueUnitsInLessonPlan = (unitIds: string[]): void => {
  const seen = new Set<string>();
  for (const unitId of unitIds) {
    if (!unitId) continue;
    if (seen.has(unitId)) {
      throw new ApiError(
        400,
        "Duplicate unit selected for this teaching day. Each unit can appear only once per daily Lesson Plan."
      );
    }
    seen.add(unitId);
  }
};

/**
 * Teaching date must fall inside each selected Session Plan unit's start/end window
 * when those dates are set on the unit.
 */
export const assertTeachingDateWithinSessionPlanUnits = async (
  req: Request,
  sessionPlanId: string,
  teachingDateBs: string,
  unitIds: string[]
): Promise<void> => {
  const date = (teachingDateBs || "").trim();
  if (!BS_DATE_RE.test(date)) {
    throw new ApiError(400, "Teaching date (BS) is required and must be YYYY-MM-DD.");
  }

  const uniqueIds = [...new Set(unitIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const units = await AcademicSessionPlanUnit.find({
    _id: { $in: uniqueIds },
    schoolId: tenantObjectId(req),
    sessionPlanId
  })
    .select("_id unitNo chapterName startDateBs endDateBs")
    .lean();

  if (units.length !== uniqueIds.length) {
    throw new ApiError(400, "One or more selected units do not belong to the Session Plan.");
  }

  for (const unit of units) {
    const start = String(unit.startDateBs || "").trim();
    const end = String(unit.endDateBs || "").trim();
    if (!start && !end) continue;

    if (start && BS_DATE_RE.test(start) && compareBsDates(date, start) < 0) {
      throw new ApiError(
        400,
        `Unit ${unit.unitNo} (${unit.chapterName || "unit"}) is scheduled from ${start}${
          end ? ` to ${end}` : ""
        }. Teaching date ${date} is before the unit start date.`
      );
    }
    if (end && BS_DATE_RE.test(end) && compareBsDates(date, end) > 0) {
      throw new ApiError(
        400,
        `Unit ${unit.unitNo} (${unit.chapterName || "unit"}) is scheduled${
          start ? ` from ${start}` : ""
        } to ${end}. Teaching date ${date} is after the unit end date.`
      );
    }
  }
};

/**
 * Every date a Lesson Plan row carries must sit inside its Session Plan unit's
 * start/end window.
 *
 * The teaching date is already checked by assertTeachingDateWithinSessionPlanUnits;
 * this covers the per-row (sub-unit) dates — item start/end and the topic
 * deadline — which are seeded from the unit but can be sent with any value.
 *
 * A unit with no window set is unconstrained, matching how the teaching-date
 * check treats it. Log Book entries are deliberately not validated this way:
 * a log book records what actually happened, which may fall outside the plan.
 */
export const assertLessonPlanItemDatesWithinSessionPlanUnits = async (
  req: Request,
  sessionPlanId: string,
  items: Array<{
    sessionPlanUnitId: string;
    itemStartDateBs?: string;
    itemEndDateBs?: string;
    deadline?: string;
  }>
): Promise<void> => {
  const uniqueIds = [...new Set(items.map((item) => item.sessionPlanUnitId).filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const units = await AcademicSessionPlanUnit.find({
    _id: { $in: uniqueIds },
    schoolId: tenantObjectId(req),
    sessionPlanId
  })
    .select("_id unitNo chapterName startDateBs endDateBs")
    .lean();

  if (units.length !== uniqueIds.length) {
    throw new ApiError(400, "One or more selected units do not belong to the Session Plan.");
  }

  const unitMap = new Map(units.map((unit) => [unit._id.toString(), unit]));

  for (const item of items) {
    const unit = unitMap.get(item.sessionPlanUnitId);
    if (!unit) continue;

    const windowStart = String(unit.startDateBs || "").trim();
    const windowEnd = String(unit.endDateBs || "").trim();
    const label = `Unit ${unit.unitNo} (${unit.chapterName || "unit"})`;
    const windowLabel = `${windowStart || "—"} to ${windowEnd || "—"}`;

    const checks: Array<{ value: string; field: string }> = [
      { value: String(item.itemStartDateBs || "").trim(), field: "start date" },
      { value: String(item.itemEndDateBs || "").trim(), field: "end date" },
      { value: String(item.deadline || "").trim(), field: "deadline" }
    ];

    for (const { value, field } of checks) {
      if (!value || !BS_DATE_RE.test(value)) continue;
      if (windowStart && BS_DATE_RE.test(windowStart) && compareBsDates(value, windowStart) < 0) {
        throw new ApiError(
          400,
          `${label} is scheduled ${windowLabel} in the Session Plan. The ${field} ${value} is before that window.`
        );
      }
      if (windowEnd && BS_DATE_RE.test(windowEnd) && compareBsDates(value, windowEnd) > 0) {
        throw new ApiError(
          400,
          `${label} is scheduled ${windowLabel} in the Session Plan. The ${field} ${value} is after that window.`
        );
      }
    }

    const itemStart = String(item.itemStartDateBs || "").trim();
    const itemEnd = String(item.itemEndDateBs || "").trim();
    if (
      itemStart &&
      itemEnd &&
      BS_DATE_RE.test(itemStart) &&
      BS_DATE_RE.test(itemEnd) &&
      compareBsDates(itemStart, itemEnd) > 0
    ) {
      throw new ApiError(400, `${label}: end date ${itemEnd} is before start date ${itemStart}.`);
    }
  }
};

/**
 * @deprecated Use assertUniqueUnitsInLessonPlan + assertTeachingDateWithinSessionPlanUnits.
 * Kept as a thin wrapper so any external import still resolves during rebuild.
 */
export const assertNoDuplicateLessonPlanUnitsInMonth = async (
  _req: Request,
  params: {
    unitIds: string[];
    [key: string]: unknown;
  }
): Promise<void> => {
  assertUniqueUnitsInLessonPlan(params.unitIds);
};

/**
 * Prevent two Log Book entries for the same Lesson Plan topic on the same BS date.
 */
/** Next free period number for this teacher + subject + teaching date (unique index). */
export const nextLogBookPeriodNumber = async (
  req: Request,
  teacherId: string,
  subjectId: string,
  dateBs: string,
  excludeEntryId?: string
): Promise<number> => {
  const rows = await AcademicLogBookEntry.find({
    schoolId: tenantObjectId(req),
    teacherId,
    subjectId,
    dateBs,
    isDeleted: false,
    ...(excludeEntryId ? { _id: { $ne: excludeEntryId } } : {})
  })
    .select("periodNumber")
    .lean();
  const used = new Set(rows.map((row) => Number(row.periodNumber) || 0));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
};

const headingKey = (value?: string) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/^\d+(\.\d+)*\s*[:.)\-–]?\s*/, "")
    .replace(/^unit\s*\d+\s*[:.\-]?\s*/i, "")
    .replace(/\s+/g, " ");

const asId = (value?: string) => {
  const s = (value ?? "").trim();
  if (!s || !mongoose.Types.ObjectId.isValid(s)) return undefined;
  return s;
};

/**
 * Find the Lesson Plan item this log row should update (progress chain).
 * Prefer an explicit item id; otherwise match teacher + subject + date + unit.
 */
export const resolveLogBookLessonPlanLink = async (
  req: Request,
  params: {
    lessonPlanItemId?: string;
    sessionPlanUnitId?: string;
    teacherId: string;
    subjectId: string;
    dateBs: string;
  }
): Promise<{
  itemId: string;
  planId: string;
  sessionPlanUnitId?: string;
  syllabusId?: string;
  syllabusChapterId?: string;
  syllabusUnitId?: string;
  syllabusSubUnitIds: string[];
  subUnitTitles: string[];
} | null> => {
  const schoolId = tenantObjectId(req);
  const date = (params.dateBs || "").trim();

  let item = asId(params.lessonPlanItemId)
    ? await AcademicLessonPlanItem.findById(params.lessonPlanItemId).lean()
    : null;
  if (item && item.schoolId.toString() !== schoolId.toString()) item = null;

  if (!item) {
    const siblingIds = await expandCurriculumSubjectIds(schoolId, params.subjectId);
    const subjectFilter = siblingIds.length > 0 ? { $in: siblingIds } : params.subjectId;
    const plans = await AcademicLessonPlan.find({
      schoolId,
      isDeleted: false,
      teacherId: params.teacherId,
      subjectId: subjectFilter,
      ...(date
        ? {
            $or: [{ teachingDateBs: date }, { startDateBs: date }, { endDateBs: date }]
          }
        : {})
    })
      .select("_id")
      .lean();

    const planIds = plans.map((plan) => plan._id);
    const unitId = asId(params.sessionPlanUnitId);
    if (planIds.length) {
      const filter: Record<string, unknown> = {
        schoolId,
        lessonPlanId: { $in: planIds }
      };
      if (unitId) filter.sessionPlanUnitId = unitId;
      item = await AcademicLessonPlanItem.findOne(filter).sort({ serialNo: 1 }).lean();
    }

    if (!item && date) {
      const dateItems = await AcademicLessonPlanItem.find({
        schoolId,
        itemStartDateBs: date,
        ...(unitId ? { sessionPlanUnitId: unitId } : {})
      }).lean();
      for (const cand of dateItems) {
        const plan = await AcademicLessonPlan.findOne({
          _id: cand.lessonPlanId,
          schoolId,
          isDeleted: false,
          teacherId: params.teacherId,
          subjectId: subjectFilter
        })
          .select("_id")
          .lean();
        if (plan) {
          item = cand;
          break;
        }
      }
    }
  }

  if (!item) return null;

  const plan = await AcademicLessonPlan.findOne({
    _id: item.lessonPlanId,
    schoolId,
    isDeleted: false
  }).lean();
  if (!plan) return null;

  const anyItem = item as {
    syllabusId?: { toString(): string };
    syllabusChapterId?: { toString(): string };
    syllabusUnitId?: { toString(): string };
    syllabusSubUnitId?: { toString(): string };
    syllabusSubUnitIds?: Array<string | { toString(): string }>;
    subUnitTitle?: string;
    subUnitTitles?: string[];
    sessionPlanUnitId?: { toString(): string };
  };
  const syllabusSubUnitIds = Array.isArray(anyItem.syllabusSubUnitIds)
    ? anyItem.syllabusSubUnitIds
        .map((id) => (typeof id === "string" ? id : id?.toString?.() ?? ""))
        .filter(Boolean)
    : anyItem.syllabusSubUnitId
      ? [anyItem.syllabusSubUnitId.toString()]
      : [];
  const subUnitTitles = Array.isArray(anyItem.subUnitTitles)
    ? anyItem.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
    : String(anyItem.subUnitTitle || "")
        .split(/[;\n|]+/)
        .map((t) => t.trim())
        .filter(Boolean);

  return {
    itemId: item._id.toString(),
    planId: plan._id.toString(),
    sessionPlanUnitId: anyItem.sessionPlanUnitId?.toString(),
    syllabusId: anyItem.syllabusId?.toString(),
    syllabusChapterId: anyItem.syllabusChapterId?.toString(),
    syllabusUnitId: anyItem.syllabusUnitId?.toString(),
    syllabusSubUnitIds,
    subUnitTitles
  };
};

const expandTaughtTitles = (titles: string[]): string[] => {
  const out: string[] = [];
  for (const title of titles) {
    for (const part of String(title || "")
      .split(/[;\n|]+/)
      .map((row) => row.trim())
      .filter(Boolean)) {
      if (!out.some((x) => x.toLowerCase() === part.toLowerCase())) out.push(part);
    }
  }
  return out;
};

const parseUnitNo = (label?: string): number => {
  const match = String(label || "").match(/(?:^|\b)(?:unit|chapter)\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
};

const titleDisplayNo = (title: string): string => {
  const match = String(title || "")
    .trim()
    .match(/^(\d+(?:\.\d+)*)\b/);
  return match?.[1] ?? "";
};

type SyllabusLeaf = {
  id: string;
  heading: string;
  headingKey: string;
  unitId: string;
  unitNo: number;
  displayNo: string;
};

const loadSyllabusLeaves = async (syllabusIds: string[]): Promise<SyllabusLeaf[]> => {
  if (syllabusIds.length === 0) return [];
  const [rows, topics] = await Promise.all([
    AcademicSyllabusSubUnit.find({ syllabusId: { $in: syllabusIds } })
      .select("_id heading unitId parentSubUnitId subUnitNo")
      .lean(),
    AcademicSyllabusTopic.find({ syllabusId: { $in: syllabusIds } })
      .select("_id unitNo")
      .lean()
  ]);
  const unitNoById = new Map(topics.map((topic) => [String(topic._id), Number(topic.unitNo) || 0]));
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const parentIds = new Set(
    rows
      .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
      .filter(Boolean)
  );

  const displayNoOf = (id: string, seen = new Set<string>()): string => {
    if (seen.has(id)) return "";
    seen.add(id);
    const node = byId.get(id);
    if (!node) return "";
    const no = String(node.subUnitNo || 0);
    if (node.parentSubUnitId) {
      const parent = displayNoOf(String(node.parentSubUnitId), seen);
      return parent ? `${parent}.${no}` : no;
    }
    const unitNo = unitNoById.get(String(node.unitId)) || 0;
    return unitNo ? `${unitNo}.${no}` : no;
  };

  return rows
    .filter((row) => !parentIds.has(String(row._id)))
    .map((row) => {
      const id = String(row._id);
      return {
        id,
        heading: String(row.heading || ""),
        headingKey: headingKey(row.heading),
        unitId: String(row.unitId || ""),
        unitNo: unitNoById.get(String(row.unitId)) || 0,
        displayNo: displayNoOf(id)
      };
    });
};

/** Match one taught title to at most the correct leaf(s) in the given scope. */
const matchLeavesByTitles = (leaves: SyllabusLeaf[], titles: string[]): string[] => {
  const found = new Set<string>();
  const unitsInScope = new Set(leaves.map((leaf) => leaf.unitId));
  const scopedToOneUnit = unitsInScope.size <= 1;

  for (const title of expandTaughtTitles(titles)) {
    const key = headingKey(title);
    const raw = title.trim().toLowerCase();
    const num = titleDisplayNo(title);
    const candidates = leaves.filter((leaf) => {
      if (num && leaf.displayNo === num) return true;
      if (key && leaf.headingKey === key) return true;
      if (raw && leaf.heading.trim().toLowerCase() === raw) return true;
      return false;
    });
    if (candidates.length === 0) continue;
    const byDisplay = num ? candidates.filter((leaf) => leaf.displayNo === num) : [];
    if (byDisplay.length === 1) {
      found.add(byDisplay[0]!.id);
      continue;
    }
    const exactRaw = candidates.filter(
      (leaf) => leaf.heading.trim().toLowerCase() === raw
    );
    if (exactRaw.length === 1) {
      found.add(exactRaw[0]!.id);
      continue;
    }
    const unitIds = new Set(candidates.map((leaf) => leaf.unitId));
    if (unitIds.size === 1 || scopedToOneUnit) {
      if (byDisplay.length > 0) {
        for (const leaf of byDisplay) found.add(leaf.id);
      } else if (exactRaw.length > 0) {
        for (const leaf of exactRaw) found.add(leaf.id);
      } else if (candidates.length === 1) {
        found.add(candidates[0]!.id);
      } else {
        // Same generic heading twice in one unit: count once, not every lookalike
        found.add(candidates[0]!.id);
      }
      continue;
    }
    // Ambiguous across units with no unit scope — do not over-count
  }
  return [...found];
};

/**
 * Map taught sub-unit titles onto syllabus leaf documents.
 * Known ids are only used when they correspond to a taught title (never dump
 * a whole lesson-plan unit list). Repeats of the same leaf collapse to one id.
 */
export const resolveTaughtSyllabusSubUnitIds = async (
  req: Request,
  params: {
    taughtTitles: string[];
    knownIds?: string[];
    syllabusId?: string;
    syllabusUnitId?: string;
    syllabusChapterId?: string;
    subjectId?: string;
    unitLabel?: string;
  }
): Promise<string[]> => {
  const schoolId = tenantObjectId(req);
  const knownIds = [
    ...new Set(
      (params.knownIds ?? [])
        .map((id) => asId(id))
        .filter((id): id is string => Boolean(id))
    )
  ];
  const titles = expandTaughtTitles(params.taughtTitles ?? []);
  if (titles.length === 0) return knownIds;

  const syllabusIds: string[] = [];
  const syllabusId = asId(params.syllabusId);
  if (syllabusId) syllabusIds.push(syllabusId);
  if (syllabusIds.length === 0 && params.subjectId) {
    const siblingIds = await expandCurriculumSubjectIds(schoolId, params.subjectId);
    const syllabi = await AcademicSyllabus.find({
      schoolId,
      subjectId: siblingIds.length > 0 ? { $in: siblingIds } : params.subjectId,
      isDeleted: { $ne: true }
    })
      .select("_id")
      .lean();
    syllabusIds.push(...syllabi.map((row) => row._id.toString()));
  }

  let leaves = await loadSyllabusLeaves(syllabusIds);
  const unitId = asId(params.syllabusUnitId);
  let scopedByUnit = false;
  if (unitId) {
    const scoped = leaves.filter((leaf) => leaf.unitId === unitId);
    if (scoped.length > 0) {
      leaves = scoped;
      scopedByUnit = true;
    }
  }
  // A dangling unit id must not widen the search to the whole syllabus: fall
  // back to the unit label so a title is never matched against another unit.
  if (!scopedByUnit) {
    const unitNo = parseUnitNo(params.unitLabel);
    if (unitNo > 0) {
      const scoped = leaves.filter((leaf) => leaf.unitNo === unitNo);
      if (scoped.length > 0) leaves = scoped;
    }
  }

  const matched = matchLeavesByTitles(leaves, titles);
  const knownSet = new Set(knownIds);
  const matchedKnown = matched.filter((id) => knownSet.size === 0 || knownSet.has(id));
  // Prefer title matches; fall back to known ids that are actual leaves for those titles
  const found = new Set(matchedKnown.length > 0 ? matchedKnown : matched);
  if (found.size === 0 && knownIds.length > 0) {
    const leafIds = new Set(leaves.map((leaf) => leaf.id));
    for (const id of knownIds) {
      if (leafIds.has(id)) found.add(id);
    }
  }
  return [...found];
};

/**
 * Unique syllabus leaves actually taught in the log book (same leaf on two dates = 1).
 */
export const uniqueTaughtSyllabusLeafIdsFromLogBook = async (
  schoolId: mongoose.Types.ObjectId,
  syllabusId: string,
  subjectId?: string
): Promise<Set<string>> => {
  const leaves = await loadSyllabusLeaves([syllabusId]);
  const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
  const byUnit = new Map<string, SyllabusLeaf[]>();
  for (const leaf of leaves) {
    const list = byUnit.get(leaf.unitId) ?? [];
    list.push(leaf);
    byUnit.set(leaf.unitId, list);
  }

  let subjectIds: string[] = [];
  if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
    try {
      subjectIds = await expandCurriculumSubjectIds(schoolId, subjectId);
    } catch {
      subjectIds = [subjectId];
    }
  }
  const entries = await AcademicLogBookEntry.find({
    schoolId,
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "NEEDS_IMPROVEMENT" },
    $or: [
      { syllabusId },
      ...(subjectIds.length > 0 ? [{ subjectId: { $in: subjectIds } }] : [])
    ]
  })
    .select(
      "subUnitTitles subUnitTitle syllabusSubUnitIds syllabusSubUnitId syllabusUnitId syllabusId unit"
    )
    .lean();

  const taught = new Set<string>();
  for (const entry of entries) {
    const entrySyllabus = entry.syllabusId ? String(entry.syllabusId) : "";
    if (entrySyllabus && entrySyllabus !== syllabusId) continue;
    const titles = expandTaughtTitles([
      ...((entry.subUnitTitles as string[] | undefined) ?? []),
      String(entry.subUnitTitle || "")
    ]);
    const unitId = entry.syllabusUnitId ? String(entry.syllabusUnitId) : "";
    const unitNo = parseUnitNo(String((entry as { unit?: string }).unit || ""));
    let scope = leaves;
    if (unitId && byUnit.has(unitId)) scope = byUnit.get(unitId) ?? leaves;
    else if (unitNo > 0) {
      const byNo = leaves.filter((leaf) => leaf.unitNo === unitNo);
      if (byNo.length > 0) scope = byNo;
    }

    const ids = [
      ...((entry.syllabusSubUnitIds ?? []) as Array<string | { toString(): string }>),
      entry.syllabusSubUnitId
    ]
      .map((id) => (id ? String(id) : ""))
      .filter(Boolean);
    if (titles.length > 0) {
      const matched = matchLeavesByTitles(scope, titles);
      if (matched.length > 0) {
        for (const id of matched) taught.add(id);
        continue;
      }
    }
    const blob = titles.join(" ").toLowerCase();
    for (const id of ids) {
      const leaf = leafById.get(id);
      if (!leaf || !scope.some((row) => row.id === id)) continue;
      if (
        titles.length === 0 ||
        (leaf.headingKey && blob.includes(leaf.headingKey)) ||
        (leaf.heading && blob.includes(leaf.heading.trim().toLowerCase()))
      ) {
        taught.add(id);
      }
    }
  }
  return taught;
};

/** Align COMPLETED flags with unique log-book-taught leaves (deduped). */
export const syncSyllabusCompletionFromLogBook = async (
  schoolId: mongoose.Types.ObjectId,
  syllabusId: string,
  subjectId?: string
): Promise<Set<string>> => {
  const taught = await uniqueTaughtSyllabusLeafIdsFromLogBook(
    schoolId,
    syllabusId,
    subjectId
  );
  const taughtList = [...taught];
  if (taughtList.length === 0) {
    await AcademicSyllabusSubUnit.updateMany(
      { syllabusId, status: "COMPLETED" },
      { $set: { status: "NOT_STARTED" } }
    );
    return taught;
  }
  await AcademicSyllabusSubUnit.updateMany(
    {
      syllabusId,
      status: "COMPLETED",
      _id: { $nin: taughtList }
    },
    { $set: { status: "NOT_STARTED" } }
  );
  await AcademicSyllabusSubUnit.updateMany(
    { syllabusId, _id: { $in: taughtList } },
    { $set: { status: "COMPLETED" } }
  );
  return taught;
};

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
      startDateBs: String((unit as { startDateBs?: string }).startDateBs ?? "").trim(),
      endDateBs: String((unit as { endDateBs?: string }).endDateBs ?? "").trim(),
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

const syllabusLeafDone = (status: string): boolean =>
  status === "COMPLETED" || status === "SKIPPED";

const leafProgressForSyllabusUnit = async (
  syllabusUnitId?: string | null
): Promise<{ total: number; completed: number } | null> => {
  if (!syllabusUnitId) return null;
  const subs = await AcademicSyllabusSubUnit.find({ unitId: syllabusUnitId })
    .select("_id parentSubUnitId status")
    .lean();
  if (subs.length === 0) return { total: 0, completed: 0 };
  const parentIds = new Set(
    subs
      .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
      .filter(Boolean)
  );
  const leaves = subs.filter((row) => !parentIds.has(String(row._id)));
  return {
    total: leaves.length,
    completed: leaves.filter((row) => syllabusLeafDone(String(row.status || ""))).length
  };
};

const ensureSessionUnitSyllabusLink = async (
  unit: InstanceType<typeof AcademicSessionPlanUnit>
): Promise<void> => {
  // A stored link is only trustworthy while the topic it points at still exists.
  // Re-saving a syllabus can replace the hierarchy, leaving this id dangling —
  // leaf progress then silently reads zero and the unit never leaves PENDING.
  if (unit.syllabusUnitId) {
    const linked = await AcademicSyllabusTopic.findById(unit.syllabusUnitId)
      .select("_id")
      .lean();
    if (linked) return;
    unit.set("syllabusUnitId", undefined);
    unit.set("syllabusChapterId", undefined);
  }
  let syllabusIds: string[] = unit.syllabusId ? [unit.syllabusId.toString()] : [];
  if (syllabusIds.length === 0) {
    const plan = await AcademicSessionPlan.findById(unit.sessionPlanId)
      .select("schoolId subjectId academicYearBs")
      .lean();
    if (plan?.subjectId) {
      const subjectIds = await expandCurriculumSubjectIds(
        plan.schoolId,
        plan.subjectId.toString()
      );
      const syllabi = await AcademicSyllabus.find({
        schoolId: plan.schoolId,
        subjectId: { $in: subjectIds },
        isDeleted: { $ne: true },
        ...(plan.academicYearBs ? { academicYearBs: plan.academicYearBs } : {})
      })
        .select("_id")
        .lean();
      syllabusIds = syllabi.map((row) => row._id.toString());
    }
  }
  if (syllabusIds.length === 0) return;
  const title = String(unit.chapterName || "").trim();
  const topic =
    (await AcademicSyllabusTopic.findOne({
      syllabusId: { $in: syllabusIds },
      unitNo: unit.unitNo
    })
      .select("_id syllabusId")
      .lean()) ||
    (title
      ? await AcademicSyllabusTopic.findOne({
          syllabusId: { $in: syllabusIds },
          title: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
        })
          .select("_id syllabusId")
          .lean()
      : null);
  if (!topic) return;
  unit.set("syllabusUnitId", topic._id);
  if (!unit.syllabusId && topic.syllabusId) {
    unit.set("syllabusId", topic.syllabusId);
  }
};

/** Recompute Session Plan unit status from syllabus sub-units (log book) and lesson items. */
export const resyncSessionPlanUnitProgress = async (unitId: string): Promise<void> => {
  const unit = await AcademicSessionPlanUnit.findById(unitId);
  if (!unit) return;

  await ensureSessionUnitSyllabusLink(unit);

  const rawItems = await AcademicLessonPlanItem.find({ sessionPlanUnitId: unitId }).lean();
  const planIds = [
    ...new Set(rawItems.map((item) => item.lessonPlanId?.toString()).filter(Boolean))
  ] as string[];
  const livePlans = planIds.length
    ? await AcademicLessonPlan.find({
        _id: { $in: planIds },
        isDeleted: false
      })
        .select("_id")
        .lean()
    : [];
  const livePlanIds = new Set(livePlans.map((p) => p._id.toString()));
  const items = rawItems.filter((item) => livePlanIds.has(item.lessonPlanId?.toString() ?? ""));

  const leaves = await leafProgressForSyllabusUnit(unit.syllabusUnitId?.toString());
  const allItemsDone =
    items.length > 0 && items.every((item) => item.completionStatus === "COMPLETED");
  const anyItemsStarted = items.some((item) => (item.completedClasses ?? 0) > 0);
  const anyDelayed = items.some((item) => item.completionStatus === "DELAYED");
  const allLeavesDone = Boolean(leaves && leaves.total > 0 && leaves.completed >= leaves.total);
  const anyLeavesDone = Boolean(leaves && leaves.completed > 0);

  if (allLeavesDone || allItemsDone) unit.status = "COMPLETED";
  else if (anyDelayed) unit.status = "DELAYED";
  else if (anyLeavesDone || anyItemsStarted) unit.status = "IN_PROGRESS";
  else if (items.length === 0 && (!leaves || leaves.total === 0)) unit.status = "PENDING";
  else unit.status = "PENDING";

  await unit.save();
};

const syncSessionPlanUnitFromLessonItem = async (unitId: string): Promise<void> => {
  await resyncSessionPlanUnitProgress(unitId);
};

const computeSessionPlanProgressStats = async (sessionPlanId: string) => {
  const units = await AcademicSessionPlanUnit.find({ sessionPlanId }).lean();
  const total = units.length;
  const completedUnits = units.filter((unit) => unit.status === "COMPLETED").length;
  const delayedUnits = units.filter((unit) => unit.status === "DELAYED").length;

  const syllabusUnitIds = units
    .map((unit) => unit.syllabusUnitId?.toString())
    .filter((id): id is string => Boolean(id));
  let totalLeaves = 0;
  let doneLeaves = 0;
  if (syllabusUnitIds.length > 0) {
    const subs = await AcademicSyllabusSubUnit.find({ unitId: { $in: syllabusUnitIds } })
      .select("_id parentSubUnitId status")
      .lean();
    const parentIds = new Set(
      subs
        .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
        .filter(Boolean)
    );
    const leaves = subs.filter((row) => !parentIds.has(String(row._id)));
    totalLeaves = leaves.length;
    doneLeaves = leaves.filter((row) => syllabusLeafDone(String(row.status || ""))).length;
  }

  // Same subject syllabus (covers units not yet linked by syllabusUnitId).
  // Use ONE matching syllabus — never sum sibling copies (that double-counts).
  if (totalLeaves === 0) {
    const plan = await AcademicSessionPlan.findById(sessionPlanId)
      .select("schoolId subjectId academicYearBs yearId classId")
      .lean();
    if (plan?.subjectId) {
      const subjectIds = await expandCurriculumSubjectIds(
        plan.schoolId,
        plan.subjectId.toString()
      );
      const syllabi = await AcademicSyllabus.find({
        schoolId: plan.schoolId,
        subjectId: { $in: subjectIds },
        isDeleted: { $ne: true },
        ...(plan.academicYearBs ? { academicYearBs: plan.academicYearBs } : {})
      })
        .select("_id yearId classId")
        .lean();
      const planYear = plan.yearId ? String(plan.yearId) : "";
      const planClass = plan.classId ? String(plan.classId) : "";
      const ranked = syllabi
        .map((syllabus) => {
          let score = 0;
          if (planYear && syllabus.yearId && String(syllabus.yearId) === planYear) score += 4;
          if (planClass && syllabus.classId && String(syllabus.classId) === planClass) {
            score += 4;
          }
          return { syllabus, score };
        })
        .sort((a, b) => b.score - a.score);
      const chosen =
        ranked.find((row) => row.score > 0)?.syllabus ?? ranked[0]?.syllabus ?? null;
      if (chosen) {
        const chapters = await loadSyllabusHierarchy(chosen._id.toString());
        const stats = computeHierarchyStats(chapters);
        if (stats.totalSubUnits > 0) {
          totalLeaves = stats.totalSubUnits;
          doneLeaves = stats.completedSubUnits;
        }
      }
    }
  }

  const completedPercent =
    totalLeaves > 0
      ? Math.round((doneLeaves / totalLeaves) * 100)
      : total > 0
        ? Math.round((completedUnits / total) * 100)
        : 0;

  return {
    totalUnits: total,
    completedUnits,
    remainingUnits: Math.max(0, total - completedUnits),
    delayedUnits,
    completedPercent,
    remainingPercent: Math.max(0, 100 - completedPercent)
  };
};

export const resyncSessionPlansTouchedByLog = async (params: {
  schoolId?: string;
  teacherId?: string;
  subjectId?: string;
  sessionPlanUnitId?: string;
  syllabusUnitId?: string;
}): Promise<void> => {
  const unitIds = new Set<string>();
  const planIds = new Set<string>();
  if (params.sessionPlanUnitId) unitIds.add(params.sessionPlanUnitId);
  if (params.syllabusUnitId) {
    const linked = await AcademicSessionPlanUnit.find({
      syllabusUnitId: params.syllabusUnitId
    })
      .select("_id sessionPlanId")
      .lean();
    for (const unit of linked) {
      unitIds.add(unit._id.toString());
      planIds.add(unit.sessionPlanId.toString());
    }
  }
  for (const id of unitIds) {
    await resyncSessionPlanUnitProgress(id);
    const unit = await AcademicSessionPlanUnit.findById(id).select("sessionPlanId").lean();
    if (unit) planIds.add(unit.sessionPlanId.toString());
  }
  if (planIds.size === 0 && params.teacherId && params.subjectId) {
    const filter: Record<string, unknown> = {
      teacherId: params.teacherId,
      subjectId: params.subjectId,
      isDeleted: { $ne: true }
    };
    if (params.schoolId) filter.schoolId = params.schoolId;
    const plans = await AcademicSessionPlan.find(filter).select("_id").lean();
    for (const plan of plans) {
      planIds.add(plan._id.toString());
      const units = await AcademicSessionPlanUnit.find({ sessionPlanId: plan._id })
        .select("_id")
        .lean();
      for (const unit of units) await resyncSessionPlanUnitProgress(unit._id.toString());
    }
  }
  for (const planId of planIds) await syncSessionPlanProgress(planId);
};

export const syncSessionPlanProgress = async (sessionPlanId: string): Promise<void> => {
  const plan = await AcademicSessionPlan.findById(sessionPlanId);
  if (!plan) return;
  if (plan.subjectId) {
    const subjectIds = await expandCurriculumSubjectIds(
      plan.schoolId,
      plan.subjectId.toString()
    );
    const syllabi = await AcademicSyllabus.find({
      schoolId: plan.schoolId,
      subjectId: { $in: subjectIds },
      isDeleted: { $ne: true },
      ...(plan.academicYearBs ? { academicYearBs: plan.academicYearBs } : {})
    })
      .select("_id")
      .lean();
    for (const syllabus of syllabi) {
      await syncSyllabusCompletionFromLogBook(
        plan.schoolId,
        syllabus._id.toString(),
        plan.subjectId.toString()
      );
    }
  }
  const units = await AcademicSessionPlanUnit.find({ sessionPlanId });
  for (const unit of units) {
    await resyncSessionPlanUnitProgress(unit._id.toString());
  }
  const stats = await computeSessionPlanProgressStats(sessionPlanId);

  await AcademicProgress.findOneAndUpdate(
    { sessionPlanId },
    {
      schoolId: plan.schoolId,
      sessionPlanId: plan._id,
      subjectId: plan.subjectId,
      teacherId: plan.teacherId,
      academicYearBs: plan.academicYearBs,
      completedPercent: stats.completedPercent,
      remainingPercent: stats.remainingPercent,
      completedUnits: stats.completedUnits,
      remainingUnits: stats.remainingUnits,
      delayedUnits: stats.delayedUnits
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
  // Only persist valid ObjectIds — empty strings from forms cast and 400
  const oid = (value?: string) => {
    const s = (value ?? "").trim();
    if (!s || !mongoose.Types.ObjectId.isValid(s)) return undefined;
    return s;
  };
  const scope = {
    academicYearBs: payload.academicYearBs,
    session: payload.session,
    faculty: payload.faculty?.trim() || undefined,
    semesterBs: payload.semesterBs?.trim() || undefined,
    classId: oid(payload.classId),
    sectionId: oid(payload.sectionId),
    batchId: oid(payload.batchId),
    yearId: oid(payload.yearId),
    subjectId: payload.subjectId,
    teacherId: payload.teacherId,
    month: payload.month
  };

  const existing = await AcademicLogBook.findOne({
    schoolId: tenantObjectId(req),
    ...scope,
    isDeleted: false
  }).lean();

  if (existing) return existing._id;

  const created = await AcademicLogBook.create({
    schoolId: tenantObjectId(req),
    ...scope
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
  await syncSessionPlanProgress(plan._id.toString());
  const refreshedUnits = await AcademicSessionPlanUnit.find({ sessionPlanId: plan._id })
    .sort({ unitNo: 1 })
    .lean();
  const stats = await computeSessionPlanProgressStats(plan._id.toString());
  const displayUnits = refreshedUnits.length > 0 ? refreshedUnits : units;

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
    units: displayUnits.map((unit) => ({
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
    completedPercent: stats.completedPercent,
    remainingPercent: stats.remainingPercent,
    completedUnits: stats.completedUnits,
    remainingUnits: stats.remainingUnits,
    audit: formatAudit(plan),
    subject: plan.subjectId as unknown as { _id: string; name: string; code: string } | undefined,
    teacher: plan.teacherId as unknown as { _id: string; teacherCode: string; user?: { fullName: string } } | undefined
  };
};

export const serializeSyllabus = async (syllabusId: string) => {
  const plan = await AcademicSyllabus.findById(syllabusId)
    // masterSubjectId needed so teachers can match syllabus to assigned batch-instance subjects
    .populate("subjectId", "name code masterSubjectId")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  if (!plan) return null;

  const schoolId = plan.schoolId.toString();
  // Auto-migrate legacy flat units → Chapter → Unit → SubUnit (idempotent)
  await ensureSyllabusHierarchy(syllabusId, schoolId);
  try {
    const subjectId =
      plan.subjectId && typeof plan.subjectId === "object" && "_id" in plan.subjectId
        ? String((plan.subjectId as { _id: unknown })._id)
        : plan.subjectId
          ? String(plan.subjectId)
          : undefined;
    await syncSyllabusCompletionFromLogBook(plan.schoolId, syllabusId, subjectId);
  } catch (error) {
    console.error("[serializeSyllabus] log-book completion sync failed", syllabusId, error);
  }

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

  const subject = plan.subjectId as unknown as
    | {
        _id: string;
        name: string;
        code: string;
        masterSubjectId?: string | { toString(): string } | null;
      }
    | undefined;
  const subjectCode =
    (plan as { subjectCode?: string }).subjectCode || subject?.code || "";
  const subjectMasterId =
    subject?.masterSubjectId == null
      ? null
      : typeof subject.masterSubjectId === "object"
        ? subject.masterSubjectId.toString()
        : String(subject.masterSubjectId);

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
    teachingHoursCovered:
      stats.teachingHoursTotal > 0
        ? stats.teachingHoursCovered
        : Math.round(
            (completedPercent / 100) *
              ((Number((plan as { totalTheoryHours?: number }).totalTheoryHours) || 0) +
                (Number((plan as { totalPracticalHours?: number }).totalPracticalHours) || 0))
          ),
    remainingTeachingHours:
      stats.teachingHoursTotal > 0
        ? stats.remainingTeachingHours
        : Math.max(
            0,
            (Number((plan as { totalTheoryHours?: number }).totalTheoryHours) || 0) +
              (Number((plan as { totalPracticalHours?: number }).totalPracticalHours) || 0) -
              Math.round(
                (completedPercent / 100) *
                  ((Number((plan as { totalTheoryHours?: number }).totalTheoryHours) || 0) +
                    (Number((plan as { totalPracticalHours?: number }).totalPracticalHours) || 0))
              )
          ),
    audit: formatAudit(plan),
    subject: subject
      ? {
          _id: subject._id?.toString?.() ?? String(subject._id),
          name: subject.name,
          code: subject.code,
          masterSubjectId: subjectMasterId
        }
      : undefined,
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
      subUnitTitles: Array.isArray((item as { subUnitTitles?: string[] }).subUnitTitles)
        ? ((item as { subUnitTitles?: string[] }).subUnitTitles ?? [])
            .map((t) => String(t).trim())
            .filter(Boolean)
        : String((item as { subUnitTitle?: string }).subUnitTitle || "")
            .split(/[;\n|]+/)
            .map((t) => t.trim())
            .filter(Boolean),
      syllabusId: (item as { syllabusId?: { toString(): string } }).syllabusId?.toString?.() ?? "",
      syllabusChapterId:
        (item as { syllabusChapterId?: { toString(): string } }).syllabusChapterId?.toString?.() ?? "",
      syllabusUnitId:
        (item as { syllabusUnitId?: { toString(): string } }).syllabusUnitId?.toString?.() ?? "",
      syllabusSubUnitId:
        (item as { syllabusSubUnitId?: { toString(): string } }).syllabusSubUnitId?.toString?.() ?? "",
      syllabusSubUnitIds: Array.isArray(
        (item as { syllabusSubUnitIds?: Array<{ toString(): string } | string> }).syllabusSubUnitIds
      )
        ? (
            (item as { syllabusSubUnitIds?: Array<{ toString(): string } | string> })
              .syllabusSubUnitIds ?? []
          )
            .map((id) => (typeof id === "string" ? id : id?.toString?.() ?? ""))
            .filter(Boolean)
        : (() => {
            const one = (
              item as { syllabusSubUnitId?: { toString(): string } }
            ).syllabusSubUnitId?.toString?.();
            return one ? [one] : [];
          })(),
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

  const entryAny = entry as {
    subUnitTitle?: string;
    subUnitTitles?: string[];
    syllabusId?: { toString(): string };
    syllabusChapterId?: { toString(): string };
    syllabusUnitId?: { toString(): string };
    syllabusSubUnitId?: { toString(): string };
    syllabusSubUnitIds?: Array<string | { toString(): string }>;
  };
  const subUnitTitles = Array.isArray(entryAny.subUnitTitles)
    ? entryAny.subUnitTitles.map((t) => String(t).trim()).filter(Boolean)
    : String(entryAny.subUnitTitle || "")
        .split(/[;\n|]+/)
        .map((t) => t.trim())
        .filter(Boolean);
  const syllabusSubUnitIds = Array.isArray(entryAny.syllabusSubUnitIds)
    ? entryAny.syllabusSubUnitIds
        .map((id) => (typeof id === "string" ? id : id?.toString?.() ?? ""))
        .filter(Boolean)
    : entryAny.syllabusSubUnitId
      ? [entryAny.syllabusSubUnitId.toString()]
      : [];

  return {
    _id: entry._id.toString(),
    schoolId: entry.schoolId.toString(),
    logBookId: entry.logBookId?.toString(),
    lessonPlanId: entry.lessonPlanId?.toString(),
    lessonPlanItemId: entry.lessonPlanItemId?.toString(),
    sessionPlanUnitId: entry.sessionPlanUnitId?.toString(),
    subUnitTitle: entryAny.subUnitTitle ?? subUnitTitles.join("; "),
    subUnitTitles,
    syllabusId: entryAny.syllabusId?.toString?.() ?? "",
    syllabusChapterId: entryAny.syllabusChapterId?.toString?.() ?? "",
    syllabusUnitId: entryAny.syllabusUnitId?.toString?.() ?? "",
    syllabusSubUnitId: entryAny.syllabusSubUnitId?.toString?.() ?? "",
    syllabusSubUnitIds,
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

const roundPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const namedPercent = (percent: number) => ({
  percent: roundPct(percent),
  remainingPercent: roundPct(100 - roundPct(percent))
});

/** Join by stringified ObjectId so mixed string/ObjectId refs still resolve names. */
const lookupByStringId = (
  from: string,
  localField: string,
  as: string,
  project: Record<string, 1>
) => ({
  $lookup: {
    from,
    let: { local: `$${localField}` },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $gt: [{ $strLenCP: { $toString: { $ifNull: ["$$local", ""] } } }, 0] },
              {
                $eq: [
                  { $toString: "$_id" },
                  { $toString: { $ifNull: ["$$local", ""] } }
                ]
              }
            ]
          }
        }
      },
      { $project: project }
    ],
    as
  }
});

type SyllabusCompletionRow = {
  subjectId: string;
  subjectName: string;
  percent: number;
  remainingPercent: number;
};

const loadSyllabusCompletionRows = async (
  schoolId: mongoose.Types.ObjectId,
  filters: AcademicManagementFilters,
  allowedSubjectIds?: string[]
): Promise<SyllabusCompletionRow[]> => {
  const match: Record<string, unknown> = { schoolId, isDeleted: { $ne: true } };
  if (filters.academicYearBs) match.academicYearBs = filters.academicYearBs;
  if (filters.subjectId) {
    const ids = await expandCurriculumSubjectIds(schoolId, filters.subjectId);
    match.subjectId = ids.length === 1 ? ids[0] : { $in: ids };
  } else if (allowedSubjectIds?.length) {
    const allowed = new Set<string>(allowedSubjectIds.map(String));
    for (const id of allowedSubjectIds) {
      for (const sib of await expandCurriculumSubjectIds(schoolId, String(id))) {
        allowed.add(sib);
      }
    }
    match.subjectId = { $in: [...allowed] };
  }

  const syllabi = await AcademicSyllabus.find(match).select("_id subjectId").lean();
  if (syllabi.length === 0) return [];

  for (const syllabus of syllabi) {
    try {
      await syncSyllabusCompletionFromLogBook(
        schoolId,
        String(syllabus._id),
        syllabus.subjectId ? String(syllabus.subjectId) : undefined
      );
    } catch (error) {
      console.error(
        "[dashboard] syllabus completion sync failed",
        String(syllabus._id),
        error
      );
    }
  }

  const syllabusIds = syllabi.map((row) => row._id);
  const [subUnits, legacyUnits, subjectDocs] = await Promise.all([
    AcademicSyllabusSubUnit.find({ syllabusId: { $in: syllabusIds } })
      .select("syllabusId parentSubUnitId status")
      .lean(),
    AcademicSyllabusUnit.find({ syllabusId: { $in: syllabusIds } })
      .select("syllabusId status")
      .lean(),
    Subject.find({ _id: { $in: syllabi.map((row) => row.subjectId) } })
      .select("name code masterSubjectId")
      .lean()
  ]);

  const parentIds = new Set(
    subUnits
      .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
      .filter(Boolean)
  );
  const leavesBySyllabus = new Map<string, { total: number; done: number }>();
  for (const sub of subUnits) {
    if (parentIds.has(String(sub._id))) continue;
    const sid = String(sub.syllabusId);
    const bucket = leavesBySyllabus.get(sid) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (sub.status === "COMPLETED" || sub.status === "SKIPPED") bucket.done += 1;
    leavesBySyllabus.set(sid, bucket);
  }
  const hasHierarchy = new Set(leavesBySyllabus.keys());
  const legacyBySyllabus = new Map<string, { total: number; done: number }>();
  for (const unit of legacyUnits) {
    const sid = String(unit.syllabusId);
    if (hasHierarchy.has(sid)) continue;
    const bucket = legacyBySyllabus.get(sid) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (unit.status === "COMPLETED") bucket.done += 1;
    legacyBySyllabus.set(sid, bucket);
  }

  const subjectMeta = new Map(
    subjectDocs.map((subject) => {
      const name = String(subject.name || "").trim() || "Subject";
      const master = subject.masterSubjectId ? String(subject.masterSubjectId) : "";
      const code = String(subject.code || "").trim().toLowerCase();
      return [
        String(subject._id),
        {
          name,
          key: master
            ? `master:${master}`
            : code
              ? `code:${code}`
              : `name:${name.toLowerCase()}`
        }
      ] as const;
    })
  );

  const grouped = new Map<
    string,
    { subjectId: string; subjectName: string; percents: number[] }
  >();
  for (const syllabus of syllabi) {
    const sid = String(syllabus._id);
    const stats = leavesBySyllabus.get(sid) ?? legacyBySyllabus.get(sid);
    if (!stats || stats.total === 0) continue;
    const percent = roundPct((stats.done / stats.total) * 100);
    const subjectId = String(syllabus.subjectId);
    const meta = subjectMeta.get(subjectId);
    const subjectName = meta?.name ?? "Subject";
    const key = meta?.key ?? `id:${subjectId}`;
    const row = grouped.get(key) ?? { subjectId, subjectName, percents: [] };
    row.percents.push(percent);
    grouped.set(key, row);
  }

  return [...grouped.values()]
    .map((row) => {
      const percent = roundPct(
        row.percents.reduce((sum, n) => sum + n, 0) / Math.max(1, row.percents.length)
      );
      return {
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        ...namedPercent(percent)
      };
    })
    .sort((a, b) => b.percent - a.percent || a.subjectName.localeCompare(b.subjectName));
};

const emptyDashboard = (): AcademicManagementDashboard => ({
  totalSubjects: 0,
  totalSessionPlans: 0,
  totalLessonPlans: 0,
  todaysLogBooks: 0,
  approvedPlans: 0,
  pendingApprovals: 0,
  delayedLessonPlans: 0,
  syllabusCompletionPercent: 0,
  syllabusRemainingPercent: 100,
  teachersPendingLogBook: 0,
  teacherAlerts: [],
  monthlyProgress: [],
  teacherPerformance: [],
  subjectProgress: [],
  facultyProgress: [],
  syllabusCompletion: []
});

export const buildDashboard = async (
  req: Request,
  filters: AcademicManagementFilters
): Promise<AcademicManagementDashboard> => {
  try {
    return await buildDashboardInner(req, filters);
  } catch (error) {
    console.error("[buildDashboard] failed — returning empty dashboard:", error);
    // Prefer a usable UI over a hard 500 for teachers/admins
    return emptyDashboard();
  }
};

const buildDashboardInner = async (
  req: Request,
  filters: AcademicManagementFilters
): Promise<AcademicManagementDashboard> => {
  const baseFilter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, baseFilter, filters.subjectId);
  await applyTeacherScopeToFilter(req, baseFilter);
  const todayBs = getTodayBs();
  const schoolId = tenantObjectId(req);
  const teacherScope = await getTeacherScope(req);

  const liveSessionPlanIds = (
    await AcademicSessionPlan.find({
      schoolId,
      isDeleted: { $ne: true },
      ...(teacherScope ? { teacherId: teacherScope.teacherId } : {})
    })
      .select("_id")
      .lean()
  ).map((plan) => plan._id);

  const progressQuery: Record<string, unknown> = { schoolId };
  // `$in: []` matches nothing in MongoDB and zeros every dashboard graph.
  if (liveSessionPlanIds.length > 0) {
    progressQuery.sessionPlanId = { $in: liveSessionPlanIds };
  }
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
      ? Math.round(
          progressRows.reduce((sum, row) => sum + (Number(row.completedPercent) || 0), 0) /
            progressRows.length
        )
      : 0;
  const avgRemaining = Math.max(0, 100 - avgCompletion);

  const logDateBs = filters.dateFrom || todayBs;
  // Invalid BS date must not 500 the whole dashboard (treat as "no schedule day")
  let logDayOfWeek = -1;
  try {
    logDayOfWeek = getDayOfWeekFromBs(logDateBs);
  } catch {
    logDayOfWeek = -1;
  }
  const teachersWithLogToday = await AcademicLogBookEntry.distinct("teacherId", {
    schoolId,
    dateBs: logDateBs,
    isDeleted: false
  });
  const scheduledTeacherIds: Array<mongoose.Types.ObjectId | string> =
    logDayOfWeek >= 0
      ? await TimetableSlot.distinct("teacherId", { schoolId, dayOfWeek: logDayOfWeek })
      : [];
  const scheduledTeacherCount = scheduledTeacherIds.length;
  const scheduledLoggedCount = scheduledTeacherIds.filter((id) =>
    teachersWithLogToday.some((logged) => String(logged) === String(id))
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
    const isScheduled = scheduledTeacherIds.some((id) => String(id) === teacherScope.teacherId);
    const hasLog = teachersWithLogToday.some((id) => String(id) === teacherScope.teacherId);
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

  const monthlyMatch: Record<string, unknown> = { schoolId, isDeleted: { $ne: true } };
  if (teacherScope) monthlyMatch.teacherId = teacherScope.teacherId;
  if (filters.teacherId && !teacherScope) monthlyMatch.teacherId = filters.teacherId;
  if (filters.academicYearBs) monthlyMatch.academicYearBs = filters.academicYearBs;
  if (filters.subjectId) monthlyMatch.subjectId = filters.subjectId;

  const monthlyProgress = await AcademicLessonPlan.aggregate([
    { $match: monthlyMatch },
    { $group: { _id: "$month", planned: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } } } },
    { $sort: { _id: 1 } }
  ]);

  const teacherScopeSubjectIds = teacherScope?.subjectIds?.map(String);
  const [
    teacherPerformanceRows,
    subjectProgressRows,
    facultyProgressRows,
    syllabusCompletionRows
  ] = await Promise.all([
    AcademicProgress.aggregate<{
      _id: string;
      completionPercent: number;
      teacher?: { teacherCode?: string };
      user?: { fullName?: string };
    }>([
      { $match: progressQuery },
      {
        $group: {
          _id: { $toString: "$teacherId" },
          completionPercent: { $avg: "$completedPercent" }
        }
      },
      lookupByStringId("teachers", "_id", "teacher", { teacherCode: 1, user: 1 }),
      { $unwind: { path: "$teacher", preserveNullAndEmptyArrays: true } },
      lookupByStringId("users", "teacher.user", "user", { fullName: 1 }),
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      { $sort: { completionPercent: -1 } },
      { $limit: 25 }
    ]),
    AcademicProgress.aggregate<{
      _id: string;
      completionPercent: number;
      subject?: { name?: string; code?: string; masterSubjectId?: unknown };
    }>([
      { $match: progressQuery },
      {
        $group: {
          _id: { $toString: "$subjectId" },
          completionPercent: { $avg: "$completedPercent" }
        }
      },
      lookupByStringId("subjects", "_id", "subject", { name: 1, code: 1, masterSubjectId: 1 }),
      { $unwind: { path: "$subject", preserveNullAndEmptyArrays: true } },
      { $sort: { completionPercent: -1 } },
      { $limit: 40 }
    ]),
    AcademicSessionPlan.aggregate<{ _id: string; completionPercent: number }>([
      {
        $match: {
          schoolId,
          isDeleted: { $ne: true },
          ...(teacherScope ? { teacherId: teacherScope.teacherId } : {}),
          ...(filters.teacherId && !teacherScope ? { teacherId: filters.teacherId } : {}),
          ...(filters.academicYearBs ? { academicYearBs: filters.academicYearBs } : {}),
          ...(filters.subjectId ? { subjectId: progressQuery.subjectId } : {})
        }
      },
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
          _id: {
            $let: {
              vars: { raw: { $ifNull: ["$faculty", ""] } },
              in: {
                $cond: [{ $eq: [{ $trim: { input: "$$raw" } }, ""] }, "Unspecified", { $trim: { input: "$$raw" } }]
              }
            }
          },
          completionPercent: { $avg: { $ifNull: ["$progress.completedPercent", 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    loadSyllabusCompletionRows(schoolId, filters, teacherScopeSubjectIds)
  ]);

  const teacherPerformance = teacherPerformanceRows
    .filter((row) => row._id)
    .map((row) => {
      const pct = roundPct(Number(row.completionPercent) || 0);
      const teacherName =
        String(row.user?.fullName || "").trim() ||
        String(row.teacher?.teacherCode || "").trim() ||
        "Teacher";
      return {
        teacherId: String(row._id),
        teacherName,
        completionPercent: pct,
        remainingPercent: roundPct(100 - pct)
      };
    });

  const subjectGrouped = new Map<
    string,
    { subjectId: string; subjectName: string; percents: number[] }
  >();
  for (const row of subjectProgressRows) {
    if (!row._id) continue;
    const name = String(row.subject?.name || "").trim() || "Subject";
    const master = row.subject?.masterSubjectId ? String(row.subject.masterSubjectId) : "";
    const code = String(row.subject?.code || "").trim().toLowerCase();
    const key = master ? `master:${master}` : code ? `code:${code}` : `name:${name.toLowerCase()}`;
    const current = subjectGrouped.get(key) ?? {
      subjectId: String(row._id),
      subjectName: name,
      percents: []
    };
    current.percents.push(Number(row.completionPercent) || 0);
    subjectGrouped.set(key, current);
  }
  /**
   * The aggregation only knows subjects that already have progress rows. The
   * dashboard should show the whole curriculum — a subject nobody has planned
   * yet is exactly the one an administrator needs to see — so fold in every
   * active subject at 0% and tag each with its year for the faceted charts.
   */
  const curriculumSubjects = await Subject.find({
    schoolId,
    isActive: { $ne: false },
    ...((teacherScopeSubjectIds?.length ?? 0) > 0
      ? { _id: { $in: teacherScopeSubjectIds } }
      : {})
  })
    .select("_id name code masterSubjectId yearIds")
    .lean();
  const yearRows = await Year.find({ schoolId }).select("_id name level").lean();
  const yearById = new Map(
    yearRows.map((year) => [
      String(year._id),
      { label: String(year.name ?? ""), level: Number(year.level) || 0 }
    ])
  );
  /** Same identity key the progress rows use, so batch instances merge into one. */
  const curriculumKey = (subject: {
    name?: string;
    code?: string;
    masterSubjectId?: unknown;
  }): string => {
    const name = String(subject.name ?? "").trim() || "Subject";
    const master = subject.masterSubjectId ? String(subject.masterSubjectId) : "";
    const code = String(subject.code ?? "").trim().toLowerCase();
    return master ? `master:${master}` : code ? `code:${code}` : `name:${name.toLowerCase()}`;
  };
  const yearByKey = new Map<string, { label: string; level: number }>();
  for (const subject of curriculumSubjects) {
    const key = curriculumKey(subject);
    const ids = Array.isArray(subject.yearIds) ? subject.yearIds : [];
    for (const id of ids) {
      const year = yearById.get(String(id));
      // Lowest year wins when a subject is shared, so it lands in one facet only.
      if (!year || !year.level) continue;
      const current = yearByKey.get(key);
      if (!current || year.level < current.level) yearByKey.set(key, year);
    }
    if (!subjectGrouped.has(key)) {
      subjectGrouped.set(key, {
        subjectId: String(subject._id),
        subjectName: String(subject.name ?? "").trim() || "Subject",
        percents: []
      });
    }
  }

  const subjectProgress = [...subjectGrouped.entries()]
    .map(([key, row]) => {
      const pct =
        row.percents.length > 0
          ? roundPct(
              row.percents.reduce((sum, n) => sum + n, 0) / row.percents.length
            )
          : 0;
      const year = yearByKey.get(key);
      return {
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        yearLabel: year?.label,
        yearLevel: year?.level,
        completionPercent: pct,
        remainingPercent: roundPct(100 - pct)
      };
    })
    // Stable order: year, then name. Never by value — chart colors follow the
    // subject, so a re-sort must not repaint the series.
    .sort(
      (a, b) =>
        (a.yearLevel ?? 99) - (b.yearLevel ?? 99) ||
        a.subjectName.localeCompare(b.subjectName)
    );

  const facultyProgress = facultyProgressRows
    .filter((row) => row._id != null && String(row._id).trim() !== "")
    .map((row) => {
      const pct = roundPct(Number(row.completionPercent) || 0);
      return {
        faculty: String(row._id),
        completionPercent: pct,
        remainingPercent: roundPct(100 - pct)
      };
    });

  /** Year tags by subject name, so the syllabus chart facets like the others. */
  const yearByName = new Map(
    subjectProgress.map((row) => [
      row.subjectName.trim().toLowerCase(),
      { label: row.yearLabel, level: row.yearLevel }
    ])
  );
  const syllabusCompletion =
    syllabusCompletionRows.length > 0
      ? syllabusCompletionRows.map((row) => {
          const year = yearByName.get(String(row.subjectName ?? "").trim().toLowerCase());
          return { ...row, yearLabel: year?.label, yearLevel: year?.level };
        })
      : subjectProgress.map((row) => ({
          subjectName: row.subjectName,
          yearLabel: row.yearLabel,
          yearLevel: row.yearLevel,
          percent: row.completionPercent,
          remainingPercent: row.remainingPercent
        }));

  const syllabusAvg =
    syllabusCompletionRows.length > 0
      ? roundPct(
          syllabusCompletionRows.reduce((sum, row) => sum + row.percent, 0) /
            syllabusCompletionRows.length
        )
      : avgCompletion;

  return {
    totalSubjects: subjects,
    totalSessionPlans: sessionPlans,
    totalLessonPlans: lessonPlans,
    todaysLogBooks: logEntries,
    approvedPlans,
    pendingApprovals,
    delayedLessonPlans: delayedItems,
    syllabusCompletionPercent: syllabusAvg,
    syllabusRemainingPercent: roundPct(100 - syllabusAvg),
    teachersPendingLogBook,
    teacherAlerts: teacherAlerts.slice(0, 30),
    monthlyProgress: monthlyProgress
      .filter((row) => String(row._id || "").trim())
      .map((row) => ({
        month: String(row._id),
        planned: row.planned as number,
        completed: row.completed as number
      })),
    teacherPerformance,
    subjectProgress,
    facultyProgress,
    syllabusCompletion
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