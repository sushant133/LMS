import type { Types } from "mongoose";
import type { AccountType } from "@phit-erp/shared";
import { Budget } from "../models/Budget.js";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { aggregateJournalBalances } from "./accountingReports.js";

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export interface BudgetVarianceRow {
  [key: string]: unknown;
  accountCode: string;
  accountName: string;
  accountType: string;
  budgetedNpr: number;
  actualNpr: number;
  varianceNpr: number;
  variancePercent: number | null;
  status: string;
}

/**
 * Budget vs actual for a fiscal year.
 *
 * Actuals come from posted journals with year-end closing vouchers excluded, so a closed
 * year still reports the income and expenditure it actually earned and incurred rather
 * than the zeroes closing leaves behind.
 *
 * Variance is expressed so positive is always favourable: under-spending an expense and
 * over-earning income both read as a positive variance.
 */
export const buildBudgetVariance = async (schoolId: Types.ObjectId, fiscalYearBs: string) => {
  const [budget, balances, accounts] = await Promise.all([
    Budget.findOne({ schoolId, fiscalYearBs, isDeleted: false }).lean(),
    aggregateJournalBalances(schoolId, { fiscalYearBs, excludeClosingEntries: true }),
    ChartOfAccount.find({ schoolId }).lean()
  ]);

  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const balanceMap = new Map(balances.map((b) => [b.accountCode, b]));

  const actualFor = (accountCode: string, accountType: AccountType): number => {
    const balance = balanceMap.get(accountCode);
    if (!balance) return 0;
    return accountType === "INCOME"
      ? round2(balance.creditNpr - balance.debitNpr)
      : round2(balance.debitNpr - balance.creditNpr);
  };

  // Every budgeted account, plus any account with actual income/expense that was never
  // budgeted — unbudgeted spending is exactly what this report exists to surface.
  const codes = new Set<string>((budget?.lines ?? []).map((l) => l.accountCode));
  for (const balance of balances) {
    if (balance.accountType === "INCOME" || balance.accountType === "EXPENSE") {
      codes.add(balance.accountCode);
    }
  }

  const rows: BudgetVarianceRow[] = Array.from(codes)
    .map((code) => {
      const account = accountMap.get(code);
      const accountType = (account?.accountType ?? balanceMap.get(code)?.accountType ?? "EXPENSE") as AccountType;
      const budgetLine = (budget?.lines ?? []).find((l) => l.accountCode === code);
      const budgetedNpr = round2(Number(budgetLine?.budgetedNpr ?? 0));
      const actualNpr = actualFor(code, accountType);

      // Favourable = earning more than planned, or spending less than planned.
      const varianceNpr =
        accountType === "INCOME" ? round2(actualNpr - budgetedNpr) : round2(budgetedNpr - actualNpr);

      return {
        accountCode: code,
        accountName: account?.name ?? budgetLine?.accountName ?? code,
        accountType,
        budgetedNpr,
        actualNpr,
        varianceNpr,
        variancePercent: budgetedNpr > 0 ? round2((varianceNpr / budgetedNpr) * 100) : null,
        status: budgetedNpr === 0 && actualNpr !== 0 ? "UNBUDGETED" : varianceNpr < 0 ? "OVER" : "WITHIN"
      };
    })
    .filter((row) => row.budgetedNpr !== 0 || row.actualNpr !== 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const income = rows.filter((r) => r.accountType === "INCOME");
  const expense = rows.filter((r) => r.accountType === "EXPENSE");
  const sum = (list: BudgetVarianceRow[], key: "budgetedNpr" | "actualNpr") =>
    round2(list.reduce((s, r) => s + (r[key] as number), 0));

  return {
    fiscalYearBs,
    hasBudget: Boolean(budget),
    budgetStatus: budget?.status ?? null,
    rows,
    totals: {
      incomeBudgetedNpr: sum(income, "budgetedNpr"),
      incomeActualNpr: sum(income, "actualNpr"),
      expenseBudgetedNpr: sum(expense, "budgetedNpr"),
      expenseActualNpr: sum(expense, "actualNpr"),
      budgetedSurplusNpr: round2(sum(income, "budgetedNpr") - sum(expense, "budgetedNpr")),
      actualSurplusNpr: round2(sum(income, "actualNpr") - sum(expense, "actualNpr")),
      unbudgetedCount: rows.filter((r) => r.status === "UNBUDGETED").length,
      overBudgetCount: rows.filter((r) => r.status === "OVER").length
    }
  };
};

/** Append section headings and totals for the printed variance report. */
export const flattenBudgetVariance = (
  result: Awaited<ReturnType<typeof buildBudgetVariance>>
): Array<Record<string, unknown>> => {
  const blank = (label: string): Record<string, unknown> => ({
    accountCode: "",
    accountName: label,
    accountType: "",
    budgetedNpr: null,
    actualNpr: null,
    varianceNpr: null,
    variancePercent: null,
    status: ""
  });

  const income = result.rows.filter((r) => r.accountType === "INCOME");
  const expense = result.rows.filter((r) => r.accountType === "EXPENSE");
  const other = result.rows.filter((r) => r.accountType !== "INCOME" && r.accountType !== "EXPENSE");

  const rows: Array<Record<string, unknown>> = [];

  if (income.length > 0) {
    rows.push(blank("INCOME"), ...income, {
      ...blank("Total Income"),
      budgetedNpr: result.totals.incomeBudgetedNpr,
      actualNpr: result.totals.incomeActualNpr,
      varianceNpr: round2(result.totals.incomeActualNpr - result.totals.incomeBudgetedNpr)
    });
  }

  if (expense.length > 0) {
    rows.push(blank("EXPENDITURE"), ...expense, {
      ...blank("Total Expenditure"),
      budgetedNpr: result.totals.expenseBudgetedNpr,
      actualNpr: result.totals.expenseActualNpr,
      varianceNpr: round2(result.totals.expenseBudgetedNpr - result.totals.expenseActualNpr)
    });
  }

  if (other.length > 0) rows.push(blank("OTHER"), ...other);

  rows.push({
    ...blank("SURPLUS / (DEFICIT)"),
    budgetedNpr: result.totals.budgetedSurplusNpr,
    actualNpr: result.totals.actualSurplusNpr,
    varianceNpr: round2(result.totals.actualSurplusNpr - result.totals.budgetedSurplusNpr)
  });

  return rows;
};
