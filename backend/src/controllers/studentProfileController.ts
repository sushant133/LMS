import crypto from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { STUDENT_DOCUMENT_CATEGORIES } from "@phit-erp/shared";
import { Attendance } from "../models/Attendance.js";
import { AuditLog } from "../models/AuditLog.js";
import { Batch } from "../models/Batch.js";
import { Exam } from "../models/Exam.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { Result } from "../models/Result.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { TransportAssignment } from "../models/TransportRoute.js";

import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { assertParentAccessToStudent } from "../utils/parentScope.js";
import { sendSuccess } from "../utils/response.js";
import { canViewPublishedResults } from "../utils/examResults.js";
import { getTeacherStudentFilter } from "../utils/teacherScope.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const documentMutationSchema = z.object({
  type: z.string(),
  name: z.string().min(1),
  url: z.string().min(1),
  originalName: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().min(0),
  status: z.enum(["UPLOADED", "VERIFIED", "REJECTED", "PENDING"]).optional()
});

const replaceDocumentSchema = documentMutationSchema.extend({
  documentId: z.string().min(1)
});

const getCategoryLabel = (type: string): string =>
  STUDENT_DOCUMENT_CATEGORIES.find((item) => item.key === type)?.label ?? type;

const assertStudentProfileAccess = async (req: Request, studentId: string): Promise<void> => {
  const role = req.user?.role;
  if (!role) throw new ApiError(401, "Authentication required");

  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN" || role === "COLLEGE_VIEWER" || role === "ACCOUNTANT") {
    return;
  }

  if (role === "TEACHER") {
    const filter = await getTeacherStudentFilter(req);
    const student = await Student.findOne({ ...filter, _id: studentId });
    if (!student) throw new ApiError(403, "You do not have access to this student profile");
    return;
  }

  if (role === "STUDENT") {
    const student = await Student.findOne({ schoolId: tenantObjectId(req), user: req.user!.userId }).lean();
    if (!student || student._id.toString() !== studentId) {
      throw new ApiError(403, "You can only view your own profile");
    }
    return;
  }

  if (role === "PARENT") {
    await assertParentAccessToStudent(req, studentId);
    return;
  }

  throw new ApiError(403, "You do not have permission to view this student profile");
};

const assertDocumentManageAccess = (req: Request): void => {
  const role = req.user?.role;
  if (role !== "SUPER_ADMIN" && role !== "COLLEGE_ADMIN") {
    throw new ApiError(403, "Only admins can manage student documents");
  }
};

const getProfilePermissions = (req: Request) => {
  const role = req.user?.role ?? "";
  return {
    canManageDocuments: role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN",
    canViewFinancial: ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "ACCOUNTANT", "STUDENT", "PARENT"].includes(role),
    canViewActivity: ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"].includes(role)
  };
};

const buildAttendanceSummary = (
  records: Array<{
    dateBs: string;
    subjectId?: { toString: () => string };
    entries: Array<{ studentId: { toString: () => string }; status: string }>;
  }>,
  studentId: string,
  subjectMap: Map<string, string>
) => {
  const daily: Array<{ dateBs: string; status: string; subjectName?: string }> = [];
  const monthly = new Map<string, { present: number; absent: number }>();
  let totalPresent = 0;
  let totalAbsent = 0;

  for (const record of records) {
    const entry = record.entries.find((item) => item.studentId.toString() === studentId);
    if (!entry) continue;

    const subjectName = subjectMap.get(record.subjectId?.toString() ?? "");
    daily.push({ dateBs: record.dateBs, status: entry.status, subjectName });

    const month = record.dateBs.slice(0, 7);
    const bucket = monthly.get(month) ?? { present: 0, absent: 0 };
    if (entry.status === "PRESENT") {
      bucket.present += 1;
      totalPresent += 1;
    } else if (entry.status === "ABSENT") {
      bucket.absent += 1;
      totalAbsent += 1;
    }
    monthly.set(month, bucket);
  }

  const totalDays = totalPresent + totalAbsent;
  const yearlyPercentage = totalDays > 0 ? Math.round((totalPresent / totalDays) * 100) : 0;

  return {
    records: daily.slice(0, 60),
    monthlySummary: [...monthly.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, stats]) => {
        const days = stats.present + stats.absent;
        return {
          month,
          present: stats.present,
          absent: stats.absent,
          percentage: days > 0 ? Math.round((stats.present / days) * 100) : 0
        };
      }),
    yearlyPercentage,
    totalPresent,
    totalAbsent,
    totalDays
  };
};

