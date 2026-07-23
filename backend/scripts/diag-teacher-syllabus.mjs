import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("no MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const collNames = (await db.listCollections().toArray()).map((c) => c.name);
console.log("collections sample:", collNames.filter((n) => /syllab|subject|assign|teacher/i.test(n)));

const syllColl =
  collNames.find((n) => n.toLowerCase() === "academicsyllabuses") ||
  collNames.find((n) => /syllab/i.test(n));
const subjColl = collNames.find((n) => n.toLowerCase() === "subjects") || "subjects";
const assignColl =
  collNames.find((n) => n.toLowerCase() === "subjectassignments") || "subjectassignments";
const teacherColl = collNames.find((n) => n.toLowerCase() === "teachers") || "teachers";

console.log({ syllColl, subjColl, assignColl, teacherColl });

const syllabi = await db
  .collection(syllColl)
  .find({ isDeleted: { $ne: true } })
  .project({
    subjectId: 1,
    academicYearBs: 1,
    session: 1,
    teacherId: 1,
    yearId: 1,
    classId: 1,
    schoolId: 1,
    status: 1,
    faculty: 1,
  })
  .limit(80)
  .toArray();

console.log("SYLLABI total sample", syllabi.length);

const subjectIds = [...new Set(syllabi.map((s) => String(s.subjectId)).filter(Boolean))];
const subjects = await db
  .collection(subjColl)
  .find({
    _id: { $in: subjectIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) },
  })
  .project({ name: 1, code: 1, masterSubjectId: 1, schoolId: 1, yearIds: 1, classIds: 1 })
  .toArray();
const subById = Object.fromEntries(subjects.map((s) => [String(s._id), s]));

console.log("--- SYLLABI ---");
for (const s of syllabi) {
  const sub = subById[String(s.subjectId)];
  console.log(
    JSON.stringify({
      subjectId: String(s.subjectId),
      subjectName: sub?.name,
      code: sub?.code,
      master: sub?.masterSubjectId ? String(sub.masterSubjectId) : null,
      ay: s.academicYearBs,
      session: s.session,
      teacherId: s.teacherId ? String(s.teacherId) : null,
      yearId: s.yearId ? String(s.yearId) : null,
      classId: s.classId ? String(s.classId) : null,
      status: s.status,
      schoolId: String(s.schoolId),
    }),
  );
}

const anatomy = await db
  .collection(subjColl)
  .find({ name: /anatomy/i })
  .project({ name: 1, code: 1, masterSubjectId: 1, schoolId: 1, yearIds: 1 })
  .toArray();
console.log("--- ANATOMY SUBJECTS ---", anatomy.length);
for (const s of anatomy) {
  console.log(
    JSON.stringify({
      id: String(s._id),
      name: s.name,
      code: s.code,
      master: s.masterSubjectId ? String(s.masterSubjectId) : null,
      school: String(s.schoolId),
    }),
  );
}

const anatIds = anatomy.map((s) => s._id);
const assigns = anatIds.length
  ? await db
      .collection(assignColl)
      .find({ subjectId: { $in: anatIds }, status: "ACTIVE" })
      .limit(40)
      .toArray()
  : [];
console.log("--- ANATOMY ASSIGNMENTS ---", assigns.length);
for (const a of assigns) {
  console.log(
    JSON.stringify({
      teacherId: String(a.teacherId),
      subjectId: String(a.subjectId),
      ay: a.academicYearBs,
      yearId: a.yearId ? String(a.yearId) : null,
      classId: a.classId ? String(a.classId) : null,
      status: a.status,
      schoolId: String(a.schoolId),
    }),
  );
}

const anatSyll = anatIds.length
  ? await db
      .collection(syllColl)
      .find({ subjectId: { $in: anatIds }, isDeleted: { $ne: true } })
      .toArray()
  : [];
console.log("--- ANATOMY SYLLABI ---", anatSyll.length);
for (const s of anatSyll) {
  console.log(
    JSON.stringify({
      id: String(s._id),
      subjectId: String(s.subjectId),
      ay: s.academicYearBs,
      session: s.session,
      teacherId: s.teacherId ? String(s.teacherId) : null,
      yearId: s.yearId ? String(s.yearId) : null,
      classId: s.classId ? String(s.classId) : null,
      schoolId: String(s.schoolId),
      status: s.status,
    }),
  );
}

// Cross-check: for each anatomy assignment, does expand by name find syllabus subject?
if (assigns.length && anatSyll.length) {
  console.log("--- MATCH CHECK (assignment subject vs syllabus subjects) ---");
  for (const a of assigns) {
    const assigned = anatomy.find((s) => String(s._id) === String(a.subjectId));
    if (!assigned) continue;
    const name = (assigned.name || "").trim();
    const code = (assigned.code || "").trim();
    const master = assigned.masterSubjectId;
    const or = [];
    if (master) or.push({ masterSubjectId: master });
    if (code) or.push({ code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    if (name) or.push({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    const siblings = or.length
      ? await db
          .collection(subjColl)
          .find({ schoolId: assigned.schoolId, $or: or })
          .project({ _id: 1, name: 1 })
          .toArray()
      : [];
    const sibIds = new Set(siblings.map((s) => String(s._id)));
    const matchingSyll = anatSyll.filter((s) => sibIds.has(String(s.subjectId)));
    console.log(
      JSON.stringify({
        teacherId: String(a.teacherId),
        assignedSubject: String(a.subjectId),
        assignedName: assigned.name,
        siblingCount: siblings.length,
        matchingSyllabusCount: matchingSyll.length,
        matchingSyllSubjectIds: matchingSyll.map((s) => String(s.subjectId)),
        assignmentAy: a.academicYearBs,
        syllAys: matchingSyll.map((s) => s.academicYearBs),
      }),
    );
  }
}

// Settings academic year
const settings = await db.collection("settings").find({}).project({ academicYearBs: 1, schoolId: 1, schoolName: 1 }).limit(10).toArray();
console.log("--- SETTINGS ---");
for (const s of settings) {
  console.log(JSON.stringify({ schoolId: String(s.schoolId || s._id), ay: s.academicYearBs, name: s.schoolName }));
}

await mongoose.disconnect();
console.log("done");
