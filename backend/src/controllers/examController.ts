import type { Request, Response } from "express";
import { computeSubjectMark, examSchema, resultSchema } from "@nepal-school-erp/shared";
import { Exam } from "../models/Exam.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { Result } from "../models/Result.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { buildResultTotals, canViewPublishedResults } from "../utils/examResults.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { generateMarksheetPDF } from "../utils/pdf.js";
import { assertParentAccessToStudent, getLinkedStudentIds } from "../utils/parentScope.js";
import { sendNotification, getSchoolIdFromRequest, notifyParentsOfStudent } from "../utils/notificationService.js";
import { assertStudentOwnRecord, getStudentProfile } from "../utils/studentScope.js";
import { buildStudentAcademicFilter, buildTeacherAcademicFilter } from "../utils/academicScope.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import {
  assertTeacherAcademicScope,
  assertTeacherSubjectAcademicScope,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const assertAdmin = (req: Request): void => {
  if (req.user?.role !== "COLLEGE_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only college administrators can perform this action");
  }
};

const getExamOrThrow = async (req: Request, examId: string) => {
  const exam = await Exam.findOne(withTenantScope(req, { _id: examId }));
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }
  return exam;
};

export const listExams = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    if (college) {
      filter.batchIds = { $in: teacherScope.batchIds };
      filter.yearIds = { $in: teacherScope.yearIds };
    } else {
      filter.classIds = { $in: teacherScope.classIds };
    }
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    if (college && studentProfile.batchId) {
      filter.batchIds = studentProfile.batchId;
      if (studentProfile.yearId) {
        filter.yearIds = studentProfile.yearId;
      }
    } else if (studentProfile.classId) {
      filter.classIds = studentProfile.classId;
    }
  }

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    if (college) {
      const batchIds = [...new Set(students.map((s) => s.batchId?.toString()).filter(Boolean))];
      const yearIds = [...new Set(students.map((s) => s.yearId?.toString()).filter(Boolean))];
      filter.batchIds = { $in: batchIds };
      filter.yearIds = { $in: yearIds };
    } else {
      const classIds = [...new Set(students.map((s) => s.classId?.toString()).filter(Boolean))];
      filter.classIds = { $in: classIds };
    }
  }

  const exams = await Exam.find(filter).sort({ startDateBs: -1 }).lean();
  return sendSuccess(res, "Exams fetched", exams);
});

export const createExam = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const payload = examSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);
  if (payload.resultPublishDateBs) {
    ensureValidBsDate(payload.resultPublishDateBs);
  }

  const exam = await Exam.create({
    ...payload,
    schoolId: tenantObjectId(req),
    routinePublished: false,
    resultsPublished: false,
    resultsLocked: false
  });
  return sendSuccess(res, "Exam created successfully", exam, 201);
});

export const updateExam = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const payload = examSchema.parse(req.body);
  ensureValidBsDate(payload.startDateBs);
  ensureValidBsDate(payload.endDateBs);
  if (payload.resultPublishDateBs) {
    ensureValidBsDate(payload.resultPublishDateBs);
  }

  const exam = await Exam.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  return sendSuccess(res, "Exam updated successfully", exam);
});

export const deleteExam = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const schoolId = tenantObjectId(req);
  const exam = await Exam.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  await Promise.all([
    Result.deleteMany({ examId: req.params.id, schoolId }),
    ExamRoutine.deleteMany({ examId: req.params.id, schoolId })
  ]);
  return sendSuccess(res, "Exam deleted successfully");
});

