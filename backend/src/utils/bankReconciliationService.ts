import type { Types } from "mongoose";
import { SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";
import { JournalEntry } from "../models/JournalEntry.js";
import { BankReconciliation } from "../models/BankReconciliation.js";
import { getAccountOpeningBalance } from "./accountingReports.js";

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export interface ReconciliationItem {
  journalEntryId: string;
  dateBs: string;
  voucherNumber: string;
  narration: string;
  debitNpr: number;
  creditNpr: number;
  cleared: boolean;
}

/**
 * Build the working view for a reconciliation as at a statement date.
 *
 * Standard BRS logic, from the ledger side:
 *
 *   ledger balance
 *     − cheques issued but not yet presented   (uncleared credits)
 *     + deposits banked but not yet credited   (uncleared debits)
 *     = balance that should appear on the statement
 *
 * Anything left in `differenceNpr` is genuinely unexplained — bank charges or interest not
 * yet journalled, or an error — and is surfaced rather than absorbed.
 */
export const buildReconciliationView = async (params: {
  schoolId: Types.ObjectId;
  accountCode?: string;
  statementDateBs: string;
  statementBalanceNpr: number;
  clearedEntryIds?: Array<Types.ObjectId | string>;
  /** Only list transactions from this date onward; earlier ones fold into the opening balance. */
  fromDateBs?: string;
}) => {
  const accountCode = params.accountCode || SYSTEM_ACCOUNT_CODES.BANK;
  const cleared = new Set((params.clearedEntryIds ?? []).map((id) => id.toString()));

  const match: Record<string, unknown> = {
    schoolId: params.schoolId,
    isDeleted: false,
    isPosted: true,
    "lines.accountCode": accountCode,
    dateBs: { $lte: params.statementDateBs }
  };
  if (params.fromDateBs) {
    (match.dateBs as Record<string, string>).$gte = params.fromDateBs;
  }

  const entries = await JournalEntry.find(match).sort({ dateBs: 1, createdAt: 1 }).lean();

  const items: ReconciliationItem[] = entries.map((entry) => {
    const accountLines = entry.lines.filter((l) => l.accountCode === accountCode);
    const debitNpr = round2(accountLines.reduce((s, l) => s + l.debitNpr, 0));
    const creditNpr = round2(accountLines.reduce((s, l) => s + l.creditNpr, 0));
    return {
      journalEntryId: entry._id.toString(),
      dateBs: entry.dateBs,
      voucherNumber: entry.voucherNumber,
      narration: entry.narration,
      debitNpr,
      creditNpr,
      cleared: cleared.has(entry._id.toString())
    };
  });

  const openingNpr = params.fromDateBs
    ? await getAccountOpeningBalance(params.schoolId, accountCode, params.fromDateBs)
    : 0;

  const movementNpr = round2(items.reduce((s, i) => s + i.debitNpr - i.creditNpr, 0));
  const ledgerBalanceNpr = round2(openingNpr + movementNpr);

  const uncleared = items.filter((i) => !i.cleared);
  // Money paid out that the bank has not taken yet.
  const unpresentedChequesNpr = round2(uncleared.reduce((s, i) => s + i.creditNpr, 0));
  // Money banked that the bank has not credited yet.
  const depositsInTransitNpr = round2(uncleared.reduce((s, i) => s + i.debitNpr, 0));

  const adjustedBalanceNpr = round2(ledgerBalanceNpr - depositsInTransitNpr + unpresentedChequesNpr);
  const differenceNpr = round2(adjustedBalanceNpr - params.statementBalanceNpr);

  return {
    accountCode,
    statementDateBs: params.statementDateBs,
    statementBalanceNpr: round2(params.statementBalanceNpr),
    openingNpr,
    items,
    ledgerBalanceNpr,
    unpresentedChequesNpr,
    depositsInTransitNpr,
    adjustedBalanceNpr,
    differenceNpr,
    isReconciled: Math.abs(differenceNpr) < 0.01,
    clearedCount: items.length - uncleared.length,
    unclearedCount: uncleared.length
  };
};

/**
 * Entries cleared in the most recent completed reconciliation for an account. Used to
 * pre-tick items the previous reconciliation already settled.
 */
export const getPreviouslyClearedIds = async (
  schoolId: Types.ObjectId,
  accountCode: string,
  beforeDateBs: string
): Promise<string[]> => {
  const previous = await BankReconciliation.find({
    schoolId,
    accountCode,
    isDeleted: false,
    status: "COMPLETED",
    statementDateBs: { $lt: beforeDateBs }
  })
    .select("clearedEntryIds")
    .lean();

  const ids = new Set<string>();
  for (const rec of previous) {
    for (const id of rec.clearedEntryIds ?? []) ids.add(id.toString());
  }
  return Array.from(ids);
};
