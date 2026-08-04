import type { Request, Response } from "express";
import {
  computeSubjectMark,
  hasInstitutionAccess,
  resultMarksSchemeSchema,
  resultSubmissionReviewSchema,
  resultSubmissionScopeSchema
} from "@phit-erp/shared";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { AuditLog } from "../models/AuditLog.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getInstitutionType } from "../utils/institution.js";
import {
  assertTeacherCanEditSubmission,
  buildScopeLabel,
  buildSubmissionFilter,
  getMarksCoverage,
  getOrCreateSubmission,
  getStudentsInScope,
  notifySchoolAdmins,
  notifyTeacherOfSubmissionUpdate,
  refreshResultPublishedFlagsForExam,
  stripSubjectMarksInScope,
  type SubmissionScope
} from "../utils/resultSubmission.js";
import {
  assertTeacherAcademicScope,
  assertTeacherSubjectAcademicScope,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { recordAudit } from "../utils/audit.js";
import { assertInstitutionWrite } from "../utils/institutionAccess.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { buildResultTotals } from "../utils/examResults.js";

const parseScope = (req: Request): SubmissionScope => {
  const payload = resultSubmissionScopeSchema.parse(req.body);
  return {
    examId: payload.examId,
    subjectId: payload.subjectId,
    classId: payload.classId,
    sectionId: payload.sectionId,
    batchId: payload.batchId,
    yearId: payload.yearId
  };
};

const assertTeacherScopeForSubmission = async (req: Request, scope: SubmissionScope): Promise<void> => {
  const teacherScope = await requireTeacherScope(req);
  if (!teacherScope.subjectIds.includes(scope.subjectId)) {
    throw new ApiError(403, "You can only manage results for your assigned subjects");
  }

  await assertTeacherSubjectAcademicScope(req, scope.subjectId, scope);
  await assertTeacherAcademicScope(req, scope);
};

export const listResultSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const filter: Record<string, unknown> = { schoolId };

  if (typeof req.query.examId === "string") filter.examId = req.query.examId;
  if (typeof req.query.status === "string") filter.status = req.query.status;
  if (typeof req.query.subjectId === "string") filter.subjectId = req.query.subjectId;
  if (typeof req.query.batchId === "string") filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") filter.yearId = req.query.yearId;
  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    filter.subjectId = { $in: teacherScope.subjectIds };
    if (teacherScope.batchIds.length) {
      filter.batchId = { $in: teacherScope.batchIds };
    }
    if (teacherScope.yearIds.length) {
      filter.yearId = { $in: teacherScope.yearIds };
    }
    if (teacherScope.classIds.length) {
      filter.classId = { $in: teacherScope.classIds };
    }
    if (teacherScope.sectionIds.length) {
      filter.sectionId = { $in: teacherScope.sectionIds };
    }
  } else if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "You do not have permission to view result submissions");
  }

  const submissions = await ResultSubmission.find(filter).sort({ updatedAt: -1 }).lean();

  const enriched = await Promise.all(
    submissions.map(async (submission) => {
      const scope: SubmissionScope = {
        examId: submission.examId.toString(),
        subjectId: submission.subjectId.toString(),
        classId: submission.classId?.toString(),
        sectionId: submission.sectionId?.toString(),
        batchId: submission.batchId?.toString(),
        yearId: submission.yearId?.toString()
      };
      const coverage = await getMarksCoverage(schoolId.toString(), scope, institutionType);
      const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);
      const exam = await Exam.findOne({ _id: submission.examId, schoolId }).lean();

      return {
        ...submission,
        examName: exam?.name ?? "Exam",
        scopeLabel,
        studentsTotal: coverage.studentsTotal,
        marksEntered: coverage.marksEntered,
        missingStudents: coverage.missingStudents
      };
    })
  );

  return sendSuccess(res, "Result submissions fetched", enriched);
});

/**
 * Teacher sets Full Marks and Pass Marks once for this exam + subject + cohort.
 * Existing student mark rows for the subject are updated to the new scheme.
 */
