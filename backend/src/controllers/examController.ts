import type { Request, Response } from "express";
import { examSchema, resultSchema } from "@nepal-school-erp/shared";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { calculateResultGrade, compareBsDates, ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { assertParentAccessToStudent, getLinkedStudentIds } from "../utils/parentScope.js";
import { assertStudentOwnRecord, getStudentProfile } from "../utils/studentScope.js";
import {
  assertTeacherClassSection,
  assertTeacherSubjectClassSection,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listExams = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    filter.classIds = { $in: teacherScope.classIds };
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    filter.classIds = studentProfile.classId;
  }

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const classIds = [...new Set(students.map((s) => s.classId.toString()))];
    filter.classIds = { $in: classIds };
  }

  const exams = await Exam.find(filter).sort({ startDateBs: -1 });
  return sendSuccess(res, "Exams fetched", exams);
});

export const createExam = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "SCHOOL_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only school administrators can create exams");
  }

  const payload = examSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);

  const exam = await Exam.create({
    ...payload,
    schoolId: tenantObjectId(req)
  });
  return sendSuccess(res, "Exam created successfully", exam, 201);
});

export const updateExam = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "SCHOOL_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only school administrators can update exams");
  }

  const payload = examSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);

  const exam = await Exam.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });

  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  return sendSuccess(res, "Exam updated successfully", exam);
});

export const deleteExam = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const exam = await Exam.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  await Result.deleteMany({ examId: req.params.id, schoolId });
  return sendSuccess(res, "Exam deleted successfully");
});

export const listResults = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = { schoolId: tenantObjectId(req) };

  if (typeof req.query.examId === "string") query.examId = req.query.examId;
  if (typeof req.query.classId === "string") query.classId = req.query.classId;
  if (typeof req.query.studentId === "string") query.studentId = req.query.studentId;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    query.classId = typeof req.query.classId === "string" ? req.query.classId : { $in: teacherScope.classIds };
    query.sectionId = { $in: teacherScope.sectionIds };
    query["marks.subjectId"] = { $in: teacherScope.subjectIds };
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    query.studentId = studentProfile.studentId;
    query.classId = studentProfile.classId;
    query.sectionId = studentProfile.sectionId;
  }

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    query.studentId = typeof req.query.studentId === "string" ? req.query.studentId : { $in: studentIds };
    if (typeof req.query.studentId === "string") {
      await assertParentAccessToStudent(req, req.query.studentId);
    }
  }

  let results = await Result.find(query).sort({ updatedAt: -1 }).lean();

  if (studentProfile || req.user?.role === "PARENT") {
    const todayBs = getTodayBs();
    results = results.filter(
      (result) => result.publishedAtBs && compareBsDates(result.publishedAtBs, todayBs) <= 0
    );
  }

  return sendSuccess(res, "Results fetched", results);
});

