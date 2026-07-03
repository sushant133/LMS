import type { Request, Response } from "express";
import { attendanceSchema } from "@nepal-school-erp/shared";
import { Attendance } from "../models/Attendance.js";
import { Student } from "../models/Student.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { notifyParentsOfStudent } from "../utils/notificationService.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { assertTeacherQueryScope, assertTeacherSubjectClassSection, getTeacherScope } from "../utils/teacherScope.js";
import { Subject } from "../models/Subject.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

export const listAttendance = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = { schoolId: tenantObjectId(req) };

  if (typeof req.query.classId === "string") query.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") query.sectionId = req.query.sectionId;
  if (typeof req.query.subjectId === "string") query.subjectId = req.query.subjectId;
  if (typeof req.query.dateBs === "string") query.dateBs = req.query.dateBs;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    assertTeacherQueryScope(
      teacherScope,
      typeof req.query.classId === "string" ? req.query.classId : undefined,
      typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
      typeof req.query.subjectId === "string" ? req.query.subjectId : undefined
    );
    query.teacherId = teacherScope.teacherId;
    query.classId = typeof req.query.classId === "string" ? req.query.classId : { $in: teacherScope.classIds };
    query.sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : { $in: teacherScope.sectionIds };
    query.subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : { $in: teacherScope.subjectIds };
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    const enrolledSubjectIds = await Subject.find({
      schoolId: tenantObjectId(req),
      classIds: studentProfile.classId
    }).distinct("_id");

    query.classId = studentProfile.classId;
    query.sectionId = studentProfile.sectionId;
    query.subjectId =
      typeof req.query.subjectId === "string"
        ? req.query.subjectId
        : { $in: enrolledSubjectIds };
    query["entries.studentId"] = studentProfile.studentId;
  }

  const records = await Attendance.find(query).sort({ dateBs: -1 });

  if (studentProfile) {
    const scoped = records.map((record) => ({
      ...record.toObject(),
      entries: record.entries.filter((entry) => entry.studentId.toString() === studentProfile.studentId)
    }));
    return sendSuccess(res, "Attendance fetched", scoped);
  }

  return sendSuccess(res, "Attendance fetched", records);
});

export const upsertAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can mark attendance");
  }

  const payload = attendanceSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);

  const schoolId = tenantObjectId(req);
  const teacherScope = await assertTeacherSubjectClassSection(req, payload.subjectId, payload.classId, payload.sectionId);

  const studentsCount = await Student.countDocuments({
    _id: { $in: payload.entries.map((entry) => entry.studentId) },
    classId: payload.classId,
    sectionId: payload.sectionId,
    schoolId
  });

  if (studentsCount !== payload.entries.length) {
    throw new ApiError(400, "Attendance includes students outside the selected class/section");
  }

  const attendance = await Attendance.findOneAndUpdate(
    {
      schoolId,
      classId: payload.classId,
      sectionId: payload.sectionId,
      subjectId: payload.subjectId,
      dateBs: payload.dateBs
    },
    {
      ...payload,
      schoolId,
      teacherId: teacherScope.teacherId,
      createdBy: req.user?.userId
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  const absentEntries = payload.entries.filter((entry) => entry.status === "ABSENT");
  await Promise.all(
    absentEntries.map((entry) =>
      notifyParentsOfStudent(
        schoolId.toString(),
        entry.studentId,
        "Attendance alert",
        `Your child was marked absent in a subject class on ${payload.dateBs}.`,
        "ATTENDANCE",
        "BOTH"
      )
    )
  );

  return sendSuccess(res, "Attendance saved successfully", attendance);
});