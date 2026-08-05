/**
 * Deep QA probe for teacher/staff — real routes only
 * Usage: node scripts/qaDeepProbe.mjs
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
const DEMO = "Demo@123456";

const ACCOUNTS = [
  { label: "teacher-ram", email: "ram.sharma@demoerp.nepal-school.com", password: DEMO },
  { label: "teacher-sita", email: "sita.gurung@demoerp.nepal-school.com", password: DEMO },
  { label: "teacher-hari", email: "hari.thapa@demoerp.nepal-school.com", password: DEMO },
  { label: "teacher-gita", email: "gita.rai@demoerp.nepal-school.com", password: DEMO },
  { label: "library", email: "maya.poudel@demoerp.nepal-school.com", password: DEMO },
  { label: "lab", email: "binod.shrestha@demoerp.nepal-school.com", password: DEMO },
  { label: "accountant", email: "accountant@demo.school", password: "12345678" },
  { label: "staff-reception", email: "reception@demoerp.nepal-school.com", password: DEMO },
  { label: "staff-office", email: "office@demoerp.nepal-school.com", password: DEMO },
  { label: "staff-security", email: "security@demoerp.nepal-school.com", password: DEMO },
];

/** Role → paths expected to succeed (200) */
const EXPECT_OK = {
  TEACHER: [
    "/teacher/scope",
    "/teacher/lab-access",
    "/exams",
    "/exams/results/all",
    "/exams/result-submissions",
    "/exams/routines",
    "/academic-management/dashboard",
    "/academic-management/session-plans",
    "/academic-management/lesson-plans",
    "/academic-management/log-book-entries",
    "/academic-management/syllabi",
    "/academic-management/timetable/today",
    "/homework/feed",
    "/timetable",
    "/students",
    "/academics/batches",
    "/academics/years",
    "/academics/subjects",
    "/settings",
    "/auth/me",
    "/users/me/module-access",
    "/employee-attendance/me",
    "/employee-attendance/permissions",
    "/notices",
  ],
  LIBRARY_STAFF: [
    "/library/dashboard",
    "/library/books",
    "/library/issues",
    "/students",
    "/teachers",
    "/academics/batches",
    "/academics/years",
    "/auth/me",
    "/users/me/module-access",
    "/employee-attendance/me",
    "/employee-attendance/permissions",
  ],
  LABORATORY_STAFF: [
    "/laboratory/dashboard",
    "/laboratory/labs",
    "/laboratory/equipment",
    "/teachers",
    "/academics/batches",
    "/auth/me",
    "/employee-attendance/me",
    "/employee-attendance/permissions",
  ],
  ACCOUNTANT: [
    "/accounting/dashboard",
    "/accounting/settings",
    "/accounting/student-accounts",
    "/students",
    "/academics/batches",
    "/academics/years",
    "/auth/me",
    "/employee-attendance/me",
    "/employee-attendance/permissions",
  ],
  COLLEGE_STAFF: [
    "/auth/me",
    "/settings",
    "/users/me/module-access",
    "/employee-attendance/me",
    "/employee-attendance/permissions",
    "/academics/batches",
    "/academics/years",
    "/academics/subjects",
  ],
};

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
    json = { raw: text.slice(0, 250) };
  }
  return { status: res.status, json, path, method };
}

const findings = [];
const summary = { pass: 0, fail: 0, warn: 0 };

