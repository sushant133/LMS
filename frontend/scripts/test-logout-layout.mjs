import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const snapshot = async (label) => {
    return page.evaluate((tag) => {
      const mobileHero = document.querySelector(".lg\\:hidden");
      const desktopHero = document.querySelector(".hidden.lg\\:flex, .hidden.p-12.text-white");
      const allHiddenLgFlex = [...document.querySelectorAll("[class*='lg:flex']")];
      const desktopCandidate = allHiddenLgFlex.find((el) => el.className.includes("hidden") && el.className.includes("lg:flex"));
      const appLayout = document.querySelector("aside");
      const grid = document.querySelector(".lg\\:grid-cols-\\[1\\.2fr_0\\.8fr\\]");
      const root = document.getElementById("root");

      const styleOf = (el) =>
        el
          ? {
              display: getComputedStyle(el).display,
              visibility: getComputedStyle(el).visibility,
              width: getComputedStyle(el).width,
              className: el.className
            }
          : null;

      return {
        tag,
        url: location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        rootWidth: root ? getComputedStyle(root).width : null,
        bodyStyles: {
          overflow: document.body.style.overflow,
          position: document.body.style.position,
          top: document.body.style.top,
          width: document.body.style.width
        },
        hasAppLayoutAside: Boolean(appLayout),
        grid: styleOf(grid),
        mobileHero: styleOf(mobileHero),
        desktopHero: styleOf(desktopCandidate ?? desktopHero),
        h2Count: document.querySelectorAll("h2").length,
        h2Text: document.querySelector("h2")?.textContent?.slice(0, 60) ?? null
      };
    }, label);
  };

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const fresh = await snapshot("fresh-login");

  await page.fill('input[type="email"]', "admin@demoerp.nepal-school.com");
  await page.fill('input[type="password"]', "Demo@123456");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });

  await page.getByRole("button", { name: /logout/i }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await page.waitForTimeout(500);

  const afterLogout = await snapshot("after-logout");

  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await snapshot("after-reload");

  console.log(JSON.stringify({ fresh, afterLogout, afterReload }, null, 2));
  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});