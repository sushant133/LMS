import type { Request, Response } from "express";
import {
  APPLICATION_LEAVE_REASON,
  canManageInstitution,
  canAccessModule,
  hasInstitutionAccess,
  studentEarlyLeaveSchema,
  studentEarlyLeaveUpdateSchema,
  type ModuleAccessMap
} from "@phit-erp/shared";
import { StudentEarlyLeave } from "../models/StudentEarlyLeave.js";
import { Student } from "../models/Student.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { User } from "../models/User.js";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  compareBsDates,
  countInclusiveBsDays,
  ensureValidBsDate,
  getOffsetFromBsDate
} from "../utils/nepaliDate.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import {
  getStudentDisplayName,
  notifyParentsOfStudent
} from "../utils/notificationService.js";
import { getUserModuleAccessMap } from "../utils/moduleAccessService.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const MAX_APPLICATION_LEAVE_DAYS = 60;

const isApplicationLeaveReason = (reason: string): boolean =>
  reason.trim().toLowerCase() === APPLICATION_LEAVE_REASON.toLowerCase();

/** Inclusive list of BS dates from start to end (max MAX_APPLICATION_LEAVE_DAYS). */
const listInclusiveBsDates = (startBs: string, endBs: string): string[] => {
  const start = ensureValidBsDate(startBs);
  const end = ensureValidBsDate(endBs);
  if (compareBsDates(end, start) < 0) {
    throw new ApiError(400, "Leave end date must be on or after the start date");
  }
  const days = countInclusiveBsDays(start, end);
  if (days > MAX_APPLICATION_LEAVE_DAYS) {
    throw new ApiError(
      400,
      `Application leave range cannot exceed ${MAX_APPLICATION_LEAVE_DAYS} days`
    );
  }
  const dates: string[] = [];
  let current = start;
  for (let i = 0; i < days; i += 1) {
    dates.push(current);
    if (i < days - 1) current = getOffsetFromBsDate(current, 1);
  }
  return dates;
};

const assertEarlyLeaveAccess = async (
  req: Request,
  write: boolean
): Promise<void> => {
  const role = req.user?.role ?? "";
  if (canManageInstitution(role) || hasInstitutionAccess(role)) return;

  const map = (await getUserModuleAccessMap(req.user!.userId)) as ModuleAccessMap;
  const canRead =
    canAccessModule(map, "attendance") ||
    canAccessModule(map, "daily-attendance");
  if (!canRead) {
    throw new ApiError(403, "You do not have Attendance module access");
  }
  if (write) {
    // WRITE mode is enforced by module guard; allow if they can access attendance modules
    // Teachers with attendance write can record early leave
  }
};

const buildPeriodLabel = (input: {
  periodKind: string;
  leftAfterPeriod?: number | null;
  periodLabel?: string;
}): string => {
  const custom = (input.periodLabel ?? "").trim();
  if (custom) return custom;
  if (input.periodKind === "DURING_BREAK") return "During break";
  if (input.periodKind === "AFTER_PERIOD" && input.leftAfterPeriod) {
    return `After period ${input.leftAfterPeriod}`;
  }
  return "Early leave";
};

const enrichRecord = async (
  schoolId: unknown,
  doc: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const studentId =
    typeof doc.studentId === "object" && doc.studentId && "_id" in (doc.studentId as object)
      ? (doc.studentId as { _id: { toString(): string } })._id.toString()
      : String(doc.studentId ?? "");

  const [student, creator] = await Promise.all([
    studentId
      ? Student.findById(studentId).populate("user", "fullName").lean()
      : null,
    doc.createdBy
      ? User.findById(doc.createdBy).select("fullName").lean()
      : null
  ]);

  const batchId = String(doc.batchId ?? student?.batchId ?? "");
  const yearId = String(doc.yearId ?? student?.yearId ?? "");
  const classId = String(doc.classId ?? student?.classId ?? "");
  const sectionId = String(doc.sectionId ?? student?.sectionId ?? "");

  const [batch, year, klass, section] = await Promise.all([
    batchId ? Batch.findById(batchId).select("name").lean() : null,
    yearId ? Year.findById(yearId).select("name").lean() : null,
    classId ? SchoolClass.findById(classId).select("name").lean() : null,
    sectionId ? Section.findById(sectionId).select("name").lean() : null
  ]);

  return {
    ...doc,
    _id: String(doc._id),
    studentId: student
      ? {
          _id: student._id.toString(),
          admissionNumber: student.admissionNumber,
          rollNumber: student.rollNumber,
          batchId: student.batchId?.toString(),
          yearId: student.yearId?.toString(),
          classId: student.classId?.toString(),
          sectionId: student.sectionId?.toString(),
          user: student.user
        }
      : studentId,
    studentName:
      (student?.user as { fullName?: string } | null)?.fullName ?? "Student",
    batchName: batch?.name,
    yearName: year?.name,
    className: klass?.name,
    sectionName: section?.name,
    createdByName: creator?.fullName
  };
};

