import { Types } from "mongoose";
import { SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";
import { BankAccount } from "../models/BankAccount.js";
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
  /** Voided later: a reversing entry cancels it. */
  isVoided?: boolean;
  /** The reversing entry of a voided transaction. */
  isReversal?: boolean;
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
  /**
   * Reconcile one bank account (its own statement): only Bank lines tagged to it,
   * starting from its opening balance — the same figures as its Bank Book.
   */
  bankAccountId?: Types.ObjectId | string;
}) => {
  const bankId = params.bankAccountId ? params.bankAccountId.toString() : undefined;
  const accountCode = bankId ? SYSTEM_ACCOUNT_CODES.BANK : params.accountCode || SYSTEM_ACCOUNT_CODES.BANK;
  const cleared = new Set((params.clearedEntryIds ?? []).map((id) => id.toString()));
  /** A Bank line belongs to the bank on the line, else the entry's bank. */
  const isThisAccount = (
    line: { accountCode: string; bankAccountId?: Types.ObjectId | null },
    entry: { bankAccountId?: Types.ObjectId | null }
  ) =>
    line.accountCode === accountCode &&
    (!bankId || (line.bankAccountId ?? entry.bankAccountId)?.toString() === bankId);

  const match: Record<string, unknown> = {
    schoolId: params.schoolId,
    isDeleted: false,
    isPosted: true,
    "lines.accountCode": accountCode,
    dateBs: { $lte: params.statementDateBs }
  };
  // Without a bank, earlier movement comes from the opening-balance aggregate instead
  if (params.fromDateBs && !bankId) {
    (match.dateBs as Record<string, string>).$gte = params.fromDateBs;
  }
  if (bankId) {
    const id = new Types.ObjectId(bankId);
    match.$or = [{ bankAccountId: id }, { "lines.bankAccountId": id }];
  }

  const allEntries = await JournalEntry.find(match).sort({ dateBs: 1, createdAt: 1 }).lean();
  // Movement before the listing start only builds the opening balance
  const entries = allEntries.filter(
    (entry) =>
      (!params.fromDateBs || entry.dateBs >= params.fromDateBs) &&
      entry.lines.some((line) => isThisAccount(line, entry))
  );

  const items: ReconciliationItem[] = entries.map((entry) => {
    const accountLines = entry.lines.filter((l) => isThisAccount(l, entry));
    const debitNpr = round2(accountLines.reduce((s, l) => s + l.debitNpr, 0));
    const creditNpr = round2(accountLines.reduce((s, l) => s + l.creditNpr, 0));
    return {
      journalEntryId: entry._id.toString(),
      dateBs: entry.dateBs,
      voucherNumber: entry.voucherNumber,
      narration: entry.narration,
      debitNpr,
      creditNpr,
      cleared: cleared.has(entry._id.toString()),
      isVoided: Boolean(entry.isReversed),
      isReversal: Boolean(entry.isReversal)
    };
  });

  let openingNpr = 0;
  if (bankId) {
    const bank = await BankAccount.findOne({ _id: bankId, schoolId: params.schoolId }).select("openingBalanceNpr").lean();
    openingNpr = bank?.openingBalanceNpr ?? 0;
    for (const entry of allEntries) {
      if (!params.fromDateBs || entry.dateBs >= params.fromDateBs) continue;
      for (const line of entry.lines) {
        if (isThisAccount(line, entry)) openingNpr += line.debitNpr - line.creditNpr;
      }
    }
    openingNpr = round2(openingNpr);
  } else if (params.fromDateBs) {
    openingNpr = await getAccountOpeningBalance(params.schoolId, accountCode, params.fromDateBs);
  }

  // Bank entries saved without choosing a bank only show under "All banks combined"
  const untaggedBankEntries = bankId
    ? await JournalEntry.countDocuments({
        schoolId: params.schoolId,
        isDeleted: false,
        isPosted: true,
        dateBs: { $lte: params.statementDateBs },
        bankAccountId: null,
        lines: { $elemMatch: { accountCode: SYSTEM_ACCOUNT_CODES.BANK, bankAccountId: null } }
      })
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
    bankAccountId: bankId ?? null,
    untaggedBankEntries,
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
  beforeDateBs: string,
  bankAccountId?: Types.ObjectId | string
): Promise<string[]> => {
  const previous = await BankReconciliation.find({
    schoolId,
    accountCode,
    // Each bank's statements stand alone; null = combined (older reconciliations)
    bankAccountId: bankAccountId ? new Types.ObjectId(bankAccountId.toString()) : null,
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
