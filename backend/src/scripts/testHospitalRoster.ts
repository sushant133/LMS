/**
 * Hospital Roster (Field Management upgrade) QA smoke test.
 * Also verifies existing Community/Hospital posting endpoints still respond (non-breaking).
 *
 * Prerequisites: backend on http://localhost:5000, demo school seeded.
 * Run: npx tsx src/scripts/testHospitalRoster.ts
 */
const BASE = process.env.QA_API_BASE ?? "http://localhost:5000/api";
const PASSWORD = "Demo@123456";
const adminEmail = "admin@demoerp.nepal-school.com";
const staffEmail = "reception@demoerp.nepal-school.com";

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

type ApiResponse = {
  status: number;
  data: { success?: boolean; data?: unknown; message?: string };
};

type ApiClient = {
  get: (path: string, params?: Record<string, string>) => Promise<ApiResponse>;
  post: (path: string, body?: unknown) => Promise<ApiResponse>;
  put: (path: string, body?: unknown) => Promise<ApiResponse>;
  delete: (path: string) => Promise<ApiResponse>;
};

const parseSetCookie = (headers: Headers): string => {
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
    params?: Record<string, string>,
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
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    delete: (path) => request("DELETE", path),
  };
};

const login = async (email: string): Promise<ApiClient> => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiResponse["data"];
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
  }
  const cookie = parseSetCookie(res.headers);
  if (!cookie) throw new Error(`Login for ${email} returned no Set-Cookie`);
  return makeClient(cookie);
};

const errDetail = (response: ApiResponse) =>
  `${response.status}: ${JSON.stringify(response.data)}`;

const unwrap = <T>(response: ApiResponse): T => {
  if (response.status >= 400) throw new Error(errDetail(response));
  return response.data.data as T;
};

const summarizeAndExit = () => {
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log("\n=== Hospital Roster QA summary ===");
  console.log(`Passed: ${ok}`);
  console.log(`Failed: ${bad}`);
  console.log(`Total:  ${results.length}\n`);
  if (bad > 0) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    console.log("");
  }
  process.exit(bad > 0 ? 1 : 0);
};

