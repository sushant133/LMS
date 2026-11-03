import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BankCashSummary } from "@phit-erp/shared";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileCheck2,
  Landmark,
  Layers,
  Printer,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { api, unwrap } from "lib/api";
import { escapePrintText } from "lib/printPage";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
import { useActiveBankAccounts } from "./BankAccountField";
import { amount, bankLabel, npr, todayBs } from "./bankCashShared";
import { printSimpleDocument } from "./voucherPrint";

interface ReconciliationItem {
  journalEntryId: string;
  dateBs: string;
  voucherNumber: string;
  narration: string;
  debitNpr: number;
  creditNpr: number;
  cleared: boolean;
  isVoided?: boolean;
  isReversal?: boolean;
}

interface ReconciliationView {
  accountCode: string;
  statementDateBs: string;
  openingNpr?: number;
  items: ReconciliationItem[];
  ledgerBalanceNpr: number;
  /** Bank entries up to the statement date saved without a bank account. */
  untaggedBankEntries?: number;
}

interface ReconciliationRecord {
  _id: string;
  statementDateBs: string;
  statementBalanceNpr: number;
  ledgerBalanceNpr: number;
  differenceNpr: number;
  unpresentedChequesNpr?: number;
  depositsInTransitNpr?: number;
  status: "DRAFT" | "COMPLETED";
  notes?: string;
  clearedEntryIds?: string[];
  completedAt?: string;
}

/** "combined" = the whole Bank ledger at once (how reconciliations worked before per-bank). */
const COMBINED = "combined";

type ItemFilter = "all" | "uncleared" | "cleared";

interface BankReconciliationPanelProps {
  canWrite: boolean;
  /** Bank to open with (from Bank / Cash → Reconcile). */
  initialBankAccountId?: string;
  /** Go to the Bank / Cash section. */
  onOpenBankCash?: () => void;
}

/**
 * Bank Reconciliation Statement (BRS) for one bank: tick what appears on the
 * bank's statement; what is left explains the difference between the books and
 * the statement (deposits in transit, unpresented cheques).
 */
