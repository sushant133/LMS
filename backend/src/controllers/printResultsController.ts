import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { Batch } from "../models/Batch.js";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
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

const loadSubjectColumns = async (schoolId: Types.ObjectId, yearId?: string, classId?: string) => {
  const subjectFilter: Record<string, unknown> = { schoolId };
  if (yearId) {
    subjectFilter.yearIds = yearId;
  } else if (classId) {
    subjectFilter.classIds = classId;
  }

  const subjects = await Subject.find(subjectFilter).sort({ name: 1 }).lean();
  return subjects.map((subject) => {
    const fullMarks = Number(subject.fullMarks) || 0;
    const passMarks = Number(subject.passMarks) || 0;
    const theoryConfigured = Number(subject.theoryMarks) || 0;
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
    const theoryFullMarks = !hasTheory
      ? 0
      : theoryConfigured > 0
        ? theoryConfigured
        : fullMarks;
    const practicalFullMarks = hasPractical ? practicalConfigured : 0;
    const ratio = fullMarks > 0 ? passMarks / fullMarks : 0;
    const theoryPassMarks =
      theoryFullMarks > 0 ? Number((theoryFullMarks * ratio).toFixed(2)) : 0;
    const practicalPassMarks =
      practicalFullMarks > 0 ? Number((practicalFullMarks * ratio).toFixed(2)) : 0;

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

  const [results, subjects] = await Promise.all([
    Result.find({
      schoolId,
      examId,
      studentId: { $in: studentIds },
      publishedAtBs: { $exists: true, $nin: [null, ""] }
    }).lean(),
    loadSubjectColumns(schoolId, yearId || undefined, classId || undefined)
  ]);

  const studentMap = new Map(students.map((student) => [student._id.toString(), student]));
  const subjectOrder = subjects.map((subject) => subject.subjectId);
  const subjectNameById = new Map(subjects.map((subject) => [subject.subjectId, subject.subjectName]));

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
      const visibleMarks = result.marks.filter((mark) => publishedSubjectIds.has(mark.subjectId.toString()));
      if (visibleMarks.length === 0) {
        return null;
      }

      const totals = buildResultTotals(
        visibleMarks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks,
          fullMarks: mark.fullMarks,
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
          // When components are zero but obtained is set, treat obtained as theory.
          const theoryOut =
            theory > 0 || practical > 0 || internal > 0
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
      // Each subject teacher's remark is labeled with its subject so a combined remark
      // on the bulk sheet is never mistaken for a single unexplained/auto-generated note.
      const remarks = visibleMarks
        .map((mark) => {
          const trimmed = mark.teacherRemarks?.trim();
          if (!trimmed) return null;
          const subjectName = subjectNameById.get(mark.subjectId.toString());
          return subjectName ? `${subjectName}: ${trimmed}` : trimmed;
        })
        .filter((entry): entry is string => Boolean(entry))
        .join("; ");

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
        passFailStatus: totals.passFailStatus,
        remarks: remarks || undefined
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
    Remarks: row.remarks ?? ""
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