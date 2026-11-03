/**
 * Backfill fee breakdowns on existing receipts and move their fee income out of 4100.
 *
 * Receipts saved with no fee line (Bank / Cash entry, "Fee charged" left at 0) were posted
 * as Dr Cash/Bank · Cr 4100 Other Income. For each such receipt this script:
 *   1. sets its feeBreakdown to TUITION = amount paid (a security deposit line is kept);
 *   2. if its active voucher credits 4100: posts a reversal of that voucher and a new
 *      voucher with the same lines (same cash / bank account and bank) but the fee credit
 *      on the right fee income account (4003 Tuition …). Both are linked to the receipt
 *      (referenceType FeeCollection). The old voucher is never edited — it is only flagged
 *      as reversed, exactly as a void does;
 *   3. recomputes the student's paid / outstanding.
 * Receipts in a closed fiscal year or before the audit-lock date are listed and skipped.
 *
 * Usage (from the backend folder):
 *   npm run fees:backfill-breakdown:dry-run     # prints the table, changes nothing
 *   npm run fees:backfill-breakdown             # applies it
 *   (add  -- --school <schoolId>  to limit to one institution)
 *
 * Idempotent: a fixed receipt has a breakdown and no active 4100 voucher, so a second run
 * finds nothing. If a run stops between a reversal and its correction, the next run posts
 * the missing correction.
 */
import mongoose, { type Types } from "mongoose";
import { SYSTEM_ACCOUNT_CODES, feeIncomeAccountFor, type VoucherType } from "@phit-erp/shared";
import { env } from "../config/env.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { Student } from "../models/Student.js";
import { isOpeningTuitionCharge, recalculateStudentFeesDue } from "../utils/accountingCalculations.js";
import { assertFiscalPeriodOpen } from "../utils/fiscalYear.js";
import { postJournalEntry } from "../utils/journalPosting.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const schoolArg = args.includes("--school") ? args[args.indexOf("--school") + 1] : undefined;

const OTHER_INCOME = SYSTEM_ACCOUNT_CODES.OTHER_INCOME;
/** Marks vouchers posted by this script (also how an interrupted run is resumed). */
const REVERSAL_MARK = "Fee income moved out of 4100 — reversal of";
const CORRECTION_MARK = "Fee income moved out of 4100 — correction of";

type Line = {
  accountCode: string;
  accountName: string;
  debitNpr: number;
  creditNpr: number;
  description?: string | null;
  bankAccountId?: Types.ObjectId | null;
};
type Voucher = {
  _id: Types.ObjectId;
  voucherNumber: string;
  voucherType?: string;
  dateBs: string;
  narration: string;
  lines: Line[];
  isReversal?: boolean;
  isReversed?: boolean;
  reversedEntryId?: Types.ObjectId | null;
  studentId?: Types.ObjectId | null;
  bankAccountId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
};

const isFeeLine = (b: { feeType?: unknown }) => String(b.feeType) !== "SECURITY_DEPOSIT";
const creditsOtherIncome = (v: Voucher) => v.lines.some((l) => l.accountCode === OTHER_INCOME && l.creditNpr > 0);

/** Fee head for a 4100 line: the breakdown line with the same title, else Tuition. */
const feeTypeForLine = (line: Line, breakdown: Array<{ feeType?: unknown; title?: unknown }>): string => {
  const match = breakdown.find((b) => isFeeLine(b) && String(b.title ?? "") === String(line.description ?? ""));
  return match ? String(match.feeType) : "TUITION";
};

