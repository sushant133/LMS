import { SYSTEM_ACCOUNT_CODES, type AccountType, type TrialBalanceRow } from "@phit-erp/shared";
import { BankAccount } from "../models/BankAccount.js";
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

/**
 * Infer an account type from its code when the chart of accounts has no entry for it.
 *
 * The old behaviour defaulted every unknown code to EXPENSE, which silently reclassified
 * whole accounts (and distorted every statement) as soon as an account was renamed or
 * deactivated. Codes are allocated by range — 1xxx asset, 2xxx liability, 3xxx equity,
 * 4xxx income, 5xxx expense — so the range is a far safer fallback than a fixed guess.
 */
const inferAccountTypeFromCode = (code: string): AccountType => {
  switch (code.trim().charAt(0)) {
    case "1":
      return "ASSET";
    case "2":
      return "LIABILITY";
    case "3":
      return "EQUITY";
    case "4":
      return "INCOME";
    default:
      return "EXPENSE";
  }
};

export interface AggregateBalanceFilters {
  fiscalYearBs?: string;
  fromDateBs?: string;
  toDateBs?: string;
  accountCode?: string;
  /**
   * Year-end closing vouchers zero out income/expense into equity. Statements that report
   * performance for a period (trial balance, income & expenditure) must ignore them or the
   * period's income nets to zero; the balance sheet must include them.
   */
  excludeClosingEntries?: boolean;
  /**
   * Bank accounts carry an opening balance outside the journal (Bank/Cash and
   * reconciliation start from it). Statements of position must include it, or Bank on
   * the balance sheet disagrees with the Bank/Cash book; it is matched by an Opening
   * Balance equity line so the books still balance.
   */
  includeBankOpening?: boolean;
}

