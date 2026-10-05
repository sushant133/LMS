import type { Request, Response } from "express";
import {
  examConfidentialCodeBulkSchema,
  examConfidentialMarkingSchema,
  examConfidentialMarkSchema,
  hasInstitutionAccess,
  resultSchema,
  type ExamConfidentialAdminRow,
  type ExamConfidentialAdminSheet,
  type ExamConfidentialCodeStatus,
  type ExamConfidentialMarkRow,
  type ExamConfidentialMarkSheet
} from "@phit-erp/shared";
import { Exam } from "../models/Exam.js";
import { ExamConfidentialCode, toConfidentialCodeKey } from "../models/ExamConfidentialCode.js";
import { ExamSymbolNumber } from "../models/ExamSymbolNumber.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { Student } from "../models/Student.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { assertInstitutionWrite, isConfidentialEvaluator } from "../utils/institutionAccess.js";
import { sendSuccess } from "../utils/response.js";
import {
  buildSubmissionFilter,
  getStudentsInScope,
  type SubmissionScope
} from "../utils/resultSubmission.js";
import { assertTeacherSubjectAcademicScope } from "../utils/teacherScope.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { persistResultMarks } from "./examController.js";

/** Submission states after which marks count as handed in by the evaluator. */
const SUBMITTED_STATUSES = new Set([
  "SUBMITTED_FOR_REVIEW",
  "PENDING_ADMIN_REVIEW",
  "APPROVED",
  "PUBLISHED"
]);

