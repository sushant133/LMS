/**
 * QA: Teacher + Staff + Module Access probe
 * Usage: node scripts/qaTeacherStaffAccess.mjs
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
const DEMO = "Demo@123456";

const ACCOUNTS = [
  { label: "teacher-ram", email: "ram.sharma@demoerp.nepal-school.com", password: DEMO, expectRole: "TEACHER" },
  { label: "teacher-sita", email: "sita.gurung@demoerp.nepal-school.com", password: DEMO, expectRole: "TEACHER" },
  { label: "teacher-hari", email: "hari.thapa@demoerp.nepal-school.com", password: DEMO, expectRole: "TEACHER" },
  { label: "teacher-gita", email: "gita.rai@demoerp.nepal-school.com", password: DEMO, expectRole: "TEACHER" },
  { label: "library", email: "maya.poudel@demoerp.nepal-school.com", password: DEMO, expectRole: "LIBRARY_STAFF" },
  { label: "lab", email: "binod.shrestha@demoerp.nepal-school.com", password: DEMO, expectRole: "LABORATORY_STAFF" },
  { label: "accountant", email: "accountant@demo.school", password: "12345678", expectRole: "ACCOUNTANT" },
  { label: "accountant-sushant", email: "sushant@gmail.com", password: DEMO, expectRole: "ACCOUNTANT", optional: true },
  { label: "staff-reception", email: "reception@demoerp.nepal-school.com", password: DEMO, expectRole: "COLLEGE_STAFF" },
  { label: "staff-office", email: "office@demoerp.nepal-school.com", password: DEMO, expectRole: "COLLEGE_STAFF" },
  { label: "staff-security", email: "security@demoerp.nepal-school.com", password: DEMO, expectRole: "COLLEGE_STAFF" },
  { label: "admin", email: "admin@demoerp.nepal-school.com", password: DEMO, expectRole: "COLLEGE_ADMIN" },
];

/** Paths every authenticated user should GET successfully for shared ref data */
const SHARED_ACADEMICS = [
  "/academics/batches",
  "/academics/years",
  "/academics/subjects",
];

/** Teacher My Work paths (expect 200 for TEACHER) */
const TEACHER_PATHS = [
  "/teacher/scope",
  "/exams",
  "/exams/results/all",
  "/exams/result-submissions",
  "/exams/routines",
  "/academic-management/dashboard",
  "/academic-management/dashboard?academicYearBs=" + encodeURIComponent("2083/2084"),
  "/homework/feed",
  "/timetable",
  "/students",
  "/settings",
  "/auth/me",
  "/users/me/module-access",
  "/employee-attendance/me",
  "/employee-attendance/permissions",
];

/** Library staff critical paths */
const LIBRARY_PATHS = [
  "/library/dashboard",
  "/library/books",
  "/library/issues",
  "/students",
  "/teachers",
  "/employee-attendance/me",
  "/employee-attendance/permissions",
  ...SHARED_ACADEMICS,
];

/** Lab staff */
const LAB_PATHS = [
  "/laboratory/dashboard",
  "/laboratory/labs",
  "/laboratory/equipment",
  "/teachers",
  "/employee-attendance/me",
  "/employee-attendance/permissions",
  ...SHARED_ACADEMICS,
];

/** Accountant / finance */
const ACCOUNTS_PATHS = [
  "/accounting/dashboard",
  "/accounting/settings",
  "/accounting/student-accounts",
  "/students",
  "/employee-attendance/me",
  "/employee-attendance/permissions",
  ...SHARED_ACADEMICS,
];

/** Generic staff (self-service + profile) */
const STAFF_BASE = [
  "/auth/me",
  "/settings",
  "/users/me/module-access",
  "/employee-attendance/me",
  "/employee-attendance/permissions",
  ...SHARED_ACADEMICS,
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
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, path, method };
}

