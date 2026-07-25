/**
 * QA: Academic Management — Syllabus draft/save/isolation
 *
 * Covers:
 *  1) Pure safety helpers (empty shell, content detection, counts)
 *  2) Zod create/update payload acceptance for partial drafts
 *  3) Mongo: save hierarchy scoped to one syllabusId
 *  4) Mongo: empty-shell update does NOT wipe existing hierarchy
 *  5) Mongo: multi-unit "Unit N" draft growth still saves
 *  6) Mongo: saving subject A never deletes subject B hierarchy
 *  7) HTTP API: list/get/create/update draft + empty-shell guard (if server up)
 *
 * Safe: creates temporary QA_* syllabi and soft-deletes + hard-cleans hierarchy after.
 *
 * Run: npx tsx src/scripts/qaSyllabusAcademicManagement.ts
 */
import mongoose from "mongoose";
import { academicSyllabusSchema, academicSyllabusUpdateSchema } from "@phit-erp/shared";
import { connectDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusChapter } from "../models/AcademicSyllabusChapter.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusUnit } from "../models/AcademicSyllabusUnit.js";
import { School } from "../models/School.js";
import { Subject } from "../models/Subject.js";
import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import {
  chaptersHaveRealContent,
  countAllSubsInChapters,
  countUnitsInChapters,
  deleteSyllabusHierarchy,
  isEmptyHierarchyShell,
  loadSyllabusHierarchy,
  saveSyllabusHierarchy
} from "../utils/syllabusHierarchyService.js";

type Check = { name: string; ok: boolean; detail?: string };

const results: Check[] = [];
const createdSyllabusIds: string[] = [];

const pass = (name: string, detail?: string) => {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name: string, detail?: string) => {
  results.push({ name, ok: false, detail });
  console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
};
const assert = (name: string, condition: boolean, detail?: string) => {
  if (condition) pass(name, detail);
  else fail(name, detail);
};

const unit = (
  title: string,
  opts?: { description?: string; subHeadings?: string[] }
) => ({
  unitNo: 1,
  title,
  description: opts?.description ?? "",
  teachingHours: 1,
  learningObjective: "",
  references: "",
  remarks: "",
  practicalRequired: false,
  subUnits: (opts?.subHeadings ?? []).map((heading, i) => ({
    subUnitNo: i + 1,
    heading,
    description: "",
    learningOutcomes: "",
    internalAssessment: "",
    practicalRequired: false,
    labName: "",
    requiredEquipment: "",
    hospitalPosting: "",
    clinicalHours: 0,
    teachingHours: 1,
    attachments: [],
    remarks: "",
    status: "NOT_STARTED" as const,
    teachingNotes: "",
    teacherAttachments: [],
    todaysCoverage: "",
    children: []
  }))
});

const chapter = (
  units: ReturnType<typeof unit>[],
  title = ""
) => ({
  chapterNo: 1,
  sectionKind: (title ? "CHAPTER" : "NONE") as "CHAPTER" | "NONE",
  title,
  description: "",
  estimatedHours: 0,
  weightagePercent: 0,
  references: "",
  remarks: "",
  tentativeCompletionMonth: "",
  units: units.map((u, i) => ({ ...u, unitNo: i + 1 }))
});

const richTree = () => [
  chapter(
    [
      unit("Mechanics", { subHeadings: ["Kinematics", "Dynamics"] }),
      unit("Waves", { subHeadings: ["Sound", "Light"] }),
      unit("Thermodynamics", { description: "Heat and energy" })
    ],
    "Physics Part 1"
  )
];

const emptyShell = () => [chapter([unit("Unit 1")])];
const multiUnitDraft = () => [
  chapter([unit("Unit 1"), unit("Unit 2"), unit("Unit 3")])
];

