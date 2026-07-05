import type { AccountType, TrialBalanceRow } from "@phit-erp/shared";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { JournalEntry } from "../models/JournalEntry.js";
import type { Types } from "mongoose";

interface AccountBalance {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitNpr: number;
  creditNpr: number;
}

export const aggregateJournalBalances = async (
  schoolId: Types.ObjectId,
  filters?: { fiscalYearBs?: string; fromDateBs?: string; toDateBs?: string; accountCode?: string }
): Promise<AccountBalance[]> => {
  const match: Record<string, unknown> = { schoolId, isDeleted: false, isPosted: true };
  if (filters?.fiscalYearBs) match.fiscalYearBs = filters.fiscalYearBs;
  if (filters?.fromDateBs || filters?.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }

  const entries = await JournalEntry.find(match).lean();
  const accounts = await ChartOfAccount.find({ schoolId, isActive: true }).lean();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));

  const balances = new Map<string, AccountBalance>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (filters?.accountCode && line.accountCode !== filters.accountCode) continue;

      const existing = balances.get(line.accountCode) ?? {
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: (accountMap.get(line.accountCode)?.accountType ?? "EXPENSE") as AccountType,
        debitNpr: 0,
        creditNpr: 0
      };
      existing.debitNpr += line.debitNpr;
      existing.creditNpr += line.creditNpr;
      balances.set(line.accountCode, existing);
    }
  }

  return Array.from(balances.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

export const buildTrialBalance = (balances: AccountBalance[]): TrialBalanceRow[] =>
  balances.map((b) => ({
    accountCode: b.accountCode,
    accountName: b.accountName,
    accountType: b.accountType,
    debitNpr: b.debitNpr >= b.creditNpr ? b.debitNpr - b.creditNpr : 0,
    creditNpr: b.creditNpr > b.debitNpr ? b.creditNpr - b.debitNpr : 0
  }));

export const buildBalanceSheet = (balances: AccountBalance[]) => {
  const assets = balances.filter((b) => b.accountType === "ASSET");
  const liabilities = balances.filter((b) => b.accountType === "LIABILITY");
  const equity = balances.filter((b) => b.accountType === "EQUITY");

  const netBalance = (b: AccountBalance) => b.debitNpr - b.creditNpr;

  return {
    assets: assets.map((b) => ({ ...b, balanceNpr: netBalance(b) })),
    liabilities: liabilities.map((b) => ({ ...b, balanceNpr: b.creditNpr - b.debitNpr })),
    equity: equity.map((b) => ({ ...b, balanceNpr: b.creditNpr - b.debitNpr })),
    totalAssetsNpr: assets.reduce((sum, b) => sum + Math.max(0, netBalance(b)), 0),
    totalLiabilitiesNpr: liabilities.reduce((sum, b) => sum + Math.max(0, b.creditNpr - b.debitNpr), 0),
    totalEquityNpr: equity.reduce((sum, b) => sum + Math.max(0, b.creditNpr - b.debitNpr), 0)
  };
};

export const buildIncomeExpenditure = (balances: AccountBalance[]) => {
  const income = balances.filter((b) => b.accountType === "INCOME");
  const expenses = balances.filter((b) => b.accountType === "EXPENSE");

  const totalIncomeNpr = income.reduce((sum, b) => sum + (b.creditNpr - b.debitNpr), 0);
  const totalExpenseNpr = expenses.reduce((sum, b) => sum + (b.debitNpr - b.creditNpr), 0);

  return {
    income: income.map((b) => ({ accountCode: b.accountCode, accountName: b.accountName, amountNpr: b.creditNpr - b.debitNpr })),
    expenses: expenses.map((b) => ({ accountCode: b.accountCode, accountName: b.accountName, amountNpr: b.debitNpr - b.creditNpr })),
    totalIncomeNpr,
    totalExpenseNpr,
    netSurplusNpr: totalIncomeNpr - totalExpenseNpr
  };
};

export const buildAccountLedger = async (
  schoolId: Types.ObjectId,
  accountCode: string,
  filters?: { fromDateBs?: string; toDateBs?: string }
) => {
  const match: Record<string, unknown> = { schoolId, isDeleted: false, isPosted: true, "lines.accountCode": accountCode };
  if (filters?.fromDateBs || filters?.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }

  const entries = await JournalEntry.find(match).sort({ dateBs: 1, createdAt: 1 }).lean();
  let balanceNpr = 0;

  return entries.flatMap((entry) =>
    entry.lines
      .filter((line) => line.accountCode === accountCode)
      .map((line) => {
        balanceNpr += line.debitNpr - line.creditNpr;
        return {
          dateBs: entry.dateBs,
          voucherNumber: entry.voucherNumber,
          narration: entry.narration,
          debitNpr: line.debitNpr,
          creditNpr: line.creditNpr,
          balanceNpr
        };
      })
  );
};