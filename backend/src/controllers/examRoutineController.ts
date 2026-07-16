import type { Request, Response } from "express";
import { examRoutineSchema } from "@phit-erp/shared";
import { Exam } from "../models/Exam.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
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
  const yearIdFilter = typeof req.query.yearId === "string" ? req.query.yearId : undefined;
  const filter: Record<string, unknown> = withTenantScope(req);
  if (examId) {
    filter.examId = examId;
  }
  if (yearIdFilter) {
    filter.yearId = yearIdFilter;
  }

  const teacherScope = await getTeacherScope(req);
  const studentProfile = await getStudentProfile(req);
  const isStudentOrParent = Boolean(studentProfile) || req.user?.role === "PARENT";
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  let routines = await ExamRoutine.find(filter).sort({ examDateBs: 1, startTime: 1 }).lean();

  if (examId) {
    const exam = await Exam.findOne(withTenantScope(req, { _id: examId })).lean();
    if (!exam) {
      throw new ApiError(404, "Exam not found");
    }

    if (isStudentOrParent && !exam.routinePublished) {
      return sendSuccess(res, "Exam routines fetched", []);
    }
  } else if (isStudentOrParent) {
    const examIds = [...new Set(routines.map((routine) => routine.examId.toString()))];
    const publishedExams = await Exam.find({
      _id: { $in: examIds },
      schoolId: tenantObjectId(req),
      routinePublished: true
    })
      .select("_id")
      .lean();
    const publishedSet = new Set(publishedExams.map((exam) => exam._id.toString()));
    routines = routines.filter((routine) => publishedSet.has(routine.examId.toString()));
  }

  // Teachers: full multi-year routine (all subjects) — same as timetable visibility
  // Students: only their year
  if (studentProfile && college && studentProfile.yearId) {
    const studentYearId = studentProfile.yearId;
    const subjectIds = [...new Set(routines.map((r) => r.subjectId.toString()))];
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      schoolId: tenantObjectId(req)
    })
      .select("_id yearIds")
      .lean();
    const subjectYearMap = new Map(
      subjects.map((s) => [s._id.toString(), (s.yearIds ?? []).map((y) => y.toString())])
    );

    routines = routines.filter((routine) => {
      const yid = routine.yearId?.toString();
      if (yid) return yid === studentYearId;
      // Legacy rows without yearId: include if subject is for student's year
      const years = subjectYearMap.get(routine.subjectId.toString()) ?? [];
      return years.includes(studentYearId) || years.length === 0;
    });
  }

  if (req.user?.role === "PARENT" && college) {
    // Parent sees all linked children years — leave unfiltered by single year unless yearId query set
  }

  // Teachers see all years (no subject filter) so they can view full 1st/2nd/3rd schedules
  void teacherScope;

  const subjectIds = [...new Set(routines.map((routine) => routine.subjectId.toString()))];
  const yearIds = [
    ...new Set(routines.map((r) => r.yearId?.toString()).filter(Boolean) as string[])
  ];
  const [subjects, years] = await Promise.all([
    Subject.find({ _id: { $in: subjectIds }, schoolId: tenantObjectId(req) }).lean(),
    yearIds.length
      ? Year.find({ _id: { $in: yearIds }, schoolId: tenantObjectId(req) }).lean()
      : Promise.resolve([])
  ]);
  const batchIds = [
    ...new Set(years.map((year) => year.batchId?.toString()).filter(Boolean) as string[])
  ];
  const batches = batchIds.length
    ? await Batch.find({ _id: { $in: batchIds }, schoolId: tenantObjectId(req) }).lean()
    : [];
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject]));
  const yearMap = new Map(years.map((year) => [year._id.toString(), year]));
  const batchMap = new Map(batches.map((batch) => [batch._id.toString(), batch]));

  const enriched = routines.map((routine) => {
    const yid = routine.yearId?.toString();
    const year = yid ? yearMap.get(yid) : undefined;
    const batch = year?.batchId ? batchMap.get(year.batchId.toString()) : undefined;
    const yearName = year?.name;
    const yearLabel =
      yearName && batch?.name ? `${yearName} · ${batch.name}` : yearName;
    return {
      ...routine,
      _id: routine._id.toString(),
      schoolId: routine.schoolId.toString(),
      examId: routine.examId.toString(),
      yearId: yid,
      subjectId: routine.subjectId.toString(),
      subjectName: subjectMap.get(routine.subjectId.toString())?.name ?? "Subject",
      subjectCode: subjectMap.get(routine.subjectId.toString())?.code,
      yearName: yearLabel ?? yearName,
      yearLevel: year?.level,
      batchId: year?.batchId?.toString(),
      batchName: batch?.name
    };
  });

  return sendSuccess(res, "Exam routines fetched", enriched);
});

