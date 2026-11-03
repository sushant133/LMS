/**
 * Post the journal vouchers missing for existing accounting records.
 *
 * Older records (imported / demo data, or saved before posting was wired up) appear in
 * their registers but not in the ledger, Trial Balance or any statement. For every record
 * below that has no ACTIVE voucher (one that is not a reversal and not reversed), this
 * posts the voucher the normal save flow posts — through the same posting functions —
 * dated on the record's own date:
 *   - Indirect expenses                       (postExpenseJournal)
 *   - Direct expenses: PAID → Cr Cash/Bank, PENDING / PARTIAL → Cr Accounts Payable
 *                                             (postPurchaseJournal)
 *   - Receipts From Students (other income)   (postIncomeJournal)
 *   - PAID salary payments                    (postSalaryJournal)
 *   - Student fee receipts (not opening charges) (postFeeCollectionJournal)
 *   - Approved refunds                        (postFeeRefundJournal)
 * Records dated in a closed fiscal year or before the audit-lock date are listed and
 * skipped. Existing vouchers are never edited.
 *
 * Usage (from the backend folder):
 *   npm run accounting:backfill-journals:dry-run   # table only, changes nothing
 *   npm run accounting:backfill-journals           # posts the vouchers
 *   (add  -- --school <schoolId>  to limit to one institution)
 *
 * Idempotent: a record with an active voucher is skipped, so a second run posts nothing.
 */
import mongoose, { type Types } from "mongoose";
import { env } from "../config/env.js";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { isOpeningTuitionCharge } from "../utils/accountingCalculations.js";
import { assertFiscalPeriodOpen } from "../utils/fiscalYear.js";
import { registerPurchasedAsset, resolvePurchasePosting } from "../utils/purchaseCapitalization.js";
import {
  postExpenseJournal,
  postFeeCollectionJournal,
  postFeeRefundJournal,
  postIncomeJournal,
  postPurchaseJournal,
  postSalaryJournal
} from "../utils/journalPosting.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const schoolArg = args.includes("--school") ? args[args.indexOf("--school") + 1] : undefined;
const scope: Record<string, unknown> = schoolArg ? { schoolId: new mongoose.Types.ObjectId(schoolArg) } : {};

type Missing = {
  kind: string;
  referenceType: string;
  id: Types.ObjectId;
  schoolId: Types.ObjectId;
  dateBs: string;
  amountNpr: number;
  label: string;
  skipped?: string;
  post: () => Promise<void>;
};

/** Record ids (of one reference type) that already have an active voucher. */
const activelyPosted = async (referenceType: string, ids: Types.ObjectId[]) => {
  if (!ids.length) return new Set<string>();
  const refs = await JournalEntry.distinct("referenceId", {
    referenceType,
    referenceId: { $in: ids },
    isDeleted: false,
    isReversal: { $ne: true },
    isReversed: { $ne: true }
  });
  return new Set(refs.map((id) => String(id)));
};