const queryString = (req: Request, key: string): string | undefined => {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const getExamOrThrow = async (req: Request, examId: string) => {
  const exam = await Exam.findOne(withTenantScope(req, { _id: examId })).lean();
  if (!exam) throw new ApiError(404, "Exam not found");
  return exam;
};

const cohortKey = (
  value: { batchId?: unknown; yearId?: unknown; classId?: unknown; sectionId?: unknown },
  college: boolean
): string =>
  college
    ? `${String(value.batchId ?? "")}:${String(value.yearId ?? "")}`
    : `${String(value.classId ?? "")}:${String(value.sectionId ?? "")}`;

const byCode = (a: { code: string }, b: { code: string }): number =>
  a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" });

/* ------------------------------------------------------------------ */
/* Administrator — the confidential mapping                            */
/* ------------------------------------------------------------------ */

/**
 * GET /exams/:examId/confidential-codes
 * Students of the exam with symbol number, code, evaluation status and marks.
 * Optional cohort filter (batchId+yearId / classId+sectionId) and subjectId.
 */
export const listExamConfidentialCodes = asyncHandler(async (req: Request, res: Response) => {
  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can view confidential codes");
  }
  const examId = String(req.params.examId);
  const exam = await getExamOrThrow(req, examId);
  const schoolId = tenantObjectId(req);
  const college = isCollege(await getInstitutionType(req));
  const subjectId = queryString(req, "subjectId");

  const studentFilter: Record<string, unknown> = { schoolId };
  if (college) {
    if (exam.batchIds?.length) studentFilter.batchId = { $in: exam.batchIds };
    if (exam.yearIds?.length) studentFilter.yearId = { $in: exam.yearIds };
  } else if (exam.classIds?.length) {
    studentFilter.classId = { $in: exam.classIds };
  }
  for (const key of ["batchId", "yearId", "classId", "sectionId"] as const) {
    const value = queryString(req, key);
    if (value) studentFilter[key] = value;
  }

  const students = await Student.find(studentFilter)
    .select("user rollNumber batchId yearId classId sectionId")
    .populate("user", "fullName")
    .lean();
  const studentIds = students.map((student) => student._id);

  const [codes, symbols, results, submissions] = await Promise.all([
    ExamConfidentialCode.find({ schoolId, examId, studentId: { $in: studentIds } }).lean(),
    ExamSymbolNumber.find({ schoolId, examId, studentId: { $in: studentIds } }).lean(),
    Result.find({ schoolId, examId, studentId: { $in: studentIds } })
      .select("studentId marks")
      .lean(),
    subjectId
      ? ResultSubmission.find({ schoolId, examId, subjectId })
          .select("status batchId yearId classId sectionId")
          .lean()
      : Promise.resolve([])
  ]);

  const codeByStudent = new Map(codes.map((row) => [row.studentId.toString(), row]));
  const symbolByStudent = new Map(symbols.map((row) => [row.studentId.toString(), row.symbolNumber]));
  const resultByStudent = new Map(results.map((row) => [row.studentId.toString(), row]));
  const submissionByCohort = new Map(submissions.map((row) => [cohortKey(row, college), row]));

  const rows: ExamConfidentialAdminRow[] = students.map((student) => {
    const id = student._id.toString();
    const codeRow = codeByStudent.get(id);
    const result = resultByStudent.get(id);
    const mark = subjectId
      ? result?.marks.find((item) => item.subjectId.toString() === subjectId)
      : undefined;
    const submission = subjectId ? submissionByCohort.get(cohortKey(student, college)) : undefined;

    let status: ExamConfidentialCodeStatus;
    if (!codeRow) status = "CODE_NOT_ASSIGNED";
    else if (!subjectId) status = "CODE_ASSIGNED";
    else if (mark) {
      status = submission && SUBMITTED_STATUSES.has(submission.status) ? "MARKS_SUBMITTED" : "MARKS_ENTERED";
    } else status = submission ? "MARK_PENDING" : "CODE_ASSIGNED";

    return {
      studentId: id,
      studentName: (student.user as { fullName?: string } | null)?.fullName ?? "Student",
      rollNumber: student.rollNumber ?? undefined,
      symbolNumber: symbolByStudent.get(id),
      code: codeRow?.code,
      status,
      obtainedMarks: mark ? mark.obtainedMarks : null,
      fullMarks: mark ? mark.fullMarks : null,
      attendanceStatus: mark ? (mark.attendanceStatus ?? null) : null,
      subjectsMarked: result?.marks.length ?? 0,
      codeUpdatedAt: codeRow?.updatedAt ? new Date(codeRow.updatedAt).toISOString() : undefined
    };
  });

  rows.sort((a, b) => {
    if (a.symbolNumber && b.symbolNumber) {
      return a.symbolNumber.localeCompare(b.symbolNumber, undefined, { numeric: true });
    }
    if (a.symbolNumber || b.symbolNumber) return a.symbolNumber ? -1 : 1;
    const rollA = a.rollNumber || Number.MAX_SAFE_INTEGER;
    const rollB = b.rollNumber || Number.MAX_SAFE_INTEGER;
    return rollA !== rollB ? rollA - rollB : a.studentName.localeCompare(b.studentName);
  });

  const payload: ExamConfidentialAdminSheet = {
    examId,
    examName: exam.name,
    confidentialMarking: Boolean(exam.confidentialMarking),
    subjectId,
    rows
  };
  return sendSuccess(res, "Confidential codes fetched", payload);
});

/**
 * PUT /exams/:examId/confidential-codes
 * Save hand-entered codes. Only the rows sent are touched; a blank code clears it.
 */
