/**
 * QA: every teacher with subject assignments can enter exam marks.
 * Usage: node scripts/qaTeacherMarkEntry.mjs
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
const DEMO = "Demo@123456";

const TEACHERS = [
  { label: "ram", email: "ram.sharma@demoerp.nepal-school.com", password: DEMO },
  { label: "sita", email: "sita.gurung@demoerp.nepal-school.com", password: DEMO },
  { label: "hari", email: "hari.thapa@demoerp.nepal-school.com", password: DEMO },
  { label: "gita", email: "gita.rai@demoerp.nepal-school.com", password: DEMO },
];

function makeJar() {
  const jar = new Map();
  return {
    store(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const pair = c.split(";")[0];
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    clear() {
      jar.clear();
    },
  };
}

async function req(jar, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar.store(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, path, method };
}

const idOf = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && v._id != null) return String(v._id);
  return String(v);
};

/** Mirror frontend mark-entry filters */
function markEntryCohorts(scopeData) {
  const students = scopeData.students || [];
  const batches = scopeData.batches || [];
  const years = scopeData.years || [];
  const subjects = scopeData.subjects || [];
  const assignments = scopeData.scope?.assignments || [];

  const batchIdsWithStudents = new Set(
    students.map((s) => idOf(s.batchId)).filter(Boolean),
  );
  const markBatches =
    batchIdsWithStudents.size > 0
      ? batches.filter((b) => batchIdsWithStudents.has(idOf(b._id)))
      : batches;
  const finalBatches = markBatches.length > 0 ? markBatches : batches;

  const cohorts = [];
  for (const batch of finalBatches) {
    const bid = idOf(batch._id);
    const yearsForBatch = years.filter((y) => idOf(y.batchId) === bid);
    const yearIdsWithStudents = new Set(
      students
        .filter((s) => idOf(s.batchId) === bid)
        .map((s) => idOf(s.yearId))
        .filter(Boolean),
    );
    const yearsOut =
      yearIdsWithStudents.size > 0
        ? yearsForBatch.filter((y) => yearIdsWithStudents.has(idOf(y._id)))
        : yearsForBatch;
    const finalYears = yearsOut.length > 0 ? yearsOut : yearsForBatch;

    for (const year of finalYears) {
      const yid = idOf(year._id);
      const studs = students.filter(
        (s) => idOf(s.batchId) === bid && idOf(s.yearId) === yid,
      );
      // Match Enter Marks UI: only subjects assigned to this batch/year
      const pairIds = new Set(
        assignments
          .filter((a) => idOf(a.batchId) === bid && idOf(a.yearId) === yid)
          .map((a) => idOf(a.subjectId))
          .filter(Boolean),
      );
      let subjs =
        pairIds.size > 0
          ? subjects.filter((sub) => pairIds.has(idOf(sub._id)))
          : subjects.filter((sub) =>
              (sub.yearIds || []).map(idOf).includes(yid),
            );
      if (subjs.length === 0) subjs = subjects;

      const assignPair = assignments.find(
        (a) => idOf(a.batchId) === bid && idOf(a.yearId) === yid,
      );

      cohorts.push({
        batchId: bid,
        batchName: batch.name,
        yearId: yid,
        yearName: year.name,
        students: studs,
        subjects: subjs,
        assignment: assignPair || null,
      });
    }
  }
  return cohorts;
}

const findings = [];
const summary = { teachers: 0, withAssignments: 0, markOk: 0, markFail: 0, skip: 0, warn: 0 };

