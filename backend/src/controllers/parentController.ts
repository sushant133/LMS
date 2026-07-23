import type { Request, Response } from "express";
import {
  createParentFromStudentSchema,
  parentChildLinkSchema,
  type ParentFromStudentRelationship,
  type StudentParentCandidatesResponse
} from "@phit-erp/shared";
import { Assignment } from "../models/Assignment.js";
import { AssignmentSubmission } from "../models/Assignment.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import {
  buildSuggestedParentLoginId,
  getParentContactFromStudent,
  resolveUniqueParentLoginId
} from "../utils/parentProfile.js";
import { approvedParentLinkFilter, getLinkedStudentIds } from "../utils/parentScope.js";
import { sendSuccess } from "../utils/response.js";
import {
  abortTransaction,
  commitTransaction,
  createSession,
  endSession,
  getSessionOption
} from "../utils/transaction.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const PARENT_FROM_STUDENT_RELATIONSHIPS: ParentFromStudentRelationship[] = ["FATHER", "MOTHER", "GUARDIAN"];

const buildParentCandidates = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  student: {
    _id: { toString(): string };
    admissionNumber: string;
    fatherName: string;
    fatherPhone?: string | null;
    motherName: string;
    motherPhone?: string | null;
    guardianName: string;
    guardianPhone: string;
    user: { fullName: string };
  }
): Promise<StudentParentCandidatesResponse> => {
  const links = await ParentChildLink.find(
    approvedParentLinkFilter({ schoolId, studentId: student._id })
  ).lean();
  const parentIds = links.map((link) => link.parentUserId);
  const parents = parentIds.length
    ? await User.find({ _id: { $in: parentIds } }).select("fullName email phone").lean()
    : [];
  const parentById = new Map(parents.map((parent) => [parent._id.toString(), parent]));

  const candidates = await Promise.all(
    PARENT_FROM_STUDENT_RELATIONSHIPS.map(async (relationship) => {
      const contact = getParentContactFromStudent(student, relationship);
      const existingLink = links.find((link) => link.relationship === relationship);
      const linkedParent = existingLink ? parentById.get(existingLink.parentUserId.toString()) : undefined;
      const phoneMatch =
        contact.phone.length > 0
          ? await User.findOne({ schoolId, role: "PARENT", phone: contact.phone, isActive: true })
              .select("fullName email")
              .lean()
          : null;

      const suggestedLoginId = await resolveUniqueParentLoginId(
        buildSuggestedParentLoginId(student.admissionNumber, relationship)
      );

      return {
        relationship,
        fullName: contact.fullName,
        phone: contact.phone,
        suggestedLoginId,
        isLinked: Boolean(existingLink),
        existingLinkId: existingLink?._id.toString(),
        existingParentUserId: existingLink?.parentUserId.toString() ?? phoneMatch?._id.toString(),
        existingParentEmail: linkedParent?.email ?? phoneMatch?.email
      };
    })
  );

  return {
    student: {
      _id: student._id.toString(),
      fullName: student.user.fullName,
      admissionNumber: student.admissionNumber
    },
    candidates
  };
};

export const listParentUsers = asyncHandler(async (req: Request, res: Response) => {
  const parents = await User.find({ schoolId: tenantObjectId(req), role: "PARENT", isActive: true })
    .select("-password")
    .sort({ fullName: 1 });
  return sendSuccess(res, "Parent users fetched", parents);
});

export const listParentLinks = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (typeof req.query.parentUserId === "string") {
    Object.assign(filter, { parentUserId: req.query.parentUserId });
  }
  const links = await ParentChildLink.find(filter)
    .populate("parentUserId", "fullName email phone")
    .populate({
      path: "studentId",
      populate: { path: "user", select: "-password" }
    });
  return sendSuccess(res, "Parent links fetched", links);
});

export const getStudentParentCandidates = asyncHandler(async (req: Request, res: Response) => {
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.studentId }))
    .populate("user", "fullName")
    .lean();

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const studentUser = student.user as { fullName?: string } | null;
  if (!studentUser?.fullName) {
    throw new ApiError(404, "Student profile is incomplete");
  }

  const payload = await buildParentCandidates(tenantObjectId(req), {
    _id: student._id,
    admissionNumber: student.admissionNumber,
    fatherName: student.fatherName,
    fatherPhone: student.fatherPhone,
    motherName: student.motherName,
    motherPhone: student.motherPhone,
    guardianName: student.guardianName,
    guardianPhone: student.guardianPhone,
    user: { fullName: studentUser.fullName }
  });
  return sendSuccess(res, "Parent candidates fetched", payload);
});

