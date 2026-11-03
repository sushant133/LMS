/**
 * Refresh every student's stored fee due (Student.feesDueNpr) and each receipt's year
 * due snapshot from the shared fee position — the calculation Student Fee Records, the
 * Student Ledger and Receivables Aging now use.
 *
 * Stored dues were only refreshed when a receipt was saved, so older values can disagree
 * with the screens (pending-fees list, defaulters, portal). Journals are never touched.
 *
 * Usage (from the backend folder):
 *   npm run fees:recalc:dry-run          # prints what would change, changes nothing
 *   npm run fees:recalc                  # applies it
 *
 * Idempotent: a second run finds nothing to change.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Student } from "../models/Student.js";
import { StudentScholarshipAward } from "../models/StudentScholarshipAward.js";
import { buildStudentFeePosition, recalculateStudentFeesDue } from "../utils/accountingCalculations.js";

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  const [students, collections, awards] = await Promise.all([
    Student.find({}).select("schoolId admissionNumber feesDueNpr year1FeeNpr year2FeeNpr year3FeeNpr").lean(),
    FeeCollection.find({ isDeleted: false }).lean(),
    StudentScholarshipAward.find({ isDeleted: false, status: { $in: ["ACTIVE", "APPLIED"] } }).lean()
  ]);
  const byStudent = new Map<string, Array<Record<string, unknown>>>();
  for (const c of collections) {
    const key = c.studentId.toString();
    const list = byStudent.get(key) ?? [];
    list.push(c as unknown as Record<string, unknown>);
    byStudent.set(key, list);
  }

  const changes: Array<{ id: mongoose.Types.ObjectId; schoolId: mongoose.Types.ObjectId; admissionNumber: string; from: number; to: number }> = [];
  for (const s of students) {
    const key = s._id.toString();
    const position = buildStudentFeePosition(
      byStudent.get(key) ?? [],
      awards.filter((a) => String(a.studentId) === key) as unknown as Array<Record<string, unknown>>,
      {
        1: Math.max(0, Number(s.year1FeeNpr) || 0),
        2: Math.max(0, Number(s.year2FeeNpr) || 0),
        3: Math.max(0, Number(s.year3FeeNpr) || 0)
      }
    );
    const stored = Math.round((Number(s.feesDueNpr) || 0) * 100) / 100;
    if (Math.abs(stored - position.totals.outstandingNpr) >= 0.01) {
      changes.push({ id: s._id, schoolId: s.schoolId, admissionNumber: s.admissionNumber ?? "", from: stored, to: position.totals.outstandingNpr });
    }
  }

  console.log(`\nStudents checked: ${students.length}`);
  console.log(`Stored due differs for: ${changes.length}`);
  changes.forEach((c) => console.log(`  ${c.admissionNumber.padEnd(16)} NPR ${c.from} → NPR ${c.to}`));

  if (!apply) {
    console.log("\nDry run — nothing changed. Run with --apply to update these students.");
  } else {
    for (const c of changes) {
      // Same routine that runs after every receipt: stored due + receipt year snapshots
      await recalculateStudentFeesDue(c.id, c.schoolId);
    }
    console.log(`\nUpdated ${changes.length} student(s).`);
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
