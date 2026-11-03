import type { Request, Response } from "express";
import type mongoose from "mongoose";
import {
  canEditOrDeleteRecords,
  EDIT_DELETE_ADMIN_ONLY_MESSAGE,
  ensurePendingRequiredDocuments,
  studentBackCountSchema,
  studentRunningBacklogsSchema,
  studentSchema
} from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { getStudentScopeFilter } from "../utils/parentScope.js";
import { getTeacherStudentFilter, getTeacherScope } from "../utils/teacherScope.js";
import {
  actorCanAdministerModule,
  actorMayUseAdminWorkspaceScope
} from "../utils/workspaceScope.js";
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
import { escapeRegex } from "../utils/escapeRegex.js";
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
    if (await actorMayUseAdminWorkspaceScope(req)) {
      return getStudentScopeFilter(req);
    }
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

/** Student list page order: roll number first (students without one last), then name. */
const compareStudentListRows = (
  a: { rollNumber?: number | null; user?: unknown },
  b: { rollNumber?: number | null; user?: unknown }
): number => {
  const ar = a.rollNumber;
  const br = b.rollNumber;
  const aHas = typeof ar === "number" && Number.isFinite(ar) && ar > 0;
  const bHas = typeof br === "number" && Number.isFinite(br) && br > 0;
  if (aHas && bHas && ar !== br) return (ar as number) - (br as number);
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  const aName = (a.user as { fullName?: string } | null)?.fullName ?? "";
  const bName = (b.user as { fullName?: string } | null)?.fullName ?? "";
  return aName.localeCompare(bName, undefined, { sensitivity: "base" });
};

const isObjectIdString = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

/**
 * Filters of the Students list page (?listView=1): search, batch / year (or class / section),
 * dashboard year name, status and gender. Pickers that call GET /students without
 * listView are unaffected and still receive every student.
 */
const applyStudentListFilters = async (req: Request, filter: Record<string, unknown>): Promise<void> => {
  const q = req.query;
  const and: Array<Record<string, unknown>> = [];
  for (const field of ["batchId", "yearId", "classId", "sectionId"] as const) {
    if (isObjectIdString(q[field])) and.push({ [field]: q[field] });
  }

  const yearName = typeof q.yearName === "string" ? q.yearName.trim() : "";
  if (yearName === "__none__") {
    and.push({ yearId: null });
  } else if (yearName && !isObjectIdString(q.yearId)) {
    const years = await Year.find({ schoolId: tenantObjectId(req) }).select("name").lean();
    const wanted = yearName.toLowerCase();
    const exact = years.filter((y) => (y.name ?? "").trim().toLowerCase() === wanted);
    const matches = exact.length
      ? exact
      : years.filter((y) => {
          const name = (y.name ?? "").trim().toLowerCase();
          return name.includes(wanted) || wanted.includes(name);
        });
    and.push({ yearId: { $in: matches.map((y) => y._id) } });
  }

  const status = typeof q.status === "string" ? q.status.trim().toUpperCase() : "";
  if (status === "ACTIVE") {
    and.push({ $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }] });
  } else if (status) {
    and.push({ academicStatus: status });
  }

  const gender = typeof q.gender === "string" ? q.gender.trim().toLowerCase() : "";
  if (gender === "male" || gender === "female") {
    and.push({ gender: new RegExp(`^\s*${gender}\s*$`, "i") });
  } else if (gender === "other") {
    and.push({ gender: { $not: /^\s*(male|female)\s*$/i } });
  }

  const search = typeof q.q === "string" ? q.q.trim() : "";
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const users = await User.find({
      schoolId: tenantObjectId(req),
      $or: [{ fullName: rx }, { email: rx }, { phone: rx }]
    })
      .select("_id")
      .lean();
    and.push({
      $or: [
        { user: { $in: users.map((u) => u._id) } },
        { admissionNumber: rx },
        { guardianPhone: rx },
        { fatherPhone: rx },
        { motherPhone: rx }
      ]
    });
  }

  if (and.length) {
    filter.$and = [...((filter.$and as Array<Record<string, unknown>>) ?? []), ...and];
  }
};

