import type { Request, Response } from "express";
import type { StudentSubjectDetail } from "@phit-erp/shared";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Attendance } from "../models/Attendance.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Notice } from "../models/Notice.js";
import { Result } from "../models/Result.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
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
  filterOutOpeningTuitionCharges,
  ensureActiveScholarshipAwardsApplied,
  PROGRAM_YEAR_LABELS
} from "../utils/accountingCalculations.js";
import { buildStudentAcademicFilter } from "../utils/academicScope.js";
import {
  expandCurriculumSubjectIds,
  serializeSyllabus
} from "../utils/academicManagementService.js";
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

  /**
   * Official (APPROVED) syllabus only for students. Match curriculum siblings
   * so a syllabus on another batch-year subject instance still appears.
   * Prefer exact subjectId match, then approved siblings.
   *
   * `syllabusAvailability` tells the portal WHY nothing is rendered, so
   * "still in draft" never looks identical to "never created" or to a
   * server-side failure.
   */
  let syllabus: Awaited<ReturnType<typeof serializeSyllabus>> = null;
  let syllabusAvailability: StudentSubjectDetail["syllabusAvailability"] = "NONE";
  try {
    const subjectIds = await expandCurriculumSubjectIds(
      schoolId,
      subject._id.toString()
    );
    // Fetch every live syllabus for the curriculum, then pick the approved one.
    // The unapproved rows are never serialized — they only explain the empty state.
    const syllabusRows = await AcademicSyllabus.find({
      schoolId,
      subjectId: { $in: subjectIds },
      isDeleted: false
    })
      .sort({ updatedAt: -1 })
      .lean();

    const approvedRows = syllabusRows.filter((row) => row.status === "APPROVED");
    const preferred =
      approvedRows.find((row) => row.subjectId.toString() === subject._id.toString()) ??
      approvedRows[0];

    if (preferred) {
      syllabus = await serializeSyllabus(preferred._id.toString());
      syllabusAvailability = syllabus ? "APPROVED" : "UNAVAILABLE";
    } else if (syllabusRows.length > 0) {
      syllabusAvailability = "AWAITING_APPROVAL";
    }
  } catch (error) {
    // Never let a syllabus failure take down the whole subject page, but do not
    // swallow it either — a silent null is indistinguishable from "not approved".
    console.error(
      "[student/subject-detail] syllabus load failed",
      subject._id.toString(),
      error
    );
    syllabus = null;
    syllabusAvailability = "UNAVAILABLE";
  }

  type SubLike = {
    _id: string;
    displayNo?: string;
    heading?: string;
    description?: string;
    teachingHours?: number;
    learningOutcomes?: string;
    children?: SubLike[];
  };
  const mapStudentSub = (sub: SubLike): SubLike => ({
    _id: sub._id,
    displayNo: sub.displayNo,
    heading: sub.heading,
    description: sub.description,
    teachingHours: sub.teachingHours,
    learningOutcomes: sub.learningOutcomes,
    children: (sub.children ?? []).map(mapStudentSub)
  });

  // Student-facing payload: curriculum only (no teacher notes / progress fields)
  const studentSyllabus = syllabus
    ? {
        _id: syllabus._id,
        academicYearBs: syllabus.academicYearBs,
        subjectCode: syllabus.subjectCode,
        totalTheoryHours: syllabus.totalTheoryHours,
        totalPracticalHours: syllabus.totalPracticalHours,
        creditHours: syllabus.creditHours,
        remarks: syllabus.remarks,
        status: syllabus.status,
        subject: syllabus.subject
          ? {
              _id: syllabus.subject._id,
              name: syllabus.subject.name,
              code: syllabus.subject.code
            }
          : {
              _id: subject._id.toString(),
              name: (subject as { name?: string }).name ?? "",
              code: (subject as { code?: string }).code ?? ""
            },
        chapters: (syllabus.chapters ?? []).map((chapter) => ({
          _id: chapter._id,
          chapterNo: chapter.chapterNo,
          sectionKind: chapter.sectionKind,
          title: chapter.title,
          description: chapter.description,
          units: (chapter.units ?? []).map((unit) => ({
            _id: unit._id,
            unitNo: unit.unitNo,
            title: unit.title,
            description: unit.description,
            teachingHours: unit.teachingHours,
            learningObjective: unit.learningObjective,
            practicalRequired: unit.practicalRequired,
            subUnits: (unit.subUnits ?? []).map((s) => mapStudentSub(s as SubLike))
          }))
        }))
      }
    : null;

  return sendSuccess(res, "Subject detail fetched", {
    subject,
    studentId: profile.studentId,
    attendance: attendanceHistory,
    marks,
    assignments: homework.map(mapAssignment),
    notes: notes.map(mapAssignment),
    submissions,
    notices,
    syllabus: studentSyllabus,
    syllabusAvailability
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

  let feeCollections = collections;
  let awardList = awards as unknown as Array<Record<string, unknown>>;
  const activeBefore = awardList.filter((a) => a.status !== "REVOKED");
  if (activeBefore.some((a) => a.status === "ACTIVE")) {
    awardList = await ensureActiveScholarshipAwardsApplied({
      schoolId,
      studentId: student._id.toString(),
      awards: activeBefore
    });
    feeCollections = await FeeCollection.find({
      schoolId,
      studentId: student._id,
      isDeleted: false
    })
      .sort({ paidDateBs: -1 })
      .lean();
  }

  const totalPaid = feeCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = feeCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = feeCollections.reduce(
    (sum, item) => sum + (item.scholarshipNpr ?? 0),
    0
  );
  const activeAwards = awardList.filter((a) => a.status !== "REVOKED");
  const plannedFees = {
    1: Math.max(0, Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0),
    2: Math.max(0, Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0),
    3: Math.max(0, Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0)
  };
  const yearWise = buildProgramYearFeeSummary(
    feeCollections as unknown as Array<Record<string, unknown>>,
    activeAwards,
    plannedFees
  );
  const yearWiseRemaining = yearWise.reduce((s, y) => s + Number(y.remainingNpr || 0), 0);
  const scholarshipStatus =
    activeAwards.length > 0
      ? activeAwards
          .map(
            (a) =>
              `Merit in ${PROGRAM_YEAR_LABELS[Number(a.toppedProgramYear)] ?? a.toppedProgramYear} → ${PROGRAM_YEAR_LABELS[Number(a.coversProgramYear)] ?? a.coversProgramYear} scholarship`
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
    outstandingDueNpr: yearWiseRemaining,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalPayableNpr: yearWise.reduce((s, y) => s + Number(y.chargedNpr || 0), 0),
    totalFineNpr: feeCollections.reduce((s, c) => s + (c.lateFeeNpr ?? 0), 0),
    advanceBalanceNpr: feeCollections.reduce((s, c) => s + (c.advancePaymentNpr ?? 0), 0),
    totalRefundsNpr: 0,
    scholarshipStatus,
    collections: filterOutOpeningTuitionCharges(
      feeCollections as unknown as Array<Record<string, unknown>>
    ),
    refunds: [],
    dueInstallments: [],
    yearWise,
    scholarshipAwards: awardList.map((a) => ({
      _id: String(a._id),
      schoolId: schoolId.toString(),
      studentId: String(a.studentId),
      toppedProgramYear: Number(a.toppedProgramYear),
      coversProgramYear: Number(a.coversProgramYear),
      academicYearBs: (a.academicYearBs as string) || undefined,
      examName: (a.examName as string) || undefined,
      rank: a.rank != null ? Number(a.rank) : undefined,
      waiverType: (a.waiverType as "FULL" | "PARTIAL") || "FULL",
      amountNpr: Number(a.amountNpr ?? 0),
      reason: (a.reason as string) || undefined,
      status: (a.status as "ACTIVE" | "APPLIED" | "REVOKED") || "ACTIVE",
      notes: (a.notes as string) || undefined
    }))
  });
});