export const saveExamConfidentialCodes = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can assign confidential codes");
  const examId = String(req.params.examId);
  await getExamOrThrow(req, examId);
  const schoolId = tenantObjectId(req);

  const parsed = examConfidentialCodeBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid confidential codes");
  }

  /** Last write wins if a student appears twice in one payload. */
  const byStudent = new Map<string, string>();
  for (const entry of parsed.data.entries) byStudent.set(entry.studentId, entry.code.trim());
  const studentIds = [...byStudent.keys()];

  const known = await Student.countDocuments({ _id: { $in: studentIds }, schoolId });
  if (known !== studentIds.length) {
    throw new ApiError(400, "Some students do not belong to this institution");
  }

  const assignedKeys = new Map<string, string>();
  for (const code of byStudent.values()) {
    if (!code) continue;
    const key = toConfidentialCodeKey(code);
    if (assignedKeys.has(key)) throw new ApiError(400, `Confidential code ${code} is used more than once`);
    assignedKeys.set(key, code);
  }

  if (assignedKeys.size > 0) {
    const clash = await ExamConfidentialCode.findOne({
      schoolId,
      examId,
      studentId: { $nin: studentIds },
      codeKey: { $in: [...assignedKeys.keys()] }
    })
      .select("code")
      .lean();
    if (clash) {
      throw new ApiError(400, `Confidential code ${clash.code} is already assigned in this exam`);
    }
  }

  const before = await ExamConfidentialCode.find({ schoolId, examId, studentId: { $in: studentIds } })
    .select("studentId code")
    .lean();
  const beforeByStudent = new Map(before.map((row) => [row.studentId.toString(), row.code]));
  const changed = studentIds.filter((id) => (beforeByStudent.get(id) ?? "") !== byStudent.get(id));

  // Clear then insert, so swapping two codes inside one save cannot trip the
  // unique index halfway. Restore the old rows if a racing writer wins.
  await ExamConfidentialCode.deleteMany({ schoolId, examId, studentId: { $in: studentIds } });
  const inserts = [...byStudent]
    .filter(([, code]) => Boolean(code))
    .map(([studentId, code]) => ({
      schoolId,
      examId,
      studentId,
      code,
      codeKey: toConfidentialCodeKey(code),
      assignedByUserId: req.user?.userId
    }));
  if (inserts.length > 0) {
    try {
      await ExamConfidentialCode.insertMany(inserts);
    } catch {
      if (before.length > 0) {
        await ExamConfidentialCode.insertMany(
          before.map((row) => ({
            schoolId,
            examId,
            studentId: row.studentId,
            code: row.code,
            codeKey: toConfidentialCodeKey(row.code)
          })),
          { ordered: false }
        ).catch(() => undefined);
      }
      throw new ApiError(409, "Those codes could not be saved — one is already assigned in this exam");
    }
  }

  if (changed.length > 0) {
    await recordAudit(req, {
      action: "exam.confidential_codes_save",
      entity: "ExamConfidentialCode",
      entityId: examId,
      before: changed.map((studentId) => ({ studentId, code: beforeByStudent.get(studentId) ?? null })),
      after: changed.map((studentId) => ({ studentId, code: byStudent.get(studentId) || null }))
    });
  }

  // Allocating codes is the signal that evaluation is anonymous: switch the
  // exam to code-only marking so teachers stop seeing names straight away.
  // The office can still turn it off explicitly afterwards.
  let confidentialMarking = false;
  if (inserts.length > 0) {
    const switched = await Exam.findOneAndUpdate(
      { _id: examId, schoolId, confidentialMarking: { $ne: true } },
      { $set: { confidentialMarking: true } }
    );
    if (switched) {
      await recordAudit(req, {
        action: "exam.confidential_marking_on",
        entity: "Exam",
        entityId: examId,
        before: { confidentialMarking: false },
        after: { confidentialMarking: true, reason: "codes allocated" }
      });
    }
    confidentialMarking = true;
  }

  return sendSuccess(res, "Confidential codes saved", {
    saved: inserts.length,
    changed: changed.length,
    confidentialMarking
  });
});

/** PUT /exams/:examId/confidential-marking — switch code-only evaluation on/off. */
export const setExamConfidentialMarking = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can change confidential marking");
  const { enabled } = examConfidentialMarkingSchema.parse(req.body);
  const examId = String(req.params.examId);
  const exam = await Exam.findOne(withTenantScope(req, { _id: examId }));
  if (!exam) throw new ApiError(404, "Exam not found");

  const before = Boolean(exam.confidentialMarking);
  exam.confidentialMarking = enabled;
  await exam.save();

  if (before !== enabled) {
    await recordAudit(req, {
      action: enabled ? "exam.confidential_marking_on" : "exam.confidential_marking_off",
      entity: "Exam",
      entityId: examId,
      before: { confidentialMarking: before },
      after: { confidentialMarking: enabled }
    });
  }
  return sendSuccess(
    res,
    enabled ? "Confidential marking turned on" : "Confidential marking turned off",
    { examId, confidentialMarking: enabled }
  );
});

