import type { Request, Response } from "express";
import type { Model } from "mongoose";
import { z } from "zod";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { FieldDutySchedule } from "../models/FieldDutySchedule.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { sendSuccess } from "../utils/response.js";
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
