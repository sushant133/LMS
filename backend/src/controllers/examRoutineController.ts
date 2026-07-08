import type { Request, Response } from "express";
import { examRoutineSchema } from "@phit-erp/shared";
import { Exam } from "../models/Exam.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { sendNotification, getSchoolIdFromRequest } from "../utils/notificationService.js";
import { assertInstitutionWrite } from "../utils/institutionAccess.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { isCollege, getInstitutionType } from "../utils/institution.js";

const getExamOrThrow = async (req: Request, examId: string) => {
  const exam = await Exam.findOne(withTenantScope(req, { _id: examId }));
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }
  return exam;
};

export const listExamRoutines = asyncHandler(async (req: Request, res: Response) => {
  const examId = typeof req.query.examId === "string" ? req.query.examId : undefined;
  const filter: Record<string, unknown> = withTenantScope(req);
  if (examId) {
    filter.examId = examId;
  }

  const teacherScope = await getTeacherScope(req);
  const studentProfile = await getStudentProfile(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  let routines = await ExamRoutine.find(filter).sort({ examDateBs: 1, startTime: 1 }).lean();

  if (examId) {
    const exam = await Exam.findOne(withTenantScope(req, { _id: examId })).lean();
    if (!exam) {
      throw new ApiError(404, "Exam not found");
    }

    if (studentProfile || req.user?.role === "PARENT") {
      if (!exam.routinePublished) {
        return sendSuccess(res, "Exam routines fetched", []);
      }
    }

    if (teacherScope) {
      routines = routines.filter((routine) => teacherScope.subjectIds.includes(routine.subjectId.toString()));
    }
  }

  if (studentProfile && examId) {
    routines = routines;
  }

  const subjectIds = [...new Set(routines.map((routine) => routine.subjectId.toString()))];
  const subjects = await Subject.find({ _id: { $in: subjectIds }, schoolId: tenantObjectId(req) }).lean();
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject]));

  const enriched = routines.map((routine) => ({
    ...routine,
    subjectName: subjectMap.get(routine.subjectId.toString())?.name ?? "Subject",
    subjectCode: subjectMap.get(routine.subjectId.toString())?.code
  }));

  return sendSuccess(res, "Exam routines fetched", enriched);
});

export const createExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  await getExamOrThrow(req, examId);

  const payload = examRoutineSchema.parse(req.body);
  ensureValidBsDate(payload.examDateBs);

  const duplicate = await ExamRoutine.findOne({ examId, subjectId: payload.subjectId });
  if (duplicate) {
    throw new ApiError(409, "A routine for this subject already exists in this exam");
  }

  const subject = await Subject.findOne({ _id: payload.subjectId, schoolId: tenantObjectId(req) });
  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  const routine = await ExamRoutine.create({
    ...payload,
    schoolId: tenantObjectId(req),
    examId
  });

  return sendSuccess(res, "Exam routine created", routine, 201);
});

export const updateExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const routineId = String(req.params.routineId);
  await getExamOrThrow(req, examId);

  const payload = examRoutineSchema.parse(req.body);
  ensureValidBsDate(payload.examDateBs);

  const duplicate = await ExamRoutine.findOne({
    examId,
    subjectId: payload.subjectId,
    _id: { $ne: routineId }
  });
  if (duplicate) {
    throw new ApiError(409, "A routine for this subject already exists in this exam");
  }

  const routine = await ExamRoutine.findOneAndUpdate(
    { _id: routineId, examId, schoolId: tenantObjectId(req) },
    payload,
    { new: true }
  );

  if (!routine) {
    throw new ApiError(404, "Exam routine not found");
  }

  return sendSuccess(res, "Exam routine updated", routine);
});

export const deleteExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const routineId = String(req.params.routineId);

  const routine = await ExamRoutine.findOneAndDelete({
    _id: routineId,
    examId,
    schoolId: tenantObjectId(req)
  });

  if (!routine) {
    throw new ApiError(404, "Exam routine not found");
  }

  return sendSuccess(res, "Exam routine deleted");
});

const notifyExamAudience = async (req: Request, exam: { _id: unknown; name: string; batchIds?: unknown[]; yearIds?: unknown[]; classIds?: unknown[] }, title: string, message: string) => {
  const schoolId = getSchoolIdFromRequest(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const studentFilter: Record<string, unknown> = { schoolId: tenantObjectId(req) };

  if (college) {
    if (exam.batchIds?.length) {
      studentFilter.batchId = { $in: exam.batchIds };
    }
    if (exam.yearIds?.length) {
      studentFilter.yearId = { $in: exam.yearIds };
    }
  } else if (exam.classIds?.length) {
    studentFilter.classId = { $in: exam.classIds };
  }

  const students = await Student.find(studentFilter).select("user").lean();
  await Promise.all(
    students.map((student) =>
      sendNotification({
        schoolId,
        recipientUserId: student.user.toString(),
        title,
        message,
        type: "EXAM",
        channel: "IN_APP",
        metadata: { examId: String(exam._id) }
      })
    )
  );
};

export const publishExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);

  const routineCount = await ExamRoutine.countDocuments({ examId, schoolId: tenantObjectId(req) });
  if (routineCount === 0) {
    throw new ApiError(400, "Add at least one exam routine before publishing");
  }

  exam.routinePublished = true;
  if (exam.status === "DRAFT") {
    exam.status = "SCHEDULED";
  }
  await exam.save();

  await notifyExamAudience(
    req,
    exam,
    "Exam routine published",
    `The exam routine for "${exam.name}" is now available. Check your exam schedule in the portal.`
  );

  return sendSuccess(res, "Exam routine published", exam);
});

export const unpublishExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);
  exam.routinePublished = false;
  await exam.save();
  return sendSuccess(res, "Exam routine unpublished", exam);
});