import type { Request } from "express";
import mongoose from "mongoose";
import {
  canManageInstitution,
  hasInstitutionAccess,
  type AcademicManagementDashboard,
  type AcademicManagementFilters,
  type AcademicPlanStatus,
  type LessonPlanItemStatus
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
import { sendNotification, getSchoolIdFromRequest } from "./notificationService.js";
import { getTeacherScope, requireTeacherScope } from "./teacherScope.js";
import { tenantObjectId } from "./tenant.js";

const APPROVED_STATUSES: AcademicPlanStatus[] = ["APPROVED"];

export const isAcademicAdmin = (role: string): boolean => canManageInstitution(role);

export const canReadAllAcademicRecords = (role: string): boolean => hasInstitutionAccess(role);

export const buildAcademicFilter = (req: Request, query: AcademicManagementFilters): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    schoolId: tenantObjectId(req),
    isDeleted: false
  };

  if (query.academicYearBs) filter.academicYearBs = query.academicYearBs;
  if (query.session) filter.session = query.session;
  if (query.faculty) filter.faculty = query.faculty;
  if (query.semesterBs) filter.semesterBs = query.semesterBs;
  if (query.subjectId) filter.subjectId = query.subjectId;
  if (query.teacherId) filter.teacherId = query.teacherId;
  if (query.month) filter.month = query.month;
  if (query.classId) filter.classId = query.classId;
  if (query.sectionId) filter.sectionId = query.sectionId;
  if (query.batchId) filter.batchId = query.batchId;
  if (query.yearId) filter.yearId = query.yearId;
  if (query.status) filter.status = query.status;

  return filter;
};

export const applyTeacherScopeToFilter = async (req: Request, filter: Record<string, unknown>): Promise<void> => {
  const scope = await getTeacherScope(req);
  if (scope) {
    filter.teacherId = scope.teacherId;
  }
};

export const assertCanModifyPlan = (req: Request, status: AcademicPlanStatus, ownerTeacherId: string): void => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  if (isAcademicAdmin(req.user.role)) return;

  if (req.user.role !== "TEACHER") {
    throw new ApiError(403, "You do not have permission to modify this record");
  }

  if (ownerTeacherId !== req.user.userId && ownerTeacherId) {
    // ownerTeacherId is Teacher._id, need to compare via scope
  }
};

export const assertTeacherOwnership = async (req: Request, teacherId: string): Promise<void> => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (isAcademicAdmin(req.user.role)) return;

  const scope = await requireTeacherScope(req);
  if (scope.teacherId !== teacherId) {
    throw new ApiError(403, "You can only access your own academic records");
  }
};

export const assertEditableStatus = (status: AcademicPlanStatus): void => {
  if (APPROVED_STATUSES.includes(status)) {
    throw new ApiError(403, "Approved records cannot be modified. Contact an administrator to unlock.");
  }
};

