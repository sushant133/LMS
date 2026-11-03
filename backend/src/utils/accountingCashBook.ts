import type { Request } from "express";
import type { ClientSession, Types } from "mongoose";
import { BankAccount } from "../models/BankAccount.js";
import { SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { tenantObjectId } from "./tenant.js";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Cash in Hand (ledger 1001) balance — the one figure every cash balance must equal. */
export const getLatestCashBalance = async (
  schoolId: Types.ObjectId,
  session?: ClientSession | null
): Promise<number> => {
  const pipeline = JournalEntry.aggregate<{ net: number }>([
    { $match: { schoolId, isDeleted: false, isPosted: true, "lines.accountCode": SYSTEM_ACCOUNT_CODES.CASH } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": SYSTEM_ACCOUNT_CODES.CASH } },
    { $group: { _id: null, net: { $sum: { $subtract: ["$lines.debitNpr", "$lines.creditNpr"] } } } }
  ]);
  if (session) pipeline.session(session);
  const [row] = await pipeline;
  return round2(row?.net ?? 0);
};

const SOURCE_LABELS: Record<string, string> = {
  FeeCollection: "Fee Collection",
  FeeRefund: "Refund",
  SalaryPayment: "Salary",
  AccountingExpense: "Indirect Expense",
  AccountingPurchase: "Direct Expense",
  AccountingIncome: "Other Receipt",
  GoshwaraVoucher: "Journal Voucher",
  Manual: "Journal"
};

export interface LedgerCashBookRow {
  _id: string;
  dateBs: string;
  voucherNumber: string;
  /** Cash book convention: receipt = DEBIT, payment = CREDIT. */
  entryType: "DEBIT" | "CREDIT";
  category: string;
  description: string;
  amountNpr: number;
  paymentMethod: "CASH";
  referenceType?: string;
  referenceId?: string;
  balanceAfterNpr: number;
}

/**
 * Cash Book built from the ledger: every posted line on 1001 Cash in Hand in date order,
 * receipts as DEBIT and payments as CREDIT, with a running balance that ends at the 1001
 * balance. Bank receipts / payments are on 1101 and so never appear here. Newest first.
 */
export const buildLedgerCashBook = async (
  schoolId: Types.ObjectId,
  filters?: { fromDateBs?: string; toDateBs?: string; limit?: number }
): Promise<LedgerCashBookRow[]> => {
  const CASH = SYSTEM_ACCOUNT_CODES.CASH;
  const entries = await JournalEntry.find({ schoolId, isDeleted: false, isPosted: true, "lines.accountCode": CASH })
    .select("dateBs voucherNumber narration referenceType referenceId voucherType lines createdAt")
    .sort({ dateBs: 1, createdAt: 1, _id: 1 })
    .lean();
  let balance = 0;
  const rows: LedgerCashBookRow[] = [];
  for (const entry of entries) {
    entry.lines.forEach((line, index) => {
      if (line.accountCode !== CASH) return;
      const net = (line.debitNpr ?? 0) - (line.creditNpr ?? 0);
      if (Math.abs(net) < 0.005) return;
      balance = round2(balance + net);
      if (filters?.toDateBs && entry.dateBs > filters.toDateBs) return;
      if (filters?.fromDateBs && entry.dateBs < filters.fromDateBs) return;
      rows.push({
        _id: `${entry._id.toString()}-${index}`,
        dateBs: entry.dateBs,
        voucherNumber: entry.voucherNumber,
        entryType: net > 0 ? "DEBIT" : "CREDIT",
        category:
          entry.voucherType === "CONTRA"
            ? "Cash / Bank Transfer"
            : SOURCE_LABELS[String(entry.referenceType ?? "")] ?? "Journal",
        description: line.description?.trim() || entry.narration,
        amountNpr: round2(Math.abs(net)),
        paymentMethod: "CASH",
        referenceType: entry.referenceType ?? undefined,
        referenceId: entry.referenceId ? String(entry.referenceId) : undefined,
        balanceAfterNpr: balance
      });
    });
  }
  // The running balance must count every line up to each row, so the To-date filter is
  // applied while walking (above) and only the slice shown is limited here.
  const newestFirst = rows.reverse();
  return filters?.limit ? newestFirst.slice(0, filters.limit) : newestFirst;
};

export const adjustPrimaryBankBalance = async (
  schoolId: Types.ObjectId,
  amountNpr: number,
  direction: "credit" | "debit",
  paymentMethod: string,
  bankAccountId?: string,
  session?: ClientSession | null
): Promise<void> => {
  const bankMethods = [
    "BANK_TRANSFER",
    "CHEQUE",
    "ESEWA",
    "KHALTI",
    "IMEPAY",
    "FONEPAY",
    "CONNECT_IPS",
    "ONLINE"
  ];
  if (!bankMethods.includes(paymentMethod) || amountNpr <= 0) return;

  const findOpts = session ? { session } : undefined;
  const account = bankAccountId
    ? await BankAccount.findOne({ _id: bankAccountId, schoolId, isActive: true }, null, findOpts)
    : await BankAccount.findOne({ schoolId, isActive: true }, null, findOpts).sort({ createdAt: 1 });

  if (!account) return;

  account.currentBalanceNpr =
    direction === "credit"
      ? account.currentBalanceNpr + amountNpr
      : Math.max(0, account.currentBalanceNpr - amountNpr);
  await account.save(session ? { session } : undefined);
};

export const recordCashEntry = async (
  req: Request,
  params: {
    dateBs: string;
    /** Money received (RECEIPT) or paid out (PAYMENT). */
    direction: "RECEIPT" | "PAYMENT";
    category: string;
    description: string;
    amountNpr: number;
    paymentMethod: string;
    referenceType?: string;
    referenceId?: string;
    bankAccountId?: string;
  },
  session?: ClientSession | null
) => {
  const schoolId = tenantObjectId(req);

  await adjustPrimaryBankBalance(
    schoolId,
    params.amountNpr,
    params.direction === "RECEIPT" ? "credit" : "debit",
    params.paymentMethod,
    params.bankAccountId,
    session
  );

  // Only cash goes in the cash book; bank-method money is in the bank book (ledger 1101).
  if (params.paymentMethod !== "CASH") return;

  // 1001 balance when saved — kept for reference; the Cash Book itself reads the ledger.
  const balanceAfterNpr = await getLatestCashBalance(schoolId, session);

  await CashBookEntry.create(
    [
      {
        schoolId,
        dateBs: params.dateBs,
        // Cash book convention: receipts on the debit side, payments on the credit side
        entryType: params.direction === "RECEIPT" ? "DEBIT" : "CREDIT",
        convention: "LEDGER",
        category: params.category,
        description: params.description,
        amountNpr: params.amountNpr,
        paymentMethod: params.paymentMethod,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        balanceAfterNpr,
        createdBy: req.user!.userId
      }
    ],
    session ? { session } : undefined
  );
};

export const reverseCashEntry = async (
  req: Request,
  referenceType: string,
  referenceId: string,
  dateBs: string,
  session?: ClientSession | null
): Promise<void> => {
  const schoolId = tenantObjectId(req);
  const query = CashBookEntry.findOne({ schoolId, referenceType, referenceId }).sort({ createdAt: -1 });
  if (session) query.session(session);
  const original = await query;
  if (!original) return;

  // Rows saved before the fix used CREDIT for money received.
  const wasReceipt =
    (original as { convention?: string }).convention === "LEDGER"
      ? original.entryType === "DEBIT"
      : original.entryType === "CREDIT";
  await recordCashEntry(
    req,
    {
      dateBs,
      direction: wasReceipt ? "PAYMENT" : "RECEIPT",
      category: original.category,
      description: `Reversal: ${original.description}`,
      amountNpr: original.amountNpr,
      paymentMethod: original.paymentMethod,
      referenceType,
      referenceId
    },
    session
  );
};