export const listStudents = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const adminStudentScope = await actorMayUseAdminWorkspaceScope(req);
  const limitedView = usesLimitedStudentView(req.user?.role) && !adminStudentScope;
  const isTeacher = req.user?.role === "TEACHER" && !adminStudentScope;

  // Teachers: only active students in their assigned batch/year (or class/section)
  if (isTeacher) {
    filter.academicStatus = "ACTIVE";
  }

  /**
   * Library / Accounting pickers pass loginActive=1 (or true) so disabled
   * portal accounts never appear for book issue or fee collection.
   * Student list admin UI does NOT pass this — admins still see disabled students.
   */
  const loginActiveOnly = ["1", "true", "yes"].includes(
    String(req.query.loginActive ?? req.query.excludeInactiveLogin ?? "")
      .trim()
      .toLowerCase()
  );

  // Students list page (?listView=1): server-side filters, roll/name order and paging
  // (?page=, ?pageSize= default 50). Exports call without page to get the full filtered set.
  const listView = req.query.listView === "1" || req.query.page !== undefined;
  if (listView) await applyStudentListFilters(req, filter);
  const pageRaw = Number(req.query.page);
  let pageMeta: { page: number; pageSize: number; total: number } | undefined;
  let pageIds: string[] | undefined;
  if (Number.isFinite(pageRaw) && pageRaw >= 1) {
    const page = Math.trunc(pageRaw);
    const pageSizeRaw = Number(req.query.pageSize);
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(Math.trunc(pageSizeRaw), 1), 500) : 50;
    const candidates = await Student.find(filter)
      .select("rollNumber user")
      .populate("user", "fullName isActive")
      .lean();
    const ordered = candidates
      .filter((s) => {
        const u = s.user as { isActive?: boolean } | null | undefined;
        return Boolean(u) && (!loginActiveOnly || u!.isActive !== false);
      })
      .sort(compareStudentListRows);
    pageMeta = { page, pageSize, total: ordered.length };
    pageIds = ordered.slice((page - 1) * pageSize, page * pageSize).map((s) => String(s._id));
  }

  // Always populate academic group labels for roster filters (library issue, etc.)
  const students = await Student.find(pageIds ? { _id: { $in: pageIds } } : filter)
    .populate(
      "user",
      limitedView ? "fullName role isActive" : "-password"
    )
    .populate("batchId", "name")
    .populate("yearId", "name level batchId")
    .populate("classId", "name")
    .populate("sectionId", "name classId")
    .sort({ rollNumber: 1, createdAt: 1 });

  // Drop orphaned rows where the linked User was deleted (populate returns null)
  let linked = students.filter((student) => Boolean(student.user));

  if (loginActiveOnly) {
    linked = linked.filter((student) => {
      const u = student.user as { isActive?: boolean } | null | undefined;
      return u != null && u.isActive !== false;
    });
  }
  if (listView) linked.sort(compareStudentListRows);

  if (limitedView) {
    return sendSuccess(
      res,
      "Students fetched",
      linked.map((s) => sanitizeStudentForLimitedStaffList(s as never)),
      200,
      pageMeta
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

  return sendSuccess(res, "Students fetched", adminRows, 200, pageMeta);
});

export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const filter = await getReadableStudentFilter(req);
  const adminStudentScope = await actorMayUseAdminWorkspaceScope(req);
  const limitedView = usesLimitedStudentView(req.user?.role) && !adminStudentScope;
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

  // Held deposit only from accounting receipts — fix admission amount wrongly stored as paid
  try {
    const { syncStudentSecurityDepositHeldFromLedger } = await import(
      "../utils/studentSecurityDeposit.js"
    );
    await syncStudentSecurityDepositHeldFromLedger(student._id, tenantObjectId(req));
    // Reload after possible correction so response has fresh held/expected
    const refreshed = await Student.findById(student._id).populate("user", "-password");
    if (refreshed) {
      return sendSuccess(res, "Student fetched", refreshed);
    }
  } catch {
    // non-fatal — still return student
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

const assertStudentAdminWrite = async (req: Request): Promise<void> => {
  if (!(await actorCanAdministerModule(req, "students"))) {
    throw new ApiError(403, "You do not have permission to manage student records");
  }
};

const assertStudentRecordEditDelete = (req: Request): void => {
  if (!canEditOrDeleteRecords(req.user?.role ?? "")) {
    throw new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE);
  }
};

