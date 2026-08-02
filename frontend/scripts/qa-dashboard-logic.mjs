/**
 * Lightweight QA for dashboard demographics tally + year-name matching.
 * Run: node scripts/qa-dashboard-logic.mjs
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const tallyGender = (rows) => {
  let male = 0,
    female = 0,
    other = 0;
  for (const s of rows) {
    const g = (s.gender ?? "").trim().toLowerCase();
    if (g === "male") male += 1;
    else if (g === "female") female += 1;
    else other += 1;
  }
  return { male, female, other, total: male + female + other };
};

const filterDemo = (rows, batchId, yearId) =>
  rows.filter((r) => {
    if (batchId && r.batchId !== batchId) return false;
    if (yearId && r.yearId !== yearId) return false;
    return true;
  });

const yearIdsMatchingName = (years, yearNameFilter) => {
  const wanted = yearNameFilter.trim().toLowerCase();
  if (!wanted) return [];
  const exact = years.filter(
    (y) => (y.name ?? "").trim().toLowerCase() === wanted,
  );
  if (exact.length > 0) return exact.map((y) => y._id);
  return years
    .filter((y) => {
      const n = (y.name ?? "").trim().toLowerCase();
      return n.includes(wanted) || wanted.includes(n);
    })
    .map((y) => y._id);
};

// --- tests ---
const rows = [
  { batchId: "b1", yearId: "y1", gender: "Male", ethnicityCategory: "Dalit" },
  { batchId: "b1", yearId: "y1", gender: "Female", ethnicityCategory: "Madhesi" },
  { batchId: "b1", yearId: "y2", gender: "Male", ethnicityCategory: "Dalit" },
  { batchId: "b2", yearId: "y3", gender: "Female", ethnicityCategory: "" },
  { batchId: "b2", yearId: "y3", gender: "Other", ethnicityCategory: "Muslim" },
];

const all = tallyGender(rows);
assert(all.male === 2 && all.female === 2 && all.other === 1, "full tally");

const b1 = tallyGender(filterDemo(rows, "b1", ""));
assert(b1.male === 2 && b1.female === 1 && b1.total === 3, "batch b1 filter");

const y1 = tallyGender(filterDemo(rows, "", "y1"));
assert(y1.male === 1 && y1.female === 1 && y1.total === 2, "year y1 filter");

const b1y2 = tallyGender(filterDemo(rows, "b1", "y2"));
assert(b1y2.male === 1 && b1y2.total === 1, "batch+year filter");

const years = [
  { _id: "a", name: "1st Year" },
  { _id: "b", name: "1st Year" },
  { _id: "c", name: "2nd Year" },
  { _id: "d", name: "HA 3rd Year 2081" },
];
assert(
  yearIdsMatchingName(years, "1st Year").join(",") === "a,b",
  "exact year name multi-batch",
);
assert(
  yearIdsMatchingName(years, "2nd Year").join(",") === "c",
  "exact 2nd year",
);
assert(
  yearIdsMatchingName(years, "3rd Year").join(",") === "d",
  "soft match 3rd Year",
);
assert(yearIdsMatchingName(years, "4th Year").length === 0, "no match");

console.log("QA dashboard logic: ALL PASSED");
