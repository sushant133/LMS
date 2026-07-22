import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  chartOfAccountSchema,
  type ChartOfAccountInput,
  type ChartOfAccountRecord,
  type JournalEntryRecord,
} from "@phit-erp/shared";
import { Pencil, Plus, Power } from "lucide-react";
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
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultForm: ChartOfAccountInput = {
  code: "",
  name: "",
  nameNp: "",
  accountType: "EXPENSE",
  parentCode: "",
  description: "",
  isActive: true,
};

const typeLabel: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

export const ChartOfAccountsPanel = ({ isAdmin }: { isAdmin: boolean }) => {
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () =>
      unwrap<ChartOfAccountRecord[]>(api.get("/accounting/chart-of-accounts")),
  });

  const journalsQuery = useQuery({
    queryKey: ["accounting-journal-entries"],
    queryFn: () =>
      unwrap<JournalEntryRecord[]>(api.get("/accounting/journal-entries")),
    enabled: isAdmin,
  });

  const codesWithTx = useMemo(() => {
    const set = new Set<string>();
    for (const je of journalsQuery.data ?? []) {
      for (const line of je.lines ?? []) {
        set.add(line.accountCode);
      }
    }
    return set;
  }, [journalsQuery.data]);

  const seed = useMutation({
    mutationFn: () => unwrap(api.post("/accounting/chart-of-accounts/seed")),
    onSuccess: async () => {
      toast.success("Default chart of accounts seeded / updated");
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-journal-entries"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const create = useMutation({
    mutationFn: (payload: ChartOfAccountInput) =>
      unwrap(api.post("/accounting/chart-of-accounts", payload)),
    onSuccess: async () => {
      toast.success("Ledger account created");
      setForm(defaultForm);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-journal-entries"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<ChartOfAccountInput>;
    }) => unwrap(api.put(`/accounting/chart-of-accounts/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Ledger account updated");
      setForm(defaultForm);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-journal-entries"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accountsQuery.data ?? []).filter((a) => {
      if (typeFilter && a.accountType !== typeFilter) return false;
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.nameNp ?? "").toLowerCase().includes(q)
      );
    });
  }, [accountsQuery.data, search, typeFilter]);

  const startEdit = (account: ChartOfAccountRecord) => {
    setEditingId(account._id);
    setForm({
      code: account.code,
      name: account.name,
      nameNp: account.nameNp ?? "",
      accountType: account.accountType,
      parentCode: account.parentCode ?? "",
      description: account.description ?? "",
      isActive: account.isActive !== false,
    });
  };

  const toggleActive = (account: ChartOfAccountRecord) => {
    if (account.isSystem && account.isActive !== false) {
      // Allow disable of system for rare cases? Spec: disable yes, delete no if tx.
      // System accounts can be disabled but not code-changed.
    }
    void update.mutateAsync({
      id: account._id,
      payload: { isActive: account.isActive === false },
    });
  };

  if (accountsQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{editingId ? "Edit Ledger" : "Add Ledger"}</CardTitle>
            <Button
              variant="outline"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
            >
              Seed / Refresh Default COA
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = chartOfAccountSchema.safeParse(form);
                if (!parsed.success) {
                  return toast.error(
                    parsed.error.issues[0]?.message ?? "Invalid account",
                  );
                }
                if (editingId) {
                  void update.mutateAsync({
                    id: editingId,
                    payload: parsed.data,
                  });
                } else {
                  void create.mutateAsync(parsed.data);
                }
              }}
            >
              <FormField label="Code">
                <Input
                  value={form.code}
                  disabled={Boolean(editingId)}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, code: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Name">
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, name: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Type / Group">
                <Select
                  value={form.accountType}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      accountType: e.target
                        .value as ChartOfAccountInput["accountType"],
                    }))
                  }
                >
                  <option value="ASSET">Asset</option>
                  <option value="LIABILITY">Liability</option>
                  <option value="EQUITY">Equity</option>
                  <option value="INCOME">Income</option>
                  <option value="EXPENSE">Expense</option>
                </Select>
              </FormField>
              <FormField label="Name (Nepali)">
                <Input
                  value={form.nameNp ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, nameNp: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Parent Code">
                <Input
                  value={form.parentCode ?? ""}
                  placeholder="e.g. 5000"
                  onChange={(e) =>
                    setForm((c) => ({ ...c, parentCode: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Description">
                <Input
                  value={form.description ?? ""}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, description: e.target.value }))
                  }
                />
              </FormField>
              <div className="flex gap-2 md:col-span-3">
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setForm(defaultForm);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={create.isPending || update.isPending}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {editingId ? "Update Ledger" : "Add Ledger"}
                </Button>
              </div>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Deletion is not available when transactions exist. Use Disable to
              hide a ledger without losing history. System accounts keep their
              codes.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Chart of Accounts</CardTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FormField label="Search">
              <Input
                placeholder="Code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FormField>
            <FormField label="Group">
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All groups</option>
                <option value="ASSET">Assets</option>
                <option value="LIABILITY">Liabilities</option>
                <option value="EQUITY">Equity</option>
                <option value="INCOME">Income</option>
                <option value="EXPENSE">Expenses</option>
              </Select>
            </FormField>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              title="No accounts"
              description="Seed the default chart of accounts to get started."
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Code</Th>
                  <Th>Ledger Name</Th>
                  <Th>Group</Th>
                  <Th>Parent</Th>
                  <Th>Status</Th>
                  <Th>Tx</Th>
                  {isAdmin ? <Th /> : null}
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((account) => {
                  const hasTx = codesWithTx.has(account.code);
                  return (
                    <tr key={account._id}>
                      <Td className="font-mono">{account.code}</Td>
                      <Td>
                        <div className="font-medium">{account.name}</div>
                        {account.nameNp ? (
                          <div className="text-xs text-slate-500">
                            {account.nameNp}
                          </div>
                        ) : null}
                      </Td>
                      <Td>{typeLabel[account.accountType] ?? account.accountType}</Td>
                      <Td>{account.parentCode ?? "—"}</Td>
                      <Td>
                        <Badge
                          className={
                            account.isActive !== false
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {account.isActive !== false ? "Active" : "Disabled"}
                        </Badge>
                        {account.isSystem ? (
                          <span className="ml-1 text-xs text-slate-400">
                            system
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-slate-500">
                        {hasTx ? "Has transactions" : "—"}
                      </Td>
                      {isAdmin ? (
                        <Td>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(account)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleActive(account)}
                              title={
                                account.isActive !== false
                                  ? "Disable ledger"
                                  : "Enable ledger"
                              }
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