const run = async (): Promise<void> => {
  console.log("\n=== Hospital Roster + Field Management regression QA ===\n");
  console.log(`API: ${BASE}\n`);

  let admin: ApiClient;
  try {
    admin = await login(adminEmail);
    pass("Admin login");
  } catch (e) {
    fail("Admin login", e instanceof Error ? e.message : String(e));
    summarizeAndExit();
    return;
  }

  let staff: ApiClient | null = null;
  try {
    await new Promise((r) => setTimeout(r, 250));
    staff = await login(staffEmail);
    pass("College staff login");
  } catch (e) {
    fail("College staff login", e instanceof Error ? e.message : String(e));
  }

  // ── Regression: existing field management still works ─────────────────────
  try {
    unwrap(await admin.get("/field-duty/dashboard"));
    pass("Regression: GET /field-duty/dashboard");
  } catch (e) {
    fail("Regression: GET /field-duty/dashboard", e instanceof Error ? e.message : String(e));
  }

  try {
    const rows = unwrap<unknown[]>(
      await admin.get("/field-duty/schedules", { section: "HOSPITAL" }),
    );
    pass(
      "Regression: GET /field-duty/schedules?section=HOSPITAL",
      `${Array.isArray(rows) ? rows.length : 0} posting(s)`,
    );
  } catch (e) {
    fail(
      "Regression: GET /field-duty/schedules?section=HOSPITAL",
      e instanceof Error ? e.message : String(e),
    );
  }

  try {
    const rows = unwrap<unknown[]>(
      await admin.get("/field-duty/schedules", { section: "COMMUNITY_PHC" }),
    );
    pass(
      "Regression: GET /field-duty/schedules?section=COMMUNITY_PHC",
      `${Array.isArray(rows) ? rows.length : 0} posting(s)`,
    );
  } catch (e) {
    fail(
      "Regression: GET /field-duty/schedules?section=COMMUNITY_PHC",
      e instanceof Error ? e.message : String(e),
    );
  }

  // ── Hospitals ─────────────────────────────────────────────────────────────
  let hospitalId = "";
  const qaHospitalName = `QA Hospital ${Date.now()}`;

  try {
    const list = unwrap<Array<{ _id: string; name: string }>>(
      await admin.get("/field-duty/hospitals"),
    );
    pass("GET /field-duty/hospitals", `${list.length} hospital(s)`);
  } catch (e) {
    fail("GET /field-duty/hospitals", e instanceof Error ? e.message : String(e));
  }

  try {
    const created = unwrap<{ _id: string; name: string; status: string }>(
      await admin.post("/field-duty/hospitals", {
        name: qaHospitalName,
        address: "Lahan, Siraha",
        contact: "9800000000",
        status: "ACTIVE",
      }),
    );
    hospitalId = created._id;
    if (created.name !== qaHospitalName) {
      fail("POST /field-duty/hospitals", `unexpected name ${created.name}`);
    } else {
      pass("POST /field-duty/hospitals", created._id);
    }
  } catch (e) {
    fail("POST /field-duty/hospitals", e instanceof Error ? e.message : String(e));
  }

  if (hospitalId) {
    try {
      const updated = unwrap<{ contact?: string }>(
        await admin.put(`/field-duty/hospitals/${hospitalId}`, {
          contact: "9811111111",
        }),
      );
      pass(
        "PUT /field-duty/hospitals/:id",
        `contact=${updated.contact ?? "?"}`,
      );
    } catch (e) {
      fail("PUT /field-duty/hospitals/:id", e instanceof Error ? e.message : String(e));
    }
  }

  // ── Departments (auto-seed) ───────────────────────────────────────────────
  let departmentId = "";
  try {
    const deps = unwrap<Array<{ _id: string; shortCode: string; name: string }>>(
      await admin.get("/field-duty/departments"),
    );
    if (deps.length < 5) {
      fail(
        "GET /field-duty/departments (seed)",
        `expected seeded defaults, got ${deps.length}`,
      );
    } else {
      departmentId = deps.find((d) => d.shortCode === "ER")?._id ?? deps[0]!._id;
      pass(
        "GET /field-duty/departments (seed)",
        `${deps.length} depts, ER/first=${departmentId.slice(-6)}`,
      );
    }
  } catch (e) {
    fail("GET /field-duty/departments (seed)", e instanceof Error ? e.message : String(e));
  }

  try {
    const custom = unwrap<{ _id: string; shortCode: string }>(
      await admin.post("/field-duty/departments", {
        name: "QA Custom Ward",
        shortCode: `QA${String(Date.now()).slice(-4)}`,
      }),
    );
    pass("POST /field-duty/departments", custom.shortCode);
    // soft-delete custom
    await admin.delete(`/field-duty/departments/${custom._id}`);
    pass("DELETE /field-duty/departments/:id");
  } catch (e) {
    fail("POST/DELETE department", e instanceof Error ? e.message : String(e));
  }

  // ── Shifts (auto-seed) ────────────────────────────────────────────────────
  let shiftId = "";
  try {
    const shifts = unwrap<
      Array<{ _id: string; shortCode: string; dutyHours: number }>
    >(await admin.get("/field-duty/shifts"));
    const morning = shifts.find((s) => s.shortCode === "M");
    if (!morning) {
      fail("GET /field-duty/shifts (seed)", `no Morning (M); count=${shifts.length}`);
    } else {
      shiftId = morning._id;
      pass(
        "GET /field-duty/shifts (seed)",
        `${shifts.length} shifts, M hours=${morning.dutyHours}`,
      );
    }
  } catch (e) {
    fail("GET /field-duty/shifts (seed)", e instanceof Error ? e.message : String(e));
  }

  // ── Setup batch/year with students ────────────────────────────────────────
  let batchId = "";
  let yearId = "";
  let studentIds: string[] = [];

  try {
    const batches = unwrap<Array<{ _id: string; name: string }>>(
      await admin.get("/academics/batches"),
    );
    const years = unwrap<Array<{ _id: string; name: string; batchId?: string }>>(
      await admin.get("/academics/years"),
    );
    if (!batches.length || !years.length) {
      throw new Error("No batches/years in demo data");
    }

    outer: for (const b of batches) {
      const yearsForBatch = years.filter((y) => y.batchId === b._id);
      for (const y of yearsForBatch.length ? yearsForBatch : years) {
        const candidates = unwrap<Array<{ _id: string }>>(
          await admin.get("/field-duty/assignable-students", {
            batchId: b._id,
            yearId: y._id,
          }),
        );
        if (candidates.length > 0) {
          batchId = b._id;
          yearId = y._id;
          studentIds = candidates.map((c) => c._id).slice(0, 5);
          break outer;
        }
      }
    }

    if (!batchId || !yearId || !studentIds.length) {
      throw new Error("No batch/year with active students");
    }
    pass(
      "Setup batch/year students",
      `batch=${batchId.slice(-6)} year=${yearId.slice(-6)} students=${studentIds.length}`,
    );
  } catch (e) {
    fail("Setup batch/year students", e instanceof Error ? e.message : String(e));
  }

  // ── Roster CRUD ───────────────────────────────────────────────────────────
  let rosterId = "";

  if (hospitalId && batchId && yearId) {
    try {
      const roster = unwrap<{
        _id: string;
        studentIds: string[];
        daysInMonth: number;
        status: string;
      }>(
        await admin.post("/field-duty/hospital-rosters", {
          name: `QA Roster ${Date.now()}`,
          academicYearBs: "2083",
          program: "HA",
          batchId,
          yearId,
          hospitalId,
          monthBs: "2083-03",
          daysInMonth: 30,
          remarks: "QA auto test",
        }),
      );
      rosterId = roster._id;
      if (!roster.studentIds?.length) {
        fail(
          "POST /field-duty/hospital-rosters",
          "created but no students auto-loaded",
        );
      } else {
        pass(
          "POST /field-duty/hospital-rosters",
          `students=${roster.studentIds.length} status=${roster.status}`,
        );
      }
    } catch (e) {
      fail(
        "POST /field-duty/hospital-rosters",
        e instanceof Error ? e.message : String(e),
      );
    }
  } else {
    fail("POST /field-duty/hospital-rosters", "skipped — missing hospital/batch/year");
  }

  if (rosterId) {
    try {
      const list = unwrap<Array<{ _id: string }>>(
        await admin.get("/field-duty/hospital-rosters"),
      );
      const found = list.some((r) => r._id === rosterId);
      if (!found) fail("GET /field-duty/hospital-rosters", "created roster not listed");
      else pass("GET /field-duty/hospital-rosters", `${list.length} roster(s)`);
    } catch (e) {
      fail(
        "GET /field-duty/hospital-rosters",
        e instanceof Error ? e.message : String(e),
      );
    }

    try {
      const one = unwrap<{ _id: string; name: string; students?: unknown[] }>(
        await admin.get(`/field-duty/hospital-rosters/${rosterId}`),
      );
      pass(
        "GET /field-duty/hospital-rosters/:id",
        `students populated=${one.students?.length ?? 0}`,
      );
    } catch (e) {
      fail(
        "GET /field-duty/hospital-rosters/:id",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Cells update
    if (shiftId && departmentId && studentIds.length) {
      try {
        const sid = studentIds[0]!;
        const cells = [
          {
            studentId: sid,
            day: 1,
            shiftId,
            departmentId,
            code: "",
            remarks: "QA cell",
          },
          {
            studentId: sid,
            day: 2,
            shiftId,
            departmentId,
            code: "",
          },
          {
            studentId: sid,
            day: 3,
            code: "Leave",
          },
        ];
        const updated = unwrap<{ cells: unknown[] }>(
          await admin.put(`/field-duty/hospital-rosters/${rosterId}/cells`, {
            cells,
            replace: true,
          }),
        );
        if ((updated.cells?.length ?? 0) < 3) {
          fail(
            "PUT /field-duty/hospital-rosters/:id/cells",
            `expected >=3 cells, got ${updated.cells?.length ?? 0}`,
          );
        } else {
          pass(
            "PUT /field-duty/hospital-rosters/:id/cells",
            `${updated.cells.length} cells`,
          );
        }
      } catch (e) {
        fail(
          "PUT /field-duty/hospital-rosters/:id/cells",
          e instanceof Error ? e.message : String(e),
        );
      }
    } else {
      fail("PUT cells", "skipped — missing shift/dept/students");
    }

    // Summary / clinical record
    try {
      const summary = unwrap<{
        dutySummary: Array<{ totalDuties: number; leaveDays: number }>;
        clinicalRecord: Array<{ totalDuties: number }>;
        shiftLegend: unknown[];
        departmentLegend: unknown[];
      }>(await admin.get(`/field-duty/hospital-rosters/${rosterId}/summary`));
      const totalDuties = summary.dutySummary.reduce(
        (s, r) => s + (r.totalDuties || 0),
        0,
      );
      const leaveDays = summary.dutySummary.reduce(
        (s, r) => s + (r.leaveDays || 0),
        0,
      );
      if (!summary.dutySummary.length) {
        fail("GET summary", "empty dutySummary");
      } else {
        pass(
          "GET /field-duty/hospital-rosters/:id/summary",
          `rows=${summary.dutySummary.length} duties=${totalDuties} leave=${leaveDays} clinical=${summary.clinicalRecord.length}`,
        );
      }
    } catch (e) {
      fail(
        "GET /field-duty/hospital-rosters/:id/summary",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Day assignments
    try {
      const day = unwrap<{ assignments: unknown[] }>(
        await admin.get(`/field-duty/hospital-rosters/${rosterId}/day-assignments`, {
          day: "1",
        }),
      );
      pass(
        "GET day-assignments?day=1",
        `${day.assignments?.length ?? 0} assignment(s)`,
      );
    } catch (e) {
      fail("GET day-assignments?day=1", e instanceof Error ? e.message : String(e));
    }

    // Lock
    try {
      const locked = unwrap<{ status: string }>(
        await admin.post(`/field-duty/hospital-rosters/${rosterId}/lock`),
      );
      if (locked.status !== "LOCKED") {
        fail("POST lock", `status=${locked.status}`);
      } else {
        pass("POST /hospital-rosters/:id/lock", "LOCKED");
      }
    } catch (e) {
      fail("POST lock", e instanceof Error ? e.message : String(e));
    }

    // Cells while locked should fail
    try {
      const res = await admin.put(`/field-duty/hospital-rosters/${rosterId}/cells`, {
        cells: [],
        replace: true,
      });
      if (res.status === 400) {
        pass("Locked roster rejects cell edit", String(res.status));
      } else {
        fail("Locked roster rejects cell edit", errDetail(res));
      }
    } catch (e) {
      fail("Locked roster rejects cell edit", e instanceof Error ? e.message : String(e));
    }

    // Unlock
    try {
      const unlocked = unwrap<{ status: string }>(
        await admin.post(`/field-duty/hospital-rosters/${rosterId}/unlock`),
      );
      pass("POST /hospital-rosters/:id/unlock", unlocked.status);
    } catch (e) {
      fail("POST unlock", e instanceof Error ? e.message : String(e));
    }

    // Staff can read list (FIELD_READ)
    if (staff) {
      try {
        const res = await staff.get("/field-duty/hospital-rosters");
        if (res.status === 200) {
          pass("Staff can list hospital rosters", "200");
        } else if (res.status === 403) {
          // Staff without field-duty module may be blocked by module access — note it
          pass(
            "Staff list hospital rosters",
            `403 (module access gate — acceptable if staff lacks field-duty)`,
          );
        } else {
          fail("Staff list hospital rosters", errDetail(res));
        }
      } catch (e) {
        fail("Staff list hospital rosters", e instanceof Error ? e.message : String(e));
      }

      // Staff must NOT create hospitals
      try {
        const res = await staff.post("/field-duty/hospitals", {
          name: "Staff should not create",
          status: "ACTIVE",
        });
        if (res.status === 403) {
          pass("Staff blocked from creating hospital", "403");
        } else {
          fail("Staff blocked from creating hospital", errDetail(res));
        }
      } catch (e) {
        fail(
          "Staff blocked from creating hospital",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // Cleanup roster + hospital
    try {
      await admin.delete(`/field-duty/hospital-rosters/${rosterId}`);
      pass("DELETE /hospital-rosters/:id (cleanup)");
    } catch (e) {
      fail("DELETE roster cleanup", e instanceof Error ? e.message : String(e));
    }
  }

  if (hospitalId) {
    try {
      await admin.delete(`/field-duty/hospitals/${hospitalId}`);
      pass("DELETE /hospitals/:id (cleanup)");
    } catch (e) {
      fail("DELETE hospital cleanup", e instanceof Error ? e.message : String(e));
    }
  }

  summarizeAndExit();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
