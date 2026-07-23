import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { ensurePendingRequiredDocuments, studentSchema } from "@phit-erp/shared";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { getStudentScopeFilter } from "../utils/parentScope.js";
import { getTeacherStudentFilter, getTeacherScope } from "../utils/teacherScope.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { recordAudit } from "../utils/audit.js";
import {
  buildCredentialsAdminMessage,
  buildPortalCredentialsUpdatedMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { sendSuccess } from "../utils/response.js";
import { updatePortalUser } from "../utils/userPassword.js";
import { validateStudentAdmissionScope } from "../utils/academicValidation.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  createSession,
  commitTransaction,
  abortTransaction,
  endSession,
  getSessionOption
} from "../utils/transaction.js";
import { hardDeleteStudentAccount } from "../utils/deletePersonCascade.js";

const getReadableStudentFilter = async (req: Request): Promise<Record<string, unknown>> => {
  if (req.user?.role === "TEACHER") {
    return getTeacherStudentFilter(req);
  }
  return getStudentScopeFilter(req);
};

const refIdAndName = (
  value: unknown
): { id?: string; name?: string } => {
  if (value == null) return {};
  if (typeof value === "object" && value !== null && "_id" in value) {
    const row = value as { _id: { toString(): string }; name?: string };
    return { id: row._id.toString(), name: row.name };
  }
  return { id: String(value) };
};

/**
 * Limited roster fields for teachers / library staff — not full personal / guardian / fee data.
 * Library staff need this for the issue-book borrower picker (batch/year labels for filters).
 */
const sanitizeStudentForLimitedStaffList = (student: {
  toObject?: () => Record<string, unknown>;
  _id: { toString(): string };
  admissionNumber: string;
  rollNumber: number;
  classId?: unknown;
  sectionId?: unknown;
  batchId?: unknown;
  yearId?: unknown;
  academicStatus?: string;
  gender: string;
  photoUrl?: string;
  user?: { _id?: { toString(): string }; fullName?: string; role?: string } | null;
}) => {
  const plain =
    typeof student.toObject === "function"
      ? student.toObject()
      : (student as unknown as Record<string, unknown>);
  const user = plain.user as
    | { _id?: unknown; fullName?: string; role?: string }
    | null
    | undefined;
  const batch = refIdAndName(plain.batchId ?? student.batchId);
  const year = refIdAndName(plain.yearId ?? student.yearId);
  const klass = refIdAndName(plain.classId ?? student.classId);
  const section = refIdAndName(plain.sectionId ?? student.sectionId);

  return {
    _id: student._id,
    schoolId: plain.schoolId,
    admissionNumber: student.admissionNumber,
    rollNumber: student.rollNumber,
    classId: klass.id,
    className: klass.name,
    sectionId: section.id,
    sectionName: section.name,
    batchId: batch.id,
    batchName: batch.name,
    yearId: year.id,
    yearName: year.name,
    academicStatus: student.academicStatus,
    gender: student.gender,
    photoUrl: student.photoUrl,
    user: user
      ? {
          _id: user._id,
          fullName: user.fullName,
          role: user.role
        }
      : null
  };
};

const usesLimitedStudentView = (role: string | undefined): boolean =>
  role === "TEACHER" || role === "LIBRARY_STAFF";

export const listStudents = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const limitedView = usesLimitedStudentView(req.user?.role);
  const isTeacher = req.user?.role === "TEACHER";

  // Teachers: only active students in their assigned batch/year (or class/section)
  if (isTeacher) {
    filter.academicStatus = "ACTIVE";
  }

  // Always populate academic group labels for roster filters (library issue, etc.)
  const students = await Student.find(filter)
    .populate("user", limitedView ? "fullName role" : "-password")
    .populate("batchId", "name")
    .populate("yearId", "name level batchId")
    .populate("classId", "name")
    .populate("sectionId", "name classId")
    .sort(isTeacher ? { rollNumber: 1, createdAt: -1 } : { createdAt: -1 });

  // Drop orphaned rows where the linked User was deleted (populate returns null)
  const linked = students.filter((student) => Boolean(student.user));

  if (limitedView) {
    return sendSuccess(
      res,
      "Students fetched",
      linked.map((s) => sanitizeStudentForLimitedStaffList(s as never))
    );
  }

  // Flatten populated refs so clients get stable string ids + optional names
  const adminRows = linked.map((s) => {
    const plain = s.toObject() as Record<string, unknown>;
    const batch = refIdAndName(plain.batchId);
    const year = refIdAndName(plain.yearId);
    const klass = refIdAndName(plain.classId);
    const section = refIdAndName(plain.sectionId);
    return {
      ...plain,
      _id: s._id,
      batchId: batch.id,
      batchName: batch.name,
      yearId: year.id,
      yearName: year.name,
      classId: klass.id,
      className: klass.name,
      sectionId: section.id,
      sectionName: section.name
    };
  });

  return sendSuccess(res, "Students fetched", adminRows);
});

