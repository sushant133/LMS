import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const login = async (page, email, urlPattern) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "Demo@123456");
  await page.click('button[type="submit"]');
  await page.waitForURL(urlPattern, { timeout: 20000 });
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const checks = [];

  const record = (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    await login(page, "admin@demoerp.nepal-school.com", /\/dashboard\//);
    await page.goto(`${BASE}/exams-view`, { waitUntil: "networkidle" });
    const adminTitle = await page.getByText("Exams & Results").first().isVisible();
    const createExam = await page.getByText("Create Exam").first().isVisible();
    const examSessions = await page.getByText("Exam Sessions").first().isVisible();
    record("Admin exams page loads", adminTitle && createExam && examSessions);

    await page.getByRole("button", { name: /logout/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });

    await login(page, "student01@demoerp.nepal-school.com", /\/my-subjects|\/exams/);
    await page.goto(`${BASE}/exams`, { waitUntil: "networkidle" });
    const studentRoutine = await page.getByText("Upcoming Exam Routines").isVisible().catch(() => false);
    const studentResults = (await page.getByText(/published results|No published results/i).count()) > 0;
    record("Student exams portal loads", studentRoutine || studentResults, studentRoutine ? "routines visible" : "results section visible");

    await page.getByRole("button", { name: /logout/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });

    await login(page, "ram.sharma@demoerp.nepal-school.com", /\/dashboard\//);
    await page.goto(`${BASE}/exams`, { waitUntil: "networkidle" });
    const teacherMarks = await page.getByText("Enter Marks").first().isVisible();
    const teacherRoutines = await page.getByText("My Exam Routines").first().isVisible();
    record("Teacher exams page loads", teacherMarks && teacherRoutines);
  } catch (error) {
    record("UI smoke test", false, error instanceof Error ? error.message : String(error));
  }

  await browser.close();

  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} UI checks passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});