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

/** Teachers only need roster fields — not full personal / guardian / fee data. */
const sanitizeStudentForTeacherList = (student: {
  toObject?: () => Record<string, unknown>;
  _id: { toString(): string };
  admissionNumber: string;
  rollNumber: number;
  classId?: { toString(): string };
  sectionId?: { toString(): string };
  batchId?: { toString(): string };
  yearId?: { toString(): string };
  academicStatus?: string;
  gender: string;
  photoUrl?: string;
  user?: { _id?: { toString(): string }; fullName?: string; role?: string } | null;
}) => {
  const plain = typeof student.toObject === "function" ? student.toObject() : (student as unknown as Record<string, unknown>);
  const user = plain.user as { _id?: unknown; fullName?: string; role?: string } | null | undefined;
  return {
    _id: student._id,
    schoolId: plain.schoolId,
    admissionNumber: student.admissionNumber,
    rollNumber: student.rollNumber,
    classId: student.classId,
    sectionId: student.sectionId,
    batchId: student.batchId,
    yearId: student.yearId,
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

export const listStudents = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const isTeacher = req.user?.role === "TEACHER";

  // Teachers: only active students in their assigned batch/year (or class/section)
  if (isTeacher) {
    filter.academicStatus = "ACTIVE";
  }

  const students = await Student.find(filter)
    .populate("user", isTeacher ? "fullName role" : "-password")
    .sort(isTeacher ? { rollNumber: 1, createdAt: -1 } : { createdAt: -1 });

  // Drop orphaned rows where the linked User was deleted (populate returns null)
  const linked = students.filter((student) => Boolean(student.user));

  if (isTeacher) {
    return sendSuccess(
      res,
      "Students fetched",
      linked.map((s) => sanitizeStudentForTeacherList(s as never))
    );
  }

  return sendSuccess(res, "Students fetched", linked);
});

export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const student = await Student.findOne({ ...filter, _id: req.params.id }).populate(
    "user",
    req.user?.role === "TEACHER" ? "fullName role" : "-password"
  );

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  if (req.user?.role === "TEACHER") {
    return sendSuccess(res, "Student fetched", sanitizeStudentForTeacherList(student as never));
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
  const feesDueNpr = hasScholarship ? 0 : (payload.feesDueNpr ?? 0);
  const fullName = (payload.fullName || "").trim() || "Student";
  const admissionNumber =
    (payload.admissionNumber || "").trim() || generateAdmissionNumber();
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

    const createdStudents = await Student.create(
      [
        {
          schoolId,
          user: user._id,
          admissionNumber,
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

    await commitTransaction(session);
    await student.populate("user", "-password");

    await recordAudit(req, {
      action: "student.create",
      entity: "Student",
      entityId: student._id.toString(),
      after: { admissionNumber: student.admissionNumber, fullName }
    });

    const credentialsEmail = await notifyAccountCredentials({
      userId: user._id.toString(),
      fullName,
      email: loginEmail,
      password: portalPassword,
      schoolId: schoolId.toString(),
      req
    });

    return sendSuccess(
      res,
      buildCredentialsAdminMessage(credentialsEmail),
      {
        student,
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
  const hasScholarship = Boolean(payload.hasScholarship);
  const feesDueNpr = hasScholarship ? 0 : (payload.feesDueNpr ?? 0);

  let loginEmail = (payload.email || "").trim().toLowerCase();
  if (!loginEmail) {
    const current = await User.findById(student.user).select("email").lean();
    loginEmail = current?.email || generateStudentLoginId(admissionNumber);
  }

  const currentUser = await User.findById(student.user).select("email").lean();

  if (loginEmail !== currentUser?.email) {
    const duplicate = await User.findOne({ email: loginEmail, _id: { $ne: student.user } });
    if (duplicate) {
      throw new ApiError(409, "A user with this login ID already exists");
    }
  }

  await updatePortalUser(student.user, {
    fullName,
    email: loginEmail,
    phone: payload.phone,
    password: payload.password
  });

  Object.assign(student, {
    admissionNumber,
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
    hasScholarship,
    remarks: payload.remarks,
    academicStatus: payload.academicStatus ?? student.academicStatus ?? "ACTIVE",
    photoUrl: payload.photoUrl || undefined,
    documents: payload.documents ?? student.documents
  });

  await student.save();
  await student.populate("user", "-password");

  await recordAudit(req, {
    action: "student.update",
    entity: "Student",
    entityId: student._id.toString(),
    after: { admissionNumber: student.admissionNumber, fullName }
  });

  return sendSuccess(res, "Student updated successfully", student);
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