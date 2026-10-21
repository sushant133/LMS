import type { Types } from "mongoose";
import {
  hasStudentAudienceFilter,
  studentAudienceAcademicStatuses,
  studentMatchesAudience,
  type StudentAudience,
  type StudentAudienceProfile
} from "@phit-erp/shared";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";

type StoredAudience = {
  batchIds?: Array<Types.ObjectId | string> | null;
  yearNames?: string[] | null;
  statuses?: string[] | null;
} | null;

/** Plain string form of a stored filter (ObjectIds → strings). */
export const toStudentAudience = (stored: StoredAudience | undefined): StudentAudience | undefined => {
  if (!stored) return undefined;
  const audience = {
    batchIds: (stored.batchIds ?? []).map((id) => id.toString()),
    yearNames: (stored.yearNames ?? []) as StudentAudience["yearNames"],
    statuses: (stored.statuses ?? []) as StudentAudience["statuses"]
  };
  return hasStudentAudienceFilter(audience) ? audience : undefined;
};

/**
 * Value to store for a notice / banner: the filter only applies while Students
 * are in the audience, and an empty filter is stored as null (everyone).
 */
export const resolveStudentAudienceForSave = (
  visibleTo: readonly string[],
  audience: StudentAudience | undefined
): StudentAudience | null =>
  visibleTo.includes("STUDENT") && hasStudentAudienceFilter(audience) ? audience! : null;

/** Batch, year name and status of the signed-in student, for filter matching. */
export const getStudentAudienceProfile = async (
  schoolId: Types.ObjectId,
  userId: string
): Promise<StudentAudienceProfile | null> => {
  const student = await Student.findOne({ schoolId, user: userId })
    .select("batchId yearId academicStatus")
    .lean();
  if (!student) return null;
  const year = student.yearId ? await Year.findById(student.yearId).select("name").lean() : null;
  return {
    batchId: student.batchId?.toString() ?? null,
    yearName: year?.name ?? null,
    academicStatus: student.academicStatus ?? "ACTIVE"
  };
};

export const recordMatchesStudentProfile = (
  stored: StoredAudience | undefined,
  profile: StudentAudienceProfile | null
): boolean => {
  const audience = toStudentAudience(stored);
  if (!audience) return true;
  return profile ? studentMatchesAudience(audience, profile) : false;
};

/** Student query conditions for a filter (used for notification fan-out). */
export const buildStudentAudienceFilter = async (
  schoolId: Types.ObjectId,
  stored: StoredAudience | undefined
): Promise<Record<string, unknown> | null> => {
  const audience = toStudentAudience(stored);
  if (!audience) return null;

  const filter: Record<string, unknown> = {};
  if (audience.batchIds.length > 0) filter.batchId = { $in: audience.batchIds };
  if (audience.yearNames.length > 0) {
    const yearIds = await Year.find({ schoolId, name: { $in: audience.yearNames } }).distinct("_id");
    filter.yearId = { $in: yearIds };
  }
  const statuses = studentAudienceAcademicStatuses(audience);
  if (statuses) {
    filter.academicStatus = statuses.includes("ACTIVE") ? { $in: [...statuses, null] } : { $in: statuses };
  }
  return filter;
};
