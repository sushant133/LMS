/**
 * QA: teacher pay types (monthly / tender / period) + salary sheet.
 *
 * Usage: node scripts/qaTeacherPaymentTypes.mjs
 */
import {
  calculateSalarySheetLine,
  calculateTenderThisMonthNpr,
  normalizeTeacherPaymentType,
  sumTeacherTenderAmountNpr,
  teacherSchema,
  TEACHER_PAYMENT_TYPES,
} from "../shared/dist/index.js";

const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
const ADMIN = {
  email: "admin@demoerp.nepal-school.com",
  password: "Demo@123456",
};

const findings = [];
const summary = { pass: 0, fail: 0, warn: 0, skip: 0 };

const rec = (kind, label, msg = "", extra = "") => {
  findings.push({ kind, label, msg, extra });
  if (kind.startsWith("FAIL")) summary.fail += 1;
  else if (kind.startsWith("WARN")) summary.warn += 1;
  else if (kind.startsWith("SKIP")) summary.skip += 1;
  else summary.pass += 1;
  const tag = kind.startsWith("FAIL")
    ? "FAIL"
    : kind.startsWith("WARN")
      ? "WARN"
      : kind.startsWith("SKIP")
        ? "SKIP"
        : "OK  ";
  console.log(`  ${tag} ${label}${msg ? ` — ${msg}` : ""}${extra ? ` ${extra}` : ""}`);
};

const assert = (ok, label, msg) => {
  if (ok) rec("PASS", label, msg);
  else rec("FAIL", label, msg);
};

const nearly = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) < eps;

/* -------------------------------------------------------------------------- */
/* 1. Formula unit tests                                                      */
/* -------------------------------------------------------------------------- */
console.log("\n======== 1. Salary formulas ========");

assert(
  TEACHER_PAYMENT_TYPES.join(",") === "MONTHLY,TENDER,PERIOD",
  "payment type enum",
  TEACHER_PAYMENT_TYPES.join(", "),
);
assert(normalizeTeacherPaymentType("period") === "PERIOD", "normalize PERIOD");
assert(normalizeTeacherPaymentType("") === "MONTHLY", "normalize empty → MONTHLY");
assert(normalizeTeacherPaymentType(undefined) === "MONTHLY", "normalize missing → MONTHLY");
assert(sumTeacherTenderAmountNpr([{ tenderAmountNpr: 40000 }, { tenderAmountNpr: 25000 }]) === 65000, "sum tenders");

const monthly = calculateSalarySheetLine({
  paymentType: "MONTHLY",
  monthlySalaryNpr: 30000,
  presentDays: 22,
  absentDays: 2,
  leaveDays: 0,
  extraDuty: 0,
  workingDaysInMonth: 24,
});
assert(nearly(monthly.perDaySalaryNpr, 1250), "monthly per-day", String(monthly.perDaySalaryNpr));
assert(nearly(monthly.absentDeductionNpr, 2500), "monthly absent deduction", String(monthly.absentDeductionNpr));
assert(nearly(monthly.salaryAmountNpr, 27500), "monthly salary amount", String(monthly.salaryAmountNpr));
assert(nearly(monthly.tax1PercentNpr, 275), "monthly 1% tax", String(monthly.tax1PercentNpr));
assert(nearly(monthly.netSalaryNpr, 27225), "monthly net", String(monthly.netSalaryNpr));

const monthlyLeave = calculateSalarySheetLine({
  paymentType: "MONTHLY",
  monthlySalaryNpr: 30000,
  presentDays: 21,
  absentDays: 2,
  leaveDays: 1,
  extraDuty: 1,
  workingDaysInMonth: 24,
});
assert(nearly(monthlyLeave.absentDeductionNpr, 3750), "monthly leave+absent deducts", String(monthlyLeave.absentDeductionNpr));
assert(nearly(monthlyLeave.extraAmountNpr, 1250), "monthly extra duty", String(monthlyLeave.extraAmountNpr));
assert(nearly(monthlyLeave.salaryAmountNpr, 27500), "monthly net of extra", String(monthlyLeave.salaryAmountNpr));

