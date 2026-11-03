/**
 * Chart of accounts: mark group (header) accounts and move Other Income out of Fee Income.
 *
 * For every institution:
 *   1. creates 4099 "Other Income" (group) if missing;
 *   2. moves 4100 Miscellaneous Income and 4101–4105 (Donation, Certificate Fee, Form Sales,
 *      Interest, Asset Disposal) from under 4000 to under 4099;
 *   3. renames 4000 "Income" to "Fee Income" (it now holds fee accounts only);
 *   4. sets isGroup = true on every account that other accounts sit under (1000, 2000, …).
 * Then it REPORTS any group account that carries a balance, with the vouchers behind it, so
 * they can be reversed by hand from Journal Entries. Journals are never changed.
 *
 * Usage (from the backend folder):
 *   npm run accounting:group-accounts:dry-run   # prints changes + group balances only
 *   npm run accounting:group-accounts           # applies the chart changes
 *
 * Idempotent: a second run finds nothing to change (the balance report is repeated).
 */
import mongoose from "mongoose";
import { SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { refreshAccountGroupFlags } from "../utils/journalPosting.js";

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
const GROUP = SYSTEM_ACCOUNT_CODES.OTHER_INCOME_GROUP;
const MOVE = ["4100", "4101", "4102", "4103", "4104", "4105"];
const round2 = (n: number) => Math.round(n * 100) / 100;

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  const schoolIds = (await ChartOfAccount.distinct("schoolId")) as mongoose.Types.ObjectId[];
  for (const schoolId of schoolIds) {
    console.log(`\n── Institution ${schoolId} ──`);
    const accounts = await ChartOfAccount.find({ schoolId }).lean();
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    // Planned chart changes
    const createGroup = !byCode.has(GROUP);
    const moves = MOVE.filter((code) => byCode.get(code)?.parentCode === "4000");
    const rename4000 = byCode.get("4000")?.name === "Income";
    const after = accounts
      .filter((a) => a.isActive !== false)
      .map((a) => ({
        code: a.code,
        parentCode: moves.includes(a.code) ? GROUP : a.parentCode
      }));
    if (createGroup) after.push({ code: GROUP, parentCode: undefined });
    const parents = new Set(after.map((a) => a.parentCode).filter((c): c is string => Boolean(c)));
    const groupChanges = accounts.filter((a) => parents.has(a.code) !== (a.isGroup === true));

    console.log(createGroup ? `  + create ${GROUP} Other Income (group)` : `  = ${GROUP} Other Income exists`);
    moves.forEach((code) => console.log(`  ~ move ${code} ${byCode.get(code)?.name} under ${GROUP}`));
    if (rename4000) console.log(`  ~ rename 4000 "Income" → "Fee Income"`);
    groupChanges.forEach((a) => console.log(`  ~ ${a.code} ${a.name}: isGroup → ${parents.has(a.code)}`));
    if (!createGroup && !moves.length && !rename4000 && !groupChanges.length) console.log("  nothing to change");

    if (apply) {
      if (createGroup) {
        await ChartOfAccount.create({
          schoolId,
          code: GROUP,
          name: "Other Income",
          nameNp: "अन्य आम्दानी",
          accountType: "INCOME",
          isSystem: true,
          isActive: true
        });
      }
      if (moves.length) {
        await ChartOfAccount.updateMany({ schoolId, code: { $in: moves }, parentCode: "4000" }, { $set: { parentCode: GROUP } });
      }
      if (rename4000) await ChartOfAccount.updateOne({ schoolId, code: "4000", name: "Income" }, { $set: { name: "Fee Income" } });
      await refreshAccountGroupFlags(schoolId);
    }

    // Report: balances sitting on group accounts (to be reversed by hand)
    const groupCodes = Array.from(parents);
    const vouchers = await JournalEntry.find({
      schoolId,
      isDeleted: false,
      isPosted: true,
      "lines.accountCode": { $in: groupCodes }
    })
      .select("voucherNumber dateBs narration lines isReversal isReversed referenceType")
      .sort({ dateBs: 1 })
      .lean();
    const balances = new Map<string, number>();
    for (const v of vouchers) {
      for (const line of v.lines) {
        if (!groupCodes.includes(line.accountCode)) continue;
        balances.set(line.accountCode, round2((balances.get(line.accountCode) ?? 0) + line.debitNpr - line.creditNpr));
      }
    }
    const withBalance = Array.from(balances.entries()).filter(([, b]) => Math.abs(b) >= 0.01);
    if (!withBalance.length) {
      console.log("  Group accounts with a balance: none");
      continue;
    }
    console.log("  Group accounts with a balance (reverse these vouchers by hand — Journal Entries → Reverse):");
    for (const [code, balance] of withBalance) {
      console.log(`    ${code} ${byCode.get(code)?.name ?? ""}: balance NPR ${balance} (${balance < 0 ? "credit" : "debit"})`);
      for (const v of vouchers) {
        if (v.isReversal || v.isReversed) continue;
        const amount = round2(v.lines.filter((l) => l.accountCode === code).reduce((s, l) => s + l.debitNpr - l.creditNpr, 0));
        if (Math.abs(amount) < 0.01) continue;
        console.log(
          `      voucher ${v.voucherNumber}  id ${v._id}  ${v.dateBs}  ${amount < 0 ? "Cr" : "Dr"} ${Math.abs(amount)}  "${v.narration}" (${v.referenceType ?? "Manual"})`
        );
      }
    }
  }

  if (!apply) console.log("\nDry run — chart not changed. Run with --apply to apply the chart changes.");
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