// ─── Part 1: pure helpers ───────────────────────────────────────────────────
const runPureHelperQa = () => {
  console.log("\n═══ 1) Pure safety helpers ═══");

  assert("empty chapters → empty shell", isEmptyHierarchyShell([]) === true);
  assert("null chapters → empty shell", isEmptyHierarchyShell(null) === true);
  assert(
    "single Unit 1 placeholder → empty shell",
    isEmptyHierarchyShell(emptyShell()) === true
  );
  assert(
    "single blank title unit → empty shell",
    isEmptyHierarchyShell([chapter([unit("")])]) === true
  );
  assert(
    "multi Unit N draft → NOT empty shell",
    isEmptyHierarchyShell(multiUnitDraft()) === false,
    "allows partial draft growth"
  );
  assert(
    "rich tree → NOT empty shell",
    isEmptyHierarchyShell(richTree()) === false
  );
  assert(
    "single real title → NOT empty shell",
    isEmptyHierarchyShell([chapter([unit("Introduction")])]) === false
  );
  assert(
    "single Unit 1 with sub-units → NOT empty shell",
    isEmptyHierarchyShell([
      chapter([unit("Unit 1", { subHeadings: ["Topic A"] })])
    ]) === false
  );

  assert(
    "chaptersHaveRealContent(rich) true",
    chaptersHaveRealContent(richTree()) === true
  );
  assert(
    "chaptersHaveRealContent(Unit N only) false",
    chaptersHaveRealContent(multiUnitDraft()) === false
  );
  assert(
    "countUnits rich = 3",
    countUnitsInChapters(richTree()) === 3
  );
  assert(
    "countSubs rich = 4",
    countAllSubsInChapters(richTree()) === 4
  );
};

// ─── Part 2: Zod schemas ────────────────────────────────────────────────────
const runZodQa = () => {
  console.log("\n═══ 2) Zod draft payload validation ═══");

  const base = {
    academicYearBs: "2083/2084",
    session: "2083/2084",
    subjectId: new mongoose.Types.ObjectId().toString(),
    yearId: new mongoose.Types.ObjectId().toString(),
    teacherId: "",
    totalTheoryHours: 0,
    totalPracticalHours: 0,
    creditHours: 0,
    remarks: "",
    chapters: multiUnitDraft()
  };

  const createParsed = academicSyllabusSchema.safeParse(base);
  assert(
    "create schema accepts multi-unit Unit N draft",
    createParsed.success,
    createParsed.success ? undefined : JSON.stringify(createParsed.error.issues.slice(0, 3))
  );

  const blankTitle = academicSyllabusSchema.safeParse({
    ...base,
    chapters: [chapter([unit(""), unit("")])]
  });
  assert(
    "create schema accepts blank unit titles",
    blankTitle.success,
    blankTitle.success ? undefined : JSON.stringify(blankTitle.error.issues.slice(0, 3))
  );

  const withSubs = academicSyllabusSchema.safeParse({
    ...base,
    chapters: richTree()
  });
  assert(
    "create schema accepts nested sub-units",
    withSubs.success
  );

  const partialUpdate = academicSyllabusUpdateSchema.safeParse({
    remarks: "QA partial",
    chapters: emptyShell()
  });
  assert(
    "update schema accepts empty shell chapters field",
    partialUpdate.success
  );

  const emptySession = academicSyllabusSchema.safeParse({
    ...base,
    session: ""
  });
  assert(
    "create schema fills session from academicYearBs",
    emptySession.success &&
      (emptySession.success
        ? (emptySession.data as { session: string }).session === "2083/2084"
        : false)
  );
};

// ─── Part 3–6: Mongo isolation ──────────────────────────────────────────────
const countHierarchy = async (syllabusId: string) => {
  const [chapters, topics, subs, legacy] = await Promise.all([
    AcademicSyllabusChapter.countDocuments({ syllabusId }),
    AcademicSyllabusTopic.countDocuments({ syllabusId }),
    AcademicSyllabusSubUnit.countDocuments({ syllabusId }),
    AcademicSyllabusUnit.countDocuments({ syllabusId })
  ]);
  return { chapters, topics, subs, legacy };
};

