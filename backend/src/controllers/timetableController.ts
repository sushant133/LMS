import type { Request, Response } from "express";
import { timetableSlotSchema } from "@nepal-school-erp/shared";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getStudentProfile } from "../utils/studentScope.js";
import {
  assertTeacherQueryScope,
  assertTeacherSubjectClassSection,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

export const listTimetable = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;
  if (typeof req.query.academicYearBs === "string") filter.academicYearBs = req.query.academicYearBs;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    filter.teacherId = teacherScope.teacherId;
    assertTeacherQueryScope(
      teacherScope,
      typeof req.query.classId === "string" ? req.query.classId : undefined,
      typeof req.query.sectionId === "string" ? req.query.sectionId : undefined
    );
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    filter.classId = studentProfile.classId;
    filter.sectionId = studentProfile.sectionId;
  }

  const slots = await TimetableSlot.find(filter)
    .populate("subjectId", "name code")
    .populate("teacherId")
    .sort({ dayOfWeek: 1, periodNumber: 1 });

  return sendSuccess(res, "Timetable fetched", slots);
});

export const createTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.parse(req.body);

  if (req.user?.role === "TEACHER") {
    const scope = await assertTeacherSubjectClassSection(req, payload.subjectId, payload.classId, payload.sectionId);
    if (payload.teacherId !== scope.teacherId) {
      throw new ApiError(403, "Teachers can only create timetable slots for themselves");
    }
  }

  const slot = await TimetableSlot.create({ ...payload, schoolId: req.tenantSchoolId });
  return sendSuccess(res, "Timetable slot created", slot, 201);
});

export const updateTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.partial().parse(req.body);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const existing = await TimetableSlot.findOne(withTenantScope(req, { _id: req.params.id })).lean();
    if (!existing || existing.teacherId?.toString() !== scope.teacherId) {
      throw new ApiError(403, "You can only update your own timetable slots");
    }
    if (payload.subjectId && payload.classId && payload.sectionId) {
      await assertTeacherSubjectClassSection(req, payload.subjectId, payload.classId, payload.sectionId);
    }
  }

  const slot = await TimetableSlot.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
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