/**
 * Round-trip check: syllabus completion must follow APPROVED log book entries
 * only — a class the teacher has filed but administration has not verified and
 * approved must not move the percentage.
 *
 * Run: npx tsx src/scripts/verifySyllabusApprovalGate.ts
 */
import mongoose from "mongoose";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { syncSyllabusCompletionFromLogBook } from "../utils/academicManagementService.js";

const URI = "mongodb://127.0.0.1:27017/phit_approval_gate_check";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const schoolId = new mongoose.Types.ObjectId();
const syllabusId = new mongoose.Types.ObjectId();
const chapterId = new mongoose.Types.ObjectId();
const unitId = new mongoose.Types.ObjectId();
const subjectId = new mongoose.Types.ObjectId();
const teacherId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

const makeLeaf = (subUnitNo: number, heading: string) =>
  AcademicSyllabusSubUnit.create({
    schoolId,
    syllabusId,
    chapterId,
    unitId,
    subUnitNo,
    heading,
    status: "NOT_STARTED"
  });

const makeEntry = (
  leafId: mongoose.Types.ObjectId,
  heading: string,
  reviewStatus: string,
  dateBs: string,
  periodNumber: number
) =>
  AcademicLogBookEntry.create({
    schoolId,
    syllabusId,
    syllabusUnitId: unitId,
    syllabusSubUnitId: leafId,
    syllabusSubUnitIds: [leafId],
    subUnitTitles: [heading],
    subUnitTitle: heading,
    academicYearBs: "2081",
    session: "2081",
    subjectId,
    teacherId,
    serialNo: periodNumber,
    dateBs,
    periodNumber,
    topicCovered: heading,
    reviewStatus,
    audit: { createdBy: userId }
  });

const statusOf = async (leafId: mongoose.Types.ObjectId): Promise<string> => {
  const row = await AcademicSyllabusSubUnit.findById(leafId).select("status").lean();
  return String(row?.status ?? "");
};

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();

  const pending = await makeLeaf(1, "Pending topic");
  const verified = await makeLeaf(2, "Verified topic");
  const approved = await makeLeaf(3, "Approved topic");
  const rejected = await makeLeaf(4, "Rejected topic");

  await makeEntry(pending._id, "Pending topic", "PENDING", "2081-01-01", 1);
  await makeEntry(verified._id, "Verified topic", "VERIFIED", "2081-01-02", 2);
  const approvedEntry = await makeEntry(approved._id, "Approved topic", "APPROVED", "2081-01-03", 3);
  await makeEntry(rejected._id, "Rejected topic", "NEEDS_IMPROVEMENT", "2081-01-04", 4);

  await syncSyllabusCompletionFromLogBook(schoolId, syllabusId.toString(), subjectId.toString());

  check("PENDING entry does not complete its leaf", (await statusOf(pending._id)) !== "COMPLETED", await statusOf(pending._id));
  check("VERIFIED-but-not-approved entry does not complete its leaf", (await statusOf(verified._id)) !== "COMPLETED", await statusOf(verified._id));
  check("NEEDS_IMPROVEMENT entry does not complete its leaf", (await statusOf(rejected._id)) !== "COMPLETED", await statusOf(rejected._id));
  check("APPROVED entry completes its leaf", (await statusOf(approved._id)) === "COMPLETED", await statusOf(approved._id));

  const stamped = await AcademicSyllabusSubUnit.findById(approved._id).lean();
  check(
    "approved leaf is attributed to the teacher who taught it",
    String(stamped?.completedByTeacherId ?? "") === teacherId.toString()
  );
  check("approved leaf carries the BS date it was taught", stamped?.taughtDateBs === "2081-01-03", String(stamped?.taughtDateBs));
  check("approved leaf counts toward salary", stamped?.countsTowardSalary === true);
  const firstCompletedAt = stamped?.completedAt;

  // Re-running must not churn completedAt (serializeSyllabus syncs on every read).
  await new Promise((resolve) => setTimeout(resolve, 20));
  await syncSyllabusCompletionFromLogBook(schoolId, syllabusId.toString(), subjectId.toString());
  const again = await AcademicSyllabusSubUnit.findById(approved._id).lean();
  check(
    "re-running the sync leaves completedAt alone",
    String(again?.completedAt?.getTime() ?? "") === String(firstCompletedAt?.getTime() ?? "")
  );

  // Pre-existing bad data: a leaf completed before the rule existed, with only a
  // pending entry behind it, must roll back.
  await AcademicSyllabusSubUnit.updateOne(
    { _id: pending._id },
    { $set: { status: "COMPLETED", completionSource: "TEACHER", countsTowardSalary: true } }
  );
  await syncSyllabusCompletionFromLogBook(schoolId, syllabusId.toString(), subjectId.toString());
  check("a leaf completed without approval is reset", (await statusOf(pending._id)) === "NOT_STARTED", await statusOf(pending._id));

  // Administration extra lectures are not log-book driven and must survive.
  await AcademicSyllabusSubUnit.updateOne(
    { _id: verified._id },
    { $set: { status: "COMPLETED", completionSource: "ADMINISTRATION", countsTowardSalary: false } }
  );
  await syncSyllabusCompletionFromLogBook(schoolId, syllabusId.toString(), subjectId.toString());
  check("administration completion survives the sync", (await statusOf(verified._id)) === "COMPLETED", await statusOf(verified._id));

  // Withdrawing the approval rolls the leaf back again.
  await AcademicLogBookEntry.updateOne({ _id: approvedEntry._id }, { $set: { reviewStatus: "NEEDS_IMPROVEMENT" } });
  await syncSyllabusCompletionFromLogBook(schoolId, syllabusId.toString(), subjectId.toString());
  check("withdrawing approval rolls the leaf back", (await statusOf(approved._id)) === "NOT_STARTED", await statusOf(approved._id));

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
