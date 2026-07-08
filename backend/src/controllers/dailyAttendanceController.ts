import type { Request, Response } from "express";
import {
  canManageInstitution,
  dailyAttendanceSubmitSchema,
  dailyAttendanceUnlockSchema,
  dailyAttendanceUpdateSchema,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isSystemAdministrator
} from "@phit-erp/shared";
import mongoose, { type ClientSession } from "mongoose";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { School } from "../models/School.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { validateAttendanceScope } from "../utils/academicValidation.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { notifyParentsOfStudent } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { withTransaction } from "../utils/transaction.js";
import {
  evaluateAttendanceAvailability,
  getAcademicGroupKey,
  getDailyAttendanceConfig,
  getDailyAttendanceSlots,
  getDayName,
  getDayOfWeekFromDate,
  getFirstPeriodSlotForGroup,
  getHolidayForDate,
  recordDailyAttendanceLog,
  syncDailyAttendanceToSubject,
  validateDailyAttendanceStudents
} from "../utils/dailyAttendanceUtils.js";
import {
  aggregateRecords,
  attendancePercentage,
  buildClassWiseSummary,
  buildDailyTrend,
  buildMonthlyTrend,
  buildStatusReport,
  buildStudentWiseReport,
  buildTeacherWiseSummary,
  buildWeeklyTrend,
  countEntryStatuses,
  loadAcademicLabels
} from "../utils/dailyAttendanceReports.js";
import { assertInstitutionRead } from "../utils/institutionAccess.js";

const requireObjectId = (value: string | string[] | undefined, label = "id"): void => {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `Invalid ${label}`);
  }
};

const assertDailyAttendanceReadAccess = async (req: Request): Promise<void> => {
  if (hasInstitutionAccess(req.user?.role ?? "")) {
    return;
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    return;
  }

  throw new ApiError(403, "You do not have permission to view daily attendance");
};

const buildAcademicFilter = (query: Request["query"], college: boolean): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (college) {
    if (typeof query.batchId === "string") filter.batchId = query.batchId;
    if (typeof query.yearId === "string") filter.yearId = query.yearId;
  } else {
    if (typeof query.classId === "string") filter.classId = query.classId;
    if (typeof query.sectionId === "string") filter.sectionId = query.sectionId;
  }
  return filter;
};

const resolveAdminOverride = (req: Request, explicit?: boolean): boolean =>
  Boolean(explicit) || isInstitutionAdmin(req.user?.role ?? "");

const assertTeacherSlotAccess = async (
  req: Request,
  slot: {
    teacherId: { toString(): string };
    periodNumber: number;
    classId?: { toString(): string } | null;
    sectionId?: { toString(): string } | null;
    batchId?: { toString(): string } | null;
    yearId?: { toString(): string } | null;
  },
  options: { adminOverride?: boolean; forWrite?: boolean; dateBs: string; schoolId: string; college: boolean }
) => {
  const role = req.user?.role ?? "";
  if (options.adminOverride) {
    if (options.forWrite) {
      if (canManageInstitution(role)) {
        return;
      }
    } else if (hasInstitutionAccess(role)) {
      return;
    }
  }

  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only assigned teachers can mark daily attendance");
  }

  const teacherScope = await getTeacherScope(req);
  if (!teacherScope || teacherScope.teacherId !== slot.teacherId.toString()) {
    throw new ApiError(403, "You are not assigned to this timetable slot");
  }

  if (slot.periodNumber === 1) {
    return;
  }

  const lookupFilter: Record<string, unknown> = {
    schoolId: options.schoolId,
    dateBs: options.dateBs,
    status: "LOCKED"
  };
  if (options.college) {
    lookupFilter.batchId = slot.batchId;
    lookupFilter.yearId = slot.yearId;
  } else {
    lookupFilter.classId = slot.classId;
    lookupFilter.sectionId = slot.sectionId;
  }

  const locked = await DailyAttendance.findOne(lookupFilter).lean();
  if (locked) {
    throw new ApiError(403, "Daily attendance has already been submitted for this class");
  }
};