export const createStudent = asyncHandler(async (req: Request, res: Response) => {
  await assertStudentAdminWrite(req);
  const payload = studentSchema.parse(req.body);
  if (payload.admissionDateBs) ensureValidBsDate(payload.admissionDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  await validateStudentAdmissionScope(institutionType, schoolId, payload);

  const hasScholarship = Boolean(payload.hasScholarship);
  const securityDepositWaived = Boolean(payload.securityDepositWaived);
  const year1FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year1FeeNpr) || 0);
  const year2FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year2FeeNpr) || 0);
  const year3FeeNpr = hasScholarship ? 0 : Math.max(0, Number(payload.year3FeeNpr) || 0);
  // Planned deposit only — held/collected amount is set when recording fee payment
  const securityDepositExpectedNpr = securityDepositWaived
    ? 0
    : Math.max(
        0,
        Number(payload.securityDepositExpectedNpr) ||
          Number(payload.securityDepositNpr) ||
          0
      );
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
          backCount:
            (payload.academicStatus ?? "ACTIVE") === "PENDING_NOT_PASSED"
              ? Math.max(1, Math.min(50, Math.floor(Number(payload.backCount) || 1)))
              : 0,
          admissionDateBs: payload.admissionDateBs || "",
          dateOfBirthBs: payload.dateOfBirthBs || "",
          gender: payload.gender || "",
          bloodGroup: payload.bloodGroup,
          disabilityCategory: payload.disabilityCategory,
          ethnicityCategory: payload.ethnicityCategory,
          religion: payload.religion,
          caste: payload.caste || "",
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
          securityDepositExpectedNpr,
          /** Held deposit starts at 0 until recorded in Student Fee Records. */
          securityDepositNpr: 0,
          securityDepositRefundedNpr: 0,
          securityDepositWaived,
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
        securityDepositExpectedNpr,
        securityDepositNpr: 0
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
  await assertStudentAdminWrite(req);
  assertStudentRecordEditDelete(req);
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
  const securityDepositWaived = Boolean(payload.securityDepositWaived);

  // Align held with accounting receipts first (admission plan must not appear as collected)
  try {
    const { syncStudentSecurityDepositHeldFromLedger } = await import(
      "../utils/studentSecurityDeposit.js"
    );
    await syncStudentSecurityDepositHeldFromLedger(student._id, schoolId);
    const latest = await Student.findById(student._id).select(
      "securityDepositNpr securityDepositRefundedNpr securityDepositExpectedNpr"
    );
    if (latest) {
      student.securityDepositNpr = latest.securityDepositNpr;
      student.securityDepositRefundedNpr = latest.securityDepositRefundedNpr;
      if (!(Number(student.securityDepositExpectedNpr) > 0) && Number(latest.securityDepositExpectedNpr) > 0) {
        student.securityDepositExpectedNpr = latest.securityDepositExpectedNpr;
      }
    }
  } catch {
    // continue with existing held
  }

  const heldDeposit = Math.max(0, Number(student.securityDepositNpr) || 0);
  const refundedDeposit = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
  const remainingHeld = Math.max(0, heldDeposit - refundedDeposit);
  if (securityDepositWaived && remainingHeld > 0.001) {
    throw new ApiError(
      400,
      `Cannot mark security deposit as not taken while ${remainingHeld} NPR is still held. Record a deposit refund first, or keep the deposit on file.`
    );
  }
  // Form amount is planned/expected only — never overwrite held collected deposit.
  // Prefer securityDepositExpectedNpr; legacy clients may still send securityDepositNpr as plan.
  const securityDepositExpectedNpr = securityDepositWaived
    ? 0
    : Math.max(
        0,
        Number(payload.securityDepositExpectedNpr) ||
          Number(payload.securityDepositNpr) ||
          0
      );
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
    religion: payload.religion,
    caste: payload.caste || "",
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
    securityDepositExpectedNpr,
    // Do not overwrite securityDepositNpr (held) or securityDepositRefundedNpr here
    securityDepositWaived,
    hasScholarship,
    remarks: payload.remarks,
    academicStatus: payload.academicStatus ?? student.academicStatus ?? "ACTIVE",
    // Leaving Back clears the back papers; while Back, listed papers define the count
    ...((payload.academicStatus ?? student.academicStatus ?? "ACTIVE") !== "PENDING_NOT_PASSED"
      ? { backPapers: [] }
      : {}),
    backCount: (() => {
      const status =
        payload.academicStatus ?? student.academicStatus ?? "ACTIVE";
      if (status !== "PENDING_NOT_PASSED") return 0;
      const papers = (student.backPapers ?? []).length;
      if (papers > 0) return Math.min(50, papers);
      const n = Math.floor(Number(payload.backCount));
      if (Number.isFinite(n) && n >= 1) return Math.min(50, n);
      // Keep existing count if payload omitted a valid number while still Back
      const existing = Math.floor(Number(student.backCount) || 0);
      return existing >= 1 ? Math.min(50, existing) : 1;
    })(),
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
 * Examination Management → Back Students: update number of remaining backs only.
 * Student must already have academicStatus PENDING_NOT_PASSED ("Back").
 */