const findMissing = async (): Promise<Missing[]> => {
  const missing: Missing[] = [];

  const expenses = await AccountingExpense.find({ ...scope, isDeleted: false, amountNpr: { $gt: 0 } }).lean();
  const expenseDone = await activelyPosted("AccountingExpense", expenses.map((e) => e._id));
  for (const e of expenses) {
    if (expenseDone.has(String(e._id))) continue;
    missing.push({
      kind: "Indirect expense",
      referenceType: "AccountingExpense",
      id: e._id,
      schoolId: e.schoolId,
      dateBs: e.dateBs,
      amountNpr: e.amountNpr,
      label: `${e.voucherNumber ?? ""} ${e.category} — ${e.description}`.trim(),
      post: () =>
        postExpenseJournal({
          schoolId: e.schoolId,
          userId: e.createdBy,
          expenseId: e._id,
          dateBs: e.dateBs,
          amountNpr: e.amountNpr,
          category: e.category,
          paymentMethod: e.paymentMethod ?? "CASH",
          description: e.description,
          bankAccountId: e.bankAccountId ?? undefined
        })
    });
  }

  const purchases = await AccountingPurchase.find({ ...scope, isDeleted: false, totalAmountNpr: { $gt: 0 } }).lean();
  const purchaseDone = await activelyPosted("AccountingPurchase", purchases.map((p) => p._id));
  for (const p of purchases) {
    if (purchaseDone.has(String(p._id))) continue;
    missing.push({
      kind: p.paymentStatus === "PAID" ? "Direct expense (paid)" : "Direct expense (payable)",
      referenceType: "AccountingPurchase",
      id: p._id,
      schoolId: p.schoolId,
      dateBs: p.purchaseDateBs,
      amountNpr: p.totalAmountNpr,
      label: `${p.voucherNumber ?? ""} ${p.vendor} · Bill ${p.invoiceNumber ?? ""}`.trim(),
      post: async () => {
        // Same rule as saving a purchase: capitalise (and register) asset purchases
        const posting = await resolvePurchasePosting(p.schoolId, p.category, p.totalAmountNpr);
        const journal = await postPurchaseJournal({
          schoolId: p.schoolId,
          userId: p.createdBy,
          purchaseId: p._id,
          dateBs: p.purchaseDateBs,
          amountNpr: p.totalAmountNpr,
          category: p.category,
          paymentStatus: p.paymentStatus,
          paymentMethod: p.paymentMethod ?? "CASH",
          vendor: p.vendor,
          bankAccountId: p.bankAccountId ?? undefined,
          debitAccountCode: posting.accountCode
        });
        if (posting.assetPool) {
          await registerPurchasedAsset({ schoolId: p.schoolId, userId: p.createdBy, pool: posting.assetPool, purchase: p, journalEntryId: journal._id });
        }
      }
    });
  }

  const incomes = await AccountingIncome.find({ ...scope, isDeleted: false, amountNpr: { $gt: 0 } }).lean();
  const incomeDone = await activelyPosted("AccountingIncome", incomes.map((i) => i._id));
  for (const i of incomes) {
    if (incomeDone.has(String(i._id))) continue;
    missing.push({
      kind: "Receipt from students (other)",
      referenceType: "AccountingIncome",
      id: i._id,
      schoolId: i.schoolId,
      dateBs: i.dateBs,
      amountNpr: i.amountNpr,
      label: `${i.receiptNumber ?? ""} ${i.category} — ${i.source ?? ""}`.trim(),
      post: () =>
        postIncomeJournal({
          schoolId: i.schoolId,
          userId: i.createdBy,
          incomeId: i._id,
          dateBs: i.dateBs,
          amountNpr: i.amountNpr,
          category: i.category,
          paymentMethod: i.paymentMethod ?? "CASH",
          description: i.description || i.category,
          bankAccountId: i.bankAccountId ?? undefined
        })
    });
  }

  const salaries = await SalaryPayment.find({ ...scope, isDeleted: false, status: "PAID", netSalaryNpr: { $gt: 0 } }).lean();
  const salaryDone = await activelyPosted("SalaryPayment", salaries.map((s) => s._id));
  for (const s of salaries) {
    if (salaryDone.has(String(s._id))) continue;
    const dateBs = s.paidDateBs || `${s.monthBs}-01`;
    missing.push({
      kind: "Salary (paid)",
      referenceType: "SalaryPayment",
      id: s._id,
      schoolId: s.schoolId,
      dateBs,
      amountNpr: Number(s.netSalaryNpr) || 0,
      label: `${s.monthBs} ${s.staffName ?? s.employeeType ?? ""}`.trim(),
      post: () =>
        postSalaryJournal({
          schoolId: s.schoolId,
          userId: s.createdBy,
          salaryId: s._id,
          dateBs,
          amountNpr: Number(s.netSalaryNpr) || 0,
          taxNpr: Number(s.taxNpr) || 0,
          paymentMethod: s.paymentMethod ?? "CASH",
          monthBs: s.monthBs
        })
    });
  }

  const fees = (await FeeCollection.find({ ...scope, isDeleted: false }).lean()).filter((c) => {
    if (isOpeningTuitionCharge(c as unknown as Record<string, unknown>)) return false;
    const value =
      (Number(c.amountPaidNpr) || 0) +
      (Number(c.securityDepositPaidNpr) || 0) +
      (Number(c.discountNpr) || 0) +
      (Number(c.scholarshipNpr) || 0);
    return value > 0;
  });
  const feeDone = await activelyPosted("FeeCollection", fees.map((c) => c._id));
  for (const c of fees) {
    if (feeDone.has(String(c._id))) continue;
    missing.push({
      kind: "Student fee receipt",
      referenceType: "FeeCollection",
      id: c._id,
      schoolId: c.schoolId,
      dateBs: c.paidDateBs,
      amountNpr: (Number(c.amountPaidNpr) || 0) + (Number(c.securityDepositPaidNpr) || 0),
      label: `Receipt ${c.receiptNumber}`,
      post: () =>
        postFeeCollectionJournal({
          schoolId: c.schoolId,
          userId: c.createdBy,
          collectionId: c._id,
          studentId: c.studentId,
          dateBs: c.paidDateBs,
          amountPaidNpr: Number(c.amountPaidNpr) || 0,
          securityDepositPaidNpr: Number(c.securityDepositPaidNpr) || 0,
          discountNpr: Number(c.discountNpr) || 0,
          scholarshipNpr: Number(c.scholarshipNpr) || 0,
          lateFeeNpr: 0,
          paymentMethod: c.paymentMethod ?? "CASH",
          bankAccountId: c.bankAccountId ?? undefined,
          receiptNumber: c.receiptNumber,
          feeBreakdown: (c.feeBreakdown ?? []).map((b) => ({ feeType: b.feeType, title: b.title, amountNpr: b.amountNpr }))
        })
    });
  }

  const refunds = await FeeRefund.find({ ...scope, isDeleted: false, status: "APPROVED", amountNpr: { $gt: 0 } }).lean();
  const refundDone = await activelyPosted("FeeRefund", refunds.map((r) => r._id));
  for (const r of refunds) {
    if (refundDone.has(String(r._id))) continue;
    missing.push({
      kind: "Refund",
      referenceType: "FeeRefund",
      id: r._id,
      schoolId: r.schoolId,
      dateBs: r.dateBs,
      amountNpr: r.amountNpr,
      label: `Refund ${r.refundNumber}`,
      post: () =>
        postFeeRefundJournal({
          schoolId: r.schoolId,
          userId: r.createdBy,
          refundId: r._id,
          studentId: r.studentId,
          dateBs: r.dateBs,
          amountNpr: r.amountNpr,
          paymentMethod: r.paymentMethod ?? "CASH",
          bankAccountId: r.bankAccountId ?? undefined,
          refundNumber: r.refundNumber,
          isDepositRefund: r.refundType === "DEPOSIT_REFUND"
        })
    });
  }

  for (const m of missing) {
    try {
      await assertFiscalPeriodOpen(m.schoolId, m.dateBs);
    } catch (error) {
      m.skipped = (error as Error).message;
    }
  }
  return missing.sort((a, b) => a.dateBs.localeCompare(b.dateBs));
};

