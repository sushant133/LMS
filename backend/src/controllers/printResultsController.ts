import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { Batch } from "../models/Batch.js";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { resolveSchoolBranding } from "../utils/schoolBranding.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { buildResultTotals } from "../utils/examResults.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { toCsv } from "../utils/iemisExport.js";
import { assertInstitutionRead } from "../utils/institutionAccess.js";
import { getPublishedSubjectIdsForStudentResult } from "../utils/resultSubmission.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const buildPublishedExamFilter = (req: Request) => {
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, resultsPublished: true };

  if (typeof req.query.academicYearBs === "string" && req.query.academicYearBs) {
    filter.academicYearBs = req.query.academicYearBs;
  }
  if (typeof req.query.examId === "string" && req.query.examId) {
    filter._id = req.query.examId;
  }

  return filter;
};

const round2 = (value: number): number => Number(value.toFixed(2));

interface CohortScope {
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
}

/** Exam-level marks scheme a teacher/admin set for one subject (ResultSubmission). */
interface PublishedSubjectScheme {
  fullMarks: number | null;
  passMarks: number | null;
}

/**
 * Subjects whose results are APPROVED **and** PUBLISHED for this exam + cohort, with the
 * full/pass scheme that was set for the exam. Anything still DRAFT, SUBMITTED_FOR_REVIEW,
 * PENDING_ADMIN_REVIEW, RETURNED_FOR_CORRECTION, or APPROVED-but-not-published is excluded,
 * so the bulk sheet never leaks an unpublished subject as a column.
 * Cohort matching mirrors getPublishedSubjectIdsForStudentResult.
 */
const loadPublishedSubjectSchemes = async (
  schoolId: Types.ObjectId,
  examId: string,
  scope: CohortScope
): Promise<Map<string, PublishedSubjectScheme>> => {
  const submissions = await ResultSubmission.find({
    schoolId,
    examId,
    status: "PUBLISHED"
  }).lean();

  const schemes = new Map<string, PublishedSubjectScheme>();
  for (const submission of submissions) {
    if (submission.batchId && submission.yearId) {
      if (
        String(submission.batchId) !== String(scope.batchId ?? "") ||
        String(submission.yearId) !== String(scope.yearId ?? "")
      ) {
        continue;
      }
    } else if (submission.classId && submission.sectionId) {
      if (
        String(submission.classId) !== String(scope.classId ?? "") ||
        String(submission.sectionId) !== String(scope.sectionId ?? "")
      ) {
        continue;
      }
    }

    const subjectId = submission.subjectId.toString();
    const fullMarks = Number(submission.fullMarks);
    const passMarks = Number(submission.passMarks);
    const scheme: PublishedSubjectScheme = {
      fullMarks: Number.isFinite(fullMarks) && fullMarks > 0 ? fullMarks : null,
      passMarks: Number.isFinite(passMarks) ? passMarks : null
    };

    const existing = schemes.get(subjectId);
    // A subject can have several published cohort rows; keep the one carrying a scheme.
    if (!existing || (existing.fullMarks === null && scheme.fullMarks !== null)) {
      schemes.set(subjectId, scheme);
    }
  }

  return schemes;
};

/**
 * Full/pass marks each subject was actually graded against, read back from the students'
 * published mark rows. Used only when no exam scheme was recorded on the submission.
 * The most frequent value wins so one stray row cannot skew the printed header.
 */
const collectGradedSchemes = (
  results: Array<{ marks: Array<{ subjectId: unknown; fullMarks?: number | null; passMarks?: number | null }> }>
): Map<string, PublishedSubjectScheme> => {
  const tally = new Map<string, Map<string, { full: number; pass: number; count: number }>>();

  for (const result of results) {
    for (const mark of result.marks) {
      const full = Number(mark.fullMarks);
      if (!Number.isFinite(full) || full <= 0) continue;
      const pass = Number(mark.passMarks);
      const subjectId = String(mark.subjectId);
      const key = `${full}/${Number.isFinite(pass) ? pass : ""}`;
      const bySubject = tally.get(subjectId) ?? new Map();
      const entry = bySubject.get(key) ?? {
        full,
        pass: Number.isFinite(pass) ? pass : 0,
        count: 0
      };
      entry.count += 1;
      bySubject.set(key, entry);
      tally.set(subjectId, bySubject);
    }
  }

  const schemes = new Map<string, PublishedSubjectScheme>();
  for (const [subjectId, bySubject] of tally) {
    const top = [...bySubject.values()].sort((left, right) => right.count - left.count)[0];
    if (top) {
      schemes.set(subjectId, { fullMarks: top.full, passMarks: top.pass });
    }
  }

  return schemes;
};