export const setResultMarksScheme = asyncHandler(async (req: Request, res: Response) => {
  const role = req.user?.role;
  if (role !== "TEACHER" && role !== "COLLEGE_ADMIN" && role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only teachers or administrators can set full and pass marks for mark entry");
  }

  const payload = resultMarksSchemeSchema.parse(req.body);
  const scope: SubmissionScope = {
    examId: payload.examId,
    subjectId: payload.subjectId,
    classId: payload.classId,
    sectionId: payload.sectionId,
    batchId: payload.batchId,
    yearId: payload.yearId
  };

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);

  if (role === "TEACHER") {
    await assertTeacherScopeForSubmission(req, scope);
  } else {
    assertInstitutionWrite(req);
  }

  const exam = await Exam.findOne({ _id: scope.examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const submission = await getOrCreateSubmission(schoolId.toString(), scope, req.user!.userId);
  assertTeacherCanEditSubmission(submission, exam);

  const before = submission.toObject();
  submission.fullMarks = payload.fullMarks;
  submission.passMarks = payload.passMarks;
  submission.marksSchemeSetAt = new Date();
  if (!submission.enteredByUserId) {
    submission.enteredByUserId = req.user!.userId as never;
  }
  await submission.save();

  // Propagate scheme to any existing student marks for this subject in scope
  const students = await getStudentsInScope(schoolId.toString(), scope, institutionType);
  const studentIds = students.map((student) => student._id);
  if (studentIds.length > 0) {
    const results = await Result.find({
      schoolId,
      examId: scope.examId,
      studentId: { $in: studentIds }
    });

    for (const result of results) {
      let changed = false;
      const nextMarks = result.marks.map((mark) => {
        if (mark.subjectId.toString() !== scope.subjectId) {
          return {
            subjectId: mark.subjectId,
            fullMarks: mark.fullMarks,
            passMarks: mark.passMarks,
            theoryMarks: mark.theoryMarks ?? 0,
            practicalMarks: mark.practicalMarks ?? 0,
            internalMarks: mark.internalMarks ?? 0,
            obtainedMarks: mark.obtainedMarks,
            attendanceStatus: mark.attendanceStatus ?? "PRESENT",
            teacherRemarks: mark.teacherRemarks,
            percentage: mark.percentage,
            grade: mark.grade,
            passFail: mark.passFail
          };
        }
        changed = true;
        const recomputed = computeSubjectMark({
          subjectId: mark.subjectId.toString(),
          fullMarks: payload.fullMarks,
          passMarks: payload.passMarks,
          theoryMarks: mark.theoryMarks ?? 0,
          practicalMarks: mark.practicalMarks ?? 0,
          internalMarks: mark.internalMarks ?? 0,
          attendanceStatus: mark.attendanceStatus ?? "PRESENT",
          teacherRemarks: mark.teacherRemarks ?? undefined,
          obtainedMarks: 0
        });
        return {
          subjectId: mark.subjectId,
          fullMarks: recomputed.fullMarks,
          passMarks: recomputed.passMarks,
          theoryMarks: recomputed.theoryMarks ?? 0,
          practicalMarks: recomputed.practicalMarks ?? 0,
          internalMarks: recomputed.internalMarks ?? 0,
          obtainedMarks: recomputed.obtainedMarks,
          attendanceStatus: recomputed.attendanceStatus ?? "PRESENT",
          teacherRemarks: recomputed.teacherRemarks,
          percentage: recomputed.percentage,
          grade: recomputed.grade,
          passFail: recomputed.passFail
        };
      });

      if (!changed) continue;

      const totals = buildResultTotals(
        nextMarks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks ?? 0,
          fullMarks: mark.fullMarks ?? 0,
          passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
        }))
      );

      result.set("marks", nextMarks);
      result.percentage = totals.percentage;
      result.gpa = totals.gpa;
      result.grade = totals.grade;
      result.passFailStatus = totals.passFailStatus;
      await result.save();
    }
  }

  await recordAudit(req, {
    action: "result.set_marks_scheme",
    entity: "ResultSubmission",
    entityId: submission._id.toString(),
    before,
    after: submission.toObject()
  });

  const coverage = await getMarksCoverage(schoolId.toString(), scope, institutionType);
  const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);

  return sendSuccess(res, "Full marks and pass marks saved for this exam subject", {
    ...submission.toObject(),
    examName: exam.name,
    scopeLabel,
    marksSchemeConfigured: true,
    ...coverage
  });
});

