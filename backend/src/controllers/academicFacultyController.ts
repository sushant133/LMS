import type { Request, Response } from "express";
import type { Model } from "mongoose";
import { z } from "zod";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { sendSuccess } from "../utils/response.js";
import { deleteSyllabusHierarchy } from "../utils/syllabusHierarchyService.js";
import { tenantObjectId } from "../utils/tenant.js";

/**
 * Faculty / Program is free text stored on each subject assignment and
 * academic record; the Academic Management tree groups by it. Renaming or
 * moving rewrites that text so the tree, plans and reports stay together.
 */
const ACADEMIC_FACULTY_MODELS = [
  SubjectAssignment,
  AcademicSyllabus,
  AcademicSessionPlan,
  AcademicLessonPlan,
  AcademicLogBook,
  AcademicLogBookEntry
] as unknown as Array<Model<Record<string, unknown>>>;

/** Also renamed (not moved): they use the same program names. */
const RENAME_ONLY_MODELS = [FeeStructure, FieldDutySchedule] as unknown as Array<
  Model<Record<string, unknown>>
>;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Faculty match, same as the tree: trimmed, case-insensitive; blank = General. */
const facultyCondition = (faculty: string): Record<string, unknown> => {
  const trimmed = faculty.trim();
  if (!trimmed) {
    return { $or: [{ faculty: { $exists: false } }, { faculty: null }, { faculty: /^\s*$/ }] };
  }
  return { faculty: new RegExp(`^\\s*${escapeRegex(trimmed)}\\s*$`, "i") };
};

const facultyNameSchema = z.string().trim().min(1, "Enter a faculty / program name").max(120);

const renameSchema = z.object({
  from: z.string().max(120).default(""),
  to: facultyNameSchema
});

const moveSchema = z.object({
  subjectIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1, "Select a subject"),
  fromFaculty: z.string().max(120).default(""),
  toFaculty: facultyNameSchema
});

const updateAll = async (
  models: Array<Model<Record<string, unknown>>>,
  filter: Record<string, unknown>,
  faculty: string
) => {
  const results = await Promise.all(
    models.map((model) => model.updateMany(filter, { $set: { faculty } }))
  );
  return results.reduce((sum, result) => sum + (result.modifiedCount ?? 0), 0);
};

/** POST /academic-management/faculties/rename */
export const renameFaculty = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = renameSchema.parse(req.body);
  if (from.trim() === to) throw new ApiError(400, "The new name is the same as the current one");

  const filter = { schoolId: tenantObjectId(req), ...facultyCondition(from) };
  const updated = await updateAll([...ACADEMIC_FACULTY_MODELS, ...RENAME_ONLY_MODELS], filter, to);
  if (updated === 0) throw new ApiError(404, "No records use this faculty / program name");

  await recordAudit(req, {
    action: "academic_faculty.rename",
    entity: "FACULTY",
    entityId: to,
    before: { faculty: from },
    after: { faculty: to, updated }
  });

  return sendSuccess(res, `Renamed to "${to}"`, { faculty: to, updated });
});

/** POST /academic-management/faculties/move-subject */
export const moveSubjectToFaculty = asyncHandler(async (req: Request, res: Response) => {
  const { subjectIds, fromFaculty, toFaculty } = moveSchema.parse(req.body);
  if (fromFaculty.trim().toLowerCase() === toFaculty.toLowerCase()) {
    throw new ApiError(400, "The subject is already in this faculty / program");
  }

  const filter = {
    schoolId: tenantObjectId(req),
    subjectId: { $in: subjectIds },
    ...facultyCondition(fromFaculty)
  };
  const updated = await updateAll(ACADEMIC_FACULTY_MODELS, filter, toFaculty);
  if (updated === 0) {
    throw new ApiError(
      404,
      "Nothing to move: this subject has no assignments or records under this faculty / program yet"
    );
  }

  await recordAudit(req, {
    action: "academic_faculty.move_subject",
    entity: "FACULTY",
    entityId: toFaculty,
    before: { faculty: fromFaculty, subjectIds },
    after: { faculty: toFaculty, updated }
  });

  return sendSuccess(res, `Moved to "${toFaculty}"`, { faculty: toFaculty, updated });
});

const deleteSchema = z.object({
  faculty: z.string().max(120).default(""),
  /** Omit to delete the whole faculty / program; otherwise just these subjects in it. */
  subjectIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).optional()
});

/** Syllabi, plans and log books: soft-deleted like the single-record deletes. */
const DELETABLE_ACADEMIC_MODELS = ACADEMIC_FACULTY_MODELS.filter(
  (model) => (model as unknown) !== SubjectAssignment
);

/** POST /academic-management/faculties/delete */
export const deleteFacultyRecords = asyncHandler(async (req: Request, res: Response) => {
  const { faculty, subjectIds } = deleteSchema.parse(req.body);
  // General = every record without a faculty; too broad to remove in one go
  if (!faculty.trim() && !subjectIds) {
    throw new ApiError(400, "General / All Programs cannot be deleted as a whole; delete its subjects one by one");
  }
  const schoolId = tenantObjectId(req);
  const filter = {
    schoolId,
    ...(subjectIds ? { subjectId: { $in: subjectIds } } : {}),
    ...facultyCondition(faculty)
  };

  // Collected first so their child rows can be cleaned up like a single delete
  const [syllabusIds, sessionPlanIds] = await Promise.all([
    AcademicSyllabus.find({ ...filter, isDeleted: { $ne: true } }).distinct("_id"),
    AcademicSessionPlan.find({ ...filter, isDeleted: { $ne: true } }).distinct("_id")
  ]);

  const now = new Date();
  const results = await Promise.all(
    DELETABLE_ACADEMIC_MODELS.map((model) =>
      model.updateMany(
        { ...filter, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            "audit.deletedBy": req.user?.userId,
            "audit.deletedAt": now
          }
        }
      )
    )
  );
  const deleted = results.reduce((sum, result) => sum + (result.modifiedCount ?? 0), 0);

  for (const syllabusId of syllabusIds) {
    await deleteSyllabusHierarchy(syllabusId.toString());
  }
  if (syllabusIds.length > 0) {
    await AcademicSyllabusUnit.deleteMany({ syllabusId: { $in: syllabusIds } });
  }
  if (sessionPlanIds.length > 0) {
    await AcademicProgress.deleteMany({ schoolId, sessionPlanId: { $in: sessionPlanIds } });
  }

  // Teacher assignments are managed in Subject Assignments; never removed from here.
  const assignmentsLeft = await SubjectAssignment.countDocuments(filter);
  if (deleted === 0) {
    throw new ApiError(
      404,
      assignmentsLeft > 0
        ? "Nothing to delete here: only teacher assignments use this. End or change them in Subject Assignments, or use Move."
        : "Nothing to delete: no syllabus, plan or log book uses this"
    );
  }

  await recordAudit(req, {
    action: subjectIds ? "academic_faculty.delete_subject" : "academic_faculty.delete",
    entity: "FACULTY",
    entityId: faculty || "General",
    before: { faculty, subjectIds },
    after: { deleted, assignmentsLeft }
  });

  return sendSuccess(res, `Deleted ${deleted} record(s)`, { deleted, assignmentsLeft });
});