export const listResults = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = { schoolId: tenantObjectId(req) };
  const institutionType = await getInstitutionType(req);

  if (typeof req.query.examId === "string") query.examId = req.query.examId;
  if (typeof req.query.classId === "string") query.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") query.sectionId = req.query.sectionId;
  if (typeof req.query.batchId === "string") query.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") query.yearId = req.query.yearId;
  if (typeof req.query.studentId === "string") query.studentId = req.query.studentId;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    Object.assign(
      query,
      buildTeacherAcademicFilter(teacherScope, institutionType, {
        classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
        sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
        batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
        yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined
      })
    );
    query["marks.subjectId"] = { $in: teacherScope.subjectIds };
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    query.studentId = studentProfile.studentId;
    Object.assign(query, buildStudentAcademicFilter(studentProfile, institutionType));
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
    const examIds = [...new Set(results.map((result) => result.examId.toString()))];
    const exams = await Exam.find({ _id: { $in: examIds }, schoolId: tenantObjectId(req) }).lean();
    const examMap = new Map(exams.map((exam) => [exam._id.toString(), exam]));
    results = results.filter((result) => {
      const exam = examMap.get(result.examId.toString());
      return exam ? canViewPublishedResults(exam) : false;
    });
  }

  return sendSuccess(res, "Results fetched", results);
});

export const upsertResult = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can enter exam results");
  }

  const payload = resultSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const scope = await assertTeacherAcademicScope(req, payload);

  const exam = await Exam.findOne({ _id: payload.examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam was not found in this college context");
  }

  if (exam.resultsLocked) {
    throw new ApiError(403, "Results are locked by the college admin");
  }

  for (const mark of payload.marks) {
    if (!scope.subjectIds.includes(mark.subjectId)) {
      throw new ApiError(403, "You can only enter marks for your assigned subjects");
    }
    await assertTeacherSubjectAcademicScope(req, mark.subjectId, payload);
  }

  const studentLookup: Record<string, unknown> = { _id: payload.studentId, schoolId };
  if (isCollege(institutionType)) {
    studentLookup.batchId = payload.batchId;
    studentLookup.yearId = payload.yearId;
  } else {
    studentLookup.classId = payload.classId;
    studentLookup.sectionId = payload.sectionId;
  }

  const [student, existingResult] = await Promise.all([
    Student.findOne(studentLookup),
    Result.findOne({ schoolId, examId: payload.examId, studentId: payload.studentId }).lean()
  ]);

  if (!student) {
    throw new ApiError(404, "Student was not found in this college context");
  }

  const subjects = await Subject.find({ _id: { $in: payload.marks.map((mark) => mark.subjectId) }, schoolId }).lean();
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject]));

  const teacherSubjectIdSet = new Set(scope.subjectIds);
  const retainedMarks = (existingResult?.marks ?? []).filter((mark) => !teacherSubjectIdSet.has(mark.subjectId.toString()));

  const incomingMarks = payload.marks.map((mark) => {
    const subject = subjectMap.get(mark.subjectId);
    return computeSubjectMark({
      ...mark,
      fullMarks: mark.fullMarks ?? subject?.fullMarks ?? 100,
      passMarks: mark.passMarks ?? subject?.passMarks ?? 35,
      obtainedMarks: 0
    });
  });

  const mergedMarksMap = new Map<string, ReturnType<typeof computeSubjectMark>>();
  for (const mark of retainedMarks) {
    mergedMarksMap.set(mark.subjectId.toString(), mark as ReturnType<typeof computeSubjectMark>);
  }
  for (const mark of incomingMarks) {
    mergedMarksMap.set(mark.subjectId, mark);
  }

  const mergedMarks = Array.from(mergedMarksMap.values());
  const totals = buildResultTotals(
    mergedMarks.map((mark) => ({
      obtainedMarks: mark.obtainedMarks,
      fullMarks: mark.fullMarks,
      passFail: mark.passFail
    }))
  );

  const result = await Result.findOneAndUpdate(
    { schoolId, examId: payload.examId, studentId: payload.studentId },
    {
      examId: payload.examId,
      studentId: payload.studentId,
      classId: payload.classId,
      sectionId: payload.sectionId,
      batchId: payload.batchId,
      yearId: payload.yearId,
      marks: mergedMarks,
      schoolId,
      percentage: totals.percentage,
      gpa: totals.gpa,
      grade: totals.grade,
      passFailStatus: totals.passFailStatus,
      publishedAtBs: existingResult?.publishedAtBs
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return sendSuccess(res, "Result saved successfully", result);
});

