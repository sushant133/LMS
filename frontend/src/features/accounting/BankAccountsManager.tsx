import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { BankAccountRecord, BankCashSummary } from "@phit-erp/shared";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { api, unwrap } from "lib/api";
import { scrollToForm } from "lib/scrollToForm";
import { parseErrorMessage } from "lib/utils";
import { npr } from "./bankCashShared";
import { invalidateAccountingQueries } from "./invalidateAccountingQueries";
import { BankCashSectionTitle } from "./BankCashSectionTitle";

const emptyBank = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  branch: "",
  openingBalanceNpr: undefined as number | undefined,
};

interface BankAccountsManagerProps {
  banks: BankAccountRecord[];
  summary?: BankCashSummary;
  canManage: boolean;
  /** Open Bank Reconciliation for this bank. */
  onReconcile: (bankAccountId: string) => void;
}

/** Bank accounts with their balances; administrators add, edit, deactivate. */
export const BankAccountsManager = ({ banks, summary, canManage, onReconcile }: BankAccountsManagerProps) => {
  const [form, setForm] = useState(emptyBank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        bankName: form.bankName.trim(),
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber.trim(),
        branch: form.branch.trim(),
        openingBalanceNpr: form.openingBalanceNpr ?? 0,
      };
      return editingId
        ? unwrap(api.put(`/accounting/bank-accounts/${editingId}`, payload))
        : unwrap(api.post("/accounting/bank-accounts", payload));
    },
    onSuccess: async () => {
      toast.success(editingId ? "Bank account updated" : "Bank account added");
      setForm(emptyBank);
      setEditingId(null);
      setShowForm(false);
      await invalidateAccountingQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: (bank: BankAccountRecord) =>
      bank.isActive
        ? unwrap(api.delete(`/accounting/bank-accounts/${bank._id}`))
        : unwrap(api.put(`/accounting/bank-accounts/${bank._id}`, { isActive: true })),
    onSuccess: async (_data, bank) => {
      toast.success(bank.isActive ? "Bank account deactivated" : "Bank account activated");
      await invalidateAccountingQueries();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const startEdit = (bank: BankAccountRecord) => {
    setEditingId(bank._id);
    setForm({
      bankName: bank.bankName,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      branch: bank.branch ?? "",
      openingBalanceNpr: bank.openingBalanceNpr || undefined,
    });
    setShowForm(true);
    scrollToForm("bank-account-form");
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyBank);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <BankCashSectionTitle
              icon={Building2}
              title="Bank Accounts"
              subtitle="Each bank's balance and reconciliation status."
              tone="amber"
            />
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant={showForm && !editingId ? "outline" : "default"}
              onClick={() => {
                if (showForm && !editingId) {
                  closeForm();
                  return;
                }
                setEditingId(null);
                setForm(emptyBank);
                setShowForm(true);
                scrollToForm("bank-account-form");
              }}
            >
              {showForm && !editingId ? "Close" : "Add Bank Account"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && showForm ? (
          <form
            id="bank-account-form"
            className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <FormField label="Bank Name">
              <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. NIC Asia Bank" required />
            </FormField>
            <FormField label="Account Name">
              <Input value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required />
            </FormField>
            <FormField label="Account Number">
              <Input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
            </FormField>
            <FormField label="Branch">
              <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </FormField>
            <FormField label="Opening Balance (NPR)">
              <NumberInput value={form.openingBalanceNpr} onValueChange={(value) => setForm({ ...form, openingBalanceNpr: value })} />
            </FormField>
            <div className="flex flex-wrap justify-end gap-2 md:col-span-2 xl:col-span-5">
              <Button type="button" variant="outline" size="sm" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editingId ? "Update Bank Account" : "Save Bank Account"}
              </Button>
            </div>
          </form>
        ) : null}

        {(summary?.banks.length ?? 0) === 0 ? (
          <EmptyState
            title="No bank accounts yet"
            description={canManage ? "Add the college's bank accounts so entries can be made to each bank." : "No bank accounts have been added."}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Bank</th>
                  <th className="px-3 py-2 text-right">Opening</th>
                  <th className="px-3 py-2 text-right">Receipts</th>
                  <th className="px-3 py-2 text-right">Payments</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Last reconciled</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summary!.banks.map((row) => {
                  const bank = banks.find((item) => item._id === row.bankAccountId);
                  return (
                    <tr key={row.bankAccountId} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.bankName}</div>
                        <div className="text-xs text-slate-500">
                          {row.accountName} · {row.accountNumber}
                          {row.branch ? ` · ${row.branch}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{npr(row.openingBalanceNpr)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{npr(row.receiptsNpr)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700">{npr(row.paymentsNpr)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{npr(row.balanceNpr)}</td>
                      <td className="px-3 py-2">
                        {row.lastReconciledBs ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="tabular-nums">{row.lastReconciledBs}</span>
                            <Badge
                              className={
                                row.lastReconciliationStatus === "COMPLETED"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              }
                            >
                              {row.lastReconciliationStatus === "COMPLETED" ? "Reconciled" : "Draft"}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Never</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge className={row.isActive ? undefined : "bg-slate-100 text-slate-600"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {row.isActive ? (
                            <Button size="sm" variant="outline" onClick={() => onReconcile(row.bankAccountId)}>
                              Reconcile
                            </Button>
                          ) : null}
                          {canManage && bank ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => startEdit(bank)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate(bank)}>
                                {bank.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {summary && Math.abs(summary.unlinkedBankNpr) >= 0.01 ? (
          <p className="text-xs text-slate-500">
            {npr(summary.unlinkedBankNpr)} of the bank balance was recorded without choosing a specific bank account (older
            entries), so it is counted in Bank Balance but not under any bank above.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