const runMongoQa = async () => {
  console.log("\n═══ 3–6) Mongo hierarchy isolation & draft save ═══");

  const school = await School.findOne({ code: "DEMOERP", isActive: true }).lean();
  if (!school) {
    fail("find DEMOERP school", "School not found — skip Mongo QA");
    return;
  }
  pass("find DEMOERP school", school._id.toString());

  const schoolId = school._id.toString();
  const subjects = await Subject.find({ schoolId: school._id, isActive: { $ne: false } })
    .limit(5)
    .lean();
  if (subjects.length < 2) {
    fail("need ≥2 subjects", `found ${subjects.length}`);
    return;
  }
  pass("have ≥2 subjects for isolation", subjects.map((s) => s.name).join(", "));

  const year = await Year.findOne({ schoolId: school._id }).lean();
  const admin = await User.findOne({
    schoolId: school._id,
    role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] }
  }).lean();
  const actorId = admin?._id ?? new mongoose.Types.ObjectId();

  const subjectA = subjects[0]!;
  const subjectB = subjects[1]!;
  const academicYearBs = school.academicYearBs || "2083/2084";
  const tag = `QA_SYL_${Date.now()}`;

  // Soft-delete any leftover QA drafts for these subjects (same unique index key)
  await AcademicSyllabus.updateMany(
    {
      schoolId: school._id,
      subjectId: { $in: [subjectA._id, subjectB._id] },
      remarks: { $regex: /^QA_SYL_/ },
      isDeleted: false
    },
    {
      $set: {
        isDeleted: true,
        "audit.deletedAt": new Date(),
        "audit.deletedBy": actorId
      }
    }
  );

  const makeSyllabus = async (subjectId: mongoose.Types.ObjectId, label: string) => {
    const [doc] = await AcademicSyllabus.create([
      {
        schoolId: school._id,
        academicYearBs,
        session: academicYearBs,
        subjectId,
        yearId: year?._id,
        subjectCode: label.slice(0, 20),
        remarks: `${tag}_${label}`,
        status: "DRAFT",
        hierarchyMigratedAt: new Date(),
        audit: { createdBy: actorId }
      }
    ]);
    if (!doc) throw new Error("create failed");
    createdSyllabusIds.push(doc._id.toString());
    return doc;
  };

  const sylA = await makeSyllabus(subjectA._id, "A");
  const sylB = await makeSyllabus(subjectB._id, "B");
  pass("create temporary draft syllabi A & B", `${sylA._id} / ${sylB._id}`);

  // Seed rich hierarchy on both
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: richTree() as never
  });
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylB._id.toString(),
    chapters: richTree() as never
  });

  const a0 = await countHierarchy(sylA._id.toString());
  const b0 = await countHierarchy(sylB._id.toString());
  assert(
    "A seeded with units + subs",
    a0.topics >= 3 && a0.subs >= 4,
    JSON.stringify(a0)
  );
  assert(
    "B seeded with units + subs",
    b0.topics >= 3 && b0.subs >= 4,
    JSON.stringify(b0)
  );

  // 4) Empty shell rewrite on A must NOT wipe A
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: emptyShell() as never
  });
  const aAfterEmpty = await countHierarchy(sylA._id.toString());
  assert(
    "empty-shell save does NOT wipe A hierarchy",
    aAfterEmpty.topics === a0.topics && aAfterEmpty.subs === a0.subs,
    `before=${JSON.stringify(a0)} after=${JSON.stringify(aAfterEmpty)}`
  );

  // 5) Multi-unit Unit N draft growth on A (should rewrite with 3 units)
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: multiUnitDraft() as never
  });
  const aAfterDraft = await countHierarchy(sylA._id.toString());
  assert(
    "multi-unit Unit N draft still saves (growth path)",
    aAfterDraft.topics === 3,
    JSON.stringify(aAfterDraft)
  );

  // Re-seed A rich, then empty-shell again, check B untouched
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: richTree() as never
  });
  const bBefore = await countHierarchy(sylB._id.toString());
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: emptyShell() as never
  });
  const bAfter = await countHierarchy(sylB._id.toString());
  assert(
    "saving empty shell on A never touches B",
    bAfter.topics === bBefore.topics &&
      bAfter.subs === bBefore.subs &&
      bAfter.chapters === bBefore.chapters,
    `B before=${JSON.stringify(bBefore)} after=${JSON.stringify(bAfter)}`
  );

  // Rewrite A with real content — B still intact
  await saveSyllabusHierarchy({
    schoolId,
    syllabusId: sylA._id.toString(),
    chapters: [
      chapter(
        [unit("Optics", { subHeadings: ["Reflection", "Refraction"] })],
        "Optics"
      )
    ] as never
  });
  const aRich2 = await countHierarchy(sylA._id.toString());
  const bFinal = await countHierarchy(sylB._id.toString());
  assert(
    "legitimate rewrite on A works",
    aRich2.topics === 1 && aRich2.subs === 2,
    JSON.stringify(aRich2)
  );
  assert(
    "B still intact after legitimate A rewrite",
    bFinal.topics === b0.topics && bFinal.subs === b0.subs,
    JSON.stringify(bFinal)
  );

  // Invalid syllabusId refused
  let invalidThrew = false;
  try {
    await deleteSyllabusHierarchy("");
  } catch {
    invalidThrew = true;
  }
  assert("deleteSyllabusHierarchy rejects empty id", invalidThrew);

  let invalidSaveThrew = false;
  try {
    await saveSyllabusHierarchy({
      schoolId,
      syllabusId: "not-an-id",
      chapters: richTree() as never
    });
  } catch {
    invalidSaveThrew = true;
  }
  assert("saveSyllabusHierarchy rejects invalid id", invalidSaveThrew);

  // load hierarchy shape
  const loaded = await loadSyllabusHierarchy(sylB._id.toString());
  assert(
    "loadSyllabusHierarchy returns chapters with units",
    loaded.length > 0 && (loaded[0]?.units?.length ?? 0) >= 3,
    `chapters=${loaded.length} units=${loaded[0]?.units?.length}`
  );
};

