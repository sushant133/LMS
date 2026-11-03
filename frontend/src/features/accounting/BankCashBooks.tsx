import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BankAccountRecord, BankCashBookResponse } from "@phit-erp/shared";
import { Landmark, Printer } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader } from "components/ui/card";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import { getPdfErrorMessage, printElementById } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";
import { amount, bankLabel, monthStartBs, npr, todayBs } from "./bankCashShared";
import { BankCashSectionTitle } from "./BankCashSectionTitle";

/** Cash Book / Bank Book: opening, receipts, payments, running and closing balance. */
export const BankCashBooks = ({
  banks,
  onReconcile,
  initialBookKey = "cash",
}: {
  banks: BankAccountRecord[];
  /** Book to open with: "cash", "bank" or a bank account id. */
  initialBookKey?: string;
  /** Open Bank Reconciliation for this bank. */
  onReconcile: (bankAccountId: string) => void;
}) => {
  const [bookKey, setBookKey] = useState(initialBookKey);
  const [from, setFrom] = useState(monthStartBs);
  const [to, setTo] = useState(todayBs);
  const params =
    bookKey === "cash" ? { book: "cash" } : bookKey === "bank" ? { book: "bank" } : { book: "bank", bankAccountId: bookKey };

  const bookQuery = useQuery({
    queryKey: ["accounting-bank-cash", "book", bookKey, from, to],
    queryFn: () =>
      unwrap<BankCashBookResponse>(
        api.get("/accounting/bank-cash/book", {
          params: { ...params, fromDateBs: from || undefined, toDateBs: to || undefined },
        }),
      ),
  });

  const [printing, setPrinting] = useState(false);
  const print = async () => {
    setPrinting(true);
    try {
      await printElementById("bank-cash-book-print", bookQuery.data?.title, "a4-portrait");
    } catch (error) {
      toast.error(getPdfErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  const book = bookQuery.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <BankCashSectionTitle
              icon={Landmark}
              title="Cash Book / Bank Book"
              subtitle="Opening balance, receipts, payments and closing balance for any period."
              tone="sky"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {bookKey !== "cash" && bookKey !== "bank" ? (
              <Button size="sm" variant="outline" onClick={() => onReconcile(bookKey)}>
                Reconcile this bank
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={printing || !book} onClick={() => void print()}>
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Preparing…" : "Print"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Book">
            <Select value={bookKey} onChange={(e) => setBookKey(e.target.value)}>
              <option value="cash">Cash Book</option>
              <option value="bank">Bank Book — all bank accounts</option>
              {banks.map((bank) => (
                <option key={bank._id} value={bank._id}>
                  Bank Book — {bankLabel(bank)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="From (BS)">
            <NepaliDateField value={from} onChange={setFrom} />
          </FormField>
          <FormField label="To (BS)">
            <NepaliDateField value={to} onChange={setTo} />
          </FormField>
        </div>

        {book ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Opening", value: book.openingNpr, tone: "text-slate-900" },
              { label: "Receipts", value: book.totalReceiptsNpr, tone: "text-emerald-700" },
              { label: "Payments", value: book.totalPaymentsNpr, tone: "text-rose-700" },
              { label: "Closing", value: book.closingNpr, tone: "text-brand-700" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-slate-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${stat.tone}`}>{npr(stat.value)}</p>
              </div>
            ))}
          </div>
        ) : null}

        {bookQuery.isLoading ? (
          <LoadingState />
        ) : bookQuery.isError ? (
          <EmptyState title="Could not load the book" description={parseErrorMessage(bookQuery.error)} />
        ) : book ? (
          <div id="bank-cash-book-print" className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{book.title}</h3>
              <p className="text-xs text-slate-500">
                {from || to ? `${from || "Beginning"} to ${to || "today"}` : "All dates"}
              </p>
            </div>
            <div className="max-h-[640px] overflow-auto rounded-2xl border border-slate-200 print:max-h-none print:overflow-visible">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50 print:static">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-28 px-3 py-2">Date</th>
                    <th className="w-32 px-3 py-2">Voucher</th>
                    <th className="px-3 py-2">Particulars</th>
                    <th className="w-32 px-3 py-2 text-right">Receipts</th>
                    <th className="w-32 px-3 py-2 text-right">Payments</th>
                    <th className="w-36 px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {book.rows.map((row, index) => (
                    <tr key={`${row.voucherNumber}-${index}`} className={row.isOpening ? "bg-slate-50 font-medium" : "border-t border-slate-100"}>
                      <td className="whitespace-nowrap px-3 py-1.5">{row.dateBs}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">{row.voucherNumber}</td>
                      <td className="px-3 py-1.5">{row.narration}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-800">{amount(row.receiptNpr)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-800">{amount(row.paymentNpr)}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{amount(row.balanceNpr) || "0.00"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td colSpan={3} className="px-3 py-2">Total / Closing Balance</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(book.totalReceiptsNpr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(book.totalPaymentsNpr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(book.closingNpr) || "0.00"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
