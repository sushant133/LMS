import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/nepal-addresses.ts");
const src = fs.readFileSync(file, "utf8");
// Extract JSON array
const start = src.indexOf("= [");
const json = src.slice(start + 2).replace(/;\s*$/, "");
const data = JSON.parse(json);

let districts = 0;
let locals = 0;
let totalWards = 0;
const types = { rural: 0, mun: 0, metro: 0, sub: 0, other: 0 };
const missingNp = [];
const wardByType = {
  rural: { min: Infinity, max: 0 },
  mun: { min: Infinity, max: 0 },
  metro: { min: Infinity, max: 0 },
  sub: { min: Infinity, max: 0 }
};

const track = (bucket, n) => {
  wardByType[bucket].min = Math.min(wardByType[bucket].min, n);
  wardByType[bucket].max = Math.max(wardByType[bucket].max, n);
};

for (const p of data) {
  for (const d of p.children) {
    districts += 1;
    for (const m of d.children) {
      locals += 1;
      const n = m.wards?.length || 0;
      totalWards += n;
      if (!n) throw new Error(`No wards for ${m.en}`);

      if (/Rural Municipality$/i.test(m.en)) {
        types.rural += 1;
        track("rural", n);
      } else if (/Sub[- ]Metropolitan/i.test(m.en)) {
        types.sub += 1;
        track("sub", n);
      } else if (/Metropolitan City$/i.test(m.en)) {
        types.metro += 1;
        track("metro", n);
      } else if (/Municipality$/i.test(m.en)) {
        types.mun += 1;
        track("mun", n);
      } else {
        types.other += 1;
      }
      if (!m.np || m.np.includes("?")) missingNp.push(`${p.en}/${d.en}/${m.en}`);
    }
  }
}

// Spot-checks for known incomplete cases under old type-based caps
const findLocal = (provinceEn, districtEn, localRe) => {
  const p = data.find((x) => x.en === provinceEn);
  const d = p?.children.find((x) => x.en === districtEn);
  return d?.children.find((x) => localRe.test(x.en));
};

const checks = [
  { name: "Lahan Municipality", item: findLocal("Madhesh Province", "Siraha", /^Lahan Municipality$/i), expect: 24 },
  { name: "Kathmandu Metropolitan City", item: findLocal("Bagmati Province", "Kathmandu", /Kathmandu Metropolitan/i), expectMin: 32 },
  { name: "Pokhara Metropolitan City", item: findLocal("Gandaki Province", "Kaski", /Pokhara/i), expectMin: 30 }
];

const failures = [];
for (const c of checks) {
  if (!c.item) {
    failures.push(`Missing ${c.name}`);
    continue;
  }
  const n = c.item.wards.length;
  if (c.expect != null && n !== c.expect) failures.push(`${c.name}: expected ${c.expect} wards, got ${n}`);
  if (c.expectMin != null && n < c.expectMin) failures.push(`${c.name}: expected >= ${c.expectMin} wards, got ${n}`);
}

console.log({
  provinces: data.length,
  districts,
  locals,
  totalWards,
  types,
  wardByType,
  missingNpSample: missingNp.slice(0, 5),
  missingNpCount: missingNp.length,
  provinceSummary: data.map((p) => `${p.en} (${p.children.length} districts)`),
  spotChecks: checks.map((c) => ({
    name: c.name,
    wards: c.item?.wards.length ?? null,
    label: c.item?.en ?? null
  }))
});

if (locals !== 753) throw new Error(`Expected 753 local levels, got ${locals}`);
if (totalWards !== 6743) throw new Error(`Expected 6743 wards, got ${totalWards}`);
if (failures.length) throw new Error(`Spot-check failures:\n${failures.join("\n")}`);

console.log("OK: address data ward counts verified");
