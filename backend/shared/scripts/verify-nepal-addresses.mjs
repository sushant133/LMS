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
const types = { rural: 0, mun: 0, metro: 0, sub: 0, other: 0 };
const missingNp = [];

for (const p of data) {
  for (const d of p.children) {
    districts += 1;
    for (const m of d.children) {
      locals += 1;
      if (/Rural Municipality$/i.test(m.en)) types.rural += 1;
      else if (/Sub[- ]Metropolitan/i.test(m.en)) types.sub += 1;
      else if (/Metropolitan City$/i.test(m.en)) types.metro += 1;
      else if (/Municipality$/i.test(m.en)) types.mun += 1;
      else types.other += 1;
      if (!m.np || m.np.includes("?")) missingNp.push(`${p.en}/${d.en}/${m.en}`);
      if (!m.wards?.length) throw new Error(`No wards for ${m.en}`);
    }
  }
}

console.log({
  provinces: data.length,
  districts,
  locals,
  types,
  missingNpSample: missingNp.slice(0, 5),
  missingNpCount: missingNp.length,
  provinces: data.map((p) => `${p.en} (${p.children.length} districts)`)
});

// Show sample for one district that often lacks rural muns
const bagmati = data.find((p) => p.en.includes("Bagmati"));
const sindhu = bagmati?.children.find((d) => d.en.includes("Sindhupal"));
console.log(
  "Sindhupalchok locals:",
  sindhu?.children.map((c) => c.en).sort()
);
