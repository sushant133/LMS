import {
  DEFAULT_LIBRARY_ISSUE_LIMIT,
  LIBRARY_ISSUE_LIMIT_YEAR_LEVELS,
  defaultLibraryIssueStaffLimits,
  defaultLibraryIssueYearLimits,
  libraryBorrowerTypeLabel,
  type LibraryBorrowStatus,
  type LibraryBorrowerType,
  type LibraryIssueLimitYearLevel,
  type LibraryIssueStaffLimits,
  type LibraryIssueYearLimits,
  type LibraryStudentBorrowStatus
} from "@phit-erp/shared";
import { LibraryIssueLimitConfig } from "../models/LibraryIssueLimitConfig.js";
import { LibraryIssueLimitException } from "../models/LibraryIssueLimitException.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { Batch } from "../models/Batch.js";
import { User } from "../models/User.js";
import { compareBsDates, getTodayBs } from "./nepaliDate.js";

export const isLibraryIssueLimitYearLevel = (
  name: string | null | undefined
): name is LibraryIssueLimitYearLevel =>
  Boolean(
    name &&
      (LIBRARY_ISSUE_LIMIT_YEAR_LEVELS as readonly string[]).includes(name)
  );

const normalizeLimits = (raw: unknown): LibraryIssueYearLimits => {
  const base = defaultLibraryIssueYearLimits();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const year of LIBRARY_ISSUE_LIMIT_YEAR_LEVELS) {
    const n = Number(obj[year]);
    if (Number.isFinite(n) && n >= 0 && n <= 50) {
      base[year] = Math.floor(n);
    }
  }
  return base;
};

/** Configs written before teacher/staff limits existed fall back to defaults. */
const normalizeStaffLimits = (raw: unknown): LibraryIssueStaffLimits => {
  const base = defaultLibraryIssueStaffLimits();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const key of ["TEACHER", "STAFF"] as const) {
    const n = Number(obj[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 50) {
      base[key] = Math.floor(n);
    }
  }
  return base;
};

/** The exception / issue field that addresses a borrower of this type. */
const borrowerField = (
  borrowerType: LibraryBorrowerType
): "studentId" | "teacherId" | "staffId" =>
  borrowerType === "STUDENT"
    ? "studentId"
    : borrowerType === "TEACHER"
      ? "teacherId"
      : "staffId";

/** Missing borrowerType means the row predates teacher/staff support. */
export const exceptionBorrowerType = (row: {
  borrowerType?: string | null;
  teacherId?: unknown;
  staffId?: unknown;
}): LibraryBorrowerType => {
  const raw = String(row.borrowerType || "").toUpperCase();
  if (raw === "TEACHER" || raw === "STAFF" || raw === "STUDENT") return raw;
  if (row.teacherId) return "TEACHER";
  if (row.staffId) return "STAFF";
  return "STUDENT";
};

export const getOrCreateIssueLimitConfig = async (
  schoolId: string
): Promise<{
  limits: LibraryIssueYearLimits;
  staffLimits: LibraryIssueStaffLimits;
  _id: string;
  updatedBy?: string;
  updatedAt?: Date;
  createdAt?: Date;
}> => {
  let doc = await LibraryIssueLimitConfig.findOne({ schoolId });
  if (!doc) {
    try {
      doc = await LibraryIssueLimitConfig.create({
        schoolId,
        limits: defaultLibraryIssueYearLimits(),
        staffLimits: defaultLibraryIssueStaffLimits()
      });
    } catch (error) {
      // Race: another request created the config first
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 11000
      ) {
        doc = await LibraryIssueLimitConfig.findOne({ schoolId });
      } else {
        throw error;
      }
    }
  }
  if (!doc) {
    throw new Error("Could not load or create library issue limit config");
  }
  return {
    _id: doc._id.toString(),
    limits: normalizeLimits(doc.limits),
    staffLimits: normalizeStaffLimits(doc.staffLimits),
    updatedBy: doc.updatedBy?.toString(),
    updatedAt: (doc as { updatedAt?: Date }).updatedAt,
    createdAt: (doc as { createdAt?: Date }).createdAt
  };
};

/** Active = not revoked, from <= today, until empty or until >= today. */
export const isExceptionActiveOnDate = (
  exception: {
    isRevoked?: boolean;
    effectiveFromBs: string;
    effectiveUntilBs?: string | null;
  },
  dateBs: string = getTodayBs()
): boolean => {
  if (exception.isRevoked) return false;
  if (compareBsDates(exception.effectiveFromBs, dateBs) > 0) return false;
  const until = (exception.effectiveUntilBs ?? "").trim();
  if (until && compareBsDates(until, dateBs) < 0) return false;
  return true;
};