export const createParentFromStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = createParentFromStudentSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  const student = await Student.findOne(withTenantScope(req, { _id: payload.studentId }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const contact = getParentContactFromStudent(student, payload.relationship);
  if (!contact.fullName.trim()) {
    throw new ApiError(400, "Selected parent details are missing on the student record");
  }

  const existingRelationshipLink = await ParentChildLink.findOne({
    schoolId,
    studentId: student._id,
    relationship: payload.relationship
  }).lean();

  if (existingRelationshipLink) {
    throw new ApiError(409, `${payload.relationship} is already linked for this student`);
  }

  const baseLoginId =
    payload.email?.trim().toLowerCase() ??
    (await resolveUniqueParentLoginId(buildSuggestedParentLoginId(student.admissionNumber, payload.relationship)));
  const { password: portalPassword, wasGenerated } = resolvePortalPassword(payload.password);

  const session = await createSession();

  try {
    let parentUser = await User.findOne({ email: baseLoginId });
    let createdUser = false;

    if (parentUser) {
      if (parentUser.role !== "PARENT") {
        throw new ApiError(409, "This login ID is already used by another account type");
      }

      if (parentUser.schoolId?.toString() !== schoolId.toString()) {
        throw new ApiError(409, "This parent account belongs to another institution");
      }
    } else if (contact.phone) {
      parentUser = await User.findOne({ schoolId, role: "PARENT", phone: contact.phone, isActive: true });
    }

    if (!parentUser) {
      const [createdParent] = await User.create(
        [
          {
            schoolId,
            fullName: contact.fullName,
            email: baseLoginId,
            phone: contact.phone || undefined,
            password: portalPassword,
            role: "PARENT",
            mustChangePassword: wasGenerated
          }
        ],
        getSessionOption(session)
      );
      parentUser = createdParent!;
      createdUser = true;
    }

    const duplicateLink = await ParentChildLink.findOne({
      schoolId,
      parentUserId: parentUser._id,
      studentId: student._id
    }).lean();

    if (duplicateLink) {
      throw new ApiError(409, "This parent is already linked to the student");
    }

    const [link] = await ParentChildLink.create(
      [
        {
          schoolId: req.tenantSchoolId,
          parentUserId: parentUser._id,
          studentId: student._id,
          relationship: payload.relationship,
          isPrimary: payload.isPrimary,
          status: "APPROVED",
          studentRegistrationNumber: student.admissionNumber
        }
      ],
      getSessionOption(session)
    );

    await commitTransaction(session);

    let credentialsEmail;
    if (createdUser) {
      credentialsEmail = await notifyAccountCredentials({
        userId: parentUser._id.toString(),
        fullName: parentUser.fullName,
        email: parentUser.email,
        password: portalPassword,
        schoolId: schoolId.toString(),
        req,
        accountKind: "PARENT"
      });
    }

    return sendSuccess(
      res,
      createdUser && credentialsEmail
        ? buildCredentialsAdminMessage(credentialsEmail)
        : createdUser
          ? "Parent portal account created and linked"
          : "Existing parent account linked to student",
      {
        parent: {
          _id: parentUser._id.toString(),
          fullName: parentUser.fullName,
          email: parentUser.email,
          phone: parentUser.phone
        },
        link,
        loginEmail: parentUser.email,
        defaultPassword: createdUser ? portalPassword : undefined,
        createdUser,
        credentialsEmail
      },
      201
    );
  } catch (error) {
    await abortTransaction(session);
    throw error;
  } finally {
    await endSession(session);
  }
});

export const createParentLink = asyncHandler(async (req: Request, res: Response) => {
  const payload = parentChildLinkSchema.parse(req.body);
  const [parent, student] = await Promise.all([
    User.findOne({ _id: payload.parentUserId, role: "PARENT" }),
    Student.findOne(withTenantScope(req, { _id: payload.studentId }))
  ]);

  if (!parent) throw new ApiError(404, "Parent user not found");
  if (!student) throw new ApiError(404, "Student not found");

  const link = await ParentChildLink.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    status: "APPROVED"
  });
  return sendSuccess(res, "Parent linked to student", link, 201);
});

export const deleteParentLink = asyncHandler(async (req: Request, res: Response) => {
  const link = await ParentChildLink.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!link) throw new ApiError(404, "Parent link not found");
  return sendSuccess(res, "Parent link removed");
});

