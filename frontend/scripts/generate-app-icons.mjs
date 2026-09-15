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
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

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

// —— Minimal PNG codec (8-bit, non-interlaced), so this needs no image dependency ——

const decodePng = (file) => {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error(`${file}: interlaced PNG is not supported`);
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }

  if (depth !== 8) throw new Error(`${file}: only 8-bit PNGs are supported (got ${depth})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      const value = line[x];
      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        restored = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error(`${file}: unknown row filter ${filter}`);
      current[x] = restored & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 6) {
      r = pixels[i * 4];
      g = pixels[i * 4 + 1];
      b = pixels[i * 4 + 2];
      a = pixels[i * 4 + 3];
    } else if (colorType === 2) {
      r = pixels[i * 3];
      g = pixels[i * 3 + 1];
      b = pixels[i * 3 + 2];
    } else if (colorType === 0) {
      r = g = b = pixels[i];
    } else if (colorType === 4) {
      r = g = b = pixels[i * 2];
      a = pixels[i * 2 + 1];
    } else {
      const index = pixels[i];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparency && index < transparency.length) a = transparency[index];
    }
    rgba.set([r, g, b, a], i * 4);
  }

  return { width, height, data: rgba };
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Writes RGB with no alpha channel at all — an opaque tile is the whole point. */
const encodeOpaquePng = (file, { width, height, data }) => {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = y * (stride + 1) + 1 + x * 3;
      raw[to] = data[from];
      raw[to + 1] = data[from + 1];
      raw[to + 2] = data[from + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour, no alpha
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

/** Tight box around every non-transparent pixel, so padding is measured from the art. */
const contentBounds = (img) => {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("source logo is fully transparent");
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

/**
 * Box-filter downscale straight onto the background tile.
 *
 * Alpha is premultiplied before averaging: averaging the raw RGB of fully transparent
 * pixels would drag a dark halo around the edges of the mark.
 */
const renderTile = (img, crop, size, logoScale) => {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    out.set([BACKGROUND.r, BACKGROUND.g, BACKGROUND.b, 255], i * 4);
  }

  const box = Math.round(size * logoScale);
  const scale = Math.min(box / crop.width, box / crop.height);
  const drawWidth = Math.max(1, Math.round(crop.width * scale));
  const drawHeight = Math.max(1, Math.round(crop.height * scale));
  const offsetX = Math.round((size - drawWidth) / 2);
  const offsetY = Math.round((size - drawHeight) / 2);
  const stepX = crop.width / drawWidth;
  const stepY = crop.height / drawHeight;

  for (let y = 0; y < drawHeight; y += 1) {
    const y0 = crop.y + Math.floor(y * stepY);
    const y1 = crop.y + Math.min(crop.height, Math.ceil((y + 1) * stepY));
    for (let x = 0; x < drawWidth; x += 1) {
      const x0 = crop.x + Math.floor(x * stepX);
      const x1 = crop.x + Math.min(crop.width, Math.ceil((x + 1) * stepX));

      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * img.width + sx) * 4;
          const alpha = img.data[i + 3] / 255;
          r += img.data[i] * alpha;
          g += img.data[i + 1] * alpha;
          b += img.data[i + 2] * alpha;
          alphaSum += alpha;
          count += 1;
        }
      }
      if (!count || alphaSum <= 0) continue;

      const coverage = alphaSum / count;
      const logoR = r / alphaSum;
      const logoG = g / alphaSum;
      const logoB = b / alphaSum;

      const target = ((offsetY + y) * size + offsetX + x) * 4;
      out[target] = Math.round(logoR * coverage + BACKGROUND.r * (1 - coverage));
      out[target + 1] = Math.round(logoG * coverage + BACKGROUND.g * (1 - coverage));
      out[target + 2] = Math.round(logoB * coverage + BACKGROUND.b * (1 - coverage));
    }
  }

  return { width: size, height: size, data: out, drawWidth, drawHeight };
};

const source = decodePng(SOURCE);
const crop = contentBounds(source);
console.log(
  `source ${path.relative(frontend, SOURCE)} ${source.width}x${source.height}, artwork ${crop.width}x${crop.height} at ${crop.x},${crop.y}`,
);

for (const target of TARGETS) {
  const tile = renderTile(source, crop, target.size, target.logoScale);
  encodeOpaquePng(path.join(frontend, target.file), tile);
  const margin = Math.round(((target.size - tile.drawWidth) / 2 / target.size) * 100);
  console.log(
    `wrote ${target.file} - ${target.size}x${target.size}, logo ${tile.drawWidth}x${tile.drawHeight} (${margin}% margin), opaque #F4F4F4 - ${target.note}`,
  );
}