export const listDailyAttendanceAssignments = asyncHandler(async (req: Request, res: Response) => {
  await assertDailyAttendanceReadAccess(req);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const school = await School.findById(schoolId).select("academicYearBs").lean();
  if (!school) {
    throw new ApiError(404, "Institution not found");
  }

  const dateBs = typeof req.query.dateBs === "string" ? ensureValidBsDate(req.query.dateBs) : getTodayBs();
  const dayOfWeek = getDayOfWeekFromDate(dateBs);
  const config = await getDailyAttendanceConfig(schoolId.toString());
  const holiday = await getHolidayForDate(schoolId.toString(), dateBs);
  const teacherScope = await getTeacherScope(req);
  const teacherId =
    req.user?.role === "TEACHER" && teacherScope
      ? teacherScope.teacherId
      : typeof req.query.teacherId === "string"
        ? req.query.teacherId
        : undefined;

  if (req.user?.role === "TEACHER" && !teacherId) {
    throw new ApiError(403, "Teacher profile not found");
  }

  const isAdminUser = hasInstitutionAccess(req.user?.role ?? "");
  const adminOverride = resolveAdminOverride(req, req.query.adminOverride === "true");

  const existingRecords = await DailyAttendance.find({
    schoolId,
    dateBs
  }).lean();

  const existingMap = new Map(
    existingRecords.map((record) => {
      const key = college
        ? `${record.batchId?.toString()}-${record.yearId?.toString()}`
        : `${record.classId?.toString()}-${record.sectionId?.toString()}`;
      return [key, record];
    })
  );

  const lockedGroupKeys = new Set(
    existingRecords.filter((record) => record.status === "LOCKED").map((record) =>
      college
        ? `${record.batchId?.toString()}-${record.yearId?.toString()}`
        : `${record.classId?.toString()}-${record.sectionId?.toString()}`
    )
  );

  const slotRows = await getDailyAttendanceSlots(
    schoolId.toString(),
    school.academicYearBs,
    dayOfWeek,
    college,
    {
      teacherId: isAdminUser ? undefined : teacherId,
      adminView: isAdminUser,
      lockedGroupKeys
    }
  );

  const assignments = slotRows.map(
    ({ slot, className, sectionName, batchName, yearName, subject, teacherName, firstPeriodTeacherName, isSubstituteSlot }) => {
    const key = getAcademicGroupKey(slot, college);
    const existing = existingMap.get(key);
    const availability = evaluateAttendanceAvailability({
      dateBs,
      config,
      firstPeriodEndTime: slot.endTime,
      adminOverride,
      holidayTitle: holiday?.title
    });
    const isLocked = existing?.status === "LOCKED";

    return {
      classId: slot.classId?.toString(),
      sectionId: slot.sectionId?.toString(),
      batchId: slot.batchId?.toString(),
      yearId: slot.yearId?.toString(),
      className,
      sectionName,
      batchName,
      yearName,
      academicYearBs: school.academicYearBs,
      dateBs,
      dayOfWeek,
      dayName: getDayName(dayOfWeek),
      teacherId: slot.teacherId.toString(),
      teacherName,
      subjectId: slot.subjectId.toString(),
      subjectName: subject?.name ?? "Subject",
      subjectCode: subject?.code,
      timetableSlotId: slot._id.toString(),
      periodNumber: slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      existingRecordId: existing?._id.toString(),
      isLocked,
      isHoliday: availability.isHoliday,
      holidayTitle: holiday?.title,
      isSubstituteSlot,
      firstPeriodTeacherName,
      canAdminEdit: isAdminUser,
      canMark: isAdminUser
        ? !isLocked
        : availability.canMark && !isLocked,
      availabilityMessage: isLocked
        ? isAdminUser
          ? "Attendance submitted. You can edit from History or reassign the teacher."
          : "Attendance already submitted for this class today."
        : isSubstituteSlot
          ? `Substitute marking — first-period teacher (${firstPeriodTeacherName ?? "N/A"}) has not submitted yet.`
          : availability.message
    };
  }
  );

  return sendSuccess(res, "Daily attendance assignments fetched", assignments);
});

