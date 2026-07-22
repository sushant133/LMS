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
import { StudentScholarshipAward } from "../models/StudentScholarshipAward.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildProgramYearFeeSummary,
  PROGRAM_YEAR_LABELS
} from "../utils/accountingCalculations.js";
import { buildStudentAcademicFilter } from "../utils/academicScope.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { assertStudentSubjectAccess, getEnrolledSubjects, requireStudentProfile } from "../utils/studentScope.js";
import { tenantObjectId } from "../utils/tenant.js";

/** Hardcoded faculty until multi-faculty support is added. */
const DEFAULT_FACULTY = "HA";

const formatAddress = (address?: {
  province?: string;
  district?: string;
  municipality?: string;
  ward?: string;
  streetAddress?: string;
}): string => {
  if (!address) return "—";
  return [address.streetAddress, address.ward ? `Ward ${address.ward}` : "", address.municipality, address.district, address.province]
    .filter(Boolean)
    .join(", ");
};

/**
 * Student self-profile: name, address, batch, admission no., mobile, email, faculty.
 */
export const getMyStudentProfile = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "STUDENT") {
    throw new ApiError(403, "Only students can access this profile");
  }

  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ schoolId, user: req.user.userId }).populate("user", "-password").lean();

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [batch, year, schoolClass, section] = await Promise.all([
    student.batchId ? Batch.findById(student.batchId).select("name").lean() : null,
    student.yearId ? Year.findById(student.yearId).select("name").lean() : null,
    student.classId ? SchoolClass.findById(student.classId).select("name").lean() : null,
    student.sectionId ? Section.findById(student.sectionId).select("name").lean() : null
  ]);

  const user = student.user as {
    fullName?: string;
    email?: string;
    phone?: string;
    _id?: { toString(): string };
  } | null;

  const address = student.address as {
    province: string;
    district: string;
    municipality: string;
    ward: string;
    streetAddress: string;
  };

  return sendSuccess(res, "Student profile fetched", {
    studentId: student._id.toString(),
    fullName: user?.fullName ?? "—",
    email: user?.email ?? "—",
    phone: user?.phone ?? "—",
    address: formatAddress(address),
    addressDetails: address,
    admissionNumber: student.admissionNumber,
    rollNumber: student.rollNumber,
    batch: college ? (batch?.name ?? "—") : (schoolClass?.name ?? "—"),
    year: college ? (year?.name ?? "—") : (section?.name ?? "—"),
    batchLabel: college ? "Batch" : "Class",
    yearLabel: college ? "Year" : "Section",
    faculty: DEFAULT_FACULTY,
    photoUrl: student.photoUrl,
    gender: student.gender,
    academicStatus: student.academicStatus ?? "ACTIVE"
  });
});

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
      "marks.subjectId": subject._id.toString(),
      // Never expose draft / unpublished marks to students
      publishedAtBs: { $exists: true, $nin: [null, ""] }
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

  const normalizeAttachments = (raw: unknown) => {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      if (typeof item === "string") {
        return { url: item, name: item.split("/").pop() ?? "Attachment" };
      }
      const attachment = item as { url: string; name: string; mimeType?: string; kind?: string };
      return {
        url: attachment.url,
        name: attachment.name,
        mimeType: attachment.mimeType,
        kind: attachment.kind
      };
    });
  };

  const mapAssignment = (item: (typeof assignments)[number]) => ({
    ...item,
    _id: item._id.toString(),
    attachments: normalizeAttachments(item.attachments),
    links: Array.isArray(item.links) ? item.links : []
  });

  return sendSuccess(res, "Subject detail fetched", {
    subject,
    studentId: profile.studentId,
    attendance: attendanceHistory,
    marks,
    assignments: homework.map(mapAssignment),
    notes: notes.map(mapAssignment),
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

  const [classDoc, sectionDoc, batchDoc, yearDoc, collections, awards] =
    await Promise.all([
      college ? null : SchoolClass.findById(student.classId).lean(),
      college ? null : Section.findById(student.sectionId).lean(),
      college ? Batch.findById(student.batchId).lean() : null,
      college ? Year.findById(student.yearId).lean() : null,
      FeeCollection.find({ schoolId, studentId: student._id, isDeleted: false })
        .sort({ paidDateBs: -1 })
        .lean(),
      StudentScholarshipAward.find({
        schoolId,
        studentId: student._id,
        isDeleted: false
      })
        .sort({ createdAt: -1 })
        .lean()
    ]);

  const totalPaid = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = collections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = collections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);
  const activeAwards = awards.filter((a) => a.status !== "REVOKED");
  const yearWise = buildProgramYearFeeSummary(
    collections as unknown as Array<Record<string, unknown>>,
    activeAwards as unknown as Array<Record<string, unknown>>
  );
  const scholarshipStatus =
    activeAwards.length > 0
      ? activeAwards
          .map(
            (a) =>
              `Topped ${PROGRAM_YEAR_LABELS[a.toppedProgramYear] ?? a.toppedProgramYear} → ${PROGRAM_YEAR_LABELS[a.coversProgramYear] ?? a.coversProgramYear} scholarship`
          )
          .join("; ")
      : totalScholarship > 0
        ? "Scholarship Applied"
        : "None";

  return sendSuccess(res, "Financial history fetched", {
    student,
    className: college ? (batchDoc?.name ?? "") : (classDoc?.name ?? ""),
    sectionName: college ? (yearDoc?.name ?? "") : (sectionDoc?.name ?? ""),
    batchName: college ? (batchDoc?.name ?? "") : undefined,
    yearName: college ? (yearDoc?.name ?? "") : undefined,
    outstandingDueNpr: student.feesDueNpr ?? 0,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalPayableNpr: totalPaid + (student.feesDueNpr ?? 0) + totalDiscount + totalScholarship,
    totalFineNpr: collections.reduce((s, c) => s + (c.lateFeeNpr ?? 0), 0),
    advanceBalanceNpr: collections.reduce((s, c) => s + (c.advancePaymentNpr ?? 0), 0),
    totalRefundsNpr: 0,
    scholarshipStatus,
    collections,
    refunds: [],
    dueInstallments: [],
    yearWise,
    scholarshipAwards: awards.map((a) => ({
      _id: a._id.toString(),
      schoolId: schoolId.toString(),
      studentId: a.studentId.toString(),
      toppedProgramYear: a.toppedProgramYear,
      coversProgramYear: a.coversProgramYear,
      academicYearBs: a.academicYearBs || undefined,
      examName: a.examName || undefined,
      rank: a.rank ?? undefined,
      waiverType: a.waiverType as "FULL" | "PARTIAL",
      amountNpr: a.amountNpr ?? 0,
      reason: a.reason || undefined,
      status: a.status as "ACTIVE" | "APPLIED" | "REVOKED",
      notes: a.notes || undefined
    }))
  });
});