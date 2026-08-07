import {
  DEFAULT_LIBRARY_ISSUE_LIMIT,
  LIBRARY_ISSUE_LIMIT_YEAR_LEVELS,
  defaultLibraryIssueYearLimits,
  type LibraryIssueLimitYearLevel,
  type LibraryIssueYearLimits,
  type LibraryStudentBorrowStatus
} from "@phit-erp/shared";
import { LibraryIssueLimitConfig } from "../models/LibraryIssueLimitConfig.js";
import { LibraryIssueLimitException } from "../models/LibraryIssueLimitException.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { Student } from "../models/Student.js";
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

export const getOrCreateIssueLimitConfig = async (
  schoolId: string
): Promise<{
  limits: LibraryIssueYearLimits;
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
        limits: defaultLibraryIssueYearLimits()
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
  const limits = normalizeLimits(doc.limits);
  return {
    _id: doc._id.toString(),
    limits,
    updatedBy: doc.updatedBy?.toString(),
    updatedAt: (doc as { updatedAt?: Date }).updatedAt,
    createdAt: (doc as { createdAt?: Date }).createdAt
  };
};

/** Active = not revoked, from ≤ today, until empty or until ≥ today. */
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

export const resolveStudentBorrowStatus = async (params: {
  schoolId: string;
  studentId: string;
}): Promise<LibraryStudentBorrowStatus> => {
  const { schoolId, studentId } = params;
  const todayBs = getTodayBs();

  const [config, student, issuedCount, exceptions] = await Promise.all([
    getOrCreateIssueLimitConfig(schoolId),
    Student.findOne({ _id: studentId, schoolId })
      .populate("user", "fullName")
      .lean(),
    LibraryIssue.countDocuments({
      schoolId,
      studentId,
      status: { $in: ["ISSUED", "OVERDUE"] }
    }),
    LibraryIssueLimitException.find({
      schoolId,
      studentId,
      isRevoked: false
    })
      .sort({ createdAt: -1 })
      .lean()
  ]);

  if (!student) {
    return {
      studentId,
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
      message: "Student not found for limit check"
    };
  }

  let yearName: string | null = null;
  if (student.yearId) {
    const year = await Year.findById(student.yearId).select("name").lean();
    yearName = year?.name?.trim() || null;
  }

  const yearLevel = isLibraryIssueLimitYearLevel(yearName) ? yearName : null;
  const yearDefaultLimit = yearLevel
    ? config.limits[yearLevel]
    : DEFAULT_LIBRARY_ISSUE_LIMIT;

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

  const maxAllowed = Math.max(0, yearDefaultLimit + exceptionAdditional);
  const remaining = Math.max(0, maxAllowed - issuedCount);
  const limitReached = issuedCount >= maxAllowed;
  const canIssue = !limitReached;

  let message: string | undefined;
  if (limitReached) {
    const yearLabel = yearName || "their year";
    message = `Book issue limit reached. This student has already borrowed the maximum number of books allowed (${maxAllowed}) for ${yearLabel}.`;
  }

  const studentName =
    (student.user as { fullName?: string } | null | undefined)?.fullName ??
    undefined;

  return {
    studentId,
    studentName,
    yearName,
    yearLevel,
    issuedCount,
    yearDefaultLimit,
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
    canIssue,
    limitReached,
    message
  };
};

export const enrichException = async (
  schoolId: string,
  doc: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const studentId = String(
    typeof doc.studentId === "object" &&
      doc.studentId &&
      "_id" in (doc.studentId as object)
      ? (doc.studentId as { _id: { toString(): string } })._id
      : doc.studentId ?? ""
  );

  const [student, createdBy, updatedBy, revokedBy] = await Promise.all([
    studentId
      ? Student.findById(studentId).populate("user", "fullName").lean()
      : null,
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

  return {
    ...doc,
    _id: String(doc._id),
    studentId,
    studentName:
      (student?.user as { fullName?: string } | null | undefined)?.fullName ??
      "Student",
    admissionNumber: student?.admissionNumber,
    yearName,
    batchName,
    isRevoked: Boolean(doc.isRevoked),
    createdByName: createdBy?.fullName,
    updatedByName: updatedBy?.fullName,
    revokedByName: revokedBy?.fullName
  };
};