export const listDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  await assertDailyAttendanceReadAccess(req);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const query: Record<string, unknown> = { schoolId, ...buildAcademicFilter(req.query, college) };

  if (typeof req.query.dateBs === "string") {
    query.dateBs = req.query.dateBs;
  } else if (typeof req.query.fromDateBs === "string" && typeof req.query.toDateBs === "string") {
    query.dateBs = {
      $gte: ensureValidBsDate(req.query.fromDateBs),
      $lte: ensureValidBsDate(req.query.toDateBs)
    };
  } else if (typeof req.query.monthBs === "string") {
    query.dateBs = { $regex: `^${req.query.monthBs}` };
  }
  if (typeof req.query.teacherId === "string") query.teacherId = req.query.teacherId;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    query.teacherId = teacherScope.teacherId;
    if (college) {
      query.batchId = typeof req.query.batchId === "string" ? req.query.batchId : { $in: teacherScope.batchIds };
      query.yearId = typeof req.query.yearId === "string" ? req.query.yearId : { $in: teacherScope.yearIds };
    } else {
      query.classId = typeof req.query.classId === "string" ? req.query.classId : { $in: teacherScope.classIds };
      query.sectionId =
        typeof req.query.sectionId === "string" ? req.query.sectionId : { $in: teacherScope.sectionIds };
    }
  }

  const records = await DailyAttendance.find(query).sort({ dateBs: -1, createdAt: -1 });
  return sendSuccess(res, "Daily attendance fetched", records);
});

export const getDailyAttendanceContext = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const timetableSlotId = req.query.timetableSlotId;
  const dateBs =
    typeof req.query.dateBs === "string" ? ensureValidBsDate(req.query.dateBs) : getTodayBs();

  if (typeof timetableSlotId !== "string") {
    throw new ApiError(400, "Timetable slot is required");
  }

  const slot = await TimetableSlot.findOne({ _id: timetableSlotId, schoolId }).lean();
  if (!slot) {
    throw new ApiError(404, "Timetable slot not found");
  }

  const adminOverride = resolveAdminOverride(req, req.query.adminOverride === "true");
  await assertTeacherSlotAccess(req, slot, {
    adminOverride,
    forWrite: false,
    dateBs,
    schoolId: schoolId.toString(),
    college
  });

  const studentFilter: Record<string, unknown> = { schoolId };
  if (college) {
    studentFilter.batchId = slot.batchId;
    studentFilter.yearId = slot.yearId;
  } else {
    studentFilter.classId = slot.classId;
    studentFilter.sectionId = slot.sectionId;
  }

  const [students, teacher, existing, config, holiday] = await Promise.all([
    Student.find(studentFilter).populate("user", "fullName").sort({ rollNumber: 1 }).lean(),
    Teacher.findById(slot.teacherId).populate("user", "fullName").lean(),
    DailyAttendance.findOne({
      schoolId,
      dateBs,
      ...(college
        ? { batchId: slot.batchId, yearId: slot.yearId }
        : { classId: slot.classId, sectionId: slot.sectionId })
    }).lean(),
    getDailyAttendanceConfig(schoolId.toString()),
    getHolidayForDate(schoolId.toString(), dateBs)
  ]);

  const availability = evaluateAttendanceAvailability({
    dateBs,
    config,
    firstPeriodEndTime: slot.endTime,
    adminOverride,
    holidayTitle: holiday?.title
  });

  return sendSuccess(res, "Daily attendance context fetched", {
    dateBs,
    dayOfWeek: getDayOfWeekFromDate(dateBs),
    dayName: getDayName(getDayOfWeekFromDate(dateBs)),
    academicYearBs: slot.academicYearBs,
    teacherName: (teacher as { user?: { fullName?: string } } | null)?.user?.fullName ?? "Teacher",
    firstSubject: existing?.subjectId ?? slot.subjectId,
    startTime: slot.startTime,
    endTime: slot.endTime,
    students: students.map((student) => ({
      _id: student._id.toString(),
      rollNumber: student.rollNumber,
      admissionNumber: student.admissionNumber,
      photoUrl: student.photoUrl,
      fullName: (student as { user?: { fullName?: string } }).user?.fullName ?? "Student"
    })),
    existingRecord: existing,
    config,
    holiday,
    availability,
    isAdmin: adminOverride
  });
});