async function probeTeacher(account) {
  const jar = makeJar();
  summary.teachers++;

  const login = await req(jar, "POST", "/auth/login", {
    email: account.email,
    password: account.password,
  });
  if (login.status !== 200) {
    findings.push({
      label: account.label,
      kind: "FAIL-LOGIN",
      msg: login.json?.message || String(login.status),
    });
    summary.markFail++;
    console.log(`\n=== ${account.label} LOGIN FAIL ${login.status} ===`);
    return;
  }

  const scopeRes = await req(jar, "GET", "/teacher/scope");
  if (scopeRes.status !== 200) {
    findings.push({
      label: account.label,
      kind: "FAIL-SCOPE",
      msg: scopeRes.json?.message || String(scopeRes.status),
    });
    summary.markFail++;
    console.log(`\n=== ${account.label} SCOPE FAIL ${scopeRes.status} ===`);
    return;
  }

  const data = scopeRes.json?.data;
  const sc = data?.scope || {};
  const subjectIds = sc.subjectIds || [];
  const assignments = sc.assignments || [];
  const hasWork =
    subjectIds.length > 0 ||
    assignments.length > 0 ||
    (data?.subjects || []).length > 0;

  console.log(`\n=== ${account.label} ===`);
  console.log(
    `  source=${sc.scopeSource} subjects=${subjectIds.length} assignments=${assignments.length} rosterStudents=${(data?.students || []).length} batches=${(data?.batches || []).length} years=${(data?.years || []).length}`,
  );

  if (!hasWork) {
    console.log("  SKIP — no assigned subjects");
    summary.skip++;
    findings.push({
      label: account.label,
      kind: "SKIP-NO-ASSIGN",
      msg: "no subjects/assignments",
    });
    return;
  }
  summary.withAssignments++;

  // Paths used by Enter Marks UI
  for (const p of [
    "/exams",
    "/exams/results/all",
    "/exams/result-submissions",
    "/exams/routines",
  ]) {
    const r = await req(jar, "GET", p);
    if (r.status < 200 || r.status >= 300) {
      findings.push({
        label: account.label,
        kind: "FAIL-PATH",
        path: p,
        msg: `${r.status} ${r.json?.message || ""}`,
      });
      summary.markFail++;
      console.log(`  FAIL path ${p} ${r.status}`);
    }
  }

  const examsRes = await req(jar, "GET", "/exams");
  const exams = examsRes.json?.data || [];
  if (!exams.length) {
    findings.push({
      label: account.label,
      kind: "FAIL-NO-EXAMS",
      msg: "no exams available for mark entry",
    });
    summary.markFail++;
    console.log("  FAIL no exams");
    return;
  }

  const cohorts = markEntryCohorts(data);
  console.log(`  mark-entry cohorts: ${cohorts.length}`);
  for (const c of cohorts) {
    console.log(
      `    ${c.batchName} / ${c.yearName}: students=${c.students.length} subjects=${c.subjects.length} assign=${c.assignment ? "yes" : "no"}`,
    );
  }

  const viable = cohorts.filter(
    (c) => c.students.length > 0 && c.subjects.length > 0,
  );
  if (!viable.length) {
    findings.push({
      label: account.label,
      kind: "FAIL-NO-COHORT",
      msg: "no batch/year with both students and subjects (UI cannot enter marks)",
    });
    summary.markFail++;
    console.log("  FAIL no viable cohort for mark entry UI");
    return;
  }

  // Try mark entry on every viable cohort (first student + first subject)
  let anyOk = false;
  let anyFail = false;
  for (const cohort of viable) {
    const student = cohort.students[0];
    const subject = cohort.subjects[0];
    const exam = exams[0];
    const payload = {
      examId: exam._id,
      studentId: student._id,
      batchId: cohort.batchId,
      yearId: cohort.yearId,
      marks: [
        {
          subjectId: idOf(subject._id),
          fullMarks: 100,
          passMarks: 35,
          theoryMarks: 60,
          practicalMarks: 10,
          internalMarks: 5,
          attendanceStatus: "PRESENT",
          teacherRemarks: `qa-mark-${account.label}`,
        },
      ],
    };

    const mark = await req(jar, "POST", "/exams/results", payload);
    const msg = (mark.json?.message || "").slice(0, 140);
    if (mark.status >= 200 && mark.status < 300) {
      anyOk = true;
      console.log(
        `  OK mark ${cohort.batchName}/${cohort.yearName} student=${student.user?.fullName || student._id} subject=${subject.name || subject._id} → ${mark.status}`,
      );

      // Also verify results list for this scope
      const qs = new URLSearchParams({
        examId: exam._id,
        batchId: cohort.batchId,
        yearId: cohort.yearId,
      });
      const list = await req(jar, "GET", `/exams/results/all?${qs}`);
      if (list.status < 200 || list.status >= 300) {
        findings.push({
          label: account.label,
          kind: "WARN-LIST",
          msg: `results/all ${list.status} for ${cohort.batchName}/${cohort.yearName}`,
        });
        summary.warn++;
        console.log(`  WARN results/all ${list.status}`);
      }
    } else {
      anyFail = true;
      summary.markFail++;
      findings.push({
        label: account.label,
        kind: "FAIL-MARK",
        path: `${cohort.batchName}/${cohort.yearName}`,
        msg: `${mark.status} ${msg}`,
      });
      console.log(
        `  FAIL mark ${cohort.batchName}/${cohort.yearName} subject=${subject.name || subject._id} → ${mark.status} ${msg}`,
      );

      // Retry with assignment subject if different
      if (
        cohort.assignment &&
        idOf(cohort.assignment.subjectId) !== idOf(subject._id)
      ) {
        const retry = {
          ...payload,
          marks: [
            {
              ...payload.marks[0],
              subjectId: idOf(cohort.assignment.subjectId),
            },
          ],
        };
        const m2 = await req(jar, "POST", "/exams/results", retry);
        if (m2.status >= 200 && m2.status < 300) {
          anyOk = true;
          console.log(
            `  OK mark (assignment subject) ${cohort.batchName}/${cohort.yearName} → ${m2.status}`,
          );
        } else {
          console.log(
            `  FAIL assignment subject retry → ${m2.status} ${(m2.json?.message || "").slice(0, 100)}`,
          );
        }
      }
    }
  }

  if (anyOk && !anyFail) {
    summary.markOk++;
  } else if (anyOk && anyFail) {
    summary.warn++;
    findings.push({
      label: account.label,
      kind: "WARN-PARTIAL",
      msg: "some cohorts OK, some FAIL",
    });
  } else if (!anyOk) {
    // already counted fails
  }

  // Negative: unassigned subject should 403
  const allSubjectIds = new Set((data.subjects || []).map((s) => idOf(s._id)));
  const foreign = "000000000000000000000001";
  if (!allSubjectIds.has(foreign) && viable[0]) {
    const c = viable[0];
    const deny = await req(jar, "POST", "/exams/results", {
      examId: exams[0]._id,
      studentId: c.students[0]._id,
      batchId: c.batchId,
      yearId: c.yearId,
      marks: [
        {
          subjectId: foreign,
          fullMarks: 100,
          passMarks: 35,
          theoryMarks: 10,
          attendanceStatus: "PRESENT",
        },
      ],
    });
    if (deny.status === 403 || deny.status === 404) {
      console.log(`  OK deny foreign subject → ${deny.status}`);
    } else if (deny.status >= 200 && deny.status < 300) {
      findings.push({
        label: account.label,
        kind: "FAIL-SECURITY",
        msg: "accepted marks for foreign subject id",
      });
      summary.markFail++;
      console.log(`  FAIL security — foreign subject accepted`);
    } else {
      console.log(`  NOTE deny foreign → ${deny.status} ${(deny.json?.message || "").slice(0, 80)}`);
    }
  }

  await req(jar, "POST", "/auth/logout").catch(() => {});
}

console.log("QA Teacher Mark Entry —", BASE);
for (const t of TEACHERS) {
  try {
    await probeTeacher(t);
  } catch (e) {
    summary.markFail++;
    findings.push({ label: t.label, kind: "FAIL-EX", msg: e.message });
    console.log(`\n=== ${t.label} ERROR ${e.message} ===`);
  }
  await new Promise((r) => setTimeout(r, 300));
}

// Also discover any other TEACHER users in DB via admin if available
console.log("\n========== SUMMARY ==========");
console.log(JSON.stringify(summary, null, 2));
console.log("\n========== FINDINGS ==========");
for (const f of findings) {
  console.log(
    `${(f.kind || "").padEnd(16)} ${(f.label || "").padEnd(10)} ${(f.path || "").padEnd(28)} ${f.msg || ""}`,
  );
}
console.log("\nTotal findings:", findings.length);
const hardFails = findings.filter((f) => String(f.kind).startsWith("FAIL"));
process.exit(hardFails.length > 0 ? 1 : 0);
