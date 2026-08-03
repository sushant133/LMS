import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../models");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

let fixed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  let c = fs.readFileSync(full, "utf8");

  // Remove broken placeholders / wrong plugin calls from prior attempt
  c = c.replace(/\r?\nschemaPLACEHOLDER/g, "");
  c = c.replace(/\r?\nschema\.plugin\(softDeletePlugin\);/g, "");

  // Ensure import once
  if (!c.includes('softDeletePlugin')) {
    if (/from ["']mongoose["']/.test(c)) {
      c = c.replace(
        /(from ["']mongoose["'];\r?\n)/,
        `$1import { softDeletePlugin } from "../plugins/softDeletePlugin.js";\n`,
      );
    } else {
      c =
        `import { softDeletePlugin } from "../plugins/softDeletePlugin.js";\n` +
        c;
    }
  }

  // Inject schema.plugin(softDeletePlugin) immediately before each mongoose.model(...)
  c = c.replace(
    /export const (\w+) = mongoose\.model\(\s*["'](\w+)["']\s*,\s*(\w+)\s*\)/g,
    (_m, exportName, modelName, schemaName) => {
      return `${schemaName}.plugin(softDeletePlugin);\nexport const ${exportName} = mongoose.model("${modelName}", ${schemaName})`;
    },
  );

  // Dedupe consecutive identical plugin lines
  c = c.replace(
    /(\w+\.plugin\(softDeletePlugin\);\n)(\1)+/g,
    "$1",
  );

  // If a schema already had isDeleted and we double-plugin, dedupe any adjacent
  // Plugin called twice is mostly ok but messy — remove duplicate back-to-back
  const lines = c.split(/\r?\n/);
  const out = [];
  let prev = "";
  for (const line of lines) {
    if (line.trim() === prev.trim() && /\.plugin\(softDeletePlugin\)/.test(line)) {
      continue;
    }
    out.push(line);
    prev = line;
  }
  c = out.join("\n");

  fs.writeFileSync(full, c);
  fixed += 1;
}
console.log(`Applied soft-delete plugin cleanup to ${fixed} model files`);