export const submitDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = dailyAttendanceSubmitSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  validateAttendanceScope(institutionType, payload);

  const schoolId = tenantObjectId(req);
  const slot = await TimetableSlot.findOne({ _id: payload.timetableSlotId, schoolId }).lean();
  if (!slot) {
    throw new ApiError(400, "Invalid timetable slot");
  }

  const adminOverride = resolveAdminOverride(req, payload.adminOverride);
  await assertTeacherSlotAccess(req, slot, {
    adminOverride,
    forWrite: true,
    dateBs: payload.dateBs,
    schoolId: schoolId.toString(),
    college
  });

  const firstPeriodSlot = await getFirstPeriodSlotForGroup(
    schoolId.toString(),
    slot.academicYearBs,
    slot.dayOfWeek,
    slot,
    college
  );
  const syncSubjectId = firstPeriodSlot?.subjectId ?? slot.subjectId;
  const markingTeacherId = payload.assignedTeacherId ?? slot.teacherId;

  const [config, holiday] = await Promise.all([
    getDailyAttendanceConfig(schoolId.toString()),
    getHolidayForDate(schoolId.toString(), payload.dateBs)
  ]);

  const availability = evaluateAttendanceAvailability({
    dateBs: payload.dateBs,
    config,
    firstPeriodEndTime: slot.endTime,
    adminOverride,
    holidayTitle: holiday?.title
  });

  if (!availability.canMark) {
    throw new ApiError(400, availability.message ?? "Attendance is not available right now");
  }

  if (config.allowMedicalLeave === false) {
    const hasMedical = payload.entries.some((entry) => entry.status === "MEDICAL_LEAVE");
    if (hasMedical) {
      throw new ApiError(400, "Medical leave is disabled in attendance settings");
    }
  }

  await validateDailyAttendanceStudents(schoolId.toString(), college, payload, payload.entries);

  const lookupFilter: Record<string, unknown> = {
    schoolId,
    dateBs: payload.dateBs
  };
  if (college) {
    lookupFilter.batchId = payload.batchId ?? slot.batchId;
    lookupFilter.yearId = payload.yearId ?? slot.yearId;
  } else {
    lookupFilter.classId = payload.classId ?? slot.classId;
    lookupFilter.sectionId = payload.sectionId ?? slot.sectionId;
  }

  const existing = await DailyAttendance.findOne(lookupFilter);
  if (existing?.status === "LOCKED") {
    throw new ApiError(409, "Attendance already submitted for this class today");
  }

  const record = await withTransaction(async (session: ClientSession | null) => {
    const dayOfWeek = getDayOfWeekFromDate(payload.dateBs);
    const doc = await DailyAttendance.findOneAndUpdate(
      lookupFilter,
      {
        schoolId,
        classId: payload.classId ?? slot.classId,
        sectionId: payload.sectionId ?? slot.sectionId,
        batchId: payload.batchId ?? slot.batchId,
        yearId: payload.yearId ?? slot.yearId,
        academicYearBs: slot.academicYearBs,
        dateBs: payload.dateBs,
        dayOfWeek,
        teacherId: markingTeacherId,
        subjectId: syncSubjectId,
        timetableSlotId: slot._id,
        periodNumber: slot.periodNumber,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isSubstituteMarking: slot.periodNumber > 1,
        entries: payload.entries,
        notes: payload.notes ?? "",
        status: "LOCKED",
        createdBy: req.user?.userId,
        submittedBy: req.user?.userId,
        submittedAt: new Date(),
        lastEditedBy: req.user?.userId
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, session }
    );

    await recordDailyAttendanceLog(
      {
        schoolId: schoolId.toString(),
        dailyAttendanceId: doc._id.toString(),
        action: existing ? "UPDATE" : "SUBMIT",
        actorUserId: req.user!.userId,
        actorRole: req.user!.role,
        before: existing?.toObject() ?? null,
        after: doc.toObject(),
        synchronizationStatus: "PENDING"
      },
      session
    );

    await syncDailyAttendanceToSubject(
      {
        _id: doc._id.toString(),
        schoolId: schoolId.toString(),
        classId: doc.classId?.toString(),
        sectionId: doc.sectionId?.toString(),
        batchId: doc.batchId?.toString(),
        yearId: doc.yearId?.toString(),
        subjectId: doc.subjectId.toString(),
        teacherId: doc.teacherId.toString(),
        dateBs: doc.dateBs,
        entries: doc.entries.map((entry) => ({
          studentId: entry.studentId.toString(),
          status: entry.status
        })),
        createdBy: doc.createdBy.toString(),
        syncedAttendanceId: doc.syncedAttendanceId?.toString()
      },
      college,
      req.user!.userId,
      req.user!.role,
      session
    );

    return doc;
  });

  await recordAudit(req, {
    action: "DAILY_ATTENDANCE_SUBMIT",
    entity: "DailyAttendance",
    entityId: record._id.toString(),
    after: record.toObject()
  });

  const absentEntries = payload.entries.filter((entry) => entry.status === "ABSENT");
  await Promise.all(
    absentEntries.map((entry) =>
      notifyParentsOfStudent(
        schoolId.toString(),
        entry.studentId,
        "Daily attendance alert",
        `Your child was marked absent on ${payload.dateBs}.`,
        "ATTENDANCE",
        "BOTH"
      )
    )
  );

  return sendSuccess(res, "Daily attendance submitted and synchronized", record);
});

