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
import { DailyAttendance } from "../models/DailyAttendance.js";
import { StudentEarlyLeave } from "../models/StudentEarlyLeave.js";
import { Subject } from "../models/Subject.js";
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
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import {
  buildSuggestedParentLoginId,
  getParentContactFromStudent,
  resolveUniqueParentLoginId
} from "../utils/parentProfile.js";
import { approvedParentLinkFilter, getLinkedStudentIds } from "../utils/parentScope.js";
import {
  getEffectiveParentPortalAccess,
  getParentPortalAccessForSchool,
  setParentPortalAccessForSchool,
  setParentUserPortalAccess,
  toParentPortalAccessResponse
} from "../utils/parentPortalAccess.js";
import { recordAudit } from "../utils/audit.js";
import { sendSuccess } from "../utils/response.js";
import {
  abortTransaction,
  commitTransaction,
  createSession,
  endSession,
  getSessionOption
} from "../utils/transaction.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { updatePortalUser } from "../utils/userPassword.js";

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
  // Include inactive parents so admin can re-enable / edit / delete accounts
  const parents = await User.find({ schoolId: tenantObjectId(req), role: "PARENT" })
    .select("-password")
    .sort({ fullName: 1 });
  return sendSuccess(res, "Parent users fetched", parents);
});

/**
 * Admin / Super Admin: edit parent account (name, login, phone, password, active).
 */
export const updateParentUser = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const parentId = String(req.params.id ?? "").trim();
  if (!parentId) throw new ApiError(400, "Parent id is required");

  const parent = await User.findOne({ _id: parentId, schoolId, role: "PARENT" });
  if (!parent) throw new ApiError(404, "Parent account not found");

  const body = req.body as {
    fullName?: string;
    email?: string;
    phone?: string;
    password?: string;
    isActive?: boolean;
  };

  const fullName = (body.fullName ?? parent.fullName).trim();
  const email = (body.email ?? parent.email).trim().toLowerCase();
  const phone =
    body.phone !== undefined ? String(body.phone ?? "").trim() : parent.phone ?? "";

  if (!fullName) throw new ApiError(400, "Full name is required");
  if (!email) throw new ApiError(400, "Login ID / email is required");

  if (email !== parent.email) {
    const taken = await User.findOne({
      email,
      _id: { $ne: parent._id }
    })
      .select("_id")
      .lean();
    if (taken) throw new ApiError(409, "That login ID is already in use");
  }

  const before = {
    fullName: parent.fullName,
    email: parent.email,
    phone: parent.phone,
    isActive: parent.isActive
  };

  await updatePortalUser(parent._id, {
    fullName,
    email,
    phone,
    password: body.password
  });

  if (typeof body.isActive === "boolean") {
    await User.findByIdAndUpdate(parent._id, { isActive: body.isActive });
  }

  const updated = await User.findById(parent._id).select("-password");
  await recordAudit(req, {
    action: "parent.user.update",
    entity: "User",
    entityId: parentId,
    before,
    after: updated
  });

  return sendSuccess(res, "Parent account updated", updated);
});

/**
 * Admin / Super Admin: permanently delete parent login + all child links.
 */
export const deleteParentUser = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const parentId = String(req.params.id ?? "").trim();
  if (!parentId) throw new ApiError(400, "Parent id is required");

  const parent = await User.findOne({ _id: parentId, schoolId, role: "PARENT" });
  if (!parent) throw new ApiError(404, "Parent account not found");

  const before = parent.toObject();

  await ParentChildLink.deleteMany({ schoolId, parentUserId: parent._id });
  await Notification.deleteMany({ schoolId, recipientUserId: parent._id }).catch(() => undefined);
  await User.deleteOne({ _id: parent._id, schoolId, role: "PARENT" });

  await recordAudit(req, {
    action: "parent.user.delete",
    entity: "User",
    entityId: parentId,
    before,
    after: { deleted: true }
  });

  return sendSuccess(res, "Parent account deleted");
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

