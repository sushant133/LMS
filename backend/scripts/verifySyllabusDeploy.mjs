/**
 * Run ON the VPS after deploy to verify syllabus safety code is live.
 *
 *   cd /var/www/LMS/backend && node scripts/verifySyllabusDeploy.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

const mustContain = (file, needle, label) => {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    checks.push({ ok: false, label: `${label}: missing ${file}` });
    return;
  }
  const text = readFileSync(path, "utf8");
  const ok = text.includes(needle);
  checks.push({
    ok,
    label: ok ? `${label}: found` : `${label}: MISSING "${needle}" in ${file}`
  });
};

// Compiled dist (what `npm start` / pm2 runs)
mustContain(
  "dist/utils/syllabusHierarchyService.js",
  "isEmptyHierarchyShell",
  "hierarchy empty-shell guard"
);
mustContain(
  "dist/utils/syllabusHierarchyService.js",
  "incomingEmptyShell",
  "hierarchy empty-shell branch"
);
mustContain(
  "dist/controllers/academicManagementController.js",
  "chaptersSnapshot",
  "update deep-clone chapters"
);
mustContain(
  "dist/controllers/academicManagementController.js",
  "Cannot submit an empty syllabus",
  "submit empty guard"
);
mustContain(
  "dist/utils/academicManagementService.js",
  "Always clone",
  "sanitize clone (or check source)"
);

// Source fallback if dist not built yet
if (!existsSync(resolve(root, "dist/controllers/academicManagementController.js"))) {
  checks.push({
    ok: false,
    label: "dist/ missing — run: npm run build  then restart pm2"
  });
}

console.log("\nSyllabus deploy verification\n");
let failed = 0;
for (const c of checks) {
  console.log(c.ok ? `  ✅ ${c.label}` : `  ❌ ${c.label}`);
  if (!c.ok) failed += 1;
}
console.log(
  failed === 0
    ? "\nOK — syllabus safety code is present in dist.\nRestart API: pm2 restart all\n"
    : "\nFAILED — rebuild backend and restart:\n  cd /var/www/LMS/backend && npm run build && pm2 restart all\n"
);
process.exit(failed === 0 ? 0 : 1);
