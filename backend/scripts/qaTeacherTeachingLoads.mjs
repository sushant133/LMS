/**
 * Full teaching-load QA for teachers with Subject Assignment (or legacy) scope.
 * Covers: login, scope, students, exams/marks, homework, notes, feed, academic-mgmt, attendance.
 *
 * Usage: node scripts/qaTeacherTeachingLoads.mjs
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
    json = { raw: text.slice(0, 250) };
  }
  return { status: res.status, json, path, method };
}

const idOf = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && v._id != null) return String(v._id);
  return String(v);
};

const findings = [];
const summary = {
  teachers: 0,
  withAssign: 0,
  pass: 0,
  fail: 0,
  warn: 0,
};

function rec(label, kind, path, msg, status = 0) {
  const row = { label, kind, path, msg: (msg || "").slice(0, 160), status };
  findings.push(row);
  if (String(kind).startsWith("FAIL")) summary.fail++;
  else if (String(kind).startsWith("WARN")) summary.warn++;
  else summary.pass++;
  const tag = String(kind).startsWith("FAIL")
    ? "FAIL"
    : String(kind).startsWith("WARN")
      ? "WARN"
      : "OK  ";
  console.log(`  ${tag} ${kind.padEnd(18)} ${path || ""} ${status || ""} ${(msg || "").slice(0, 100)}`);
}

function expectOk(label, kind, path, r, okStatuses = [200, 201]) {
  if (okStatuses.includes(r.status)) {
    rec(label, kind, path, r.json?.message || "ok", r.status);
    return true;
  }
  rec(
    label,
    `FAIL-${kind}`,
    path,
    r.json?.message || r.json?.error || `status ${r.status}`,
    r.status,
  );
  return false;
}

async function probeTeacher(account) {
  const jar = makeJar();
  summary.teachers++;
  console.log(`\n======== ${account.label} (${account.email}) ========`);

  const login = await req(jar, "POST", "/auth/login", {
    email: account.email,
    password: account.password,
  });
  if (login.status !== 200) {
    rec(account.label, "FAIL-LOGIN", "/auth/login", login.json?.message, login.status);
    return;
  }
  rec(account.label, "LOGIN", "/auth/login", login.json?.data?.user?.role, 200);

  // --- Scope ---
  const scopeRes = await req(jar, "GET", "/teacher/scope");
  if (!expectOk(account.label, "SCOPE", "/teacher/scope", scopeRes)) return;
  const data = scopeRes.json?.data;
  const sc = data?.scope || {};
  const assignments = sc.assignments || [];
  const subjectIds = sc.subjectIds || [];
  const students = data?.students || [];
  const subjects = data?.subjects || [];
  const batches = data?.batches || [];
  const years = data?.years || [];

  console.log(
    `  scope source=${sc.scopeSource} assign=${assignments.length} subjectIds=${subjectIds.length} students=${students.length} subjects=${subjects.length}`,
  );

  if (!assignments.length && !subjectIds.length) {
    rec(account.label, "WARN-NO-ASSIGN", "scope", "no assignments or subjects — skip teaching loads");
    return;
  }
  summary.withAssign++;

  // Prefer real SubjectAssignment pairs; fall back to synthesized legacy
  const pairs =
    assignments.length > 0
      ? assignments.filter((a) => a.batchId && a.yearId && a.subjectId)
      : [];

  if (!pairs.length) {
    rec(account.label, "FAIL-NO-PAIRS", "scope.assignments", "no usable batch/year/subject pairs");
    return;
  }

  // Students must exist for each pair (or at least some pairs)
  let pairsWithStudents = 0;
  for (const a of pairs) {
    const n = students.filter(
      (s) => idOf(s.batchId) === idOf(a.batchId) && idOf(s.yearId) === idOf(a.yearId),
    ).length;
    if (n > 0) pairsWithStudents++;
    console.log(
      `  pair subject=${idOf(a.subjectId).slice(-6)} batch=${idOf(a.batchId).slice(-6)} year=${idOf(a.yearId).slice(-6)} students=${n} type=${a.assignmentType || "?"} id=${(a.assignmentId || "").slice(0, 24)}`,
    );
  }
  if (pairsWithStudents === 0) {
    rec(account.label, "FAIL-NO-STUDENTS", "scope.students", "no students for any assignment pair");
    return;
  }
  rec(
    account.label,
    "COHORTS",
    "scope",
    `${pairsWithStudents}/${pairs.length} pairs have students`,
    200,
  );

  // --- Read paths (My Work) ---
  const readPaths = [
    "/auth/me",
    "/users/me/module-access",
    "/homework/feed",
    "/homework/topics",
    "/homework",
    "/exams",
    "/exams/results/all",
    "/exams/result-submissions",
    "/exams/routines",
    "/timetable",
    "/students",
    "/academic-management/dashboard",
    "/academic-management/session-plans",
    "/academic-management/lesson-plans",
    "/academic-management/log-book-entries",
    "/notices",
    "/settings",
  ];
  for (const p of readPaths) {
    const r = await req(jar, "GET", p);
    expectOk(account.label, "READ", p, r);
  }

  // --- Exams + mark entry per pair ---
  const exams = (await req(jar, "GET", "/exams")).json?.data || [];
  if (!exams.length) {
    rec(account.label, "FAIL-NO-EXAMS", "/exams", "no exams for mark entry");
  }

  const createdHomeworkIds = [];
  const createdNoteIds = [];

  for (const pair of pairs) {
    const bid = idOf(pair.batchId);
    const yid = idOf(pair.yearId);
    const sid = idOf(pair.subjectId);
    const subjDoc = subjects.find((s) => idOf(s._id) === sid);
    const subjName = subjDoc?.name || sid.slice(-6);
    const cohortStudents = students.filter(
      (s) => idOf(s.batchId) === bid && idOf(s.yearId) === yid,
    );
    if (!cohortStudents.length) {
      rec(
        account.label,
        "WARN-EMPTY-COHORT",
        `pair/${subjName}`,
        "no students in roster for this assignment pair",
      );
      continue;
    }

    // Mark entry for first student + full roster sample (all students)
    if (exams[0]) {
      let markFails = 0;
      for (const st of cohortStudents) {
        const mark = await req(jar, "POST", "/exams/results", {
          examId: exams[0]._id,
          studentId: st._id,
          batchId: bid,
          yearId: yid,
          marks: [
            {
              subjectId: sid,
              fullMarks: 100,
              passMarks: 35,
              theoryMarks: 48,
              practicalMarks: 10,
              internalMarks: 5,
              attendanceStatus: "PRESENT",
              // No teacherRemarks: it is a real teacher-authored field that prints on
              // the marksheet, so a probe must not leave test text behind.
            },
          ],
        });
        if (mark.status < 200 || mark.status >= 300) {
          markFails++;
          rec(
            account.label,
            "FAIL-MARK",
            `POST /exams/results ${subjName}`,
            `${mark.status} ${mark.json?.message || ""} student=${st.user?.fullName || st._id}`,
            mark.status,
          );
        }
      }
      if (markFails === 0) {
        rec(
          account.label,
          "MARK-ROSTER",
          subjName,
          `${cohortStudents.length} students OK`,
          200,
        );
      }

      // Results list scoped
      const qs = new URLSearchParams({
        examId: exams[0]._id,
        batchId: bid,
        yearId: yid,
      });
      expectOk(
        account.label,
        "RESULTS-LIST",
        `/exams/results/all?batch+year`,
        await req(jar, "GET", `/exams/results/all?${qs}`),
      );
    }

    // --- Homework (assignment) for this subject cohort ---
    const hwBody = {
      type: "HOMEWORK",
      title: `QA HW ${account.label} ${subjName} ${Date.now().toString(36).slice(-4)}`,
      description: "Automated QA homework for assigned subject cohort.",
      batchId: bid,
      yearId: yid,
      subjectId: sid,
      topic: "QA Topic",
      dueDateBs: "2083-01-15",
      maxMarks: 20,
      visibleTo: ["STUDENT", "PARENT"],
      allowSubmission: true,
      isPinned: false,
      attachments: [],
      links: [],
    };
    const hw = await req(jar, "POST", "/homework", hwBody);
    if (hw.status === 201 || hw.status === 200) {
      const id = hw.json?.data?._id || hw.json?.data?.id;
      if (id) createdHomeworkIds.push(id);
      rec(account.label, "HOMEWORK-CREATE", `/homework ${subjName}`, "created", hw.status);
    } else {
      rec(
        account.label,
        "FAIL-HOMEWORK",
        `/homework ${subjName}`,
        hw.json?.message || String(hw.status),
        hw.status,
      );
    }

    // --- Note for same cohort ---
    const noteBody = {
      type: "NOTE",
      title: `QA Note ${account.label} ${subjName} ${Date.now().toString(36).slice(-4)}`,
      description: "Automated QA class note for assigned subject students.",
      batchId: bid,
      yearId: yid,
      subjectId: sid,
      topic: "QA Notes",
      visibleTo: ["STUDENT", "PARENT"],
      allowSubmission: false,
      isPinned: false,
      attachments: [],
      links: [],
    };
    const note = await req(jar, "POST", "/homework", noteBody);
    if (note.status === 201 || note.status === 200) {
      const id = note.json?.data?._id || note.json?.data?.id;
      if (id) createdNoteIds.push(id);
      rec(account.label, "NOTE-CREATE", `/homework NOTE ${subjName}`, "created", note.status);
    } else {
      rec(
        account.label,
        "FAIL-NOTE",
        `/homework NOTE ${subjName}`,
        note.json?.message || String(note.status),
        note.status,
      );
    }

    // Feed should include created items
    const feed = await req(jar, "GET", "/homework/feed");
    expectOk(account.label, "FEED", "/homework/feed", feed);

    // --- Subject attendance for cohort students ---
    const att = await req(jar, "POST", "/attendance", {
      dateBs: "2083-01-10",
      subjectId: sid,
      batchId: bid,
      yearId: yid,
      entries: cohortStudents.slice(0, Math.min(3, cohortStudents.length)).map((s) => ({
        studentId: s._id,
        status: "PRESENT",
      })),
    });
    if (att.status >= 200 && att.status < 300) {
      rec(account.label, "ATTENDANCE", `/attendance ${subjName}`, "ok", att.status);
    } else if (att.status === 409) {
      // Synced with daily attendance — confirm override
      const att2 = await req(jar, "POST", "/attendance", {
        dateBs: "2083-01-10",
        subjectId: sid,
        batchId: bid,
        yearId: yid,
        confirmSyncOverride: true,
        entries: cohortStudents.slice(0, Math.min(3, cohortStudents.length)).map((s) => ({
          studentId: s._id,
          status: "PRESENT",
        })),
      });
      if (att2.status >= 200 && att2.status < 300) {
        rec(account.label, "ATTENDANCE", `/attendance ${subjName}`, "ok-override", att2.status);
      } else {
        rec(
          account.label,
          "FAIL-ATTENDANCE",
          `/attendance ${subjName}`,
          att2.json?.message || String(att2.status),
          att2.status,
        );
      }
    } else {
      rec(
        account.label,
        "FAIL-ATTENDANCE",
        `/attendance ${subjName}`,
        att.json?.message || String(att.status),
        att.status,
      );
    }
  }

  // Negative: homework for wrong subject should fail
  if (pairs[0] && exams[0]) {
    const p = pairs[0];
    const foreign = "000000000000000000000099";
    const deny = await req(jar, "POST", "/homework", {
      type: "HOMEWORK",
      title: "Should Fail",
      description: "Not assigned subject",
      batchId: idOf(p.batchId),
      yearId: idOf(p.yearId),
      subjectId: foreign,
      visibleTo: ["STUDENT"],
      allowSubmission: true,
      attachments: [],
      links: [],
    });
    if (deny.status === 403 || deny.status === 404) {
      rec(account.label, "DENY-FOREIGN-HW", "/homework", `blocked ${deny.status}`, deny.status);
    } else if (deny.status >= 200 && deny.status < 300) {
      rec(account.label, "FAIL-SECURITY-HW", "/homework", "accepted unassigned subject");
    } else {
      rec(
        account.label,
        "WARN-DENY-HW",
        "/homework",
        `${deny.status} ${deny.json?.message || ""}`,
        deny.status,
      );
    }
  }

  // Cleanup created posts (keep DB tidy)
  for (const id of [...createdHomeworkIds, ...createdNoteIds]) {
    const del = await req(jar, "DELETE", `/homework/${id}`);
    if (del.status >= 200 && del.status < 300) {
      rec(account.label, "CLEANUP", `DELETE /homework/${id}`, "ok", del.status);
    } else {
      rec(
        account.label,
        "WARN-CLEANUP",
        `DELETE /homework/${id}`,
        del.json?.message || String(del.status),
        del.status,
      );
    }
  }

  await req(jar, "POST", "/auth/logout").catch(() => {});
}

console.log("QA Teacher Teaching Loads —", BASE);
for (const t of TEACHERS) {
  try {
    await probeTeacher(t);
  } catch (e) {
    rec(t.label, "FAIL-EX", "exception", e.message);
  }
  await new Promise((r) => setTimeout(r, 350));
}

console.log("\n========== SUMMARY ==========");
console.log(JSON.stringify(summary, null, 2));
console.log("\n========== FAILURES ==========");
const fails = findings.filter((f) => String(f.kind).startsWith("FAIL"));
for (const f of fails) {
  console.log(
    `${f.kind.padEnd(20)} ${f.label.padEnd(8)} ${String(f.status).padStart(3)} ${f.path} — ${f.msg}`,
  );
}
console.log("\nFail count:", fails.length);
process.exit(fails.length > 0 ? 1 : 0);
