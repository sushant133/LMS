/**
 * Round-trip check: does the BS taught date entered on the Syllabus Completion
 * form survive into what the oversight API serialises back out?
 *
 * Run: npx tsx src/scripts/verifySyllabusTaughtDate.ts
 */
import mongoose from "mongoose";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import {
  markSubUnitsCompleted,
  snapshotSubUnitAttribution
} from "../utils/syllabusCompletionAttribution.js";

const URI = "mongodb://127.0.0.1:27017/phit_taughtdate_check";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const schoolId = new mongoose.Types.ObjectId();
const syllabusId = new mongoose.Types.ObjectId();
const unitId = new mongoose.Types.ObjectId();
const teacherId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

const makeLeaf = async (subUnitNo: number) =>
  AcademicSyllabusSubUnit.create({
    schoolId,
    syllabusId,
    chapterId: new mongoose.Types.ObjectId(),
    unitId,
    subUnitNo,
    heading: `Topic ${subUnitNo}`,
    status: "NOT_STARTED"
  });

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db?.dropDatabase();

  // 1. Teacher completion stores the taught date.
  const leafA = await makeLeaf(1);
  await markSubUnitsCompleted({
    schoolId,
    subUnitIds: [leafA._id.toString()],
    source: "TEACHER",
    teacherId: teacherId.toString(),
    userId: userId.toString(),
    taughtDateBs: "2083-04-12",
    todaysCoverage: "Photosynthesis"
  });
  const savedA = await AcademicSyllabusSubUnit.findById(leafA._id).lean();
  check("teacher completion stores taught date", savedA?.taughtDateBs === "2083-04-12", savedA?.taughtDateBs);
  check("teacher completion marks completed", savedA?.status === "COMPLETED", savedA?.status);
  check(
    "teacher completion attributes the teacher",
    String(savedA?.completedByTeacherId ?? "") === teacherId.toString()
  );

  // 2. Administration completion stores the date and the guest name, no salary.
  const leafB = await makeLeaf(2);
  await markSubUnitsCompleted({
    schoolId,
    subUnitIds: [leafB._id.toString()],
    source: "ADMINISTRATION",
    userId: userId.toString(),
    taughtDateBs: "2083-04-15",
    deliveredByName: "Dr. Guest Lecturer",
    todaysCoverage: "Extra lecture"
  });
  const savedB = await AcademicSyllabusSubUnit.findById(leafB._id).lean();
  check("admin completion stores taught date", savedB?.taughtDateBs === "2083-04-15", savedB?.taughtDateBs);
  check("admin completion keeps guest name", savedB?.deliveredByName === "Dr. Guest Lecturer");
  check("admin completion excluded from salary", savedB?.countsTowardSalary === false);

  // 3. The snapshot the API reads from carries the date through.
  const rows = await AcademicSyllabusSubUnit.find({ schoolId }).lean();
  const snap = snapshotSubUnitAttribution(rows as never);
  check(
    "snapshot carries taught date (teacher)",
    snap.get(leafA._id.toString())?.taughtDateBs === "2083-04-12"
  );
  check(
    "snapshot carries taught date (admin)",
    snap.get(leafB._id.toString())?.taughtDateBs === "2083-04-15"
  );

  // 4. A log-book write must NOT steal an administration leaf, but should still
  //    stamp the date it was taught on.
  await markSubUnitsCompleted({
    schoolId,
    subUnitIds: [leafB._id.toString()],
    source: "TEACHER",
    teacherId: teacherId.toString(),
    userId: userId.toString(),
    taughtDateBs: "2083-04-20",
    overwriteAttribution: false
  });
  const afterLog = await AcademicSyllabusSubUnit.findById(leafB._id).lean();
  check(
    "log book does not steal admin leaf for salary",
    afterLog?.countsTowardSalary === false && afterLog?.completionSource === "ADMINISTRATION"
  );
  check("log book still updates taught date", afterLog?.taughtDateBs === "2083-04-20", afterLog?.taughtDateBs);

  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
