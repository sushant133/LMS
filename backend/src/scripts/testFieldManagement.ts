/**
 * Field Management API QA / smoke test.
 * Covers the endpoints that previously returned 400 after tenantGuard regression,
 * plus create/list/mark/cleanup happy paths for Community/PHC and Hospital.
 *
 * Prerequisites: backend on http://localhost:5000, demo school seeded.
 * Run: npx tsx src/scripts/testFieldManagement.ts
 */
const BASE = process.env.QA_API_BASE ?? "http://localhost:5000/api";
const PASSWORD = "Demo@123456";

const adminEmail = "admin@demoerp.nepal-school.com";
const staffEmail = "reception@demoerp.nepal-school.com";
const teacherEmail = "ram.sharma@demoerp.nepal-school.com";
const studentEmail = "student01@demoerp.nepal-school.com";

type StepResult = { name: string; ok: boolean; detail?: string };
const results: StepResult[] = [];

const pass = (name: string, detail?: string) => {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
};

const fail = (name: string, detail: string) => {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name} — ${detail}`);
};

type ApiClient = {
  get: (path: string, params?: Record<string, string>) => Promise<ApiResponse>;
  post: (path: string, body?: unknown) => Promise<ApiResponse>;
  put: (path: string, body?: unknown) => Promise<ApiResponse>;
  delete: (path: string) => Promise<ApiResponse>;
};

type ApiResponse = {
  status: number;
  data: { success?: boolean; data?: unknown; message?: string; errors?: unknown };
};

const parseSetCookie = (headers: Headers): string => {
  // Node fetch: getSetCookie() when available
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : (() => {
          const single = headers.get("set-cookie");
          return single ? [single] : [];
        })();
  return list.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
};

const makeClient = (cookie: string): ApiClient => {
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<ApiResponse> => {
    const url = new URL(`${BASE}${path.startsWith("/") ? path : `/${path}`}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data: ApiResponse["data"] = {};
    try {
      data = (await res.json()) as ApiResponse["data"];
    } catch {
      data = { message: await res.text().catch(() => "") };
    }
    return { status: res.status, data };
  };

  return {
    get: (path, params) => request("GET", path, undefined, params),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path) => request("DELETE", path)
  };
};

const login = async (email: string, password = PASSWORD): Promise<ApiClient> => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = (await res.json().catch(() => ({}))) as ApiResponse["data"];
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
  }
  const cookie = parseSetCookie(res.headers);
  if (!cookie) {
    throw new Error(`Login for ${email} returned no Set-Cookie`);
  }
  return makeClient(cookie);
};

const errDetail = (response: ApiResponse) =>
  `${response.status}: ${JSON.stringify(response.data)}`;

const unwrap = <T>(response: ApiResponse): T => {
  if (response.status >= 400) {
    throw new Error(errDetail(response));
  }
  return response.data.data as T;
};