export const getParentPortal = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT") {
    throw new ApiError(403, "Parent portal is only available to parent accounts");
  }

  const schoolId = tenantObjectId(req);
  const college = isCollege(await getInstitutionType(req));
  const studentIds = await getLinkedStudentIds(req);
  const students = await Student.find({ schoolId, _id: { $in: studentIds } }).populate("user", "-password").lean();

  const { FeeCollection } = await import("../models/FeeCollection.js");
  const { StudentScholarshipAward } = await import("../models/StudentScholarshipAward.js");
  const { buildProgramYearFeeSummary } = await import("../utils/accountingCalculations.js");

  const children = await Promise.all(
    students.map(async (student) => {
      const [primaryDoc, secondaryDoc, attendanceRecords, submissions, link, collections, awards] =
        await Promise.all([
          college
            ? student.batchId
              ? Batch.findById(student.batchId).lean()
              : Promise.resolve(null)
            : student.classId
              ? SchoolClass.findById(student.classId).lean()
              : Promise.resolve(null),
          college
            ? student.yearId
              ? Year.findById(student.yearId).lean()
              : Promise.resolve(null)
            : student.sectionId
              ? Section.findById(student.sectionId).lean()
              : Promise.resolve(null),
          Attendance.find({ schoolId, "entries.studentId": student._id }).lean(),
          AssignmentSubmission.find({ schoolId, studentId: student._id, status: "PENDING" }).lean(),
          ParentChildLink.findOne(
            approvedParentLinkFilter({
              schoolId,
              parentUserId: req.user!.userId,
              studentId: student._id
            })
          ).lean(),
          FeeCollection.find({
            schoolId,
            studentId: student._id,
            isDeleted: false
          }).lean(),
          StudentScholarshipAward.find({
            schoolId,
            studentId: student._id,
            isDeleted: false,
            status: { $in: ["ACTIVE", "APPLIED"] }
          }).lean()
        ]);

      let present = 0;
      let total = 0;
      attendanceRecords.forEach((record) => {
        const entry = record.entries.find((e) => e.studentId.toString() === student._id.toString());
        if (entry) {
          total += 1;
          if (entry.status === "PRESENT" || entry.status === "LATE") present += 1;
        }
      });

      const totalPaidNpr = collections.reduce((s, c) => s + (c.amountPaidNpr ?? 0), 0);
      const totalScholarshipNpr = collections.reduce((s, c) => s + (c.scholarshipNpr ?? 0), 0);
      const yearWise = buildProgramYearFeeSummary(
        collections as unknown as Array<Record<string, unknown>>,
        awards as unknown as Array<Record<string, unknown>>
      );

      // When ledger has no rows yet, surface planned admission fees as charged amounts
      const planned = {
        1: Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0,
        2: Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0,
        3: Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0
      };
      const yearWiseWithPlan = yearWise.map((y) => {
        if (y.status !== "NO_RECORD") return y;
        const plannedAmt = planned[y.programYear as 1 | 2 | 3] ?? 0;
        if (plannedAmt <= 0) return y;
        return {
          ...y,
          chargedNpr: plannedAmt,
          remainingNpr: plannedAmt,
          status: "DUE" as const
        };
      });

      return {
        studentId: student._id.toString(),
        fullName: (student.user as unknown as { fullName: string }).fullName,
        className: primaryDoc?.name ?? "—",
        sectionName: secondaryDoc?.name ?? "—",
        rollNumber: student.rollNumber,
        admissionNumber: student.admissionNumber,
        registrationNumber: (student as { registrationNumber?: string }).registrationNumber || "",
        feesDueNpr: student.feesDueNpr,
        year1FeeNpr: planned[1],
        year2FeeNpr: planned[2],
        year3FeeNpr: planned[3],
        securityDepositNpr: Number((student as { securityDepositNpr?: number }).securityDepositNpr) || 0,
        totalPaidNpr,
        totalScholarshipNpr,
        yearWise: yearWiseWithPlan,
        attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
        pendingHomework: submissions.length,
        relationship: link?.relationship ?? "GUARDIAN"
      };
    })
  );

  // Scope homework to linked children's academic groups when possible
  const assignmentScope: Record<string, unknown> = {
    schoolId,
    visibleTo: "PARENT",
    dueDateBs: { $exists: true, $ne: "" }
  };
  if (students.length > 0) {
    if (college) {
      const batchIds = students.map((s) => s.batchId).filter(Boolean);
      const yearIds = students.map((s) => s.yearId).filter(Boolean);
      if (batchIds.length || yearIds.length) {
        assignmentScope.$or = [
          ...(batchIds.length ? [{ batchId: { $in: batchIds } }] : []),
          ...(yearIds.length ? [{ yearId: { $in: yearIds } }] : [])
        ];
      }
    } else {
      const classIds = students.map((s) => s.classId).filter(Boolean);
      const sectionIds = students.map((s) => s.sectionId).filter(Boolean);
      if (classIds.length || sectionIds.length) {
        assignmentScope.$or = [
          ...(classIds.length ? [{ classId: { $in: classIds } }] : []),
          ...(sectionIds.length ? [{ sectionId: { $in: sectionIds } }] : [])
        ];
      }
    }
  } else {
    // No linked children → no homework list noise
    assignmentScope._id = { $in: [] };
  }

  const [recentNotifications, upcomingHomework] = await Promise.all([
    Notification.find({ schoolId, recipientUserId: req.user.userId }).sort({ createdAt: -1 }).limit(10).lean(),
    Assignment.find(assignmentScope).sort({ dueDateBs: 1 }).limit(5).lean()
  ]);

  return sendSuccess(res, "Parent portal data fetched", {
    children,
    recentNotifications,
    upcomingHomework
  });
});