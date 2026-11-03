import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPENSE_CATEGORY_ACCOUNT_MAP, purchasePostingFor } from "@phit-erp/shared";

describe("Direct / Indirect expense accounts", () => {
  it("capitalises asset purchases at or above the threshold into their pool", () => {
    assert.deepEqual(purchasePostingFor("Computers", 85000, 5000), { accountCode: "1402", assetPool: "B" });
    assert.deepEqual(purchasePostingFor("Furniture", 5000, 5000), { accountCode: "1402", assetPool: "B" });
    assert.deepEqual(purchasePostingFor("Laboratory Equipment", 40000, 5000), { accountCode: "1404", assetPool: "D" });
    assert.deepEqual(purchasePostingFor("Medical Equipment", 9000, 5000), { accountCode: "1404", assetPool: "D" });
  });

  it("expenses asset purchases below the threshold to 5300", () => {
    assert.deepEqual(purchasePostingFor("Computer Equipment", 3000, 5000), { accountCode: "5300" });
    assert.deepEqual(purchasePostingFor("Sports Equipment", 4999, 5000), { accountCode: "5300" });
  });

  it("consumables go to their expense account whatever the amount", () => {
    assert.equal(purchasePostingFor("Books", 90000, 5000).accountCode, "5202");
    assert.equal(purchasePostingFor("Chemicals", 90000, 5000).accountCode, "5201");
    assert.equal(purchasePostingFor("Stationery", 90000, 5000).accountCode, "5300");
    assert.equal(purchasePostingFor("Office Supplies", 100, 5000).accountCode, "5300");
    assert.equal(purchasePostingFor("Unknown category", 100, 5000).accountCode, "5300");
  });

  it("indirect expense categories keep their own accounts, never 5300", () => {
    const expected: Record<string, string> = {
      Electricity: "5203",
      Internet: "5204",
      Maintenance: "5205",
      Hospital: "5206",
      "Community Field": "5207",
      Office: "5208",
      Miscellaneous: "5209"
    };
    for (const [category, account] of Object.entries(expected)) {
      assert.equal(EXPENSE_CATEGORY_ACCOUNT_MAP[category], account, category);
    }
    assert.ok(!Object.values(EXPENSE_CATEGORY_ACCOUNT_MAP).includes("5300"));
  });
});