function classify(status, expectOk) {
  if (expectOk) {
    if (status >= 200 && status < 300) return "PASS";
    if (status === 401) return "FAIL-AUTH";
    if (status === 403) return "FAIL-403";
    if (status >= 500) return "FAIL-500";
    return `FAIL-${status}`;
  }
  // expect blocked or optional
  if (status === 403 || status === 401) return "OK-BLOCKED";
  if (status >= 200 && status < 300) return "PASS";
  if (status >= 500) return "FAIL-500";
  return `NOTE-${status}`;
}

const findings = [];
const summary = { pass: 0, fail: 0, warn: 0, blocked: 0 };

function record(label, result, expectOk = true) {
  const kind = classify(result.status, expectOk);
  const msg = (result.json?.message || "").slice(0, 100);
  const row = { label, path: result.path, status: result.status, kind, msg };
  if (kind.startsWith("FAIL")) {
    summary.fail++;
    findings.push(row);
  } else if (kind === "OK-BLOCKED") {
    summary.blocked++;
  } else if (kind.startsWith("NOTE")) {
    summary.warn++;
    findings.push(row);
  } else {
    summary.pass++;
  }
  return row;
}

async function probeAccount(account) {
  const jar = makeJar();
  const login = await req(jar, "POST", "/auth/login", {
    email: account.email,
    password: account.password,
  });

  if (login.status !== 200) {
    if (account.optional) {
      console.log(`\n=== ${account.label} SKIP (login ${login.status}) ===`);
      return;
    }
    console.log(`\n=== ${account.label} LOGIN FAIL ${login.status} ${(login.json?.message || "").slice(0, 80)} ===`);
    record(account.label, login, true);
    return;
  }

  const user = login.json?.data?.user;
  const role = user?.role;
  const ma = user?.moduleAccess || {};
  console.log(`\n=== ${account.label} role=${role} matrixKeys=${Object.keys(ma).length} ===`);
  console.log(
    `  modules: academics=${ma.academics} exams=${ma.examinations} results=${ma.results} am=${ma["academic-management"]} accounts=${ma.accounts} library=${ma.library} lab=${ma.laboratory}`
  );

  if (account.expectRole && role !== account.expectRole) {
    findings.push({
      label: account.label,
      path: "login.role",
      status: 200,
      kind: "WARN-ROLE",
      msg: `expected ${account.expectRole} got ${role}`,
    });
    summary.warn++;
  }

  // Always probe shared academics
  for (const p of SHARED_ACADEMICS) {
    const r = await req(jar, "GET", p);
    const row = record(account.label, r, true);
    if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
  }

  // Role-specific
  if (role === "TEACHER") {
    for (const p of TEACHER_PATHS) {
      const r = await req(jar, "GET", p);
      const row = record(account.label, r, true);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
    }
    // Mark entry smoke: prefer SubjectAssignment pair; fall back to legacy subject+student
    const scopeRes = await req(jar, "GET", "/teacher/scope");
    const scope = scopeRes.json?.data;
    const exams = (await req(jar, "GET", "/exams")).json?.data || [];
    const pair = scope?.scope?.assignments?.[0];
    let student = (scope?.students || []).find((s) => {
      if (!pair) return false;
      const b = typeof s.batchId === "object" ? s.batchId?._id : s.batchId;
      const y = typeof s.yearId === "object" ? s.yearId?._id : s.yearId;
      return String(b) === String(pair.batchId) && String(y) === String(pair.yearId);
    });
    let subjectId = pair?.subjectId;
    if (!student) student = scope?.students?.[0];
    if (!subjectId) subjectId = scope?.subjects?.[0]?._id || scope?.scope?.subjectIds?.[0];
    if (exams[0] && subjectId && student) {
      const batchId = typeof student.batchId === "object" ? student.batchId?._id : student.batchId;
      const yearId = typeof student.yearId === "object" ? student.yearId?._id : student.yearId;
      const payload = {
        examId: exams[0]._id,
        studentId: student._id,
        batchId,
        yearId,
        marks: [
          {
            subjectId,
            fullMarks: 100,
            passMarks: 35,
            theoryMarks: 50,
            practicalMarks: 10,
            internalMarks: 5,
            attendanceStatus: "PRESENT",
            teacherRemarks: "qa-probe",
          },
        ],
      };
      const mark = await req(jar, "POST", "/exams/results", payload);
      const row = record(account.label, { ...mark, path: "POST /exams/results" }, true);
      if (row.kind.startsWith("FAIL")) {
        console.log(`  ${row.kind} mark-entry ${mark.status} ${row.msg}`);
      } else {
        console.log(
          `  mark-entry OK ${mark.status} (source=${scope?.scope?.scopeSource} assign=${scope?.scope?.assignments?.length || 0})`
        );
      }
    } else {
      console.log(
        `  mark-entry SKIP (exams=${exams.length} subjects=${scope?.subjects?.length || 0} students=${scope?.students?.length || 0} source=${scope?.scope?.scopeSource})`
      );
      summary.warn++;
      findings.push({
        label: account.label,
        path: "mark-entry",
        status: 0,
        kind: "WARN-SKIP",
        msg: "no subject/student/exam for mark entry",
      });
    }
  } else if (role === "LIBRARY_STAFF") {
    for (const p of LIBRARY_PATHS) {
      const r = await req(jar, "GET", p);
      const row = record(account.label, r, true);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
    }
  } else if (role === "LABORATORY_STAFF") {
    for (const p of LAB_PATHS) {
      const r = await req(jar, "GET", p);
      const row = record(account.label, r, true);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
    }
  } else if (role === "ACCOUNTANT" || role === "CASHIER" || role === "AUDITOR") {
    for (const p of ACCOUNTS_PATHS) {
      const r = await req(jar, "GET", p);
      // accounting routes may 404 if path wrong — note it
      const expectOk = !p.includes("chart-of-accounts"); // may not exist
      const row = record(account.label, r, true);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
    }
  } else if (role === "COLLEGE_STAFF") {
    for (const p of STAFF_BASE) {
      const r = await req(jar, "GET", p);
      // employee-attendance/me should work for linked staff; 403 may mean no profile
      const expectOk = !p.includes("employee-attendance");
      const row = record(account.label, r, expectOk || r.status < 500);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
      else if (r.status >= 400) console.log(`  note ${p} ${r.status} ${row.msg}`);
    }
  } else if (role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN") {
    for (const p of [
      ...SHARED_ACADEMICS,
      "/students",
      "/teachers",
      "/exams",
      "/academic-management/dashboard",
      "/users/modules",
    ]) {
      const r = await req(jar, "GET", p);
      const row = record(account.label, r, true);
      if (row.kind.startsWith("FAIL")) console.log(`  ${row.kind} ${p} ${r.status} ${row.msg}`);
    }
  }

  await req(jar, "POST", "/auth/logout").catch(() => {});
}

console.log("QA Teacher/Staff Module Access —", BASE);
for (const account of ACCOUNTS) {
  try {
    await probeAccount(account);
  } catch (e) {
    console.log(`\n=== ${account.label} ERROR ${e.message} ===`);
    summary.fail++;
    findings.push({
      label: account.label,
      path: "exception",
      status: 0,
      kind: "FAIL-EX",
      msg: e.message,
    });
  }
  // small delay to avoid rate limit
  await new Promise((r) => setTimeout(r, 400));
}

console.log("\n========== SUMMARY ==========");
console.log(JSON.stringify(summary, null, 2));
console.log("\n========== FAILURES / WARNINGS ==========");
for (const f of findings) {
  console.log(`${f.kind.padEnd(12)} ${f.label.padEnd(20)} ${String(f.status).padStart(3)} ${f.path} — ${f.msg}`);
}
console.log("\nTotal issues:", findings.length);
process.exit(summary.fail > 0 ? 1 : 0);
