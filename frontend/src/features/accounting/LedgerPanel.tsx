import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ChartOfAccountRecord,
  JournalEntryRecord,
} from "@phit-erp/shared";
import {
  BookMarked,
  FileDown,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";
import { printSimpleDocument } from "./voucherPrint";

type LedgerLine = {
  key: string;
  dateBs: string;
  voucherNumber: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  narration: string;
  debitNpr: number;
  creditNpr: number;
  referenceType?: string;
  runningBalanceNpr: number;
};

type LedgerSummary = {
  code: string;
  name: string;
  group: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: number;
};

const groupLabel = (accountType?: string): string => {
  switch (accountType) {
    case "ASSET":
      return "Assets";
    case "LIABILITY":
      return "Liabilities";
    case "EQUITY":
      return "Equity";
    case "INCOME":
      return "Income";
    case "EXPENSE":
      return "Expenses";
    default:
      return accountType || "—";
  }
};

/**
 * Practical college ledger — account-wise view of posted journal lines.
 * Auto-filled by fee collections, salaries, refunds, expenses, purchases, and manual गोश्वारा.
 */
export const LedgerPanel = () => {
  const [accountCode, setAccountCode] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () =>
      unwrap<ChartOfAccountRecord[]>(api.get("/accounting/chart-of-accounts")),
  });

  const journalsQuery = useQuery({
    queryKey: ["accounting-journal-entries"],
    queryFn: () =>
      unwrap<JournalEntryRecord[]>(api.get("/accounting/journal-entries")),
  });

  const accounts = accountsQuery.data ?? [];
  const journals = journalsQuery.data ?? [];

  const accountMap = useMemo(() => {
    const map = new Map<string, ChartOfAccountRecord>();
    for (const a of accounts) map.set(a.code, a);
    return map;
  }, [accounts]);

  const { lines, summaries, selectedSummary } = useMemo(() => {
    // Chronological for running balance
    const sortedJournals = [...journals].sort((a, b) => {
      const d = a.dateBs.localeCompare(b.dateBs);
      if (d !== 0) return d;
      return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
    });

    const allLines: LedgerLine[] = [];
    const runningByAccount = new Map<string, number>();
    const summaryMap = new Map<string, LedgerSummary>();

    for (const je of sortedJournals) {
      for (const line of je.lines ?? []) {
        const acc = accountMap.get(line.accountCode);
        const accountType = acc?.accountType ?? "";
        const name = line.accountName || acc?.name || line.accountCode;
        const prev = runningByAccount.get(line.accountCode) ?? 0;
        // Assets/Expenses: debit increases balance; Liabilities/Equity/Income: credit increases
        const isDebitNature =
          accountType === "ASSET" || accountType === "EXPENSE" || !accountType;
        const delta = isDebitNature
          ? line.debitNpr - line.creditNpr
          : line.creditNpr - line.debitNpr;
        const next = prev + delta;
        runningByAccount.set(line.accountCode, next);

        if (!summaryMap.has(line.accountCode)) {
          summaryMap.set(line.accountCode, {
            code: line.accountCode,
            name,
            group: groupLabel(accountType),
            openingBalance: 0,
            totalDebit: 0,
            totalCredit: 0,
            closingBalance: 0,
            lines: 0,
          });
        }
        const sum = summaryMap.get(line.accountCode)!;
        sum.totalDebit += line.debitNpr;
        sum.totalCredit += line.creditNpr;
        sum.closingBalance = next;
        sum.lines += 1;
        if (acc?.name) sum.name = acc.name;
        sum.group = groupLabel(accountType);

        allLines.push({
          key: `${je._id}-${line.accountCode}-${line.debitNpr}-${line.creditNpr}-${allLines.length}`,
          dateBs: je.dateBs,
          voucherNumber: je.voucherNumber,
          accountCode: line.accountCode,
          accountName: name,
          accountType,
          narration: line.description || je.narration,
          debitNpr: line.debitNpr,
          creditNpr: line.creditNpr,
          referenceType: je.referenceType,
          runningBalanceNpr: next,
        });
      }
    }

    // Apply filters (display newest first)
    const filtered = allLines
      .filter((row) => {
        if (accountCode && row.accountCode !== accountCode) return false;
        if (groupFilter && row.accountType !== groupFilter) return false;
        if (fromDate && row.dateBs < fromDate) return false;
        if (toDate && row.dateBs > toDate) return false;
        const q = search.trim().toLowerCase();
        if (q) {
          const hay =
            `${row.voucherNumber} ${row.narration} ${row.accountName} ${row.accountCode}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .reverse();

    const summaryList = Array.from(summaryMap.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    );

    const selected =
      accountCode
        ? summaryMap.get(accountCode) ?? null
        : null;

    return {
      lines: filtered,
      summaries: summaryList,
      selectedSummary: selected,
    };
  }, [journals, accountMap, accountCode, groupFilter, search, fromDate, toDate]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, r) => {
        acc.debit += r.debitNpr;
        acc.credit += r.creditNpr;
        return acc;
      },
      { debit: 0, credit: 0 },
    );
  }, [lines]);

  const exportExcel = () => {
    if (lines.length === 0) {
      toast.error("No ledger lines to export");
      return;
    }
    downloadRecordsExcel(
      `Ledger_${accountCode || "all"}_${fromDate || "start"}`,
      lines.map((r) => ({
        Date: r.dateBs,
        Voucher: r.voucherNumber,
        AccountCode: r.accountCode,
        AccountName: r.accountName,
        Group: groupLabel(r.accountType),
        Particulars: r.narration,
        Debit: r.debitNpr,
        Credit: r.creditNpr,
        RunningBalance: r.runningBalanceNpr,
        Source: r.referenceType ?? "Manual",
      })),
    );
    toast.success("Ledger Excel downloaded");
  };

  const printLedger = () => {
    if (lines.length === 0) {
      toast.error("No ledger lines to print");
      return;
    }
    const title = selectedSummary
      ? `Ledger — ${selectedSummary.code} ${selectedSummary.name}`
      : "Ledger Report";
    const rowsHtml = [...lines]
      .reverse()
      .map(
        (r) => `<tr>
        <td>${r.dateBs}</td>
        <td>${r.voucherNumber}</td>
        <td>${r.accountCode} ${r.accountName}</td>
        <td>${r.narration}</td>
        <td style="text-align:right">${r.debitNpr > 0 ? r.debitNpr.toFixed(2) : "—"}</td>
        <td style="text-align:right">${r.creditNpr > 0 ? r.creditNpr.toFixed(2) : "—"}</td>
        <td style="text-align:right">${r.runningBalanceNpr.toFixed(2)}</td>
      </tr>`,
      )
      .join("");
    const headerExtra = selectedSummary
      ? `<p><strong>Group:</strong> ${selectedSummary.group} &nbsp;
         <strong>Total Debit:</strong> ${selectedSummary.totalDebit.toFixed(2)} &nbsp;
         <strong>Total Credit:</strong> ${selectedSummary.totalCredit.toFixed(2)} &nbsp;
         <strong>Closing:</strong> ${selectedSummary.closingBalance.toFixed(2)}</p>`
      : "";
    printSimpleDocument({
      title,
      bodyHtml: `
        ${headerExtra}
        <p style="font-size:12px;color:#555">Period: ${fromDate || "…"} to ${toDate || "…"}</p>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Voucher</th><th>Account</th><th>Particulars</th>
              <th style="text-align:right">Debit</th>
              <th style="text-align:right">Credit</th>
              <th style="text-align:right">Balance</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `,
    });
  };

  if (accountsQuery.isLoading || journalsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookMarked className="h-5 w-5 text-brand-600" />
              Ledger
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Every fee, salary, refund, purchase, expense, income, and journal
              voucher posts here automatically. No manual ledger entry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={printLedger}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={exportExcel}>
              <FileDown className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FormField label="Ledger account">
                <Select
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                >
                  <option value="">All accounts</option>
                  {accounts
                    .filter((a) => a.isActive !== false)
                    .map((a) => (
                      <option key={a._id} value={a.code}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="Ledger group">
                <Select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                >
                  <option value="">All groups</option>
                  <option value="ASSET">Assets</option>
                  <option value="LIABILITY">Liabilities</option>
                  <option value="EQUITY">Equity</option>
                  <option value="INCOME">Income</option>
                  <option value="EXPENSE">Expenses</option>
                </Select>
              </FormField>
              <FormField label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-10 pl-8"
                    placeholder="Voucher, particulars…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="From date (BS)">
                <Input
                  placeholder="YYYY-MM-DD"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </FormField>
              <FormField label="To date (BS)">
                <Input
                  placeholder="YYYY-MM-DD"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </FormField>
            </div>
          </div>

          {selectedSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {[
                { label: "Ledger Name", value: selectedSummary.name },
                { label: "Ledger Group", value: selectedSummary.group },
                {
                  label: "Opening Balance",
                  value: formatCurrencyNpr(selectedSummary.openingBalance),
                },
                {
                  label: "Total Debit",
                  value: formatCurrencyNpr(selectedSummary.totalDebit),
                },
                {
                  label: "Total Credit",
                  value: formatCurrencyNpr(selectedSummary.totalCredit),
                },
                {
                  label: "Closing Balance",
                  value: formatCurrencyNpr(selectedSummary.closingBalance),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge className="bg-emerald-50 text-emerald-800">
                Debit total: {formatCurrencyNpr(totals.debit)}
              </Badge>
              <Badge className="bg-sky-50 text-sky-800">
                Credit total: {formatCurrencyNpr(totals.credit)}
              </Badge>
              <span className="self-center text-xs text-slate-500">
                {lines.length} line{lines.length === 1 ? "" : "s"} ·{" "}
                {summaries.length} ledger
                {summaries.length === 1 ? "" : "s"} with activity
              </span>
            </div>
          )}

          {!accountCode && summaries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Ledger Name</Th>
                    <Th>Group</Th>
                    <Th className="text-right">Total Debit</Th>
                    <Th className="text-right">Total Credit</Th>
                    <Th className="text-right">Closing Balance</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {summaries
                    .filter((s) => !groupFilter || s.group === groupLabel(groupFilter))
                    .map((s) => (
                      <tr key={s.code}>
                        <Td>
                          <span className="font-mono text-xs text-slate-500">
                            {s.code}
                          </span>
                          <div className="font-medium">{s.name}</div>
                        </Td>
                        <Td>{s.group}</Td>
                        <Td className="text-right">
                          {formatCurrencyNpr(s.totalDebit)}
                        </Td>
                        <Td className="text-right">
                          {formatCurrencyNpr(s.totalCredit)}
                        </Td>
                        <Td className="text-right font-medium">
                          {formatCurrencyNpr(s.closingBalance)}
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAccountCode(s.code)}
                          >
                            Open
                          </Button>
                        </Td>
                      </tr>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {accountCode || search || fromDate || toDate || groupFilter ? (
            lines.length === 0 ? (
              <EmptyState
                title="No ledger lines"
                description="Posted fee, salary, refund, purchase, expense, and journal vouchers appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Voucher</Th>
                      <Th>Particulars</Th>
                      <Th>Source</Th>
                      <Th className="text-right">Debit</Th>
                      <Th className="text-right">Credit</Th>
                      <Th className="text-right">Running Balance</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {[...lines].reverse().map((row) => (
                      <tr key={row.key}>
                        <Td className="whitespace-nowrap text-sm">{row.dateBs}</Td>
                        <Td className="font-mono text-sm">{row.voucherNumber}</Td>
                        <Td
                          className="max-w-[260px] truncate text-sm"
                          title={row.narration}
                        >
                          {!accountCode ? (
                            <span className="mb-0.5 block text-xs text-slate-500">
                              {row.accountCode} · {row.accountName}
                            </span>
                          ) : null}
                          {row.narration}
                        </Td>
                        <Td className="text-xs text-slate-600">
                          {row.referenceType
                            ? String(row.referenceType).replace(/_/g, " ")
                            : "Manual"}
                        </Td>
                        <Td className="text-right text-sm">
                          {row.debitNpr > 0
                            ? formatCurrencyNpr(row.debitNpr)
                            : "—"}
                        </Td>
                        <Td className="text-right text-sm">
                          {row.creditNpr > 0
                            ? formatCurrencyNpr(row.creditNpr)
                            : "—"}
                        </Td>
                        <Td className="text-right text-sm font-medium">
                          {formatCurrencyNpr(row.runningBalanceNpr)}
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