export const getStudentProfileOverview = asyncHandler(async (req: Request, res: Response) => {
  const studentId = String(req.params.id);
  await assertStudentProfileAccess(req, studentId);

  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ _id: studentId, schoolId }).populate("user", "-password").lean();
  if (!student) throw new ApiError(404, "Student not found");

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const permissions = getProfilePermissions(req);

  const [primaryDoc, secondaryDoc, subjects, attendanceRecords, results, exams, collections, libraryIssues, transportAssignment] =
    await Promise.all([
      college ? Batch.findById(student.batchId).lean() : SchoolClass.findById(student.classId).lean(),
      college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean(),
      college
        ? Subject.find({ schoolId, yearIds: { $in: [student.yearId] } }).lean()
        : Subject.find({ schoolId, classIds: { $in: [student.classId] } }).lean(),
      Attendance.find({
        schoolId,
        ...(college
          ? { batchId: student.batchId, yearId: student.yearId }
          : { classId: student.classId, sectionId: student.sectionId }),
        "entries.studentId": student._id
      })
        .sort({ dateBs: -1 })
        .limit(365)
        .lean(),
      Result.find({ schoolId, studentId: student._id }).sort({ updatedAt: -1 }).lean(),
      Exam.find({ schoolId }).sort({ createdAt: -1 }).lean(),
      permissions.canViewFinancial
        ? FeeCollection.find({ schoolId, studentId: student._id }).sort({ paidDateBs: -1 }).lean()
        : Promise.resolve([]),
      LibraryIssue.find({ schoolId, studentId: student._id }).populate("bookId").sort({ createdAt: -1 }).lean(),
      TransportAssignment.findOne({ schoolId, studentId: student._id }).populate("routeId").lean()
    ]);

  const subjectMap = new Map<string, string>(subjects.map((item) => [item._id.toString(), item.name]));
  const attendance = buildAttendanceSummary(attendanceRecords, student._id.toString(), subjectMap);

  const examMap = new Map(exams.map((item) => [item._id.toString(), item]));
  const role = req.user?.role;
  const visibleResults =
    role === "STUDENT" || role === "PARENT"
      ? results.filter((result) => {
          const exam = examMap.get(result.examId.toString());
          return exam ? canViewPublishedResults(exam) && Boolean(result.publishedAtBs) : false;
        })
      : results;

  const enrichedResults = visibleResults.map((result) => ({
    ...result,
    exam: examMap.get(result.examId.toString()) ?? null,
    marks: result.marks.map((mark) => ({
      ...mark,
      subjectName: subjectMap.get(mark.subjectId.toString()) ?? "Subject"
    }))
  }));

  const totalPaid = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = collections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = collections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);

  const pendingIssues = libraryIssues.filter((issue) => issue.status === "ISSUED" || issue.status === "OVERDUE");
  const fineTotal = libraryIssues.reduce((sum, issue) => sum + (issue.fineNpr ?? 0), 0);

  let transport: Record<string, unknown> | null = null;
  if (transportAssignment) {
    const route = transportAssignment.routeId as {
      name?: string;
      vehicleNumber?: string;
      driverName?: string;
      driverPhone?: string;
      monthlyFeeNpr?: number;
    } | null;
    transport = {
      routeName: route?.name ?? "",
      vehicle: route?.vehicleNumber ?? "",
      driver: route?.driverName ?? "",
      driverPhone: route?.driverPhone ?? "",
      pickupStop: transportAssignment.pickupStop,
      dropStop: transportAssignment.dropStop,
      transportFeeNpr: route?.monthlyFeeNpr ?? 0
    };
  }

  let activityLog: Array<Record<string, unknown>> = [];
  if (permissions.canViewActivity) {
    const feeCollectionIds = collections.map((item) => item._id.toString());
    const logs = await AuditLog.find({
      schoolId,
      $or: [
        { entityId: studentId },
        { entity: "Student", entityId: studentId },
        { entityId: { $in: feeCollectionIds } },
        { "after.studentId": student._id }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const actorIds = [...new Set(logs.map((log) => log.actorUserId.toString()))];
    const actors = await User.find({ _id: { $in: actorIds } }).select("fullName").lean();
    const actorMap = new Map(actors.map((actor) => [actor._id.toString(), actor.fullName]));

    activityLog = logs.map((log) => ({
      _id: log._id.toString(),
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      actorRole: log.actorRole,
      actorName: actorMap.get(log.actorUserId.toString()) ?? "System",
      before: log.before,
      after: log.after,
      createdAt: log.createdAt
    }));
  }

  return sendSuccess(res, "Student profile fetched", {
    student,
    primaryLabel: college ? "Batch" : "Class",
    secondaryLabel: college ? "Year" : "Section",
    primaryName: primaryDoc?.name ?? "",
    secondaryName: secondaryDoc?.name ?? "",
    subjects: subjects.map((item) => ({ _id: item._id.toString(), name: item.name, code: item.code })),
    attendance,
    results: enrichedResults,
    exams: exams.map((item) => ({
      _id: item._id.toString(),
      name: item.name,
      status: item.status,
      academicYearBs: item.academicYearBs,
      resultsPublished: item.resultsPublished
    })),
    financial: permissions.canViewFinancial
      ? {
          outstandingDueNpr: student.feesDueNpr ?? 0,
          totalPaidNpr: totalPaid,
          totalDiscountNpr: totalDiscount,
          totalScholarshipNpr: totalScholarship,
          totalRefundsNpr: 0,
          collections
        }
      : null,
    library: {
      issues: libraryIssues.map((issue) => {
        const book = issue.bookId as { title?: string; author?: string } | null;
        return {
          _id: issue._id.toString(),
          bookTitle: book?.title ?? "Book",
          bookAuthor: book?.author ?? "",
          issuedDateBs: issue.issuedDateBs,
          dueDateBs: issue.dueDateBs,
          returnedDateBs: issue.returnedDateBs,
          status: issue.status,
          fineNpr: issue.fineNpr ?? 0
        };
      }),
      pendingCount: pendingIssues.length,
      fineTotal
    },
    transport,
    activityLog,
    permissions
  });
});

export const addStudentDocument = asyncHandler(async (req: Request, res: Response) => {
  assertDocumentManageAccess(req);
  const payload = documentMutationSchema.parse(req.body);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) throw new ApiError(404, "Student not found");

  const category = STUDENT_DOCUMENT_CATEGORIES.find((item) => item.key === payload.type);
  if (!category) throw new ApiError(400, "Invalid document category");

  const existingOfType = student.documents.filter((doc) => doc.type === payload.type);
  if (!category.allowMultiple && existingOfType.length > 0) {
    throw new ApiError(409, "A document of this category already exists. Use replace instead.");
  }

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const document = {
    _id: crypto.randomUUID(),
    type: payload.type,
    name: payload.name || getCategoryLabel(payload.type),
    url: payload.url,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    size: payload.size,
    status: payload.status ?? "UPLOADED",
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user!.userId,
    uploadedByName: actor?.fullName ?? "Admin"
  };

  student.documents.push(document);
  if (payload.type === "STUDENT_PHOTOGRAPH") {
    student.photoUrl = payload.url;
  }
  await student.save();

  await recordAudit(req, {
    action: "student.document.upload",
    entity: "Student",
    entityId: student._id.toString(),
    after: { documentId: document._id, type: document.type, name: document.name }
  });

  return sendSuccess(res, "Document added", { document, student }, 201);
});