export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const limitedView = usesLimitedStudentView(req.user?.role);
  let studentQuery = Student.findOne({ ...filter, _id: req.params.id }).populate(
    "user",
    limitedView ? "fullName role" : "-password"
  );
  if (limitedView) {
    studentQuery = studentQuery
      .populate("batchId", "name")
      .populate("yearId", "name level batchId")
      .populate("classId", "name")
      .populate("sectionId", "name classId");
  }
  const student = await studentQuery;

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  if (limitedView) {
    return sendSuccess(res, "Student fetched", sanitizeStudentForLimitedStaffList(student as never));
  }

  return sendSuccess(res, "Student fetched", student);
});

const emptyAddress = () => ({
  province: "",
  district: "",
  municipality: "",
  ward: "",
  streetAddress: ""
});

/** Generate a unique-enough admission number when the form leaves it blank. */
const generateAdmissionNumber = (): string => {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ADM-${stamp}-${rand}`;
};

/** Generate a portal login id when the form leaves it blank. */
const generateStudentLoginId = (admissionNumber: string): string => {
  const base = admissionNumber
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return base.length >= 3 ? `s${base}` : `student${Date.now().toString(36)}`;
};

export const createStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentSchema.parse(req.body);
  if (payload.admissionDateBs) ensureValidBsDate(payload.admissionDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateStudentAdmissionScope(institutionType, schoolId, payload);

  const hasScholarship = Boolean(payload.hasScholarship);
  const year1FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year1FeeNpr) || 0);
  const year2FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year2FeeNpr) || 0);
  const year3FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year3FeeNpr) || 0);
  const securityDepositNpr = Math.max(0, Number(payload.securityDepositNpr) || 0);
  const yearFeeTotal = year1FeeNpr + year2FeeNpr + year3FeeNpr;
  // Prefer year plan sum when any year fee is set; else legacy total fee field
  const feesDueNpr = hasScholarship
    ? 0
    : yearFeeTotal > 0
      ? yearFeeTotal
      : Math.max(0, Number(payload.feesDueNpr) || 0);
  const fullName = (payload.fullName || "").trim() || "Student";
  const admissionNumber =
    (payload.admissionNumber || "").trim() || generateAdmissionNumber();
  const registrationNumber = (payload.registrationNumber || "").trim();
  let loginEmail = (payload.email || "").trim().toLowerCase();
  if (!loginEmail) {
    loginEmail = generateStudentLoginId(admissionNumber);
  }

  const existingUser = await User.findOne({ email: loginEmail });
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const session = await createSession();

  try {
    const { password: portalPassword, wasGenerated } = resolvePortalPassword(payload.password);

    const createdUsers = await User.create(
      [
        {
          schoolId,
          fullName,
          email: loginEmail,
          phone: payload.phone || "",
          password: portalPassword,
          role: "STUDENT",
          mustChangePassword: wasGenerated
        }
      ],
      getSessionOption(session)
    );
    const user = createdUsers[0]!;

    if (registrationNumber) {
      const dupReg = await Student.findOne({
        schoolId,
        registrationNumber
      }).session(session);
      if (dupReg) {
        throw new ApiError(409, "A student with this registration number already exists");
      }
    }

    const createdStudents = await Student.create(
      [
        {
          schoolId,
          user: user._id,
          admissionNumber,
          registrationNumber,
          rollNumber: payload.rollNumber ?? 0,
          ...(isCollege(institutionType)
            ? {
                ...(payload.batchId ? { batchId: payload.batchId } : {}),
                ...(payload.yearId ? { yearId: payload.yearId } : {})
              }
            : {
                ...(payload.classId ? { classId: payload.classId } : {}),
                ...(payload.sectionId ? { sectionId: payload.sectionId } : {})
              }),
          academicStatus: payload.academicStatus ?? "ACTIVE",
          admissionDateBs: payload.admissionDateBs || "",
          dateOfBirthBs: payload.dateOfBirthBs || "",
          gender: payload.gender || "",
          bloodGroup: payload.bloodGroup,
          disabilityCategory: payload.disabilityCategory,
          ethnicityCategory: payload.ethnicityCategory,
          address: payload.address ?? emptyAddress(),
          fatherName: payload.fatherName || "",
          fatherPhone: payload.fatherPhone || undefined,
          motherName: payload.motherName || "",
          motherPhone: payload.motherPhone || undefined,
          guardianName: payload.guardianName || "",
          guardianPhone: payload.guardianPhone || "",
          feesDueNpr,
          year1FeeNpr,
          year2FeeNpr,
          year3FeeNpr,
          securityDepositNpr,
          hasScholarship,
          remarks: payload.remarks,
          photoUrl: payload.photoUrl || undefined,
          // Missing required categories are stored as PENDING so the student
          // can be created without documents and complete them later.
          documents: ensurePendingRequiredDocuments(payload.documents ?? [])
        }
      ],
      getSessionOption(session)
    );
    const student = createdStudents[0]!;

    // Seed year-wise tuition charges for Accounts / parent fee ledger
    const { seedStudentYearFeeCharges } = await import("../utils/studentFeeAdmission.js");
    await seedStudentYearFeeCharges({
      schoolId,
      studentId: student._id,
      admissionNumber,
      plan: { year1FeeNpr, year2FeeNpr, year3FeeNpr },
      hasScholarship,
      paidDateBs: payload.admissionDateBs || "",
      createdBy: req.user?.userId ?? user._id.toString(),
      session
    });

    await commitTransaction(session);

    const savedStudent = await Student.findById(student._id).populate(
      "user",
      "-password"
    );

    await recordAudit(req, {
      action: "student.create",
      entity: "Student",
      entityId: student._id.toString(),
      after: {
        admissionNumber: student.admissionNumber,
        registrationNumber,
        fullName,
        year1FeeNpr,
        year2FeeNpr,
        year3FeeNpr,
        securityDepositNpr
      }
    });

    const credentialsEmail = await notifyAccountCredentials({
      userId: user._id.toString(),
      fullName,
      email: loginEmail,
      password: portalPassword,
      schoolId: schoolId.toString(),
      req,
      accountKind: "STUDENT"
    });

    return sendSuccess(
      res,
      buildCredentialsAdminMessage(credentialsEmail),
      {
        student: savedStudent ?? student,
        loginEmail,
        defaultPassword: portalPassword,
        credentialsEmail
      },
      201
    );
  } catch (error) {
    await abortTransaction(session);
    throwIfDuplicateKey(error);
    throw error;
  } finally {
    await endSession(session);
  }
});

export const updateStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentSchema.parse(req.body);
  if (payload.admissionDateBs) ensureValidBsDate(payload.admissionDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateStudentAdmissionScope(institutionType, schoolId, payload);

  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const fullName = (payload.fullName || "").trim() || "Student";
  const admissionNumber =
    (payload.admissionNumber || "").trim() || student.admissionNumber || generateAdmissionNumber();
  const registrationNumber = (payload.registrationNumber || "").trim();
  const hasScholarship = Boolean(payload.hasScholarship);
  const year1FeeNpr = hasScholarship
    ? 0
    : Math.max(0, Number(payload.year1FeeNpr) || 0);
  const year2FeeNpr = hasScholarship
    ? 0
    : Math.max(0, Number(payload.year2FeeNpr) || 0);
  const year3FeeNpr = hasScholarship
    ? 0
    : Math.max(0, Number(payload.year3FeeNpr) || 0);
  const securityDepositNpr = Math.max(0, Number(payload.securityDepositNpr) || 0);
  const yearFeeTotal = year1FeeNpr + year2FeeNpr + year3FeeNpr;
  // Keep existing outstanding if no year plan provided; otherwise use plan sum as baseline
  // (recalc after seeding will align with ledger when collections exist)
  let feesDueNpr = hasScholarship
    ? 0
    : yearFeeTotal > 0
      ? yearFeeTotal
      : Math.max(0, Number(payload.feesDueNpr) || 0);

  if (registrationNumber && registrationNumber !== (student.registrationNumber || "")) {
    const dupReg = await Student.findOne({
      schoolId,
      registrationNumber,
      _id: { $ne: student._id }
    });
    if (dupReg) {
      throw new ApiError(409, "A student with this registration number already exists");
    }
  }

  const currentUser = await User.findById(student.user).select("email").lean();
  if (!currentUser) {
    throw new ApiError(404, "User account not found for this student");
  }

  const currentEmail = (currentUser.email ?? "").toLowerCase().trim();
  const submittedEmail = (payload.email || "").trim().toLowerCase();
  const submittedPassword = payload.password?.trim() || "";

  /**
   * Login credentials rules on edit:
   * - Profile / documents / contact alone → keep existing login, never invent password
   * - New Login ID only when admin types a different value
   * - Password only when admin types a new one (never auto-generate on update)
   * - Same Login ID as current → treat as already set (no credential churn)
   */
  let loginEmail = currentEmail;
  let loginIdChanged = false;
  let loginIdAlreadySet = false;

  if (!submittedEmail) {
    // Empty field: keep existing login ID (do not generate a random one on edit)
    if (currentEmail) {
      loginIdAlreadySet = true;
    } else {
      // Rare: student has no portal login yet — create a stable one once
      loginEmail = generateStudentLoginId(admissionNumber);
      loginIdChanged = true;
    }
  } else if (submittedEmail === currentEmail) {
    loginIdAlreadySet = true;
    loginEmail = currentEmail;
  } else {
    const duplicate = await User.findOne({
      email: submittedEmail,
      _id: { $ne: student.user }
    });
    if (duplicate) {
      throw new ApiError(409, "A user with this login ID already exists");
    }
    loginEmail = submittedEmail;
    loginIdChanged = true;
  }

  const portalUpdate = await updatePortalUser(student.user, {
    fullName,
    email: loginEmail,
    phone: payload.phone,
    // Only pass password when admin explicitly set one — never blank-reset
    password: submittedPassword || undefined
  });

  const previousPhotoUrl = student.photoUrl;
  const previousDocuments = [...(student.documents ?? [])];
  const nextPhotoUrl = payload.photoUrl || undefined;
  const nextDocuments = payload.documents ?? student.documents;

  Object.assign(student, {
    admissionNumber,
    registrationNumber,
    rollNumber: payload.rollNumber ?? 0,
    ...(isCollege(institutionType)
      ? {
          batchId: payload.batchId || undefined,
          yearId: payload.yearId || undefined,
          classId: undefined,
          sectionId: undefined
        }
      : {
          classId: payload.classId || undefined,
          sectionId: payload.sectionId || undefined,
          batchId: undefined,
          yearId: undefined
        }),
    admissionDateBs: payload.admissionDateBs || "",
    dateOfBirthBs: payload.dateOfBirthBs || "",
    gender: payload.gender || "",
    bloodGroup: payload.bloodGroup,
    disabilityCategory: payload.disabilityCategory,
    ethnicityCategory: payload.ethnicityCategory,
    address: payload.address ?? emptyAddress(),
    fatherName: payload.fatherName || "",
    fatherPhone: payload.fatherPhone || undefined,
    motherName: payload.motherName || "",
    motherPhone: payload.motherPhone || undefined,
    guardianName: payload.guardianName || "",
    guardianPhone: payload.guardianPhone || "",
    feesDueNpr,
    year1FeeNpr,
    year2FeeNpr,
    year3FeeNpr,
    securityDepositNpr,
    hasScholarship,
    remarks: payload.remarks,
    academicStatus: payload.academicStatus ?? student.academicStatus ?? "ACTIVE",
    photoUrl: nextPhotoUrl,
    documents: nextDocuments
  });

  await student.save();

  // Seed any missing year fee charges for accounts (does not wipe payment history)
  if (!hasScholarship && yearFeeTotal > 0) {
    const { seedStudentYearFeeCharges } = await import("../utils/studentFeeAdmission.js");
    await seedStudentYearFeeCharges({
      schoolId,
      studentId: student._id,
      admissionNumber,
      plan: { year1FeeNpr, year2FeeNpr, year3FeeNpr },
      hasScholarship,
      paidDateBs: payload.admissionDateBs || "",
      createdBy: req.user?.userId ?? student.user.toString(),
      onlyMissingYears: true
    });
    const { recalculateStudentFeesDue } = await import("../utils/accountingCalculations.js");
    feesDueNpr = await recalculateStudentFeesDue(student._id, schoolId);
    student.feesDueNpr = feesDueNpr;
    await student.save();
  }

  await student.populate("user", "-password");

  // Cleanup replaced/removed media (Cloudinary + legacy local)
  {
    const { deleteReplacedMedia, deleteStoredMediaUrls } = await import("../utils/mediaCleanup.js");
    await deleteReplacedMedia(previousPhotoUrl, nextPhotoUrl);
    if (payload.documents) {
      const nextUrls = new Set(
        (nextDocuments ?? [])
          .map((d: { url?: string }) => d.url?.trim())
          .filter((url): url is string => Boolean(url))
      );
      const removedUrls = previousDocuments
        .map((d) => (d as { url?: string }).url?.trim() ?? "")
        .filter((url) => url.length > 0 && !nextUrls.has(url));
      await deleteStoredMediaUrls(removedUrls);
    }
  }

  await recordAudit(req, {
    action: "student.update",
    entity: "Student",
    entityId: student._id.toString(),
    after: {
      admissionNumber: student.admissionNumber,
      fullName,
      loginIdChanged: portalUpdate.loginIdChanged,
      passwordChanged: portalUpdate.passwordChanged
    }
  });

  /**
   * Email new credentials only when the admin explicitly set a new password
   * (optionally with a new Login ID). Never invent a random password on edit.
   */
  const passwordChanged = portalUpdate.passwordChanged && Boolean(portalUpdate.password);
  const credentialsChanged = loginIdChanged || passwordChanged;
  let credentialsEmail: Awaited<ReturnType<typeof notifyAccountCredentials>> | undefined;

  if (passwordChanged && portalUpdate.password) {
    credentialsEmail = await notifyAccountCredentials({
      userId: student.user.toString(),
      fullName,
      email: portalUpdate.email,
      password: portalUpdate.password,
      schoolId: schoolId.toString(),
      req,
      emailType: "PASSWORD_RESET",
      accountKind: "STUDENT"
    });

    return sendSuccess(res, buildPortalCredentialsUpdatedMessage(credentialsEmail, "STUDENT"), {
      student,
      loginEmail: portalUpdate.email,
      ...(credentialsEmail.sent ? {} : { defaultPassword: portalUpdate.password }),
      credentialsEmail,
      credentialsChanged: true,
      loginIdChanged,
      passwordChanged: true
    });
  }

  if (loginIdChanged && !passwordChanged) {
    return sendSuccess(
      res,
      "Student updated successfully. Login ID was updated; password was left unchanged (set a new password only if you want to reset and email it).",
      {
        student,
        loginEmail: portalUpdate.email,
        credentialsChanged: false,
        loginIdChanged: true,
        passwordChanged: false,
        loginIdAlreadySet: false
      }
    );
  }

  // Profile / documents / contact only — login untouched
  const message = loginIdAlreadySet
    ? "Student updated successfully. Login ID is already set for this student (unchanged)."
    : "Student updated successfully";

  return sendSuccess(res, message, {
    student,
    loginEmail: portalUpdate.email,
    credentialsChanged: false,
    loginIdChanged: false,
    passwordChanged: false,
    loginIdAlreadySet
  });
});

/**
 * Hard-delete student: removes Student + User (email, phone, password) and linked records
 * (attendance entries, results, fee rows, parent links, library/transport issues, notifications).
 */
export const deleteStudent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const session = await createSession();
  try {
    const deleted = await hardDeleteStudentAccount({
      schoolId,
      studentId: student._id,
      session
    });

    await commitTransaction(session);

    await recordAudit(req, {
      action: "student.hard_delete",
      entity: "Student",
      entityId: deleted.studentId,
      before: {
        admissionNumber: deleted.admissionNumber,
        fullName: deleted.fullName,
        email: deleted.email,
        userId: deleted.userId
      },
      after: { deleted: true }
    });

    return sendSuccess(res, "Student and login account permanently deleted");
  } catch (error) {
    await abortTransaction(session);
    if (error instanceof Error && error.message === "STUDENT_NOT_FOUND") {
      throw new ApiError(404, "Student not found");
    }
    if (error instanceof Error && error.message === "STUDENT_HAS_FEE_HISTORY") {
      throw new ApiError(
        400,
        "Cannot permanently delete this student while fee collections or refunds exist. Void financial records first or keep the account for audit."
      );
    }
    throw error;
  } finally {
    await endSession(session);
  }
});