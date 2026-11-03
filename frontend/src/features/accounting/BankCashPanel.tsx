import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BankAccountRecord, BankCashSummary, UnlinkedBankResponse } from "@phit-erp/shared";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  CheckCircle2,
  FileCheck2,
  Landmark,
  NotebookPen,
  Wallet,
} from "lucide-react";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { cn } from "lib/utils";
import { BankAccountsManager } from "./BankAccountsManager";
import { BankCashBooks } from "./BankCashBooks";
import { BankCashDayBook } from "./BankCashDayBook";
import { BankCashEntry } from "./BankCashEntry";
import { npr } from "./bankCashShared";

type View = "entry" | "daybook" | "books" | "banks";

interface BankCashPanelProps {
  /** Make entries (Administrator / Accountant). */
  canWrite: boolean;
  /** Add / edit / deactivate bank accounts, void transfers. */
  canManage: boolean;
  /** Open another Accounting section. */
  onOpenSection: (tab: string) => void;
  /** Open Bank Reconciliation for one bank. */
  onReconcile: (bankAccountId: string) => void;
}

/**
 * Bank / Cash: the one place money is entered and checked. Entry posts each
 * row to its section (journal voucher automatic); the Day Book shows every
 * Cash / Bank movement from every section; Books and Bank Accounts complete it.
 */
