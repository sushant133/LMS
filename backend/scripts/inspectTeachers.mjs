import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI);
const teachers = await mongoose.connection.db
  .collection("teachers")
  .find({ teacherCode: { $in: ["TCH002", "TCH003"] } })
  .toArray();
for (const t of teachers) {
  console.log(
    JSON.stringify(
      {
        code: t.teacherCode,
        subjects: (t.subjects || []).map(String),
        batches: (t.assignedBatchIds || []).map(String),
        years: (t.assignedYearIds || []).map(String),
        migration: t.assignmentMigrationStatus,
      },
      null,
      2
    )
  );
}
const subIds = teachers.flatMap((t) => t.subjects || []);
const subjects = await mongoose.connection.db
  .collection("subjects")
  .find({ _id: { $in: subIds } })
  .project({ name: 1, code: 1, yearIds: 1 })
  .toArray();
console.log(
  "subjects",
  subjects.map((s) => ({
    id: String(s._id),
    name: s.name,
    years: (s.yearIds || []).map(String),
  }))
);
await mongoose.disconnect();
