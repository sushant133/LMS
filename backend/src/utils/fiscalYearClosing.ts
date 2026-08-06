import type { Types } from "mongoose";
import { SYSTEM_ACCOUNT_CODES } from "@phit-erp/shared";
import { JournalEntry } from "../models/JournalEntry.js";
import { aggregateJournalBalances } from "./accountingReports.js";
import { postJournalEntry } from "./journalPosting.js";

/**
 * Year-end closing.
 *
 * Closing a fiscal year used to flip a flag and nothing else, so income and expense
 * balances accumulated forever and equity never grew — which is why the balance sheet
 * could never balance across years. Closing now posts a real voucher that zeroes every
 * income and expense account into Accumulated Fund (3003), the standard "closing the
 * books" entry.
 *
 * Deliberately *not* posting a separate opening-balance voucher for the next year: this
 * ledger reports balance-sheet figures cumulatively, so asset and liability balances
 * already carry forward on their own. Posting opening entries as well would double-count
 * them. The next year's opening position is whatever the cumulative ledger says, and
 * `getAccountOpeningBalance` reports it per account.
 */

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export interface ClosingResult {
  posted: boolean;
  reason?: string;
  journalEntryId?: Types.ObjectId;
  netSurplusNpr: number;
}

/** An already-posted closing voucher for this year, if any. Keeps closing idempotent. */
export const findExistingClosingEntry = async (schoolId: Types.ObjectId, fiscalYearBs: string) =>
  JournalEntry.findOne({
    schoolId,
    fiscalYearBs,
    isClosingEntry: true,
    isDeleted: false
  }).lean();

/**
 * Post the closing voucher for a fiscal year. Safe to call twice — the second call
 * detects the existing voucher and does nothing.
 */
export const postYearEndClosingEntry = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  fiscalYearBs: string;
  /** Posting date — the last day of the fiscal year being closed. */
  dateBs: string;
}): Promise<ClosingResult> => {
  const existing = await findExistingClosingEntry(params.schoolId, params.fiscalYearBs);
  if (existing) {
    return {
      posted: false,
      reason: "Closing entry already exists for this fiscal year",
      journalEntryId: existing._id,
      netSurplusNpr: 0
    };
  }

  // Exclude prior closing vouchers so a re-close can never compound on itself.
  const balances = await aggregateJournalBalances(params.schoolId, {
    fiscalYearBs: params.fiscalYearBs,
    excludeClosingEntries: true
  });

  const lines: Array<{
    accountCode: string;
    accountName: string;
    debitNpr: number;
    creditNpr: number;
    description?: string;
  }> = [];

  let totalIncomeNpr = 0;
  let totalExpenseNpr = 0;

  for (const balance of balances) {
    if (balance.accountType === "INCOME") {
      // Income carries a credit balance; debit it by the same amount to bring it to zero.
      const amount = round2(balance.creditNpr - balance.debitNpr);
      if (Math.abs(amount) < 0.01) continue;
      totalIncomeNpr = round2(totalIncomeNpr + amount);
      lines.push({
        accountCode: balance.accountCode,
        accountName: balance.accountName,
        debitNpr: amount > 0 ? amount : 0,
        creditNpr: amount < 0 ? Math.abs(amount) : 0,
        description: "Year-end closing"
      });
      continue;
    }

    if (balance.accountType === "EXPENSE") {
      // Expense carries a debit balance; credit it by the same amount.
      const amount = round2(balance.debitNpr - balance.creditNpr);
      if (Math.abs(amount) < 0.01) continue;
      totalExpenseNpr = round2(totalExpenseNpr + amount);
      lines.push({
        accountCode: balance.accountCode,
        accountName: balance.accountName,
        debitNpr: amount < 0 ? Math.abs(amount) : 0,
        creditNpr: amount > 0 ? amount : 0,
        description: "Year-end closing"
      });
    }
  }

  if (lines.length === 0) {
    return { posted: false, reason: "No income or expense activity to close", netSurplusNpr: 0 };
  }

  // Balance against the actual rounded line totals rather than the theoretical surplus,
  // so per-line rounding can never leave the voucher a paisa out.
  const lineDebit = round2(lines.reduce((sum, line) => sum + line.debitNpr, 0));
  const lineCredit = round2(lines.reduce((sum, line) => sum + line.creditNpr, 0));
  const balancingNpr = round2(lineDebit - lineCredit);
  const netSurplusNpr = round2(totalIncomeNpr - totalExpenseNpr);

  if (Math.abs(balancingNpr) >= 0.01) {
    lines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.ACCUMULATED_FUND,
      accountName: "Accumulated Fund",
      debitNpr: balancingNpr < 0 ? Math.abs(balancingNpr) : 0,
      creditNpr: balancingNpr > 0 ? balancingNpr : 0,
      description:
        netSurplusNpr >= 0
          ? `Surplus transferred for FY ${params.fiscalYearBs}`
          : `Deficit transferred for FY ${params.fiscalYearBs}`
    });
  }

  const entry = await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.dateBs,
    narration: `Year-end closing — FY ${params.fiscalYearBs}`,
    lines,
    voucherType: "JOURNAL",
    referenceType: "Manual",
    isClosingEntry: true
  });

  return { posted: true, journalEntryId: entry._id, netSurplusNpr };
};
