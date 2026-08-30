import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { Batch } from "../models/Batch.js";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { buildResultTotals } from "../utils/examResults.js";
import { assertInstitutionRead } from "../utils/institutionAccess.js";
import { toCsv } from "../utils/iemisExport.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

/**
 * Exam Records — the administration's read-only history of past exams.
 *
 * Marks live in `Result`, keyed by exam + student, and are never removed when a newer
 * term is created. These endpoints let the office pick a cohort (college: batch + year,
 * school: class + section) and read back any completed term on its own — First Term while
 * the Third Term is still being scheduled, for example — or follow one student across
 * every term they have sat.
 *
 * Nothing here writes. Corrections still go through Enter Marks / the approval workflow.
 */

interface CohortScope {
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
}

const readCohortScope = (req: Request): CohortScope => {
  const read = (key: string) => {
    const value = req.query[key];
    return typeof value === "string" && value ? value : undefined;
  };
  return {
    batchId: read("batchId"),
    yearId: read("yearId"),
    classId: read("classId"),
    sectionId: read("sectionId")
  };
};

const cohortResultFilter = (schoolId: Types.ObjectId, scope: CohortScope) => {
  const filter: Record<string, unknown> = { schoolId };
  if (scope.batchId) filter.batchId = scope.batchId;
  if (scope.yearId) filter.yearId = scope.yearId;
  if (scope.classId) filter.classId = scope.classId;
  if (scope.sectionId) filter.sectionId = scope.sectionId;
  return filter;
};

const positive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Subject ids released to students for this exam + cohort. */
const loadPublishedSubjectIds = async (
  schoolId: Types.ObjectId,
  examId: string,
  scope: CohortScope
) => {
  const submissions = await ResultSubmission.find({
    schoolId,
    examId,
    status: "PUBLISHED"
  })
    .select("subjectId batchId yearId classId sectionId fullMarks passMarks")
    .lean();

  const ids = new Set<string>();
  const schemes = new Map<string, { fullMarks: number | null; passMarks: number | null }>();

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
    ids.add(subjectId);
    const scheme = {
      fullMarks: positive(submission.fullMarks),
      passMarks: Number.isFinite(Number(submission.passMarks)) ? Number(submission.passMarks) : null
    };
    const existing = schemes.get(subjectId);
    if (!existing || (existing.fullMarks === null && scheme.fullMarks !== null)) {
      schemes.set(subjectId, scheme);
    }
  }

  return { ids, schemes };
};

/**
 * GET /exams/records/exams
 *
 * Every exam this cohort has marks for — First Term, Second Term, … — newest first,
 * each with enough summary to pick the one to open.
 */
export const listCohortExamRecords = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req, "Only institution administrators can view exam records");
  const schoolId = tenantObjectId(req);
  const scope = readCohortScope(req);

  const hasScope = Boolean(
    (scope.batchId && scope.yearId) || (scope.classId && scope.sectionId)
  );
  if (!hasScope) {
    throw new ApiError(400, "Select a batch and year (or class and section) first");
  }

  const results = await Result.find(cohortResultFilter(schoolId, scope))
    .select("examId studentId marks percentage passFailStatus publishedAtBs")
    .lean();

  if (results.length === 0) {
    return sendSuccess(res, "Exam records fetched", []);
  }

  const examIds = [...new Set(results.map((result) => result.examId.toString()))];
  const academicYearBs =
    typeof req.query.academicYearBs === "string" && req.query.academicYearBs
      ? req.query.academicYearBs
      : undefined;

  const exams = await Exam.find({
    _id: { $in: examIds },
    schoolId,
    ...(academicYearBs ? { academicYearBs } : {})
  }).lean();

  const resultsByExam = new Map<string, typeof results>();
  for (const result of results) {
    const key = result.examId.toString();
    const bucket = resultsByExam.get(key) ?? [];
    bucket.push(result);
    resultsByExam.set(key, bucket);
  }

  const rows = await Promise.all(
    exams.map(async (exam) => {
      const examId = exam._id.toString();
      const examResults = resultsByExam.get(examId) ?? [];
      const { ids: publishedSubjectIds } = await loadPublishedSubjectIds(schoolId, examId, scope);

      const subjectIds = new Set<string>();
      let passCount = 0;
      let percentageSum = 0;
      let releasedCount = 0;

      for (const result of examResults) {
        for (const mark of result.marks) {
          subjectIds.add(String(mark.subjectId));
        }
        if (result.passFailStatus === "PASS") passCount += 1;
        percentageSum += result.percentage ?? 0;
        if (result.publishedAtBs) releasedCount += 1;
      }

      return {
        examId,
        examName: exam.name,
        academicYearBs: exam.academicYearBs,
        startDateBs: exam.startDateBs,
        endDateBs: exam.endDateBs,
        resultPublishDateBs: exam.resultPublishDateBs,
        status: exam.status,
        resultsPublished: Boolean(exam.resultsPublished),
        resultsLocked: Boolean(exam.resultsLocked),
        studentCount: examResults.length,
        /** Students whose marksheet has actually been released to them. */
        releasedStudentCount: releasedCount,
        subjectCount: subjectIds.size,
        publishedSubjectCount: publishedSubjectIds.size,
        passCount,
        failCount: examResults.length - passCount,
        averagePercentage:
          examResults.length > 0
            ? Math.round((percentageSum / examResults.length) * 100) / 100
            : 0
      };
    })
  );

  // Newest term first, so the most recently completed exam is at the top.
  rows.sort((left, right) => {
    const byDate = (right.startDateBs ?? "").localeCompare(left.startDateBs ?? "");
    if (byDate !== 0) return byDate;
    return left.examName.localeCompare(right.examName);
  });

  return sendSuccess(res, "Exam records fetched", rows);
});