export const submitResultForReview = asyncHandler(async (req: Request, res: Response) => {
  const role = req.user?.role;
  if (role !== "TEACHER" && role !== "COLLEGE_ADMIN" && role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only teachers or administrators can submit results for review");
  }

  const scope = parseScope(req);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);

  if (role === "TEACHER") {
    await assertTeacherScopeForSubmission(req, scope);
  } else {
    assertInstitutionWrite(req);
  }

  const exam = await Exam.findOne({ _id: scope.examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const submission = await getOrCreateSubmission(schoolId.toString(), scope, req.user!.userId);
  assertTeacherCanEditSubmission(submission, exam);

  const coverage = await getMarksCoverage(schoolId.toString(), scope, institutionType);

  if (coverage.missingStudents.length > 0) {
    const names = coverage.missingStudents.map((item) => item.studentName).join(", ");
    throw new ApiError(
      400,
      `Marks are missing for ${coverage.missingStudents.length} student(s): ${names}. Complete all entries before submitting.`
    );
  }

  if (coverage.studentsTotal === 0) {
    throw new ApiError(400, "No students found in this batch/year. Cannot submit results.");
  }

  const before = submission.toObject();
  submission.status = "PENDING_ADMIN_REVIEW";
  submission.submittedByUserId = req.user!.userId as never;
  submission.submittedAt = new Date();
  submission.reviewComments = undefined;
  await submission.save();

  await recordAudit(req, {
    action: "result.submit_for_review",
    entity: "ResultSubmission",
    entityId: submission._id.toString(),
    before,
    after: submission.toObject()
  });

  const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);
  await notifySchoolAdmins(
    req,
    "Results pending review",
    `Results for "${exam.name}" (${scopeLabel}) have been submitted and are waiting for your review.`,
    { examId: scope.examId, submissionId: submission._id.toString() }
  );

  return sendSuccess(res, "Results submitted for admin review", submission);
});

export const approveResultSubmission = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req);
  const submissionId = String(req.params.submissionId);
  const { comments } = resultSubmissionReviewSchema.parse(req.body ?? {});

  const submission = await ResultSubmission.findOne(withTenantScope(req, { _id: submissionId }));
  if (!submission) {
    throw new ApiError(404, "Result submission not found");
  }

  if (submission.status !== "PENDING_ADMIN_REVIEW" && submission.status !== "SUBMITTED_FOR_REVIEW") {
    throw new ApiError(400, "Only submissions pending admin review can be approved");
  }

  const exam = await Exam.findOne({ _id: submission.examId, schoolId: tenantObjectId(req) });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const before = submission.toObject();
  submission.status = "APPROVED";
  submission.approvedByUserId = req.user!.userId as never;
  submission.approvedAt = new Date();
  submission.reviewedByUserId = req.user!.userId as never;
  submission.reviewedAt = new Date();
  if (comments) {
    submission.reviewComments = comments;
  }
  await submission.save();

  await recordAudit(req, {
    action: "result.approve",
    entity: "ResultSubmission",
    entityId: submission._id.toString(),
    before,
    after: submission.toObject()
  });

  if (submission.submittedByUserId) {
    const scope: SubmissionScope = {
      examId: submission.examId.toString(),
      subjectId: submission.subjectId.toString(),
      classId: submission.classId?.toString(),
      sectionId: submission.sectionId?.toString(),
      batchId: submission.batchId?.toString(),
      yearId: submission.yearId?.toString()
    };
    const institutionType = await getInstitutionType(req);
    const scopeLabel = await buildScopeLabel(tenantObjectId(req).toString(), scope, institutionType);
    await notifyTeacherOfSubmissionUpdate(
      tenantObjectId(req).toString(),
      submission.submittedByUserId.toString(),
      "Results approved",
      `Your submitted results for "${exam.name}" (${scopeLabel}) have been approved by the college admin.`,
      { examId: submission.examId.toString(), submissionId: submission._id.toString() }
    );
  }

  return sendSuccess(res, "Results approved", submission);
});

/**
 * Return / unapprove a subject submission so the teacher can correct marks.
 * Allowed from pending review, approved, or published (unapproves + unpublishes that subject).
 */
