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
import { getSessionOption, withTransaction } from "../utils/transaction.js";
import {
  evaluateAttendanceAvailability,
  getAcademicGroupKey,
  getDailyAttendanceConfig,
  getDailyAttendanceSlots,
  getDayName,
  getDayOfWeekFromDate,
  getFallbackSlotForGroup,
  getFirstPeriodSlotForGroup,
  getHolidayForDate,
  getStudentCountByGroup,
  groupKeyFromScope,
  loadGroupLabels,
  recordDailyAttendanceLog,
  syncDailyAttendanceToSubject,
  validateDailyAttendanceStudents,
  type AcademicGroupScope
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
  const canWriteAsAdmin = canManageInstitution(req.user?.role ?? "");
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

  const studentCountMap = await getStudentCountByGroup(schoolId.toString(), college);

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

  const coveredKeys = new Set<string>();

  type AssignmentRow = {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
    className?: string;
    sectionName?: string;
    batchName?: string;
    yearName?: string;
    academicYearBs: string;
    dateBs: string;
    dayOfWeek: number;
    dayName: string;
    teacherId: string;
    teacherName: string;
    subjectId: string;
    subjectName: string;
    subjectCode?: string;
    timetableSlotId?: string;
    periodNumber: number;
    startTime: string;
    endTime: string;
    existingRecordId?: string;
    isLocked: boolean;
    isHoliday: boolean;
    holidayTitle?: string;
    isSubstituteSlot: boolean;
    firstPeriodTeacherName?: string;
    canAdminEdit: boolean;
    studentCount: number;
    isManualAssignment: boolean;
    canMark: boolean;
    availabilityMessage?: string;
  };

  const assignments: AssignmentRow[] = slotRows.map(
    ({ slot, className, sectionName, batchName, yearName, subject, teacherName, firstPeriodTeacherName, isSubstituteSlot }) => {
    const key = getAcademicGroupKey(slot, college);
    coveredKeys.add(key);
    const existing = existingMap.get(key);
    const studentCount = studentCountMap.get(key) ?? 0;
    const availability = evaluateAttendanceAvailability({
      dateBs,
      config,
      firstPeriodEndTime: slot.endTime,
      adminOverride,
      holidayTitle: holiday?.title
    });
    const isLocked = existing?.status === "LOCKED";
    const hasStudents = studentCount > 0;

    let availabilityMessage: string | undefined;
    if (!hasStudents) {
      availabilityMessage = "No students enrolled in this academic group.";
    } else if (isLocked) {
      availabilityMessage = canWriteAsAdmin
        ? "Attendance submitted. You can edit from History or reassign the teacher."
        : "Attendance already submitted for this class today.";
    } else if (isSubstituteSlot) {
      availabilityMessage = `Substitute marking — first-period teacher (${firstPeriodTeacherName ?? "N/A"}) has not submitted yet.`;
    } else {
      availabilityMessage = availability.message;
    }

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
      canAdminEdit: canWriteAsAdmin,
      studentCount,
      isManualAssignment: false,
      canMark: hasStudents && (canWriteAsAdmin ? !isLocked : availability.canMark && !isLocked),
      availabilityMessage
    };
  }
  );

  // Write-capable admins: surface enrolled groups that have no first-period slot today.
  if (canWriteAsAdmin) {
    const missingScopes: AcademicGroupScope[] = [];

    for (const [key, count] of studentCountMap.entries()) {
      if (count <= 0 || coveredKeys.has(key)) continue;
      const [left, right] = key.split("-");
      if (!left || !right) continue;
      missingScopes.push(college ? { batchId: left, yearId: right } : { classId: left, sectionId: right });
    }

    if (missingScopes.length) {
      const labels = await loadGroupLabels(missingScopes, college);

      for (const scope of missingScopes) {
        const key = groupKeyFromScope(scope, college);
        if (coveredKeys.has(key)) continue;
        coveredKeys.add(key);

        const studentCount = studentCountMap.get(key) ?? 0;
        const existing = existingMap.get(key);
        const isLocked = existing?.status === "LOCKED";
        const fallback = await getFallbackSlotForGroup(
          schoolId.toString(),
          school.academicYearBs,
          scope,
          college,
          dayOfWeek
        );

        let teacherName = "Assign teacher";
        let subjectName = "Daily register";
        let subjectCode: string | undefined;
        let teacherId = "";
        let subjectId = "";
        let startTime = config.startTime;
        let endTime = config.endTime;
        let periodNumber = 1;

        if (fallback) {
          teacherId = fallback.teacherId.toString();
          subjectId = fallback.subjectId.toString();
          startTime = fallback.startTime;
          endTime = fallback.endTime;
          periodNumber = fallback.periodNumber;
          const [teacher, subject] = await Promise.all([
            Teacher.findById(fallback.teacherId).populate("user", "fullName").lean(),
            (await import("../models/Subject.js")).Subject.findById(fallback.subjectId).lean()
          ]);
          teacherName = (teacher as { user?: { fullName?: string } } | null)?.user?.fullName ?? "Teacher";
          subjectName = subject?.name ?? "Subject";
          subjectCode = subject?.code;
        }

        const availability = evaluateAttendanceAvailability({
          dateBs,
          config,
          adminOverride: true,
          holidayTitle: holiday?.title
        });

        const hasStudents = studentCount > 0;
        let availabilityMessage: string | undefined;
        if (!hasStudents) {
          availabilityMessage = "No students enrolled in this academic group.";
        } else if (isLocked) {
          availabilityMessage = "Attendance submitted. You can edit from History or reassign the teacher.";
        } else if (!fallback) {
          availabilityMessage =
            "No timetable slot for this group. Assign a teacher below and mark attendance manually.";
        } else {
          availabilityMessage =
            "No first-period slot for this day. You can still mark daily attendance as administrator.";
        }

        assignments.push({
          classId: scope.classId,
          sectionId: scope.sectionId,
          batchId: scope.batchId,
          yearId: scope.yearId,
          className: scope.classId ? labels.classMap.get(scope.classId) : undefined,
          sectionName: scope.sectionId ? labels.sectionMap.get(scope.sectionId) : undefined,
          batchName: scope.batchId ? labels.batchMap.get(scope.batchId) : undefined,
          yearName: scope.yearId ? labels.yearMap.get(scope.yearId) : undefined,
          academicYearBs: school.academicYearBs,
          dateBs,
          dayOfWeek,
          dayName: getDayName(dayOfWeek),
          teacherId,
          teacherName,
          subjectId,
          subjectName,
          subjectCode,
          timetableSlotId: undefined as string | undefined,
          periodNumber,
          startTime,
          endTime,
          existingRecordId: existing?._id.toString(),
          isLocked,
          isHoliday: availability.isHoliday,
          holidayTitle: holiday?.title,
          isSubstituteSlot: false,
          firstPeriodTeacherName: teacherName,
          canAdminEdit: true,
          studentCount,
          isManualAssignment: true,
          canMark: hasStudents && !isLocked,
          availabilityMessage
        });
      }
    }
  }

  // Teachers: hide empty-roster slots that cannot be marked.
  const visibleAssignments = isAdminUser
    ? assignments
    : assignments.filter((item) => (item.studentCount ?? 0) > 0);

  return sendSuccess(res, "Daily attendance assignments fetched", visibleAssignments);
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
  const adminOverride = resolveAdminOverride(req, req.query.adminOverride === "true");

  let scope: AcademicGroupScope = {};
  let teacherId: string | undefined;
  let subjectId: string | undefined;
  let startTime: string | undefined;
  let endTime: string | undefined;
  let academicYearBs: string | undefined;
  let isManualAssignment = false;

  if (typeof timetableSlotId === "string" && mongoose.Types.ObjectId.isValid(timetableSlotId)) {
    const slot = await TimetableSlot.findOne({ _id: timetableSlotId, schoolId }).lean();
    if (!slot) {
      throw new ApiError(404, "Timetable slot not found");
    }

    await assertTeacherSlotAccess(req, slot, {
      adminOverride,
      forWrite: false,
      dateBs,
      schoolId: schoolId.toString(),
      college
    });

    scope = college
      ? { batchId: slot.batchId?.toString(), yearId: slot.yearId?.toString() }
      : { classId: slot.classId?.toString(), sectionId: slot.sectionId?.toString() };
    teacherId = slot.teacherId.toString();
    subjectId = slot.subjectId.toString();
    startTime = slot.startTime;
    endTime = slot.endTime;
    academicYearBs = slot.academicYearBs;
  } else {
    // Admin manual register: academic group without a first-period slot for the day.
    if (!adminOverride || !canManageInstitution(req.user?.role ?? "")) {
      throw new ApiError(400, "Timetable slot is required");
    }

    if (college) {
      if (typeof req.query.batchId !== "string" || typeof req.query.yearId !== "string") {
        throw new ApiError(400, "Batch and year are required for manual daily attendance");
      }
      scope = { batchId: req.query.batchId, yearId: req.query.yearId };
    } else {
      if (typeof req.query.classId !== "string" || typeof req.query.sectionId !== "string") {
        throw new ApiError(400, "Class and section are required for manual daily attendance");
      }
      scope = { classId: req.query.classId, sectionId: req.query.sectionId };
    }

    const school = await School.findById(schoolId).select("academicYearBs").lean();
    if (!school) {
      throw new ApiError(404, "Institution not found");
    }
    academicYearBs = school.academicYearBs;
    isManualAssignment = true;

    const fallback = await getFallbackSlotForGroup(
      schoolId.toString(),
      academicYearBs,
      scope,
      college,
      getDayOfWeekFromDate(dateBs)
    );
    if (fallback) {
      teacherId = fallback.teacherId.toString();
      subjectId = fallback.subjectId.toString();
      startTime = fallback.startTime;
      endTime = fallback.endTime;
    }
  }

  const studentFilter: Record<string, unknown> = { schoolId };
  if (college) {
    studentFilter.batchId = scope.batchId;
    studentFilter.yearId = scope.yearId;
  } else {
    studentFilter.classId = scope.classId;
    studentFilter.sectionId = scope.sectionId;
  }

  const config = await getDailyAttendanceConfig(schoolId.toString());
  const [students, teacher, existing, holiday] = await Promise.all([
    Student.find(studentFilter).populate("user", "fullName").sort({ rollNumber: 1 }).lean(),
    teacherId ? Teacher.findById(teacherId).populate("user", "fullName").lean() : Promise.resolve(null),
    DailyAttendance.findOne({
      schoolId,
      dateBs,
      ...(college
        ? { batchId: scope.batchId, yearId: scope.yearId }
        : { classId: scope.classId, sectionId: scope.sectionId })
    }).lean(),
    getHolidayForDate(schoolId.toString(), dateBs)
  ]);

  const availability = evaluateAttendanceAvailability({
    dateBs,
    config,
    firstPeriodEndTime: endTime,
    adminOverride,
    holidayTitle: holiday?.title
  });

  if (students.length === 0) {
    availability.canMark = false;
    availability.message = "No students are enrolled in this academic group.";
  }

  return sendSuccess(res, "Daily attendance context fetched", {
    dateBs,
    dayOfWeek: getDayOfWeekFromDate(dateBs),
    dayName: getDayName(getDayOfWeekFromDate(dateBs)),
    academicYearBs,
    teacherId,
    teacherName: (teacher as { user?: { fullName?: string } } | null)?.user?.fullName ?? (teacherId ? "Teacher" : "Assign teacher"),
    firstSubject: existing?.subjectId ?? subjectId,
    subjectId: existing?.subjectId?.toString() ?? subjectId,
    startTime: startTime ?? config.startTime,
    endTime: endTime ?? config.endTime,
    students: students.map((student) => ({
      _id: student._id.toString(),
      rollNumber: student.rollNumber,
      admissionNumber: student.admissionNumber,
      photoUrl: student.photoUrl,
      fullName: (student as { user?: { fullName?: string } }).user?.fullName ?? "Student"
    })),
    studentCount: students.length,
    existingRecord: existing,
    config,
    holiday,
    availability,
    isAdmin: adminOverride,
    isManualAssignment,
    scope
  });
});