const missingBorrowerStatus = (
  borrowerType: LibraryBorrowerType,
  borrowerId: string,
  message: string
): LibraryBorrowStatus => ({
  borrowerType,
  borrowerId,
  studentId: borrowerType === "STUDENT" ? borrowerId : undefined,
  yearName: null,
  yearLevel: null,
  issuedCount: 0,
  yearDefaultLimit: DEFAULT_LIBRARY_ISSUE_LIMIT,
  exceptionAdditional: 0,
  hasActiveException: false,
  activeExceptions: [],
  maxAllowed: DEFAULT_LIBRARY_ISSUE_LIMIT,
  remaining: DEFAULT_LIBRARY_ISSUE_LIMIT,
  canIssue: true,
  limitReached: false,
  message
});

/**
 * Current holdings vs. allowance for any borrower kind.
 *
 * Students draw their default from the year table; teachers and college staff
 * from the flat staffLimits. Active exceptions add on top for all three.
 */
export const resolveBorrowStatus = async (params: {
  schoolId: string;
  borrowerType: LibraryBorrowerType;
  borrowerId: string;
}): Promise<LibraryBorrowStatus> => {
  const { schoolId, borrowerType, borrowerId } = params;
  const todayBs = getTodayBs();
  const field = borrowerField(borrowerType);

  const [config, issuedCount, exceptions] = await Promise.all([
    getOrCreateIssueLimitConfig(schoolId),
    LibraryIssue.countDocuments({
      schoolId,
      [field]: borrowerId,
      status: { $in: ["ISSUED", "OVERDUE"] }
    }),
    LibraryIssueLimitException.find({
      schoolId,
      [field]: borrowerId,
      isRevoked: false
    })
      .sort({ createdAt: -1 })
      .lean()
  ]);

  let borrowerName: string | undefined;
  let yearName: string | null = null;
  let defaultLimit: number;

  if (borrowerType === "STUDENT") {
    const student = await Student.findOne({ _id: borrowerId, schoolId })
      .populate("user", "fullName")
      .lean();
    if (!student) {
      return missingBorrowerStatus(
        borrowerType,
        borrowerId,
        "Student not found for limit check"
      );
    }
    borrowerName =
      (student.user as { fullName?: string } | null | undefined)?.fullName ??
      undefined;
    if (student.yearId) {
      const year = await Year.findById(student.yearId).select("name").lean();
      yearName = year?.name?.trim() || null;
    }
    defaultLimit = isLibraryIssueLimitYearLevel(yearName)
      ? config.limits[yearName]
      : DEFAULT_LIBRARY_ISSUE_LIMIT;
  } else if (borrowerType === "TEACHER") {
    const teacher = await Teacher.findOne({ _id: borrowerId, schoolId })
      .populate("user", "fullName")
      .lean();
    if (!teacher) {
      return missingBorrowerStatus(
        borrowerType,
        borrowerId,
        "Teacher not found for limit check"
      );
    }
    borrowerName =
      (teacher.user as { fullName?: string } | null | undefined)?.fullName ??
      undefined;
    defaultLimit = config.staffLimits.TEACHER;
  } else {
    const staff = await CollegeStaff.findOne({ _id: borrowerId, schoolId })
      .select("fullName")
      .lean();
    if (!staff) {
      return missingBorrowerStatus(
        borrowerType,
        borrowerId,
        "Staff member not found for limit check"
      );
    }
    borrowerName = staff.fullName ?? undefined;
    defaultLimit = config.staffLimits.STAFF;
  }

  const active = exceptions.filter((e) =>
    isExceptionActiveOnDate(
      {
        isRevoked: e.isRevoked,
        effectiveFromBs: e.effectiveFromBs,
        effectiveUntilBs: e.effectiveUntilBs
      },
      todayBs
    )
  );

  const exceptionAdditional = active.reduce(
    (sum, e) => sum + Math.max(0, Number(e.additionalBooks) || 0),
    0
  );

  const maxAllowed = Math.max(0, defaultLimit + exceptionAdditional);
  const remaining = Math.max(0, maxAllowed - issuedCount);
  const limitReached = issuedCount >= maxAllowed;

  let message: string | undefined;
  if (limitReached) {
    const who =
      borrowerType === "STUDENT"
        ? "This student has already borrowed the maximum number of books allowed (" +
          maxAllowed +
          ") for " +
          (yearName || "their year") +
          "."
        : "This " +
          libraryBorrowerTypeLabel(borrowerType).toLowerCase() +
          " has already borrowed the maximum number of books allowed (" +
          maxAllowed +
          ").";
    message = "Book issue limit reached. " + who;
  }

  return {
    borrowerType,
    borrowerId,
    borrowerName,
    studentId: borrowerType === "STUDENT" ? borrowerId : undefined,
    studentName: borrowerType === "STUDENT" ? borrowerName : undefined,
    yearName,
    yearLevel: isLibraryIssueLimitYearLevel(yearName) ? yearName : null,
    issuedCount,
    yearDefaultLimit: defaultLimit,
    exceptionAdditional,
    hasActiveException: active.length > 0,
    activeExceptions: active.map((e) => ({
      _id: e._id.toString(),
      additionalBooks: e.additionalBooks,
      reason: e.reason,
      effectiveFromBs: e.effectiveFromBs,
      effectiveUntilBs: e.effectiveUntilBs || undefined
    })),
    maxAllowed,
    remaining,
    canIssue: !limitReached,
    limitReached,
    message
  };
};

