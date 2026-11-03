import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { feeIncomeAccountFor, SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";

describe("fee type → ledger account", () => {
  it("maps each fee head to its fee income account", () => {
    const expected: Record<string, string> = {
      ADMISSION: "4001",
      REGISTRATION: "4002",
      TUITION: "4003",
      MONTHLY: "4003",
      ANNUAL: "4003",
      EXAM: "4004",
      LAB: "4005",
      PRACTICAL: "4005",
      LIBRARY: "4006",
      HOSTEL: "4007",
      TRANSPORT: "4008",
      FINE: "4009",
      LATE: "4009"
    };
    for (const [feeType, account] of Object.entries(expected)) {
      assert.equal(feeIncomeAccountFor(feeType), account, feeType);
    }
  });

  it("treats a security deposit as the 2102 liability", () => {
    assert.equal(feeIncomeAccountFor("SECURITY_DEPOSIT"), SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY);
    assert.equal(feeIncomeAccountFor("SECURITY_DEPOSIT"), "2102");
  });

  it("never sends a fee to 4100 Other Income", () => {
    for (const feeType of ["OTHER", "MISC", "REFUND", "SCHOLARSHIP", "SOMETHING_NEW", "", null, undefined]) {
      const account = feeIncomeAccountFor(feeType);
      assert.notEqual(account, SYSTEM_ACCOUNT_CODES.OTHER_INCOME, String(feeType));
      assert.equal(account, "4090", String(feeType));
    }
  });

  it("ignores case and spaces", () => {
    assert.equal(feeIncomeAccountFor(" tuition "), "4003");
    assert.equal(feeIncomeAccountFor("late_fee"), "4009");
  });
});