export const submitDailyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const payload = dailyAttendanceSubmitSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  validateAttendanceScope(institutionType, payload);

  const schoolId = tenantObjectId(req);
  const adminOverride = resolveAdminOverride(req, payload.adminOverride);

  const school = await School.findById(schoolId).select("academicYearBs").lean();
  if (!school) {
    throw new ApiError(404, "Institution not found");
  }

  let slot: {
    _id: { toString(): string };
    classId?: { toString(): string } | null;
    sectionId?: { toString(): string } | null;
    batchId?: { toString(): string } | null;
    yearId?: { toString(): string } | null;
    teacherId: { toString(): string };
    subjectId: { toString(): string };
    academicYearBs: string;
    dayOfWeek: number;
    periodNumber: number;
    startTime: string;
    endTime: string;
  } | null = null;

  if (payload.timetableSlotId) {
    slot = await TimetableSlot.findOne({ _id: payload.timetableSlotId, schoolId }).lean();
    if (!slot) {
      throw new ApiError(400, "Invalid timetable slot");
    }

    await assertTeacherSlotAccess(req, slot, {
      adminOverride,
      forWrite: true,
      dateBs: payload.dateBs,
      schoolId: schoolId.toString(),
      college
    });
  } else {
    if (!adminOverride || !canManageInstitution(req.user?.role ?? "")) {
      throw new ApiError(403, "Only administrators can mark attendance without a timetable slot");
    }
    if (!payload.assignedTeacherId) {
      throw new ApiError(400, "Assign a teacher when marking attendance without a timetable slot");
    }
  }

  const scope: AcademicGroupScope = college
    ? {
        batchId: payload.batchId ?? slot?.batchId?.toString(),
        yearId: payload.yearId ?? slot?.yearId?.toString()
      }
    : {
        classId: payload.classId ?? slot?.classId?.toString(),
        sectionId: payload.sectionId ?? slot?.sectionId?.toString()
      };

  const firstPeriodSlot = slot
    ? await getFirstPeriodSlotForGroup(
        schoolId.toString(),
        slot.academicYearBs,
        slot.dayOfWeek,
        slot,
        college
      )
    : await getFallbackSlotForGroup(
        schoolId.toString(),
        school.academicYearBs,
        scope,
        college,
        getDayOfWeekFromDate(payload.dateBs)
      );

  const syncSubjectId =
    (payload as { subjectId?: string }).subjectId ??
    firstPeriodSlot?.subjectId?.toString() ??
    slot?.subjectId?.toString();

  if (!syncSubjectId) {
    throw new ApiError(
      400,
      "A subject is required to save daily attendance. Add a timetable slot or provide subjectId."
    );
  }

  const markingTeacherId = payload.assignedTeacherId ?? slot?.teacherId?.toString();
  if (!markingTeacherId) {
    throw new ApiError(400, "A teacher is required to mark daily attendance");
  }

  const [config, holiday] = await Promise.all([
    getDailyAttendanceConfig(schoolId.toString()),
    getHolidayForDate(schoolId.toString(), payload.dateBs)
  ]);

  const availability = evaluateAttendanceAvailability({
    dateBs: payload.dateBs,
    config,
    firstPeriodEndTime: slot?.endTime ?? firstPeriodSlot?.endTime,
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

  await validateDailyAttendanceStudents(schoolId.toString(), college, scope, payload.entries);

  const lookupFilter: Record<string, unknown> = {
    schoolId,
    dateBs: payload.dateBs
  };
  if (college) {
    lookupFilter.batchId = scope.batchId;
    lookupFilter.yearId = scope.yearId;
  } else {
    lookupFilter.classId = scope.classId;
    lookupFilter.sectionId = scope.sectionId;
  }

  const existing = await DailyAttendance.findOne(lookupFilter);
  if (existing?.status === "LOCKED") {
    throw new ApiError(409, "Attendance already submitted for this class today");
  }

  const recordId = await withTransaction(async (session: ClientSession | null) => {
    const dayOfWeek = getDayOfWeekFromDate(payload.dateBs);
    const doc = await DailyAttendance.findOneAndUpdate(
      lookupFilter,
      {
        schoolId,
        classId: scope.classId,
        sectionId: scope.sectionId,
        batchId: scope.batchId,
        yearId: scope.yearId,
        academicYearBs: slot?.academicYearBs ?? school.academicYearBs,
        dateBs: payload.dateBs,
        dayOfWeek,
        teacherId: markingTeacherId,
        subjectId: syncSubjectId,
        timetableSlotId: slot?._id,
        periodNumber: slot?.periodNumber ?? firstPeriodSlot?.periodNumber ?? 1,
        startTime: slot?.startTime ?? firstPeriodSlot?.startTime ?? config.startTime,
        endTime: slot?.endTime ?? firstPeriodSlot?.endTime ?? config.endTime,
        isSubstituteMarking: Boolean(slot && slot.periodNumber > 1),
        entries: payload.entries.map((entry) => ({
          studentId: entry.studentId,
          status: entry.status,
          remarks: entry.remarks ?? ""
        })),
        notes: payload.notes ?? "",
        status: "LOCKED",
        createdBy: req.user?.userId,
        submittedBy: req.user?.userId,
        submittedAt: new Date(),
        lastEditedBy: req.user?.userId
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, ...getSessionOption(session) }
    );

    if (!doc) {
      throw new ApiError(500, "Failed to save daily attendance");
    }

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

    return doc._id.toString();
  });

  const record = await DailyAttendance.findById(recordId);
  if (!record) {
    throw new ApiError(500, "Daily attendance was saved but could not be reloaded");
  }

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

    await record.save(getSessionOption(session));

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

    return record._id.toString();
  });

  const refreshed = await DailyAttendance.findById(updated);
  if (!refreshed) {
    throw new ApiError(500, "Daily attendance was updated but could not be reloaded");
  }

  await recordAudit(req, {
    action: "DAILY_ATTENDANCE_UPDATE",
    entity: "DailyAttendance",
    entityId: refreshed._id.toString(),
    after: refreshed.toObject()
  });

  return sendSuccess(res, "Daily attendance updated and synchronized", refreshed);
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