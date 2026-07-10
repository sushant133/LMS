import type { Request, Response } from "express";
import {
  subjectAssignmentAcceptMigrationSchema,
  subjectAssignmentBulkSchema,
  subjectAssignmentCopyYearSchema,
  subjectAssignmentCreateSchema,
  subjectAssignmentEndSchema,
  subjectAssignmentQuerySchema,
  subjectAssignmentReassignSchema,
  subjectAssignmentUpdateSchema
} from "@phit-erp/shared";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { Teacher } from "../models/Teacher.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  bulkCreateSubjectAssignments,
  copyYearAssignments,
  createSubjectAssignment,
  endSubjectAssignment,
  getAcademicYearBs,
  listSubjectAssignments,
  reassignSubjectAssignment,
  recomputeSubjectTeacherIds,
  updateSubjectAssignment
} from "../utils/subjectAssignmentService.js";

export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const filters = subjectAssignmentQuerySchema.parse(req.query);
  const schoolId = tenantObjectId(req);

  let academicYearBs = filters.academicYearBs;
  if (!academicYearBs) {
    try {
      academicYearBs = await getAcademicYearBs(schoolId);
    } catch {
      academicYearBs = undefined;
    }
  }

  const rows = await listSubjectAssignments(schoolId, {
    ...filters,
    academicYearBs
  });
  return sendSuccess(res, "Subject assignments fetched", rows);
});

export const getAssignmentById = asyncHandler(async (req: Request, res: Response) => {
  const row = await SubjectAssignment.findOne(withTenantScope(req, { _id: req.params.id }))
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName email" } })
    .lean();

  if (!row) {
    throw new ApiError(404, "Subject assignment not found");
  }
  return sendSuccess(res, "Subject assignment fetched", row);
});

export const createAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentCreateSchema.parse(req.body);
  const result = await createSubjectAssignment(req, payload);
  return sendSuccess(res, "Subject assignment created", { rows: [result.row], warnings: result.warnings }, 201);
});

export const bulkCreateAssignments = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentBulkSchema.parse(req.body);
  const result = await bulkCreateSubjectAssignments(req, payload);
  return sendSuccess(res, "Subject assignments created", { rows: result.rows, warnings: result.warnings }, 201);
});

const paramId = (req: Request): string => String(req.params.id);

export const updateAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentUpdateSchema.parse(req.body);
  const result = await updateSubjectAssignment(req, paramId(req), payload);
  return sendSuccess(res, "Subject assignment updated", { rows: [result.row], warnings: result.warnings });
});

export const endAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentEndSchema.parse(req.body);
  const result = await endSubjectAssignment(req, paramId(req), payload);
  return sendSuccess(res, "Subject assignment ended", { rows: [result.row], warnings: result.warnings });
});

export const reassignAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentReassignSchema.parse(req.body);
  const result = await reassignSubjectAssignment(req, paramId(req), payload);
  return sendSuccess(res, "Subject assignment reassigned", { rows: [result.row], warnings: result.warnings });
});

export const copyYear = asyncHandler(async (req: Request, res: Response) => {
  const payload = subjectAssignmentCopyYearSchema.parse(req.body);
  const result = await copyYearAssignments(req, payload);
  return sendSuccess(res, "Assignments copied to target academic year", result);
});

export const migrationReview = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const teachers = await Teacher.find({
    schoolId,
    assignmentMigrationStatus: { $in: ["NEEDS_REVIEW", "PENDING"] }
  })
    .populate("user", "fullName email")
    .sort({ teacherCode: 1 })
    .lean();

  let academicYearBs: string | undefined;
  try {
    academicYearBs = await getAcademicYearBs(schoolId);
  } catch {
    academicYearBs = undefined;
  }

  const rows = await Promise.all(
    teachers.map(async (teacher) => {
      const activeCount = academicYearBs
        ? await SubjectAssignment.countDocuments({
            schoolId,
            teacherId: teacher._id,
            academicYearBs,
            status: "ACTIVE"
          })
        : 0;
      return {
        teacherId: teacher._id.toString(),
        teacherCode: teacher.teacherCode,
        fullName: (teacher.user as { fullName?: string } | null)?.fullName ?? "",
        email: (teacher.user as { email?: string } | null)?.email ?? "",
        assignmentMigrationStatus: teacher.assignmentMigrationStatus ?? "PENDING",
        subjects: (teacher.subjects ?? []).map((id) => id.toString()),
        assignedClassIds: (teacher.assignedClassIds ?? []).map((id) => id.toString()),
        assignedSectionIds: (teacher.assignedSectionIds ?? []).map((id) => id.toString()),
        assignedBatchIds: (teacher.assignedBatchIds ?? []).map((id) => id.toString()),
        assignedYearIds: (teacher.assignedYearIds ?? []).map((id) => id.toString()),
        activeAssignmentCount: activeCount
      };
    })
  );

  return sendSuccess(res, "Migration review list fetched", { academicYearBs, teachers: rows });
});

