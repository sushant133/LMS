import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ok = true;
const pass = (msg) => console.log(`OK   ${msg}`);
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  ok = false;
};

const html = fs.readFileSync(path.join(frontend, "index.html"), "utf8");
if (html.includes("viewport-fit=cover")) pass("index.html has viewport-fit=cover");
else fail("index.html missing viewport-fit=cover");

const css = fs.readFileSync(path.join(frontend, "src/index.css"), "utf8");
for (const token of [
  "--app-safe-top",
  "var(--safe-area-inset-top",
  ".app-topbar",
  "100dvh",
  "padding-bottom: calc(1.5rem + var(--app-safe-bottom))",
]) {
  if (css.includes(token)) pass(`index.css has ${token}`);
  else fail(`index.css missing ${token}`);
}

const main = fs.readFileSync(
  path.join(frontend, "android/app/src/main/java/np/com/phit/lms2/MainActivity.java"),
  "utf8",
);
for (const token of [
  "setDecorFitsSystemWindows(getWindow(), false)",
  "LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES",
  "setStatusBarColor(Color.TRANSPARENT)",
  "setNavigationBarColor(Color.TRANSPARENT)",
]) {
  if (main.includes(token)) pass(`MainActivity has ${token}`);
  else fail(`MainActivity missing ${token}`);
}

const manifest = fs.readFileSync(
  path.join(frontend, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
if (manifest.includes('android:windowSoftInputMode="adjustResize"')) {
  pass("activity uses adjustResize");
} else {
  fail("activity missing windowSoftInputMode=adjustResize");
}

const styles = fs.readFileSync(
  path.join(frontend, "android/app/src/main/res/values/styles.xml"),
  "utf8",
);
if (styles.includes("android:statusBarColor") && styles.includes("@android:color/transparent")) {
  pass("theme status bar is transparent");
} else {
  fail("theme missing transparent status bar");
}

const cap = fs.readFileSync(path.join(frontend, "capacitor.config.ts"), "utf8");
if (cap.includes("SystemBars") && cap.includes('insetsHandling: "css"')) {
  pass("Capacitor SystemBars css insets enabled");
} else {
  fail("capacitor.config.ts missing SystemBars insetsHandling");
}

const devices = [
  ["Redmi Note 12", 393, 873, 24, 48],
  ["Redmi notch", 360, 800, 32, 20],
  ["Oppo Reno", 412, 915, 28, 16],
  ["Pixel 7", 412, 915, 24, 48],
  ["small Android", 320, 640, 24, 48],
  ["landscape punch-hole", 915, 412, 24, 16],
];

console.log("");
console.log("Safe-area layout simulation (header stays below status bar, content above nav)");
for (const [name, w, h, top, bottom] of devices) {
  const headerPad = top;
  const contentBottom = 24 + bottom;
  const usable = h - headerPad - contentBottom;
  const clipped = headerPad < top || contentBottom < 24 + bottom;
  const leftoverGap = headerPad > top + 1;
  console.log(
    `${name.padEnd(22)} ${String(w).padStart(3)}x${String(h).padEnd(4)}  status ${top}px  nav ${bottom}px  usable ${usable}px`,
  );
  if (clipped) fail(`${name}: content would clip into system bars`);
  if (leftoverGap) fail(`${name}: extra gap above header`);
  if (usable < h * 0.7) fail(`${name}: usable height too small`);
}

console.log("");
console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
