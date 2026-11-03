/**
 * Flag existing system opening-charge records (receipt "OPEN-…", "Opening tuition charge
 * from student admission fee plan") with isOpeningCharge: true.
 *
 * They are the student's admission fee plan — a CHARGE, not money received. Reports already
 * recognise them by their receipt number / notes; the flag makes that explicit and lets the
 * database leave them out of collection queries. Only the flag is set; amounts, dates and
 * journals are not touched.
 *
 * Usage (from the backend folder):
 *   npm run fees:mark-opening:dry-run     # lists what would be flagged, changes nothing
 *   npm run fees:mark-opening             # sets the flag
 *
 * Idempotent: records already flagged are skipped.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { isOpeningTuitionCharge } from "../utils/accountingCalculations.js";

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  // Candidates: not yet flagged and looking like a system opening charge
  const candidates = await FeeCollection.find({
    isOpeningCharge: { $ne: true },
    $or: [
      { receiptNumber: /^OPEN-/ },
      { notes: /opening tuition charge/i },
      { amountPaidNpr: 0, paymentMethod: "OTHER", accountantName: "System" }
    ]
  })
    .select("receiptNumber paidDateBs programYear currentChargesNpr amountPaidNpr paymentMethod accountantName notes isDeleted")
    .lean();
  const toFlag = candidates.filter((row) => isOpeningTuitionCharge(row as unknown as Record<string, unknown>));
  // Never flag a record that took money — it is a real receipt whatever its number says
  const paid = toFlag.filter((row) => Number(row.amountPaidNpr) > 0);
  const flag = toFlag.filter((row) => !(Number(row.amountPaidNpr) > 0));

  console.log(`\nOpening charges to flag: ${flag.length} (total charge NPR ${flag
    .reduce((s, r) => s + (Number(r.currentChargesNpr) || 0), 0)
    .toLocaleString("en-IN")})`);
  flag.slice(0, 20).forEach((r) =>
    console.log(`  ${String(r.receiptNumber).padEnd(34)} year ${r.programYear ?? "-"}  charge NPR ${Number(r.currentChargesNpr).toLocaleString("en-IN")}`)
  );
  if (flag.length > 20) console.log(`  … and ${flag.length - 20} more`);
  if (paid.length) {
    console.log(`\nNot flagged — they record money received (check manually): ${paid.length}`);
    paid.forEach((r) => console.log(`  ${r.receiptNumber}  paid NPR ${r.amountPaidNpr}`));
  }

  if (!apply) {
    console.log("\nDry run — nothing changed. Run with --apply to set the flag.");
  } else if (flag.length) {
    const result = await FeeCollection.updateMany(
      { _id: { $in: flag.map((r) => r._id) }, isOpeningCharge: { $ne: true } },
      { $set: { isOpeningCharge: true } }
    );
    console.log(`\nFlagged ${result.modifiedCount} record(s).`);
  } else {
    console.log("\nNothing to flag.");
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