export const updateDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!isInstitutionAdmin(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can edit daily attendance");
  }

  requireObjectId(req.params.id);
  const payload = dailyAttendanceUpdateSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  validateAttendanceScope(institutionType, payload);

  const schoolId = tenantObjectId(req);
  const record = await DailyAttendance.findOne({ _id: req.params.id, schoolId });
  if (!record) {
    throw new ApiError(404, "Daily attendance record not found");
  }

  await validateDailyAttendanceStudents(schoolId.toString(), college, payload, payload.entries);

  const updated = await withTransaction(async (session: ClientSession | null) => {
    const before = record.toObject();
    record.set(
      "entries",
      payload.entries.map((entry) => ({
        studentId: entry.studentId,
        status: entry.status,
        remarks: entry.remarks ?? ""
      }))
    );
    record.notes = payload.notes ?? record.notes;
    record.lastEditedBy = req.user!.userId as never;
    record.status = "LOCKED";

    if (payload.teacherId && payload.teacherId !== record.teacherId.toString()) {
      record.reassignedFromTeacherId = record.teacherId;
      record.teacherId = payload.teacherId as never;
      record.teacherReassignReason = payload.teacherReassignReason ?? "Reassigned by administrator";
      await recordDailyAttendanceLog(
        {
          schoolId: schoolId.toString(),
          dailyAttendanceId: record._id.toString(),
          action: "REASSIGN",
          actorUserId: req.user!.userId,
          actorRole: req.user!.role,
          before: { teacherId: before.teacherId },
          after: { teacherId: payload.teacherId, reason: payload.teacherReassignReason },
          metadata: { reason: payload.teacherReassignReason }
        },
        session
      );
    }

    await record.save({ session });

    await recordDailyAttendanceLog(
      {
        schoolId: schoolId.toString(),
        dailyAttendanceId: record._id.toString(),
        action: "UPDATE",
        actorUserId: req.user!.userId,
        actorRole: req.user!.role,
        before,
        after: record.toObject()
      },
      session
    );

    await syncDailyAttendanceToSubject(
      {
        _id: record._id.toString(),
        schoolId: schoolId.toString(),
        classId: record.classId?.toString(),
        sectionId: record.sectionId?.toString(),
        batchId: record.batchId?.toString(),
        yearId: record.yearId?.toString(),
        subjectId: record.subjectId.toString(),
        teacherId: record.teacherId.toString(),
        dateBs: record.dateBs,
        entries: record.entries.map((entry) => ({
          studentId: entry.studentId.toString(),
          status: entry.status
        })),
        createdBy: record.createdBy.toString(),
        syncedAttendanceId: record.syncedAttendanceId?.toString()
      },
      college,
      req.user!.userId,
      req.user!.role,
      session
    );

    return record;
  });

  await recordAudit(req, {
    action: "DAILY_ATTENDANCE_UPDATE",
    entity: "DailyAttendance",
    entityId: updated._id.toString(),
    after: updated.toObject()
  });

  return sendSuccess(res, "Daily attendance updated and synchronized", updated);
});