export const createExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);

  const payload = examRoutineSchema.parse(req.body);
  ensureValidBsDate(payload.examDateBs);

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  if (college && !payload.yearId) {
    throw new ApiError(400, "Select a year (1st / 2nd / 3rd) for this exam routine entry");
  }

  if (payload.yearId) {
    const year = await Year.findOne({
      _id: payload.yearId,
      schoolId: tenantObjectId(req)
    }).lean();
    if (!year) throw new ApiError(404, "Year not found");
    if (year.name === "Ended") {
      throw new ApiError(400, "Cannot create exam routine for Ended year");
    }
    // If exam lists yearIds, ensure this year is in scope
    if (exam.yearIds?.length) {
      const allowed = exam.yearIds.map((id) => id.toString());
      if (!allowed.includes(payload.yearId)) {
        throw new ApiError(400, "Selected year is not part of this exam");
      }
    }
  }

  const duplicateFilter: Record<string, unknown> = {
    examId,
    subjectId: payload.subjectId,
    schoolId: tenantObjectId(req)
  };
  if (payload.yearId) {
    duplicateFilter.yearId = payload.yearId;
  } else {
    duplicateFilter.yearId = { $exists: false };
  }

  const duplicate = await ExamRoutine.findOne(duplicateFilter);
  if (duplicate) {
    throw new ApiError(
      409,
      payload.yearId
        ? "A routine for this subject already exists in this year for this exam"
        : "A routine for this subject already exists in this exam"
    );
  }

  const subject = await Subject.findOne({ _id: payload.subjectId, schoolId: tenantObjectId(req) });
  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  const routine = await ExamRoutine.create({
    ...payload,
    yearId: payload.yearId || undefined,
    schoolId: tenantObjectId(req),
    examId
  });

  return sendSuccess(res, "Exam routine created", routine, 201);
});

export const updateExamRoutine = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can manage exam routines");
  const examId = String(req.params.examId);
  const routineId = String(req.params.routineId);
  const exam = await getExamOrThrow(req, examId);

  const payload = examRoutineSchema.parse(req.body);
  ensureValidBsDate(payload.examDateBs);

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  if (college && !payload.yearId) {
    throw new ApiError(400, "Select a year (1st / 2nd / 3rd) for this exam routine entry");
  }

  if (payload.yearId && exam.yearIds?.length) {
    const allowed = exam.yearIds.map((id) => id.toString());
    if (!allowed.includes(payload.yearId)) {
      throw new ApiError(400, "Selected year is not part of this exam");
    }
  }

  const duplicateFilter: Record<string, unknown> = {
    examId,
    subjectId: payload.subjectId,
    schoolId: tenantObjectId(req),
    _id: { $ne: routineId }
  };
  if (payload.yearId) {
    duplicateFilter.yearId = payload.yearId;
  } else {
    duplicateFilter.yearId = { $exists: false };
  }

  const duplicate = await ExamRoutine.findOne(duplicateFilter);
  if (duplicate) {
    throw new ApiError(409, "A routine for this subject already exists for this year in this exam");
  }

  const routine = await ExamRoutine.findOneAndUpdate(
    { _id: routineId, examId, schoolId: tenantObjectId(req) },
    {
      ...payload,
      yearId: payload.yearId || undefined
    },
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

const notifyExamAudience = async (
  req: Request,
  exam: { _id: unknown; name: string; batchIds?: unknown[]; yearIds?: unknown[]; classIds?: unknown[] },
  title: string,
  message: string
) => {
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
