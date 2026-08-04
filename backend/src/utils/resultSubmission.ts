import type { InstitutionType, ResultSubmissionStatus } from "@phit-erp/shared";
import type { HydratedDocument } from "mongoose";
import type { Request } from "express";
import type { ExamDocument } from "../models/Exam.js";
import type { ResultSubmissionDocument } from "../models/ResultSubmission.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";
import { isCollege } from "./institution.js";
import { sendNotification } from "./notificationService.js";
import { tenantObjectId } from "./tenant.js";

export const TEACHER_EDITABLE_STATUSES: ResultSubmissionStatus[] = ["DRAFT", "RETURNED_FOR_CORRECTION"];

export interface SubmissionScope {
  examId: string;
  subjectId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
}

export const buildSubmissionFilter = (schoolId: string, scope: SubmissionScope): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    schoolId,
    examId: scope.examId,
    subjectId: scope.subjectId
  };

  if (scope.batchId && scope.yearId) {
    filter.batchId = scope.batchId;
    filter.yearId = scope.yearId;
  } else if (scope.classId && scope.sectionId) {
    filter.classId = scope.classId;
    filter.sectionId = scope.sectionId;
  }

  return filter;
};

export const getOrCreateSubmission = async (
  schoolId: string,
  scope: SubmissionScope,
  enteredByUserId?: string
): Promise<HydratedDocument<ResultSubmissionDocument>> => {
  const filter = buildSubmissionFilter(schoolId, scope);
  const existing = await ResultSubmission.findOne(filter);
  if (existing) {
    if (enteredByUserId && !existing.enteredByUserId) {
      existing.enteredByUserId = enteredByUserId as never;
      await existing.save();
    }
    return existing;
  }

  return ResultSubmission.create({
    ...filter,
    status: "DRAFT",
    enteredByUserId
  });
};

export const assertTeacherCanEditSubmission = (
  submission: Pick<ResultSubmissionDocument, "status">,
  exam: Pick<ExamDocument, "resultsLocked">
): void => {
  if (!TEACHER_EDITABLE_STATUSES.includes(submission.status as ResultSubmissionStatus)) {
    throw new ApiError(
      403,
      "Marks cannot be edited while results are pending admin review, approved, or published. Wait for admin feedback or contact the college admin."
    );
  }

  /**
   * Exam-level lock (after partial/full publish) still allows teachers to work on:
   * - DRAFT subjects not yet submitted (other subjects can still be entered)
   * - RETURNED_FOR_CORRECTION (admin unapproved / sent back)
   * It blocks other non-editable statuses (handled above).
   */
  if (
    exam.resultsLocked &&
    submission.status !== "DRAFT" &&
    submission.status !== "RETURNED_FOR_CORRECTION"
  ) {
    throw new ApiError(
      403,
      "Results are locked. Contact the college admin to unlock before editing."
    );
  }
};

export const getStudentsInScope = async (
  schoolId: string,
  scope: SubmissionScope,
  institutionType: InstitutionType
) => {
  const filter: Record<string, unknown> = { schoolId };

  if (isCollege(institutionType)) {
    if (!scope.batchId || !scope.yearId) {
      throw new ApiError(400, "Batch and year are required for college result submissions");
    }
    filter.batchId = scope.batchId;
    filter.yearId = scope.yearId;
  } else {
    if (!scope.classId || !scope.sectionId) {
      throw new ApiError(400, "Class and section are required for school result submissions");
    }
    filter.classId = scope.classId;
    filter.sectionId = scope.sectionId;
  }

  return Student.find(filter).populate("user", "fullName").lean();
};

export const getMarksCoverage = async (
  schoolId: string,
  scope: SubmissionScope,
  institutionType: InstitutionType,
  allowedStudentIds?: string[]
) => {
  let students = await getStudentsInScope(schoolId, scope, institutionType);
  if (allowedStudentIds?.length) {
    const allowed = new Set(allowedStudentIds);
    students = students.filter((student) => allowed.has(student._id.toString()));
  }
  const scopedStudentIds = students.map((student) => student._id.toString());

  const results = await Result.find({
    schoolId,
    examId: scope.examId,
    studentId: { $in: scopedStudentIds }
  }).lean();

  const marksEntered = results.filter((result) =>
    result.marks.some((mark) => mark.subjectId.toString() === scope.subjectId)
  ).length;

  const missingStudents = students
    .filter((student) => {
      const result = results.find((item) => item.studentId.toString() === student._id.toString());
      return !result?.marks.some((mark) => mark.subjectId.toString() === scope.subjectId);
    })
    .map((student) => {
      const user = student.user as { fullName?: string } | undefined;
      return {
        studentId: student._id.toString(),
        studentName: user?.fullName ?? "Student"
      };
    });

  return {
    studentsTotal: students.length,
    marksEntered,
    missingStudents
  };
};

export const notifySchoolAdmins = async (
  req: Request,
  title: string,
  message: string,
  metadata?: Record<string, string>
): Promise<void> => {
  const schoolId = tenantObjectId(req).toString();
  const [collegeAdmins, superAdmins] = await Promise.all([
    User.find({ schoolId, role: "COLLEGE_ADMIN", isActive: true }).select("_id").lean(),
    User.find({ role: "SUPER_ADMIN", isActive: true }).select("_id").lean()
  ]);
  const admins = [...collegeAdmins, ...superAdmins];

  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId,
        recipientUserId: admin._id.toString(),
        title,
        message,
        type: "EXAM",
        channel: "IN_APP",
        metadata
      })
    )
  );
};