const period = calculateSalarySheetLine({
  paymentType: "PERIOD",
  monthlySalaryNpr: 500,
  presentDays: 20,
  absentDays: 2,
  leaveDays: 0,
  extraDuty: 1,
  workingDaysInMonth: 24,
  periodRateNpr: 500,
  periodsAttended: 12,
});
assert(nearly(period.absentDeductionNpr, 0), "period ignores absence", String(period.absentDeductionNpr));
assert(nearly(period.extraAmountNpr, 500), "period extra = 1 extra period", String(period.extraAmountNpr));
assert(nearly(period.salaryAmountNpr, 6500), "period 12×500 + extra", String(period.salaryAmountNpr));
assert(nearly(period.tax1PercentNpr, 65), "period 1% tax", String(period.tax1PercentNpr));
assert(nearly(period.netSalaryNpr, 6435), "period net", String(period.netSalaryNpr));

const periodZero = calculateSalarySheetLine({
  paymentType: "PERIOD",
  monthlySalaryNpr: 800,
  presentDays: 24,
  absentDays: 0,
  extraDuty: 0,
  workingDaysInMonth: 24,
  periodRateNpr: 800,
  periodsAttended: 0,
});
assert(nearly(periodZero.salaryAmountNpr, 0), "period with 0 classes pays 0", String(periodZero.salaryAmountNpr));

assert(nearly(calculateTenderThisMonthNpr(80000, 40, 10000), 22000), "tender 40% of 80k minus 10k");
assert(nearly(calculateTenderThisMonthNpr(50000, 100, 50000), 0), "tender fully paid stays 0");
assert(nearly(calculateTenderThisMonthNpr(50000, 120, 0), 50000), "tender percent capped at 100");
assert(nearly(calculateTenderThisMonthNpr(50000, 10, 20000), 0), "tender already-paid > earned");

const tender = calculateSalarySheetLine({
  paymentType: "TENDER",
  monthlySalaryNpr: 80000,
  presentDays: 0,
  absentDays: 5,
  leaveDays: 2,
  extraDuty: 3,
  workingDaysInMonth: 24,
  tenderThisMonthNpr: 22000,
});
assert(nearly(tender.absentDeductionNpr, 0), "tender ignores absence", String(tender.absentDeductionNpr));
assert(nearly(tender.extraAmountNpr, 0), "tender extra duty does not auto-convert", String(tender.extraAmountNpr));
assert(nearly(tender.salaryAmountNpr, 22000), "tender salary amount", String(tender.salaryAmountNpr));
assert(nearly(tender.netSalaryNpr, 21780), "tender net after 1%", String(tender.netSalaryNpr));

const tenderExtra = calculateSalarySheetLine({
  paymentType: "TENDER",
  monthlySalaryNpr: 80000,
  presentDays: 0,
  absentDays: 0,
  extraDuty: 0,
  workingDaysInMonth: 24,
  tenderThisMonthNpr: 22000,
  extraAmountOverrideNpr: 1500,
});
assert(nearly(tenderExtra.salaryAmountNpr, 23500), "tender + extra override", String(tenderExtra.salaryAmountNpr));

const staffDefault = calculateSalarySheetLine({
  monthlySalaryNpr: 18000,
  presentDays: 26,
  absentDays: 0,
  extraDuty: 0,
  workingDaysInMonth: 26,
});
assert(nearly(staffDefault.salaryAmountNpr, 18000), "staff unspecified type is monthly");

/* -------------------------------------------------------------------------- */
/* 2. Teacher schema                                                          */
/* -------------------------------------------------------------------------- */
console.log("\n======== 2. Teacher schema ========");

const baseTeacher = {
  fullName: "QA Pay Teacher",
  email: "qa.pay.teacher@demoerp.nepal-school.com",
  teacherCode: "QA-PAY-1",
  qualification: "MN",
  joinedDateBs: "2081-01-15",
  address: {
    province: "Bagmati Province",
    district: "Kathmandu",
    municipality: "Kathmandu Metropolitan City",
    ward: "1",
    streetAddress: "Putalisadak",
  },
  basicSalaryNpr: 25000,
};