/** Current user's effective access (parents) or school defaults (admin). */
export const getParentPortalAccess = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  if (!schoolId) {
    throw new ApiError(400, "School context required");
  }

  // Parent: effective access for self
  if (req.user?.role === "PARENT") {
    const effective = await getEffectiveParentPortalAccess(
      schoolId.toString(),
      req.user.userId
    );
    return sendSuccess(
      res,
      "Parent portal access fetched",
      toParentPortalAccessResponse(effective.modules, {
        parentUserId: req.user.userId,
        useSchoolDefaults: effective.useSchoolDefaults,
        schoolDefaults: effective.schoolDefaults,
        customModules: effective.customModules
      })
    );
  }

  // Admin: school defaults (legacy endpoint)
  const modules = await getParentPortalAccessForSchool(schoolId.toString());
  return sendSuccess(
    res,
    "Parent portal access (school defaults) fetched",
    toParentPortalAccessResponse(modules, {
      useSchoolDefaults: true,
      schoolDefaults: modules,
      customModules: null
    })
  );
});

/** School-wide defaults used when a parent has no personal override. */
export const updateParentPortalAccess = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  if (!schoolId) {
    throw new ApiError(400, "School context required");
  }

  const body = req.body as { modules?: Record<string, boolean> };
  if (!body?.modules || typeof body.modules !== "object") {
    throw new ApiError(400, "modules map is required");
  }

  const modules = await setParentPortalAccessForSchool(
    schoolId.toString(),
    body.modules
  );
  return sendSuccess(
    res,
    "School parent portal defaults updated",
    toParentPortalAccessResponse(modules, {
      useSchoolDefaults: true,
      schoolDefaults: modules,
      customModules: null
    })
  );
});

const paramId = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** Admin: effective + custom access for one parent. */
export const getParentUserPortalAccess = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  if (!schoolId) {
    throw new ApiError(400, "School context required");
  }
  const parentUserId = paramId(req.params.parentUserId);
  if (!parentUserId) {
    throw new ApiError(400, "Parent id is required");
  }
  const parent = await User.findOne({
    _id: parentUserId,
    role: "PARENT",
    schoolId
  })
    .select("fullName email")
    .lean();
  if (!parent) {
    throw new ApiError(404, "Parent not found");
  }

  const effective = await getEffectiveParentPortalAccess(
    schoolId.toString(),
    parentUserId
  );
  return sendSuccess(
    res,
    "Parent user portal access fetched",
    toParentPortalAccessResponse(effective.modules, {
      parentUserId,
      parentName: parent.fullName,
      parentEmail: parent.email,
      useSchoolDefaults: effective.useSchoolDefaults,
      schoolDefaults: effective.schoolDefaults,
      customModules: effective.customModules
    })
  );
});

/** Admin: set or clear personal module access for one parent. */
export const updateParentUserPortalAccess = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  if (!schoolId) {
    throw new ApiError(400, "School context required");
  }
  const parentUserId = paramId(req.params.parentUserId);
  if (!parentUserId) {
    throw new ApiError(400, "Parent id is required");
  }
  const body = req.body as {
    modules?: Record<string, boolean>;
    useSchoolDefaults?: boolean;
  };

  try {
    const effective = await setParentUserPortalAccess(schoolId.toString(), parentUserId, {
      useSchoolDefaults: body.useSchoolDefaults === true,
      modules: body.modules
    });
    const parent = await User.findById(parentUserId).select("fullName email").lean();
    return sendSuccess(
      res,
      body.useSchoolDefaults
        ? "Parent now uses school default portal access"
        : "Parent portal access updated",
      toParentPortalAccessResponse(effective.modules, {
        parentUserId,
        parentName: parent?.fullName,
        parentEmail: parent?.email,
        useSchoolDefaults: effective.useSchoolDefaults,
        schoolDefaults: effective.schoolDefaults,
        customModules: effective.customModules
      })
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PARENT_NOT_FOUND") {
      throw new ApiError(404, "Parent not found");
    }
    if (msg === "MODULES_REQUIRED") {
      throw new ApiError(400, "modules map is required when not using school defaults");
    }
    throw error;
  }
});

