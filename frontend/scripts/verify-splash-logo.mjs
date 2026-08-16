import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "..");
const res = path.join(frontend, "android/app/src/main/res");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

let ok = true;
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  ok = false;
};
const pass = (msg) => console.log(`OK   ${msg}`);

const leftover = walk(res).filter((file) => path.basename(file) === "splash.png");
if (leftover.length) fail(`leftover splash.png: ${leftover.join(", ")}`);
else pass("no leftover full-bleed splash.png");

const required = [
  "drawable/splash.xml",
  "layout/launch_splash.xml",
  "values/colors.xml",
  "values/styles.xml",
  "values-v31/styles.xml",
];
for (const rel of required) {
  if (fs.existsSync(path.join(res, rel))) pass(rel);
  else fail(`missing ${rel}`);
}

const densities = [
  ["mdpi", 120, 240],
  ["hdpi", 180, 360],
  ["xhdpi", 240, 480],
  ["xxhdpi", 360, 720],
  ["xxxhdpi", 480, 960],
];
for (const [density, logoSize, iconSize] of densities) {
  for (const [name, expected] of [
    ["splash_logo.png", logoSize],
    ["splash_icon.png", iconSize],
  ]) {
    const file = path.join(res, `drawable-${density}`, name);
    if (!fs.existsSync(file)) {
      fail(`missing drawable-${density}/${name}`);
      continue;
    }
    const buf = fs.readFileSync(file);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width === expected && height === expected) {
      pass(`drawable-${density}/${name} is ${width}x${height}`);
    } else {
      fail(`drawable-${density}/${name} is ${width}x${height}, expected ${expected}x${expected}`);
    }
  }
}

if (fs.existsSync(path.join(res, "drawable-nodpi"))) {
  fail("drawable-nodpi still present (MIUI often fails to load nodpi splash icons)");
} else {
  pass("no drawable-nodpi splash assets");
}

const styles = fs.readFileSync(path.join(res, "values/styles.xml"), "utf8");
for (const token of [
  "windowSplashScreenAnimatedIcon",
  "windowSplashScreenBackground",
  "@drawable/splash_icon",
  "@color/splash_background",
]) {
  if (styles.includes(token)) pass(`styles has ${token}`);
  else fail(`styles missing ${token}`);
}
if (styles.includes('android:background">@drawable/splash')) {
  pass("styles uses centered splash drawable as MIUI fallback background");
} else {
  fail("styles missing @drawable/splash window background fallback");
}
if (styles.includes('android:background">@color/splash_background')) {
  fail("styles still uses a solid color background that hides the logo on MIUI");
} else {
  pass("styles does not use a solid-color splash background");
}
if (styles.includes("forceDarkAllowed")) {
  pass("styles disables force-dark (MIUI inversion)");
} else {
  fail("styles missing forceDarkAllowed=false");
}

const layout = fs.readFileSync(path.join(res, "layout/launch_splash.xml"), "utf8");
for (const token of [
  'android:layout_gravity="center"',
  'android:layout_width="120dp"',
  'android:layout_height="120dp"',
  'android:scaleType="fitCenter"',
  "@drawable/splash_logo",
]) {
  if (layout.includes(token)) pass(`layout has ${token}`);
  else fail(`layout missing ${token}`);
}

const splashTs = fs.readFileSync(path.join(frontend, "src/components/SplashScreen.tsx"), "utf8");
for (const token of ["flex items-center justify-center", "22vmin", "object-contain"]) {
  if (splashTs.includes(token)) pass(`SplashScreen has ${token}`);
  else fail(`SplashScreen missing ${token}`);
}
if (splashTs.includes("w-40") || splashTs.includes("160px")) {
  fail("SplashScreen still uses fixed 160px logo");
} else {
  pass("SplashScreen no longer uses 160px logo");
}

const splashXml = fs.readFileSync(path.join(res, "drawable/splash.xml"), "utf8");
if (splashXml.includes("android:width") || splashXml.includes("android:height")) {
  fail("splash.xml uses item width/height which some MIUI builds drop");
} else {
  pass("splash.xml avoids item width/height");
}
if (splashXml.includes('android:gravity="center"') && splashXml.includes("@drawable/splash_logo")) {
  pass("splash.xml centers density-correct splash_logo");
} else {
  fail("splash.xml is not a centered logo layer-list");
}

const mainActivity = fs.readFileSync(
  path.join(frontend, "android/app/src/main/java/np/com/phit/lms2/MainActivity.java"),
  "utf8",
);
if (mainActivity.includes("R.drawable.splash")) {
  pass("MainActivity pins splash drawable as window background");
} else {
  fail("MainActivity does not set splash window background");
}

const capConfig = fs.readFileSync(path.join(frontend, "capacitor.config.ts"), "utf8");
if (capConfig.includes('useDialog: true') && capConfig.includes('layoutName: "launch_splash"')) {
  pass("Capacitor splash uses dialog + launch_splash layout");
} else {
  fail("Capacitor splash missing useDialog/layoutName fallback");
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const devices = [
  ["Galaxy Fold cover", 280, 653],
  ["iPhone SE", 320, 568],
  ["small Android", 320, 640],
  ["Galaxy S21", 360, 800],
  ["iPhone 8", 375, 667],
  ["iPhone 14", 390, 844],
  ["Pixel 7", 412, 915],
  ["iPhone SE landscape", 568, 320],
  ["iPad Mini", 768, 1024],
  ["Pixel 7 landscape", 915, 412],
];

console.log("");
console.log("Viewport simulation (1rem = 16px)");
console.log(
  "device".padEnd(24) +
    "screen".padEnd(14) +
    "logo".padEnd(10) +
    "width%".padEnd(10) +
    "height%",
);
for (const [name, width, height] of devices) {
  const vmin = Math.min(width, height);
  let size = clamp(0.22 * vmin, 4.5 * 16, 7 * 16);
  size = Math.min(size, 0.36 * width, 0.36 * height);
  console.log(
    name.padEnd(24) +
      `${width}x${height}`.padEnd(14) +
      `${size.toFixed(1)}px`.padEnd(10) +
      `${((size / width) * 100).toFixed(1)}%`.padEnd(10) +
      `${((size / height) * 100).toFixed(1)}%`,
  );
  if (size > 160) fail(`${name}: logo ${size}px is larger than the old 160px`);
  if (size > 0.4 * width || size > 0.4 * height) {
    fail(`${name}: logo occupies more than 40% of a viewport axis`);
  }
}

console.log("");
console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
