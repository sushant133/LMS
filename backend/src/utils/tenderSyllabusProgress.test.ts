import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSubjectFamilyMap,
  filterLeavesForSubjectKind,
  isPracticalSubjectName,
  lookupFamilyValue,
  subjectFamilyStem
} from "./tenderSyllabusProgress.js";

describe("subject family matching", () => {
  it("pairs Botany with Botany Practical", () => {
    assert.equal(subjectFamilyStem("Botany"), "botany");
    assert.equal(subjectFamilyStem("Botany Practical"), "botany");
    assert.equal(isPracticalSubjectName("Botany Practical"), true);
    assert.equal(isPracticalSubjectName("Botany"), false);

    const family = buildSubjectFamilyMap([
      { _id: "th", name: "Botany", code: "BOT" },
      { _id: "pr", name: "Botany Practical", code: "BOT-P" },
      { _id: "zo", name: "Zoology", code: "ZOO" }
    ]);
    assert.deepEqual(new Set(family.get("th")), new Set(["th", "pr"]));
    assert.deepEqual(new Set(family.get("pr")), new Set(["th", "pr"]));
    assert.deepEqual(family.get("zo"), ["zo"]);
  });

  it("inherits tender percent from the theory sibling", () => {
    const family = buildSubjectFamilyMap([
      { _id: "th", name: "Botany" },
      { _id: "pr", name: "Botany Practical" }
    ]);
    const map = new Map<string, number>([["T1:th", 42]]);
    assert.equal(lookupFamilyValue(map, "T1", "pr", family, (n) => n > 0), 42);
    assert.equal(lookupFamilyValue(map, "T1", "th", family, (n) => n > 0), 42);
  });

  it("filters practical leaves for a practical subject", () => {
    const leaves = [
      { syllabusId: "s", subjectId: "th", yearId: "", classId: "", batchId: "", unitNo: 1, leafId: "a", completed: true, practicalRequired: false },
      { syllabusId: "s", subjectId: "th", yearId: "", classId: "", batchId: "", unitNo: 2, leafId: "b", completed: true, practicalRequired: true }
    ];
    const practical = filterLeavesForSubjectKind(leaves, "Botany Practical", ["Botany", "Botany Practical"]);
    assert.equal(practical.length, 1);
    assert.equal(practical[0]?.leafId, "b");
    const theory = filterLeavesForSubjectKind(leaves, "Botany", ["Botany", "Botany Practical"]);
    assert.equal(theory.length, 1);
    assert.equal(theory[0]?.leafId, "a");
  });
});