/** CTEVT → Running Batch Backlogs: set the backlog papers of a student still studying. */
export const updateStudentRunningBacklogs = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentRunningBacklogsSchema.parse(req.body);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  const status = student.academicStatus ?? "ACTIVE";
  if (status !== "ACTIVE") {
    throw new ApiError(
      400,
      status === "PENDING_NOT_PASSED"
        ? "This student has academic status Back — record their subjects in Back Students"
        : "Running batch backlogs can only be recorded for active (studying) students"
    );
  }

  const seen = new Set<string>();
  const backlogs = payload.backlogs
    .map((p) => ({ subjectName: p.subjectName.trim(), subjectCode: (p.subjectCode ?? "").trim(), programYear: p.programYear }))
    .filter((p) => {
      const key = `${p.subjectName.toLowerCase()}|${p.programYear}`;
      if (!p.subjectName || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const before = (student.runningBacklogs ?? []).map((p) => ({
    subjectName: p.subjectName,
    subjectCode: p.subjectCode ?? "",
    programYear: p.programYear
  }));
  student.runningBacklogs = backlogs as unknown as typeof student.runningBacklogs;
  await student.save();

  await recordAudit(req, {
    action: "student.running_backlogs_update",
    entity: "Student",
    entityId: student._id.toString(),
    before: { runningBacklogs: before },
    after: { runningBacklogs: student.runningBacklogs }
  });

  return sendSuccess(res, backlogs.length ? "Backlogs updated" : "Backlogs cleared", {
    _id: student._id.toString(),
    runningBacklogs: student.runningBacklogs
  });
});

export const updateStudentBackCount = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentBackCountSchema.parse(req.body);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  if ((student.academicStatus ?? "ACTIVE") !== "PENDING_NOT_PASSED") {
    throw new ApiError(
      400,
      "Number of backs can only be set for students with academic status Back"
    );
  }

  const before = {
    backCount: student.backCount ?? 0,
    backPapers: (student.backPapers ?? []).map((p) => ({
      subjectName: p.subjectName,
      subjectCode: p.subjectCode ?? "",
      programYear: p.programYear
    }))
  };
  if (payload.backPapers !== undefined) {
    // Papers listed → they define the number of backs
    student.backPapers = payload.backPapers.map((p) => ({
      subjectName: p.subjectName.trim(),
      subjectCode: (p.subjectCode ?? "").trim(),
      programYear: p.programYear
    })) as unknown as typeof student.backPapers;
  }
  const paperCount = (student.backPapers ?? []).length;
  student.backCount = paperCount > 0 ? paperCount : (payload.backCount ?? student.backCount ?? 1);
  await student.save();

  await recordAudit(req, {
    action: "student.back_count_update",
    entity: "Student",
    entityId: student._id.toString(),
    before: { ...before, academicStatus: student.academicStatus },
    after: {
      backCount: student.backCount,
      backPapers: student.backPapers,
      academicStatus: student.academicStatus
    }
  });

  const populated = await Student.findById(student._id)
    .populate("user", "-password")
    .populate("batchId", "name")
    .populate("yearId", "name level batchId")
    .lean();

  return sendSuccess(res, "Number of backs updated", populated ?? student);
});

