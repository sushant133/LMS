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
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface ChartAccount {
  _id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface VarianceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  budgetedNpr: number;
  actualNpr: number;
  varianceNpr: number;
  variancePercent: number | null;
  status: string;
}

interface VarianceResponse {
  fiscalYearBs: string;
  hasBudget: boolean;
  budgetStatus: string | null;
  rows: VarianceRow[];
  totals: {
    incomeBudgetedNpr: number;
    incomeActualNpr: number;
    expenseBudgetedNpr: number;
    expenseActualNpr: number;
    budgetedSurplusNpr: number;
    actualSurplusNpr: number;
    unbudgetedCount: number;
    overBudgetCount: number;
  };
}

const npr = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `NPR ${Number(value).toLocaleString("en-NP")}`;

export const BudgetPanel = ({ isAdmin }: { isAdmin: boolean }) => {
  const [fiscalYearBs, setFiscalYearBs] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const accountsQuery = useQuery({
    queryKey: ["chart-of-accounts-budget"],
    queryFn: () => unwrap<ChartAccount[]>(api.get("/accounting/chart-of-accounts")),
  });

  const budgetsQuery = useQuery({
    queryKey: ["budgets"],
    queryFn: () => unwrap<Array<Record<string, unknown>>>(api.get("/accounting/budgets")),
  });

  const varianceQuery = useQuery({
    queryKey: ["budget-variance", fiscalYearBs],
    queryFn: () =>
      unwrap<VarianceResponse>(
        api.get("/accounting/budgets/variance", { params: { fiscalYearBs } }),
      ),
    enabled: fiscalYearBs.trim().length > 0,
  });

  // Only income and expense accounts are budgeted — a balance sheet account has no annual plan.
  const budgetableAccounts = useMemo(
    () =>
      (accountsQuery.data ?? [])
        .filter((a) => a.accountType === "INCOME" || a.accountType === "EXPENSE")
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accountsQuery.data],
  );

  // Load the saved budget for the selected year into the editable grid.
  useEffect(() => {
    if (!fiscalYearBs.trim()) return;
    const existing = (budgetsQuery.data ?? []).find(
      (b) => String(b.fiscalYearBs) === fiscalYearBs,
    );
    const lines = (existing?.lines ?? []) as Array<{ accountCode: string; budgetedNpr: number }>;
    const next: Record<string, string> = {};
    for (const line of lines) next[line.accountCode] = String(line.budgetedNpr ?? 0);
    setDrafts(next);
  }, [fiscalYearBs, budgetsQuery.data]);

  const save = useMutation({
    mutationFn: (status: "DRAFT" | "APPROVED") =>
      unwrap(
        api.post("/accounting/budgets", {
          fiscalYearBs,
          status,
          lines: budgetableAccounts
            .map((account) => ({
              accountCode: account.code,
              accountName: account.name,
              budgetedNpr: Number(drafts[account.code] || 0),
            }))
            .filter((line) => line.budgetedNpr > 0),
        }),
      ),
    onSuccess: async (_data, status) => {
      toast.success(status === "APPROVED" ? "Budget approved" : "Budget saved");
      await Promise.all([budgetsQuery.refetch(), varianceQuery.refetch()]);
    },
    onError: (error) => toast.error(parseErrorMessage(error) || "Could not save budget"),
  });

  const variance = varianceQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Budget</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Set an annual figure per income and expense account. Budgets are never posted to
            the ledger — they are compared against actuals at read time.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <FormField label="Fiscal year (BS)">
              <Input
                value={fiscalYearBs}
                onChange={(e) => setFiscalYearBs(e.target.value)}
                placeholder="2083/2084"
              />
            </FormField>
          </div>

          {!fiscalYearBs.trim() ? (
            <EmptyState
              title="Choose a fiscal year"
              description="Enter a fiscal year such as 2083/2084 to plan or review its budget."
            />
          ) : accountsQuery.isLoading ? (
            <LoadingState />
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto rounded-2xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Code</Th>
                      <Th>Account</Th>
                      <Th>Type</Th>
                      <Th className="text-right">Budget (NPR)</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {budgetableAccounts.map((account) => (
                      <tr key={account._id}>
                        <Td className="font-mono text-xs">{account.code}</Td>
                        <Td>{account.name}</Td>
                        <Td className="text-xs text-slate-500">{account.accountType}</Td>
                        <Td className="text-right">
                          <Input
                            type="number"
                            className="ml-auto max-w-40 text-right"
                            value={drafts[account.code] ?? ""}
                            onChange={(e) =>
                              setDrafts({ ...drafts, [account.code]: e.target.value })
                            }
                            disabled={!isAdmin}
                            placeholder="0"
                          />
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {isAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => save.mutate("DRAFT")} disabled={save.isPending}>
                    Save draft
                  </Button>
                  <Button onClick={() => save.mutate("APPROVED")} disabled={save.isPending}>
                    Approve budget
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {variance ? (
        <Card>
          <CardHeader>
            <CardTitle>Budget vs Actual — FY {variance.fiscalYearBs}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Positive variance is favourable: earning above plan, or spending below it.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Income budgeted" value={npr(variance.totals.incomeBudgetedNpr)} />
              <Stat label="Income actual" value={npr(variance.totals.incomeActualNpr)} />
              <Stat label="Expenditure budgeted" value={npr(variance.totals.expenseBudgetedNpr)} />
              <Stat label="Expenditure actual" value={npr(variance.totals.expenseActualNpr)} />
            </div>

            {variance.totals.unbudgetedCount > 0 || variance.totals.overBudgetCount > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {variance.totals.overBudgetCount} account(s) over budget ·{" "}
                {variance.totals.unbudgetedCount} account(s) with spend but no budget.
              </div>
            ) : null}

            {variance.rows.length === 0 ? (
              <EmptyState
                title="No activity"
                description="No budget figures or actual postings for this fiscal year."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Code</Th>
                      <Th>Account</Th>
                      <Th>Type</Th>
                      <Th className="text-right">Budget</Th>
                      <Th className="text-right">Actual</Th>
                      <Th className="text-right">Variance</Th>
                      <Th className="text-right">%</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {variance.rows.map((row) => (
                      <tr key={row.accountCode}>
                        <Td className="font-mono text-xs">{row.accountCode}</Td>
                        <Td>{row.accountName}</Td>
                        <Td className="text-xs text-slate-500">{row.accountType}</Td>
                        <Td className="text-right">{npr(row.budgetedNpr)}</Td>
                        <Td className="text-right">{npr(row.actualNpr)}</Td>
                        <Td
                          className={
                            row.varianceNpr < 0
                              ? "text-right font-medium text-rose-600"
                              : "text-right font-medium text-emerald-700"
                          }
                        >
                          {npr(row.varianceNpr)}
                        </Td>
                        <Td className="text-right">
                          {row.variancePercent === null ? "—" : `${row.variancePercent}%`}
                        </Td>
                        <Td className="text-xs">{row.status}</Td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <Td colSpan={3}>SURPLUS / (DEFICIT)</Td>
                      <Td className="text-right">{npr(variance.totals.budgetedSurplusNpr)}</Td>
                      <Td className="text-right">{npr(variance.totals.actualSurplusNpr)}</Td>
                      <Td className="text-right">
                        {npr(variance.totals.actualSurplusNpr - variance.totals.budgetedSurplusNpr)}
                      </Td>
                      <Td colSpan={2} />
                    </tr>
                  </TableBody>
                </Table>
              </div>
            )}
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