async function checkDbLinks() {
  console.log("\n========== DB PROFILE LINKS ==========");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const emails = ACCOUNTS.map((a) => a.email);
  const users = await db
    .collection("users")
    .find({ email: { $in: emails } })
    .project({ email: 1, role: 1, fullName: 1, schoolId: 1 })
    .toArray();

  const colNames = (await db.listCollections().toArray()).map((c) => c.name);
  const staffCols = colNames.filter((n) => /staff|employee/i.test(n));
  console.log("staff-related collections:", staffCols.join(", ") || "(none)");

  for (const u of users) {
    const teacher = await db.collection("teachers").findOne({
      $or: [{ user: u._id }, { userId: u._id }],
    });
    let staff = null;
    for (const col of staffCols) {
      staff =
        (await db.collection(col).findOne({ user: u._id })) ||
        (await db.collection(col).findOne({ userId: u._id })) ||
        null;
      if (staff) break;
    }
    const row = {
      email: u.email,
      role: u.role,
      teacher: teacher ? String(teacher._id) : null,
      staff: staff ? `${staff.constructor?.name || "doc"}:${String(staff._id)}` : null,
      staffCol: staff ? staffCols.find(async () => true) : null,
    };
    // re-find which col
    let foundCol = null;
    if (!staff) {
      for (const col of staffCols) {
        const s =
          (await db.collection(col).findOne({ user: u._id })) ||
          (await db.collection(col).findOne({ userId: u._id }));
        if (s) {
          staff = s;
          foundCol = col;
          break;
        }
      }
    } else {
      for (const col of staffCols) {
        const s =
          (await db.collection(col).findOne({ user: u._id })) ||
          (await db.collection(col).findOne({ userId: u._id }));
        if (s) {
          foundCol = col;
          break;
        }
      }
    }
    const ok =
      u.role === "TEACHER"
        ? !!teacher
        : u.role === "COLLEGE_ADMIN"
          ? true
          : !!staff || !!teacher;
    console.log(
      `${ok ? "OK " : "MISS"} ${u.email.padEnd(45)} role=${String(u.role).padEnd(18)} teacher=${!!teacher} staff=${!!staff}${foundCol ? `@${foundCol}` : ""}`
    );
    if (!ok && u.role !== "TEACHER") {
      findings.push({
        label: u.email,
        path: "db.profile-link",
        status: 0,
        kind: "FAIL-LINK",
        msg: `no Teacher/Staff profile for role ${u.role}`,
      });
      summary.fail++;
    }
  }
  await mongoose.disconnect();
}