type CtevtFeeKind = "registration" | "exam";

const CTEVT_FEE_FIELDS: Record<
  CtevtFeeKind,
  { status: string; updatedAt: string; label: string; auditAction: string }
> = {
  registration: {
    status: "ctevtRegistrationFeeStatus",
    updatedAt: "ctevtRegistrationFeeUpdatedAt",
    label: "registration fee",
    auditAction: "student.ctevt_registration_fee"
  },
  exam: {
    status: "ctevtExamFeeStatus",
    updatedAt: "ctevtExamFeeUpdatedAt",
    label: "exam fee",
    auditAction: "student.ctevt_exam_fee"
  }
};

/**
 * CTEVT Examination Management — set fee status (PAID / NOT_PAID) or clear (blank).
 * Used for Registration fee and Exam fee.
 */
const updateCtevtFeeStatus = (kind: CtevtFeeKind) =>
  asyncHandler(async (req: Request, res: Response) => {
    const fields = CTEVT_FEE_FIELDS[kind];
    const statusRaw = String(req.body?.status ?? "").trim().toUpperCase();
    const clearStatus =
      statusRaw === "" ||
      statusRaw === "CLEAR" ||
      statusRaw === "NONE" ||
      statusRaw === "UNSET" ||
      req.body?.clear === true;

    if (!clearStatus && statusRaw !== "PAID" && statusRaw !== "NOT_PAID") {
      throw new ApiError(400, "Status must be PAID, NOT_PAID, or CLEAR");
    }
    const status = clearStatus ? null : (statusRaw as "PAID" | "NOT_PAID");

    const rawIds = req.body?.studentIds;
    const studentIds: string[] = Array.isArray(rawIds)
      ? rawIds.map((id: unknown) => String(id ?? "").trim()).filter(Boolean)
      : typeof req.body?.studentId === "string" && req.body.studentId.trim()
        ? [req.body.studentId.trim()]
        : [];

    if (studentIds.length === 0) {
      throw new ApiError(400, "Select at least one student");
    }
    if (studentIds.length > 500) {
      throw new ApiError(400, "You can update at most 500 students at once");
    }

    const now = new Date();
    const result = await Student.updateMany(
      withTenantScope(req, { _id: { $in: studentIds } }),
      clearStatus
        ? {
            $unset: {
              [fields.status]: 1,
              [fields.updatedAt]: 1
            }
          }
        : {
            $set: {
              [fields.status]: status,
              [fields.updatedAt]: now
            }
          }
    );

    await recordAudit(req, {
      action: fields.auditAction,
      entity: "Student",
      entityId: studentIds[0] ?? "",
      after: {
        kind,
        status: status ?? "CLEARED",
        studentIds,
        matched: result.matchedCount,
        modified: result.modifiedCount
      }
    });

    return sendSuccess(
      res,
      clearStatus
        ? `CTEVT ${fields.label} status cleared`
        : `CTEVT ${fields.label} status updated`,
      {
        kind,
        status: status ?? null,
        cleared: clearStatus,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        studentIds
      }
    );
  });

/** CTEVT → Registration fee */
export const updateCtevtRegistrationFee = updateCtevtFeeStatus("registration");

/** CTEVT → Exam fee */
export const updateCtevtExamFee = updateCtevtFeeStatus("exam");

/**
 * Enable / disable student portal login (User.isActive).
 * When disabled, the student cannot sign in; existing sessions are rejected by protect().
 */