export const deleteResult = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const result = await Result.findOneAndDelete(withTenantScope(req, { _id: req.params.resultId }));
  if (!result) {
    throw new ApiError(404, "Result not found");
  }
  return sendSuccess(res, "Result deleted successfully");
});

export const deleteResultMark = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  const studentId = String(req.params.studentId);
  const subjectId = String(req.params.subjectId);
  const schoolId = tenantObjectId(req);
  const role = req.user?.role;

  if (role !== "TEACHER" && role !== "COLLEGE_ADMIN" && role !== "SUPER_ADMIN") {
    throw new ApiError(403, "You do not have permission to delete marks");
  }

  const exam = await Exam.findOne({ _id: examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  if (role === "TEACHER" && exam.resultsLocked) {
    throw new ApiError(403, "Results are locked by the college admin");
  }

  const result = await Result.findOne({ schoolId, examId, studentId });
  if (!result) {
    throw new ApiError(404, "Result not found");
  }

  if (role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    if (!scope.subjectIds.includes(subjectId)) {
      throw new ApiError(403, "You can only delete marks for your assigned subjects");
    }
    const student = await Student.findOne({ _id: studentId, schoolId }).lean();
    if (!student) {
      throw new ApiError(404, "Student not found");
    }
    const institutionType = await getInstitutionType(req);
    if (isCollege(institutionType)) {
      await assertTeacherAcademicScope(req, { batchId: student.batchId?.toString(), yearId: student.yearId?.toString() });
    } else {
      await assertTeacherAcademicScope(req, { classId: student.classId?.toString(), sectionId: student.sectionId?.toString() });
    }
  }

  const updatedMarks = result.marks.filter((mark) => mark.subjectId.toString() !== subjectId);
  if (!result.marks.some((mark) => mark.subjectId.toString() === subjectId)) {
    throw new ApiError(404, "Subject marks not found in this result");
  }

  if (updatedMarks.length === 0) {
    await Result.deleteOne({ _id: result._id });
    return sendSuccess(res, "Result deleted successfully");
  }

  const totals = buildResultTotals(
    updatedMarks.map((mark) => ({
      obtainedMarks: mark.obtainedMarks,
      fullMarks: mark.fullMarks,
      passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
    }))
  );

  const updated = await Result.findOneAndUpdate(
    { _id: result._id },
    {
      marks: updatedMarks,
      percentage: totals.percentage,
      gpa: totals.gpa,
      grade: totals.grade,
      passFailStatus: totals.passFailStatus
    },
    { new: true }
  );

  return sendSuccess(res, "Subject marks deleted successfully", updated);
});

export const publishExamResults = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);
  const todayBs = getTodayBs();

  exam.resultsPublished = true;
  exam.status = "PUBLISHED";
  if (!exam.resultPublishDateBs) {
    exam.resultPublishDateBs = todayBs;
  }
  await exam.save();

  await Result.updateMany(
    { schoolId: tenantObjectId(req), examId },
    { $set: { publishedAtBs: exam.resultPublishDateBs ?? todayBs } }
  );

  const students = await Student.find({
    schoolId: tenantObjectId(req),
    ...(exam.batchIds?.length ? { batchId: { $in: exam.batchIds } } : {}),
    ...(exam.yearIds?.length ? { yearId: { $in: exam.yearIds } } : {})
  }).lean();

  const schoolId = getSchoolIdFromRequest(req);
  await Promise.all(
    students.map((student) =>
      Promise.all([
        sendNotification({
          schoolId,
          recipientUserId: student.user.toString(),
          title: "Exam results published",
          message: `Results for "${exam.name}" are now available.`,
          type: "EXAM",
          channel: "IN_APP",
          metadata: { examId }
        }),
        notifyParentsOfStudent(
          schoolId,
          student._id.toString(),
          "Exam results published",
          `Results for "${exam.name}" are now available for your child.`,
          "EXAM"
        )
      ])
    )
  );

  return sendSuccess(res, "Exam results published", exam);
});