export const returnResultSubmission = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req);
  const submissionId = String(req.params.submissionId);
  const { comments } = resultSubmissionReviewSchema.parse(req.body);

  if (!comments?.trim()) {
    throw new ApiError(400, "Comments are required when returning results for correction");
  }

  const submission = await ResultSubmission.findOne(withTenantScope(req, { _id: submissionId }));
  if (!submission) {
    throw new ApiError(404, "Result submission not found");
  }

  const returnableStatuses = new Set([
    "PENDING_ADMIN_REVIEW",
    "SUBMITTED_FOR_REVIEW",
    "APPROVED",
    "PUBLISHED"
  ]);
  if (!returnableStatuses.has(submission.status)) {
    throw new ApiError(
      400,
      "This submission cannot be returned for correction (already draft or returned)"
    );
  }

  const schoolId = tenantObjectId(req);
  const exam = await Exam.findOne({ _id: submission.examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const before = submission.toObject();
  const wasApprovedOrPublished =
    submission.status === "APPROVED" || submission.status === "PUBLISHED";
  const wasPublished = submission.status === "PUBLISHED";

  submission.status = "RETURNED_FOR_CORRECTION";
  submission.reviewedByUserId = req.user!.userId as never;
  submission.reviewedAt = new Date();
  submission.reviewComments = comments.trim();
  submission.approvedByUserId = undefined;
  submission.approvedAt = undefined;
  submission.publishedByUserId = undefined;
  submission.publishedAt = undefined;
  await submission.save();

  // If this subject was published, refresh student visibility for remaining published subjects
  if (wasPublished) {
    await refreshResultPublishedFlagsForExam(schoolId.toString(), submission.examId.toString());
    const remainingPublished = await ResultSubmission.countDocuments({
      schoolId,
      examId: submission.examId,
      status: "PUBLISHED"
    });
    if (remainingPublished === 0 && exam.resultsPublished) {
      exam.resultsPublished = false;
      if (exam.status === "PUBLISHED") {
        exam.status = "COMPLETED";
      }
      await exam.save();
    }
  }

  await recordAudit(req, {
    action: wasApprovedOrPublished ? "result.unapprove" : "result.return_for_correction",
    entity: "ResultSubmission",
    entityId: submission._id.toString(),
    before,
    after: submission.toObject()
  });

  if (submission.submittedByUserId) {
    const scope: SubmissionScope = {
      examId: submission.examId.toString(),
      subjectId: submission.subjectId.toString(),
      classId: submission.classId?.toString(),
      sectionId: submission.sectionId?.toString(),
      batchId: submission.batchId?.toString(),
      yearId: submission.yearId?.toString()
    };
    const institutionType = await getInstitutionType(req);
    const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);
    const title = wasApprovedOrPublished
      ? "Results unapproved — correction required"
      : "Results returned for correction";
    await notifyTeacherOfSubmissionUpdate(
      schoolId.toString(),
      submission.submittedByUserId.toString(),
      title,
      `Your results for "${exam.name}" (${scopeLabel}) were ${
        wasApprovedOrPublished ? "unapproved and " : ""
      }returned for correction. Admin comments: ${comments.trim()}`,
      { examId: submission.examId.toString(), submissionId: submission._id.toString() }
    );
  }

  return sendSuccess(
    res,
    wasApprovedOrPublished
      ? "Results unapproved and returned to teacher for correction"
      : "Results returned to teacher for correction",
    submission
  );
});

/**
 * Delete all student marks for a subject/cohort submission and remove the submission.
 * Teacher must re-enter marks and submit again. Requires confirmation token in body.
 */
