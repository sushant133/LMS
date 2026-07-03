import type { Request, Response } from "express";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Attendance } from "../models/Attendance.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Notice } from "../models/Notice.js";
import { Result } from "../models/Result.js";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { buildStudentAcademicFilter } from "../utils/academicScope.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { assertStudentSubjectAccess, getEnrolledSubjects, requireStudentProfile } from "../utils/studentScope.js";
import { tenantObjectId } from "../utils/tenant.js";

export const listStudentSubjects = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "STUDENT") {
    throw new ApiError(403, "Only students can access enrolled subjects");
  }

  const subjects = await getEnrolledSubjects(req);
  return sendSuccess(res, "Enrolled subjects fetched", subjects);
});

export const getStudentSubjectDetail = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "STUDENT") {
    throw new ApiError(403, "Only students can access subject details");
  }

  const { profile, subject } = await assertStudentSubjectAccess(req, String(req.params.subjectId));
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const academicFilter = buildStudentAcademicFilter(profile, institutionType);
  const college = isCollege(institutionType);

  const [attendance, assignments, submissions, notices, results] = await Promise.all([
    Attendance.find({
      schoolId,
      ...academicFilter,
      subjectId: subject._id,
      "entries.studentId": profile.studentId
    })
      .sort({ dateBs: -1 })
      .lean(),
    Assignment.find({
      schoolId,
      ...academicFilter,
      subjectId: subject._id,
      visibleTo: "STUDENT"
    })
      .sort({ createdAt: -1 })
      .lean(),
    AssignmentSubmission.find({
      schoolId,
      studentId: profile.studentId,
      assignmentId: {
        $in: (
          await Assignment.find({
            schoolId,
            ...academicFilter,
            subjectId: subject._id
          }).distinct("_id")
        )
      }
    }).lean(),
    Notice.find({
      schoolId,
      visibleTo: "STUDENT",
      publishDateBs: { $lte: getTodayBs() },
      $or: [{ expiresAtBs: { $exists: false } }, { expiresAtBs: null }, { expiresAtBs: "" }, { expiresAtBs: { $gte: getTodayBs() } }],
      $and: [
        {
          $or: [
            college
              ? {
                  subjectId: subject._id,
                  batchId: profile.batchId,
                  $or: [{ yearId: { $exists: false } }, { yearId: null }, { yearId: profile.yearId }]
                }
              : {
                  subjectId: subject._id,
                  classId: profile.classId,
                  $or: [{ sectionId: { $exists: false } }, { sectionId: null }, { sectionId: profile.sectionId }]
                },
            {
              $and: [
                { $or: [{ subjectId: { $exists: false } }, { subjectId: null }] },
                college
                  ? { $or: [{ batchId: { $exists: false } }, { batchId: null }, { batchId: profile.batchId }] }
                  : { $or: [{ classId: { $exists: false } }, { classId: null }, { classId: profile.classId }] }
              ]
            }
          ]
        }
      ]
    })
      .sort({ publishDateBs: -1, createdAt: -1 })
      .lean(),
    Result.find({
      schoolId,
      studentId: profile.studentId,
      ...academicFilter,
      "marks.subjectId": subject._id.toString()
    })
      .sort({ updatedAt: -1 })
      .lean()
  ]);

  const attendanceHistory = attendance.map((record) => {
    const entry = record.entries.find((item) => item.studentId.toString() === profile.studentId);
    return {
      dateBs: record.dateBs,
      status: entry?.status ?? "ABSENT"
    };
  });

  const marks = results.flatMap((result) =>
    result.marks
      .filter((mark) => mark.subjectId.toString() === subject._id.toString())
      .map((mark) => ({
        examId: result.examId.toString(),
        obtainedMarks: mark.obtainedMarks,
        percentage: result.percentage,
        grade: result.grade,
        gpa: result.gpa,
        publishedAtBs: result.publishedAtBs
      }))
  );

  const notes = assignments.filter((item) => item.type === "NOTE");
  const homework = assignments.filter((item) => item.type === "HOMEWORK" || item.type === "CAS");

  return sendSuccess(res, "Subject detail fetched", {
    subject,
    attendance: attendanceHistory,
    marks,
    assignments: homework,
    notes,
    submissions,
    notices
  });
});

export const getMyFinancialHistory = asyncHandler(async (req: Request, res: Response) => {
  const profile = await requireStudentProfile(req);
  const schoolId = tenantObjectId(req);

  const student = await Student.findOne({ _id: profile.studentId, schoolId }).populate("user", "-password").lean();
  if (!student) throw new ApiError(404, "Student not found");

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [classDoc, sectionDoc, batchDoc, yearDoc, collections] = await Promise.all([
    college ? null : SchoolClass.findById(student.classId).lean(),
    college ? null : Section.findById(student.sectionId).lean(),
    college ? Batch.findById(student.batchId).lean() : null,
    college ? Year.findById(student.yearId).lean() : null,
    FeeCollection.find({ schoolId, studentId: student._id }).sort({ paidDateBs: -1 }).lean()
  ]);

  const totalPaid = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = collections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = collections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);

  return sendSuccess(res, "Financial history fetched", {
    student,
    className: college ? (batchDoc?.name ?? "") : (classDoc?.name ?? ""),
    sectionName: college ? (yearDoc?.name ?? "") : (sectionDoc?.name ?? ""),
    outstandingDueNpr: student.feesDueNpr ?? 0,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalRefundsNpr: 0,
    collections,
    refunds: []
  });
});