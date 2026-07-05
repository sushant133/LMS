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
  assertTeacherQueryScope,
  assertTeacherSubjectAcademicScope,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

export const listTimetable = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;
  if (typeof req.query.batchId === "string") filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") filter.yearId = req.query.yearId;
  if (typeof req.query.academicYearBs === "string") filter.academicYearBs = req.query.academicYearBs;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    filter.teacherId = teacherScope.teacherId;
    assertTeacherQueryScope(teacherScope, {
      classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
      sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
      batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
      yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined,
      isCollege: college
    });
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    Object.assign(filter, buildStudentAcademicFilter(studentProfile, institutionType));
  }

  const slots = await TimetableSlot.find(filter)
    .populate("subjectId", "name code")
    .populate("teacherId")
    .sort({ dayOfWeek: 1, periodNumber: 1 });

  return sendSuccess(res, "Timetable fetched", slots);
});

export const createTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.parse(req.body);
  const institutionType = await getInstitutionType(req);
  validateTimetableScope(institutionType, payload);

  if (req.user?.role === "TEACHER") {
    const scope = await assertTeacherSubjectAcademicScope(req, payload.subjectId, payload);
    if (payload.teacherId !== scope.teacherId) {
      throw new ApiError(403, "Teachers can only create timetable slots for themselves");
    }
  }

  const slot = await TimetableSlot.create({ ...payload, schoolId: req.tenantSchoolId });
  return sendSuccess(res, "Timetable slot created", slot, 201);
});

export const updateTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  const payload = timetableSlotSchema.partial().parse(req.body);
  const institutionType = await getInstitutionType(req);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const existing = await TimetableSlot.findOne(withTenantScope(req, { _id: req.params.id })).lean();
    if (!existing || existing.teacherId?.toString() !== scope.teacherId) {
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