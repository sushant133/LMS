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
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listTimetable = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;
  if (typeof req.query.batchId === "string") filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") filter.yearId = req.query.yearId;
  if (typeof req.query.academicYearBs === "string") filter.academicYearBs = req.query.academicYearBs;
  // Optional: only this teacher's periods (default for teachers is full group schedule)
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
    // No teacherId restriction unless mineOnly is set above
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    // Students only see their own class/section or batch/year timetable
    Object.assign(filter, buildStudentAcademicFilter(studentProfile, institutionType));
  }

  const slots = await TimetableSlot.find(filter)
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .populate("yearId", "name level")
    .populate("batchId", "name")
    .populate("classId", "name")
    .populate("sectionId", "name")
    .sort({ dayOfWeek: 1, periodNumber: 1 });

  return sendSuccess(res, "Timetable fetched", slots);
});

export const createTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.parse(req.body);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  validateTimetableScope(institutionType, payload);
  const schoolId = tenantObjectId(req);

  if (req.user?.role === "TEACHER") {
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

  await assertPercentageCompleteForTimetable(
    schoolId,
    payload.academicYearBs,
    payload.subjectId,
    group,
    college
  );

  let subjectAssignmentId = payload.subjectAssignmentId;
  if (!subjectAssignmentId) {
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

  const requireLink = await isTimetableAssignmentLinkRequired(schoolId);
  if (requireLink && !subjectAssignmentId) {
    throw new ApiError(
      400,
      "subjectAssignmentId is required: no active Subject Assignment found for this teacher, subject, and group"
    );
  }

  const slot = await TimetableSlot.create({
    ...payload,
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

  if (subjectId && academicYearBs) {
    await assertPercentageCompleteForTimetable(schoolId, academicYearBs, subjectId, group, college);
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