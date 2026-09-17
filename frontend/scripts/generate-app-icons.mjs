/**
 * Regenerate the app icons that get composited onto a background we do not control.
 *
 * public/college-logo.png is a dark mark (mean luminance ~42/255) on a fully
 * transparent background. That is correct for the splash and the in-app header,
 * which always paint white behind it, but anything that draws the icon onto a *dark*
 * surface — the Play Store in dark theme, a launcher, the PWA install prompt — ends up
 * with a dark logo on a dark background and the mark disappears.
 *
 * So each standalone icon is baked onto the same opaque light tile the Android launcher
 * icon already uses (@color/ic_launcher_background, #F4F4F4). The artwork itself is
 * untouched; only the transparency is replaced by the brand tile.
 *
 * Run: node scripts/generate-app-icons.mjs
 *
 * The startup logo has the opposite requirement — it sits on white and must stay
 * transparent — so it lives in generate-boot-logo.mjs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentBounds, decodePng, renderTile, writePng } from "./lib/png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "..");
const SOURCE = path.join(frontend, "public/college-logo.png");

/** Matches @color/ic_launcher_background so the store tile and the installed icon are identical. */
const BACKGROUND = { r: 0xf4, g: 0xf4, b: 0xf4 };

const TARGETS = [
  {
    file: "android/store-assets/play-store-icon-512.png",
    size: 512,
    /** Play only rounds the corners, so the mark can use most of the tile. */
    logoScale: 0.76,
    note: "upload in Play Console > Store listing > App icon",
  },
  {
    file: "public/pwa-512x512.png",
    size: 512,
    /** Declared "any maskable": Android may crop to a circle, so stay inside the 80% safe zone. */
    logoScale: 0.6,
    note: "PWA manifest (maskable)",
  },
  {
    file: "public/pwa-192x192.png",
    size: 192,
    logoScale: 0.76,
    note: "PWA manifest",
  },
];

const source = decodePng(SOURCE);
const crop = contentBounds(source);
console.log(
  `source ${path.relative(frontend, SOURCE)} ${source.width}x${source.height}, artwork ${crop.width}x${crop.height} at ${crop.x},${crop.y}`,
);

for (const target of TARGETS) {
  const tile = renderTile(source, crop, target.size, target.logoScale, BACKGROUND);
  writePng(path.join(frontend, target.file), tile, { alpha: false });
  const margin = Math.round(((target.size - tile.drawWidth) / 2 / target.size) * 100);
  console.log(
    `wrote ${target.file} - ${target.size}x${target.size}, logo ${tile.drawWidth}x${tile.drawHeight} (${margin}% margin), opaque #F4F4F4 - ${target.note}`,
  );
}