export const deleteResultSubmissionScope = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req);
  const submissionId = String(req.params.submissionId);
  const confirm = String((req.body as { confirm?: string })?.confirm ?? "").trim().toUpperCase();

  if (confirm !== "DELETE") {
    throw new ApiError(
      400,
      'Confirmation required. Send { "confirm": "DELETE" } to permanently delete these results.'
    );
  }

  const schoolId = tenantObjectId(req);
  const submission = await ResultSubmission.findOne(withTenantScope(req, { _id: submissionId }));
  if (!submission) {
    throw new ApiError(404, "Result submission not found");
  }

  const exam = await Exam.findOne({ _id: submission.examId, schoolId });
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const scope: SubmissionScope = {
    examId: submission.examId.toString(),
    subjectId: submission.subjectId.toString(),
    classId: submission.classId?.toString(),
    sectionId: submission.sectionId?.toString(),
    batchId: submission.batchId?.toString(),
    yearId: submission.yearId?.toString()
  };

  const institutionType = await getInstitutionType(req);
  const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);
  const before = submission.toObject();
  const wasPublished = submission.status === "PUBLISHED";

  const stripStats = await stripSubjectMarksInScope(
    schoolId.toString(),
    scope,
    institutionType
  );

  await ResultSubmission.deleteOne({ _id: submission._id });

  if (wasPublished) {
    await refreshResultPublishedFlagsForExam(schoolId.toString(), scope.examId);
    const remainingPublished = await ResultSubmission.countDocuments({
      schoolId,
      examId: scope.examId,
      status: "PUBLISHED"
    });
    if (remainingPublished === 0 && exam.resultsPublished) {
      exam.resultsPublished = false;
      if (exam.status === "PUBLISHED") {
        exam.status = "COMPLETED";
      }
      await exam.save();
    }
  }

  await recordAudit(req, {
    action: "result.delete_submission_scope",
    entity: "ResultSubmission",
    entityId: submissionId,
    before,
    after: {
      deleted: true,
      scope,
      ...stripStats
    }
  });

  if (submission.submittedByUserId || submission.enteredByUserId) {
    const teacherUserId = (
      submission.submittedByUserId ?? submission.enteredByUserId
    )?.toString();
    if (teacherUserId) {
      await notifyTeacherOfSubmissionUpdate(
        schoolId.toString(),
        teacherUserId,
        "Subject results deleted",
        `Admin deleted all marks for "${exam.name}" (${scopeLabel}). Please re-enter marks and submit again for approval.`,
        { examId: scope.examId, subjectId: scope.subjectId }
      );
    }
  }

  return sendSuccess(res, "Subject results deleted. Teacher must re-enter and resubmit marks.", {
    submissionId,
    scopeLabel,
    ...stripStats
  });
});

export const getResultAuditLog = asyncHandler(async (req: Request, res: Response) => {
  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "Only institution administrators can view result audit logs");
  }

  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = {
    schoolId,
    entity: { $in: ["Result", "ResultSubmission"] }
  };

  if (typeof req.query.examId === "string") {
    filter.$or = [
      { entityId: req.query.examId },
      { "after.examId": req.query.examId },
      { "before.examId": req.query.examId }
    ];
  }

  if (typeof req.query.submissionId === "string") {
    filter.entityId = req.query.submissionId;
    filter.entity = "ResultSubmission";
  }

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return sendSuccess(res, "Result audit log fetched", logs);
});

export const getSubmissionByScope = asyncHandler(async (req: Request, res: Response) => {
  const scope: SubmissionScope = {
    examId: String(req.query.examId ?? ""),
    subjectId: String(req.query.subjectId ?? ""),
    classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
    sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
    batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
    yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined
  };

  if (!scope.examId || !scope.subjectId) {
    throw new ApiError(400, "examId and subjectId are required");
  }

  const schoolId = tenantObjectId(req);
  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    if (!teacherScope.subjectIds.includes(scope.subjectId)) {
      throw new ApiError(403, "You can only view submissions for your assigned subjects");
    }
    await assertTeacherAcademicScope(req, scope);
  } else if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "You do not have permission to view this submission");
  }

  const institutionType = await getInstitutionType(req);
  const coverage = await getMarksCoverage(schoolId.toString(), scope, institutionType);
  const scopeLabel = await buildScopeLabel(schoolId.toString(), scope, institutionType);
  const exam = await Exam.findOne({ _id: scope.examId, schoolId }).lean();

  const filter = buildSubmissionFilter(schoolId.toString(), scope);
  const submission = await ResultSubmission.findOne(filter).lean();

  if (!submission) {
    return sendSuccess(res, "Result submission scope fetched", {
      examId: scope.examId,
      subjectId: scope.subjectId,
      batchId: scope.batchId,
      yearId: scope.yearId,
      classId: scope.classId,
      sectionId: scope.sectionId,
      status: "DRAFT",
      examName: exam?.name ?? "Exam",
      scopeLabel,
      fullMarks: undefined,
      passMarks: undefined,
      marksSchemeConfigured: false,
      ...coverage
    });
  }

  const marksSchemeConfigured =
    typeof submission.fullMarks === "number" &&
    submission.fullMarks > 0 &&
    typeof submission.passMarks === "number";

  return sendSuccess(res, "Result submission fetched", {
    ...submission,
    examName: exam?.name ?? "Exam",
    scopeLabel,
    marksSchemeConfigured,
    ...coverage
  });
});