/** Full marks grid of one exam for one cohort, shared by the JSON and CSV endpoints. */
const buildCohortExamSheet = async (req: Request) => {
  assertInstitutionRead(req, "Only institution administrators can view exam records");
  const schoolId = tenantObjectId(req);
  const scope = readCohortScope(req);
  const examId = typeof req.query.examId === "string" ? req.query.examId : "";

  if (!examId) {
    throw new ApiError(400, "Exam is required");
  }
  const hasScope = Boolean(
    (scope.batchId && scope.yearId) || (scope.classId && scope.sectionId)
  );
  if (!hasScope) {
    throw new ApiError(400, "Select a batch and year (or class and section) first");
  }

  const exam = await Exam.findOne({ _id: examId, schoolId }).lean();
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }

  const results = await Result.find({
    ...cohortResultFilter(schoolId, scope),
    examId
  }).lean();

  const [students, batch, year, schoolClass, section] = await Promise.all([
    Student.find({
      _id: { $in: results.map((result) => result.studentId) },
      schoolId
    })
      .populate("user", "fullName")
      .lean(),
    scope.batchId ? Batch.findOne({ _id: scope.batchId, schoolId }).lean() : null,
    scope.yearId ? Year.findOne({ _id: scope.yearId, schoolId }).lean() : null,
    scope.classId ? SchoolClass.findOne({ _id: scope.classId, schoolId }).lean() : null,
    scope.sectionId ? Section.findOne({ _id: scope.sectionId, schoolId }).lean() : null
  ]);

  const { ids: publishedSubjectIds, schemes } = await loadPublishedSubjectIds(
    schoolId,
    examId,
    scope
  );

  // Every subject any student in this cohort was marked in — including subjects still
  // unpublished, which are flagged rather than hidden so the office sees the full picture.
  const subjectIds = [
    ...new Set(results.flatMap((result) => result.marks.map((mark) => String(mark.subjectId))))
  ];
  const subjectDocs = await Subject.find({ _id: { $in: subjectIds }, schoolId }).lean();
  const subjectById = new Map(subjectDocs.map((subject) => [subject._id.toString(), subject]));

  const columnFullMarks = new Map<string, number>();
  const subjects = subjectIds
    .map((subjectId) => {
      const subject = subjectById.get(subjectId);
      const scheme = schemes.get(subjectId);
      const gradedRow = results
        .flatMap((result) => result.marks)
        .find((mark) => String(mark.subjectId) === subjectId && positive(mark.fullMarks) !== null);
      // Exam scheme wins over the subject default — a term exam may be out of 50, not 100.
      const fullMarks =
        scheme?.fullMarks ?? positive(gradedRow?.fullMarks) ?? positive(subject?.fullMarks) ?? 0;
      const passMarks =
        scheme?.passMarks ?? Number(gradedRow?.passMarks) ?? Number(subject?.passMarks) ?? 0;
      columnFullMarks.set(subjectId, fullMarks);
      return {
        subjectId,
        subjectName: subject?.name ?? "Subject",
        subjectCode: subject?.code,
        fullMarks,
        passMarks: Number.isFinite(passMarks) ? passMarks : 0,
        published: publishedSubjectIds.has(subjectId)
      };
    })
    .sort((left, right) => left.subjectName.localeCompare(right.subjectName));

  const studentById = new Map(students.map((student) => [student._id.toString(), student]));

  const rows = results
    .map((result) => {
      const student = studentById.get(result.studentId.toString());
      const totals = buildResultTotals(
        result.marks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks,
          fullMarks: positive(mark.fullMarks) ?? columnFullMarks.get(String(mark.subjectId)) ?? 0,
          passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
        }))
      );
      const user = student?.user as { fullName?: string } | undefined;

      return {
        resultId: result._id.toString(),
        studentId: result.studentId.toString(),
        studentName: user?.fullName ?? "Student",
        rollNumber: student?.rollNumber,
        registrationNumber:
          (student?.registrationNumber && String(student.registrationNumber).trim()) ||
          student?.admissionNumber ||
          "",
        /** Whether this student's marksheet has been released to them. */
        released: Boolean(result.publishedAtBs),
        publishedAtBs: result.publishedAtBs,
        marks: Object.fromEntries(
          result.marks.map((mark) => [
            String(mark.subjectId),
            {
              obtainedMarks: mark.obtainedMarks,
              theoryMarks: mark.theoryMarks ?? 0,
              practicalMarks: mark.practicalMarks ?? 0,
              internalMarks: mark.internalMarks ?? 0,
              grade: mark.grade,
              passFail: mark.passFail,
              attendanceStatus: mark.attendanceStatus
            }
          ])
        ),
        totalObtained: totals.totalObtained,
        totalFull: totals.totalFull,
        percentage: totals.percentage,
        gpa: totals.gpa,
        grade: totals.grade,
        passFailStatus: totals.passFailStatus
      };
    })
    .sort((left, right) => (left.rollNumber ?? 0) - (right.rollNumber ?? 0));

  return {
    exam: {
      _id: exam._id.toString(),
      name: exam.name,
      academicYearBs: exam.academicYearBs,
      startDateBs: exam.startDateBs,
      endDateBs: exam.endDateBs,
      resultPublishDateBs: exam.resultPublishDateBs,
      resultsPublished: Boolean(exam.resultsPublished),
      resultsLocked: Boolean(exam.resultsLocked)
    },
    batchName: batch?.name,
    yearName: year?.name,
    className: schoolClass?.name,
    sectionName: section?.name,
    subjects,
    rows
  };
};

