import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { logger } from "./logger.js";

/**
 * Give every syllabus unit that has no sub-units one sub-unit standing for the
 * whole unit (same rule the syllabus save applies). Without it such units could
 * never be marked complete and were left out of every completion %.
 *
 * Idempotent — only units with zero sub-units are touched — so it is safe to run
 * on every start.
 */
export const ensureUnitStandInSubUnits = async (): Promise<number> => {
  const unitIdsWithSubs = await AcademicSyllabusSubUnit.distinct("unitId");
  const bare = await AcademicSyllabusTopic.find({ _id: { $nin: unitIdsWithSubs } })
    .select("_id schoolId syllabusId chapterId title teachingHours practicalRequired")
    .lean();
  if (bare.length === 0) return 0;

  const result = await AcademicSyllabusSubUnit.insertMany(
    bare.map((unit) => ({
      schoolId: unit.schoolId,
      syllabusId: unit.syllabusId,
      chapterId: unit.chapterId,
      unitId: unit._id,
      parentSubUnitId: null,
      subUnitNo: 1,
      heading: String(unit.title || "").trim(),
      teachingHours: Number(unit.teachingHours) || 0,
      practicalRequired: Boolean((unit as { practicalRequired?: boolean }).practicalRequired),
      sortOrder: 0
    })),
    // A concurrent syllabus save may have added one meanwhile — skip, don't fail.
    { ordered: false }
  ).catch((error: { insertedDocs?: unknown[] }) => error.insertedDocs ?? []);

  const added = Array.isArray(result) ? result.length : 0;
  if (added > 0) logger.info(`Added stand-in sub-units for ${added} syllabus unit(s) without sub-units`);
  return added;
};