/** Sum of every bank account's opening balance (recorded on the bank, not journalled). */
export const getBankOpeningTotal = async (schoolId: Types.ObjectId): Promise<number> => {
  const [row] = await BankAccount.aggregate<{ total: number }>([
    { $match: { schoolId } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$openingBalanceNpr", 0] } } } }
  ]);
  return round2(row?.total ?? 0);
};

export const aggregateJournalBalances = async (
  schoolId: Types.ObjectId,
  filters?: AggregateBalanceFilters
): Promise<AccountBalance[]> => {
  const match: Record<string, unknown> = { schoolId, isDeleted: false, isPosted: true };
  if (filters?.fiscalYearBs) match.fiscalYearBs = filters.fiscalYearBs;
  if (filters?.excludeClosingEntries) match.isClosingEntry = { $ne: true };
  if (filters?.fromDateBs || filters?.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }

  // Summed in MongoDB rather than by loading every matching voucher into memory and
  // reducing in JavaScript — the old approach grew linearly with transaction history and
  // eventually made year-end reporting the heaviest request the server handled.
  const grouped = await JournalEntry.aggregate<{
    _id: string;
    debitNpr: number;
    creditNpr: number;
    accountName: string;
  }>([
    { $match: match },
    { $unwind: "$lines" },
    ...(filters?.accountCode ? [{ $match: { "lines.accountCode": filters.accountCode } }] : []),
    {
      $group: {
        _id: "$lines.accountCode",
        debitNpr: { $sum: "$lines.debitNpr" },
        creditNpr: { $sum: "$lines.creditNpr" },
        accountName: { $first: "$lines.accountName" }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  // Deactivated accounts still own their posting history — excluding them here used to
  // drop them back to the EXPENSE fallback and corrupt every report that touched them.
  const accounts = await ChartOfAccount.find({ schoolId }).select("code name accountType").lean();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));

  const balances = grouped.map((row) => {
    const account = accountMap.get(row._id);
    return {
      accountCode: row._id,
      accountName: account?.name || row.accountName || row._id,
      accountType: (account?.accountType ?? inferAccountTypeFromCode(row._id)) as AccountType,
      debitNpr: row.debitNpr,
      creditNpr: row.creditNpr
    };
  });

  if (filters?.includeBankOpening && !filters.accountCode) {
    const openingNpr = await getBankOpeningTotal(schoolId);
    if (Math.abs(openingNpr) >= 0.01) {
      const addTo = (code: string, type: AccountType, fallbackName: string, debit: number, credit: number) => {
        let row = balances.find((b) => b.accountCode === code);
        if (!row) {
          row = {
            accountCode: code,
            accountName: accountMap.get(code)?.name || fallbackName,
            accountType: type,
            debitNpr: 0,
            creditNpr: 0
          };
          balances.push(row);
        }
        row.debitNpr = round2(row.debitNpr + debit);
        row.creditNpr = round2(row.creditNpr + credit);
      };
      const dr = openingNpr > 0 ? openingNpr : 0;
      const cr = openingNpr < 0 ? -openingNpr : 0;
      addTo(SYSTEM_ACCOUNT_CODES.BANK, "ASSET", "Bank", dr, cr);
      addTo(SYSTEM_ACCOUNT_CODES.OPENING_BALANCE, "EQUITY", "Opening Balance", cr, dr);
      balances.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    }
  }

  return balances;
};

/** Net each account to one side; accounts whose debits and credits cancel are left out. */
export const buildTrialBalance = (balances: AccountBalance[]): TrialBalanceRow[] =>
  balances
    .map((b) => ({
      accountCode: b.accountCode,
      accountName: b.accountName,
      accountType: b.accountType,
      debitNpr: b.debitNpr >= b.creditNpr ? round2(b.debitNpr - b.creditNpr) : 0,
      creditNpr: b.creditNpr > b.debitNpr ? round2(b.creditNpr - b.debitNpr) : 0
    }))
    .filter((row) => row.debitNpr >= 0.01 || row.creditNpr >= 0.01);

/** Trial balance rows plus the Dr/Cr control totals an accountant checks first. */
export const buildTrialBalanceReport = (balances: AccountBalance[]) => {
  const rows = buildTrialBalance(balances);
  const totalDebitNpr = round2(rows.reduce((sum, r) => sum + r.debitNpr, 0));
  const totalCreditNpr = round2(rows.reduce((sum, r) => sum + r.creditNpr, 0));
  const differenceNpr = round2(totalDebitNpr - totalCreditNpr);
  const isBalanced = Math.abs(differenceNpr) < 0.01;

  return {
    rows: [
      ...rows,
      {
        accountCode: "",
        accountName: "TOTAL",
        accountType: "" as unknown as AccountType,
        debitNpr: totalDebitNpr,
        creditNpr: totalCreditNpr,
        rowKind: "total"
      },
      ...(isBalanced
        ? []
        : [
            {
              accountCode: "",
              accountName: "DIFFERENCE (ledger out of balance)",
              accountType: "" as unknown as AccountType,
              debitNpr: differenceNpr < 0 ? -differenceNpr : 0,
              creditNpr: differenceNpr > 0 ? differenceNpr : 0,
              rowKind: "total"
            }
          ])
    ],
    totalDebitNpr,
    totalCreditNpr,
    differenceNpr,
    isBalanced
  };
};

const isNominal = (type: AccountType) => type === "INCOME" || type === "EXPENSE";

/**
 * Balances for a trial balance over a period.
 *
 * Asset, liability and equity accounts are balances *as at* the To date, so they carry
 * everything before the From date. Income and expense show only the period. The income
 * less expenditure of earlier periods is brought forward as one equity line, which keeps
 * the trial balance in agreement. Closing vouchers are left out so the period's income
 * and expense are not netted to zero.
 */
export const aggregateTrialBalanceBalances = async (
  schoolId: Types.ObjectId,
  filters: { fiscalYearBs?: string; fromDateBs?: string; toDateBs?: string }
): Promise<AccountBalance[]> => {
  if (filters.fiscalYearBs && !filters.fromDateBs && !filters.toDateBs) {
    return aggregateJournalBalances(schoolId, {
      fiscalYearBs: filters.fiscalYearBs,
      excludeClosingEntries: true
    });
  }

  const cumulative = await aggregateJournalBalances(schoolId, {
    toDateBs: filters.toDateBs,
    excludeClosingEntries: true,
    includeBankOpening: true
  });
  if (!filters.fromDateBs) {
    return cumulative;
  }

  const period = await aggregateJournalBalances(schoolId, {
    fromDateBs: filters.fromDateBs,
    toDateBs: filters.toDateBs,
    excludeClosingEntries: true
  });

  const net = (rows: AccountBalance[]) =>
    rows.filter((b) => isNominal(b.accountType)).reduce((sum, b) => sum + b.creditNpr - b.debitNpr, 0);
  const broughtForwardNpr = round2(net(cumulative) - net(period));

  const rows = [
    ...cumulative.filter((b) => !isNominal(b.accountType)),
    ...period.filter((b) => isNominal(b.accountType))
  ];
  if (Math.abs(broughtForwardNpr) >= 0.01) {
    rows.push({
      accountCode: SYSTEM_ACCOUNT_CODES.ACCUMULATED_FUND,
      accountName: "Surplus / (Deficit) brought forward",
      accountType: "EQUITY",
      debitNpr: broughtForwardNpr < 0 ? -broughtForwardNpr : 0,
      creditNpr: broughtForwardNpr > 0 ? broughtForwardNpr : 0
    });
  }
  return rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Balance sheet as at a date.
 *
 * Two defects made the old version incapable of balancing:
 *
 * 1. `Math.max(0, …)` on every total silently dropped accounts with a negative balance
 *    (bank overdraft, contra-assets), so the printed rows never summed to the printed
 *    totals. Totals now sum the same signed figures the rows show.
 * 2. Income and expense were excluded with nothing standing in for them, so the sheet was
 *    always out by the accumulated surplus. Because every voucher balances, the identity
 *    is Assets = Liabilities + Equity + (Income − Expense); the surplus is now carried as
 *    an explicit equity component.
 *
 * Once a year is closed its surplus has already been journalled into Accumulated Fund, so
 * it arrives through `equity` instead and `netSurplusNpr` only carries whatever remains
 * unclosed. Both paths produce the same total — the sheet balances either way.
 */
const nonZero = <T extends { balanceNpr: number }>(rows: T[]): T[] =>
  rows.filter((row) => Math.abs(row.balanceNpr) >= 0.01);

export const buildBalanceSheet = (balances: AccountBalance[]) => {
  const assets = balances.filter((b) => b.accountType === "ASSET");
  const liabilities = balances.filter((b) => b.accountType === "LIABILITY");
  const equity = balances.filter((b) => b.accountType === "EQUITY");
  const income = balances.filter((b) => b.accountType === "INCOME");
  const expenses = balances.filter((b) => b.accountType === "EXPENSE");

  const debitBalance = (b: AccountBalance) => b.debitNpr - b.creditNpr;
  const creditBalance = (b: AccountBalance) => b.creditNpr - b.debitNpr;

  const sum = (rows: AccountBalance[], pick: (b: AccountBalance) => number) =>
    round2(rows.reduce((total, row) => total + pick(row), 0));

  const totalAssetsNpr = sum(assets, debitBalance);
  const totalLiabilitiesNpr = sum(liabilities, creditBalance);
  const totalEquityBeforeSurplusNpr = sum(equity, creditBalance);
  const netSurplusNpr = round2(sum(income, creditBalance) - sum(expenses, debitBalance));
  const totalEquityNpr = round2(totalEquityBeforeSurplusNpr + netSurplusNpr);

  return {
    assets: nonZero(assets.map((b) => ({ ...b, balanceNpr: round2(debitBalance(b)) }))),
    liabilities: nonZero(liabilities.map((b) => ({ ...b, balanceNpr: round2(creditBalance(b)) }))),
    equity: nonZero(equity.map((b) => ({ ...b, balanceNpr: round2(creditBalance(b)) }))),
    totalAssetsNpr,
    totalLiabilitiesNpr,
    /** Equity excluding the current unclosed surplus — the sum of the `equity` rows. */
    totalEquityBeforeSurplusNpr,
    /** Surplus/deficit not yet journalled to Accumulated Fund; shown as an equity line. */
    netSurplusNpr,
    totalEquityNpr,
    totalLiabilitiesAndEquityNpr: round2(totalLiabilitiesNpr + totalEquityNpr),
    /** Non-zero only if the ledger itself is unbalanced — surfaced instead of hidden. */
    differenceNpr: round2(totalAssetsNpr - (totalLiabilitiesNpr + totalEquityNpr)),
    isBalanced: Math.abs(totalAssetsNpr - (totalLiabilitiesNpr + totalEquityNpr)) < 0.01
  };
};

/**
 * Expense posted by Direct Expense (purchase) vouchers, per account, for the same scope as
 * aggregateJournalBalances. Purchases may share an account with indirect expenses (Books →
 * 5202 Library), so the split is by where the voucher came from, not by account.
 */
export const aggregateDirectExpenseByAccount = async (
  schoolId: Types.ObjectId,
  filters?: AggregateBalanceFilters
): Promise<Map<string, number>> => {
  const match: Record<string, unknown> = {
    schoolId,
    isDeleted: false,
    isPosted: true,
    referenceType: "AccountingPurchase"
  };
  if (filters?.fiscalYearBs) match.fiscalYearBs = filters.fiscalYearBs;
  if (filters?.excludeClosingEntries) match.isClosingEntry = { $ne: true };
  if (filters?.fromDateBs || filters?.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }
  const rows = await JournalEntry.aggregate<{ _id: string; net: number }>([
    { $match: match },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.accountCode", net: { $sum: { $subtract: ["$lines.debitNpr", "$lines.creditNpr"] } } } }
  ]);
  return new Map(rows.map((r) => [r._id, round2(r.net)]));
};

export const buildIncomeExpenditure = (balances: AccountBalance[], directByAccount?: Map<string, number>) => {
  const income = balances.filter((b) => b.accountType === "INCOME");
  const expenses = balances.filter((b) => b.accountType === "EXPENSE");

  const totalIncomeNpr = round2(income.reduce((sum, b) => sum + (b.creditNpr - b.debitNpr), 0));
  const totalExpenseNpr = round2(expenses.reduce((sum, b) => sum + (b.debitNpr - b.creditNpr), 0));

  // Direct = posted by Direct Expense (purchases); Indirect = everything else
  const directExpenses = expenses
    .map((b) => ({ accountCode: b.accountCode, accountName: b.accountName, amountNpr: round2(directByAccount?.get(b.accountCode) ?? 0) }))
    .filter((row) => Math.abs(row.amountNpr) >= 0.01);
  const indirectExpenses = expenses
    .map((b) => ({
      accountCode: b.accountCode,
      accountName: b.accountName,
      amountNpr: round2(b.debitNpr - b.creditNpr - (directByAccount?.get(b.accountCode) ?? 0))
    }))
    .filter((row) => Math.abs(row.amountNpr) >= 0.01);
  const directExpenseNpr = round2(directExpenses.reduce((s, r) => s + r.amountNpr, 0));

  return {
    directExpenses,
    indirectExpenses,
    directExpenseNpr,
    indirectExpenseNpr: round2(totalExpenseNpr - directExpenseNpr),
    income: income
      .map((b) => ({
        accountCode: b.accountCode,
        accountName: b.accountName,
        amountNpr: round2(b.creditNpr - b.debitNpr)
      }))
      .filter((row) => Math.abs(row.amountNpr) >= 0.01),
    expenses: expenses
      .map((b) => ({
        accountCode: b.accountCode,
        accountName: b.accountName,
        amountNpr: round2(b.debitNpr - b.creditNpr)
      }))
      .filter((row) => Math.abs(row.amountNpr) >= 0.01),
    totalIncomeNpr,
    totalExpenseNpr,
    netSurplusNpr: round2(totalIncomeNpr - totalExpenseNpr)
  };
};

/**
 * Flatten the balance sheet into the row shape `REPORT_COLUMNS["balance-sheet"]` renders,
 * with section headings and totals inline so the printed statement reads like a statement
 * rather than a list of accounts.
 */
export const flattenBalanceSheet = (sheet: ReturnType<typeof buildBalanceSheet>) => {
  type Row = { accountCode: string; accountName: string; balanceNpr: number | null; rowKind?: string };
  const rows: Row[] = [];
  const heading = (label: string) =>
    rows.push({ accountCode: "", accountName: label, balanceNpr: null, rowKind: "heading" });
  const total = (label: string, value: number) =>
    rows.push({ accountCode: "", accountName: label, balanceNpr: value, rowKind: "total" });

  heading("ASSETS");
  sheet.assets.forEach((a) => rows.push({ accountCode: a.accountCode, accountName: a.accountName, balanceNpr: a.balanceNpr }));
  total("Total Assets", sheet.totalAssetsNpr);

  heading("LIABILITIES");
  sheet.liabilities.forEach((l) => rows.push({ accountCode: l.accountCode, accountName: l.accountName, balanceNpr: l.balanceNpr }));
  total("Total Liabilities", sheet.totalLiabilitiesNpr);

  heading("EQUITY");
  sheet.equity.forEach((e) => rows.push({ accountCode: e.accountCode, accountName: e.accountName, balanceNpr: e.balanceNpr }));
  if (Math.abs(sheet.netSurplusNpr) >= 0.01) {
    rows.push({ accountCode: "", accountName: "Surplus / (Deficit) not yet closed", balanceNpr: sheet.netSurplusNpr });
  }
  total("Total Equity", sheet.totalEquityNpr);
  total("Total Liabilities & Equity", sheet.totalLiabilitiesAndEquityNpr);

  if (!sheet.isBalanced) {
    total("DIFFERENCE (ledger out of balance)", sheet.differenceNpr);
  }

  return rows;
};

/** Flatten income & expenditure into `REPORT_COLUMNS["income-expenditure"]` row shape. */
export const flattenIncomeExpenditure = (statement: ReturnType<typeof buildIncomeExpenditure>) => {
  type Row = { accountCode: string; accountName: string; amountNpr: number | null; rowKind?: string };
  const rows: Row[] = [];
  const heading = (label: string) =>
    rows.push({ accountCode: "", accountName: label, amountNpr: null, rowKind: "heading" });
  const total = (label: string, value: number) =>
    rows.push({ accountCode: "", accountName: label, amountNpr: value, rowKind: "total" });

  heading("INCOME");
  statement.income.forEach((i) => rows.push({ accountCode: i.accountCode, accountName: i.accountName, amountNpr: i.amountNpr }));
  total("Total Income", statement.totalIncomeNpr);

  heading("EXPENDITURE");
  heading("Direct expenses");
  statement.directExpenses.forEach((e) => rows.push({ accountCode: e.accountCode, accountName: e.accountName, amountNpr: e.amountNpr }));
  total("Total direct expenses", statement.directExpenseNpr);
  heading("Indirect expenses");
  statement.indirectExpenses.forEach((e) => rows.push({ accountCode: e.accountCode, accountName: e.accountName, amountNpr: e.amountNpr }));
  total("Total indirect expenses", statement.indirectExpenseNpr);
  total("Total Expenditure", statement.totalExpenseNpr);

  total(
    statement.netSurplusNpr >= 0 ? "SURPLUS for the period" : "DEFICIT for the period",
    statement.netSurplusNpr
  );

  return rows;
};

/**
 * Net movement on one account strictly before `beforeDateBs` — the account's opening
 * balance for a date-ranged ledger.
 */
export const getAccountOpeningBalance = async (
  schoolId: Types.ObjectId,
  accountCode: string,
  beforeDateBs: string
): Promise<number> => {
  const [result] = await JournalEntry.aggregate<{ opening: number }>([
    {
      $match: {
        schoolId,
        isDeleted: false,
        isPosted: true,
        "lines.accountCode": accountCode,
        dateBs: { $lt: beforeDateBs }
      }
    },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": accountCode } },
    {
      $group: {
        _id: null,
        opening: { $sum: { $subtract: ["$lines.debitNpr", "$lines.creditNpr"] } }
      }
    }
  ]);

  return round2(result?.opening ?? 0);
};

/**
 * Account ledger with a true opening balance.
 *
 * The running balance previously started at zero even when `fromDateBs` was set, so every
 * date-ranged ledger silently reported a closing balance that ignored all prior history.
 * The opening balance is now carried in as the first row, exactly as a printed ledger does.
 */
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

  const openingNpr = filters?.fromDateBs
    ? await getAccountOpeningBalance(schoolId, accountCode, filters.fromDateBs)
    : 0;

  const entries = await JournalEntry.find(match).sort({ dateBs: 1, createdAt: 1 }).lean();
  let balanceNpr = openingNpr;

  const movementRows = entries.flatMap((entry) =>
    entry.lines
      .filter((line) => line.accountCode === accountCode)
      .map((line) => {
        balanceNpr = round2(balanceNpr + line.debitNpr - line.creditNpr);
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

  // Only show the opening row when a start date actually scopes the ledger; an unscoped
  // ledger already starts from the first transaction and a zero row would be noise.
  if (!filters?.fromDateBs) {
    return movementRows;
  }

  return [
    {
      dateBs: filters.fromDateBs,
      voucherNumber: "",
      narration: "Opening Balance",
      debitNpr: openingNpr > 0 ? openingNpr : 0,
      creditNpr: openingNpr < 0 ? Math.abs(openingNpr) : 0,
      balanceNpr: openingNpr
    },
    ...movementRows
  ];
};

/**
 * General ledger: every account (or one) with its opening balance, each posting and a
 * running balance, closed by a total line. Balances are kept per account; a single
 * running balance across different accounts means nothing.
 */
export const buildGeneralLedger = async (
  schoolId: Types.ObjectId,
  filters: { fromDateBs?: string; toDateBs?: string; accountCode?: string }
) => {
  const accountCode = filters.accountCode?.trim() || undefined;
  const match: Record<string, unknown> = { schoolId, isDeleted: false, isPosted: true };
  if (accountCode) match["lines.accountCode"] = accountCode;
  if (filters.fromDateBs || filters.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }

  const [movements, openings, accounts, bankOpeningNpr] = await Promise.all([
    JournalEntry.aggregate<{
      accountCode: string;
      accountName: string;
      dateBs: string;
      voucherNumber: string;
      narration: string;
      description?: string;
      debitNpr: number;
      creditNpr: number;
    }>([
      { $match: match },
      { $unwind: "$lines" },
      ...(accountCode ? [{ $match: { "lines.accountCode": accountCode } }] : []),
      { $sort: { "lines.accountCode": 1, dateBs: 1, createdAt: 1, _id: 1 } },
      {
        $project: {
          _id: 0,
          accountCode: "$lines.accountCode",
          accountName: "$lines.accountName",
          dateBs: 1,
          voucherNumber: 1,
          narration: 1,
          description: "$lines.description",
          debitNpr: "$lines.debitNpr",
          creditNpr: "$lines.creditNpr"
        }
      }
    ]).allowDiskUse(true),
    filters.fromDateBs
      ? JournalEntry.aggregate<{ _id: string; net: number }>([
          {
            $match: {
              schoolId,
              isDeleted: false,
              isPosted: true,
              dateBs: { $lt: filters.fromDateBs },
              ...(accountCode ? { "lines.accountCode": accountCode } : {})
            }
          },
          { $unwind: "$lines" },
          ...(accountCode ? [{ $match: { "lines.accountCode": accountCode } }] : []),
          {
            $group: {
              _id: "$lines.accountCode",
              net: { $sum: { $subtract: ["$lines.debitNpr", "$lines.creditNpr"] } }
            }
          }
        ])
      : Promise.resolve([] as Array<{ _id: string; net: number }>),
    ChartOfAccount.find({ schoolId }).select("code name").lean(),
    getBankOpeningTotal(schoolId)
  ]);

  const nameMap = new Map(accounts.map((a) => [a.code, a.name]));
  const openingByCode = new Map(openings.map((o) => [o._id, round2(o.net)]));
  if (Math.abs(bankOpeningNpr) >= 0.01 && (!accountCode || accountCode === SYSTEM_ACCOUNT_CODES.BANK)) {
    const code = SYSTEM_ACCOUNT_CODES.BANK;
    openingByCode.set(code, round2((openingByCode.get(code) ?? 0) + bankOpeningNpr));
  }

  const movementsByCode = new Map<string, typeof movements>();
  for (const m of movements) {
    const list = movementsByCode.get(m.accountCode) ?? [];
    list.push(m);
    movementsByCode.set(m.accountCode, list);
  }
  const codes = Array.from(
    new Set([
      ...movementsByCode.keys(),
      ...Array.from(openingByCode.entries())
        .filter(([, net]) => Math.abs(net) >= 0.01)
        .map(([code]) => code)
    ])
  ).sort((a, b) => a.localeCompare(b));

  const side = (balance: number) => (Math.abs(balance) < 0.01 ? "" : balance > 0 ? "Dr" : "Cr");
  const rows: Array<Record<string, unknown>> = [];
  for (const code of codes) {
    const list = movementsByCode.get(code) ?? [];
    const name = nameMap.get(code) || list[0]?.accountName || code;
    rows.push({ rowKind: "heading", accountCode: code, accountName: name });

    let balance = openingByCode.get(code) ?? 0;
    if (filters.fromDateBs || Math.abs(balance) >= 0.01) {
      rows.push({
        dateBs: filters.fromDateBs ?? "",
        accountCode: code,
        accountName: name,
        narration: "Opening Balance",
        debitNpr: balance > 0 ? balance : 0,
        creditNpr: balance < 0 ? -balance : 0,
        runningBalanceNpr: round2(Math.abs(balance)),
        balanceSide: side(balance)
      });
    }

    let debitTotal = 0;
    let creditTotal = 0;
    for (const m of list) {
      const debit = m.debitNpr ?? 0;
      const credit = m.creditNpr ?? 0;
      debitTotal += debit;
      creditTotal += credit;
      balance = round2(balance + debit - credit);
      rows.push({
        dateBs: m.dateBs,
        voucherNumber: m.voucherNumber,
        accountCode: code,
        accountName: name,
        narration: m.description?.trim() || m.narration,
        debitNpr: debit,
        creditNpr: credit,
        runningBalanceNpr: round2(Math.abs(balance)),
        balanceSide: side(balance)
      });
    }

    rows.push({
      rowKind: "total",
      accountName: `Total — ${name}`,
      narration: "Closing Balance",
      debitNpr: round2(debitTotal),
      creditNpr: round2(creditTotal),
      runningBalanceNpr: round2(Math.abs(balance)),
      balanceSide: side(balance)
    });
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Cash flow statement
// ---------------------------------------------------------------------------

/** Accounts treated as cash and cash equivalents. */
const CASH_ACCOUNT_CODES = new Set([SYSTEM_ACCOUNT_CODES.CASH, SYSTEM_ACCOUNT_CODES.BANK]);

type CashFlowSection = "OPERATING" | "INVESTING" | "FINANCING";

/**
 * Which section a cash movement belongs to, judged by the account on the other side of
 * the voucher: income and expense are trading activity, equity is funding, and any other
 * asset is something the institution bought or sold.
 */
const classifyCashFlowSection = (accountType: AccountType, accountCode: string): CashFlowSection => {
  switch (accountType) {
    case "INCOME":
    case "EXPENSE":
    case "LIABILITY":
      return "OPERATING";
    case "EQUITY":
      return "FINANCING";
    default:
      // Fixed assets (14xx) are investing; receivables and other current assets are
      // working capital and belong to operating activity.
      return accountCode.trim().startsWith("14") ? "INVESTING" : "OPERATING";
  }
};

/**
 * Cash flow statement, direct method.
 *
 * The previous implementation just totalled every debit and credit that touched cash,
 * which reported gross churn rather than cash flow and could not be presented as a
 * statement. Each voucher touching cash or bank is now attributed to operating, investing
 * or financing activity via its contra accounts, and the statement reconciles opening cash
 * to closing cash so it can be checked against the ledger.
 *
 * Transfers between cash and bank net to zero within a voucher and are excluded — they
 * move cash around without being a cash flow.
 */
export const buildCashFlowStatement = async (
  schoolId: Types.ObjectId,
  filters?: { fromDateBs?: string; toDateBs?: string }
) => {
  const match: Record<string, unknown> = { schoolId, isDeleted: false, isPosted: true };
  if (filters?.fromDateBs || filters?.toDateBs) {
    match.dateBs = {};
    if (filters.fromDateBs) (match.dateBs as Record<string, string>).$gte = filters.fromDateBs;
    if (filters.toDateBs) (match.dateBs as Record<string, string>).$lte = filters.toDateBs;
  }

  const [entries, accounts] = await Promise.all([
    JournalEntry.find(match).select("lines dateBs").lean(),
    ChartOfAccount.find({ schoolId }).lean()
  ]);
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const typeOf = (code: string): AccountType =>
    (accountMap.get(code)?.accountType ?? inferAccountTypeFromCode(code)) as AccountType;
  const nameOf = (code: string, fallback: string): string => accountMap.get(code)?.name || fallback || code;

  const sections: Record<CashFlowSection, Map<string, number>> = {
    OPERATING: new Map(),
    INVESTING: new Map(),
    FINANCING: new Map()
  };

  for (const entry of entries) {
    const cashLines = entry.lines.filter((l) => CASH_ACCOUNT_CODES.has(l.accountCode as never));
    if (cashLines.length === 0) continue;

    const cashDelta = round2(cashLines.reduce((sum, l) => sum + l.debitNpr - l.creditNpr, 0));
    // Pure cash<->bank transfer: cash overall is unchanged, so it is not a cash flow.
    if (Math.abs(cashDelta) < 0.01) continue;

    for (const line of entry.lines) {
      if (CASH_ACCOUNT_CODES.has(line.accountCode as never)) continue;

      // Because the voucher balances, the non-cash side sums to the cash movement.
      const contribution = round2(line.creditNpr - line.debitNpr);
      if (Math.abs(contribution) < 0.01) continue;

      const section = classifyCashFlowSection(typeOf(line.accountCode), line.accountCode);
      const label = nameOf(line.accountCode, line.accountName);
      sections[section].set(label, round2((sections[section].get(label) ?? 0) + contribution));
    }
  }

  const toRows = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([label, amountNpr]) => ({ label, amountNpr }))
      .filter((row) => Math.abs(row.amountNpr) >= 0.01)
      .sort((a, b) => b.amountNpr - a.amountNpr);

  const operating = toRows(sections.OPERATING);
  const investing = toRows(sections.INVESTING);
  const financing = toRows(sections.FINANCING);

  const total = (rows: Array<{ amountNpr: number }>) => round2(rows.reduce((s, r) => s + r.amountNpr, 0));
  const netOperatingNpr = total(operating);
  const netInvestingNpr = total(investing);
  const netFinancingNpr = total(financing);
  const netChangeNpr = round2(netOperatingNpr + netInvestingNpr + netFinancingNpr);

  // Bank opening balances live on the bank accounts, so they are part of opening cash.
  const bankOpeningNpr = await getBankOpeningTotal(schoolId);
  const openingCashNpr = filters?.fromDateBs
    ? round2(
        bankOpeningNpr +
          (await getAccountOpeningBalance(schoolId, SYSTEM_ACCOUNT_CODES.CASH, filters.fromDateBs)) +
          (await getAccountOpeningBalance(schoolId, SYSTEM_ACCOUNT_CODES.BANK, filters.fromDateBs))
      )
    : bankOpeningNpr;

  return {
    operating,
    investing,
    financing,
    netOperatingNpr,
    netInvestingNpr,
    netFinancingNpr,
    netChangeNpr,
    openingCashNpr,
    closingCashNpr: round2(openingCashNpr + netChangeNpr)
  };
};

/** Flatten the cash flow statement into `REPORT_COLUMNS["cash-flow"]` row shape. */
export const flattenCashFlow = (statement: Awaited<ReturnType<typeof buildCashFlowStatement>>) => {
  type Row = { particulars: string; amountNpr: number | null; rowKind?: string };
  const rows: Row[] = [];
  const heading = (label: string) => rows.push({ particulars: label, amountNpr: null, rowKind: "heading" });
  const total = (label: string, value: number) =>
    rows.push({ particulars: label, amountNpr: value, rowKind: "total" });

  heading("CASH FLOW FROM OPERATING ACTIVITIES");
  statement.operating.forEach((r) => rows.push({ particulars: r.label, amountNpr: r.amountNpr }));
  total("Net cash from operating activities", statement.netOperatingNpr);

  heading("CASH FLOW FROM INVESTING ACTIVITIES");
  statement.investing.forEach((r) => rows.push({ particulars: r.label, amountNpr: r.amountNpr }));
  total("Net cash from investing activities", statement.netInvestingNpr);

  heading("CASH FLOW FROM FINANCING ACTIVITIES");
  statement.financing.forEach((r) => rows.push({ particulars: r.label, amountNpr: r.amountNpr }));
  total("Net cash from financing activities", statement.netFinancingNpr);

  total("Net increase / (decrease) in cash and bank", statement.netChangeNpr);
  rows.push({ particulars: "Cash and bank at start of period", amountNpr: statement.openingCashNpr });
  total("Cash and bank at end of period", statement.closingCashNpr);

  return rows;
};