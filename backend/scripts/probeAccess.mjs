/**
 * Quick probe: login + academics + academic-management dashboard
 * Usage: node scripts/probeAccess.mjs [email] [password]
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
const email = process.argv[2] || "admin@demoerp.nepal-school.com";
const password = process.argv[3] || "Demo@123456";

const jar = new Map();

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() || [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

const login = await req("POST", "/auth/login", { email, password });
console.log("login", login.status, login.json?.data?.user?.role || login.json?.message);

const paths = [
  "/academics/batches",
  "/academics/years",
  "/academics/subjects",
  "/academic-management/dashboard",
  "/academic-management/dashboard?academicYearBs=" + encodeURIComponent("2083/2084"),
];

for (const p of paths) {
  const r = await req("GET", p);
  const msg = r.json?.message || r.json?.error || "";
  console.log(r.status, p, msg.slice(0, 120));
  if (r.status >= 500 && r.json) {
    console.log("  detail:", JSON.stringify(r.json).slice(0, 400));
  }
}