export const BankReconciliationPanel = ({
  canWrite,
  initialBankAccountId,
  onOpenBankCash,
}: BankReconciliationPanelProps) => {
  const banks = useActiveBankAccounts();
  const summaryQuery = useQuery({
    queryKey: ["accounting-bank-cash", "summary"],
    queryFn: () => unwrap<BankCashSummary>(api.get("/accounting/bank-cash/summary")),
  });
  const bankSummary = (id: string) => summaryQuery.data?.banks.find((bank) => bank.bankAccountId === id);

  const [bankChoice, setBankChoice] = useState(initialBankAccountId ?? "");
  // Each bank is reconciled against its own statement; default to the first bank
  const bankKey = bankChoice || banks[0]?._id || COMBINED;
  const bankAccountId = bankKey === COMBINED ? undefined : bankKey;
  const selectedBank = banks.find((bank) => bank._id === bankAccountId);
  const bankName = selectedBank ? bankLabel(selectedBank) : "All banks combined";

  // Today by default, so every bank entry made so far is listed straight away
  const [statementDateBs, setStatementDateBs] = useState(todayBs);
  const [statementBalance, setStatementBalance] = useState<number | undefined>(undefined);
  const [fromDateBs, setFromDateBs] = useState("");
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [search, setSearch] = useState("");
  /** Ticks of a saved reconciliation being reopened from History. */
  const [reopenTicks, setReopenTicks] = useState<string[] | null>(null);

  // The statement balance is not part of the query: figures are worked out here as
  // it is typed, so typing never reloads the list or loses ticks.
  const previewQuery = useQuery({
    queryKey: ["bank-reconciliation-preview", bankKey, statementDateBs, fromDateBs],
    queryFn: () =>
      unwrap<ReconciliationView>(
        api.get("/accounting/reconciliations/preview", {
          params: {
            statementDateBs,
            statementBalanceNpr: 0,
            fromDateBs: fromDateBs || undefined,
            bankAccountId,
          },
        }),
      ),
    enabled: statementDateBs.trim().length > 0,
  });

  const historyQuery = useQuery({
    queryKey: ["bank-reconciliations", bankKey],
    queryFn: () =>
      unwrap<ReconciliationRecord[]>(api.get("/accounting/reconciliations", { params: { bankAccountId: bankKey } })),
  });

  // Seed the ticks from what earlier reconciliations of this bank already settled
  useEffect(() => {
    if (!previewQuery.data) return;
    if (reopenTicks) {
      setCleared(new Set(reopenTicks));
      setReopenTicks(null);
      return;
    }
    setCleared(new Set(previewQuery.data.items.filter((item) => item.cleared).map((item) => item.journalEntryId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the list itself changes
  }, [previewQuery.data]);

  const items = previewQuery.data?.items ?? [];
  const statementNpr = statementBalance ?? 0;

  const live = useMemo(() => {
    const base = previewQuery.data;
    if (!base) return null;
    const uncleared = items.filter((item) => !cleared.has(item.journalEntryId));
    const unpresentedChequesNpr = uncleared.reduce((sum, item) => sum + item.creditNpr, 0);
    const depositsInTransitNpr = uncleared.reduce((sum, item) => sum + item.debitNpr, 0);
    const adjustedBalanceNpr = base.ledgerBalanceNpr - depositsInTransitNpr + unpresentedChequesNpr;
    const differenceNpr = Math.round((adjustedBalanceNpr - statementNpr) * 100) / 100;
    return {
      unpresentedChequesNpr,
      depositsInTransitNpr,
      adjustedBalanceNpr,
      differenceNpr,
      isReconciled: statementBalance !== undefined && Math.abs(differenceNpr) < 0.01,
      unclearedCount: uncleared.length,
      clearedCount: items.length - uncleared.length,
    };
  }, [previewQuery.data, items, cleared, statementNpr, statementBalance]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const isCleared = cleared.has(item.journalEntryId);
      if (filter === "cleared" && !isCleared) return false;
      if (filter === "uncleared" && isCleared) return false;
      if (!q) return true;
      return (
        item.narration.toLowerCase().includes(q) ||
        item.voucherNumber.toLowerCase().includes(q) ||
        item.dateBs.includes(q) ||
        String(item.debitNpr || item.creditNpr).includes(q.replace(/,/g, ""))
      );
    });
  }, [items, cleared, filter, search]);

  const save = useMutation({
    mutationFn: (status: "DRAFT" | "COMPLETED") =>
      unwrap(
        api.post("/accounting/reconciliations", {
          statementDateBs,
          statementBalanceNpr: statementNpr,
          fromDateBs: fromDateBs || undefined,
          clearedEntryIds: Array.from(cleared),
          notes,
          status,
          bankAccountId,
        }),
      ),
    onSuccess: async (_data, status) => {
      toast.success(status === "COMPLETED" ? `${bankName} reconciled` : "Reconciliation saved as draft");
      await historyQuery.refetch();
      // Bank / Cash shows each bank's last reconciliation
      await queryClient.invalidateQueries({ queryKey: ["accounting-bank-cash"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error) || "Could not save reconciliation"),
  });

  const toggle = (id: string) =>
    setCleared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleTicked = visibleItems.length > 0 && visibleItems.every((item) => cleared.has(item.journalEntryId));
  const toggleVisible = () =>
    setCleared((prev) => {
      const next = new Set(prev);
      for (const item of visibleItems) {
        if (allVisibleTicked) next.delete(item.journalEntryId);
        else next.add(item.journalEntryId);
      }
      return next;
    });

  const printStatement = () => {
    if (!previewQuery.data || !live) return;
    const pending = items.filter((item) => !cleared.has(item.journalEntryId));
    const rows = (list: ReconciliationItem[], pick: (item: ReconciliationItem) => number) =>
      list
        .filter((item) => pick(item) > 0)
        .map(
          (item) =>
            `<tr><td>${escapePrintText(item.dateBs)}</td><td>${escapePrintText(item.voucherNumber)}</td><td>${escapePrintText(item.narration)}</td><td style="text-align:right">${amount(pick(item))}</td></tr>`,
        )
        .join("") || `<tr><td colspan="4">None</td></tr>`;
    printSimpleDocument({
      title: "Bank Reconciliation Statement",
      subtitle: `${bankName} · as at ${statementDateBs}`,
      bodyHtml: `
        <table>
          <tbody>
            <tr><td>Balance as per books (Cash Book — bank column)</td><td style="text-align:right">${amount(previewQuery.data.ledgerBalanceNpr) || "0.00"}</td></tr>
            <tr><td>Less: deposits in transit (recorded, not yet credited by bank)</td><td style="text-align:right">(${amount(live.depositsInTransitNpr) || "0.00"})</td></tr>
            <tr><td>Add: cheques issued but not yet presented</td><td style="text-align:right">${amount(live.unpresentedChequesNpr) || "0.00"}</td></tr>
            <tr><th>Balance as per bank statement (expected)</th><th style="text-align:right">${amount(live.adjustedBalanceNpr) || "0.00"}</th></tr>
            <tr><td>Balance shown on bank statement</td><td style="text-align:right">${amount(statementNpr) || "0.00"}</td></tr>
            <tr><th>Difference</th><th style="text-align:right">${amount(live.differenceNpr) || "0.00"}</th></tr>
          </tbody>
        </table>
        <h3 style="margin-top:18px">Deposits in transit</h3>
        <table><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th style="text-align:right">Amount (NPR)</th></tr></thead>
        <tbody>${rows(pending, (item) => item.debitNpr)}</tbody></table>
        <h3 style="margin-top:18px">Unpresented cheques / payments</h3>
        <table><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th style="text-align:right">Amount (NPR)</th></tr></thead>
        <tbody>${rows(pending, (item) => item.creditNpr)}</tbody></table>
        ${notes.trim() ? `<p style="margin-top:12px"><strong>Notes:</strong> ${escapePrintText(notes)}</p>` : ""}
        <div class="signatures"><div>Prepared By</div><div>Checked By</div><div>Approved By</div></div>`,
    });
  };

  const progress = live && items.length ? Math.round((live.clearedCount / items.length) * 100) : 0;
  const ready = Boolean(statementDateBs);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Bank Reconciliation</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-600">
                Match your books with each bank's statement. Tick every entry that appears on the statement — what
                is left explains the difference.
              </p>
            </div>
          </div>
          {onOpenBankCash ? (
            <Button size="sm" variant="outline" className="bg-white" onClick={onOpenBankCash}>
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open Bank / Cash
            </Button>
          ) : null}
        </div>

        {/* Step 1: bank */}
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Choose the bank</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {banks.map((bank) => {
            const info = bankSummary(bank._id);
            const active = bank._id === bankKey;
            return (
              <button
                key={bank._id}
                type="button"
                onClick={() => setBankChoice(bank._id)}
                className={cn(
                  "rounded-2xl border bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm",
                  active ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className={cn("h-4 w-4", active ? "text-brand-600" : "text-slate-400")} />
                    <span className="font-semibold text-slate-900">{bank.bankName}</span>
                  </div>
                  {active ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : null}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">A/c {bank.accountNumber}</p>
                <p className="mt-2 text-base font-semibold tabular-nums text-slate-900">
                  {info ? npr(info.balanceNpr) : "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {info?.lastReconciledBs ? (
                    <>
                      Last: {info.lastReconciledBs}{" "}
                      <span className={info.lastReconciliationStatus === "COMPLETED" ? "text-emerald-700" : "text-amber-700"}>
                        ({info.lastReconciliationStatus === "COMPLETED" ? "reconciled" : "draft"})
                      </span>
                    </>
                  ) : (
                    "Never reconciled"
                  )}
                </p>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setBankChoice(COMBINED)}
            className={cn(
              "flex flex-col justify-center rounded-2xl border border-dashed bg-white/70 p-4 text-left transition hover:border-brand-300",
              bankKey === COMBINED ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-300",
            )}
          >
            <span className="flex items-center gap-2 font-medium text-slate-700">
              <Layers className="h-4 w-4 text-slate-400" /> All banks combined
            </span>
            <span className="mt-1 text-xs text-slate-500">Whole Bank ledger — for older reconciliations</span>
          </button>
        </div>
        {banks.length === 0 ? (
          <p className="mt-2 text-xs text-slate-600">
            No bank accounts yet — add them in Bank / Cash → Bank Accounts to reconcile each bank against its own
            statement.
          </p>
        ) : null}

        {/* Step 2: statement */}
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Enter the bank statement</p>
        <div className="mt-2 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-3">
          <FormField label="Statement date (BS)">
            <NepaliDateField value={statementDateBs} onChange={setStatementDateBs} />
          </FormField>
          <FormField label="Closing balance on statement (NPR)">
            <NumberInput value={statementBalance} onValueChange={setStatementBalance} placeholder="As printed on the statement" />
          </FormField>
          <FormField label="Show entries from (BS, optional)">
            <NepaliDateField value={fromDateBs} onChange={setFromDateBs} />
          </FormField>
        </div>
      </div>

      {!ready ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CalendarDays className="h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-700">Enter the statement date to begin</p>
            <p className="max-w-md text-sm text-slate-500">
              The {bankName} entries up to that date will be listed so you can tick the ones on the statement.
            </p>
          </CardContent>
        </Card>
      ) : previewQuery.isLoading ? (
        <LoadingState />
      ) : previewQuery.isError ? (
        <EmptyState title="Could not load the entries" description={parseErrorMessage(previewQuery.error)} />
      ) : previewQuery.data && live ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {/* Step 3: transactions */}
          <Card className="xl:col-span-2">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">3 · Tick entries on the statement</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {live.clearedCount} of {items.length} ticked · {live.unclearedCount} left
                  </p>
                  <p className="text-xs text-slate-400">
                    Every bank entry from Bank / Cash and other sections up to the statement date. Cash entries don&apos;t
                    pass through the bank, so they are not listed.
                  </p>
                </div>
                <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-sm">
                  {(
                    [
                      ["all", `All (${items.length})`],
                      ["uncleared", `Not on statement (${live.unclearedCount})`],
                      ["cleared", `Ticked (${live.clearedCount})`],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 font-medium transition",
                        filter === value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn("h-full rounded-full transition-all", live.isReconciled ? "bg-emerald-500" : "bg-brand-500")}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {bankAccountId && (previewQuery.data.untaggedBankEntries ?? 0) > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>
                    {previewQuery.data.untaggedBankEntries} older bank entr
                    {previewQuery.data.untaggedBankEntries === 1 ? "y was" : "ies were"} saved without choosing a bank,
                    so {previewQuery.data.untaggedBankEntries === 1 ? "it is" : "they are"} not listed here.
                  </span>
                  <Button size="sm" variant="outline" className="bg-white" onClick={() => setBankChoice(COMBINED)}>
                    See in All banks combined
                  </Button>
                </div>
              ) : null}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9 pr-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search voucher, particulars, date or amount"
                  aria-label="Search entries"
                />
                {search ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {items.length === 0 ? (
                <EmptyState
                  title="No bank entries"
                  description={`Nothing was recorded against ${bankName} up to ${statementDateBs}.`}
                />
              ) : visibleItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No entries match.</p>
              ) : (
                <div className="max-h-[560px] overflow-auto rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="w-12 px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-600"
                            checked={allVisibleTicked}
                            onChange={toggleVisible}
                            aria-label="Tick all shown"
                            disabled={!canWrite}
                          />
                        </th>
                        <th className="w-28 px-2 py-2">Date</th>
                        <th className="px-2 py-2">Particulars</th>
                        <th className="w-32 px-2 py-2 text-right text-emerald-700">Deposit</th>
                        <th className="w-32 px-2 py-2 text-right text-rose-700">Withdrawal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((item) => {
                        const isCleared = cleared.has(item.journalEntryId);
                        return (
                          <tr
                            key={item.journalEntryId}
                            onClick={() => canWrite && toggle(item.journalEntryId)}
                            className={cn(
                              "border-t border-slate-100 transition",
                              canWrite && "cursor-pointer",
                              isCleared ? "bg-emerald-50/60 hover:bg-emerald-50" : "hover:bg-slate-50",
                            )}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-emerald-600"
                                checked={isCleared}
                                disabled={!canWrite}
                                onChange={() => toggle(item.journalEntryId)}
                                aria-label={`Mark ${item.voucherNumber} as on the statement`}
                              />
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {item.dateBs}
                              <div className="font-mono text-[11px] text-slate-500">{item.voucherNumber}</div>
                            </td>
                            <td className="px-2 py-2">
                              <span className={cn(isCleared ? "text-slate-700" : "text-slate-900")}>{item.narration}</span>
                              {item.isVoided || item.isReversal ? (
                                <span
                                  className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                                  title="A voided entry and its reversal cancel each other — tick both if neither appears on the statement"
                                >
                                  {item.isReversal ? "Reversal of voided entry" : "Voided"}
                                </span>
                              ) : null}
                              {!isCleared ? (
                                <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-700">
                                  <CircleDashed className="h-3 w-3" />
                                  {item.debitNpr > 0 ? "in transit" : "not presented"}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-emerald-800">{amount(item.debitNpr)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-rose-800">{amount(item.creditNpr)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 4: statement */}
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card className={cn(live.isReconciled ? "border-emerald-300" : "border-slate-200")}>
              <CardHeader>
                <CardTitle className="text-base">4 · Reconciliation statement</CardTitle>
                <p className="text-xs text-slate-500">
                  {bankName} · as at {statementDateBs}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Balance as per books</dt>
                    <dd className="font-semibold tabular-nums">{npr(previewQuery.data.ledgerBalanceNpr)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="flex items-center gap-1 text-slate-600">
                      <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" /> Less: deposits in transit
                    </dt>
                    <dd className="tabular-nums text-slate-700">− {npr(live.depositsInTransitNpr)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="flex items-center gap-1 text-slate-600">
                      <ArrowUpRight className="h-3.5 w-3.5 text-rose-600" /> Add: unpresented cheques
                    </dt>
                    <dd className="tabular-nums text-slate-700">+ {npr(live.unpresentedChequesNpr)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
                    <dt className="font-medium text-slate-800">Expected statement balance</dt>
                    <dd className="font-semibold tabular-nums">{npr(live.adjustedBalanceNpr)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Balance on statement</dt>
                    <dd className="font-semibold tabular-nums">
                      {statementBalance === undefined ? <span className="text-slate-400">not entered</span> : npr(statementNpr)}
                    </dd>
                  </div>
                </dl>

                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-center",
                    statementBalance === undefined
                      ? "bg-slate-50 text-slate-600"
                      : live.isReconciled
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800",
                  )}
                >
                  {statementBalance === undefined ? (
                    <p className="text-sm">Enter the statement's closing balance above.</p>
                  ) : live.isReconciled ? (
                    <>
                      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                      <p className="mt-1 font-semibold">Reconciled</p>
                      <p className="text-xs">Books agree with the bank statement.</p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mx-auto h-7 w-7 text-amber-600" />
                      <p className="mt-1 text-xs uppercase tracking-wide">Difference</p>
                      <p className="text-2xl font-bold tabular-nums">{npr(live.differenceNpr)}</p>
                      <p className="mt-1 text-xs">
                        Tick the remaining entries on the statement. A leftover difference is usually bank charges or
                        interest not yet recorded — enter them in Bank / Cash.
                      </p>
                    </>
                  )}
                </div>

                <FormField label="Notes">
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </FormField>

                <div className="grid gap-2">
                  {canWrite ? (
                    <>
                      <Button
                        onClick={() => save.mutate("COMPLETED")}
                        disabled={save.isPending || !live.isReconciled}
                        title={live.isReconciled ? undefined : "Clear the difference first"}
                        className="w-full"
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        Complete reconciliation
                      </Button>
                      <Button variant="outline" className="w-full" onClick={() => save.mutate("DRAFT")} disabled={save.isPending}>
                        Save as draft
                      </Button>
                    </>
                  ) : null}
                  <Button variant="outline" className="w-full" onClick={printStatement}>
                    <Printer className="mr-1.5 h-4 w-4" />
                    Print statement
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation history — {bankName}</CardTitle>
        </CardHeader>
        <CardContent>
          {(historyQuery.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No reconciliations saved for this bank yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Statement date</th>
                    <th className="px-3 py-2 text-right">Statement balance</th>
                    <th className="px-3 py-2 text-right">Books balance</th>
                    <th className="px-3 py-2 text-right">Difference</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(historyQuery.data ?? []).map((row) => (
                    <tr key={row._id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">{row.statementDateBs}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{npr(row.statementBalanceNpr)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{npr(row.ledgerBalanceNpr)}</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          Math.abs(row.differenceNpr) < 0.01 ? "text-emerald-700" : "text-amber-700",
                        )}
                      >
                        {npr(row.differenceNpr)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          className={row.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}
                        >
                          {row.status === "COMPLETED" ? "Reconciled" : "Draft"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const ticks = (row.clearedEntryIds ?? []).map(String);
                            // Same list already loaded: apply now; otherwise when it loads
                            if (row.statementDateBs === statementDateBs && !fromDateBs && previewQuery.data) {
                              setCleared(new Set(ticks));
                            } else {
                              setReopenTicks(ticks);
                            }
                            setFromDateBs("");
                            setStatementDateBs(row.statementDateBs);
                            setStatementBalance(row.statementBalanceNpr);
                            setNotes(row.notes ?? "");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