export const unlockDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!isInstitutionAdmin(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can unlock daily attendance");
  }

  requireObjectId(req.params.id);
  const payload = dailyAttendanceUnlockSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const record = await DailyAttendance.findOne({ _id: req.params.id, schoolId });
  if (!record) {
    throw new ApiError(404, "Daily attendance record not found");
  }

  const before = record.toObject();
  record.status = "SUBMITTED";
  record.unlockedBy = req.user!.userId as never;
  record.unlockedAt = new Date();
  record.unlockReason = payload.reason;
  await record.save();

  await recordDailyAttendanceLog(
    {
      schoolId: schoolId.toString(),
      dailyAttendanceId: record._id.toString(),
      action: "UNLOCK",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      before,
      after: record.toObject(),
      metadata: { reason: payload.reason }
    },
    null
  );

  await recordAudit(req, {
    action: "DAILY_ATTENDANCE_UNLOCK",
    entity: "DailyAttendance",
    entityId: record._id.toString(),
    before,
    after: record.toObject()
  });

  return sendSuccess(res, "Daily attendance unlocked", record);
});

export const deleteDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!isSystemAdministrator(req.user?.role ?? "")) {
    throw new ApiError(403, "Only system administrators can delete daily attendance");
  }

  requireObjectId(req.params.id);
  const schoolId = tenantObjectId(req);
  const record = await DailyAttendance.findOne({ _id: req.params.id, schoolId });
  if (!record) {
    throw new ApiError(404, "Daily attendance record not found");
  }

  const before = record.toObject();
  await record.deleteOne();

  await recordDailyAttendanceLog(
    {
      schoolId: schoolId.toString(),
      dailyAttendanceId: record._id.toString(),
      action: "DELETE",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      before,
      after: null
    },
    null
  );

  await recordAudit(req, {
    action: "DAILY_ATTENDANCE_DELETE",
    entity: "DailyAttendance",
    entityId: record._id.toString(),
    before
  });

  return sendSuccess(res, "Daily attendance deleted", null);
});

export const getDailyAttendanceDashboard = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const dateBs = typeof req.query.dateBs === "string" ? ensureValidBsDate(req.query.dateBs) : getTodayBs();
  const filter: Record<string, unknown> = { schoolId };
  Object.assign(filter, buildAcademicFilter(req.query, college));

  const [todayRecords, recentRecords] = await Promise.all([
    DailyAttendance.find({ ...filter, dateBs }).lean(),
    DailyAttendance.find(filter).sort({ dateBs: -1 }).limit(365).lean()
  ]);

  const reportRecords = recentRecords as never;
  const today = aggregateRecords(todayRecords as never);
  const [classWise, teacherWise] = await Promise.all([
    buildClassWiseSummary(reportRecords, college),
    buildTeacherWiseSummary(reportRecords, college)
  ]);

  const dashboard = {
    totalStudents: today.total,
    presentToday: today.present,
    absentToday: today.absent,
    lateToday: today.late,
    leaveToday: today.leave,
    medicalLeaveToday: today.medicalLeave,
    attendancePercentage: attendancePercentage(today),
    dailyTrend: buildDailyTrend(reportRecords),
    weeklyTrend: buildWeeklyTrend(reportRecords),
    monthlyTrend: buildMonthlyTrend(reportRecords),
    classWise,
    teacherWise
  };

  return sendSuccess(res, "Daily attendance dashboard fetched", dashboard);
});