/* ------------------------------------------------------------------ */
/* Evaluator — code → marks only                                       */
/* ------------------------------------------------------------------ */

const readScope = (
  examId: string,
  source: Record<string, unknown>
): SubmissionScope => {
  const pick = (key: string) =>
    typeof source[key] === "string" && String(source[key]).trim() ? String(source[key]).trim() : undefined;
  return {
    examId,
    subjectId: pick("subjectId") ?? "",
    batchId: pick("batchId"),
    yearId: pick("yearId"),
    classId: pick("classId"),
    sectionId: pick("sectionId")
  };
};

/**
 * Evaluators (teachers, principals who teach, …): own subject + cohort only.
 * Administrators: institution access for read, write for save.
 */
const assertEvaluatorAccess = async (req: Request, scope: SubmissionScope, write: boolean) => {
  if (!scope.subjectId) throw new ApiError(400, "subjectId is required");
  if (isConfidentialEvaluator(req)) {
    await assertTeacherSubjectAcademicScope(req, scope.subjectId, scope);
    return;
  }
  if (write) assertInstitutionWrite(req, "Only teachers or administrators can enter marks");
  else if (!hasInstitutionAccess(req.user?.role ?? "")) {
    throw new ApiError(403, "You do not have permission to view these marks");
  }
};

const assertConfidentialExam = async (req: Request, examId: string) => {
  const exam = await getExamOrThrow(req, examId);
  if (!exam.confidentialMarking) {
    throw new ApiError(400, "Confidential marking is not turned on for this exam");
  }
  return exam;
};

/**
 * GET /exams/:examId/confidential-sheet?subjectId&batchId&yearId (or classId&sectionId)
 * The evaluator's view: codes and marks for one subject + cohort. No student
 * id, name, roll or symbol number ever leaves this endpoint.
 */
export const getConfidentialMarkSheet = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  const exam = await assertConfidentialExam(req, examId);
  const scope = readScope(examId, req.query as Record<string, unknown>);
  await assertEvaluatorAccess(req, scope, false);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const students = await getStudentsInScope(schoolId.toString(), scope, institutionType);
  const studentIds = students.map((student) => student._id);

  const [codes, results, submission] = await Promise.all([
    ExamConfidentialCode.find({ schoolId, examId, studentId: { $in: studentIds } })
      .select("studentId code")
      .lean(),
    Result.find({ schoolId, examId, studentId: { $in: studentIds } })
      .select("studentId marks")
      .lean(),
    ResultSubmission.findOne(buildSubmissionFilter(schoolId.toString(), scope)).lean()
  ]);

  const resultByStudent = new Map(results.map((row) => [row.studentId.toString(), row]));
  const rows: ExamConfidentialMarkRow[] = codes
    .map((codeRow) => {
      const mark = resultByStudent
        .get(codeRow.studentId.toString())
        ?.marks.find((item) => item.subjectId.toString() === scope.subjectId);
      return {
        code: codeRow.code,
        hasMarks: Boolean(mark),
        theoryMarks: mark?.theoryMarks ?? null,
        practicalMarks: mark?.practicalMarks ?? null,
        obtainedMarks: mark?.obtainedMarks ?? null,
        grade: mark?.grade ?? null,
        passFail: mark?.passFail ?? null,
        attendanceStatus: mark?.attendanceStatus ?? null,
        teacherRemarks: mark?.teacherRemarks ?? null
      };
    })
    .sort(byCode);

  const marksSchemeConfigured =
    typeof submission?.fullMarks === "number" &&
    submission.fullMarks > 0 &&
    typeof submission.passMarks === "number";

  const payload: ExamConfidentialMarkSheet = {
    examId,
    examName: exam.name,
    subjectId: scope.subjectId,
    submissionStatus: submission?.status ?? "DRAFT",
    fullMarks: marksSchemeConfigured ? submission?.fullMarks ?? undefined : undefined,
    passMarks: marksSchemeConfigured ? submission?.passMarks ?? undefined : undefined,
    marksSchemeConfigured,
    uncodedCount: students.length - codes.length,
    rows
  };
  return sendSuccess(res, "Confidential mark sheet fetched", payload);
});

