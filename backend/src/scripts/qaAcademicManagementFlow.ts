/**
 * QA: Academic Management full flow (API)
 *
 * Covers:
 *  1) Health + login + school context
 *  2) List syllabi / session plans / lesson plans / log book
 *  3) Session plan units date windows
 *  4) Lesson plan create (daily) within unit window
 *  5) Lesson plan create OUTSIDE unit window → 400
 *  6) Lesson plan update draft (empty ObjectId fields must not 400)
 *  7) Lesson plan same unit on second day (daily spread)
 *  8) Log book create from lesson plan item
 *  9) Same sub-unit logged on two dates counts as completed ONCE
 * 10) Deleting a log entry rolls the syllabus back
 * 11) Soft cleanup of QA-created lesson plans
 *
 * Run: npx tsx src/scripts/qaAcademicManagementFlow.ts
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { School } from "../models/School.js";

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];

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

const base = `http://127.0.0.1:${env.PORT || 5000}/api`;
const cookieJar: string[] = [];

const mergeCookies = (res: Response) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const pair = c.split(";")[0];
    if (!pair) continue;
    const name = pair.split("=")[0];
    const idx = cookieJar.findIndex((x) => x.startsWith(`${name}=`));
    if (idx >= 0) cookieJar[idx] = pair!;
    else cookieJar.push(pair);
  }
};

const api = async (
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown>; message: string }> => {
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
  const message = typeof json.message === "string" ? json.message : "";
  return { status: res.status, json, message };
};

const midDate = (start: string, end: string): string => {
  // BS dates compare lexicographically when YYYY-MM-DD; pick start if valid
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) return end;
  return "2083-04-12";
};

const afterEnd = (end: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return "2099-12-30";
  const [y, m, d] = end.split("-").map(Number);
  // crude +1 day on day field (enough for window rejection when end is set)
  const next = `${y}-${String(m).padStart(2, "0")}-${String((d ?? 1) + 1).padStart(2, "0")}`;
  return next;
};

async function main() {
  console.log("\n═══ Academic Management Flow QA ═══\n");
  await connectDatabase();

  const createdLessonPlanIds: string[] = [];
  const createdLogEntryIds: string[] = [];

  try {
    // 1) Health + auth
    console.log("═══ 1) Auth & lists ═══");
    let healthOk = false;
    try {
      const h = await api("GET", "/health");
      healthOk = h.status === 200;
    } catch {
      healthOk = false;
    }
    assert("API health", healthOk, healthOk ? "ok" : "backend not reachable");
    if (!healthOk) return;

    const login = await api("POST", "/auth/login", {
      email: env.SUPER_ADMIN_EMAIL || "superadmin@nepal-school.com",
      password: env.SUPER_ADMIN_PASSWORD || "Admin@123456"
    });
    assert("login superadmin", login.status === 200 || login.status === 201, `status=${login.status}`);

    const school = await School.findOne({ code: "DEMOERP" }).lean();
    assert("DEMOERP school exists", Boolean(school));
    if (!school) return;

    const switchSchool = await api("POST", "/auth/active-school", {
      schoolId: school._id.toString()
    });
    assert(
      "switch active school",
      switchSchool.status === 200 || switchSchool.status === 201,
      `status=${switchSchool.status}`
    );

    const syllabi = await api("GET", "/academic-management/syllabi");
    assert("GET syllabi", syllabi.status === 200, `status=${syllabi.status}`);

    const sessionPlans = await api("GET", "/academic-management/session-plans");
    assert("GET session-plans", sessionPlans.status === 200, `status=${sessionPlans.status}`);

    const lessonPlans = await api("GET", "/academic-management/lesson-plans");
    assert("GET lesson-plans", lessonPlans.status === 200, `status=${lessonPlans.status}`);

    const logBooks = await api("GET", "/academic-management/log-book-entries");
    assert("GET log-book-entries", logBooks.status === 200, `status=${logBooks.status}`);

    // 2) Pick a session plan with units + dates
    console.log("\n═══ 2) Session plan units ═══");
    const spList = Array.isArray(sessionPlans.json.data)
      ? (sessionPlans.json.data as Array<Record<string, unknown>>)
      : [];
    assert("session plans present", spList.length > 0, `n=${spList.length}`);
    if (spList.length === 0) return;

    const sp = spList[0]!;
    const sessionPlanId = String(sp._id);
    const subjectId = String(sp.subjectId);
    const teacherId = String(sp.teacherId);
    const academicYearBs = String(sp.academicYearBs || "2083/2084");
    const units = Array.isArray(sp.units)
      ? (sp.units as Array<Record<string, unknown>>)
      : [];
    assert("session plan has units", units.length > 0, `units=${units.length}`);
    if (units.length === 0) return;

    const unit = units[0]!;
    const unitId = String(unit._id);
    const unitStart = String(unit.startDateBs || "").trim();
    const unitEnd = String(unit.endDateBs || "").trim();
    pass(
      "unit date window",
      `unitNo=${unit.unitNo} start=${unitStart || "—"} end=${unitEnd || "—"}`
    );

    // 3) Lesson plan create within window
    console.log("\n═══ 3) Lesson plan create / update / window ═══");
    const inWindow = midDate(unitStart, unitEnd);
    const day1 = inWindow;
    const day2Parts = day1.split("-").map(Number);
    const day2 = `${day2Parts[0]}-${String(day2Parts[1]).padStart(2, "0")}-${String(
      Math.min(28, (day2Parts[2] ?? 1) + 1)
    ).padStart(2, "0")}`;

    const itemPayload = (topic: string, subs: string[]) => ({
      serialNo: 1,
      sessionPlanUnitId: unitId,
      subUnitTitle: subs.join("; "),
      subUnitTitles: subs,
      syllabusId: "",
      syllabusChapterId: "",
      syllabusUnitId: "",
      syllabusSubUnitId: "",
      syllabusSubUnitIds: [] as string[],
      subjectLabel: `Unit ${unit.unitNo}`,
      plannedTopic: topic,
      description: "",
      learningObjectives: "",
      teachingMethod: "",
      teachingAids: "",
      assessmentMethod: "",
      deadline: "",
      itemStartDateBs: unitStart || "",
      itemEndDateBs: unitEnd || "",
      estimatedClasses: 1,
      remarks: "QA_AM_FLOW"
    });

    const createBody = {
      sessionPlanId,
      academicYearBs,
      session: academicYearBs,
      subjectId,
      teacherId,
      yearId: sp.yearId ? String(sp.yearId) : undefined,
      faculty: "",
      semesterBs: "",
      classId: "",
      sectionId: "",
      batchId: "",
      month: "",
      teachingDateBs: day1,
      startDateBs: day1,
      endDateBs: day1,
      monthlyDescription: "QA academic management flow",
      items: [itemPayload(`QA day1 ${Date.now()}`, ["QA sub A"])]
    };

    const created = await api("POST", "/academic-management/lesson-plans", createBody);
    const createdData = created.json.data as { _id?: string; items?: Array<{ _id?: string }> } | undefined;
    assert(
      "POST lesson-plan within unit window",
      created.status === 201 || created.status === 200,
      `status=${created.status} msg=${created.message}`
    );
    const lessonPlanId = createdData?._id;
    if (lessonPlanId) createdLessonPlanIds.push(lessonPlanId);
    const lessonItemId = createdData?.items?.[0]?._id;

    // Outside window (only if end date exists)
    if (unitEnd) {
      const outside = afterEnd(unitEnd);
      const outsideRes = await api("POST", "/academic-management/lesson-plans", {
        ...createBody,
        teachingDateBs: outside,
        startDateBs: outside,
        endDateBs: outside,
        items: [itemPayload("QA outside", ["QA outside"])]
      });
      assert(
        "POST lesson-plan outside unit window rejected",
        outsideRes.status === 400,
        `status=${outsideRes.status} msg=${outsideRes.message}`
      );
    } else {
      pass("POST outside window skipped", "unit has no endDateBs");
    }

    // Update draft with empty ObjectId fields (must not 400 Invalid identifier)
    if (lessonPlanId) {
      const updateRes = await api("PUT", `/academic-management/lesson-plans/${lessonPlanId}`, {
        ...createBody,
        monthlyDescription: "QA updated draft",
        items: [
          {
            ...itemPayload("QA updated topic", ["QA sub A", "QA sub B"]),
            syllabusSubUnitId: "",
            syllabusId: String(unit.syllabusId || ""),
            syllabusChapterId: String(unit.syllabusChapterId || ""),
            syllabusUnitId: String(unit.syllabusUnitId || "")
          }
        ]
      });
      assert(
        "PUT lesson-plan draft with empty ObjectIds",
        updateRes.status === 200,
        `status=${updateRes.status} msg=${updateRes.message}`
      );
    } else {
      fail("PUT lesson-plan draft", "no lessonPlanId from create");
    }

    // Same unit on second day (daily spread — was blocked by month uniqueness before)
    const create2 = await api("POST", "/academic-management/lesson-plans", {
      ...createBody,
      teachingDateBs: day2,
      startDateBs: day2,
      endDateBs: day2,
      items: [itemPayload(`QA day2 ${Date.now()}`, ["QA sub C"])]
    });
    const create2Data = create2.json.data as { _id?: string } | undefined;
    if (create2Data?._id) createdLessonPlanIds.push(create2Data._id);
    assert(
      "POST same unit on second teaching day allowed",
      create2.status === 201 || create2.status === 200,
      `status=${create2.status} msg=${create2.message}`
    );

    // 4) Log book from lesson plan item
    console.log("\n═══ 4) Log book from lesson plan ═══");
    if (lessonItemId && lessonPlanId) {
      const logRes = await api("POST", "/academic-management/log-book-entries", {
        lessonPlanId,
        lessonPlanItemId: lessonItemId,
        sessionPlanUnitId: unitId,
        academicYearBs,
        session: academicYearBs,
        subjectId,
        teacherId,
        dateBs: day1,
        unit: `Unit ${unit.unitNo}`,
        topicCovered: "QA log topic",
        objectives: "QA objectives",
        teachingMethod: "Lecture",
        theoryPractical: "THEORY",
        periodNumber: 1,
        subUnitTitle: "QA sub A",
        subUnitTitles: ["QA sub A"],
        syllabusSubUnitIds: [],
        homeworkGiven: "",
        assignment: "",
        feedback: "",
        difficultiesFaced: "",
        nextClassPlan: ""
      });
      const logData = logRes.json.data as { _id?: string } | undefined;
      if (logData?._id) createdLogEntryIds.push(logData._id);
      assert(
        "POST log-book entry linked to lesson plan item",
        logRes.status === 201 || logRes.status === 200,
        `status=${logRes.status} msg=${logRes.message}`
      );
    } else {
      fail("POST log-book entry", "missing lesson item id");
    }

    // 4b) Sub-unit dedupe: the same sub-unit taught on two dates counts once
    console.log("\n═══ 4b) Log book sub-unit dedupe ═══");
    const syllabusUnitId = String(unit.syllabusUnitId || "");
    const syllabusId = String(unit.syllabusId || "");
    if (!syllabusUnitId || !syllabusId) {
      pass("dedupe check skipped", "session plan unit has no syllabus link");
    } else {
      const allLeaves = await AcademicSyllabusSubUnit.find({ syllabusId })
        .select("_id heading unitId parentSubUnitId status")
        .lean();
      const parentIds = new Set(
        allLeaves
          .map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : ""))
          .filter(Boolean)
      );
      const leaves = allLeaves.filter((row) => !parentIds.has(String(row._id)));
      const doneCount = () =>
        AcademicSyllabusSubUnit.find({ syllabusId })
          .select("_id heading parentSubUnitId status")
          .lean()
          .then((rows) => {
            const parents = new Set(
              rows
                .map((r) => (r.parentSubUnitId ? String(r.parentSubUnitId) : ""))
                .filter(Boolean)
            );
            return rows.filter(
              (r) =>
                !parents.has(String(r._id)) &&
                (r.status === "COMPLETED" || r.status === "SKIPPED")
            ).length;
          });

      // Two untaught leaves in this unit with distinct, non-empty headings
      const seen = new Set<string>();
      const spare = leaves.filter((row) => {
        if (String(row.unitId) !== syllabusUnitId) return false;
        if (row.status === "COMPLETED" || row.status === "SKIPPED") return false;
        const h = String(row.heading || "").trim().toLowerCase();
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      });

      if (spare.length < 2) {
        pass("dedupe check skipped", `untaught leaves=${spare.length} (need 2)`);
      } else {
        const first = String(spare[0]!.heading).trim();
        const second = String(spare[1]!.heading).trim();
        const before = await doneCount();

        const logBody = (dateBs: string, titles: string[], periodNumber: number) => ({
          sessionPlanUnitId: unitId,
          academicYearBs,
          session: academicYearBs,
          subjectId,
          teacherId,
          dateBs,
          unit: `Unit ${unit.unitNo}`,
          syllabusId,
          syllabusUnitId,
          topicCovered: "QA dedupe",
          objectives: "",
          teachingMethod: "",
          theoryPractical: "THEORY",
          periodNumber,
          subUnitTitle: titles.join("; "),
          subUnitTitles: titles,
          syllabusSubUnitIds: [] as string[],
          homeworkGiven: "",
          assignment: "",
          feedback: "",
          difficultiesFaced: "",
          nextClassPlan: ""
        });

        // Day 1 teaches BOTH sub-units
        const dayA = await api(
          "POST",
          "/academic-management/log-book-entries",
          logBody(day1, [first, second], 7)
        );
        const dayAId = (dayA.json.data as { _id?: string } | undefined)?._id;
        if (dayAId) createdLogEntryIds.push(dayAId);
        assert(
          "log entry day 1 (two sub-units)",
          dayA.status === 201 || dayA.status === 200,
          `status=${dayA.status} msg=${dayA.message}`
        );
        const afterA = await doneCount();
        assert(
          "two sub-units taught → +2 completed",
          afterA === before + 2,
          `before=${before} after=${afterA}`
        );

        // Day 2 re-teaches ONLY the second sub-unit — must not count again
        const dayB = await api(
          "POST",
          "/academic-management/log-book-entries",
          logBody(day2, [second], 8)
        );
        const dayBId = (dayB.json.data as { _id?: string } | undefined)?._id;
        if (dayBId) createdLogEntryIds.push(dayBId);
        assert(
          "log entry day 2 (repeat sub-unit)",
          dayB.status === 201 || dayB.status === 200,
          `status=${dayB.status} msg=${dayB.message}`
        );
        const afterB = await doneCount();
        assert(
          "repeat of same sub-unit counts ONCE",
          afterB === before + 2,
          `expected=${before + 2} got=${afterB} distinctTaught=2`
        );

        // Removing the repeat must not un-complete a sub-unit day 1 also covered
        if (dayBId) {
          const delB = await api(
            "DELETE",
            `/academic-management/log-book-entries/${dayBId}`
          );
          assert("delete repeat entry", delB.status === 200, `status=${delB.status}`);
          const afterDelB = await doneCount();
          assert(
            "sub-unit stays completed while day 1 still covers it",
            afterDelB === before + 2,
            `expected=${before + 2} got=${afterDelB}`
          );
        }

        // Removing the last entry that covered them rolls both back
        if (dayAId) {
          const delA = await api(
            "DELETE",
            `/academic-management/log-book-entries/${dayAId}`
          );
          assert("delete day 1 entry", delA.status === 200, `status=${delA.status}`);
          const afterDelA = await doneCount();
          assert(
            "deleting the log rolls the syllabus back",
            afterDelA === before,
            `expected=${before} got=${afterDelA}`
          );
        }
      }
    }

    // 5) DB consistency
    console.log("\n═══ 5) DB consistency ═══");
    if (lessonPlanId) {
      const plan = await AcademicLessonPlan.findById(lessonPlanId).lean();
      assert("lesson plan stored as DRAFT", plan?.status === "DRAFT", `status=${plan?.status}`);
      assert(
        "teachingDateBs persisted",
        (plan as { teachingDateBs?: string } | null)?.teachingDateBs === day1,
        `date=${(plan as { teachingDateBs?: string } | null)?.teachingDateBs}`
      );
      const items = await AcademicLessonPlanItem.find({ lessonPlanId }).lean();
      assert("lesson plan items count >= 1", items.length >= 1, `n=${items.length}`);
      const first = items[0] as { subUnitTitles?: string[]; plannedTopic?: string } | undefined;
      assert(
        "subUnitTitles multi-select stored",
        Array.isArray(first?.subUnitTitles) && (first?.subUnitTitles?.length ?? 0) >= 1,
        `subs=${JSON.stringify(first?.subUnitTitles)}`
      );
    }

    // session plan still present
    const spDb = await AcademicSessionPlan.findById(sessionPlanId).lean();
    assert("session plan still exists", Boolean(spDb));
    const unitDb = await AcademicSessionPlanUnit.findById(unitId).lean();
    assert("session plan unit still exists", Boolean(unitDb));
  } finally {
    // Soft cleanup QA lesson plans / log entries created this run
    console.log("\n═══ Cleanup ═══");
    for (const id of createdLogEntryIds) {
      await AcademicLogBookEntry.updateOne(
        { _id: id },
        { $set: { isDeleted: true, "audit.deletedAt": new Date() } }
      ).catch(() => undefined);
    }
    for (const id of createdLessonPlanIds) {
      await AcademicLessonPlan.updateOne(
        { _id: id },
        { $set: { isDeleted: true, "audit.deletedAt": new Date() } }
      ).catch(() => undefined);
    }
    pass(
      "cleanup QA records",
      `lessonPlans=${createdLessonPlanIds.length} logEntries=${createdLogEntryIds.length}`
    );
    await disconnectDatabase().catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n═══ Summary ═══");
  console.log(`  Total: ${results.length}  Pass: ${results.length - failed.length}  Fail: ${failed.length}`);
  if (failed.length) {
    console.error("\nFailed checks:");
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail ?? ""}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll Academic Management flow checks passed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