export const getDailyAttendanceById = asyncHandler(async (req: Request, res: Response) => {
  await assertDailyAttendanceReadAccess(req);
  requireObjectId(req.params.id);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const record = await DailyAttendance.findOne({ _id: req.params.id, schoolId }).lean();

  if (!record) {
    throw new ApiError(404, "Daily attendance record not found");
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope && teacherScope.teacherId !== record.teacherId.toString()) {
    throw new ApiError(403, "You do not have access to this attendance record");
  }

  const { labelForRecord, teacherMap } = await loadAcademicLabels([record as never], college);
  const studentIds = record.entries.map((entry) => entry.studentId);
  const students = await Student.find({ _id: { $in: studentIds }, schoolId })
    .populate("user", "fullName")
    .lean();
  const studentMap = new Map(
    students.map((student) => [
      student._id.toString(),
      {
        fullName: (student as { user?: { fullName?: string } }).user?.fullName ?? "Student",
        rollNumber: student.rollNumber,
        admissionNumber: student.admissionNumber,
        photoUrl: student.photoUrl
      }
    ])
  );

  const counts = countEntryStatuses(record.entries);

  return sendSuccess(res, "Daily attendance record fetched", {
    ...record,
    groupLabel: labelForRecord(record as never),
    teacherName: teacherMap.get(record.teacherId.toString()) ?? "Teacher",
    summary: counts,
    entries: record.entries.map((entry) => ({
      ...entry,
      studentId: entry.studentId.toString(),
      student: studentMap.get(entry.studentId.toString())
    }))
  });
});

export const getDailyAttendanceReports = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const reportType = typeof req.query.type === "string" ? req.query.type : "summary";
  const threshold = Number(req.query.threshold ?? 75);

  const filter: Record<string, unknown> = { schoolId };
  Object.assign(filter, buildAcademicFilter(req.query, college));

  if (typeof req.query.dateBs === "string") {
    filter.dateBs = ensureValidBsDate(req.query.dateBs);
  } else if (typeof req.query.monthBs === "string") {
    filter.dateBs = { $regex: `^${req.query.monthBs}` };
  } else if (typeof req.query.fromDateBs === "string" && typeof req.query.toDateBs === "string") {
    filter.dateBs = {
      $gte: ensureValidBsDate(req.query.fromDateBs),
      $lte: ensureValidBsDate(req.query.toDateBs)
    };
  }

  if (typeof req.query.teacherId === "string") {
    filter.teacherId = req.query.teacherId;
  }

  const records = await DailyAttendance.find(filter).sort({ dateBs: -1 }).lean();
  const reportRecords = records as never;

  if (reportType === "student" || reportType === "defaulter") {
    const rows = await buildStudentWiseReport(reportRecords, schoolId.toString(), threshold);
    return sendSuccess(res, "Student attendance report generated", {
      type: reportType,
      rows: reportType === "defaulter" ? rows.filter((row) => row.isDefaulter) : rows
    });
  }

  if (reportType === "leave") {
    return sendSuccess(res, "Leave report generated", {
      type: reportType,
      rows: buildStatusReport(reportRecords, "LEAVE")
    });
  }

  if (reportType === "late") {
    return sendSuccess(res, "Late arrival report generated", {
      type: reportType,
      rows: buildStatusReport(reportRecords, "LATE")
    });
  }

  if (reportType === "class") {
    return sendSuccess(res, "Class-wise report generated", {
      type: reportType,
      rows: await buildClassWiseSummary(reportRecords, college)
    });
  }

  const totals = aggregateRecords(reportRecords);
  return sendSuccess(res, "Daily attendance summary generated", {
    type: "summary",
    totals,
    attendancePercentage: attendancePercentage(totals),
    records: records.length,
    classWise: await buildClassWiseSummary(reportRecords, college),
    teacherWise: await buildTeacherWiseSummary(reportRecords, college)
  });
});

export const listDailyAttendanceLogs = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req);
  requireObjectId(req.params.id);

  const schoolId = tenantObjectId(req);
  const { DailyAttendanceLog } = await import("../models/DailyAttendanceLog.js");
  const logs = await DailyAttendanceLog.find({
    schoolId,
    dailyAttendanceId: req.params.id
  }).sort({ createdAt: -1 });

  return sendSuccess(res, "Daily attendance logs fetched", logs);
});