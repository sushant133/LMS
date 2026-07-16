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

  const studentProfile = await getStudentProfile(req);
  const isStudentOrParent = Boolean(studentProfile) || req.user?.role === "PARENT";
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const schoolId = tenantObjectId(req);

  let routines = await ExamRoutine.find(filter).sort({ examDateBs: 1, startTime: 1 }).lean();

  // Load exams referenced by routines (for publish flag + student scope)
  const examIdsFromRoutines = [...new Set(routines.map((routine) => routine.examId.toString()))];
  if (examId && !examIdsFromRoutines.includes(examId)) {
    examIdsFromRoutines.push(examId);
  }
  const exams = examIdsFromRoutines.length
    ? await Exam.find({ _id: { $in: examIdsFromRoutines }, schoolId }).lean()
    : [];
  const examById = new Map(exams.map((exam) => [exam._id.toString(), exam]));

  if (examId) {
    const exam = examById.get(examId) ?? (await Exam.findOne(withTenantScope(req, { _id: examId })).lean());
    if (!exam) {
      throw new ApiError(404, "Exam not found");
    }
    examById.set(examId, exam);

    if (isStudentOrParent && !exam.routinePublished) {
      return sendSuccess(res, "Exam routines fetched", []);
    }
  } else if (isStudentOrParent) {
    routines = routines.filter((routine) => {
      const exam = examById.get(routine.examId.toString());
      return Boolean(exam?.routinePublished);
    });
  }

  // Students: only their enrolled year (and only for exams that include that year)
  if (studentProfile && college) {
    const studentYearId = studentProfile.yearId;
    const studentBatchId = studentProfile.batchId;
    const subjectIds = [...new Set(routines.map((r) => r.subjectId.toString()))];
    const subjects = subjectIds.length
      ? await Subject.find({ _id: { $in: subjectIds }, schoolId }).select("_id yearIds").lean()
      : [];
    const subjectYearMap = new Map(
      subjects.map((s) => [s._id.toString(), (s.yearIds ?? []).map((y) => y.toString())])
    );

    routines = routines.filter((routine) => {
      const exam = examById.get(routine.examId.toString());
      if (!exam) return false;

      const examYearIds = (exam.yearIds ?? []).map((id) => id.toString());
      const examBatchIds = (exam.batchIds ?? []).map((id) => id.toString());

      // Drop routines for exams that don't target this student (when exam is scoped)
      if (examYearIds.length > 0 || examBatchIds.length > 0) {
        const yearOk = studentYearId ? examYearIds.includes(studentYearId) : false;
        const batchOnlyOk =
          examYearIds.length === 0 && studentBatchId
            ? examBatchIds.includes(studentBatchId)
            : false;
        if (!yearOk && !batchOnlyOk) return false;
      }

      const yid = routine.yearId?.toString();
      if (yid) {
        // If student year is missing on profile, show year-tagged rows rather than hide everything
        if (!studentYearId) return true;
        return yid === studentYearId;
      }

      // Legacy rows without yearId: include if subject is for student's year (or unscoped subject)
      if (!studentYearId) return true;
      const years = subjectYearMap.get(routine.subjectId.toString()) ?? [];
      return years.includes(studentYearId) || years.length === 0;
    });
  }

  // Parents: limit to linked children's years when college + year-tagged routines exist
  if (req.user?.role === "PARENT" && college && !yearIdFilter) {
    const { getLinkedStudentIds } = await import("../utils/parentScope.js");
    const linkedIds = await getLinkedStudentIds(req);
    const children = linkedIds.length
      ? await Student.find({ _id: { $in: linkedIds }, schoolId }).select("yearId batchId").lean()
      : [];
    const childYearIds = new Set(
      children.map((s) => s.yearId?.toString()).filter(Boolean) as string[]
    );
    const childBatchIds = new Set(
      children.map((s) => s.batchId?.toString()).filter(Boolean) as string[]
    );

    if (childYearIds.size > 0 || childBatchIds.size > 0) {
      routines = routines.filter((routine) => {
        const yid = routine.yearId?.toString();
        if (yid) return childYearIds.has(yid);
        const exam = examById.get(routine.examId.toString());
        const examYearIds = (exam?.yearIds ?? []).map((id) => id.toString());
        const examBatchIds = (exam?.batchIds ?? []).map((id) => id.toString());
        if (examYearIds.some((id) => childYearIds.has(id))) return true;
        if (examYearIds.length === 0 && examBatchIds.some((id) => childBatchIds.has(id))) return true;
        if (examYearIds.length === 0 && examBatchIds.length === 0) return true;
        return false;
      });
    }
  }

  // Teachers / admins: full multi-year routine (all subjects / all years) — no further filter

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
