/**
 * Receipts that carry a scholarship amount but were saved with scholarship type "NONE".
 *
 * Where the student holds a merit scholarship award for that receipt's program year, the type
 * is set to "TOPPER_YEAR_WAIVER" (the type the award flow saves). Any other such receipt is
 * listed and left as it is — its type is unknown and reports show "—". Only scholarshipType is
 * changed; amounts, dates and journals are not touched.
 *
 * Usage (from the backend folder):
 *   npm run fees:scholarship-types:dry-run   # lists what would change, changes nothing
 *   npm run fees:scholarship-types           # applies
 *
 * Idempotent: a receipt that already has a type is never selected again.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { StudentScholarshipAward } from "../models/StudentScholarshipAward.js";

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  const receipts = await FeeCollection.find({
    scholarshipNpr: { $gt: 0 },
    $or: [{ scholarshipType: "NONE" }, { scholarshipType: { $exists: false } }, { scholarshipType: null }]
  })
    .select("schoolId studentId receiptNumber paidDateBs programYear scholarshipNpr")
    .lean();
  const awards = await StudentScholarshipAward.find({
    studentId: { $in: receipts.map((r) => r.studentId) },
    isDeleted: { $ne: true }
  })
    .select("studentId coversProgramYear")
    .lean();
  const awardKey = (studentId: unknown, year: unknown) => `${String(studentId)}:${Number(year) || 0}`;
  const awarded = new Set(awards.map((a) => awardKey(a.studentId, (a as { coversProgramYear?: number }).coversProgramYear)));

  const fix = receipts.filter((r) => awarded.has(awardKey(r.studentId, r.programYear)));
  const unknown = receipts.filter((r) => !awarded.has(awardKey(r.studentId, r.programYear)));

  console.log(`\nReceipts with a scholarship amount and type NONE: ${receipts.length}`);
  console.log(`  → set to TOPPER_YEAR_WAIVER (student has an award for that year): ${fix.length}`);
  fix.slice(0, 30).forEach((r) =>
    console.log(`    ${String(r.receiptNumber).padEnd(28)} ${r.paidDateBs}  year ${r.programYear ?? "-"}  NPR ${r.scholarshipNpr}`)
  );
  console.log(`  → left unchanged (type unknown, shown as "—"): ${unknown.length}`);
  unknown.slice(0, 30).forEach((r) =>
    console.log(`    ${String(r.receiptNumber).padEnd(28)} ${r.paidDateBs}  year ${r.programYear ?? "-"}  NPR ${r.scholarshipNpr}`)
  );

  if (!apply) {
    console.log("\nDry run — nothing changed. Run with --apply to update.");
  } else if (fix.length) {
    const result = await FeeCollection.updateMany(
      { _id: { $in: fix.map((r) => r._id) }, scholarshipType: { $in: ["NONE", null] } },
      { $set: { scholarshipType: "TOPPER_YEAR_WAIVER" } }
    );
    console.log(`\nUpdated ${result.modifiedCount} receipt(s).`);
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
