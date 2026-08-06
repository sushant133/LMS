import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface ReconciliationItem {
  journalEntryId: string;
  dateBs: string;
  voucherNumber: string;
  narration: string;
  debitNpr: number;
  creditNpr: number;
  cleared: boolean;
}

interface ReconciliationView {
  accountCode: string;
  statementDateBs: string;
  statementBalanceNpr: number;
  items: ReconciliationItem[];
  ledgerBalanceNpr: number;
  unpresentedChequesNpr: number;
  depositsInTransitNpr: number;
  adjustedBalanceNpr: number;
  differenceNpr: number;
  isReconciled: boolean;
  clearedCount: number;
  unclearedCount: number;
}

const npr = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `NPR ${Number(value).toLocaleString("en-NP")}`;

export const BankReconciliationPanel = ({ canWrite }: { canWrite: boolean }) => {
  const [statementDateBs, setStatementDateBs] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [fromDateBs, setFromDateBs] = useState("");
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  const previewQuery = useQuery({
    queryKey: ["bank-reconciliation-preview", statementDateBs, statementBalance, fromDateBs],
    queryFn: () =>
      unwrap<ReconciliationView>(
        api.get("/accounting/reconciliations/preview", {
          params: {
            statementDateBs,
            statementBalanceNpr: Number(statementBalance || 0),
            fromDateBs: fromDateBs || undefined,
          },
        }),
      ),
    enabled: statementDateBs.trim().length > 0,
  });

  const historyQuery = useQuery({
    queryKey: ["bank-reconciliations"],
    queryFn: () => unwrap<Array<Record<string, unknown>>>(api.get("/accounting/reconciliations")),
  });

  // Seed the tick list from whatever a previous reconciliation already settled.
  useEffect(() => {
    if (!previewQuery.data) return;
    setCleared(
      new Set(previewQuery.data.items.filter((i) => i.cleared).map((i) => i.journalEntryId)),
    );
  }, [previewQuery.data]);

  const items = previewQuery.data?.items ?? [];

  /**
   * Recompute the reconciliation locally as boxes are ticked, so the figures respond
   * immediately instead of waiting on a round trip per click.
   */
  const live = useMemo(() => {
    const base = previewQuery.data;
    if (!base) return null;
    const uncleared = items.filter((i) => !cleared.has(i.journalEntryId));
    const unpresentedChequesNpr = uncleared.reduce((s, i) => s + i.creditNpr, 0);
    const depositsInTransitNpr = uncleared.reduce((s, i) => s + i.debitNpr, 0);
    const adjustedBalanceNpr =
      base.ledgerBalanceNpr - depositsInTransitNpr + unpresentedChequesNpr;
    const differenceNpr = adjustedBalanceNpr - Number(statementBalance || 0);
    return {
      unpresentedChequesNpr,
      depositsInTransitNpr,
      adjustedBalanceNpr,
      differenceNpr,
      isReconciled: Math.abs(differenceNpr) < 0.01,
      unclearedCount: uncleared.length,
    };
  }, [previewQuery.data, items, cleared, statementBalance]);

  const save = useMutation({
    mutationFn: (status: "DRAFT" | "COMPLETED") =>
      unwrap(
        api.post("/accounting/reconciliations", {
          statementDateBs,
          statementBalanceNpr: Number(statementBalance || 0),
          fromDateBs: fromDateBs || undefined,
          clearedEntryIds: Array.from(cleared),
          notes,
          status,
        }),
      ),
    onSuccess: async (_data, status) => {
      toast.success(status === "COMPLETED" ? "Reconciliation completed" : "Reconciliation saved");
      await historyQuery.refetch();
    },
    onError: (error) => toast.error(parseErrorMessage(error) || "Could not save reconciliation"),
  });

  const toggle = (id: string) => {
    setCleared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setCleared((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.journalEntryId)),
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bank Reconciliation</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Tick every transaction that appears on the bank statement. Anything left
            unticked is treated as an unpresented cheque or a deposit in transit.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <FormField label="Statement date (BS)">
              <NepaliDateField value={statementDateBs} onChange={setStatementDateBs} />
            </FormField>
            <FormField label="Closing balance on statement (NPR)">
              <Input
                type="number"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
              />
            </FormField>
            <FormField label="List transactions from (BS, optional)">
              <NepaliDateField value={fromDateBs} onChange={setFromDateBs} />
            </FormField>
          </div>

          {previewQuery.isFetching ? <LoadingState /> : null}

          {previewQuery.data && live ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Balance as per ledger" value={npr(previewQuery.data.ledgerBalanceNpr)} />
                <Stat label="Less: deposits in transit" value={npr(live.depositsInTransitNpr)} />
                <Stat label="Add: unpresented cheques" value={npr(live.unpresentedChequesNpr)} />
                <Stat label="Expected statement balance" value={npr(live.adjustedBalanceNpr)} />
              </div>

              <div
                className={
                  live.isReconciled
                    ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                    : "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                }
              >
                {live.isReconciled ? (
                  <>Reconciled — ledger agrees with the statement.</>
                ) : (
                  <>
                    Difference of {npr(live.differenceNpr)} remains. {live.unclearedCount}{" "}
                    transaction(s) still unticked. A residual difference usually means bank
                    charges or interest that have not been journalled yet.
                  </>
                )}
              </div>

              {items.length === 0 ? (
                <EmptyState
                  title="No bank transactions"
                  description="Nothing was posted to the bank account up to this statement date."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th className="w-10">
                          <input
                            type="checkbox"
                            checked={cleared.size === items.length && items.length > 0}
                            onChange={toggleAll}
                            aria-label="Toggle all"
                          />
                        </Th>
                        <Th>Date (BS)</Th>
                        <Th>Voucher</Th>
                        <Th>Narration</Th>
                        <Th className="text-right">Deposit</Th>
                        <Th className="text-right">Withdrawal</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {items.map((item) => (
                        <tr key={item.journalEntryId}>
                          <Td>
                            <input
                              type="checkbox"
                              checked={cleared.has(item.journalEntryId)}
                              onChange={() => toggle(item.journalEntryId)}
                              aria-label={`Mark ${item.voucherNumber} cleared`}
                            />
                          </Td>
                          <Td>{item.dateBs}</Td>
                          <Td className="font-mono text-xs">{item.voucherNumber}</Td>
                          <Td>{item.narration}</Td>
                          <Td className="text-right">
                            {item.debitNpr > 0 ? npr(item.debitNpr) : "—"}
                          </Td>
                          <Td className="text-right">
                            {item.creditNpr > 0 ? npr(item.creditNpr) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <FormField label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </FormField>

              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => save.mutate("DRAFT")} disabled={save.isPending}>
                    Save draft
                  </Button>
                  <Button
                    onClick={() => save.mutate("COMPLETED")}
                    disabled={save.isPending || !live.isReconciled}
                    title={live.isReconciled ? undefined : "Clear the remaining difference first"}
                  >
                    Complete reconciliation
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {(historyQuery.data?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation history</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Statement date</Th>
                  <Th className="text-right">Statement balance</Th>
                  <Th className="text-right">Ledger balance</Th>
                  <Th className="text-right">Difference</Th>
                  <Th>Status</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(historyQuery.data ?? []).map((row) => (
                  <tr key={String(row._id)}>
                    <Td>{String(row.statementDateBs)}</Td>
                    <Td className="text-right">{npr(Number(row.statementBalanceNpr))}</Td>
                    <Td className="text-right">{npr(Number(row.ledgerBalanceNpr))}</Td>
                    <Td className="text-right">{npr(Number(row.differenceNpr))}</Td>
                    <Td>{String(row.status)}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
  </div>
);