/**
 * Parent: daily + subject-wise attendance for linked children.
 * Query:
 *  - dateBs=YYYY-MM-DD (exact day)
 *  - fromDateBs / toDateBs (range, inclusive)
 *  - limit (default 100, max 300)
 */
export const getParentChildrenAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT") {
    throw new ApiError(403, "Only parents can view children attendance here");
  }

  const schoolId = tenantObjectId(req);
  const effective = await getEffectiveParentPortalAccess(
    String(schoolId),
    req.user.userId
  );
  if (effective.modules.attendance === false) {
    throw new ApiError(
      403,
      "Attendance access is disabled for your parent account. Contact the college administrator."
    );
  }

  const studentIds = await getLinkedStudentIds(req);
  if (studentIds.length === 0) {
    return sendSuccess(res, "Children attendance fetched", {
      children: [],
      daily: [],
      subject: [],
      filters: {}
    });
  }

  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 10), 300)
    : 100;

  // Date filters (BS YYYY-MM-DD)
  let dateFilter: string | { $gte?: string; $lte?: string } | undefined;
  let appliedDateBs = "";
  let appliedFromDateBs = "";
  let appliedToDateBs = "";

  if (typeof req.query.dateBs === "string" && req.query.dateBs.trim()) {
    appliedDateBs = ensureValidBsDate(req.query.dateBs.trim());
    dateFilter = appliedDateBs;
  } else {
    const fromRaw =
      typeof req.query.fromDateBs === "string" ? req.query.fromDateBs.trim() : "";
    const toRaw =
      typeof req.query.toDateBs === "string" ? req.query.toDateBs.trim() : "";
    if (fromRaw || toRaw) {
      const range: { $gte?: string; $lte?: string } = {};
      if (fromRaw) {
        appliedFromDateBs = ensureValidBsDate(fromRaw);
        range.$gte = appliedFromDateBs;
      }
      if (toRaw) {
        appliedToDateBs = ensureValidBsDate(toRaw);
        range.$lte = appliedToDateBs;
      }
      if (
        appliedFromDateBs &&
        appliedToDateBs &&
        appliedFromDateBs > appliedToDateBs
      ) {
        throw new ApiError(400, "From date cannot be after To date");
      }
      dateFilter = range;
    }
  }

  const students = await Student.find({ schoolId, _id: { $in: studentIds } })
    .populate("user", "fullName")
    .lean();

  const childMeta = students.map((s) => ({
    studentId: s._id.toString(),
    fullName: (s.user as { fullName?: string } | null)?.fullName ?? "Student",
    rollNumber: s.rollNumber,
    admissionNumber: s.admissionNumber
  }));
  const nameById = new Map(childMeta.map((c) => [c.studentId, c.fullName]));
  const idSet = new Set(studentIds.map(String));

  const baseDailyFilter: Record<string, unknown> = {
    schoolId,
    status: { $in: ["SUBMITTED", "LOCKED"] },
    "entries.studentId": { $in: studentIds }
  };
  const baseSubjectFilter: Record<string, unknown> = {
    schoolId,
    "entries.studentId": { $in: studentIds }
  };
  if (dateFilter !== undefined) {
    baseDailyFilter.dateBs = dateFilter;
    baseSubjectFilter.dateBs = dateFilter;
  }

  const earlyLeaveFilter: Record<string, unknown> = {
    schoolId,
    studentId: { $in: studentIds },
    isDeleted: false
  };
  if (dateFilter !== undefined) {
    earlyLeaveFilter.dateBs = dateFilter;
  }

  const [dailyDocs, subjectDocs, earlyLeaveDocs] = await Promise.all([
    DailyAttendance.find(baseDailyFilter)
      .sort({ dateBs: -1, createdAt: -1 })
      .limit(limit)
      .lean(),
    Attendance.find(baseSubjectFilter)
      .sort({ dateBs: -1, createdAt: -1 })
      .limit(limit)
      .lean(),
    StudentEarlyLeave.find(earlyLeaveFilter)
      .sort({ dateBs: -1, createdAt: -1 })
      .limit(limit)
      .lean()
  ]);

  const subjectIds = [
    ...new Set(
      [...dailyDocs, ...subjectDocs]
        .map((d) => d.subjectId?.toString())
        .filter((id): id is string => Boolean(id))
    )
  ];
  const subjects = subjectIds.length
    ? await Subject.find({ _id: { $in: subjectIds } }).select("name").lean()
    : [];
  const subjectNameById = new Map(subjects.map((s) => [s._id.toString(), s.name]));

  type Row = {
    kind: "DAILY" | "SUBJECT";
    recordId: string;
    studentId: string;
    studentName: string;
    dateBs: string;
    status: string;
    subjectName: string;
    periodNumber?: number;
    remarks?: string;
  };

  const daily: Row[] = [];
  for (const doc of dailyDocs) {
    for (const entry of doc.entries ?? []) {
      const sid = entry.studentId.toString();
      if (!idSet.has(sid)) continue;
      daily.push({
        kind: "DAILY",
        recordId: doc._id.toString(),
        studentId: sid,
        studentName: nameById.get(sid) ?? "Student",
        dateBs: doc.dateBs,
        status: entry.status,
        subjectName: subjectNameById.get(doc.subjectId?.toString() ?? "") ?? "Daily class",
        periodNumber: doc.periodNumber ?? 1,
        remarks: entry.remarks || undefined
      });
    }
  }

  const subject: Row[] = [];
  for (const doc of subjectDocs) {
    for (const entry of doc.entries ?? []) {
      const sid = entry.studentId.toString();
      if (!idSet.has(sid)) continue;
      subject.push({
        kind: "SUBJECT",
        recordId: doc._id.toString(),
        studentId: sid,
        studentName: nameById.get(sid) ?? "Student",
        dateBs: doc.dateBs,
        status: entry.status,
        subjectName: subjectNameById.get(doc.subjectId?.toString() ?? "") ?? "Subject"
      });
    }
  }

  const earlyLeave = earlyLeaveDocs.map((doc) => ({
    kind: "EARLY_LEAVE" as const,
    recordId: doc._id.toString(),
    studentId: doc.studentId.toString(),
    studentName: nameById.get(doc.studentId.toString()) ?? "Student",
    dateBs: doc.dateBs,
    status: "EARLY_LEAVE",
    /** When the student left (period / break label) */
    subjectName: doc.periodLabel || "Early leave",
    periodLabel: doc.periodLabel || "Early leave",
    leftAfterPeriod: doc.leftAfterPeriod ?? undefined,
    remarks: doc.reason,
    reason: doc.reason,
    leftAtTime: doc.leftAtTime || undefined,
    approvedBy: doc.approvedBy || undefined,
    extraRemarks: doc.remarks || undefined
  }));

  // Summary rates per child (subject-wise + daily combined for a simple %)
  const children = childMeta.map((child) => {
    const rows = [
      ...daily.filter((r) => r.studentId === child.studentId),
      ...subject.filter((r) => r.studentId === child.studentId)
    ];
    const total = rows.length;
    const present = rows.filter(
      (r) => r.status === "PRESENT" || r.status === "LATE"
    ).length;
    const earlyLeaveCount = earlyLeave.filter(
      (r) => r.studentId === child.studentId
    ).length;
    return {
      ...child,
      attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
      totalMarks: total,
      presentMarks: present,
      earlyLeaveCount
    };
  });

  return sendSuccess(res, "Children attendance fetched", {
    children,
    daily: daily.slice(0, limit),
    subject: subject.slice(0, limit),
    earlyLeave: earlyLeave.slice(0, limit),
    filters: {
      dateBs: appliedDateBs || undefined,
      fromDateBs: appliedFromDateBs || undefined,
      toDateBs: appliedToDateBs || undefined
    }
  });
});

