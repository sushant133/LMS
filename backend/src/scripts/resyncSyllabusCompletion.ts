/**
 * Reset syllabus completion to what the APPROVED log book actually says.
 *
 * Completion used to be written the moment a teacher saved a Log Book entry, so
 * percentages climbed on classes administration had never verified or approved.
 * The rule is now: a syllabus leaf is COMPLETED only when an approved entry
 * covers it (or when administration completed it directly as an extra lecture).
 *
 * This script re-runs that rule over every syllabus, which rolls back leaves
 * that were completed by entries still sitting at PENDING, VERIFIED or
 * NEEDS_IMPROVEMENT, and leaves administration-completed ones alone.
 *
 * Usage (from the backend folder):
 *
 *   # 1) See what would change (read-only)
 *   npx tsx src/scripts/resyncSyllabusCompletion.ts
 *
 *   # 2) Apply the reset
 *   npx tsx src/scripts/resyncSyllabusCompletion.ts --apply
 *
 * Safe to re-run: the sync is idempotent, and reading a syllabus in the app
 * already performs it, so this is really just the whole-database version.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { Subject } from "../models/Subject.js";
import {
  syncSyllabusCompletionFromLogBook,
  taughtSyllabusLeafAttributionFromLogBook
} from "../utils/academicManagementService.js";

const apply = process.argv.includes("--apply");

/** Leaves are the sub-units nothing else hangs off — those carry the status. */
const leafIdsOf = (
  rows: Array<{ _id: unknown; parentSubUnitId?: unknown; status?: string; completionSource?: string }>
) => {
  const parentIds = new Set(
    rows.map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : "")).filter(Boolean)
  );
  return rows.filter((row) => !parentIds.has(String(row._id)));
};

const main = async () => {
  // Plain connect, not connectDatabase(): a dry run must not touch the
  // database at all, and that helper also syncs indexes on the way in.
  await mongoose.connect(env.MONGODB_URI);

  const syllabi = await AcademicSyllabus.find({ isDeleted: { $ne: true } })
    .select("_id schoolId subjectId academicYearBs")
    .lean();

  console.log(
    `${syllabi.length} syllabus record(s) to check — ${apply ? "APPLYING changes" : "dry run, nothing will be written"}\n`
  );

  const subjectNames = new Map<string, string>();
  for (const subject of await Subject.find().select("_id name").lean()) {
    subjectNames.set(String(subject._id), String(subject.name ?? ""));
  }

  let touchedSyllabi = 0;
  let totalRolledBack = 0;
  let totalKept = 0;

  for (const syllabus of syllabi) {
    const syllabusId = String(syllabus._id);
    const schoolId = new mongoose.Types.ObjectId(String(syllabus.schoolId));
    const subjectId = syllabus.subjectId ? String(syllabus.subjectId) : undefined;

    const rows = await AcademicSyllabusSubUnit.find({ syllabusId })
      .select("_id parentSubUnitId status completionSource countsTowardSalary heading")
      .lean();
    const leaves = leafIdsOf(rows);
    if (leaves.length === 0) continue;

    const approved = await taughtSyllabusLeafAttributionFromLogBook(
      schoolId,
      syllabusId,
      subjectId
    );

    // Completed by a teacher but not backed by an approved entry → rolls back.
    const losing = leaves.filter((leaf) => {
      if (leaf.status !== "COMPLETED") return false;
      if (String(leaf.completionSource || "") === "ADMINISTRATION") return false;
      if ((leaf as { countsTowardSalary?: boolean }).countsTowardSalary === false) return false;
      return !approved.has(String(leaf._id));
    });
    const keeping = leaves.filter(
      (leaf) => leaf.status === "COMPLETED" && !losing.includes(leaf)
    );

    if (losing.length === 0) {
      totalKept += keeping.length;
      continue;
    }

    touchedSyllabi += 1;
    totalRolledBack += losing.length;
    totalKept += keeping.length;

    const before = Math.round((leaves.filter((l) => l.status === "COMPLETED").length / leaves.length) * 100);
    const after = Math.round(((leaves.filter((l) => l.status === "COMPLETED").length - losing.length) / leaves.length) * 100);
    const name = subjectId ? subjectNames.get(subjectId) || subjectId : syllabusId;
    console.log(
      `${name} · ${syllabus.academicYearBs}: ${before}% → ${after}%  (${losing.length} of ${leaves.length} leaves not approved)`
    );
    for (const leaf of losing.slice(0, 5)) {
      console.log(`    - ${String((leaf as { heading?: string }).heading || leaf._id)}`);
    }
    if (losing.length > 5) console.log(`    … and ${losing.length - 5} more`);

    if (apply) {
      await syncSyllabusCompletionFromLogBook(schoolId, syllabusId, subjectId);
    }
  }

  console.log(
    `\n${touchedSyllabi} syllabus record(s) ${apply ? "reset" : "would be reset"} · ` +
      `${totalRolledBack} leaf/leaves rolled back · ${totalKept} approved completion(s) kept`
  );
  if (!apply && touchedSyllabi > 0) {
    console.log("Re-run with --apply to write the reset.");
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
