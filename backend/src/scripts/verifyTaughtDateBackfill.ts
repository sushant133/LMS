/**
 * Proves the taught-date backfill picks the right log book entry, and that
 * re-running it never disturbs data it already wrote.
 *
 * Seeds a scratch DB, runs the real backfill script against it, and asserts.
 * Run: npx tsx src/scripts/verifyTaughtDateBackfill.ts
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import mongoose from "mongoose";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";

const DB = "phit_backfill_check";
const URI = `mongodb://127.0.0.1:27017/${DB}`;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const schoolId = new mongoose.Types.ObjectId();
const syllabusId = new mongoose.Types.ObjectId();
const unitId = new mongoose.Types.ObjectId();
const teacherA = new mongoose.Types.ObjectId();
const teacherB = new mongoose.Types.ObjectId();

const leaf = async (
  n: number,
  fields: Record<string, unknown> = {}
): Promise<mongoose.Types.ObjectId> => {
  const doc = await AcademicSyllabusSubUnit.create({
    schoolId,
    syllabusId,
    chapterId: new mongoose.Types.ObjectId(),
    unitId,
    subUnitNo: n,
    heading: `Topic ${n}`,
    status: "COMPLETED",
    ...fields
  });
  return doc._id as mongoose.Types.ObjectId;
};

let serial = 0;
const logEntry = async (
  subUnitIds: mongoose.Types.ObjectId[],
  dateBs: string,
  extra: Record<string, unknown> = {}
) => {
  serial += 1;
  await AcademicLogBookEntry.create({
    schoolId,
    logBookId: new mongoose.Types.ObjectId(),
    syllabusId,
    syllabusUnitId: unitId,
    syllabusSubUnitId: subUnitIds[0],
    syllabusSubUnitIds: subUnitIds,
    academicYearBs: "2083",
    session: "2083",
    subjectId: new mongoose.Types.ObjectId(),
    teacherId: teacherA,
    serialNo: serial,
    dateBs,
    unit: "Unit 1",
    topicCovered: "Covered",
    periodNumber: serial,
    audit: { createdBy: new mongoose.Types.ObjectId() },
    isDeleted: false,
    ...extra
  });
};

const runBackfill = (args: string[]): string =>
  execFileSync(
    "npx",
    ["tsx", path.join("src", "scripts", "backfillSyllabusTaughtDates.ts"), ...args],
    {
      env: { ...process.env, MONGODB_URI: URI },
      encoding: "utf8",
      // Windows resolves npx through npx.cmd, which needs a shell.
      shell: true
    }
  );

const taughtDateOf = async (id: mongoose.Types.ObjectId): Promise<string> => {
  const row = await AcademicSyllabusSubUnit.findById(id).lean();
  return String(row?.taughtDateBs ?? "");
};

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db?.dropDatabase();

  // A: one entry -> that date.
  const a = await leaf(1, { completionSource: "TEACHER", completedByTeacherId: teacherA });
  await logEntry([a], "2083-04-05");

  // B: taught across several classes -> the one that finished it (latest).
  const b = await leaf(2, { completionSource: "TEACHER", completedByTeacherId: teacherA });
  await logEntry([b], "2083-04-02");
  await logEntry([b], "2083-04-09");
  await logEntry([b], "2083-04-06");

  // C: administration extra lecture must not be dated from a teacher's class,
  //    even though the teacher's class is more recent.
  const c = await leaf(3, { completionSource: "ADMINISTRATION", countsTowardSalary: false });
  await logEntry([c], "2083-04-11");
  await logEntry([c], "2083-04-03", { completionSource: "ADMINISTRATION", countsTowardSalary: false });

  // D: completed but no log book entry -> stays empty, counted as unmatched.
  const d = await leaf(4, { completionSource: "TEACHER" });

  // E: already has a date -> must be left alone.
  const e = await leaf(5, { completionSource: "TEACHER", taughtDateBs: "2083-01-01" });
  await logEntry([e], "2083-04-20");

  // F: a deleted log entry is not evidence of teaching.
  const f = await leaf(6, { completionSource: "TEACHER" });
  await logEntry([f], "2083-04-14", { isDeleted: true });

  // G: not completed -> out of scope entirely.
  const g = await leaf(7, { status: "IN_PROGRESS" });
  await logEntry([g], "2083-04-18");

  // Report mode must not write anything.
  const report = runBackfill([]);
  check("report mode writes nothing", (await taughtDateOf(a)) === "", await taughtDateOf(a));
  // 5 leaves lack a date (a,b,c,d,f); a/b/c have usable entries, d has none and
  // f's only entry is deleted.
  check("report counts what it can fix", /Can backfill\s+:\s*3/.test(report), report.match(/Can backfill.*/)?.[0]);
  check("report counts unmatched", /No log book entry\s+:\s*2/.test(report), report.match(/No log book entry.*/)?.[0]);

  runBackfill(["--apply"]);

  check("single entry", (await taughtDateOf(a)) === "2083-04-05", await taughtDateOf(a));
  check("multi-class picks the finishing class", (await taughtDateOf(b)) === "2083-04-09", await taughtDateOf(b));
  check(
    "admin leaf uses the admin entry, not a later teacher class",
    (await taughtDateOf(c)) === "2083-04-03",
    await taughtDateOf(c)
  );
  check("no log entry stays empty", (await taughtDateOf(d)) === "", await taughtDateOf(d));
  check("existing date untouched", (await taughtDateOf(e)) === "2083-01-01", await taughtDateOf(e));
  check("deleted entry ignored", (await taughtDateOf(f)) === "", await taughtDateOf(f));
  check("incomplete leaf skipped", (await taughtDateOf(g)) === "", await taughtDateOf(g));

  // Idempotent: a second --apply must change nothing.
  const second = runBackfill(["--apply"]);
  // Only the two that can never be recovered (d, f) remain.
  check("re-run finds nothing new", /Completed leaves w\/o date: 2/.test(second), second.match(/Completed leaves.*/)?.[0]);
  check("re-run leaves values intact", (await taughtDateOf(b)) === "2083-04-09", await taughtDateOf(b));

  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