export const getParentPortal = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT") {
    throw new ApiError(403, "Parent portal is only available to parent accounts");
  }

  const schoolId = tenantObjectId(req);
  const effective = await getEffectiveParentPortalAccess(
    String(schoolId),
    req.user.userId
  );
  const portalAccess = effective.modules;
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
      const planned = {
        1: Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0,
        2: Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0,
        3: Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0
      };
      const yearWiseWithPlan = buildProgramYearFeeSummary(
        collections as unknown as Array<Record<string, unknown>>,
        awards as unknown as Array<Record<string, unknown>>,
        planned
      );
      const feesDueFromPlan = yearWiseWithPlan.reduce(
        (s, y) => s + Number(y.remainingNpr || 0),
        0
      );

      return {
        studentId: student._id.toString(),
        fullName: (student.user as unknown as { fullName: string }).fullName,
        className: primaryDoc?.name ?? "—",
        sectionName: secondaryDoc?.name ?? "—",
        rollNumber: student.rollNumber,
        admissionNumber: student.admissionNumber,
        registrationNumber: (student as { registrationNumber?: string }).registrationNumber || "",
        feesDueNpr: feesDueFromPlan,
        year1FeeNpr: planned[1],
        year2FeeNpr: planned[2],
        year3FeeNpr: planned[3],
        securityDepositExpectedNpr:
          Number((student as { securityDepositExpectedNpr?: number }).securityDepositExpectedNpr) ||
          0,
        securityDepositNpr: Number((student as { securityDepositNpr?: number }).securityDepositNpr) || 0,
        securityDepositRefundedNpr:
          Number((student as { securityDepositRefundedNpr?: number }).securityDepositRefundedNpr) ||
          0,
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

  const canHomework = portalAccess.homework !== false;
  const canNotifications = portalAccess.notifications !== false;
  const canFees = portalAccess.fees !== false;
  const canAttendance = portalAccess.attendance !== false;
  const canField = portalAccess["field-attendance"] !== false;
  const canOverview = portalAccess.overview !== false;

  const [recentNotifications, upcomingHomework] = await Promise.all([
    canNotifications
      ? Notification.find({ schoolId, recipientUserId: req.user.userId })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean()
      : Promise.resolve([]),
    canHomework
      ? Assignment.find(assignmentScope).sort({ dueDateBs: 1 }).limit(5).lean()
      : Promise.resolve([])
  ]);

  const childrenFiltered = canOverview
    ? children.map((child) => {
        const next = { ...child };
        if (!canFees) {
          next.feesDueNpr = 0;
          next.totalPaidNpr = 0;
          next.totalScholarshipNpr = 0;
          next.year1FeeNpr = 0;
          next.year2FeeNpr = 0;
          next.year3FeeNpr = 0;
          next.securityDepositNpr = 0;
          next.securityDepositExpectedNpr = 0;
          next.securityDepositRefundedNpr = 0;
          next.yearWise = [];
        }
        if (!canAttendance) {
          next.attendanceRate = 0;
        }
        if (!canHomework) {
          next.pendingHomework = 0;
        }
        return next;
      })
    : [];

  return sendSuccess(res, "Parent portal data fetched", {
    children: childrenFiltered,
    recentNotifications: canNotifications ? recentNotifications : [],
    upcomingHomework: canHomework ? upcomingHomework : [],
    portalAccess,
    /** Hint for field attendance panels on the client */
    fieldAttendanceEnabled: canField
  });
});