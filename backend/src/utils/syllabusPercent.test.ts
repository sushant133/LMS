import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unitWeightedFraction, unitWeightedFractionFromCounts } from "./syllabusPercent.js";

const leaves = (unitKey: string, total: number, done: number) =>
  Array.from({ length: total }, (_, i) => ({ unitKey, done: i < done }));

describe("unit-weighted syllabus percent", () => {
  it("1 of 7 units done is 14.29% even when that unit holds most sub-units", () => {
    // Unit 1 has 30 of 72 leaves — leaf counting used to report 41.67%.
    const all = [
      ...leaves("u1", 30, 30),
      ...leaves("u2", 7, 0),
      ...leaves("u3", 7, 0),
      ...leaves("u4", 7, 0),
      ...leaves("u5", 7, 0),
      ...leaves("u6", 7, 0),
      ...leaves("u7", 7, 0)
    ];
    const pct = unitWeightedFraction(all, (l) => l.done) * 100;
    assert.equal(Math.round(pct * 100) / 100, 14.29);
  });

  it("a half-done unit counts as half a unit", () => {
    const all = [...leaves("a", 4, 2), ...leaves("b", 10, 10)];
    assert.equal(unitWeightedFraction(all, (l) => l.done), 0.75);
  });

  it("ignores units with no leaves and handles empty input", () => {
    assert.equal(unitWeightedFractionFromCounts([{ total: 0, done: 0 }, { total: 2, done: 1 }]), 0.5);
    assert.equal(unitWeightedFraction([], () => true), 0);
  });
});