export const setStudentLoginAccess = asyncHandler(async (req: Request, res: Response) => {
  await assertStudentAdminWrite(req);
  const raw = req.body?.isActive ?? req.body?.status;
  let nextActive: boolean | null = null;
  if (raw === true || raw === "true" || raw === "ACTIVE" || raw === "ENABLED") {
    nextActive = true;
  } else if (
    raw === false ||
    raw === "false" ||
    raw === "INACTIVE" ||
    raw === "DISABLED"
  ) {
    nextActive = false;
  }
  if (nextActive === null) {
    throw new ApiError(400, "Send isActive true/false (or status ACTIVE/INACTIVE)");
  }

  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  if (!student.user) {
    throw new ApiError(400, "This student has no login account linked");
  }

  const user = await User.findById(student.user);
  if (!user) {
    throw new ApiError(404, "User account not found for this student");
  }

  user.isActive = nextActive;
  await user.save();

  await recordAudit(req, {
    action: nextActive ? "student.login_enable" : "student.login_disable",
    entity: "Student",
    entityId: student._id.toString(),
    after: { isActive: nextActive, userId: user._id.toString() }
  });

  await student.populate("user", "-password");

  return sendSuccess(
    res,
    nextActive
      ? "Student access enabled — they can log in again"
      : "Student access disabled — they cannot log in",
    student
  );
});

/**
 * Hard-delete student: removes Student + User (email, phone, password) and linked records
 * (attendance entries, results, fee rows, parent links, library/transport issues, notifications).
 */
export const deleteStudent = asyncHandler(async (req: Request, res: Response) => {
  await assertStudentAdminWrite(req);
  assertStudentRecordEditDelete(req);
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
/**
 * Read-only data check for admins: student records whose status and placement disagree.
 *  - Passed Out students still placed in 3rd Year (a passed-out student has finished the years).
 *  - Active students in an ended batch (batch marked inactive) or placed at year "Ended".
 * Nothing is changed; each row links to the student so it can be corrected by hand.
 */
export const getStudentDataChecks = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const [students, batches, years] = await Promise.all([
    Student.find({ schoolId })
      .select("admissionNumber rollNumber academicStatus batchId yearId user")
      .populate("user", "fullName")
      .lean(),
    Batch.find({ schoolId }).select("name academicYearBs isActive").lean(),
    Year.find({ schoolId }).select("name").lean()
  ]);
  const batchById = new Map(batches.map((b) => [b._id.toString(), b]));
  const yearNameById = new Map(years.map((y) => [y._id.toString(), y.name]));
  const describe = (student: (typeof students)[number], reason: string) => {
    const batch = student.batchId ? batchById.get(student.batchId.toString()) : undefined;
    return {
      studentId: student._id.toString(),
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber,
      fullName: (student.user as { fullName?: string } | null)?.fullName ?? "",
      batchName: batch ? `${batch.name}${batch.academicYearBs ? ` (${batch.academicYearBs})` : ""}` : "",
      yearName: student.yearId ? (yearNameById.get(student.yearId.toString()) ?? "") : "",
      academicStatus: student.academicStatus ?? "ACTIVE",
      reason
    };
  };

  const passedOutInThirdYear = students
    .filter(
      (s) =>
        s.academicStatus === "PASSED_OUT" &&
        Boolean(s.yearId) &&
        yearNameById.get(String(s.yearId)) === "3rd Year"
    )
    .map((s) => describe(s, "Status is Passed Out but the student is still placed in 3rd Year"));

  const activeInEndedBatch = students
    .filter((s) => (s.academicStatus ?? "ACTIVE") === "ACTIVE")
    .flatMap((s) => {
      const batch = s.batchId ? batchById.get(s.batchId.toString()) : undefined;
      const yearName = s.yearId ? yearNameById.get(s.yearId.toString()) : undefined;
      if (batch && batch.isActive === false) {
        return [describe(s, "Active student in a batch marked as ended (inactive)")];
      }
      if (yearName === "Ended") {
        return [describe(s, "Active student placed at year \"Ended\"")];
      }
      return [];
    });

  return sendSuccess(res, "Student data checks", { passedOutInThirdYear, activeInEndedBatch });
});