export const acceptMigration = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const teacherId = req.params.teacherId!;
  const body = subjectAssignmentAcceptMigrationSchema.parse(req.body ?? {});

  const teacher = await Teacher.findOne({ _id: teacherId, schoolId });
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const academicYearBs = await getAcademicYearBs(schoolId);
  const activeCount = await SubjectAssignment.countDocuments({
    schoolId,
    teacherId,
    academicYearBs,
    status: "ACTIVE"
  });

  if (activeCount === 0 && !body.confirmEmpty) {
    throw new ApiError(
      400,
      "Teacher has no ACTIVE subject assignments for the current academic year. Create assignments first, or pass confirmEmpty: true for non-teaching staff."
    );
  }

  teacher.assignmentMigrationStatus = "ACCEPTED";
  await teacher.save();

  return sendSuccess(res, "Teacher migration accepted", {
    teacherId: teacher._id.toString(),
    assignmentMigrationStatus: teacher.assignmentMigrationStatus,
    activeAssignmentCount: activeCount
  });
});

export const rejectMigrationToLegacy = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const teacherId = req.params.teacherId!;

  const teacher = await Teacher.findOne({ _id: teacherId, schoolId });
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const academicYearBs = await getAcademicYearBs(schoolId);
  const today = new Date().toISOString().slice(0, 10);

  // End any ACTIVE rows so dual stays on legacy
  await SubjectAssignment.updateMany(
    { schoolId, teacherId, academicYearBs, status: "ACTIVE" },
    {
      $set: {
        status: "ENDED",
        effectiveToBs: today,
        endReason: "Rejected to legacy (migration review)",
        endedBy: req.user?.userId
      }
    }
  );

  teacher.assignmentMigrationStatus = "NEEDS_REVIEW";
  await teacher.save();

  await recomputeSubjectTeacherIds(schoolId);

  return sendSuccess(res, "Teacher kept on legacy scope", {
    teacherId: teacher._id.toString(),
    assignmentMigrationStatus: teacher.assignmentMigrationStatus
  });
});

export const workloadReport = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  let academicYearBs =
    typeof req.query.academicYearBs === "string" ? req.query.academicYearBs : undefined;
  if (!academicYearBs) {
    academicYearBs = await getAcademicYearBs(schoolId);
  }

  const rows = await SubjectAssignment.find({
    schoolId,
    academicYearBs,
    status: "ACTIVE"
  })
    .populate("subjectId", "name code")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .lean();

  const report = rows.map((row) => {
    const teacher = row.teacherId as {
      _id?: { toString(): string };
      teacherCode?: string;
      user?: { fullName?: string };
    } | null;
    const subject = row.subjectId as { _id?: { toString(): string }; name?: string; code?: string } | null;

    let assignedPercentage = 0;
    if (row.assignmentType === "FULL") assignedPercentage = 100;
    else if (row.assignmentType === "PERCENTAGE") assignedPercentage = row.assignedPercentage ?? 0;
    else if (row.assignmentType === "UNIT") {
      const from = row.unitFrom ?? 0;
      const to = row.unitTo ?? 0;
      const span = Math.max(to - from + 1, 0);
      assignedPercentage = Math.min(100, span * 5); // simple weight for reporting
    }

    return {
      teacherId: teacher?._id?.toString() ?? String(row.teacherId),
      teacherCode: teacher?.teacherCode,
      teacherName: teacher?.user?.fullName,
      subjectId: subject?._id?.toString() ?? String(row.subjectId),
      subjectName: subject?.name,
      classId: row.classId?.toString() ?? null,
      sectionId: row.sectionId?.toString() ?? null,
      batchId: row.batchId?.toString() ?? null,
      yearId: row.yearId?.toString() ?? null,
      assignmentType: row.assignmentType,
      assignedPercentage,
      unitFrom: row.unitFrom ?? null,
      unitTo: row.unitTo ?? null,
      unitSpan:
        row.assignmentType === "UNIT" && row.unitFrom != null && row.unitTo != null
          ? row.unitTo - row.unitFrom + 1
          : null
    };
  });

  return sendSuccess(res, "Workload report", { academicYearBs, rows: report });
});
