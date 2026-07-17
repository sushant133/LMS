/**
 * Rebuild nepal-addresses.ts ward counts from sagautam5/local-states-nepal.
 *
 * Keeps existing province/district/local-level English & Nepali labels (stable for
 * saved form values). Replaces only `wards` using official per-local-level counts
 * (6,743 total). Previous type-based caps (Municipality=14, Rural=9) under-counted
 * many units (e.g. Lahan Municipality has 24 wards).
 *
 * Base structure: TEMP/nepal-addr/old-addresses.ts (git HEAD snapshot) when present,
 * otherwise the current nepal-addresses.ts file.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "nepal-addr");
const outPath = path.join(__dirname, "../src/data/nepal-addresses.ts");

const required = ["sagu_prov_en.json", "sagu_dist_en.json", "sagu_mun_en.json", "sagu_cat_en.json"];
for (const f of required) {
  const p = path.join(tempDir, f);
  if (!fs.existsSync(p)) {
    console.error("Missing", p, "- download sagautam5 local-states-nepal dataset first");
    process.exit(1);
  }
}

const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(tempDir, name), "utf8"));
const provincesEn = loadJson("sagu_prov_en.json");
const districtsEn = loadJson("sagu_dist_en.json");
const munEn = loadJson("sagu_mun_en.json");

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const loadAddressTs = (filePath) => {
  let src = stripBom(fs.readFileSync(filePath, "utf8"));
  const start = src.indexOf("= [");
  if (start < 0) throw new Error(`No address array in ${filePath}`);
  return JSON.parse(src.slice(start + 2).replace(/;\s*$/, ""));
};

const basePath = [path.join(tempDir, "old-addresses.ts"), outPath].find((p) => fs.existsSync(p));
if (!basePath) {
  console.error("No base address file found");
  process.exit(1);
}
const base = loadAddressTs(basePath);
console.log("Using name-preserving base:", basePath);

/** Collapse romanization noise for matching. */
const phoneticKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/metropolitan city|sub[-\s]?metropolitan city|rural municipality|municipality|city/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ph/g, "f")
    .replace(/[vw]/g, "b")
    .replace(/sh/g, "s")
    .replace(/chh/g, "ch")
    .replace(/ch/g, "c")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/ks/g, "x")
    .replace(/iy/g, "i")
    .replace(/yi/g, "i")
    .replace(/yu/g, "u")
    .replace(/ya/g, "a")
    .replace(/(.)\1+/g, "$1"); // collapse repeated letters: bhimeshwor/bhimeswor

const plainKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/metropolitan city|sub[-\s]?metropolitan city|rural municipality|municipality|city/gi, " ")
    .replace(/[^a-z0-9]+/g, "");

const lev = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
};

/** Distance score: lower is better. */
const nameDistance = (appName, srcName) => {
  const pa = phoneticKey(appName);
  const pb = phoneticKey(srcName);
  const ca = plainKey(appName);
  const cb = plainKey(srcName);
  if (pa === pb || ca === cb) return 0;
  let d = Math.min(lev(pa, pb), lev(ca, cb));
  if (pa.includes(pb) || pb.includes(pa) || ca.includes(cb) || cb.includes(ca)) {
    d = Math.min(d, 1);
  }
  // Token containment for multi-word renames (Barpak Sulikot ↔ Sulikot)
  const tokens = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/metropolitan city|sub[-\s]?metropolitan city|rural municipality|municipality|city/gi, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
      .map((t) => phoneticKey(t));
  const ta = new Set(tokens(appName));
  const tb = new Set(tokens(srcName));
  if (ta.size && tb.size) {
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    if (inter > 0 && (inter === ta.size || inter === tb.size)) d = Math.min(d, 2);
    else if (inter >= 2) d = Math.min(d, 2);
  }
  return d;
};

/** Explicit district aliases: app label → sagautam name */
const districtAliases = {
  Ramechhap: "Ramechap",
  "Nawalparari East": "Nawalpur",
  "Nawalparasi East": "Nawalpur",
  Parbat: "Parwat",
  Tanahu: "Tanahun",
  Kapilbastu: "Kapilvastu",
  "Nawalparasi West": "Parasi",
  "Rukum East": "Eastern Rukum",
  "Rukum West": "Western Rukum",
  Achham: "Acham",
  Pachthar: "Panchthar"
};