export const getCohortExamSheet = asyncHandler(async (req: Request, res: Response) => {
  const sheet = await buildCohortExamSheet(req);
  return sendSuccess(res, "Exam record fetched", sheet);
});

export const exportCohortExamSheetCsv = asyncHandler(async (req: Request, res: Response) => {
  const sheet = await buildCohortExamSheet(req);

  const csvRows = sheet.rows.map((row, index) => ({
    "S.N.": index + 1,
    "Student Name": row.studentName,
    "Roll Number": row.rollNumber ?? "",
    "Registration Number": row.registrationNumber,
    ...(sheet.batchName ? { Batch: sheet.batchName } : {}),
    ...(sheet.yearName ? { Year: sheet.yearName } : {}),
    ...(sheet.className ? { Class: sheet.className } : {}),
    ...(sheet.sectionName ? { Section: sheet.sectionName } : {}),
    ...Object.fromEntries(
      sheet.subjects.map((subject) => [
        `${subject.subjectName} (${subject.fullMarks})`,
        row.marks[subject.subjectId]?.obtainedMarks ?? ""
      ])
    ),
    "Total Marks": `${row.totalObtained}/${row.totalFull}`,
    Percentage: row.percentage,
    GPA: row.gpa,
    Grade: row.grade,
    "Pass/Fail": row.passFailStatus,
    "Released To Student": row.released ? "Yes" : "No"
  }));

  const safe = (value: string) => value.replace(/\s+/g, "-");
  const cohort = [sheet.yearName, sheet.batchName, sheet.className, sheet.sectionName]
    .filter(Boolean)
    .join("-");
  const filename = `exam-record-${safe(sheet.exam.name)}${cohort ? `-${safe(cohort)}` : ""}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Leading BOM so Excel opens the Devanagari columns as UTF-8.
  return res.send(String.fromCharCode(0xfeff) + toCsv(csvRows));
});

/**
 * GET /exams/records/student
 *
 * One student's whole exam history — every term they have sat, newest first, with the
 * per-subject marks and the totals of each. Used for term-over-term comparison when a
 * department queries a single student's progress or disputes a mark.
 */
export const getStudentExamHistory = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req, "Only institution administrators can view exam records");
  const schoolId = tenantObjectId(req);
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : "";

  if (!studentId) {
    throw new ApiError(400, "Student is required");
  }

  const student = await Student.findOne({ _id: studentId, schoolId })
    .populate("user", "fullName")
    .lean();
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const results = await Result.find({ schoolId, studentId }).lean();
  const examIds = [...new Set(results.map((result) => result.examId.toString()))];

  const [exams, batch, year, schoolClass, section] = await Promise.all([
    examIds.length ? Exam.find({ _id: { $in: examIds }, schoolId }).lean() : Promise.resolve([]),
    student.batchId ? Batch.findOne({ _id: student.batchId, schoolId }).lean() : null,
    student.yearId ? Year.findOne({ _id: student.yearId, schoolId }).lean() : null,
    student.classId ? SchoolClass.findOne({ _id: student.classId, schoolId }).lean() : null,
    student.sectionId ? Section.findOne({ _id: student.sectionId, schoolId }).lean() : null
  ]);

  const examById = new Map(exams.map((exam) => [exam._id.toString(), exam]));
  const subjectIds = [
    ...new Set(results.flatMap((result) => result.marks.map((mark) => String(mark.subjectId))))
  ];
  const subjects = subjectIds.length
    ? await Subject.find({ _id: { $in: subjectIds }, schoolId }).lean()
    : [];
  const subjectById = new Map(subjects.map((subject) => [subject._id.toString(), subject]));

  const history = results
    .map((result) => {
      const exam = examById.get(result.examId.toString());
      if (!exam) return null;

      const totals = buildResultTotals(
        result.marks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks,
          fullMarks: positive(mark.fullMarks) ?? positive(subjectById.get(String(mark.subjectId))?.fullMarks) ?? 0,
          passFail: (mark.passFail ?? "FAIL") as "PASS" | "FAIL"
        }))
      );

      return {
        examId: result.examId.toString(),
        examName: exam.name,
        academicYearBs: exam.academicYearBs,
        startDateBs: exam.startDateBs,
        resultPublishDateBs: exam.resultPublishDateBs,
        released: Boolean(result.publishedAtBs),
        publishedAtBs: result.publishedAtBs,
        marks: result.marks.map((mark) => {
          const subjectId = String(mark.subjectId);
          const subject = subjectById.get(subjectId);
          return {
            subjectId,
            subjectName: subject?.name ?? "Subject",
            subjectCode: subject?.code,
            fullMarks: positive(mark.fullMarks) ?? positive(subject?.fullMarks) ?? 0,
            passMarks: Number(mark.passMarks) || Number(subject?.passMarks) || 0,
            obtainedMarks: mark.obtainedMarks,
            grade: mark.grade,
            passFail: mark.passFail,
            attendanceStatus: mark.attendanceStatus
          };
        }),
        totalObtained: totals.totalObtained,
        totalFull: totals.totalFull,
        percentage: totals.percentage,
        gpa: totals.gpa,
        grade: totals.grade,
        passFailStatus: totals.passFailStatus
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => (right.startDateBs ?? "").localeCompare(left.startDateBs ?? ""));

  const user = student.user as { fullName?: string } | undefined;

  return sendSuccess(res, "Student exam history fetched", {
    student: {
      studentId: student._id.toString(),
      studentName: user?.fullName ?? "Student",
      rollNumber: student.rollNumber,
      registrationNumber:
        (student.registrationNumber && String(student.registrationNumber).trim()) ||
        student.admissionNumber ||
        "",
      batchName: batch?.name,
      yearName: year?.name,
      className: schoolClass?.name,
      sectionName: section?.name
    },
    exams: history
  });
});
