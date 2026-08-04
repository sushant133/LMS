import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const cols = (await db.listCollections().toArray()).map((c) => c.name);
const assignCol =
  cols.find((c) => /subjectassignment/i.test(c)) || "subjectassignments";
console.log("assign collection:", assignCol);

const teachers = await db
  .collection("teachers")
  .find({})
  .project({
    teacherCode: 1,
    fullName: 1,
    user: 1,
    subjects: 1,
    assignedBatchIds: 1,
    assignedYearIds: 1,
    assignmentMigrationStatus: 1,
  })
  .toArray();

const assigns = await db.collection(assignCol).find({}).toArray();

console.log("teachers:", teachers.length, "assignment rows:", assigns.length);
for (const t of teachers) {
  const u = t.user
    ? await db.collection("users").findOne({ _id: t.user })
    : null;
  const myAssign = assigns.filter(
    (a) =>
      String(a.teacherId) === String(t._id) ||
      String(a.teacher) === String(t._id),
  );
  console.log(
    JSON.stringify({
      code: t.teacherCode,
      name: t.fullName || u?.fullName,
      email: u?.email,
      role: u?.role,
      active: u?.isActive !== false,
      legacySubjects: (t.subjects || []).length,
      batches: (t.assignedBatchIds || []).length,
      years: (t.assignedYearIds || []).length,
      migration: t.assignmentMigrationStatus,
      assignmentRows: myAssign.length,
      assignSample: myAssign.slice(0, 2).map((a) => ({
        subjectId: String(a.subjectId || a.subject || ""),
        batchId: String(a.batchId || ""),
        yearId: String(a.yearId || ""),
        status: a.status,
      })),
    }),
  );
}
await mongoose.disconnect();