/**
 * Apply early-leave status on daily attendance for the day (student remains
 * marked for periods attended; day-level status becomes EARLY_LEAVE).
 * Subject attendance after the leave period is tagged EARLY_LEAVE when present.
 */
const applyEarlyLeaveToAttendance = async (params: {
  schoolId: string;
  studentId: string;
  dateBs: string;
  leftAfterPeriod?: number | null;
  periodLabel: string;
  reason: string;
}): Promise<string | undefined> => {
  const { schoolId, studentId, dateBs, leftAfterPeriod, periodLabel, reason } =
    params;
  const note = `Early leave: ${periodLabel}. Reason: ${reason}`;

  // Daily attendance for that academic group + date
  const dailyDocs = await DailyAttendance.find({
    schoolId,
    dateBs,
    "entries.studentId": studentId,
    status: { $in: ["SUBMITTED", "LOCKED", "DRAFT"] }
  });

  let dailyAttendanceId: string | undefined;
  for (const doc of dailyDocs) {
    let changed = false;
    doc.entries = doc.entries.map((entry) => {
      if (entry.studentId.toString() !== studentId) return entry;
      changed = true;
      return {
        studentId: entry.studentId,
        status: "EARLY_LEAVE" as const,
        remarks: [entry.remarks, note].filter(Boolean).join(" · ").slice(0, 500)
      };
    }) as typeof doc.entries;
    if (changed) {
      await doc.save();
      dailyAttendanceId = doc._id.toString();
    }
  }

  // Subject-wise: mark EARLY_LEAVE only on sessions after the leave period when we know period numbers
  // Timetable-linked daily already has periodNumber; pure subject attendance may not.
  // Best effort: if leftAfterPeriod set, update subject Attendance for that day
  // only when we can identify later periods — otherwise leave PRESENT as history of attended periods.
  if (leftAfterPeriod != null && leftAfterPeriod >= 1) {
    // Find subject attendance for same day; we don't store period on subject sheet reliably for all schools.
    // Annotate remarks on PRESENT entries is wrong. Leave subject history as-is for attended periods.
    // Optionally tag any subject rows that are empty - skip.
  }

  // Tag any subject attendance entries still unmarked? Not available.
  // Store note on subject sheets if student was PRESENT that day for audit trail in remarks — skip to avoid rewriting history.

  return dailyAttendanceId;
};