async function probeAccount(account) {
  const jar = makeJar();
  const login = await req(jar, "POST", "/auth/login", {
    email: account.email,
    password: account.password,
  });
  if (login.status !== 200) {
    console.log(`\n=== ${account.label} LOGIN FAIL ${login.status} ===`);
    findings.push({
      label: account.label,
      path: "login",
      status: login.status,
      kind: "FAIL-AUTH",
      msg: login.json?.message || "",
    });
    summary.fail++;
    return;
  }

  const role = login.json?.data?.user?.role;
  console.log(`\n=== ${account.label} role=${role} ===`);

  const paths = EXPECT_OK[role] || EXPECT_OK.COLLEGE_STAFF;
  for (const p of paths) {
    const r = await req(jar, "GET", p);
    const msg = (r.json?.message || "").toString().slice(0, 120);
    if (r.status >= 200 && r.status < 300) {
      summary.pass++;
    } else {
      const kind =
        r.status === 404 && msg.includes("profile linked")
          ? "FAIL-NO-PROFILE"
          : r.status === 403
            ? "FAIL-403"
            : r.status === 404
              ? "FAIL-404"
              : r.status >= 500
                ? "FAIL-500"
                : `FAIL-${r.status}`;
      console.log(`  ${kind} ${p} ${r.status} ${msg}`);
      findings.push({ label: account.label, path: p, status: r.status, kind, msg });
      summary.fail++;
    }
  }

  // Teacher mark-entry + scope quality
  if (role === "TEACHER") {
    const scopeRes = await req(jar, "GET", "/teacher/scope");
    const scope = scopeRes.json?.data;
    const sc = scope?.scope;
    console.log(
      `  scope source=${sc?.scopeSource} assign=${sc?.assignments?.length || 0} subjects=${scope?.subjects?.length || 0} students=${scope?.students?.length || 0}`
    );
    if (!sc?.assignments?.length) {
      findings.push({
        label: account.label,
        path: "scope.assignments",
        status: 200,
        kind: "WARN-SCOPE",
        msg: "no assignments (even synthesized)",
      });
      summary.warn++;
    }

    const exams = (await req(jar, "GET", "/exams")).json?.data || [];
    const pair = sc?.assignments?.[0];
    let student = (scope?.students || []).find((s) => {
      if (!pair) return false;
      const b = typeof s.batchId === "object" ? s.batchId?._id : s.batchId;
      const y = typeof s.yearId === "object" ? s.yearId?._id : s.yearId;
      return String(b) === String(pair.batchId) && String(y) === String(pair.yearId);
    });
    let subjectId = pair?.subjectId;
    if (!student) student = scope?.students?.[0];
    if (!subjectId) subjectId = scope?.subjects?.[0]?._id || sc?.subjectIds?.[0];

    if (exams[0] && subjectId && student) {
      const batchId = typeof student.batchId === "object" ? student.batchId?._id : student.batchId;
      const yearId = typeof student.yearId === "object" ? student.yearId?._id : student.yearId;
      const mark = await req(jar, "POST", "/exams/results", {
        examId: exams[0]._id,
        studentId: student._id,
        batchId,
        yearId,
        marks: [
          {
            subjectId,
            fullMarks: 100,
            passMarks: 35,
            theoryMarks: 55,
            practicalMarks: 10,
            internalMarks: 5,
            attendanceStatus: "PRESENT",
            // No teacherRemarks: it is a real teacher-authored field that prints on
            // the marksheet, so a probe must not leave test text behind.
          },
        ],
      });
      if (mark.status >= 200 && mark.status < 300) {
        console.log(`  mark-entry OK ${mark.status}`);
        summary.pass++;
      } else {
        console.log(`  mark-entry FAIL ${mark.status} ${(mark.json?.message || "").slice(0, 100)}`);
        findings.push({
          label: account.label,
          path: "POST /exams/results",
          status: mark.status,
          kind: "FAIL-MARK",
          msg: mark.json?.message || "",
        });
        summary.fail++;
      }
    } else {
      console.log(`  mark-entry SKIP exams=${exams.length} subj=${!!subjectId} stud=${!!student}`);
      findings.push({
        label: account.label,
        path: "mark-entry",
        status: 0,
        kind: "WARN-SKIP",
        msg: "insufficient data",
      });
      summary.warn++;
    }

    // AM lists should return arrays without 500
    for (const p of [
      "/academic-management/session-plans",
      "/academic-management/lesson-plans",
      "/academic-management/log-book-entries",
    ]) {
      const r = await req(jar, "GET", p);
      if (r.status >= 500) {
        findings.push({
          label: account.label,
          path: p,
          status: r.status,
          kind: "FAIL-500",
          msg: r.json?.message || "",
        });
        summary.fail++;
      }
    }
  }

  await req(jar, "POST", "/auth/logout").catch(() => {});
}

console.log("Deep QA Teacher/Staff —", BASE);
await checkDbLinks();
for (const account of ACCOUNTS) {
  try {
    await probeAccount(account);
  } catch (e) {
    console.log(`\n=== ${account.label} ERROR ${e.message} ===`);
    findings.push({
      label: account.label,
      path: "exception",
      status: 0,
      kind: "FAIL-EX",
      msg: e.message,
    });
    summary.fail++;
  }
  await new Promise((r) => setTimeout(r, 350));
}

console.log("\n========== SUMMARY ==========");
console.log(JSON.stringify(summary, null, 2));
console.log("\n========== FINDINGS ==========");
for (const f of findings) {
  console.log(
    `${(f.kind || "").padEnd(16)} ${String(f.label).padEnd(22)} ${String(f.status).padStart(3)} ${f.path} — ${f.msg}`
  );
}
console.log("\nTotal findings:", findings.length);
process.exit(summary.fail > 0 ? 1 : 0);