export const unpublishExamResults = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);
  exam.resultsPublished = false;
  if (exam.status === "PUBLISHED") {
    exam.status = "COMPLETED";
  }
  await exam.save();
  await Result.updateMany({ schoolId: tenantObjectId(req), examId }, { $unset: { publishedAtBs: "" } });
  return sendSuccess(res, "Exam results unpublished", exam);
});

export const lockExamResults = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const exam = await getExamOrThrow(req, String(req.params.examId));
  exam.resultsLocked = true;
  await exam.save();
  return sendSuccess(res, "Exam results locked", exam);
});

export const unlockExamResults = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const exam = await getExamOrThrow(req, String(req.params.examId));
  exam.resultsLocked = false;
  await exam.save();
  return sendSuccess(res, "Exam results unlocked", exam);
});

export const getExamAnalytics = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const examId = String(req.params.examId);
  const schoolId = tenantObjectId(req);
  const exam = await getExamOrThrow(req, examId);

  const studentFilter: Record<string, unknown> = { schoolId };
  if (exam.batchIds?.length) studentFilter.batchId = { $in: exam.batchIds };
  if (exam.yearIds?.length) studentFilter.yearId = { $in: exam.yearIds };

  const [students, results, subjects] = await Promise.all([
    Student.find(studentFilter).populate("user", "-password").lean(),
    Result.find({ schoolId, examId }).lean(),
    Subject.find({ schoolId }).lean()
  ]);

  const studentMap = new Map(students.map((student) => [student._id.toString(), student]));
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject]));

  const passCount = results.filter((result) => result.passFailStatus === "PASS").length;
  const failCount = results.length - passCount;
  const averagePercentage =
    results.length > 0 ? Number((results.reduce((sum, result) => sum + result.percentage, 0) / results.length).toFixed(2)) : 0;

  const ranked = [...results]
    .sort((left, right) => right.percentage - left.percentage)
    .map((result) => {
      const student = studentMap.get(result.studentId.toString());
      const user = student?.user as { fullName?: string } | undefined;
      return {
        studentId: result.studentId.toString(),
        studentName: user?.fullName ?? "Student",
        percentage: result.percentage,
        grade: result.grade
      };
    });

  const subjectPerformanceMap = new Map<string, { total: number; count: number; pass: number; fail: number }>();
  for (const result of results) {
    for (const mark of result.marks) {
      const key = mark.subjectId.toString();
      const current = subjectPerformanceMap.get(key) ?? { total: 0, count: 0, pass: 0, fail: 0 };
      current.total += mark.percentage ?? 0;
      current.count += 1;
      if (mark.passFail === "PASS") current.pass += 1;
      else current.fail += 1;
      subjectPerformanceMap.set(key, current);
    }
  }

  return sendSuccess(res, "Exam analytics fetched", {
    examId,
    totalStudents: students.length,
    resultsEntered: results.length,
    passCount,
    failCount,
    averagePercentage,
    topPerformers: ranked.slice(0, 5),
    lowestPerformers: [...ranked].reverse().slice(0, 5),
    subjectPerformance: Array.from(subjectPerformanceMap.entries()).map(([subjectId, stats]) => ({
      subjectId,
      subjectName: subjectMap.get(subjectId)?.name ?? "Subject",
      averagePercentage: stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
      passCount: stats.pass,
      failCount: stats.fail
    }))
  });
});