const correctedLines = (voucher: Voucher, breakdown: Array<{ feeType?: unknown; title?: unknown }>) =>
  voucher.lines.map((line) => {
    const base = {
      accountCode: line.accountCode,
      accountName: line.accountName,
      debitNpr: line.debitNpr,
      creditNpr: line.creditNpr,
      description: line.description ?? undefined,
      bankAccountId: line.bankAccountId ?? undefined
    };
    if (line.accountCode !== OTHER_INCOME || line.creditNpr <= 0) return base;
    const feeType = feeTypeForLine(line, breakdown);
    return {
      ...base,
      accountCode: feeIncomeAccountFor(feeType),
      accountName: "", // resolved from the chart of accounts when posted
      description: feeType === "TUITION" ? "Tuition / program fee" : line.description ?? undefined
    };
  });

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  const receiptFilter: Record<string, unknown> = { isDeleted: false, amountPaidNpr: { $gt: 0 } };
  if (schoolArg) receiptFilter.schoolId = new mongoose.Types.ObjectId(schoolArg);
  const receipts = (await FeeCollection.find(receiptFilter).lean()).filter(
    (r) => !isOpeningTuitionCharge(r as unknown as Record<string, unknown>)
  );

  const vouchers = (await JournalEntry.find({
    referenceType: "FeeCollection",
    referenceId: { $in: receipts.map((r) => r._id) },
    isDeleted: false
  }).lean()) as unknown as Array<Voucher & { referenceId: Types.ObjectId }>;
  const vouchersByReceipt = new Map<string, Array<Voucher & { referenceId: Types.ObjectId }>>();
  for (const v of vouchers) {
    const key = String(v.referenceId);
    vouchersByReceipt.set(key, [...(vouchersByReceipt.get(key) ?? []), v]);
  }

  const students = await Student.find({ _id: { $in: [...new Set(receipts.map((r) => String(r.studentId)))] } })
    .populate("user", "fullName")
    .select("user admissionNumber")
    .lean();
  const studentName = new Map(
    students.map((s) => [String(s._id), `${(s.user as { fullName?: string } | null)?.fullName ?? ""} (${s.admissionNumber ?? ""})`])
  );

  type Plan = {
    receipt: (typeof receipts)[number];
    setBreakdown: boolean;
    voucher?: Voucher;
    /** Original already reversed by an interrupted run — only the correction is missing. */
    resumeFrom?: Voucher;
    amount: number;
    newAccount: string;
    skipped?: string;
  };
  const plans: Plan[] = [];

  for (const receipt of receipts) {
    const list = vouchersByReceipt.get(String(receipt._id)) ?? [];
    // Original fee vouchers that credit 4100 and still need a correction
    const hasCorrection = (o: Voucher) =>
      list.some((v) => !v.isReversal && v.narration.startsWith(`${CORRECTION_MARK} ${o.voucherNumber} `));
    const reversalOf = (o: Voucher) => list.find((v) => v.isReversal && String(v.reversedEntryId) === String(o._id));
    const pending = list.filter(
      (v) => !v.isReversal && creditsOtherIncome(v) && !v.narration.startsWith(CORRECTION_MARK) && !hasCorrection(v)
    );
    // Not yet reversed by anyone → reverse + correct
    const badVoucher = pending.find((o) => !o.isReversed && !reversalOf(o));
    // Reversed by this script but the run stopped before its correction → correct only
    const resumeFrom = badVoucher
      ? undefined
      : pending.find((o) => reversalOf(o)?.narration.startsWith(REVERSAL_MARK));
    const setBreakdown = !(receipt.feeBreakdown ?? []).some(isFeeLine);
    if (!setBreakdown && !badVoucher && !resumeFrom) continue;

    const source = badVoucher ?? resumeFrom;
    const breakdown = setBreakdown
      ? [{ feeType: "TUITION", title: "Tuition / program fee" }]
      : (receipt.feeBreakdown ?? []);
    const otherLine = source?.lines.find((l) => l.accountCode === OTHER_INCOME && l.creditNpr > 0);
    const plan: Plan = {
      receipt,
      setBreakdown,
      voucher: badVoucher,
      resumeFrom,
      amount: otherLine?.creditNpr ?? Number(receipt.amountPaidNpr) ?? 0,
      newAccount: otherLine ? feeIncomeAccountFor(feeTypeForLine(otherLine, breakdown)) : "—"
    };
    if (source) {
      try {
        await assertFiscalPeriodOpen(receipt.schoolId, source.dateBs);
      } catch (error) {
        plan.skipped = (error as Error).message;
      }
    }
    plans.push(plan);
  }

  // ── Table ───────────────────────────────────────────────────────────────────
  const pad = (value: unknown, width: number) => String(value ?? "").slice(0, width).padEnd(width);
  console.log(
    `\n${pad("Receipt No.", 16)} ${pad("Student", 34)} ${pad("Amount", 12)} ${pad("Old a/c", 8)} ${pad("New a/c", 8)} Action`
  );
  for (const p of plans) {
    const action = p.skipped
      ? `SKIPPED — ${p.skipped}`
      : [
          p.setBreakdown ? "set breakdown" : "",
          p.voucher ? `reverse ${p.voucher.voucherNumber} + repost` : "",
          p.resumeFrom ? `post missing correction of ${p.resumeFrom.voucherNumber}` : ""
        ]
          .filter(Boolean)
          .join("; ");
    console.log(
      `${pad(p.receipt.receiptNumber, 16)} ${pad(studentName.get(String(p.receipt.studentId)) ?? "", 34)} ${pad(
        Number(p.amount).toLocaleString("en-IN"),
        12
      )} ${pad(p.voucher || p.resumeFrom ? OTHER_INCOME : "—", 8)} ${pad(p.newAccount, 8)} ${action}`
    );
  }
  const reposts = plans.filter((p) => !p.skipped && (p.voucher || p.resumeFrom));
  const skipped = plans.filter((p) => p.skipped);
  console.log(
    `\nReceipts: ${plans.length} · breakdown to set: ${plans.filter((p) => p.setBreakdown && !p.skipped).length} · vouchers to reverse + repost: ${reposts.length} (NPR ${reposts
      .reduce((s, p) => s + Number(p.amount), 0)
      .toLocaleString("en-IN")}) · skipped (closed / locked period): ${skipped.length}`
  );

  if (!apply) {
    console.log("\nDry run — nothing changed. Run with --apply to make these changes.");
    await mongoose.disconnect();
    return;
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  const touchedStudents = new Map<string, Types.ObjectId>();
  let done = 0;
  for (const p of plans) {
    if (p.skipped) continue;
    const r = p.receipt;
    const breakdown = p.setBreakdown
      ? [
          { feeType: "TUITION", title: "Tuition / program fee", amountNpr: Number(r.amountPaidNpr) },
          ...(r.feeBreakdown ?? []).filter((b) => !isFeeLine(b))
        ]
      : (r.feeBreakdown ?? []);

    if (p.setBreakdown) {
      await FeeCollection.updateOne({ _id: r._id }, { $set: { feeBreakdown: breakdown } });
    }

    const original = p.voucher ?? p.resumeFrom;
    if (original) {
      if (p.voucher) {
        // Reversal: same lines with debit and credit swapped, on the original date
        await postJournalEntry({
          schoolId: r.schoolId,
          userId: original.createdBy,
          dateBs: original.dateBs,
          narration: `${REVERSAL_MARK} ${original.voucherNumber}`,
          lines: original.lines.map((l) => ({
            accountCode: l.accountCode,
            accountName: l.accountName,
            debitNpr: l.creditNpr,
            creditNpr: l.debitNpr,
            description: `Reversal: ${l.description ?? ""}`,
            bankAccountId: l.bankAccountId ?? undefined
          })),
          voucherType: (original.voucherType ?? "RECEIPT") as VoucherType,
          referenceType: "FeeCollection",
          referenceId: r._id,
          studentId: original.studentId ?? undefined,
          bankAccountId: original.bankAccountId ?? undefined,
          isReversal: true,
          reversedEntryId: original._id
        });
      }
      // The only change to the old voucher: flagged as reversed (as a void does)
      await JournalEntry.updateOne({ _id: original._id }, { $set: { isReversed: true } });
      await postJournalEntry({
        schoolId: r.schoolId,
        userId: original.createdBy,
        dateBs: original.dateBs,
        narration: `${CORRECTION_MARK} ${original.voucherNumber} — ${original.narration}`,
        lines: correctedLines(original, breakdown),
        voucherType: (original.voucherType ?? "RECEIPT") as VoucherType,
        referenceType: "FeeCollection",
        referenceId: r._id,
        studentId: original.studentId ?? undefined,
        bankAccountId: original.bankAccountId ?? undefined
      });
    }
    touchedStudents.set(String(r.studentId), r.schoolId);
    done += 1;
  }

  for (const [studentId, schoolId] of touchedStudents) {
    await recalculateStudentFeesDue(studentId, schoolId);
  }
  console.log(`\nFixed ${done} receipt(s); recomputed ${touchedStudents.size} student(s).`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