const monthlyParse = teacherSchema.safeParse({ ...baseTeacher, paymentType: "MONTHLY" });
assert(monthlyParse.success, "schema monthly teacher");
if (monthlyParse.success) {
  assert(monthlyParse.data.paymentType === "MONTHLY", "schema defaulted monthly type");
  assert(Array.isArray(monthlyParse.data.tenders) && monthlyParse.data.tenders.length === 0, "schema monthly tenders empty");
}

const periodParse = teacherSchema.safeParse({
  ...baseTeacher,
  paymentType: "PERIOD",
  periodRateNpr: 600,
  basicSalaryNpr: 0,
});
assert(periodParse.success, "schema period teacher");
if (periodParse.success) {
  assert(periodParse.data.periodRateNpr === 600, "schema keeps period rate");
}

const tenderParse = teacherSchema.safeParse({
  ...baseTeacher,
  paymentType: "TENDER",
  basicSalaryNpr: 0,
  tenders: [
    {
      subjectId: "64b0f0f0f0f0f0f0f0f0f0f0",
      academicYearBs: "2082/2083",
      tenderAmountNpr: 45000,
      notes: "Anatomy theory",
    },
  ],
});
assert(tenderParse.success, "schema tender teacher");
if (tenderParse.success) {
  assert(tenderParse.data.tenders.length === 1, "schema keeps one tender");
  assert(tenderParse.data.tenders[0].tenderAmountNpr === 45000, "schema tender amount");
}

const badYear = teacherSchema.safeParse({
  ...baseTeacher,
  paymentType: "TENDER",
  tenders: [
    {
      subjectId: "64b0f0f0f0f0f0f0f0f0f0f0",
      academicYearBs: "2082",
      tenderAmountNpr: 1000,
    },
  ],
});
assert(!badYear.success, "schema rejects tender academic year that is not YYYY/YYYY");

const badType = teacherSchema.safeParse({ ...baseTeacher, paymentType: "HOURLY" });
assert(!badType.success, "schema rejects unknown pay type");

/* -------------------------------------------------------------------------- */
/* 3. Live API                                                                */
/* -------------------------------------------------------------------------- */
console.log("\n======== 3. Live API ========");

