import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdministrationCompletion,
  leafCountsTowardTeacherSalary
} from "./syllabusCompletionAttribution.js";

describe("syllabus completion attribution", () => {
  it("treats administration extra lectures as not salary-eligible", () => {
    assert.equal(isAdministrationCompletion("ADMINISTRATION", true), true);
    assert.equal(isAdministrationCompletion("TEACHER", false), true);
    assert.equal(isAdministrationCompletion("TEACHER", true), false);
    assert.equal(isAdministrationCompletion(undefined, undefined), false);
  });

  it("pays the assigned teacher only for teacher-attributed completed leaves", () => {
    const teacherId = "T1";
    assert.equal(
      leafCountsTowardTeacherSalary(
        { completed: true, completionSource: "TEACHER", countsTowardSalary: true, completedByTeacherId: "T1" },
        teacherId
      ),
      true
    );
    assert.equal(
      leafCountsTowardTeacherSalary(
        { completed: true, completionSource: "ADMINISTRATION", countsTowardSalary: false },
        teacherId
      ),
      false
    );
    assert.equal(
      leafCountsTowardTeacherSalary(
        { completed: true, completionSource: "TEACHER", completedByTeacherId: "T2" },
        teacherId
      ),
      false
    );
  });

  it("keeps legacy unmarked completed leaves on the assigned teacher's salary", () => {
    assert.equal(
      leafCountsTowardTeacherSalary({ completed: true }, "T1"),
      true
    );
    assert.equal(
      leafCountsTowardTeacherSalary({ completed: false }, "T1"),
      false
    );
  });
});
