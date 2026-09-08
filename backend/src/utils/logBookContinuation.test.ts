import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignmentContinuesLeftover,
  collectLeftoverChainTeacherIds,
  type LeftoverAssignmentLink
} from "./logBookContinuation.js";

const row = (
  partial: Partial<LeftoverAssignmentLink> & Pick<LeftoverAssignmentLink, "_id" | "teacherId" | "subjectId">
): LeftoverAssignmentLink => ({
  academicYearBs: "2082/083",
  ...partial
});

describe("log book leftover continuation", () => {
  it("FULL 100% assignment starts a fresh log (only the current teacher)", () => {
    const current = row({
      _id: "new",
      teacherId: "t2",
      subjectId: "s1",
      assignmentType: "FULL",
      handoverBaselinePercent: null,
      supersedesAssignmentId: "old"
    });
    const byId = new Map<string, LeftoverAssignmentLink>([
      ["new", current],
      [
        "old",
        row({
          _id: "old",
          teacherId: "t1",
          subjectId: "s1",
          handoverBaselinePercent: null
        })
      ]
    ]);
    const result = collectLeftoverChainTeacherIds(byId, current);
    assert.equal(result.continueLeftover, false);
    assert.deepEqual(result.teacherIds, ["t2"]);
  });

  it("continue leftover includes predecessor teachers in the handover chain", () => {
    const current = row({
      _id: "new",
      teacherId: "t2",
      subjectId: "s1",
      assignmentType: "UNIT",
      handoverBaselinePercent: 40,
      supersedesAssignmentId: "old"
    });
    const byId = new Map<string, LeftoverAssignmentLink>([
      ["new", current],
      [
        "old",
        row({
          _id: "old",
          teacherId: "t1",
          subjectId: "s1",
          handoverBaselinePercent: null
        })
      ]
    ]);
    const result = collectLeftoverChainTeacherIds(byId, current);
    assert.equal(result.continueLeftover, true);
    assert.deepEqual(result.teacherIds, ["t2", "t1"]);
  });

  it("handover baseline of 0 still continues leftover (partial start)", () => {
    assert.equal(assignmentContinuesLeftover({ handoverBaselinePercent: 0 }), true);
    assert.equal(assignmentContinuesLeftover({ handoverBaselinePercent: null }), false);
    assert.equal(assignmentContinuesLeftover({}), false);
  });
});
