import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("No MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

console.log("DB name:", db.databaseName);

const allSubjects = await db
  .collection("subjects")
  .find({})
  .project({ _id: 1, name: 1, code: 1 })
  .toArray();
console.log("total subjects:", allSubjects.length);
console.log(
  "subject names:",
  allSubjects.map((s) => s.name).join(" | "),
);

const masterSubjects = await db
  .collection("mastersubjects")
  .find({})
  .project({ _id: 1, name: 1, code: 1 })
  .limit(100)
  .toArray();
console.log("master subjects sample:", masterSubjects.length);
console.log(
  "master names:",
  masterSubjects.map((s) => s.name).join(" | "),
);

const syllabi = await db.collection("academicsyllabuses").find({}).toArray();
console.log("\nALL syllabi:", syllabi.length);
for (const s of syllabi) {
  const subj =
    allSubjects.find((x) => String(x._id) === String(s.subjectId)) ||
    masterSubjects.find((x) => String(x._id) === String(s.subjectId));
  const ch = await db
    .collection("academicsyllabuschapters")
    .countDocuments({ syllabusId: s._id });
  const topics = await db
    .collection("academicsyllabustopics")
    .countDocuments({ syllabusId: s._id });
  const subs = await db
    .collection("academicsyllabussubunits")
    .countDocuments({ syllabusId: s._id });
  const legacy = await db
    .collection("academicsyllabusunits")
    .countDocuments({ syllabusId: s._id });

  // also try string syllabusId (in case of type mismatch)
  const ch2 = await db
    .collection("academicsyllabuschapters")
    .countDocuments({ syllabusId: String(s._id) });
  const topics2 = await db
    .collection("academicsyllabustopics")
    .countDocuments({ syllabusId: String(s._id) });

  console.log({
    id: String(s._id),
    subject: subj?.name || String(s.subjectId),
    code: s.subjectCode || subj?.code,
    year: s.academicYearBs,
    yearId: s.yearId ? String(s.yearId) : null,
    status: s.status,
    isDeleted: s.isDeleted,
    updatedAt: s.updatedAt,
    chapters: ch,
    topics,
    subUnits: subs,
    legacyUnits: legacy,
    chaptersByStringId: ch2,
    topicsByStringId: topics2,
    totalTheoryHours: s.totalTheoryHours,
    totalPracticalHours: s.totalPracticalHours,
    creditHours: s.creditHours,
  });
}

// Dump remaining hierarchy content
const remainingChapters = await db
  .collection("academicsyllabuschapters")
  .find({})
  .toArray();
const remainingTopics = await db
  .collection("academicsyllabustopics")
  .find({})
  .toArray();
const remainingSubs = await db
  .collection("academicsyllabussubunits")
  .find({})
  .toArray();
const remainingLegacy = await db
  .collection("academicsyllabusunits")
  .find({})
  .toArray();

console.log("\nRemaining chapters:", remainingChapters.length);
for (const c of remainingChapters) {
  console.log({
    id: String(c._id),
    syllabusId: String(c.syllabusId),
    chapterNo: c.chapterNo,
    title: c.title,
    sectionKind: c.sectionKind,
  });
}
console.log("Remaining topics/units:", remainingTopics.length);
for (const t of remainingTopics) {
  console.log({
    id: String(t._id),
    syllabusId: String(t.syllabusId),
    unitNo: t.unitNo,
    title: t.title,
  });
}
console.log("Remaining sub-units:", remainingSubs.length);
for (const s of remainingSubs) {
  console.log({
    id: String(s._id),
    syllabusId: String(s.syllabusId),
    heading: s.heading,
    subUnitNo: s.subUnitNo,
  });
}
console.log("Remaining legacy units:", remainingLegacy.length);
for (const u of remainingLegacy) {
  console.log({
    id: String(u._id),
    syllabusId: String(u.syllabusId),
    unitNo: u.unitNo,
    chapterName: u.chapterName,
    topicsCovered: (u.topicsCovered || "").slice(0, 80),
  });
}

// Session plans - any
const allSessionPlans = await db
  .collection("academicsessionplans")
  .find({})
  .project({ _id: 1, subjectId: 1, academicYearBs: 1, title: 1 })
  .toArray();
console.log("\nAll session plans:", allSessionPlans.length);
for (const sp of allSessionPlans) {
  const units = await db
    .collection("academicsessionplanunits")
    .find({ sessionPlanId: sp._id })
    .project({ title: 1, unitNo: 1, topics: 1, syllabusUnitId: 1 })
    .toArray();
  const subj =
    allSubjects.find((x) => String(x._id) === String(sp.subjectId)) ||
    masterSubjects.find((x) => String(x._id) === String(sp.subjectId));
  console.log({
    id: String(sp._id),
    subject: subj?.name || String(sp.subjectId),
    year: sp.academicYearBs,
    unitCount: units.length,
    unitTitles: units.map((u) => u.title || u.unitNo).slice(0, 10),
  });
}

// Lesson plans
const lessonPlans = await db
  .collection("academiclessonplans")
  .find({})
  .project({ _id: 1, subjectId: 1, academicYearBs: 1 })
  .limit(20)
  .toArray();
console.log("\nLesson plans:", lessonPlans.length);

// Check Atlas continuous backup is not something we can access from here
console.log(
  "\nNOTE: Hierarchy delete is hard-delete. Audit logs do NOT store chapters/units.",
);
console.log(
  "Recovery requires MongoDB Atlas backup / PITR restore if available.",
);

await mongoose.disconnect();
