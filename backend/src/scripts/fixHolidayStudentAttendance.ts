/**
 * Remove student attendance that was marked on Academic Calendar holidays.
 *
 * Before the holiday block, student attendance could be saved on days the
 * Academic Calendar marks as a holiday (the "H" days in the Attendance
 * Register: holiday / vacation events, Saturdays, settings holidays — unless a
 * Working Day event overrides). Those marks show as P/A instead of H and count
 * in attendance percentages.
 *
 * This removes, for holiday dates only:
 *   - Student Daily Attendance sheets (what the register shows)
 *   - Subject-wise attendance (what percentages / reports use)
 * Teacher / staff attendance and Field Duty (hospital) attendance are never touched.
 *
 * Usage (from the backend folder):
 *
 *   # 1) See what would be removed (read-only, changes nothing)
 *   npx tsx src/scripts/fixHolidayStudentAttendance.ts
 *
 *   # 2) Back up the records to backups/…json, then remove them
 *   npx tsx src/scripts/fixHolidayStudentAttendance.ts --apply
 *
 *   # Undo: put the backed-up records back
 *   npx tsx src/scripts/fixHolidayStudentAttendance.ts --restore backups/holiday-attendance-<time>.json
 *
 * Safe to re-run: once a holiday's marks are removed there is nothing left to match.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Attendance } from "../models/Attendance.js";
import { Batch } from "../models/Batch.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { Year } from "../models/Year.js";
import { resolveCalendarHolidayForDate } from "../utils/academicCalendarService.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const restoreIndex = args.indexOf("--restore");
const restoreFile = restoreIndex >= 0 ? args[restoreIndex + 1] : undefined;

interface Backup {
  createdAt: string;
  dailyAttendance: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
}

const restore = async (file: string) => {
  const backup = JSON.parse(fs.readFileSync(file, "utf8")) as Backup;
  // EJSON keeps ObjectIds / dates exactly as they were
  const { EJSON } = mongoose.mongo.BSON;
  const daily = backup.dailyAttendance.map((doc) => EJSON.deserialize(doc));
  const subject = backup.attendance.map((doc) => EJSON.deserialize(doc));
  const insert = async (collection: mongoose.Collection, docs: Record<string, unknown>[]) => {
    if (!docs.length) return 0;
    try {
      const result = await collection.insertMany(docs, { ordered: false });
      return result.insertedCount;
    } catch (error) {
      // Records already back in place (duplicate _id) are skipped
      const inserted = (error as { result?: { insertedCount?: number } }).result?.insertedCount;
      return inserted ?? 0;
    }
  };
  const restoredDaily = await insert(DailyAttendance.collection, daily);
  const restoredSubject = await insert(Attendance.collection, subject);
  console.log(`Restored ${restoredDaily} daily sheet(s) and ${restoredSubject} subject attendance record(s) from ${file}`);
};

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);

  if (restoreFile) {
    await restore(restoreFile);
    await mongoose.disconnect();
    return;
  }

  // Every (school, date) that has student attendance
  const [dailyDates, subjectDates] = await Promise.all([
    DailyAttendance.aggregate<{ _id: { schoolId: mongoose.Types.ObjectId; dateBs: string } }>([
      { $group: { _id: { schoolId: "$schoolId", dateBs: "$dateBs" } } }
    ]),
    Attendance.aggregate<{ _id: { schoolId: mongoose.Types.ObjectId; dateBs: string } }>([
      { $group: { _id: { schoolId: "$schoolId", dateBs: "$dateBs" } } }
    ])
  ]);
  const pairs = new Map<string, { schoolId: mongoose.Types.ObjectId; dateBs: string }>();
  for (const row of [...dailyDates, ...subjectDates]) pairs.set(`${row._id.schoolId}|${row._id.dateBs}`, row._id);

  const holidays: Array<{ schoolId: mongoose.Types.ObjectId; dateBs: string; title: string }> = [];
  for (const pair of pairs.values()) {
    const holiday = await resolveCalendarHolidayForDate(pair.schoolId, pair.dateBs);
    if (holiday) holidays.push({ ...pair, title: holiday.title });
  }
  holidays.sort((a, b) => a.dateBs.localeCompare(b.dateBs));

  console.log(`Checked ${pairs.size} date(s) with student attendance — ${holidays.length} fall on a holiday.`);
  if (!holidays.length) {
    console.log("Nothing to fix.");
    await mongoose.disconnect();
    return;
  }

  const [batches, years] = await Promise.all([Batch.find().select("name").lean(), Year.find().select("name").lean()]);
  const batchName = new Map(batches.map((b) => [b._id.toString(), b.name]));
  const yearName = new Map(years.map((y) => [y._id.toString(), y.name]));
  const groupOf = (doc: { batchId?: unknown; yearId?: unknown }) =>
    `${batchName.get(String(doc.batchId)) ?? "—"} / ${yearName.get(String(doc.yearId)) ?? "—"}`;

  const dailyIds: mongoose.Types.ObjectId[] = [];
  const subjectIds: mongoose.Types.ObjectId[] = [];
  let marks = 0;

  console.log("");
  for (const day of holidays) {
    const [sheets, subject] = await Promise.all([
      DailyAttendance.find({ schoolId: day.schoolId, dateBs: day.dateBs }).select("batchId yearId entries.status").lean(),
      Attendance.find({ schoolId: day.schoolId, dateBs: day.dateBs }).select("batchId yearId entries.status").lean()
    ]);
    const counts: Record<string, number> = {};
    for (const sheet of [...sheets, ...(sheets.length ? [] : subject)]) {
      for (const entry of sheet.entries ?? []) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    }
    const dayMarks = Object.values(counts).reduce((sum, n) => sum + n, 0);
    marks += dayMarks;
    dailyIds.push(...sheets.map((s) => s._id as mongoose.Types.ObjectId));
    subjectIds.push(...subject.map((s) => s._id as mongoose.Types.ObjectId));
    const groups = [...new Set([...sheets, ...subject].map(groupOf))].join(", ");
    const statusText = Object.entries(counts).map(([status, n]) => `${status} ${n}`).join(", ") || "no marks";
    console.log(`  ${day.dateBs}  ${day.title}`);
    console.log(`      ${sheets.length} daily sheet(s), ${subject.length} subject record(s) · ${statusText} · ${groups}`);
  }

  console.log("");
  console.log(`Total: ${dailyIds.length} daily sheet(s), ${subjectIds.length} subject attendance record(s), ${marks} student mark(s).`);

  if (!apply) {
    console.log("\nReport only — nothing was changed. Run again with --apply to back up and remove these records.");
    await mongoose.disconnect();
    return;
  }

  // Back up everything first, exactly as stored
  const { EJSON } = mongoose.mongo.BSON;
  const [dailyDocs, subjectDocs] = await Promise.all([
    DailyAttendance.collection.find({ _id: { $in: dailyIds } }).toArray(),
    Attendance.collection.find({ _id: { $in: subjectIds } }).toArray()
  ]);
  const backupDir = path.resolve("backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `holiday-attendance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const backup: Backup = {
    createdAt: new Date().toISOString(),
    dailyAttendance: dailyDocs.map((doc) => EJSON.serialize(doc) as Record<string, unknown>),
    attendance: subjectDocs.map((doc) => EJSON.serialize(doc) as Record<string, unknown>)
  };
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  const [removedDaily, removedSubject] = await Promise.all([
    DailyAttendance.deleteMany({ _id: { $in: dailyIds } }),
    Attendance.deleteMany({ _id: { $in: subjectIds } })
  ]);
  console.log(
    `Removed ${removedDaily.deletedCount} daily sheet(s) and ${removedSubject.deletedCount} subject attendance record(s). ` +
      "Those days now show H in the Attendance Register."
  );
  console.log(`To undo: npx tsx src/scripts/fixHolidayStudentAttendance.ts --restore "${backupFile}"`);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