export const getMarksheet = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  const studentId = String(req.params.studentId);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);

  const exam = await Exam.findOne(withTenantScope(req, { _id: examId }));
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const student = await Student.findOne({ _id: studentId, schoolId }).lean();
    if (!student) {
      throw new ApiError(404, "Student not found");
    }
    if (isCollege(institutionType)) {
      await assertTeacherAcademicScope(req, { batchId: student.batchId?.toString(), yearId: student.yearId?.toString() });
    } else {
      await assertTeacherAcademicScope(req, { classId: student.classId?.toString(), sectionId: student.sectionId?.toString() });
    }
    if (!scope.subjectIds.length) {
      throw new ApiError(403, "No assigned subjects");
    }
  } else if (req.user?.role === "STUDENT" || req.user?.role === "PARENT") {
    await assertStudentOwnRecord(req, studentId);
    await assertParentAccessToStudent(req, studentId);
    if (!canViewPublishedResults(exam)) {
      throw new ApiError(403, "Results are not published yet");
    }
  }

  const result = await Result.findOne(withTenantScope(req, { examId, studentId }));
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

  const [student, section, subjects, settings] = await Promise.all([
    Student.findOne(withTenantScope(req, { _id: result.studentId })).populate("user", "-password"),
    Section.findOne(withTenantScope(req, { _id: result.sectionId })),
    Subject.find({ _id: { $in: result.marks.map((mark) => mark.subjectId) }, schoolId }),
    Setting.findOne({ schoolId }).lean()
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
    subjects: scopedSubjects,
    collegeName: settings?.schoolName
  });
});

export const downloadMarksheetPdf = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  const studentId = String(req.params.studentId);
  const schoolId = tenantObjectId(req);

  const exam = await Exam.findOne(withTenantScope(req, { _id: examId }));
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  if (req.user?.role === "STUDENT" || req.user?.role === "PARENT") {
    await assertStudentOwnRecord(req, studentId);
    await assertParentAccessToStudent(req, studentId);
    if (!canViewPublishedResults(exam)) {
      throw new ApiError(403, "Results are not published yet");
    }
  } else if (req.user?.role !== "COLLEGE_ADMIN" && req.user?.role !== "SUPER_ADMIN" && req.user?.role !== "TEACHER") {
    throw new ApiError(403, "You do not have permission to download this marksheet");
  }

  const [result, student, settings] = await Promise.all([
    Result.findOne(withTenantScope(req, { examId, studentId })),
    Student.findOne(withTenantScope(req, { _id: studentId })).populate("user", "-password"),
    Setting.findOne({ schoolId }).lean()
  ]);

  if (!result || !student) {
    throw new ApiError(404, "Result not found");
  }

  const subjects = await Subject.find({ _id: { $in: result.marks.map((mark) => mark.subjectId) }, schoolId }).lean();
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject]));
  const user = student.user as { fullName?: string };

  const totals = buildResultTotals(
    result.marks.map((mark) => ({
      obtainedMarks: mark.obtainedMarks,
      fullMarks: mark.fullMarks,
      passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
    }))
  );

  await generateMarksheetPDF(
    {
      schoolName: settings?.schoolName ?? "College",
      examName: exam.name,
      studentName: user?.fullName ?? "Student",
      className: "",
      sectionName: "",
      rollNumber: student.rollNumber,
      marks: result.marks.map((mark) => ({
        subject: subjectMap.get(mark.subjectId.toString())?.name ?? "Subject",
        fullMarks: mark.fullMarks,
        obtained: mark.obtainedMarks,
        theory: mark.theoryMarks,
        practical: mark.practicalMarks,
        internal: mark.internalMarks,
        grade: mark.grade ?? undefined,
        passFail: mark.passFail ?? undefined,
        remarks: mark.teacherRemarks ?? undefined
      })),
      totalObtained: totals.totalObtained,
      totalFull: totals.totalFull,
      percentage: totals.percentage,
      gpa: totals.gpa,
      grade: totals.grade,
      passFailStatus: result.passFailStatus,
      publishDateBs: result.publishedAtBs ?? undefined
    },
    res
  );
});