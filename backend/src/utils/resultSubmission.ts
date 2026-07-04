import type { InstitutionType, ResultSubmissionStatus } from "@nepal-school-erp/shared";
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
  if (exam.resultsLocked) {
    throw new ApiError(403, "Results are locked. Contact the college admin to unlock before editing.");
  }

  if (!TEACHER_EDITABLE_STATUSES.includes(submission.status as ResultSubmissionStatus)) {
    throw new ApiError(
      403,
      "Marks cannot be edited while results are pending admin review or approved. Wait for admin feedback or contact the college admin."
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
  const admins = await User.find({ schoolId, role: "COLLEGE_ADMIN", isActive: true }).select("_id").lean();

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