// ─── Part 7: HTTP API ───────────────────────────────────────────────────────
const runHttpQa = async () => {
  console.log("\n═══ 7) HTTP API draft save / empty-shell guard ═══");

  const base = `http://127.0.0.1:${env.PORT || 5000}/api`;
  const cookieJar: string[] = [];

  const mergeCookies = (res: Response) => {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const pair = c.split(";")[0];
      if (!pair) continue;
      const name = pair.split("=")[0];
      const idx = cookieJar.findIndex((x) => x.startsWith(`${name}=`));
      if (idx >= 0) cookieJar[idx] = pair;
      else cookieJar.push(pair);
    }
  };

  const api = async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookieJar.length ? { Cookie: cookieJar.join("; ") } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    mergeCookies(res);
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  };

  let healthOk = false;
  try {
    const health = await api("GET", "/health");
    healthOk = health.status === 200;
  } catch {
    healthOk = false;
  }
  if (!healthOk) {
    fail("API health", "backend not reachable — skip HTTP QA");
    return;
  }
  pass("API health OK");

  const login = await api("POST", "/auth/login", {
    email: env.SUPER_ADMIN_EMAIL || "superadmin@nepal-school.com",
    password: env.SUPER_ADMIN_PASSWORD || "Admin@123456"
  });
  assert("login superadmin", login.status === 200 || login.status === 201, `status=${login.status}`);

  const school = await School.findOne({ code: "DEMOERP" }).lean();
  if (!school) {
    fail("HTTP school context", "DEMOERP missing");
    return;
  }
  const switchSchool = await api("POST", "/auth/active-school", {
    schoolId: school._id.toString()
  });
  assert(
    "switch active school",
    switchSchool.status === 200 || switchSchool.status === 201,
    `status=${switchSchool.status}`
  );

  const subjectsRes = await api("GET", "/academics/subjects");
  const subjectList = Array.isArray(subjectsRes.json.data)
    ? (subjectsRes.json.data as Array<{ _id: string; name: string }>)
    : [];
  // fallback list from DB if route path differs
  let subjectIds = subjectList.map((s) => s._id);
  if (subjectIds.length < 2) {
    const dbSubjects = await Subject.find({ schoolId: school._id }).limit(3).lean();
    subjectIds = dbSubjects.map((s) => s._id.toString());
  }
  assert("subjects available for API create", subjectIds.length >= 1, `n=${subjectIds.length}`);

  const year = await Year.findOne({ schoolId: school._id }).lean();
  const academicYearBs = school.academicYearBs || "2083/2084";
  const tag = `QA_HTTP_${Date.now()}`;

  // Clean leftover HTTP QA drafts on subject 0
  if (subjectIds[0]) {
    await AcademicSyllabus.updateMany(
      {
        schoolId: school._id,
        subjectId: subjectIds[0],
        remarks: { $regex: /^QA_HTTP_/ },
        isDeleted: false
      },
      { $set: { isDeleted: true, "audit.deletedAt": new Date() } }
    );
  }

  const createPayload = {
    academicYearBs,
    session: academicYearBs,
    subjectId: subjectIds[0],
    yearId: year?._id?.toString(),
    remarks: tag,
    chapters: richTree()
  };

  const created = await api("POST", "/academic-management/syllabi", createPayload);
  const createdData = created.json.data as
    | { _id?: string; chapters?: unknown[]; status?: string }
    | undefined;
  assert(
    "POST create syllabus draft with rich tree",
    created.status === 201 || created.status === 200,
    `status=${created.status} msg=${String(created.json.message ?? "")}`
  );

  const sylId = createdData?._id;
  if (!sylId) {
    fail("created syllabus id", "missing — cannot continue HTTP update tests");
    return;
  }
  createdSyllabusIds.push(sylId);
  pass("created syllabus id", sylId);

  const getOne = await api("GET", `/academic-management/syllabi/${sylId}`);
  const getData = getOne.json.data as {
    chapters?: Array<{ units?: unknown[] }>;
  };
  const getUnits =
    getData?.chapters?.reduce((n, ch) => n + (ch.units?.length ?? 0), 0) ?? 0;
  assert(
    "GET full syllabus returns hierarchy",
    getOne.status === 200 && getUnits >= 3,
    `status=${getOne.status} units=${getUnits}`
  );

  // Empty shell update should NOT wipe
  const emptyUpdate = await api("PUT", `/academic-management/syllabi/${sylId}`, {
    academicYearBs,
    session: academicYearBs,
    subjectId: subjectIds[0],
    remarks: `${tag}_empty_try`,
    chapters: emptyShell()
  });
  assert(
    "PUT empty shell accepted (no hard fail)",
    emptyUpdate.status === 200,
    `status=${emptyUpdate.status} msg=${String(emptyUpdate.json.message ?? "")}`
  );

  const afterEmpty = await countHierarchy(sylId);
  assert(
    "PUT empty shell did not wipe hierarchy",
    afterEmpty.topics >= 3 && afterEmpty.subs >= 4,
    JSON.stringify(afterEmpty)
  );

  // Multi-unit draft growth
  const draftUpdate = await api("PUT", `/academic-management/syllabi/${sylId}`, {
    academicYearBs,
    session: academicYearBs,
    subjectId: subjectIds[0],
    remarks: `${tag}_draft_grow`,
    chapters: multiUnitDraft()
  });
  assert(
    "PUT multi-unit Unit N draft succeeds",
    draftUpdate.status === 200,
    `status=${draftUpdate.status} msg=${String(draftUpdate.json.message ?? "")}`
  );
  const afterDraft = await countHierarchy(sylId);
  assert(
    "PUT multi-unit draft persisted 3 units (0 subs)",
    afterDraft.topics === 3 && afterDraft.subs === 0,
    JSON.stringify(afterDraft)
  );

  // List includes our draft
  const list = await api(
    "GET",
    `/academic-management/syllabi?academicYearBs=${encodeURIComponent(academicYearBs)}`
  );
  const listData = Array.isArray(list.json.data)
    ? (list.json.data as Array<{ _id: string }>)
    : [];
  assert(
    "GET list includes QA syllabus",
    list.status === 200 && listData.some((r) => r._id === sylId),
    `list size=${listData.length}`
  );
};

const cleanup = async () => {
  console.log("\n═══ Cleanup temporary QA syllabi ═══");
  for (const id of createdSyllabusIds) {
    try {
      await deleteSyllabusHierarchy(id);
      await AcademicSyllabusUnit.deleteMany({ syllabusId: id });
      await AcademicSyllabus.updateOne(
        { _id: id },
        {
          $set: {
            isDeleted: true,
            "audit.deletedAt": new Date(),
            remarks: "QA cleaned"
          }
        }
      );
      console.log(`  cleaned ${id}`);
    } catch (e) {
      console.warn(`  cleanup failed for ${id}:`, (e as Error).message);
    }
  }
};

const main = async () => {
  console.log("Syllabus Academic Management QA");
  console.log(`Mongo: ${env.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@")}`);

  runPureHelperQa();
  runZodQa();

  await connectDatabase();
  try {
    await runMongoQa();
    await runHttpQa();
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n══════════════════════════════════════");
  console.log(`QA RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("══════════════════════════════════════");
  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail ?? ""}`);
    }
    process.exit(1);
  }
  process.exit(0);
};

main().catch((err) => {
  console.error("QA crashed:", err);
  process.exit(1);
});
