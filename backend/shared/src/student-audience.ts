import { z } from "zod";
import { COLLEGE_YEAR_NAMES, type STUDENT_ACADEMIC_STATUSES } from "./constants.js";

/**
 * Optional student filter on notices and banners. Applies only when the
 * audience includes Students. Every list left empty means "all": a student
 * must match each list that has values (any batch listed AND any year listed
 * AND any status listed).
 */
export const STUDENT_AUDIENCE_STATUSES = ["ACTIVE", "BACK", "COMPLETED"] as const;

export type StudentAudienceStatus = (typeof STUDENT_AUDIENCE_STATUSES)[number];

export const STUDENT_AUDIENCE_STATUS_LABELS: Record<StudentAudienceStatus, string> = {
  ACTIVE: "Regular",
  BACK: "Back",
  COMPLETED: "Completed (Passed Out)"
};

/** Student academic statuses each audience status covers. */
export const STUDENT_AUDIENCE_ACADEMIC_STATUSES: Record<
  StudentAudienceStatus,
  (typeof STUDENT_ACADEMIC_STATUSES)[number][]
> = {
  ACTIVE: ["ACTIVE"],
  BACK: ["PENDING_NOT_PASSED"],
  COMPLETED: ["PASSED_OUT", "ALUMNI"]
};

/** Year levels offered in the filter ("Ended" is covered by Completed). */
export const STUDENT_AUDIENCE_YEAR_NAMES = COLLEGE_YEAR_NAMES.filter((name) => name !== "Ended");

const audienceIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid identifier");

export const studentAudienceSchema = z.object({
  batchIds: z.array(audienceIdSchema).default([]),
  yearNames: z.array(z.enum(COLLEGE_YEAR_NAMES)).default([]),
  statuses: z.array(z.enum(STUDENT_AUDIENCE_STATUSES)).default([])
});

export type StudentAudience = z.infer<typeof studentAudienceSchema>;

export const EMPTY_STUDENT_AUDIENCE: StudentAudience = { batchIds: [], yearNames: [], statuses: [] };

export const hasStudentAudienceFilter = (audience?: Partial<StudentAudience> | null): boolean =>
  Boolean(audience?.batchIds?.length || audience?.yearNames?.length || audience?.statuses?.length);

/** Academic statuses the filter allows, or null when every status is allowed. */
export const studentAudienceAcademicStatuses = (
  audience?: Partial<StudentAudience> | null
): string[] | null => {
  const statuses = audience?.statuses ?? [];
  if (statuses.length === 0) return null;
  return statuses.flatMap((status) => STUDENT_AUDIENCE_ACADEMIC_STATUSES[status] ?? []);
};

export interface StudentAudienceProfile {
  batchId?: string | null;
  yearName?: string | null;
  academicStatus?: string | null;
}

export const studentMatchesAudience = (
  audience: Partial<StudentAudience> | null | undefined,
  student: StudentAudienceProfile
): boolean => {
  if (!hasStudentAudienceFilter(audience)) return true;
  const batchIds = audience?.batchIds ?? [];
  if (batchIds.length > 0 && !(student.batchId && batchIds.includes(student.batchId))) return false;
  const yearNames = (audience?.yearNames ?? []) as string[];
  if (yearNames.length > 0 && !(student.yearName && yearNames.includes(student.yearName))) return false;
  const statuses = studentAudienceAcademicStatuses(audience);
  if (statuses && !statuses.includes(student.academicStatus || "ACTIVE")) return false;
  return true;
};
