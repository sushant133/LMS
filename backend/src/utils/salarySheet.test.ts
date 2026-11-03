import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSalarySheetLine,
  roundNetSalaryToRupee,
  roundSalaryNpr,
  salaryRoundingNpr,
  toPaisa
} from "@phit-erp/shared";
import { calculateNetSalary } from "./accountingCalculations.js";

const monthly = (monthlySalaryNpr: number, absentDays: number, calendarDaysInMonth = 31, extra: Partial<Parameters<typeof calculateSalarySheetLine>[0]> = {}) =>
  calculateSalarySheetLine({
    paymentType: "MONTHLY",
    monthlySalaryNpr,
    presentDays: 0,
    absentDays,
    extraDuty: 0,
    workingDaysInMonth: calendarDaysInMonth,
    calendarDaysInMonth,
    ...extra
  });

describe("Money in whole paisa", () => {
  it("rounds to 2 decimals without floating-point drift", () => {
    assert.equal(toPaisa(1.005), 101);
    assert.equal(toPaisa(18998.685), 1899869);
    assert.equal(toPaisa(-2.675), -268);
    assert.equal(roundSalaryNpr(0.1 + 0.2), 0.3);
    assert.equal(roundSalaryNpr(1.005), 1.01);
  });
});

describe("Absent-day deduction", () => {
  it("is monthly × absent days ÷ calendar days of the BS month, rounded once", () => {
    assert.equal(monthly(23000, 1).absentDeductionNpr, 741.94); // 741.935…
    // Two days: 1,483.87 — not 2 × 741.94 = 1,483.88
    assert.equal(monthly(23000, 2).absentDeductionNpr, 1483.87);
    assert.equal(monthly(30000, 3, 30).absentDeductionNpr, 3000);
  });

  it("counts leave days as deducted days", () => {
    const line = monthly(30000, 1, 30, { leaveDays: 2 });
    assert.equal(line.absentDeductionNpr, 3000);
    assert.equal(line.salaryAmountNpr, 27000);
  });

  it("never deducts more than the month", () => {
    assert.equal(monthly(30000, 40, 30).salaryAmountNpr, 0);
  });

  it("pays extra duty at the same per-day rate", () => {
    const line = monthly(30000, 0, 30, { extraDuty: 2 });
    assert.equal(line.extraAmountNpr, 2000);
    assert.equal(line.salaryAmountNpr, 32000);
  });
});

describe("1% SST / TDS", () => {
  it("is 1% of the salary amount, rounded half-up to the paisa", () => {
    assert.equal(monthly(23000, 1).tax1PercentNpr, 222.58); // 1% of 22,258.06 = 222.5806
    assert.equal(monthly(30000, 0, 30).tax1PercentNpr, 300);
    // 1% of 12,345.50 = 123.455 → 123.46
    const tender = calculateSalarySheetLine({
      paymentType: "TENDER",
      monthlySalaryNpr: 0,
      presentDays: 0,
      absentDays: 0,
      extraDuty: 0,
      workingDaysInMonth: 30,
      tenderThisMonthNpr: 12345.5
    });
    assert.equal(tender.tax1PercentNpr, 123.46);
  });

  it("applies to period-paid teachers on periods × rate + extra periods", () => {
    const line = calculateSalarySheetLine({
      paymentType: "PERIOD",
      monthlySalaryNpr: 0,
      presentDays: 0,
      absentDays: 0,
      extraDuty: 2,
      workingDaysInMonth: 30,
      periodRateNpr: 500,
      periodsAttended: 22
    });
    assert.deepEqual(
      [line.extraAmountNpr, line.salaryAmountNpr, line.tax1PercentNpr, line.netSalaryNpr, line.roundingNpr],
      [1000, 12000, 120, 11880, 0]
    );
  });
});

describe("Net salary in whole rupees", () => {
  it("rounds the net half-up to the nearest rupee and shows the difference as Rounding", () => {
    // 23,000 with one day absent: 22,258.06 − 222.58 = 22,035.48 → 22,035 (rounding −0.48)
    const line = monthly(23000, 1);
    assert.equal(line.salaryAmountNpr, 22258.06);
    assert.equal(line.netSalaryNpr, 22035);
    assert.equal(line.roundingNpr, -0.48);
    assert.deepEqual(roundNetSalaryToRupee(100.5), { netSalaryNpr: 101, roundingNpr: 0.5 });
    assert.deepEqual(roundNetSalaryToRupee(100.49), { netSalaryNpr: 100, roundingNpr: -0.49 });
  });

  it("always adds up: salary − tax + rounding = net, and the net is whole rupees", () => {
    for (const salary of [18000, 19191, 23000, 27500, 31234]) {
      for (const days of [29, 30, 31, 32]) {
        for (let absent = 0; absent <= 5; absent++) {
          const line = monthly(salary, absent, days);
          const lhs = toPaisa(line.salaryAmountNpr) - toPaisa(line.tax1PercentNpr) + toPaisa(line.roundingNpr);
          assert.equal(lhs, toPaisa(line.netSalaryNpr), `${salary} / ${days} days / ${absent} absent`);
          assert.equal(toPaisa(line.netSalaryNpr) % 100, 0, "net in whole rupees");
          assert.ok(Math.abs(line.roundingNpr) <= 0.5);
          assert.equal(salaryRoundingNpr(line), line.roundingNpr);
        }
      }
    }
  });

  it("manual salary entries are paid in whole rupees too", () => {
    assert.equal(
      calculateNetSalary({ basicSalaryNpr: 20000.4, allowancesNpr: 0, bonusNpr: 0, advanceSalaryNpr: 0, loanDeductionNpr: 0, taxNpr: 200.01, otherDeductionsNpr: 0 }),
      19800
    );
  });
});