const main = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (nothing will be changed)");

  const missing = await findMissing();
  const pad = (value: unknown, width: number) => String(value ?? "").slice(0, width).padEnd(width);
  console.log(`\n${pad("Date (BS)", 11)} ${pad("Record", 30)} ${pad("Amount", 14)} Detail`);
  for (const m of missing) {
    console.log(
      `${pad(m.dateBs, 11)} ${pad(m.kind, 30)} ${pad(m.amountNpr.toLocaleString("en-IN"), 14)} ${m.label}${m.skipped ? `  — SKIPPED: ${m.skipped}` : ""}`
    );
  }
  const byKind = new Map<string, { count: number; amount: number }>();
  for (const m of missing.filter((x) => !x.skipped)) {
    const row = byKind.get(m.kind) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += m.amountNpr;
    byKind.set(m.kind, row);
  }
  console.log(`\nWithout an active voucher: ${missing.length} (skipped, closed / locked period: ${missing.filter((m) => m.skipped).length})`);
  byKind.forEach((row, kind) => console.log(`  ${kind}: ${row.count}, NPR ${row.amount.toLocaleString("en-IN")}`));

  if (!apply) {
    console.log("\nDry run — nothing changed. Run with --apply to post these vouchers.");
    await mongoose.disconnect();
    return;
  }

  let posted = 0;
  for (const m of missing) {
    if (m.skipped) continue;
    try {
      await m.post();
      posted += 1;
    } catch (error) {
      console.error(`  ! ${m.kind} ${m.label}: ${(error as Error).message}`);
    }
  }
  console.log(`\nPosted ${posted} voucher(s).`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