const makeJar = () => {
  const jar = new Map();
  return {
    store(res) {
      for (const cookie of res.headers.getSetCookie?.() || []) {
        const pair = cookie.split(";")[0];
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
};

const req = async (jar, method, path, body) => {
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
};

const unwrap = (r) => r.json?.data;
const teacherFrom = (r) => unwrap(r)?.teacher || unwrap(r);

let createdIds = [];
try {
  const healthUrl = `${String(BASE).replace(/\/api\/?$/, "")}/api/health`;
  let health = null;
  try {
    health = await fetch(healthUrl);
  } catch (error) {
    rec("SKIP-API", "backend not reachable", `${healthUrl} (${error instanceof Error ? error.message : error})`);
  }
  if (health && !health.ok) {
    rec("SKIP-API", "backend health not ok", `${health.status}`);
    health = null;
  }
  if (health) {
    const jar = makeJar();
    const login = await req(jar, "POST", "/auth/login", ADMIN);
    if (login.status !== 200) {
      rec("FAIL-LOGIN", "/auth/login", login.json?.message || `status ${login.status}`);
    } else {
      rec("LOGIN", "college admin", login.json?.data?.user?.role || "ok");

      const teachersRes = await req(jar, "GET", "/teachers");
      if (teachersRes.status !== 200) {
        rec("FAIL", "GET /teachers", teachersRes.json?.message, String(teachersRes.status));
      } else {
        const teachers = unwrap(teachersRes) || [];
        rec("PASS", `GET /teachers (${teachers.length})`);
        const missingType = teachers.filter((t) => t.paymentType && !TEACHER_PAYMENT_TYPES.includes(t.paymentType));
        assert(missingType.length === 0, "listed teachers have valid pay type");
        const withType = teachers.filter((t) => t.paymentType);
        rec(withType.length === teachers.length ? "PASS" : "WARN", "paymentType present on teacher list", `${withType.length}/${teachers.length}`);
      }

      const settingsRes = await req(jar, "GET", "/settings");
      const academicYearBs = unwrap(settingsRes)?.academicYearBs || "2082/2083";
      rec("PASS", "academic year", academicYearBs);

      const subjectsRes = await req(jar, "GET", "/academics/subjects");
      const subjects = unwrap(subjectsRes) || [];
      rec(subjectsRes.status === 200 ? "PASS" : "FAIL", "GET /academics/subjects", `${subjects.length} subject(s)`);
      const subjectId = subjects[0]?._id;

      const stamp = Date.now().toString(36).slice(-6);
      const address = {
        province: "Bagmati Province",
        district: "Kathmandu",
        municipality: "Kathmandu Metropolitan City",
        ward: "1",
        streetAddress: "Putalisadak",
      };

      const monthlyTeacher = await req(jar, "POST", "/teachers", {
        fullName: `QA Monthly ${stamp}`,
        email: `qa.monthly.${stamp}@demoerp.nepal-school.com`,
        teacherCode: `QAM-${stamp}`,
        qualification: "QA MN",
        joinedDateBs: "2081-04-01",
        address,
        basicSalaryNpr: 32000,
        paymentType: "MONTHLY",
        periodRateNpr: 0,
        tenders: [],
      });
      assert(
        monthlyTeacher.status === 201 || monthlyTeacher.status === 200,
        "create monthly teacher",
        monthlyTeacher.json?.message || String(monthlyTeacher.status),
      );
      const monthlyId = teacherFrom(monthlyTeacher)?._id;
      if (monthlyId) createdIds.push(String(monthlyId));
      if (monthlyId) {
        const got = unwrap(await req(jar, "GET", `/teachers/${monthlyId}`));
        assert(got?.paymentType === "MONTHLY" || !got?.paymentType, "monthly teacher persisted type", got?.paymentType);
        assert(Number(got?.basicSalaryNpr) === 32000, "monthly salary persisted", String(got?.basicSalaryNpr));
      }

      const periodTeacher = await req(jar, "POST", "/teachers", {
        fullName: `QA Period ${stamp}`,
        email: `qa.period.${stamp}@demoerp.nepal-school.com`,
        teacherCode: `QAP-${stamp}`,
        qualification: "QA MN",
        joinedDateBs: "2081-04-01",
        address,
        basicSalaryNpr: 0,
        paymentType: "PERIOD",
        periodRateNpr: 550,
        tenders: [],
      });
      assert(
        periodTeacher.status === 201 || periodTeacher.status === 200,
        "create period teacher",
        periodTeacher.json?.message || String(periodTeacher.status),
      );
      const periodId = teacherFrom(periodTeacher)?._id;
      if (periodId) createdIds.push(String(periodId));
      if (periodId) {
        const got = unwrap(await req(jar, "GET", `/teachers/${periodId}`));
        assert(got?.paymentType === "PERIOD", "period teacher persisted type", got?.paymentType);
        assert(Number(got?.periodRateNpr) === 550, "period rate persisted", String(got?.periodRateNpr));
      }

      if (subjectId) {
        const tenderTeacher = await req(jar, "POST", "/teachers", {
          fullName: `QA Tender ${stamp}`,
          email: `qa.tender.${stamp}@demoerp.nepal-school.com`,
          teacherCode: `QAT-${stamp}`,
          qualification: "QA MN",
          joinedDateBs: "2081-04-01",
          address,
          basicSalaryNpr: 0,
          paymentType: "TENDER",
          periodRateNpr: 0,
          tenders: [
            {
              subjectId,
              academicYearBs,
              tenderAmountNpr: 60000,
              notes: "QA subject tender",
            },
          ],
        });
        assert(
          tenderTeacher.status === 201 || tenderTeacher.status === 200,
          "create tender teacher",
          tenderTeacher.json?.message || String(tenderTeacher.status),
        );
        const tenderId = teacherFrom(tenderTeacher)?._id;
        if (tenderId) createdIds.push(String(tenderId));
        if (tenderId) {
          const got = unwrap(await req(jar, "GET", `/teachers/${tenderId}`));
          assert(got?.paymentType === "TENDER", "tender teacher persisted type", got?.paymentType);
          assert((got?.tenders || []).length >= 1, "tender rows persisted", String((got?.tenders || []).length));
          assert(
            Number(got?.tenders?.[0]?.tenderAmountNpr) === 60000,
            "tender amount persisted",
            String(got?.tenders?.[0]?.tenderAmountNpr),
          );
        }
      } else {
        rec("SKIP", "create tender teacher", "no subjects in this school");
      }

      const invalidTender = await req(jar, "POST", "/teachers", {
        fullName: `QA Bad Tender ${stamp}`,
        email: `qa.badtender.${stamp}@demoerp.nepal-school.com`,
        teacherCode: `QAB-${stamp}`,
        qualification: "QA MN",
        joinedDateBs: "2081-04-01",
        address,
        basicSalaryNpr: 0,
        paymentType: "TENDER",
        tenders: [
          {
            subjectId: "not-an-id",
            academicYearBs: "2082/2083",
            tenderAmountNpr: 1000,
          },
        ],
      });
      assert(invalidTender.status >= 400, "reject tender with invalid subjectId", String(invalidTender.status));

      const monthBs = "2083-04";
      const sheetRes = await req(jar, "GET", `/accounting/salary-sheet?monthBs=${monthBs}`);
      if (sheetRes.status !== 200) {
        rec("FAIL", "GET /accounting/salary-sheet", sheetRes.json?.message || String(sheetRes.status));
      } else {
        const sheet = unwrap(sheetRes) || {};
        const rows = sheet.rows || [];
        rec("PASS", `salary sheet ${monthBs}`, `${rows.length} row(s), workingDays=${sheet.workingDaysInMonth}`);
        const types = new Set(rows.map((r) => r.paymentType || "MONTHLY"));
        rec("PASS", "sheet pay types", [...types].join(", ") || "none");

        const periodRow = periodId
          ? rows.find((r) => r.teacherId && String(r.teacherId) === String(periodId))
          : undefined;
        if (periodRow) {
          assert(periodRow.paymentType === "PERIOD", "sheet includes period teacher");
          assert(Number(periodRow.periodRateNpr) === 550 || Number(periodRow.monthlySalaryNpr) === 550, "sheet period rate", String(periodRow.periodRateNpr ?? periodRow.monthlySalaryNpr));
          assert(Number(periodRow.absentDeductionNpr) === 0, "sheet period has no absence deduction");
          const expected = calculateSalarySheetLine({
            paymentType: "PERIOD",
            monthlySalaryNpr: periodRow.monthlySalaryNpr,
            presentDays: periodRow.presentDays,
            absentDays: periodRow.absentDays,
            leaveDays: periodRow.leaveDays,
            extraDuty: periodRow.extraDuty,
            workingDaysInMonth: sheet.workingDaysInMonth,
            periodRateNpr: periodRow.periodRateNpr,
            periodsAttended: periodRow.periodsAttended,
          });
          assert(nearly(periodRow.netSalaryNpr, expected.netSalaryNpr), "sheet period net matches formula", `${periodRow.netSalaryNpr} vs ${expected.netSalaryNpr}`);
        } else {
          rec("WARN", "period teacher not on sheet (may be filtered if inactive)");
        }

        const tenderRow = rows.find((r) => createdIds.includes(String(r.teacherId)) && r.paymentType === "TENDER");
        if (tenderRow) {
          assert(Number(tenderRow.tenderAmountNpr) === 60000 || Number(tenderRow.monthlySalaryNpr) === 60000, "sheet tender contract", String(tenderRow.tenderAmountNpr ?? tenderRow.monthlySalaryNpr));
          assert(Number(tenderRow.absentDeductionNpr) === 0, "sheet tender has no absence deduction");
          const expected = calculateSalarySheetLine({
            paymentType: "TENDER",
            monthlySalaryNpr: tenderRow.monthlySalaryNpr,
            presentDays: tenderRow.presentDays,
            absentDays: tenderRow.absentDays,
            extraDuty: tenderRow.extraDuty,
            workingDaysInMonth: sheet.workingDaysInMonth,
            tenderThisMonthNpr: tenderRow.tenderThisMonthNpr,
          });
          assert(nearly(tenderRow.netSalaryNpr, expected.netSalaryNpr), "sheet tender net matches formula", `${tenderRow.netSalaryNpr} vs ${expected.netSalaryNpr}`);
        } else if (subjectId) {
          rec("WARN", "tender teacher not on sheet");
        }

        const monthlyRow = monthlyId
          ? rows.find((r) => r.teacherId && String(r.teacherId) === String(monthlyId))
          : undefined;
        if (monthlyRow) {
          assert((monthlyRow.paymentType || "MONTHLY") === "MONTHLY", "sheet monthly type");
          const expected = calculateSalarySheetLine({
            paymentType: "MONTHLY",
            monthlySalaryNpr: monthlyRow.monthlySalaryNpr,
            presentDays: monthlyRow.presentDays,
            absentDays: monthlyRow.absentDays,
            leaveDays: monthlyRow.leaveDays,
            extraDuty: monthlyRow.extraDuty,
            workingDaysInMonth: sheet.workingDaysInMonth,
          });
          assert(nearly(monthlyRow.netSalaryNpr, expected.netSalaryNpr), "sheet monthly net matches formula", `${monthlyRow.netSalaryNpr} vs ${expected.netSalaryNpr}`);
        }

        const staffRows = rows.filter((r) => r.employeeType === "STAFF");
        const staffBad = staffRows.filter((r) => r.paymentType && r.paymentType !== "MONTHLY");
        assert(staffBad.length === 0, "staff rows stay monthly", `${staffRows.length} staff`);
      }

      const employeesRes = await req(jar, "GET", "/accounting/salary-employees");
      if (employeesRes.status === 200) {
        const employees = unwrap(employeesRes) || {};
        const empTeachers = employees.teachers || [];
        const qaEmp = empTeachers.filter((t) => createdIds.includes(String(t._id || "")));
        rec("PASS", "GET /accounting/salary-employees", `${empTeachers.length} teachers, ${qaEmp.length} QA`);
        for (const t of qaEmp) {
          if (!t.paymentType) rec("FAIL", "salary-employees missing paymentType", t._id);
        }
      } else {
        rec("FAIL", "GET /accounting/salary-employees", String(employeesRes.status));
      }
    }
  }
} catch (error) {
  rec("FAIL-API", "unexpected", error instanceof Error ? error.message : String(error));
} finally {
  const jar = makeJar();
  const login = await req(jar, "POST", "/auth/login", ADMIN);
  if (login.status === 200) {
    const listed = unwrap(await req(jar, "GET", "/teachers?includeInactive=true")) || [];
    for (const t of listed) {
      const email = String(t.user?.email || "");
      const name = String(t.user?.fullName || "");
      const isQa =
        email.startsWith("qa.monthly.") ||
        email.startsWith("qa.period.") ||
        email.startsWith("qa.tender.") ||
        name.startsWith("QA Monthly ") ||
        name.startsWith("QA Period ") ||
        name.startsWith("QA Tender ");
      if (isQa && t._id && !createdIds.includes(String(t._id))) {
        createdIds.push(String(t._id));
      }
    }
    for (const id of createdIds) {
      const del = await req(jar, "DELETE", `/teachers/${id}`);
      rec(
        del.status === 200 || del.status === 204 ? "PASS" : "WARN",
        `cleanup teacher ${id}`,
        del.json?.message || String(del.status),
      );
    }
  }
}

console.log("\n======== QA summary ========");
console.log(`  pass=${summary.pass}  fail=${summary.fail}  warn=${summary.warn}  skip=${summary.skip}`);
if (summary.fail) {
  console.log("\nFailures:");
  for (const row of findings.filter((f) => f.kind.startsWith("FAIL"))) {
    console.log(`  - ${row.label}: ${row.msg} ${row.extra}`);
  }
  process.exit(1);
}
console.log("QA Teacher payment types: PASS");