export const replaceStudentDocument = asyncHandler(async (req: Request, res: Response) => {
  assertDocumentManageAccess(req);
  const payload = replaceDocumentSchema.parse(req.body);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) throw new ApiError(404, "Student not found");

  const index = student.documents.findIndex((doc) => doc._id === payload.documentId);
  if (index < 0) throw new ApiError(404, "Document not found");

  const previous = student.documents[index]!;
  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  Object.assign(previous, {
    type: payload.type || previous.type,
    name: payload.name || previous.name,
    url: payload.url,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
    size: payload.size,
    status: payload.status ?? "UPLOADED",
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user!.userId,
    uploadedByName: actor?.fullName ?? "Admin"
  });
  const updated = previous;
  student.markModified("documents");
  if (updated.type === "STUDENT_PHOTOGRAPH") {
    student.photoUrl = updated.url;
  }
  await student.save();

  await recordAudit(req, {
    action: "student.document.replace",
    entity: "Student",
    entityId: student._id.toString(),
    before: { documentId: previous._id, url: previous.url },
    after: { documentId: updated._id, url: updated.url }
  });

  return sendSuccess(res, "Document replaced", { document: updated, student });
});

export const deleteStudentDocument = asyncHandler(async (req: Request, res: Response) => {
  assertDocumentManageAccess(req);
  const student = await Student.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!student) throw new ApiError(404, "Student not found");

  const documentId = req.params.documentId;
  const index = student.documents.findIndex((doc) => doc._id === documentId);
  if (index < 0) throw new ApiError(404, "Document not found");

  const removed = student.documents[index]!;
  student.documents.splice(index, 1);

  if (removed.type === "STUDENT_PHOTOGRAPH") {
    const photoDoc = student.documents.find((doc) => doc.type === "STUDENT_PHOTOGRAPH");
    student.photoUrl = photoDoc?.url;
  }

  await student.save();

  await recordAudit(req, {
    action: "student.document.delete",
    entity: "Student",
    entityId: student._id.toString(),
    before: { documentId: removed._id, type: removed.type, name: removed.name }
  });

  return sendSuccess(res, "Document deleted", { student });
});