const run = async (): Promise<void> => {
  console.log("\n=== Field Management QA ===\n");
  console.log(`API: ${BASE}\n`);

  let admin: ApiClient;
  let staff: ApiClient | null = null;
  let teacher: ApiClient | null = null;
  let student: ApiClient | null = null;

  try {
    admin = await login(adminEmail);
    pass("Admin login");
  } catch (e) {
    fail("Admin login", e instanceof Error ? e.message : String(e));
    summarizeAndExit();
    return;
  }

  // Small delay between logins to reduce chance of auth rate-limit trips during QA.
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    await pause(200);
    staff = await login(staffEmail);
    pass("College staff login", staffEmail);
  } catch (e) {
    fail("College staff login", e instanceof Error ? e.message : String(e));
  }

  try {
    await pause(200);
    teacher = await login(teacherEmail);
    pass("Teacher login");
  } catch (e) {
    fail("Teacher login", e instanceof Error ? e.message : String(e));
  }

  try {
    await pause(200);
    student = await login(studentEmail);
    pass("Student login");
  } catch (e) {
    fail("Student login", e instanceof Error ? e.message : String(e));
  }

  // --- Regression: previously 400 without tenantGuard ---
  try {
    const dash = unwrap<Record<string, unknown>>(await admin.get("/field-duty/dashboard"));
    pass(
      "GET /field-duty/dashboard (admin)",
      `keys=${Object.keys(dash).slice(0, 6).join(",")}`
    );
  } catch (e) {
    fail("GET /field-duty/dashboard (admin)", e instanceof Error ? e.message : String(e));
  }

  try {
    const rows = unwrap<unknown[]>(
      await admin.get("/field-duty/schedules", { section: "COMMUNITY_PHC" })
    );
    pass(
      "GET /field-duty/schedules?section=COMMUNITY_PHC",
      `${Array.isArray(rows) ? rows.length : 0} posting(s)`
    );
  } catch (e) {
    fail(
      "GET /field-duty/schedules?section=COMMUNITY_PHC",
      e instanceof Error ? e.message : String(e)
    );
  }

  try {
    const rows = unwrap<unknown[]>(
      await admin.get("/field-duty/schedules", { section: "HOSPITAL" })
    );
    pass(
      "GET /field-duty/schedules?section=HOSPITAL",
      `${Array.isArray(rows) ? rows.length : 0} posting(s)`
    );
  } catch (e) {
    fail(
      "GET /field-duty/schedules?section=HOSPITAL",
      e instanceof Error ? e.message : String(e)
    );
  }

  try {
    const ctx = unwrap<Array<{ dateBs: string }>>(
      await admin.get("/field-duty/today", { section: "COMMUNITY_PHC" })
    );
    const dateBs = ctx[0]?.dateBs ?? "empty";
    pass(
      "GET /field-duty/today?section=COMMUNITY_PHC",
      `${ctx.length} active, dateBs=${dateBs}`
    );
  } catch (e) {
    fail(
      "GET /field-duty/today?section=COMMUNITY_PHC",
      e instanceof Error ? e.message : String(e)
    );
  }

  try {
    const ctx = unwrap<unknown[]>(
      await admin.get("/field-duty/today", { section: "HOSPITAL" })
    );
    pass(
      "GET /field-duty/today?section=HOSPITAL",
      `${Array.isArray(ctx) ? ctx.length : 0} active`
    );
  } catch (e) {
    fail(
      "GET /field-duty/today?section=HOSPITAL",
      e instanceof Error ? e.message : String(e)
    );
  }

  // Primary TEACHER is not in FIELD_READ; demo teacher often has COLLEGE_STAFF secondary.
  if (teacher) {
    try {
      const me = unwrap<{
        user?: { role?: string; secondaryRoles?: string[] };
        secondaryRoles?: string[];
      }>(await teacher.get("/auth/me"));
      // buildAuthResponse shape may nest under user or top-level
      const secondary =
        me.user?.secondaryRoles ??
        me.secondaryRoles ??
        [];
      const staffSecondary = secondary.some((r) =>
        ["COLLEGE_STAFF", "COLLEGE_ADMIN", "SUPER_ADMIN", "COLLEGE_VIEWER"].includes(r)
      );
      const res = await teacher.get("/field-duty/dashboard");
      if (staffSecondary && res.status === 200) {
        pass(
          "Teacher field-duty access via secondary role",
          `secondary=[${secondary.join(",")}]`
        );
      } else if (!staffSecondary && res.status === 403) {
        pass("Teacher without staff secondary blocked", "403 as expected");
      } else if (!staffSecondary && res.status === 200) {
        fail(
          "Teacher without staff secondary blocked",
          "primary TEACHER alone should not access field-duty"
        );
      } else {
        fail("Teacher field-duty role gate", errDetail(res));
      }
    } catch (e) {
      fail("Teacher field-duty role gate", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("Teacher field-duty role gate", "skipped — teacher login unavailable");
  }

  // Setup data for create
  let batchId = "";
  let yearId = "";
  let staffId = "";
  let academicYearBs = "2082/2083";
  let todayBs = "";

  try {
    const settings = unwrap<{ academicYearBs?: string }>(await admin.get("/settings"));
    if (settings.academicYearBs) academicYearBs = settings.academicYearBs;
    pass("GET /settings", `academicYearBs=${academicYearBs}`);
  } catch (e) {
    fail("GET /settings", e instanceof Error ? e.message : String(e));
  }

  try {
    const batches = unwrap<Array<{ _id: string; name: string }>>(
      await admin.get("/academics/batches")
    );
    const years = unwrap<Array<{ _id: string; name: string; batchId?: string }>>(
      await admin.get("/academics/years")
    );
    if (!batches.length) throw new Error("No batches in demo data");
    if (!years.length) throw new Error("No years in demo data");

    // Prefer a batch+year that has active students so attendance QA can run.
    let chosenBatch = batches[0]!;
    let chosenYear = years.find((y) => y.batchId === chosenBatch._id) ?? years[0]!;
    let studentCount = 0;

    for (const b of batches) {
      const yearsForBatch = years.filter((y) => y.batchId === b._id);
      for (const y of yearsForBatch.length ? yearsForBatch : years) {
        const candidates = unwrap<Array<{ _id: string }>>(
          await admin.get("/field-duty/assignable-students", {
            batchId: b._id,
            yearId: y._id
          })
        );
        if (candidates.length > 0) {
          chosenBatch = b;
          chosenYear = y;
          studentCount = candidates.length;
          break;
        }
      }
      if (studentCount > 0) break;
    }

    batchId = chosenBatch._id;
    yearId = chosenYear._id;
    pass(
      "GET batches/years with students",
      `${batches.length} batches; using ${chosenBatch.name} / ${chosenYear.name} (${studentCount} students)`
    );
  } catch (e) {
    fail("GET batches/years with students", e instanceof Error ? e.message : String(e));
  }

  try {
    const staffList = unwrap<Array<{ _id: string; fullName?: string; staffId?: string }>>(
      await admin.get("/college-staff", { status: "ACTIVE" })
    );
    if (!staffList.length) throw new Error("No active college staff");
    const preferred =
      staffList.find((s) => (s.fullName || "").toLowerCase().includes("anita")) ??
      staffList[0]!;
    staffId = preferred._id;
    pass(
      "GET college-staff",
      `${staffList.length}, coordinator=${preferred.fullName ?? staffId}`
    );
  } catch (e) {
    fail("GET college-staff", e instanceof Error ? e.message : String(e));
  }

  const createdIds: string[] = [];

  if (batchId && yearId && staffId) {
    try {
      const created = unwrap<{
        _id: string;
        postingType: string;
        siteName?: string;
        hospitalName?: string;
        postingSection?: string;
      }>(
        await admin.post("/field-duty/schedules", {
          academicYearBs,
          faculty: "HA",
          semesterBs: "",
          batchId,
          yearId,
          postingType: "COMMUNITY",
          siteName: `QA Community Site ${Date.now()}`,
          address: "QA Ward",
          department: "Community Health",
          ward: "",
          supervisorStaffId: staffId,
          assistantCoordinatorStaffIds: [],
          clinicalInstructorName: "",
          hospitalSupervisorName: "",
          startDateBs: "2080-01-01",
          endDateBs: "2090-12-30",
          shift: "DAY",
          remarks: "Field management QA — auto cleanup",
          status: "ACTIVE",
          rosterMode: "AUTO_BATCH_YEAR",
          assignedStudentIds: []
        })
      );
      createdIds.push(created._id);
      pass(
        "POST community posting",
        `id=${created._id}, type=${created.postingType}, section=${created.postingSection ?? "?"}`
      );
      if (created.postingType !== "COMMUNITY") {
        fail("Community posting type", `expected COMMUNITY got ${created.postingType}`);
      } else {
        pass("Community posting type", created.postingType);
      }
    } catch (e) {
      fail("POST community posting", e instanceof Error ? e.message : String(e));
    }

    try {
      const created = unwrap<{ _id: string; postingType: string }>(
        await admin.post("/field-duty/schedules", {
          academicYearBs,
          faculty: "HA",
          batchId,
          yearId,
          postingType: "HOSPITAL",
          siteName: `QA Hospital ${Date.now()}`,
          department: "Medicine",
          ward: "Ward A",
          supervisorStaffId: staffId,
          startDateBs: "2080-01-01",
          endDateBs: "2090-12-30",
          shift: "MORNING",
          status: "ACTIVE",
          rosterMode: "AUTO_BATCH_YEAR",
          assignedStudentIds: []
        })
      );
      createdIds.push(created._id);
      pass("POST hospital posting", `id=${created._id}, type=${created.postingType}`);
    } catch (e) {
      fail("POST hospital posting", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("Create postings", "Missing batchId/yearId/staffId — skipped");
  }

  if (createdIds[0]) {
    try {
      const rows = unwrap<Array<{ _id: string; postingType?: string }>>(
        await admin.get("/field-duty/schedules", { section: "COMMUNITY_PHC" })
      );
      const found = rows.some((r) => r._id === createdIds[0]);
      if (found) pass("Community section lists new posting");
      else fail("Community section lists new posting", "created id not in COMMUNITY_PHC list");
    } catch (e) {
      fail(
        "Community section lists new posting",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  if (createdIds[1]) {
    try {
      const rows = unwrap<Array<{ _id: string }>>(
        await admin.get("/field-duty/schedules", { section: "HOSPITAL" })
      );
      const found = rows.some((r) => r._id === createdIds[1]);
      if (found) pass("Hospital section lists new posting");
      else fail("Hospital section lists new posting", "created id not in HOSPITAL list");
    } catch (e) {
      fail("Hospital section lists new posting", e instanceof Error ? e.message : String(e));
    }
  }

  if (batchId && yearId) {
    try {
      const students = unwrap<Array<{ _id: string }>>(
        await admin.get("/field-duty/assignable-students", { batchId, yearId })
      );
      pass("GET assignable-students", `${students.length} student(s)`);
    } catch (e) {
      fail("GET assignable-students", e instanceof Error ? e.message : String(e));
    }
  }

  if (createdIds[0]) {
    try {
      const roster = unwrap<{ students: Array<{ _id: string }> }>(
        await admin.get(`/field-duty/schedules/${createdIds[0]}/roster`)
      );
      pass("GET roster", `${roster.students?.length ?? 0} student(s)`);
    } catch (e) {
      fail("GET roster", e instanceof Error ? e.message : String(e));
    }
  }

  if (createdIds[0]) {
    try {
      const ctx = unwrap<
        Array<{
          dateBs: string;
          schedule: { _id: string };
          students: Array<{ _id: string; fullName?: string }>;
          existingAttendance: { _id: string } | null;
        }>
      >(await admin.get("/field-duty/today", { section: "COMMUNITY_PHC" }));
      const hit = ctx.find((c) => c.schedule._id === createdIds[0]);
      if (!hit) {
        fail(
          "Today context has community posting",
          `not found among ${ctx.length} (date window may not include server today)`
        );
      } else {
        todayBs = hit.dateBs;
        pass(
          "Today context has community posting",
          `students=${hit.students.length}, dateBs=${todayBs}`
        );

        if (hit.students.length > 0) {
          try {
            const entries = hit.students.slice(0, 5).map((s, i) => ({
              studentId: s._id,
              status: i === 0 ? "PRESENT" : i === 1 ? "ABSENT" : "PRESENT",
              remarks: i === 1 ? "QA absent" : ""
            }));
            const submitted = unwrap<{ _id: string; status: string }>(
              await admin.post("/field-duty/attendance", {
                scheduleId: createdIds[0],
                dateBs: todayBs,
                entries,
                notes: "QA field attendance"
              })
            );
            pass(
              "POST field attendance",
              `id=${submitted._id}, status=${submitted.status}`
            );
          } catch (e) {
            fail("POST field attendance", e instanceof Error ? e.message : String(e));
          }
        } else {
          fail("POST field attendance", "roster empty — no students for batch/year");
        }
      }
    } catch (e) {
      fail(
        "Today context has community posting",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  try {
    const rows = unwrap<unknown[]>(
      await admin.get("/field-duty/attendance", { section: "COMMUNITY_PHC" })
    );
    pass("GET /field-duty/attendance?section=COMMUNITY_PHC", `${rows.length} record(s)`);
  } catch (e) {
    fail(
      "GET /field-duty/attendance?section=COMMUNITY_PHC",
      e instanceof Error ? e.message : String(e)
    );
  }

  try {
    const reports = unwrap<{ records?: unknown[]; flat?: unknown[] }>(
      await admin.get("/field-duty/reports", { section: "COMMUNITY_PHC" })
    );
    pass(
      "GET /field-duty/reports",
      `records=${reports.records?.length ?? 0}, flat=${reports.flat?.length ?? 0}`
    );
  } catch (e) {
    fail("GET /field-duty/reports", e instanceof Error ? e.message : String(e));
  }

  try {
    const mon = unwrap<Record<string, unknown>>(await admin.get("/field-duty/monitoring"));
    pass(
      "GET /field-duty/monitoring",
      `pending=${String(mon.pendingAttendance ?? "?")}`
    );
  } catch (e) {
    fail("GET /field-duty/monitoring", e instanceof Error ? e.message : String(e));
  }

  if (staff) {
    try {
      unwrap<Record<string, unknown>>(await staff.get("/field-duty/dashboard"));
      pass("Staff GET /field-duty/dashboard");
    } catch (e) {
      fail("Staff GET /field-duty/dashboard", e instanceof Error ? e.message : String(e));
    }

    try {
      const rows = unwrap<unknown[]>(
        await staff.get("/field-duty/schedules", { section: "COMMUNITY_PHC" })
      );
      pass("Staff GET schedules?section=COMMUNITY_PHC", `${rows.length} posting(s)`);
    } catch (e) {
      fail(
        "Staff GET schedules?section=COMMUNITY_PHC",
        e instanceof Error ? e.message : String(e)
      );
    }
  } else {
    fail("Staff field-duty reads", "skipped — staff login unavailable");
  }

  if (student) {
    try {
      const portal = unwrap<{ totalMarked?: number; rows?: unknown[] }>(
        await student.get("/field-duty/portal/me")
      );
      pass(
        "Student GET /field-duty/portal/me",
        `rows=${portal.rows?.length ?? 0}, totalMarked=${portal.totalMarked ?? 0}`
      );
    } catch (e) {
      fail(
        "Student GET /field-duty/portal/me",
        e instanceof Error ? e.message : String(e)
      );
    }
  } else {
    fail("Student GET /field-duty/portal/me", "skipped — student login unavailable");
  }

  if (createdIds[0]) {
    try {
      const updated = unwrap<{ remarks?: string }>(
        await admin.put(`/field-duty/schedules/${createdIds[0]}`, {
          remarks: "Updated by QA"
        })
      );
      pass("PUT update posting", `remarks=${updated.remarks ?? ""}`);
    } catch (e) {
      fail("PUT update posting", e instanceof Error ? e.message : String(e));
    }
  }

  if (batchId && yearId && staffId) {
    try {
      const res = await admin.post("/field-duty/schedules", {
        academicYearBs,
        batchId,
        yearId,
        postingType: "PHC",
        siteName: "",
        hospitalName: "",
        supervisorStaffId: staffId,
        startDateBs: "2080-01-01",
        endDateBs: "2090-12-30",
        shift: "DAY",
        status: "ACTIVE",
        rosterMode: "AUTO_BATCH_YEAR"
      });
      if (res.status === 400) {
        pass("Validation rejects empty site name", "400 as expected");
      } else {
        fail("Validation rejects empty site name", `expected 400 got ${res.status}`);
        const id = (res.data.data as { _id?: string } | undefined)?._id;
        if (id) createdIds.push(id);
      }
    } catch (e) {
      fail(
        "Validation rejects empty site name",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  for (const id of createdIds) {
    try {
      const res = await admin.delete(`/field-duty/schedules/${id}`);
      if (res.status < 400) pass(`DELETE cleanup …${id.slice(-6)}`, "soft-deleted");
      else fail(`DELETE cleanup …${id.slice(-6)}`, errDetail(res));
    } catch (e) {
      fail(
        `DELETE cleanup …${id.slice(-6)}`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  try {
    unwrap(await admin.get("/field-duty/dashboard"));
    unwrap(await admin.get("/field-duty/schedules", { section: "COMMUNITY_PHC" }));
    unwrap(await admin.get("/field-duty/today", { section: "COMMUNITY_PHC" }));
    pass("Post-cleanup regression: dashboard + schedules + today still 200");
  } catch (e) {
    fail(
      "Post-cleanup regression: dashboard + schedules + today still 200",
      e instanceof Error ? e.message : String(e)
    );
  }

  summarizeAndExit();
};

const summarizeAndExit = () => {
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log("");
  process.exit(failed.length ? 1 : 0);
};

run().catch((error) => {
  console.error("QA crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
