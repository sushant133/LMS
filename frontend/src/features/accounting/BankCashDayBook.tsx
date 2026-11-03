import { Fragment, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type {
  BankAccountRecord,
  BankCashIntegrity,
  BankCashRegisterResponse,
  BankCashRegisterRow,
  BankCashSectionKey,
} from "@phit-erp/shared";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import { escapePrintText } from "lib/printPage";
import { getPdfErrorMessage, printElementById } from "lib/printUtils";
import { cn, parseErrorMessage } from "lib/utils";
import {
  SECTION_LABEL,
  SECTION_TAB,
  amount,
  bankLabel,
  fiscalYearStartBs,
  monthStartBs,
  npr,
  sectionVoucherKind,
  todayBs,
} from "./bankCashShared";
import { invalidateAccountingQueries } from "./invalidateAccountingQueries";
import { BankCashSectionTitle } from "./BankCashSectionTitle";
import { printSimpleDocument } from "./voucherPrint";

type Period = "today" | "month" | "fiscal" | "all" | "custom";

const PAGE_SIZE = 100;

const periodRange = (period: Period, from: string, to: string): { from?: string; to?: string } => {
  switch (period) {
    case "today":
      return { from: todayBs(), to: todayBs() };
    case "month":
      return { from: monthStartBs(), to: todayBs() };
    case "fiscal":
      return { from: fiscalYearStartBs(), to: todayBs() };
    case "custom":
      return { from: from || undefined, to: to || undefined };
    default:
      return {};
  }
};

const KIND_TONE: Record<string, string> = {
  Receipt: "bg-emerald-50 text-emerald-700",
  Payment: "bg-rose-50 text-rose-700",
  Contra: "bg-sky-50 text-sky-700",
  Journal: "bg-slate-100 text-slate-600",
};

interface BankCashDayBookProps {
  banks: BankAccountRecord[];
  canManage: boolean;
  onOpenSection: (tab: string) => void;
}

/**
 * Day Book: every Cash / Bank movement from every section, searchable and
 * filterable, each row opening its full double-entry voucher.
 */
export const BankCashDayBook = ({ banks, canManage, onOpenSection }: BankCashDayBookProps) => {
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [section, setSection] = useState<BankCashSectionKey | "">("");
  const [cashBank, setCashBank] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Search as you type, without a request per key press
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const range = periodRange(period, customFrom, customTo);
  const params = {
    fromDateBs: range.from,
    toDateBs: range.to,
    section: section || undefined,
    cashBank: cashBank || undefined,
    q: search || undefined,
  };

  const registerQuery = useInfiniteQuery({
    queryKey: ["accounting-bank-cash", "register", params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap<BankCashRegisterResponse>(
        api.get("/accounting/bank-cash/register", { params: { ...params, page: pageParam, limit: PAGE_SIZE } }),
      ),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const integrityQuery = useQuery({
    queryKey: ["accounting-bank-cash", "integrity", range.from, range.to],
    queryFn: () =>
      unwrap<BankCashIntegrity>(
        api.get("/accounting/bank-cash/integrity", { params: { fromDateBs: range.from, toDateBs: range.to } }),
      ),
  });

  const pages = registerQuery.data?.pages ?? [];
  const rows = useMemo(() => pages.flatMap((page) => page.rows), [pages]);
  const first = pages[0];

  const voidMutation = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/accounting/bank-cash/transfers/${id}/void`)),
    onSuccess: async () => {
      toast.success("Transfer voided — reversing voucher posted");
      setVoidingId(null);
      await invalidateAccountingQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const [printing, setPrinting] = useState(false);
  const printDayBook = async () => {
    setPrinting(true);
    try {
      await printElementById("bank-cash-daybook-print", "Day Book", "a4-landscape");
    } catch (error) {
      toast.error(getPdfErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  const printVoucher = (row: BankCashRegisterRow) => {
    const lines = row.voucherLines
      .map(
        (line) => `<tr>
          <td>${escapePrintText(line.account)}</td>
          <td>${escapePrintText(line.description)}</td>
          <td style="text-align:right">${line.debitNpr ? amount(line.debitNpr) : ""}</td>
          <td style="text-align:right">${line.creditNpr ? amount(line.creditNpr) : ""}</td>
        </tr>`,
      )
      .join("");
    printSimpleDocument({
      title: `${sectionVoucherKind(row.sectionKey, row.debitNpr)} Voucher`,
      subtitle: `Voucher No. ${row.voucherNumber} · Date ${row.dateBs}`,
      bodyHtml: `
        <p><strong>Section:</strong> ${escapePrintText(row.account)}</p>
        <p><strong>Narration:</strong> ${escapePrintText(row.description)}</p>
        <table>
          <thead><tr><th>Account</th><th>Particulars</th><th style="text-align:right">Debit (NPR)</th><th style="text-align:right">Credit (NPR)</th></tr></thead>
          <tbody>${lines}</tbody>
          <tfoot><tr><th colspan="2">Total</th><th style="text-align:right">${amount(row.voucherDebitNpr)}</th><th style="text-align:right">${amount(row.voucherCreditNpr)}</th></tr></tfoot>
        </table>
        <div class="signatures"><div>Prepared By</div><div>Checked By</div><div>Approved By</div></div>`,
    });
  };

  const clearFilters = () => {
    setPeriod("month");
    setSection("");
    setCashBank("");
    setSearchText("");
  };
  const filtersActive = period !== "month" || section || cashBank || searchText;

  const integrity = integrityQuery.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <BankCashSectionTitle
              icon={BookOpen}
              title="Day Book"
              subtitle="Every receipt, payment and transfer from all sections. Click a row to see its full voucher."
            />
          </div>
          <Button size="sm" variant="outline" disabled={printing || rows.length === 0} onClick={() => void printDayBook()}>
            <Printer className="mr-2 h-4 w-4" />
            {printing ? "Preparing…" : "Print"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9 pr-9"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search student, receipt / voucher no., description, vendor or amount"
              aria-label="Search day book"
            />
            {searchText ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                onClick={() => setSearchText("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <Select value={section} onChange={(e) => setSection(e.target.value as BankCashSectionKey | "")} aria-label="Section">
            <option value="">All sections</option>
            {(Object.keys(SECTION_LABEL) as BankCashSectionKey[]).map((key) => (
              <option key={key} value={key}>
                {SECTION_LABEL[key]}
              </option>
            ))}
          </Select>
          <Select value={cashBank} onChange={(e) => setCashBank(e.target.value)} aria-label="Cash or bank">
            <option value="">Cash and all banks</option>
            <option value="cash">Cash in Hand</option>
            <option value="bank">All banks</option>
            {banks.map((bank) => (
              <option key={bank._id} value={bank._id}>
                {bankLabel(bank)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              ["today", "Today"],
              ["month", "This month"],
              ["fiscal", "This fiscal year"],
              ["all", "All dates"],
              ["custom", "Custom"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={period === value ? "default" : "outline"}
              onClick={() => setPeriod(value)}
            >
              {label}
            </Button>
          ))}
          {period === "custom" ? (
            <>
              <FormField label="From (BS)">
                <NepaliDateField value={customFrom} onChange={setCustomFrom} />
              </FormField>
              <FormField label="To (BS)">
                <NepaliDateField value={customTo} onChange={setCustomTo} />
              </FormField>
            </>
          ) : null}
          {filtersActive ? (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {/* Double-entry check */}
        {integrity ? (
          integrity.isBalanced ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Books balanced</span>
              <span>
                — {integrity.voucherCount} voucher(s) in this period, total Debit {npr(integrity.totalDebitNpr)} = total Credit{" "}
                {npr(integrity.totalCreditNpr)}
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {integrity.unbalancedCount} voucher(s) where Debit ≠ Credit (difference {npr(integrity.differenceNpr)})
              </div>
              <p className="mt-1 text-xs">
                {integrity.unbalanced
                  .slice(0, 10)
                  .map((item) => `${item.voucherNumber} (${item.dateBs}, ${npr(item.differenceNpr)})`)
                  .join(", ")}
              </p>
            </div>
          )
        ) : null}

        {/* Register */}
        {registerQuery.isLoading ? (
          <LoadingState />
        ) : registerQuery.isError ? (
          <EmptyState title="Could not load the day book" description={parseErrorMessage(registerQuery.error)} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? `Nothing found for “${search}”` : "No entries in this period"}
            description={search ? "Try another name, number or amount, or widen the dates." : "Entries made in any section will appear here."}
          />
        ) : (
          <div id="bank-cash-daybook-print" className="space-y-2">
            <h3 className="hidden text-base font-semibold print:block">
              Day Book{range.from || range.to ? ` — ${range.from ?? "Beginning"} to ${range.to ?? "today"}` : ""}
            </h3>
            <div className="max-h-[640px] overflow-auto rounded-2xl border border-slate-200 print:max-h-none print:overflow-visible">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 print:static">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-8 px-2 py-2 print:hidden" />
                    <th className="w-32 px-2 py-2">Date</th>
                    <th className="w-48 px-2 py-2">Accounts</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="w-44 px-2 py-2">Cash / Bank</th>
                    <th className="w-32 px-2 py-2 text-right text-emerald-700">Debit</th>
                    <th className="w-32 px-2 py-2 text-right text-rose-700">Credit</th>
                    <th className="w-40 px-2 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const open = expanded === row.id;
                    const kind = sectionVoucherKind(row.sectionKey, row.debitNpr);
                    const tab = SECTION_TAB[row.sectionKey];
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={cn(
                            "cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50",
                            open && "bg-brand-50/50",
                            (row.isReversed || row.isReversal) && "text-slate-500",
                          )}
                          onClick={() => setExpanded(open ? null : row.id)}
                        >
                          <td className="px-2 py-2 text-slate-400 print:hidden">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2">
                            {row.dateBs}
                            <div className="text-xs text-slate-500">{row.voucherNumber}</div>
                          </td>
                          <td className="px-2 py-2">
                            <div>{row.account}</div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              <Badge className={KIND_TONE[kind]}>{kind}</Badge>
                              {row.isReversal ? <Badge className="bg-slate-100 text-slate-600">Reversal</Badge> : null}
                              {row.isReversed ? <Badge className="bg-slate-100 text-slate-600">Voided</Badge> : null}
                            </div>
                          </td>
                          <td className="px-2 py-2">{row.description}</td>
                          <td className="whitespace-nowrap px-2 py-2">{row.cashBank}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-emerald-800">{amount(row.debitNpr)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-rose-800">{amount(row.creditNpr)}</td>
                          <td className="px-2 py-2 text-xs text-slate-600">{row.remarks}</td>
                        </tr>
                        {open ? (
                          <tr className="bg-brand-50/30 print:hidden">
                            <td />
                            <td colSpan={7} className="px-2 pb-4 pt-1">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-slate-800">
                                    {kind} Voucher {row.voucherNumber}
                                    <span className="ml-2 font-normal text-slate-500">{row.dateBs}</span>
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {tab ? (
                                      <Button size="sm" variant="outline" onClick={() => onOpenSection(tab)}>
                                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                        Open {SECTION_LABEL[row.sectionKey]}
                                      </Button>
                                    ) : null}
                                    <Button size="sm" variant="outline" onClick={() => printVoucher(row)}>
                                      <Printer className="mr-1 h-3.5 w-3.5" />
                                      Print voucher
                                    </Button>
                                    {canManage && row.canVoid ? (
                                      voidingId === row.journalEntryId ? (
                                        <>
                                          <Button size="sm" variant="outline" onClick={() => setVoidingId(null)}>
                                            Keep
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="destructive"
                                            disabled={voidMutation.isPending}
                                            onClick={() => voidMutation.mutate(row.journalEntryId)}
                                          >
                                            {voidMutation.isPending ? "Voiding…" : "Confirm void"}
                                          </Button>
                                        </>
                                      ) : (
                                        <Button size="sm" variant="outline" onClick={() => setVoidingId(row.journalEntryId)}>
                                          Void transfer
                                        </Button>
                                      )
                                    ) : null}
                                  </div>
                                </div>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                      <th className="py-1">Account</th>
                                      <th className="py-1">Particulars</th>
                                      <th className="py-1 text-right">Debit</th>
                                      <th className="py-1 text-right">Credit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.voucherLines.map((line, index) => (
                                      <tr key={index} className="border-t border-slate-100">
                                        <td className="py-1 pr-2">{line.account}</td>
                                        <td className="py-1 pr-2 text-slate-600">{line.description}</td>
                                        <td className="py-1 text-right tabular-nums">{amount(line.debitNpr)}</td>
                                        <td className="py-1 text-right tabular-nums">{amount(line.creditNpr)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t border-slate-300 font-semibold">
                                      <td className="py-1" colSpan={2}>
                                        <span className="inline-flex items-center gap-1">
                                          {row.isBalanced ? (
                                            <>
                                              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Debit = Credit
                                            </>
                                          ) : (
                                            <>
                                              <AlertTriangle className="h-4 w-4 text-red-600" /> Not balanced
                                            </>
                                          )}
                                        </span>
                                      </td>
                                      <td className="py-1 text-right tabular-nums">{amount(row.voucherDebitNpr)}</td>
                                      <td className="py-1 text-right tabular-nums">{amount(row.voucherCreditNpr)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                                {!row.canVoid && tab ? (
                                  <p className="mt-2 text-xs text-slate-500">
                                    To edit or void this entry, open {SECTION_LABEL[row.sectionKey]} so its records stay in step.
                                  </p>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-50 print:static">
                  <tr className="border-t-2 border-slate-200 font-semibold">
                    <td className="print:hidden" />
                    <td colSpan={4} className="px-2 py-2">
                      Total — {first?.total ?? 0} entr{first?.total === 1 ? "y" : "ies"}
                      {rows.length < (first?.total ?? 0) ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">(showing {rows.length})</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-800">{amount(first?.totalDebitNpr ?? 0)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-800">{amount(first?.totalCreditNpr ?? 0)}</td>
                    <td className="px-2 py-2 text-xs font-normal text-slate-500">
                      Net {npr((first?.totalDebitNpr ?? 0) - (first?.totalCreditNpr ?? 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {registerQuery.hasNextPage ? (
              <div className="flex justify-center print:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={registerQuery.isFetchingNextPage}
                  onClick={() => void registerQuery.fetchNextPage()}
                >
                  {registerQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