/**
 * POST /exams/:examId/confidential-marks
 * Marks against a code. The code is resolved to the student here, on the
 * server, and stored through the normal result pipeline (scheme, submission
 * workflow, audit) — the evaluator never learns who it was.
 */
export const saveConfidentialMark = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  await assertConfidentialExam(req, examId);
  const input = examConfidentialMarkSchema.parse(req.body);
  const scope: SubmissionScope = {
    examId,
    subjectId: input.subjectId,
    batchId: input.batchId,
    yearId: input.yearId,
    classId: input.classId,
    sectionId: input.sectionId
  };
  await assertEvaluatorAccess(req, scope, true);

  const schoolId = tenantObjectId(req);
  const college = isCollege(await getInstitutionType(req));
  const codeRow = await ExamConfidentialCode.findOne({
    schoolId,
    examId,
    codeKey: toConfidentialCodeKey(input.code)
  }).lean();

  // Same answer for "no such code" and "code from another cohort", so the
  // endpoint cannot be used to probe which codes exist elsewhere.
  const notFound = new ApiError(404, `Code ${input.code} is not on this ${college ? "batch/year" : "class/section"} sheet`);
  if (!codeRow) throw notFound;
  const inCohort = await Student.exists({
    _id: codeRow.studentId,
    schoolId,
    ...(college
      ? { batchId: scope.batchId, yearId: scope.yearId }
      : { classId: scope.classId, sectionId: scope.sectionId })
  });
  if (!inCohort) throw notFound;

  const submission = await ResultSubmission.findOne(buildSubmissionFilter(schoolId.toString(), scope))
    .select("fullMarks passMarks")
    .lean();
  if (typeof submission?.fullMarks !== "number" || typeof submission.passMarks !== "number") {
    throw new ApiError(400, "Set Full Marks and Pass Marks for this subject before entering marks");
  }

  const payload = resultSchema.parse({
    examId,
    studentId: codeRow.studentId.toString(),
    batchId: scope.batchId,
    yearId: scope.yearId,
    classId: scope.classId,
    sectionId: scope.sectionId,
    marks: [
      {
        subjectId: input.subjectId,
        fullMarks: submission.fullMarks,
        passMarks: submission.passMarks,
        theoryMarks: input.theoryMarks,
        practicalMarks: input.practicalMarks,
        attendanceStatus: input.attendanceStatus,
        teacherRemarks: input.teacherRemarks ?? ""
      }
    ]
  });

  const result = await persistResultMarks(req, payload, {
    trackSubmission: true,
    skipScopeCheck: !isConfidentialEvaluator(req)
  });
  const mark = result.marks.find((item) => item.subjectId.toString() === input.subjectId);

  await recordAudit(req, {
    action: "exam.confidential_mark_entry",
    entity: "ExamConfidentialCode",
    entityId: codeRow._id.toString(),
    after: {
      examId,
      subjectId: input.subjectId,
      code: codeRow.code,
      obtainedMarks: mark?.obtainedMarks ?? null,
      attendanceStatus: mark?.attendanceStatus ?? null
    }
  });

  const row: ExamConfidentialMarkRow = {
    code: codeRow.code,
    hasMarks: Boolean(mark),
    theoryMarks: mark?.theoryMarks ?? null,
    practicalMarks: mark?.practicalMarks ?? null,
    obtainedMarks: mark?.obtainedMarks ?? null,
    grade: mark?.grade ?? null,
    passFail: mark?.passFail ?? null,
    attendanceStatus: mark?.attendanceStatus ?? null,
    teacherRemarks: mark?.teacherRemarks ?? null
  };
  return sendSuccess(res, `Marks saved for ${codeRow.code}`, row);
});
