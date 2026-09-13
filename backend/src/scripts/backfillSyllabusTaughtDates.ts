/**
 * Backfill `taughtDateBs` on completed syllabus sub-units from the log book.
 *
 * `taughtDateBs` was added when Syllabus Completion started reporting "taught
 * on". Leaves completed before that have no date, so oversight shows "—" for
 * them. The log book already holds the real teaching dates and each entry
 * references the sub-units it covered, so the history can be recovered.
 *
 * Usage (from the backend folder):
 *
 *   # 1) See what would change (read-only)
 *   npx tsx src/scripts/backfillSyllabusTaughtDates.ts
 *
 *   # 2) Write the dates
 *   npx tsx src/scripts/backfillSyllabusTaughtDates.ts --apply
 *
 * Safe to re-run: only leaves that are completed AND still have no taught date
 * are touched, so it never overwrites a real entry.
 */
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";

const apply = process.argv.includes("--apply");

/** Zero-padded BS dates compare correctly as plain strings. */
const BS_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DONE_STATUSES = ["COMPLETED", "SKIPPED"];

interface Candidate {
  dateBs: string;
  source: string;
  teacherId: string;
}

/**
 * Pick the date to record for one leaf.
 *
 * Prefer an entry that matches how the leaf is attributed (an administration
 * extra lecture should not be dated from a teacher's ordinary class), then the
 * attributed teacher, then the most recent date — the class that finished it.
 */
const pickDate = (
  candidates: Candidate[],
  leafSource: string,
  leafTeacherId: string
): string => {
  const rank = (c: Candidate): number => {
    let score = 0;
    if (leafSource && c.source && c.source === leafSource) score += 2;
    if (leafTeacherId && c.teacherId && c.teacherId === leafTeacherId) score += 1;
    return score;
  };
  let best: Candidate | undefined;
  let bestRank = -1;
  for (const c of candidates) {
    const r = rank(c);
    if (r > bestRank || (r === bestRank && best && c.dateBs > best.dateBs)) {
      best = c;
      bestRank = r;
    }
  }
  return best?.dateBs ?? "";
};

const main = async () => {
  await connectDatabase();

  const leaves = await AcademicSyllabusSubUnit.find({
    status: { $in: DONE_STATUSES },
    $or: [{ taughtDateBs: { $exists: false } }, { taughtDateBs: "" }]
  })
    .select("_id schoolId completionSource completedByTeacherId")
    .lean();

  console.log("Backfill syllabus taught dates");
  console.log(`Mode                   : ${apply ? "APPLY (writes)" : "REPORT only"}`);
  console.log(`Completed leaves w/o date: ${leaves.length}`);

  if (leaves.length === 0) {
    console.log("Nothing to backfill.");
    await mongoose.disconnect();
    return;
  }

  const leafIds = leaves.map((row) => row._id);

  // Entries reference their sub-units through either field.
  const entries = await AcademicLogBookEntry.find({
    isDeleted: { $ne: true },
    $or: [
      { syllabusSubUnitIds: { $in: leafIds } },
      { syllabusSubUnitId: { $in: leafIds } }
    ]
  })
    .select("dateBs completionSource teacherId syllabusSubUnitId syllabusSubUnitIds")
    .lean();

  console.log(`Log book entries scanned : ${entries.length}`);

  const byLeaf = new Map<string, Candidate[]>();
  for (const entry of entries) {
    const dateBs = String(entry.dateBs || "").trim();
    if (!BS_DATE.test(dateBs)) continue;

    const candidate: Candidate = {
      dateBs,
      source: String(entry.completionSource || "").toUpperCase(),
      teacherId: entry.teacherId ? String(entry.teacherId) : ""
    };

    const refs = [
      ...(entry.syllabusSubUnitIds ?? []),
      ...(entry.syllabusSubUnitId ? [entry.syllabusSubUnitId] : [])
    ];
    for (const ref of refs) {
      const id = String(ref);
      const list = byLeaf.get(id);
      if (list) list.push(candidate);
      else byLeaf.set(id, [candidate]);
    }
  }

  const updates: Array<{ id: mongoose.Types.ObjectId; dateBs: string }> = [];
  let unmatched = 0;
  const sample: string[] = [];

  for (const leaf of leaves) {
    const id = String(leaf._id);
    const candidates = byLeaf.get(id);
    if (!candidates || candidates.length === 0) {
      unmatched += 1;
      continue;
    }
    const dateBs = pickDate(
      candidates,
      String(leaf.completionSource || "").toUpperCase(),
      leaf.completedByTeacherId ? String(leaf.completedByTeacherId) : ""
    );
    if (!dateBs) {
      unmatched += 1;
      continue;
    }
    updates.push({ id: leaf._id as mongoose.Types.ObjectId, dateBs });
    if (sample.length < 10) {
      sample.push(`  ${id} -> ${dateBs} (from ${candidates.length} entr(y/ies))`);
    }
  }

  console.log(`Can backfill             : ${updates.length}`);
  console.log(`No log book entry        : ${unmatched}`);
  if (sample.length > 0) {
    console.log("Sample:");
    for (const line of sample) console.log(line);
  }

  if (apply && updates.length > 0) {
    const BATCH = 500;
    let written = 0;
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      const result = await AcademicSyllabusSubUnit.bulkWrite(
        slice.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: { taughtDateBs: row.dateBs } }
          }
        })),
        { ordered: false }
      );
      written += result.modifiedCount ?? 0;
    }
    console.log(`Written                  : ${written}`);
  } else if (!apply && updates.length > 0) {
    console.log("");
    console.log("Next step: re-run with --apply to write these dates:");
    console.log("  npx tsx src/scripts/backfillSyllabusTaughtDates.ts --apply");
  }

  if (unmatched > 0) {
    console.log("");
    console.log(
      `${unmatched} completed leaf/leaves have no log book entry referencing them — ` +
        "those keep showing “—” for Taught on. Nothing can be recovered for them."
    );
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