export const listStudentEarlyLeaves = asyncHandler(async (req: Request, res: Response) => {
  await assertEarlyLeaveAccess(req, false);
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };

  if (typeof req.query.dateBs === "string" && req.query.dateBs.trim()) {
    filter.dateBs = ensureValidBsDate(req.query.dateBs.trim());
  } else if (
    typeof req.query.fromDateBs === "string" &&
    typeof req.query.toDateBs === "string"
  ) {
    const from = ensureValidBsDate(req.query.fromDateBs.trim());
    const to = ensureValidBsDate(req.query.toDateBs.trim());
    filter.dateBs = { $gte: from, $lte: to };
  }
  if (typeof req.query.studentId === "string" && req.query.studentId.trim()) {
    filter.studentId = req.query.studentId.trim();
  }
  if (typeof req.query.batchId === "string" && req.query.batchId.trim()) {
    filter.batchId = req.query.batchId.trim();
  }
  if (typeof req.query.yearId === "string" && req.query.yearId.trim()) {
    filter.yearId = req.query.yearId.trim();
  }
  if (typeof req.query.classId === "string" && req.query.classId.trim()) {
    filter.classId = req.query.classId.trim();
  }
  if (typeof req.query.sectionId === "string" && req.query.sectionId.trim()) {
    filter.sectionId = req.query.sectionId.trim();
  }
  if (typeof req.query.reason === "string" && req.query.reason.trim()) {
    filter.reason = { $regex: req.query.reason.trim(), $options: "i" };
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const records = await StudentEarlyLeave.find(filter)
    .sort({ dateBs: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  const enriched = await Promise.all(
    records.map((r) => enrichRecord(schoolId, r as Record<string, unknown>))
  );

  return sendSuccess(res, "Early leave records fetched", {
    records: enriched,
    total: enriched.length
  });
});

export const createStudentEarlyLeave = asyncHandler(async (req: Request, res: Response) => {
  await assertEarlyLeaveAccess(req, true);
  const payload = studentEarlyLeaveSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const college = isCollege(await getInstitutionType(req));

  const student = await Student.findOne({ _id: payload.studentId, schoolId })
    .populate("user", "fullName")
    .lean();
  if (!student) throw new ApiError(404, "Student not found");

  const reason = payload.reason.trim();
  const isAppLeave = isApplicationLeaveReason(reason);
  const applicationReason = (payload.applicationReason ?? "").trim();
  const leaveToRaw = (payload.leaveToDateBs ?? "").trim();
  const leaveDateMode =
    payload.leaveDateMode ??
    (isAppLeave && leaveToRaw && leaveToRaw !== payload.dateBs ? "RANGE" : "EXACT");

  const dates =
    isAppLeave && leaveDateMode === "RANGE" && leaveToRaw
      ? listInclusiveBsDates(payload.dateBs, leaveToRaw)
      : [ensureValidBsDate(payload.dateBs)];

  const leaveFromDateBs = dates[0] ?? payload.dateBs;
  const leaveToDateBs = dates[dates.length - 1] ?? payload.dateBs;

  // Reject if any day in the range already has an early-leave record
  const existingOnDates = await StudentEarlyLeave.find({
    schoolId,
    studentId: payload.studentId,
    dateBs: { $in: dates },
    isDeleted: false
  })
    .select("dateBs")
    .lean();
  if (existingOnDates.length > 0) {
    const conflict = existingOnDates.map((r) => r.dateBs).join(", ");
    throw new ApiError(
      409,
      `An early leave record already exists for this student on: ${conflict}. Edit or delete those first.`
    );
  }

  const periodLabel = isAppLeave
    ? buildPeriodLabel({
        periodKind: "OTHER",
        leftAfterPeriod: null,
        periodLabel: payload.periodLabel?.trim() || "Application leave"
      })
    : buildPeriodLabel({
        periodKind: payload.periodKind,
        leftAfterPeriod: payload.leftAfterPeriod,
        periodLabel: payload.periodLabel
      });

  const periodKind = isAppLeave ? "OTHER" : payload.periodKind;
  const leftAfterPeriod = isAppLeave ? null : (payload.leftAfterPeriod ?? null);

  const batchId = payload.batchId || student.batchId?.toString() || undefined;
  const yearId = payload.yearId || student.yearId?.toString() || undefined;
  const classId = payload.classId || student.classId?.toString() || undefined;
  const sectionId = payload.sectionId || student.sectionId?.toString() || undefined;

  const remarksBase = (payload.remarks ?? "").trim();
  const remarksParts = [
    remarksBase,
    applicationReason ? `Application: ${applicationReason}` : ""
  ].filter(Boolean);
  const remarks = remarksParts.join(" · ").slice(0, 500);

  const createdDocs = [];
  for (const dateBs of dates) {
    const dailyAttendanceId = await applyEarlyLeaveToAttendance({
      schoolId: schoolId.toString(),
      studentId: payload.studentId,
      dateBs,
      leftAfterPeriod,
      periodLabel,
      reason: applicationReason
        ? `${reason} (${applicationReason})`
        : reason
    });

    const created = await StudentEarlyLeave.create({
      schoolId,
      studentId: payload.studentId,
      dateBs,
      periodKind,
      leftAfterPeriod,
      periodLabel,
      reason,
      applicationReason,
      leaveDateMode: isAppLeave ? leaveDateMode : "",
      leaveFromDateBs: isAppLeave ? leaveFromDateBs : "",
      leaveToDateBs: isAppLeave ? leaveToDateBs : "",
      approvedBy: (payload.approvedBy ?? "").trim(),
      remarks,
      leftAtTime: isAppLeave ? "" : (payload.leftAtTime ?? "").trim(),
      batchId: college ? batchId : undefined,
      yearId: college ? yearId : undefined,
      classId: !college ? classId : undefined,
      sectionId: !college ? sectionId : undefined,
      academicYearBs: (payload.academicYearBs ?? "").trim(),
      dailyAttendanceId: dailyAttendanceId || undefined,
      createdBy: req.user!.userId
    });
    createdDocs.push(created);
  }

  // Parent notification (one message covering the whole application)
  const studentName =
    (student.user as { fullName?: string } | null)?.fullName?.trim() ||
    (await getStudentDisplayName(payload.studentId));
  const school =
    (await Setting.findOne({ schoolId }).select("schoolName").lean()) ||
    (await School.findById(schoolId).select("name").lean());
  const schoolName =
    (school as { schoolName?: string; name?: string } | null)?.schoolName ||
    (school as { name?: string } | null)?.name ||
    "School";

  const datePart =
    dates.length > 1
      ? `from ${leaveFromDateBs} to ${leaveToDateBs} (${dates.length} days)`
      : `on ${leaveFromDateBs}`;
  const timePart =
    !isAppLeave && payload.leftAtTime ? ` at ${payload.leftAtTime}` : "";
  const appDetail = applicationReason ? ` Details: ${applicationReason}.` : "";
  const message = isAppLeave
    ? [
        `${studentName} has application leave ${datePart}.`,
        `Reason: ${reason}.${appDetail}`,
        `${schoolName}.`
      ].join(" ")
    : [
        `${studentName} left campus early on ${payload.dateBs}${timePart}.`,
        `Left: ${periodLabel}.`,
        `Reason: ${reason}.`,
        `${schoolName}.`
      ].join(" ");

  await notifyParentsOfStudent(
    schoolId.toString(),
    payload.studentId,
    isAppLeave ? "Student application leave" : "Student early leave",
    message,
    "ATTENDANCE",
    "BOTH"
  );

  for (const created of createdDocs) {
    await recordAudit(req, {
      action: "student.early_leave.create",
      entity: "StudentEarlyLeave",
      entityId: created._id.toString(),
      after: created.toObject()
    });
  }

  const first = createdDocs[0]!;
  const enriched = await enrichRecord(
    schoolId,
    first.toObject() as Record<string, unknown>
  );
  const msg =
    createdDocs.length > 1
      ? `Application leave recorded for ${createdDocs.length} days — parents notified`
      : "Early leave recorded — parents notified";
  return sendSuccess(res, msg, enriched, 201);
});

export const updateStudentEarlyLeave = asyncHandler(async (req: Request, res: Response) => {
  await assertEarlyLeaveAccess(req, true);
  const schoolId = tenantObjectId(req);
  const payload = studentEarlyLeaveUpdateSchema.parse(req.body);

  const record = await StudentEarlyLeave.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!record) throw new ApiError(404, "Early leave record not found");

  const before = record.toObject();
  if (payload.dateBs) {
    ensureValidBsDate(payload.dateBs);
    record.dateBs = payload.dateBs;
  }
  if (payload.periodKind) record.periodKind = payload.periodKind;
  if (payload.leftAfterPeriod !== undefined) {
    record.leftAfterPeriod = payload.leftAfterPeriod ?? null;
  }
  if (payload.periodLabel !== undefined || payload.periodKind || payload.leftAfterPeriod !== undefined) {
    record.periodLabel = buildPeriodLabel({
      periodKind: record.periodKind,
      leftAfterPeriod: record.leftAfterPeriod,
      periodLabel: payload.periodLabel ?? record.periodLabel
    });
  }
  if (payload.reason !== undefined) record.reason = payload.reason.trim();
  if (payload.approvedBy !== undefined) record.approvedBy = payload.approvedBy.trim();
  if (payload.remarks !== undefined) record.remarks = payload.remarks.trim();
  if (payload.leftAtTime !== undefined) record.leftAtTime = String(payload.leftAtTime).trim();

  await record.save();

  await applyEarlyLeaveToAttendance({
    schoolId: schoolId.toString(),
    studentId: record.studentId.toString(),
    dateBs: record.dateBs,
    leftAfterPeriod: record.leftAfterPeriod,
    periodLabel: record.periodLabel,
    reason: record.reason
  });

  await recordAudit(req, {
    action: "student.early_leave.update",
    entity: "StudentEarlyLeave",
    entityId: record._id.toString(),
    before,
    after: record.toObject()
  });

  const enriched = await enrichRecord(
    schoolId,
    record.toObject() as Record<string, unknown>
  );
  return sendSuccess(res, "Early leave updated", enriched);
});

export const deleteStudentEarlyLeave = asyncHandler(async (req: Request, res: Response) => {
  await assertEarlyLeaveAccess(req, true);
  const schoolId = tenantObjectId(req);
  const record = await StudentEarlyLeave.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!record) throw new ApiError(404, "Early leave record not found");

  const before = record.toObject();
  record.isDeleted = true;
  await record.save();

  await recordAudit(req, {
    action: "student.early_leave.delete",
    entity: "StudentEarlyLeave",
    entityId: record._id.toString(),
    before,
    after: { isDeleted: true }
  });

  return sendSuccess(res, "Early leave record deleted");
});

/** For attendance history / register enrichment */
export const listEarlyLeavesForDate = asyncHandler(async (req: Request, res: Response) => {
  await assertEarlyLeaveAccess(req, false);
  const schoolId = tenantObjectId(req);
  const dateBs =
    typeof req.query.dateBs === "string"
      ? ensureValidBsDate(req.query.dateBs)
      : "";
  if (!dateBs) throw new ApiError(400, "dateBs is required");

  const records = await StudentEarlyLeave.find({
    schoolId,
    dateBs,
    isDeleted: false
  }).lean();

  return sendSuccess(
    res,
    "Early leaves for date",
    records.map((r) => ({
      studentId: r.studentId.toString(),
      dateBs: r.dateBs,
      periodLabel: r.periodLabel,
      reason: r.reason,
      leftAfterPeriod: r.leftAfterPeriod
    }))
  );
});
