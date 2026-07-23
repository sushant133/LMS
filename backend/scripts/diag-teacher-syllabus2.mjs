import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const teacherId = "6a55346348ea9b4989f7d3b0";
const schoolId = new mongoose.Types.ObjectId("6a55345f48ea9b4989f7d353");
const assignedSubjectId = "6a55346148ea9b4989f7d37f";
const syllabusSubjectId = "6a5934357e9617e288b677b2";

// expand like service
async function expandCurriculumSubjectIds(sid) {
  const subject = await db.collection("subjects").findOne({
    _id: new mongoose.Types.ObjectId(sid),
    schoolId,
  });
  if (!subject) return [sid];
  const or = [];
  if (subject.masterSubjectId) or.push({ masterSubjectId: subject.masterSubjectId });
  const code = (subject.code ?? "").trim();
  if (code) or.push({ code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  const name = (subject.name ?? "").trim();
  if (name) or.push({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  const siblings = await db
    .collection("subjects")
    .find({ schoolId, $or: or })
    .project({ _id: 1 })
    .toArray();
  const ids = siblings.map((s) => String(s._id));
  if (!ids.includes(sid)) ids.push(sid);
  return ids;
}

const allowed = new Set();
for (const id of [assignedSubjectId]) {
  for (const sib of await expandCurriculumSubjectIds(id)) allowed.add(sib);
}
console.log("allowed subjects", [...allowed]);
console.log("includes syllabus subject?", allowed.has(syllabusSubjectId));

// Exact list query as listSyllabi
const filter = {
  schoolId,
  isDeleted: false,
  academicYearBs: "2083/2084",
  session: "2083/2084",
  subjectId: { $in: [...allowed].map((id) => new mongoose.Types.ObjectId(id)) },
};
const rows = await db.collection("academicsyllabuses").find(filter).toArray();
console.log("list with ObjectId $in", rows.length, rows.map((r) => String(r._id)));

// without casting to ObjectId (string $in)
const filter2 = {
  schoolId,
  isDeleted: false,
  academicYearBs: "2083/2084",
  session: "2083/2084",
  subjectId: { $in: [...allowed] },
};
const rows2 = await db.collection("academicsyllabuses").find(filter2).toArray();
console.log("list with string $in", rows2.length);

// without session
const filter3 = {
  schoolId,
  isDeleted: false,
  academicYearBs: "2083/2084",
  subjectId: { $in: [...allowed].map((id) => new mongoose.Types.ObjectId(id)) },
};
const rows3 = await db.collection("academicsyllabuses").find(filter3).toArray();
console.log("list without session", rows3.length);

// Teacher document + user
const teacher = await db.collection("teachers").findOne({ _id: new mongoose.Types.ObjectId(teacherId) });
console.log("teacher", {
  id: String(teacher._id),
  user: String(teacher.user),
  subjects: (teacher.subjects || []).map(String),
  migration: teacher.assignmentMigrationStatus,
});

// Year level check for assignment vs syllabus
const years = await db
  .collection("years")
  .find({
    _id: {
      $in: [
        new mongoose.Types.ObjectId("6a55346048ea9b4989f7d35d"), // assignment year
        new mongoose.Types.ObjectId("6a55346048ea9b4989f7d360"), // syllabus year
      ],
    },
  })
  .toArray();
console.log(
  "years",
  years.map((y) => ({
    id: String(y._id),
    name: y.name,
    level: y.level,
    batchId: y.batchId ? String(y.batchId) : null,
  })),
);

// Subject yearIds for assigned vs syllabus
const subs = await db
  .collection("subjects")
  .find({
    _id: {
      $in: [
        new mongoose.Types.ObjectId(assignedSubjectId),
        new mongoose.Types.ObjectId(syllabusSubjectId),
      ],
    },
  })
  .toArray();
console.log(
  "subjects detail",
  subs.map((s) => ({
    id: String(s._id),
    name: s.name,
    yearIds: (s.yearIds || []).map(String),
    master: s.masterSubjectId ? String(s.masterSubjectId) : null,
  })),
);

// Simulate frontend yearKey match
// assignment year 6a55346048ea9b4989f7d35d
// syllabus year 6a55346048ea9b4989f7d360
const aYear = years.find((y) => String(y._id) === "6a55346048ea9b4989f7d35d");
const sYear = years.find((y) => String(y._id) === "6a55346048ea9b4989f7d360");
const yearLevelKey = (level, name) => {
  if (level != null && Number.isFinite(Number(level))) return `level:${Number(level)}`;
  const n = (name || "").toLowerCase();
  if (n.includes("1") || n.includes("first")) return "level:1";
  return `name:${(name || "").trim().toLowerCase()}`;
};
console.log("assignment year key", yearLevelKey(aYear?.level, aYear?.name), aYear?.name);
console.log("syllabus year key", yearLevelKey(sYear?.level, sYear?.name), sYear?.name);

// All subjects for teacher after expansion + names "Anatomy And Physiology"
const allNames = await db
  .collection("subjects")
  .find({ schoolId, name: /physiology|anatomy/i })
  .project({ name: 1, code: 1 })
  .toArray();
console.log(
  "physiology/anatomy names",
  allNames.map((s) => ({ id: String(s._id), name: s.name, code: s.code })),
);

await mongoose.disconnect();