export const resolveStudentBorrowStatus = async (params: {
  schoolId: string;
  studentId: string;
}): Promise<LibraryStudentBorrowStatus> => {
  const status = await resolveBorrowStatus({
    schoolId: params.schoolId,
    borrowerType: "STUDENT",
    borrowerId: params.studentId
  });
  return { ...status, studentId: params.studentId };
};

const idOf = (value: unknown): string =>
  String(
    typeof value === "object" && value && "_id" in (value as object)
      ? (value as { _id: { toString(): string } })._id
      : value ?? ""
  );

export const enrichException = async (
  _schoolId: string,
  doc: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const borrowerType = exceptionBorrowerType({
    borrowerType: doc.borrowerType as string | undefined,
    teacherId: doc.teacherId,
    staffId: doc.staffId
  });
  const studentId = idOf(doc.studentId);
  const teacherId = idOf(doc.teacherId);
  const staffId = idOf(doc.staffId);
  const borrowerId =
    borrowerType === "STUDENT"
      ? studentId
      : borrowerType === "TEACHER"
        ? teacherId
        : staffId;

  const [createdBy, updatedBy, revokedBy] = await Promise.all([
    doc.createdBy
      ? User.findById(doc.createdBy).select("fullName").lean()
      : null,
    doc.updatedBy
      ? User.findById(doc.updatedBy).select("fullName").lean()
      : null,
    doc.revokedBy
      ? User.findById(doc.revokedBy).select("fullName").lean()
      : null
  ]);

  const base = {
    ...doc,
    _id: String(doc._id),
    borrowerType,
    borrowerId,
    isRevoked: Boolean(doc.isRevoked),
    createdByName: createdBy?.fullName,
    updatedByName: updatedBy?.fullName,
    revokedByName: revokedBy?.fullName
  };

  if (borrowerType === "TEACHER") {
    const teacher = teacherId
      ? await Teacher.findById(teacherId).populate("user", "fullName").lean()
      : null;
    const name =
      (teacher?.user as { fullName?: string } | null | undefined)?.fullName ??
      "Teacher";
    return {
      ...base,
      teacherId,
      borrowerName: name,
      designation: (teacher as { designation?: string } | null)?.designation
    };
  }

  if (borrowerType === "STAFF") {
    const staff = staffId
      ? await CollegeStaff.findById(staffId)
          .select("fullName designation department staffId")
          .lean()
      : null;
    return {
      ...base,
      staffId,
      borrowerName: staff?.fullName ?? "Staff",
      designation: staff?.designation,
      department: staff?.department,
      staffCode: (staff as { staffId?: string } | null)?.staffId
    };
  }

  const student = studentId
    ? await Student.findById(studentId).populate("user", "fullName").lean()
    : null;

  let yearName: string | undefined;
  let batchName: string | undefined;
  if (student?.yearId) {
    const year = await Year.findById(student.yearId).select("name").lean();
    yearName = year?.name;
  }
  if (student?.batchId) {
    const batch = await Batch.findById(student.batchId).select("name").lean();
    batchName = batch?.name;
  }

  const studentName =
    (student?.user as { fullName?: string } | null | undefined)?.fullName ??
    "Student";

  return {
    ...base,
    studentId,
    studentName,
    borrowerName: studentName,
    admissionNumber: student?.admissionNumber,
    yearName,
    batchName
  };
};