/**
 * Build one column per published subject. Full/pass come from the exam's own scheme
 * (ResultSubmission), then the marks students were actually graded against, and only
 * then the subject configuration — so the sheet prints what the teacher fixed for this
 * exam. The total is split across the Theory/Practical sub-columns using the subject's
 * configured component ratio.
 */
const loadSubjectColumns = async (
  schoolId: Types.ObjectId,
  schemes: Map<string, PublishedSubjectScheme>,
  gradedSchemes: Map<string, PublishedSubjectScheme>
) => {
  const subjectIds = [...schemes.keys()];
  if (subjectIds.length === 0) {
    return [];
  }

  const subjects = await Subject.find({ _id: { $in: subjectIds }, schoolId })
    .sort({ name: 1 })
    .lean();

  return subjects.map((subject) => {
    const subjectId = subject._id.toString();
    const scheme = schemes.get(subjectId);
    const graded = gradedSchemes.get(subjectId);
    const subjectFullMarks = Number(subject.fullMarks) || 0;
    const subjectPassMarks = Number(subject.passMarks) || 0;
    // Exam scheme wins over the subject default — a term exam may be out of 50, not 100.
    const fullMarks = scheme?.fullMarks ?? graded?.fullMarks ?? subjectFullMarks;
    const passMarks = scheme?.passMarks ?? graded?.passMarks ?? subjectPassMarks;

    // Internal marks are printed inside the Theory column, so they count as theory here.
    const theoryConfigured =
      (Number(subject.theoryMarks) || 0) + (Number(subject.internalMarks) || 0);
    const practicalConfigured = Number(subject.practicalMarks) || 0;
    /**
     * Whether a subject splits into Theory/Practical columns is decided ONLY by the
     * subject's own configuration (theoryMarks/practicalMarks) — never by what happens
     * to be stored in a student's marks. A subject with no practical component configured
     * always prints as a single combined column, even if a stray mark record has a
     * nonzero practicalMarks value from before the subject was reconfigured.
     */
    const hasPractical = practicalConfigured > 0;
    // Pure-practical subjects (practical configured, no separate theory marks) omit the
    // Theory column entirely rather than showing a misleading 0.00 full-marks column.
    const hasTheory = theoryConfigured > 0 || !hasPractical;
    const configuredTotal = theoryConfigured + practicalConfigured;

    /**
     * Practical full marks come from the practical configuration scaled to the exam's
     * full marks — never a copy of the theory value. When the exam scheme matches the
     * subject configuration (the usual case) this returns the configured numbers as-is.
     */
    const practicalFullMarks =
      hasPractical && configuredTotal > 0
        ? round2((fullMarks * practicalConfigured) / configuredTotal)
        : 0;
    // Theory takes the remainder so Theory + Practical always equals the exam full marks.
    const theoryFullMarks = hasTheory ? round2(fullMarks - practicalFullMarks) : 0;

    const ratio = fullMarks > 0 ? passMarks / fullMarks : 0;
    const practicalPassMarks =
      practicalFullMarks > 0 ? round2(practicalFullMarks * ratio) : 0;
    const theoryPassMarks =
      theoryFullMarks > 0
        ? hasPractical
          ? round2(passMarks - practicalPassMarks)
          : round2(theoryFullMarks * ratio)
        : 0;

    return {
      subjectId: subject._id.toString(),
      subjectName: subject.name,
      subjectCode: subject.code,
      fullMarks,
      passMarks,
      theoryFullMarks,
      practicalFullMarks,
      theoryPassMarks,
      practicalPassMarks,
      hasTheory,
      hasPractical
    };
  });
};

