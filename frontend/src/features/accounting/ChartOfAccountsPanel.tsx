import { useMutation, useQuery } from "@tanstack/react-query";
import { chartOfAccountSchema, type ChartOfAccountInput, type ChartOfAccountRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useState } from "react";

const defaultForm: ChartOfAccountInput = {
  code: "",
  name: "",
  nameNp: "",
  accountType: "EXPENSE",
  parentCode: "",
  description: "",
  isActive: true
};

export const ChartOfAccountsPanel = ({ isAdmin }: { isAdmin: boolean }) => {
  const [form, setForm] = useState(defaultForm);

  const accountsQuery = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => unwrap<ChartOfAccountRecord[]>(api.get("/accounting/chart-of-accounts"))
  });

  const seed = useMutation({
    mutationFn: () => unwrap(api.post("/accounting/chart-of-accounts/seed")),
    onSuccess: async () => {
      toast.success("Default chart of accounts seeded");
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const create = useMutation({
    mutationFn: (payload: ChartOfAccountInput) => unwrap(api.post("/accounting/chart-of-accounts", payload)),
    onSuccess: async () => {
      toast.success("Account created");
      setForm(defaultForm);
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  if (accountsQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Add Account</CardTitle>
            <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              Seed Default COA
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = chartOfAccountSchema.safeParse(form);
                if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid account");
                void create.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Code"><Input value={form.code} onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))} /></FormField>
              <FormField label="Name"><Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} /></FormField>
              <FormField label="Type">
                <Select value={form.accountType} onChange={(e) => setForm((c) => ({ ...c, accountType: e.target.value as ChartOfAccountInput["accountType"] }))}>
                  <option value="ASSET">Asset</option>
                  <option value="LIABILITY">Liability</option>
                  <option value="EQUITY">Equity</option>
                  <option value="INCOME">Income</option>
                  <option value="EXPENSE">Expense</option>
                </Select>
              </FormField>
              <div className="md:col-span-3"><Button type="submit" disabled={create.isPending}>Add Account</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Chart of Accounts</CardTitle></CardHeader>
        <CardContent>
          {(accountsQuery.data ?? []).length === 0 ? (
            <EmptyState title="No accounts" description="Seed the default chart of accounts to get started." />
          ) : (
            <Table>
              <TableHead>
                <tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th>Parent</Th><Th>Status</Th></tr>
              </TableHead>
              <TableBody>
                {(accountsQuery.data ?? []).map((account) => (
                  <tr key={account._id}>
                    <Td className="font-mono">{account.code}</Td>
                    <Td>{account.name}</Td>
                    <Td>{account.accountType}</Td>
                    <Td>{account.parentCode ?? "—"}</Td>
                    <Td>{account.isActive ? "Active" : "Inactive"}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};