export const recordApproval = async (
  req: Request,
  entityType: "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY",
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

const computeItemStatus = (estimated: number, completed: number, deadline?: string): LessonPlanItemStatus => {
  if (completed >= estimated && estimated > 0) return "COMPLETED";
  if (completed > 0) return "IN_PROGRESS";
  if (deadline) return "DELAYED";
  return "PENDING";
};

export const syncLessonPlanItemProgress = async (lessonPlanItemId: string): Promise<void> => {
  const item = await AcademicLessonPlanItem.findById(lessonPlanItemId);
  if (!item) return;

  const completed = await AcademicLogBookEntry.countDocuments({
    lessonPlanItemId: item._id,
    isDeleted: false,
    reviewStatus: { $in: ["REVIEWED", "APPROVED"] }
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
  const dayOfWeek = new Date().getDay();

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
      status: unit.status,
      attachmentUrl: unit.attachmentUrl
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

  const enrichedItems = items.map((item) => {
    const unit = item.sessionPlanUnitId ? unitMap.get(item.sessionPlanUnitId.toString()) : undefined;
    const completedPercent =
      item.estimatedClasses > 0 ? Math.round((item.completedClasses / item.estimatedClasses) * 100) : 0;

    return {
      _id: item._id.toString(),
      lessonPlanId: item.lessonPlanId.toString(),
      serialNo: item.serialNo,
      sessionPlanUnitId: item.sessionPlanUnitId?.toString(),
      subjectLabel: item.subjectLabel,
      plannedTopic: item.plannedTopic,
      description: item.description,
      learningObjectives: item.learningObjectives,
      teachingMethod: item.teachingMethod,
      teachingAids: item.teachingAids,
      assessmentMethod: item.assessmentMethod,
      deadline: item.deadline,
      estimatedClasses: item.estimatedClasses,
      completedClasses: item.completedClasses,
      completionStatus: item.completionStatus,
      remarks: item.remarks,
      completedPercent,
      unit: unit
        ? { _id: unit._id.toString(), unitNo: unit.unitNo, chapterName: unit.chapterName }
        : undefined
    };
  });

  const totalClasses = enrichedItems.reduce((sum, item) => sum + item.estimatedClasses, 0);
  const completedClasses = enrichedItems.reduce((sum, item) => sum + item.completedClasses, 0);
  const pendingUnits = enrichedItems.filter((item) => item.completionStatus === "PENDING").length;
  const delayedUnits = enrichedItems.filter((item) => item.completionStatus === "DELAYED").length;

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
    month: plan.month,
    status: plan.status,
    preparedBy: plan.preparedBy,
    checkedBy: plan.checkedBy,
    approvedByName: plan.approvedByName,
    approvalDate: plan.approvalDate,
    adminRemarks: plan.adminRemarks,
    items: enrichedItems,
    completedPercent: totalClasses > 0 ? Math.round((completedClasses / totalClasses) * 100) : 0,
    remainingPercent: totalClasses > 0 ? Math.round(((totalClasses - completedClasses) / totalClasses) * 100) : 100,
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

export const buildDashboard = async (req: Request, filters: AcademicManagementFilters): Promise<AcademicManagementDashboard> => {
  const baseFilter = buildAcademicFilter(req, filters);
  await applyTeacherScopeToFilter(req, baseFilter);

  const [sessionPlans, lessonPlans, logEntries, progressRows, subjects] = await Promise.all([
    AcademicSessionPlan.countDocuments(baseFilter),
    AcademicLessonPlan.countDocuments(baseFilter),
    AcademicLogBookEntry.countDocuments({
      ...baseFilter,
      dateBs: filters.dateFrom ?? new Date().toISOString().slice(0, 10)
    }),
    AcademicProgress.find({ schoolId: tenantObjectId(req) }).lean(),
    Subject.countDocuments({ schoolId: tenantObjectId(req), isActive: { $ne: false } })
  ]);

  const [pendingLessonApprovals, pendingSessionApprovals] = await Promise.all([
    AcademicLessonPlan.countDocuments({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } }),
    AcademicSessionPlan.countDocuments({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } })
  ]);
  const pendingApprovals = pendingLessonApprovals + pendingSessionApprovals;
  const approvedPlans = await AcademicLessonPlan.countDocuments({ ...baseFilter, status: "APPROVED" });
  const delayedLessonPlans = await AcademicLessonPlan.countDocuments({ ...baseFilter, status: "APPROVED" });

  const delayedItems = await AcademicLessonPlanItem.countDocuments({ completionStatus: "DELAYED", schoolId: tenantObjectId(req) });

  const avgCompletion =
    progressRows.length > 0
      ? Math.round(progressRows.reduce((sum, row) => sum + row.completedPercent, 0) / progressRows.length)
      : 0;

  const teachersWithLogToday = await AcademicLogBookEntry.distinct("teacherId", {
    schoolId: tenantObjectId(req),
    dateBs: filters.dateFrom,
    isDeleted: false
  });
  const allTeachers = await Teacher.countDocuments({ schoolId: tenantObjectId(req) });

  const monthlyProgress = await AcademicLessonPlan.aggregate([
    { $match: { schoolId: tenantObjectId(req), isDeleted: false } },
    { $group: { _id: "$month", planned: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } } } },
    { $sort: { _id: 1 } }
  ]);

  const teacherPerformance = await AcademicProgress.aggregate([
    { $match: { schoolId: tenantObjectId(req) } },
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
    { $match: { schoolId: tenantObjectId(req) } },
    { $group: { _id: "$subjectId", completionPercent: { $avg: "$completedPercent" } } },
    { $limit: 10 }
  ]);

  const subjectDocs = await Subject.find({ _id: { $in: subjectProgress.map((row) => row._id) } })
    .select("name")
    .lean();
  const subjectNameMap = new Map(subjectDocs.map((subject) => [subject._id.toString(), subject.name]));

  const facultyProgressRows = await AcademicSessionPlan.aggregate([
    { $match: { schoolId: tenantObjectId(req), isDeleted: false, faculty: { $exists: true, $ne: "" } } },
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
    delayedLessonPlans: delayedItems || delayedLessonPlans,
    syllabusCompletionPercent: avgCompletion,
    teachersPendingLogBook: Math.max(allTeachers - teachersWithLogToday.length, 0),
    monthlyProgress: monthlyProgress.map((row) => ({
      month: row._id as string,
      planned: row.planned as number,
      completed: row.completed as number
    })),
    teacherPerformance: teacherPerformance.map((row) => ({
      teacherId: row._id.toString(),
      teacherName: teacherNameMap.get(row._id.toString()) ?? "Teacher",
      completionPercent: Math.round(row.completionPercent as number)
    })),
    subjectProgress: subjectProgress.map((row) => ({
      subjectId: row._id.toString(),
      subjectName: subjectNameMap.get(row._id.toString()) ?? "Subject",
      completionPercent: Math.round(row.completionPercent as number)
    })),
    facultyProgress: facultyProgressRows.map((row) => ({
      faculty: row._id as string,
      completionPercent: Math.round((row.completionPercent as number) || 0)
    })),
    syllabusCompletion: subjectProgress.map((row) => ({
      subjectName: subjectNameMap.get(row._id.toString()) ?? "Subject",
      percent: Math.round(row.completionPercent as number)
    }))
  };
};

export const matchesKeyword = (keyword: string | undefined, values: Array<string | undefined | null>): boolean => {
  if (!keyword?.trim()) return true;
  const needle = keyword.trim().toLowerCase();
  return values.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
};

export const addAcademicComment = async (
  req: Request,
  entityType: "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY",
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