export const BankCashPanel = ({ canWrite, canManage, onOpenSection, onReconcile }: BankCashPanelProps) => {
  const [view, setView] = useState<View>(canWrite ? "entry" : "daybook");
  /** Book to open in Cash & Bank Books ("cash", "bank" or a bank account id). */
  const [bookKey, setBookKey] = useState("cash");
  const [showUnlinked, setShowUnlinked] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["accounting-bank-cash", "summary"],
    queryFn: () => unwrap<BankCashSummary>(api.get("/accounting/bank-cash/summary")),
  });
  const banksQuery = useQuery({
    queryKey: ["accounting-bank-cash", "accounts"],
    queryFn: () => unwrap<BankAccountRecord[]>(api.get("/accounting/bank-accounts")),
  });
  const unlinkedQuery = useQuery({
    queryKey: ["accounting-bank-cash", "unlinked"],
    queryFn: () => unwrap<UnlinkedBankResponse>(api.get("/accounting/bank-cash/unlinked")),
    enabled: showUnlinked,
  });

  if (summaryQuery.isLoading && banksQuery.isLoading) {
    return <LoadingState />;
  }

  const summary = summaryQuery.data;
  const banks = banksQuery.data ?? [];
  const activeBankRows = (summary?.banks ?? []).filter((bank) => bank.isActive);
  const cash = summary?.cashInHandNpr ?? 0;
  // Opening balances of the bank accounts are part of the bank balance.
  const bank = summary?.bankBalanceNpr ?? summary?.bankLedgerNpr ?? 0;

  const openBook = (key: string) => {
    setBookKey(key);
    setView("books");
  };

  const views: Array<{ id: View; label: string; hint: string; icon: typeof Wallet; hidden?: boolean }> = [
    { id: "entry", label: "Entry", hint: "Receipts, payments, transfers", icon: NotebookPen, hidden: !canWrite },
    { id: "daybook", label: "Day Book", hint: "Search every entry", icon: BookOpen },
    { id: "books", label: "Cash & Bank Books", hint: "Opening to closing", icon: Landmark },
    { id: "banks", label: "Bank Accounts", hint: "Balances & reconciliation", icon: Building2 },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-brand-50 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Bank / Cash</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-600">
                Every receipt, payment and transfer in one place — posted to its section and the ledger automatically.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="bg-white" onClick={() => onOpenSection("bank-reconciliation")}>
            <FileCheck2 className="mr-1.5 h-4 w-4" />
            Bank Reconciliation
          </Button>
        </div>

        {/* Balances */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => openBook("cash")}
            className="rounded-2xl border border-emerald-200 bg-white p-4 text-left transition hover:shadow-sm"
          >
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Wallet className="h-4 w-4 text-emerald-600" /> Cash in Hand
            </p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", cash < 0 ? "text-red-700" : "text-emerald-700")}>
              {npr(cash)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Open Cash Book →</p>
          </button>
          <button
            type="button"
            onClick={() => openBook("bank")}
            className="rounded-2xl border border-brand-200 bg-white p-4 text-left transition hover:shadow-sm"
          >
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Landmark className="h-4 w-4 text-brand-600" /> Bank Balance
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-700">{npr(bank)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {activeBankRows.length} bank account{activeBankRows.length === 1 ? "" : "s"} · Open Bank Book →
            </p>
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Total Cash & Bank</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{npr(cash + bank)}</p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
              {cash + bank > 0 ? (
                <>
                  <div className="bg-emerald-500" style={{ width: `${Math.max(0, (cash / (cash + bank)) * 100)}%` }} />
                  <div className="bg-brand-500" style={{ width: `${Math.max(0, (bank / (cash + bank)) * 100)}%` }} />
                </>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              <span className="text-emerald-700">■</span> Cash · <span className="text-brand-700">■</span> Bank
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Today{summary?.todayBs ? ` · ${summary.todayBs}` : ""}</p>
            <p className="mt-1.5 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-slate-600">
                <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> Received
              </span>
              <span className="font-semibold tabular-nums text-emerald-700">{npr(summary?.todayReceiptsNpr ?? 0)}</span>
            </p>
            <p className="mt-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-slate-600">
                <ArrowUpRight className="h-4 w-4 text-rose-600" /> Paid
              </span>
              <span className="font-semibold tabular-nums text-rose-700">{npr(summary?.todayPaymentsNpr ?? 0)}</span>
            </p>
          </div>
        </div>

        {/* Banks */}
        {activeBankRows.length ? (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {activeBankRows.map((row) => (
              <button
                key={row.bankAccountId}
                type="button"
                onClick={() => openBook(row.bankAccountId)}
                className="min-w-[13rem] shrink-0 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-left transition hover:border-brand-300 hover:shadow-sm"
                title="Open this bank's Bank Book"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">{row.bankName}</span>
                  {row.lastReconciliationStatus === "COMPLETED" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Reconciled" />
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">A/c {row.accountNumber}</p>
                <p className="mt-1 font-semibold tabular-nums text-slate-900">{npr(row.balanceNpr)}</p>
                <p className="text-[11px] text-slate-500">
                  {row.lastReconciledBs ? `Reconciled to ${row.lastReconciledBs}` : "Not reconciled yet"}
                </p>
              </button>
            ))}
          </div>
        ) : null}

        {/* Bank money recorded without a bank account: in Bank, but in no bank's book */}
        {summary && Math.abs(summary.unlinkedBankNpr) >= 0.01 ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">Unlinked bank amount {npr(summary.unlinkedBankNpr)}</span> — Bank
                  entries with no bank account. They are not in any bank's balance, Bank Book or reconciliation.
                </span>
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowUnlinked((open) => !open)}>
                {showUnlinked ? "Hide lines" : "View lines"}
              </Button>
            </div>
            {showUnlinked ? (
              <div className="mt-3 space-y-2">
                {unlinkedQuery.isLoading ? (
                  <LoadingState />
                ) : (unlinkedQuery.data?.lines ?? []).length === 0 ? (
                  <p className="text-sm text-amber-900">
                    No voucher left to fix — the amount comes from vouchers already reversed.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-amber-100/60 text-left text-xs uppercase tracking-wide text-amber-900">
                          <tr>
                            <th className="px-3 py-2">Date (BS)</th>
                            <th className="px-3 py-2">Voucher</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Particulars</th>
                            <th className="px-3 py-2 text-right">Into bank</th>
                            <th className="px-3 py-2 text-right">Out of bank</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(unlinkedQuery.data?.lines ?? []).map((line) => (
                            <tr key={`${line.journalEntryId}-${line.amountNpr}`} className="border-t border-amber-100">
                              <td className="px-3 py-2 whitespace-nowrap">{line.dateBs}</td>
                              <td className="px-3 py-2 font-mono text-xs">{line.voucherNumber}</td>
                              <td className="px-3 py-2">{line.referenceType ?? "Manual"}</td>
                              <td className="px-3 py-2">{line.narration}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {line.amountNpr > 0 ? npr(line.amountNpr) : ""}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {line.amountNpr < 0 ? npr(-line.amountNpr) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-amber-900">
                      To fix one: reverse the voucher (Journal Entries → Reverse, or void it in its own section), then
                      record it again choosing the bank account.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => onOpenSection("journal-entries")}>
                      Open Journal Entries
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Sections */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="tablist">
        {views
          .filter((item) => !item.hidden)
          .map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                  active
                    ? "border-brand-500 bg-brand-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    active ? "bg-white/15" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={cn("block text-xs", active ? "text-white/80" : "text-slate-500")}>{item.hint}</span>
                </span>
              </button>
            );
          })}
      </div>

      {view === "entry" && canWrite ? (
        <BankCashEntry banks={banks} summary={summary} onOpenSection={onOpenSection} />
      ) : null}
      {view === "daybook" ? <BankCashDayBook banks={banks} canManage={canManage} onOpenSection={onOpenSection} /> : null}
      {view === "books" ? (
        <BankCashBooks key={bookKey} banks={banks} initialBookKey={bookKey} onReconcile={onReconcile} />
      ) : null}
      {view === "banks" ? (
        <BankAccountsManager banks={banks} summary={summary} canManage={canManage} onReconcile={onReconcile} />
      ) : null}
    </div>
  );
};
