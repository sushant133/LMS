import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStudentFeePosition } from "./accountingCalculations.js";

type Row = Record<string, unknown>;
let n = 0;
const receipt = (fields: Row): Row => ({
  _id: `r${++n}`,
  receiptNumber: `R-${n}`,
  paidDateBs: "2083-04-01",
  amountPaidNpr: 0,
  currentChargesNpr: 0,
  discountNpr: 0,
  scholarshipNpr: 0,
  paymentMethod: "CASH",
  ...fields
});
const opening = (programYear: number, amount: number): Row =>
  receipt({ receiptNumber: `OPEN-${programYear}-${++n}`, programYear, currentChargesNpr: amount, paymentMethod: "OTHER", accountantName: "System" });

/** payable − discount − scholarship − paid = outstanding − advance */
const assertBalances = (position: ReturnType<typeof buildStudentFeePosition>) => {
  const t = position.totals;
  assert.equal(
    Math.round((t.payableNpr - t.discountNpr - t.scholarshipNpr - t.paidNpr) * 100) / 100,
    Math.round((t.outstandingNpr - t.advanceNpr) * 100) / 100
  );
  assert.ok(t.advanceNpr === 0 || t.outstandingNpr === 0, "advance and a due cannot both exist");
};

describe("student fee position", () => {
  it("Priyanka: a 1st-year receipt wrongly carried to 2nd year settles 1st year, no advance", () => {
    const position = buildStudentFeePosition(
      [receipt({ programYear: 1, amountPaidNpr: 20000, advanceAllocations: [{ programYear: 2, amountNpr: 20000 }] })],
      [],
      { 1: 20000, 2: 20000 }
    );
    const [y1, y2] = position.years;
    assert.equal(y1!.paidNpr, 20000);
    assert.equal(y1!.remainingNpr, 0);
    assert.equal(y1!.status, "PAID");
    assert.equal(y2!.paidNpr, 0);
    assert.equal(y2!.remainingNpr, 20000);
    assert.equal(position.totals.advanceNpr, 0);
    assertBalances(position);
  });

  it("Aarav: paid exactly with no charge entered — paid, no advance", () => {
    const position = buildStudentFeePosition(
      [opening(1, 15100), receipt({ programYear: 1, amountPaidNpr: 15100 })],
      [],
      {}
    );
    assert.deepEqual(
      [position.totals.payableNpr, position.totals.paidNpr, position.totals.outstandingNpr, position.totals.advanceNpr],
      [15100, 15100, 0, 0]
    );
    assertBalances(position);
  });

  it("Priya / Aarav: a receipt with no program year is applied to the earliest due year", () => {
    const position = buildStudentFeePosition([receipt({ amountPaidNpr: 3500 })], [], { 1: 10000, 2: 10000 });
    assert.equal(position.years[0]!.paidNpr, 3500);
    assert.equal(position.years[0]!.remainingNpr, 6500);
    assert.equal(position.totals.outstandingNpr, 16500);
    assertBalances(position);
  });

  it("Kritika: charges saved without a year still count in the outstanding", () => {
    const position = buildStudentFeePosition(
      [receipt({ currentChargesNpr: 2500, paidDateBs: "2083-01-01" })],
      [],
      { 1: 5000 }
    );
    assert.equal(position.unassigned.remainingNpr, 2500);
    assert.equal(position.totals.outstandingNpr, 7500);
    assertBalances(position);
  });

  it("a payment above every due becomes advance, only the excess", () => {
    const position = buildStudentFeePosition([receipt({ programYear: 1, amountPaidNpr: 26000 })], [], { 1: 20000 });
    assert.equal(position.totals.outstandingNpr, 0);
    assert.equal(position.totals.advanceNpr, 6000);
    assertBalances(position);
  });

  it("excess of one year pays the next year (not advance while a due remains)", () => {
    const position = buildStudentFeePosition([receipt({ programYear: 1, amountPaidNpr: 25000 })], [], { 1: 20000, 2: 20000 });
    assert.equal(position.years[0]!.remainingNpr, 0);
    assert.equal(position.years[1]!.paidNpr, 5000);
    assert.equal(position.years[1]!.advanceNpr, 5000);
    assert.equal(position.totals.advanceNpr, 0);
    assertBalances(position);
  });

  it("discounts, receipt scholarships and a full merit waiver", () => {
    const position = buildStudentFeePosition(
      [receipt({ programYear: 1, amountPaidNpr: 15000, discountNpr: 2000, scholarshipNpr: 3000 })],
      [{ coversProgramYear: 2, status: "ACTIVE", waiverType: "FULL" }],
      { 1: 20000, 2: 20000 }
    );
    assert.equal(position.years[0]!.remainingNpr, 0);
    assert.equal(position.years[1]!.remainingNpr, 0);
    assert.equal(position.years[1]!.status, "SCHOLARSHIP");
    assert.equal(position.totals.scholarshipNpr, 23000);
    assertBalances(position);
  });
});