const buildPrintResultsGrid = async (req: Request) => {
  assertInstitutionRead(req, "Only institution administrators can access print results");
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const examId = typeof req.query.examId === "string" ? req.query.examId : "";
  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";
  const yearId = typeof req.query.yearId === "string" ? req.query.yearId : "";
  const classId = typeof req.query.classId === "string" ? req.query.classId : "";
  const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : "";
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : "";

  if (!examId) {
    throw new ApiError(400, "Exam is required");
  }

  if (college) {
    if (!batchId || !yearId) {
      throw new ApiError(400, "Batch and year are required");
    }
  } else if (!classId || !sectionId) {
    throw new ApiError(400, "Class and section are required");
  }

  const exam = await Exam.findOne({ _id: examId, schoolId, resultsPublished: true }).lean();
  if (!exam) {
    throw new ApiError(404, "Published exam results were not found");
  }

  const studentFilter: Record<string, unknown> = { schoolId };
  if (college) {
    studentFilter.batchId = batchId;
    studentFilter.yearId = yearId;
  } else {
    studentFilter.classId = classId;
    studentFilter.sectionId = sectionId;
  }
  if (studentId) {
    studentFilter._id = studentId;
  }

  const students = await Student.find(studentFilter).populate("user", "fullName").lean();
  const studentIds = students.map((student) => student._id);

  const publishedSchemes = await loadPublishedSubjectSchemes(schoolId, examId, {
    batchId: batchId || undefined,
    yearId: yearId || undefined,
    classId: classId || undefined,
    sectionId: sectionId || undefined
  });

  const results = await Result.find({
    schoolId,
    examId,
    studentId: { $in: studentIds },
    publishedAtBs: { $exists: true, $nin: [null, ""] }
  }).lean();

  // Older results were graded before the per-exam marks scheme existed; their mark rows
  // still carry the full/pass the teacher actually used, so they beat the subject default.
  const gradedSchemes = collectGradedSchemes(results);
  const subjects = await loadSubjectColumns(schoolId, publishedSchemes, gradedSchemes);

  const studentMap = new Map(students.map((student) => [student._id.toString(), student]));
  const subjectOrder = subjects.map((subject) => subject.subjectId);
  // Columns are the single source of truth for what the sheet shows, so marks
  // and totals are all restricted to this set.
  const columnSubjectIds = new Set(subjectOrder);
  const columnFullMarksById = new Map(
    subjects.map((subject) => [subject.subjectId, subject.fullMarks])
  );
  const practicalColumnSubjectIds = new Set(
    subjects.filter((subject) => subject.hasPractical).map((subject) => subject.subjectId)
  );

  const [batch, year, schoolClass, section, branding] = await Promise.all([
    batchId ? Batch.findById(batchId).lean() : null,
    yearId ? Year.findById(yearId).lean() : null,
    classId ? SchoolClass.findById(classId).lean() : null,
    sectionId ? Section.findById(sectionId).lean() : null,
    resolveSchoolBranding(schoolId)
  ]);

  const sortedResults = [...results].sort((left, right) => {
    const leftRoll = studentMap.get(left.studentId.toString())?.rollNumber ?? 0;
    const rightRoll = studentMap.get(right.studentId.toString())?.rollNumber ?? 0;
    return leftRoll - rightRoll;
  });

  // Partial publish: only expose marks for subjects with a PUBLISHED submission,
  // same rule the student marksheet/results-list already enforce.
  const publishedSubjectsByResultId = new Map(
    await Promise.all(
      sortedResults.map(
        async (result) =>
          [
            result._id.toString(),
            await getPublishedSubjectIdsForStudentResult(schoolId.toString(), examId, result)
          ] as const
      )
    )
  );

  const rows = sortedResults
    .map((result, index) => {
      const student = studentMap.get(result.studentId.toString());
      if (!student) {
        return null;
      }

      const publishedSubjectIds = publishedSubjectsByResultId.get(result._id.toString()) ?? new Set<string>();
      const visibleMarks = result.marks.filter((mark) => {
        const subjectId = mark.subjectId.toString();
        return publishedSubjectIds.has(subjectId) && columnSubjectIds.has(subjectId);
      });
      if (visibleMarks.length === 0) {
        return null;
      }

      // Totals cover exactly the published subjects printed above; a mark saved without
      // its own full marks falls back to the column's exam/subject configuration.
      const totals = buildResultTotals(
        visibleMarks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks,
          fullMarks:
            Number(mark.fullMarks) > 0
              ? Number(mark.fullMarks)
              : (columnFullMarksById.get(mark.subjectId.toString()) ?? 0),
          passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
        }))
      );

      const user = student.user as { fullName?: string } | undefined;
      const markBySubject = new Map(
        visibleMarks.map((mark) => [mark.subjectId.toString(), mark])
      );
      const subjectMarks = Object.fromEntries(
        subjectOrder.map((subjectId) => {
          const mark = markBySubject.get(subjectId);
          return [subjectId, mark ? mark.obtainedMarks : null];
        })
      );
      const subjectDetails = Object.fromEntries(
        subjectOrder.map((subjectId) => {
          const mark = markBySubject.get(subjectId);
          if (!mark) {
            return [
              subjectId,
              { theory: null, practical: null, obtained: null }
            ] as const;
          }
          const theory = Number(mark.theoryMarks) || 0;
          const practical = Number(mark.practicalMarks) || 0;
          const internal = Number(mark.internalMarks) || 0;
          const splitsPractical = practicalColumnSubjectIds.has(subjectId);
          /**
           * When components are zero but obtained is set, treat obtained as theory —
           * only for single-column subjects. On a subject that prints Theory and
           * Practical separately, that fallback would repeat the combined total under
           * Theory, so it stays at the recorded theory component.
           */
          const theoryOut =
            theory > 0 || practical > 0 || internal > 0 || splitsPractical
              ? theory + internal
              : mark.obtainedMarks;
          return [
            subjectId,
            {
              theory: theoryOut,
              practical: practical > 0 ? practical : null,
              obtained: mark.obtainedMarks,
              fullMarks: mark.fullMarks,
              passMarks: mark.passMarks
            }
          ] as const;
        })
      );
      const totalMarks = totals.totalObtained;
      const totalFullMarks = totals.totalFull;
      const regNo =
        (student.registrationNumber && String(student.registrationNumber).trim()) ||
        student.admissionNumber ||
        "";

      return {
        sn: index + 1,
        resultId: result._id.toString(),
        examId: result.examId.toString(),
        studentId: result.studentId.toString(),
        studentName: user?.fullName ?? "Student",
        rollNumber: student.rollNumber,
        registrationNumber: regNo,
        symbolNumber: "",
        batchName: batch?.name,
        yearName: year?.name,
        className: schoolClass?.name,
        sectionName: section?.name,
        subjectMarks,
        subjectDetails,
        totalMarks,
        totalFullMarks,
        percentage: totals.percentage,
        grade: totals.grade,
        gpa: totals.gpa,
        passFailStatus: totals.passFailStatus
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    exam: {
      _id: exam._id.toString(),
      name: exam.name,
      academicYearBs: exam.academicYearBs,
      resultsPublished: exam.resultsPublished,
      resultPublishDateBs: exam.resultPublishDateBs
    },
    subjects,
    rows,
    academicYearBs: exam.academicYearBs,
    batchName: batch?.name,
    yearName: year?.name,
    className: schoolClass?.name,
    sectionName: section?.name,
    collegeName: branding.collegeName,
    collegeNameNp: branding.collegeNameNp,
    collegeAddress: branding.collegeAddress,
    collegeLogoUrl: branding.collegeLogoUrl,
    formsSubmitted: rows.length
  };
};

