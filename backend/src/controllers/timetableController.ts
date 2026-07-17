import type { Request, Response } from "express";
import { timetableSlotSchema } from "@phit-erp/shared";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { validateTimetableScope } from "../utils/academicValidation.js";
import { buildStudentAcademicFilter } from "../utils/academicScope.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getStudentProfile } from "../utils/studentScope.js";
import {
  assertPercentageCompleteForTimetable,
  findMatchingAssignment,
  isTimetableAssignmentLinkRequired
} from "../utils/subjectAssignmentService.js";
import {
  assertTeacherSubjectAcademicScope,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { assertNoTimetableConflicts } from "../utils/timetableConflicts.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const isSoftSession = (sessionType?: string) =>
  sessionType === "BREAK" || sessionType === "HOLIDAY";

export const listTimetable = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const institutionType = await getInstitutionType(req);

  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;
  if (typeof req.query.batchId === "string") filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") filter.yearId = req.query.yearId;
  if (typeof req.query.academicYearBs === "string") {
    filter.academicYearBs = req.query.academicYearBs;
  }
  if (typeof req.query.teacherId === "string" && req.query.teacherId.trim()) {
    filter.teacherId = req.query.teacherId.trim();
  }
  if (typeof req.query.subjectId === "string" && req.query.subjectId.trim()) {
    filter.subjectId = req.query.subjectId.trim();
  }
  if (typeof req.query.room === "string" && req.query.room.trim()) {
    filter.room = { $regex: new RegExp(`^${req.query.room.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
  }
  if (typeof req.query.dayOfWeek === "string" && req.query.dayOfWeek !== "") {
    const day = Number(req.query.dayOfWeek);
    if (!Number.isNaN(day)) filter.dayOfWeek = day;
  }
  if (typeof req.query.sessionType === "string" && req.query.sessionType.trim()) {
    filter.sessionType = req.query.sessionType.trim();
  }
  if (req.query.mineOnly === "true" || req.query.mineOnly === "1") {
    const teacherScope = await getTeacherScope(req);
    if (teacherScope) filter.teacherId = teacherScope.teacherId;
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    /**
     * Teachers may view full weekly schedules for all years (every teacher's slots),
     * not only periods they teach — so they can see complete 1st/2nd/3rd year tables.
     * Optional query filters (batchId/yearId) still apply when provided.
     */
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    Object.assign(filter, buildStudentAcademicFilter(studentProfile, institutionType));
  }

  // Lab-only view: practical sessions or room name containing "lab"
  if (req.query.labOnly === "true" || req.query.labOnly === "1") {
    filter.$or = [
      { sessionType: "PRACTICAL" },
      { roomKind: "LABORATORY" },
      { room: { $regex: /lab/i } }
    ];
  }

  const slots = await TimetableSlot.find(filter)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .populate("yearId", "name level")
    .populate("batchId", "name")
    .populate("classId", "name")
    .populate("sectionId", "name")
    .sort({ dayOfWeek: 1, periodNumber: 1, startTime: 1 });

  return sendSuccess(res, "Timetable fetched", slots);
});

export const createTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.parse(req.body);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  validateTimetableScope(institutionType, payload);
  const schoolId = tenantObjectId(req);
  const sessionType = payload.sessionType ?? "THEORY";
  const soft = isSoftSession(sessionType);

  if (req.user?.role === "TEACHER") {
    if (soft) {
      throw new ApiError(403, "Teachers cannot create break or holiday periods");
    }
    if (!payload.subjectId || !payload.teacherId) {
      throw new ApiError(400, "Subject and teacher are required");
    }
    const scope = await assertTeacherSubjectAcademicScope(req, payload.subjectId, payload);
    if (payload.teacherId !== scope.teacherId) {
      throw new ApiError(403, "Teachers can only create timetable slots for themselves");
    }
  }

  const group = {
    classId: payload.classId,
    sectionId: payload.sectionId,
    batchId: payload.batchId,
    yearId: payload.yearId
  };

  if (!soft && payload.subjectId) {
    await assertPercentageCompleteForTimetable(
      schoolId,
      payload.academicYearBs,
      payload.subjectId,
      group,
      college
    );
  }

  let subjectAssignmentId = payload.subjectAssignmentId;
  if (!soft && payload.subjectId && payload.teacherId && !subjectAssignmentId) {
    const match = await findMatchingAssignment(
      schoolId,
      payload.academicYearBs,
      payload.teacherId,
      payload.subjectId,
      group,
      college
    );
    if (match) {
      subjectAssignmentId = match._id.toString();
    }
  }

  if (!soft) {
    const requireLink = await isTimetableAssignmentLinkRequired(schoolId);
    if (requireLink && !subjectAssignmentId) {
      throw new ApiError(
        400,
        "subjectAssignmentId is required: no active Subject Assignment found for this teacher, subject, and group"
      );
    }
  }

  if (payload.teacherId || payload.room) {
    await assertNoTimetableConflicts({
      schoolId,
      academicYearBs: payload.academicYearBs,
      dayOfWeek: payload.dayOfWeek,
      periodNumber: payload.periodNumber,
      startTime: payload.startTime,
      endTime: payload.endTime,
      teacherId: payload.teacherId ?? "",
      subjectId: payload.subjectId,
      room: payload.room,
      roomKind: payload.roomKind,
      sessionType,
      classId: payload.classId,
      sectionId: payload.sectionId,
      batchId: payload.batchId,
      yearId: payload.yearId
    });
  } else {
    // Still check group conflicts for breaks
    await assertNoTimetableConflicts({
      schoolId,
      academicYearBs: payload.academicYearBs,
      dayOfWeek: payload.dayOfWeek,
      periodNumber: payload.periodNumber,
      startTime: payload.startTime,
      endTime: payload.endTime,
      teacherId: "",
      room: payload.room,
      roomKind: payload.roomKind,
      sessionType,
      classId: payload.classId,
      sectionId: payload.sectionId,
      batchId: payload.batchId,
      yearId: payload.yearId
    });
  }

  const slot = await TimetableSlot.create({
    ...payload,
    sessionType,
    subjectId: payload.subjectId || undefined,
    teacherId: payload.teacherId || undefined,
    subjectAssignmentId: subjectAssignmentId || null,
    schoolId: req.tenantSchoolId
  });
  return sendSuccess(res, "Timetable slot created", slot, 201);
});

export const updateTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.partial().parse(req.body);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const schoolId = tenantObjectId(req);

  const existing = await TimetableSlot.findOne(withTenantScope(req, { _id: req.params.id })).lean();
  if (!existing) throw new ApiError(404, "Timetable slot not found");

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (existing.teacherId?.toString() !== scope.teacherId) {
      throw new ApiError(403, "You can only update your own timetable slots");
    }
    if (payload.subjectId) {
      await assertTeacherSubjectAcademicScope(req, payload.subjectId, {
        classId: payload.classId ?? existing.classId?.toString(),
        sectionId: payload.sectionId ?? existing.sectionId?.toString(),
        batchId: payload.batchId ?? existing.batchId?.toString(),
        yearId: payload.yearId ?? existing.yearId?.toString()
      });
    }
    validateTimetableScope(institutionType, {
      classId: payload.classId ?? existing.classId?.toString(),
      sectionId: payload.sectionId ?? existing.sectionId?.toString(),
      batchId: payload.batchId ?? existing.batchId?.toString(),
      yearId: payload.yearId ?? existing.yearId?.toString()
    });
  }

  const subjectId = payload.subjectId ?? existing.subjectId?.toString();
  const academicYearBs = payload.academicYearBs ?? existing.academicYearBs;
  const group = {
    classId: payload.classId ?? existing.classId?.toString(),
    sectionId: payload.sectionId ?? existing.sectionId?.toString(),
    batchId: payload.batchId ?? existing.batchId?.toString(),
    yearId: payload.yearId ?? existing.yearId?.toString()
  };
  const sessionType =
    payload.sessionType ?? (existing as { sessionType?: string }).sessionType ?? "THEORY";
  const soft = isSoftSession(sessionType);

  if (!soft && subjectId && academicYearBs) {
    await assertPercentageCompleteForTimetable(schoolId, academicYearBs, subjectId, group, college);
  }

  const nextDay = payload.dayOfWeek ?? existing.dayOfWeek;
  const nextPeriod = payload.periodNumber ?? existing.periodNumber;
  const nextStart = payload.startTime ?? existing.startTime;
  const nextEnd = payload.endTime ?? existing.endTime;
  const nextTeacher =
    payload.teacherId !== undefined
      ? payload.teacherId || ""
      : (existing.teacherId?.toString() ?? "");
  const nextRoom =
    payload.room !== undefined ? payload.room || undefined : (existing.room ?? undefined);
  const nextRoomKind =
    payload.roomKind ?? (existing as { roomKind?: string }).roomKind;

  // Skip conflict checks when schedule placement is unchanged (subject/remarks-only edits)
  const scheduleChanged =
    nextDay !== existing.dayOfWeek ||
    nextPeriod !== existing.periodNumber ||
    nextStart !== existing.startTime ||
    nextEnd !== existing.endTime ||
    nextTeacher !== (existing.teacherId?.toString() ?? "") ||
    (nextRoom ?? "").trim().toLowerCase() !== (existing.room ?? "").trim().toLowerCase() ||
    (group.batchId ?? "") !== (existing.batchId?.toString() ?? "") ||
    (group.yearId ?? "") !== (existing.yearId?.toString() ?? "") ||
    (group.classId ?? "") !== (existing.classId?.toString() ?? "") ||
    (group.sectionId ?? "") !== (existing.sectionId?.toString() ?? "");

  if (scheduleChanged) {
    await assertNoTimetableConflicts({
      schoolId,
      academicYearBs: academicYearBs ?? "",
      dayOfWeek: nextDay,
      periodNumber: nextPeriod,
      startTime: nextStart,
      endTime: nextEnd,
      teacherId: nextTeacher,
      subjectId,
      room: nextRoom,
      roomKind: nextRoomKind,
      sessionType,
      classId: group.classId,
      sectionId: group.sectionId,
      batchId: group.batchId,
      yearId: group.yearId,
      excludeId: existing._id.toString()
    });
  }

  const slot = await TimetableSlot.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, {
    new: true
  });
  if (!slot) throw new ApiError(404, "Timetable slot not found");
  return sendSuccess(res, "Timetable slot updated", slot);
});

export const deleteTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const existing = await TimetableSlot.findOne(withTenantScope(req, { _id: req.params.id })).lean();
    if (!existing || existing.teacherId?.toString() !== scope.teacherId) {
      throw new ApiError(403, "You can only delete your own timetable slots");
    }
  }

  const slot = await TimetableSlot.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!slot) throw new ApiError(404, "Timetable slot not found");
  return sendSuccess(res, "Timetable slot deleted");
});