/** Hard local-level aliases when romanization differs a lot */
const localAliases = {
  // Rasuwa — dataset uses Parbatikunda for Aamachhodingmo in some sources
  "Amachodingmo Rural Municipality": "Parbatikunda",
  "Aamachhodingmo Rural Municipality": "Parbatikunda",
  // Gorkha
  "Barpak Sulikot Rural Municipality": "Sulikot",
  // Mustang
  "Waragung Muktikhsetra Rural Municipality": "Barhagaun Muktichhetra",
  "Varagung Muktichhetra Rural Municipality": "Barhagaun Muktichhetra",
  // Gulmi
  "Chatrakot Rural Municipality": "Chhatrakot",
  // Dolakha
  "Bhimeshwor Municipality": "Bhimeswor"
};

const provinceIdByName = new Map();
for (const p of provincesEn) {
  provinceIdByName.set(plainKey(p.name), p.id);
  if (/sudur/i.test(p.name)) {
    provinceIdByName.set(plainKey("Sudurpashchim Province"), p.id);
    provinceIdByName.set(plainKey("Sudurpaschim Province"), p.id);
  }
}

const districtByProvNorm = new Map();
const districtsByProv = new Map();
for (const d of districtsEn) {
  if (!districtsByProv.has(d.province_id)) districtsByProv.set(d.province_id, []);
  districtsByProv.get(d.province_id).push(d);
  districtByProvNorm.set(`${d.province_id}|${plainKey(d.name)}`, d);
}

const munListByDist = new Map();
for (const m of munEn) {
  if (!munListByDist.has(m.district_id)) munListByDist.set(m.district_id, []);
  munListByDist.get(m.district_id).push(m);
}

const makeWards = (n) => {
  const count = Number(n);
  if (!Number.isFinite(count) || count < 1) throw new Error(`Invalid ward count: ${n}`);
  return Array.from({ length: count }, (_, i) => String(i + 1));
};