export const upsertResult = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can enter exam results");
  }

  const payload = resultSchema.parse(req.body);
  if (payload.publishedAtBs) ensureValidBsDate(payload.publishedAtBs);

  const schoolId = tenantObjectId(req);
  const scope = await assertTeacherClassSection(req, payload.classId, payload.sectionId);

  for (const mark of payload.marks) {
    if (!scope.subjectIds.includes(mark.subjectId)) {
      throw new ApiError(403, "You can only enter marks for your assigned subjects");
    }
    await assertTeacherSubjectClassSection(req, mark.subjectId, payload.classId, payload.sectionId);
  }

  const [student, exam, existingResult] = await Promise.all([
    Student.findOne({ _id: payload.studentId, schoolId, classId: payload.classId, sectionId: payload.sectionId }),
    Exam.findOne({ _id: payload.examId, schoolId }),
    Result.findOne({ schoolId, examId: payload.examId, studentId: payload.studentId }).lean()
  ]);

  if (!student) {
    throw new ApiError(404, "Student was not found in this school context");
  }

  if (!exam) {
    throw new ApiError(404, "Exam was not found in this school context");
  }

  const teacherSubjectIdSet = new Set(scope.subjectIds);
  const retainedMarks = (existingResult?.marks ?? [])
    .filter((mark) => !teacherSubjectIdSet.has(mark.subjectId.toString()))
    .map((mark) => ({
      subjectId: mark.subjectId.toString(),
      obtainedMarks: mark.obtainedMarks
    }));

  const mergedMarksMap = new Map<string, { subjectId: string; obtainedMarks: number }>();
  for (const mark of retainedMarks) {
    mergedMarksMap.set(mark.subjectId, mark);
  }
  for (const mark of payload.marks) {
    mergedMarksMap.set(mark.subjectId, mark);
  }
  const mergedMarks = Array.from(mergedMarksMap.values());

  const subjects = await Subject.find({ _id: { $in: mergedMarks.map((mark) => mark.subjectId) }, schoolId });
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject.fullMarks]));
  const totalFullMarks = mergedMarks.reduce((sum, mark) => sum + (subjectMap.get(mark.subjectId) ?? 100), 0);
  const totalObtainedMarks = mergedMarks.reduce((sum, mark) => sum + mark.obtainedMarks, 0);
  const { percentage, gpa, grade } = calculateResultGrade(totalObtainedMarks, totalFullMarks);

  const result = await Result.findOneAndUpdate(
    {
      schoolId,
      examId: payload.examId,
      studentId: payload.studentId
    },
    {
      examId: payload.examId,
      studentId: payload.studentId,
      classId: payload.classId,
      sectionId: payload.sectionId,
      marks: mergedMarks,
      schoolId,
      percentage,
      gpa,
      grade,
      publishedAtBs: payload.publishedAtBs || existingResult?.publishedAtBs || undefined
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  return sendSuccess(res, "Result saved successfully", result);
});

export const getMarksheet = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  const studentId = String(req.params.studentId);
  const schoolId = tenantObjectId(req);

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const student = await Student.findOne({ _id: studentId, schoolId }).lean();
    if (!student) {
      throw new ApiError(404, "Student not found");
    }
    await assertTeacherClassSection(req, student.classId.toString(), student.sectionId.toString());
  } else {
    await assertStudentOwnRecord(req, studentId);
    await assertParentAccessToStudent(req, studentId);
  }

  const result = await Result.findOne(withTenantScope(req, {
    examId,
    studentId
  }));

  if (!result) {
    throw new ApiError(404, "Result not found");
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    const hasAssignedMarks = result.marks.some((mark) => teacherScope.subjectIds.includes(mark.subjectId.toString()));
    if (!hasAssignedMarks) {
      throw new ApiError(403, "You do not have marks assigned for this student in your subjects");
    }
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile && typeof req.query.subjectId === "string") {
    const subject = await Subject.findOne({
      _id: req.query.subjectId,
      schoolId,
      classIds: studentProfile.classId
    }).lean();
    if (!subject) {
      throw new ApiError(403, "You are not enrolled in this subject");
    }
  }

  const [exam, student, section, subjects] = await Promise.all([
    Exam.findOne(withTenantScope(req, { _id: result.examId })),
    Student.findOne(withTenantScope(req, { _id: result.studentId })).populate("user", "-password"),
    Section.findOne(withTenantScope(req, { _id: result.sectionId })),
    Subject.find({ _id: { $in: result.marks.map((mark) => mark.subjectId) }, schoolId })
  ]);

  const scopedMarks = teacherScope
    ? result.marks.filter((mark) => teacherScope.subjectIds.includes(mark.subjectId.toString()))
    : result.marks;
  const scopedSubjects = teacherScope
    ? subjects.filter((subject) => teacherScope.subjectIds.includes(subject._id.toString()))
    : subjects;

  return sendSuccess(res, "Marksheet generated", {
    result: teacherScope ? { ...result.toObject(), marks: scopedMarks } : result,
    exam,
    student,
    section,
    subjects: scopedSubjects
  });
});