export const getPrintResultsGrid = asyncHandler(async (req: Request, res: Response) => {
  const grid = await buildPrintResultsGrid(req);
  return sendSuccess(res, "Print results grid fetched", grid);
});

export const exportPrintResultsCsv = asyncHandler(async (req: Request, res: Response) => {
  const grid = await buildPrintResultsGrid(req);

  const csvRows = grid.rows.map((row) => ({
    "S.N.": row.sn,
    "Student Name": row.studentName,
    "Roll Number": row.rollNumber,
    "Registration Number": row.registrationNumber,
    ...(grid.batchName ? { Batch: row.batchName ?? grid.batchName } : {}),
    ...(grid.yearName ? { Year: row.yearName ?? grid.yearName } : {}),
    ...(grid.className ? { Class: row.className ?? grid.className } : {}),
    ...(grid.sectionName ? { Section: row.sectionName ?? grid.sectionName } : {}),
    ...Object.fromEntries(
      grid.subjects.map((subject) => [subject.subjectName, row.subjectMarks[subject.subjectId] ?? ""])
    ),
    "Total Marks": `${row.totalMarks}/${row.totalFullMarks}`,
    Percentage: row.percentage,
    Grade: row.grade,
    GPA: row.gpa,
    "Pass/Fail": row.passFailStatus,
    // Remarks stays blank on the report — per-subject teacher notes belong on the
    // individual marksheet, not merged into one column here.
    Remarks: ""
  }));

  const csv = toCsv(csvRows);
  const filename = `print-results-${grid.exam?.name?.replace(/\s+/g, "-") ?? "exam"}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("\uFEFF" + csv);
});

export const listPublishedExams = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req, "Only institution administrators can access print results");
  const exams = await Exam.find(buildPublishedExamFilter(req)).sort({ startDateBs: -1 }).lean();
  return sendSuccess(
    res,
    "Published exams fetched",
    exams.map((exam) => ({
      ...exam,
      _id: exam._id.toString(),
      schoolId: exam.schoolId.toString()
    }))
  );
});

export const getPrintSettings = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req, "Only institution administrators can access print results");
  const branding = await resolveSchoolBranding(tenantObjectId(req));
  return sendSuccess(res, "Print settings fetched", branding);
});