export const notifyTeacherOfSubmissionUpdate = async (
  schoolId: string,
  teacherUserId: string,
  title: string,
  message: string,
  metadata?: Record<string, string>
): Promise<void> => {
  await sendNotification({
    schoolId,
    recipientUserId: teacherUserId,
    title,
    message,
    type: "EXAM",
    channel: "IN_APP",
    metadata
  });
};

/**
 * Subject IDs with PUBLISHED submissions that match a student's cohort on an exam.
 * Used so partial publish only exposes approved-and-published subjects to students.
 */
export const getPublishedSubjectIdsForStudentResult = async (
  schoolId: string,
  examId: string,
  result: {
    batchId?: unknown;
    yearId?: unknown;
    classId?: unknown;
    sectionId?: unknown;
  }
): Promise<Set<string>> => {
  const submissions = await ResultSubmission.find({
    schoolId,
    examId,
    status: "PUBLISHED"
  }).lean();

  const ids = new Set<string>();
  for (const submission of submissions) {
    const subjectId = submission.subjectId.toString();
    if (submission.batchId && submission.yearId) {
      if (
        String(submission.batchId) === String(result.batchId ?? "") &&
        String(submission.yearId) === String(result.yearId ?? "")
      ) {
        ids.add(subjectId);
      }
      continue;
    }
    if (submission.classId && submission.sectionId) {
      if (
        String(submission.classId) === String(result.classId ?? "") &&
        String(submission.sectionId) === String(result.sectionId ?? "")
      ) {
        ids.add(subjectId);
      }
      continue;
    }
    ids.add(subjectId);
  }
  return ids;
};

/** Remove subject marks for a submission scope from all student results; recompute totals. */
export const stripSubjectMarksInScope = async (
  schoolId: string,
  scope: SubmissionScope,
  institutionType: InstitutionType
): Promise<{ resultsUpdated: number; resultsDeleted: number }> => {
  const { buildResultTotals } = await import("./examResults.js");
  const students = await getStudentsInScope(schoolId, scope, institutionType);
  const studentIds = students.map((student) => student._id);
  if (studentIds.length === 0) {
    return { resultsUpdated: 0, resultsDeleted: 0 };
  }

  const results = await Result.find({
    schoolId,
    examId: scope.examId,
    studentId: { $in: studentIds }
  });

  let resultsUpdated = 0;
  let resultsDeleted = 0;

  for (const result of results) {
    const hasSubject = result.marks.some(
      (mark) => mark.subjectId.toString() === scope.subjectId
    );
    if (!hasSubject) continue;

    const nextMarks = result.marks.filter(
      (mark) => mark.subjectId.toString() !== scope.subjectId
    );

    if (nextMarks.length === 0) {
      await Result.deleteOne({ _id: result._id });
      resultsDeleted += 1;
      continue;
    }

    const computed = buildResultTotals(
      nextMarks.map((mark) => ({
        obtainedMarks: mark.obtainedMarks ?? 0,
        fullMarks: mark.fullMarks ?? 0,
        passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
      }))
    );

    result.set("marks", nextMarks);
    result.percentage = computed.percentage;
    result.gpa = computed.gpa;
    result.grade = computed.grade;
    result.passFailStatus = computed.passFailStatus;
    await result.save();
    resultsUpdated += 1;
  }

  return { resultsUpdated, resultsDeleted };
};

/**
 * After a subject is unpublished/unapproved, clear publishedAtBs on results
 * that no longer have any published subject marks for that exam.
 */
export const refreshResultPublishedFlagsForExam = async (
  schoolId: string,
  examId: string
): Promise<void> => {
  const results = await Result.find({ schoolId, examId });
  for (const result of results) {
    const publishedSubjects = await getPublishedSubjectIdsForStudentResult(
      schoolId,
      examId,
      result
    );
    const hasPublishedMark = result.marks.some((mark) =>
      publishedSubjects.has(mark.subjectId.toString())
    );
    if (hasPublishedMark) {
      if (!result.publishedAtBs) {
        // Leave unset — publish path sets the date
      }
    } else if (result.publishedAtBs) {
      result.publishedAtBs = undefined;
      await result.save();
    }
  }
};

export const buildScopeLabel = async (
  schoolId: string,
  scope: SubmissionScope,
  institutionType: InstitutionType
): Promise<string> => {
  const subject = await Subject.findOne({ _id: scope.subjectId, schoolId }).lean();
  const subjectName = subject?.name ?? "Subject";

  if (isCollege(institutionType)) {
    const { Batch } = await import("../models/Batch.js");
    const { Year } = await import("../models/Year.js");
    const [batch, year] = await Promise.all([
      scope.batchId ? Batch.findOne({ _id: scope.batchId, schoolId }).lean() : null,
      scope.yearId ? Year.findOne({ _id: scope.yearId, schoolId }).lean() : null
    ]);
    return `${subjectName} — ${batch?.name ?? "Batch"} / ${year?.name ?? "Year"}`;
  }

  const { SchoolClass } = await import("../models/SchoolClass.js");
  const { Section } = await import("../models/Section.js");
  const [schoolClass, section] = await Promise.all([
    scope.classId ? SchoolClass.findOne({ _id: scope.classId, schoolId }).lean() : null,
    scope.sectionId ? Section.findOne({ _id: scope.sectionId, schoolId }).lean() : null
  ]);
  return `${subjectName} — ${schoolClass?.name ?? "Class"} / ${section?.name ?? "Section"}`;
};