const findDistrict = (provinceId, districtEn) => {
  const alias = districtAliases[districtEn];
  for (const name of [districtEn, alias].filter(Boolean)) {
    const direct = districtByProvNorm.get(`${provinceId}|${plainKey(name)}`);
    if (direct) return direct;
  }
  const list = districtsByProv.get(provinceId) || [];
  let best = null;
  let bestD = Infinity;
  for (const d of list) {
    const dist = nameDistance(districtEn, d.name);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return bestD <= 2 ? best : null;
};

/**
 * 1:1 match all locals in a district to source municipalities by best distance.
 */
const matchDistrictLocals = (locals, sourceMuns) => {
  const pairs = [];
  for (let i = 0; i < locals.length; i++) {
    const local = locals[i];
    const alias = localAliases[local.en];
    for (let j = 0; j < sourceMuns.length; j++) {
      const src = sourceMuns[j];
      let dist = nameDistance(local.en, src.name);
      if (alias) dist = Math.min(dist, nameDistance(alias, src.name), nameDistance(alias, phoneticKey(src.name) ? src.name : src.name));
      if (alias && plainKey(alias) === plainKey(src.name)) dist = 0;
      if (alias && phoneticKey(alias) === phoneticKey(src.name)) dist = 0;
      pairs.push({ i, j, dist, local, src });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist || a.i - b.i);

  const usedLocal = new Set();
  const usedSrc = new Set();
  const result = new Map(); // local index -> src mun

  for (const p of pairs) {
    if (usedLocal.has(p.i) || usedSrc.has(p.j)) continue;
    // Accept reasonable matches; remaining filled later if equal counts
    if (p.dist > 6) continue;
    usedLocal.add(p.i);
    usedSrc.add(p.j);
    result.set(p.i, { src: p.src, dist: p.dist });
  }

  // If equal counts and leftover, assign leftover by remaining best pairs
  if (locals.length === sourceMuns.length && result.size < locals.length) {
    for (const p of pairs) {
      if (usedLocal.has(p.i) || usedSrc.has(p.j)) continue;
      usedLocal.add(p.i);
      usedSrc.add(p.j);
      result.set(p.i, { src: p.src, dist: p.dist });
    }
  }

  return result;
};

let matched = 0;
let unmatched = 0;
let totalWards = 0;
const unmatchedList = [];
const wardStats = { min: Infinity, max: 0 };
const matchDistHist = {};

const data = base.map((province) => {
  let provinceId = provinceIdByName.get(plainKey(province.en));
  if (!provinceId && /sudur/i.test(province.en)) {
    provinceId = provinceIdByName.get(plainKey("Sudurpaschim Province"));
  }
  if (!provinceId) throw new Error(`Could not map province: ${province.en}`);

  const children = province.children.map((district) => {
    const dist = findDistrict(provinceId, district.en);
    if (!dist) throw new Error(`Could not map district: ${province.en}/${district.en}`);

    const sourceMuns = munListByDist.get(dist.id) || [];
    const mapping = matchDistrictLocals(district.children, sourceMuns);

    const locals = district.children.map((local, idx) => {
      const hit = mapping.get(idx);
      let wardCount;
      if (hit) {
        wardCount = Number(hit.src.wards);
        matched += 1;
        matchDistHist[hit.dist] = (matchDistHist[hit.dist] || 0) + 1;
      } else {
        unmatched += 1;
        // Prefer max remaining unused source ward count of same rough type size
        const unused = sourceMuns.filter((m, j) => {
          for (const v of mapping.values()) if (v.src.id === m.id) return false;
          return true;
        });
        if (unused.length === 1) {
          wardCount = Number(unused[0].wards);
          matched += 1;
          unmatched -= 1;
        } else {
          // Last resort: type fallback (should be rare)
          const isRural = /Rural Municipality$/i.test(local.en);
          const isMetro = /Metropolitan City$/i.test(local.en) && !/Sub/i.test(local.en);
          const isSub = /Sub[-\s]?Metropolitan/i.test(local.en);
          wardCount = isMetro ? 32 : isSub ? 19 : isRural ? 9 : 14;
          unmatchedList.push(`${province.en}/${district.en}/${local.en}`);
        }
      }

      totalWards += wardCount;
      wardStats.min = Math.min(wardStats.min, wardCount);
      wardStats.max = Math.max(wardStats.max, wardCount);

      return {
        en: local.en,
        np: local.np,
        wards: makeWards(wardCount)
      };
    });

    return {
      en: district.en,
      np: district.np,
      children: locals
    };
  });

  return {
    en: province.en,
    np: province.np,
    children
  };
});

// Spot-check Lahan
const madhesh = data.find((p) => p.en === "Madhesh Province");
const siraha = madhesh?.children.find((d) => d.en === "Siraha");
const lahan = siraha?.children.find((c) => /Lahan/i.test(c.en));
if (!lahan || lahan.wards.length !== 24) {
  throw new Error(`Lahan should have 24 wards, got ${lahan?.wards?.length}`);
}

const localCount = data.reduce(
  (acc, p) => acc + p.children.reduce((a, d) => a + d.children.length, 0),
  0
);

if (localCount !== 753) console.warn(`Warning: expected 753 local levels, got ${localCount}`);
if (totalWards !== 6743) console.warn(`Warning: expected 6,743 total wards, got ${totalWards}`);

const header = `import type { NepalAddressProvince } from "../types.js";

/**
 * Complete Nepal address hierarchy for form selectors.
 * Source: official administrative structure — 7 provinces, 77 districts, 753 local levels
 * (6 Metropolitan, 11 Sub-Metropolitan, 276 Municipalities, 460 Rural Municipalities)
 * with per-local-level ward counts (target 6,743 wards total).
 * Regenerated by scripts/rebuild-nepal-addresses.mjs
 */
export const nepalAddressData: NepalAddressProvince[] = `;

fs.writeFileSync(outPath, `${header}${JSON.stringify(data, null, 2)};\n`, "utf8");

console.log("Wrote", outPath);
console.log({
  localLevels: localCount,
  matched,
  unmatched,
  totalWards,
  wardMin: wardStats.min,
  wardMax: wardStats.max,
  lahanWards: lahan.wards.length,
  lahanName: lahan.en,
  matchDistHist,
  unmatchedSample: unmatchedList.slice(0, 20)
});

if (matched < 740) {
  throw new Error(`Too few matches (${matched}); aborting to avoid bad data`);
}
if (unmatched > 5) {
  throw new Error(`Too many unmatched locals (${unmatched}); aborting`);
}
