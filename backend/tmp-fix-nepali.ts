import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set");
  process.exit(1);
}

const SCHOOL_ID = "6a55345f48ea9b4989f7d353"; // Public Himal Institute of Technology

// No subject at this school currently has real practical marks in use — the individual
// marksheet already shows a single combined column for every subject. Bulk print should
// match that: clear practicalMarks wherever it's set, and set theoryMarks = fullMarks so
// each subject prints as one combined column, same as English already does.
const filter = {
  schoolId: undefined as unknown, // set below
  practicalMarks: { $exists: true, $gt: 0 },
};

const run = async () => {
  await mongoose.connect(uri as string);
  const db = mongoose.connection.db!;
  const schoolObjectId = new mongoose.Types.ObjectId(SCHOOL_ID);
  filter.schoolId = schoolObjectId;

  const subjectsBefore = await db.collection("subjects").find(filter).toArray();
  console.log(`Found ${subjectsBefore.length} Subject doc(s) with a practical component:`);
  console.log(
    JSON.stringify(
      subjectsBefore.map((s) => ({
        _id: s._id,
        name: s.name,
        yearIds: s.yearIds,
        theoryMarks: s.theoryMarks,
        practicalMarks: s.practicalMarks,
        fullMarks: s.fullMarks,
        passMarks: s.passMarks,
      })),
      null,
      2,
    ),
  );

  const masterBefore = await db.collection("mastersubjects").find(filter).toArray();
  console.log(`Found ${masterBefore.length} MasterSubject doc(s) with a practical component:`);
  console.log(
    JSON.stringify(
      masterBefore.map((s) => ({
        _id: s._id,
        name: s.name,
        theoryMarks: s.theoryMarks,
        practicalMarks: s.practicalMarks,
        fullMarks: s.fullMarks,
        passMarks: s.passMarks,
      })),
      null,
      2,
    ),
  );

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("\nDry run only (no changes made). Re-run with --apply to write changes.");
    await mongoose.disconnect();
    return;
  }

  const subjectUpdate = await db.collection("subjects").updateMany(filter, [
    { $set: { theoryMarks: "$fullMarks" } },
    { $unset: "practicalMarks" },
  ]);
  console.log(`Subjects updated: ${subjectUpdate.modifiedCount}`);

  const masterUpdate = await db.collection("mastersubjects").updateMany(filter, [
    { $set: { theoryMarks: "$fullMarks" } },
    { $unset: "practicalMarks" },
  ]);
  console.log(`MasterSubjects updated: ${masterUpdate.modifiedCount}`);

  const subjectsAfter = await db
    .collection("subjects")
    .find({ schoolId: schoolObjectId })
    .toArray();
  console.log(
    "All subjects after:",
    JSON.stringify(
      subjectsAfter.map((s) => ({
        _id: s._id,
        name: s.name,
        theoryMarks: s.theoryMarks,
        practicalMarks: s.practicalMarks,
        fullMarks: s.fullMarks,
      })),
      null,
      2,
    ),
  );

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
