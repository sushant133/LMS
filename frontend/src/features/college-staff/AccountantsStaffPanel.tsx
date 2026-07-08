import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { accountantSchema, type AccountantInput, type AccountantRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  toastResendCredentials,
  type CredentialsEmailResult
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultAccountant: AccountantInput = {
  fullName: "",
  email: "",
  phone: "",
  employeeId: "",
  gender: "Male",
  address: { province: "", district: "", municipality: "", ward: "", streetAddress: "" },
  joinedDateBs: "",
  status: "ACTIVE"
};

export const AccountantsStaffPanel = () => {
  const [form, setForm] = useState<AccountantInput>(defaultAccountant);
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<AccountantRecord | null>(null);

  const accountantsQuery = useQuery({
    queryKey: ["accounting-accountants"],
    queryFn: () => unwrap<AccountantRecord[]>(api.get("/accounting/accountants"))
  });

  const saveAccountant = useMutation({
    mutationFn: (payload: AccountantInput) =>
      editing
        ? unwrap(api.put(`/accounting/accountants/${editing._id}`, payload))
        : unwrap<{
            accountant: AccountantRecord;
            loginEmail: string;
            defaultPassword: string;
            credentialsEmail?: CredentialsEmailResult;
          }>(api.post("/accounting/accountants", payload)),
    onSuccess: async (data) => {
      if (editing) {
        toast.success("Accountant updated");
      } else {
        toastCredentialCreateResult(
          (data as { loginEmail?: string; defaultPassword?: string; credentialsEmail?: CredentialsEmailResult }) ?? {},
          { successTitle: "Accountant created successfully" }
        );
      }
      setForm(defaultAccountant);
      setPassword("");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["accounting-accountants"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deactivateAccountant = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/accounting/accountants/${id}`)),
    onSuccess: async () => {
      toast.success("Accountant deactivated");
      await queryClient.invalidateQueries({ queryKey: ["accounting-accountants"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const resendCredentials = useMutation({
    mutationFn: (userId: string) => toastResendCredentials(userId)
  });

  if (accountantsQuery.isLoading) {
    return <EmptyState title="Loading accountants" description="Please wait." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? "Edit Accountant" : "Create Accountant"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <FormField label="Full Name">
            <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          </FormField>
          <FormField label="Employee ID">
            <Input value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))} />
          </FormField>
          <FormField label="Login ID">
            <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </FormField>
          <FormField label="Phone">
            <Input value={form.phone ?? ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </FormField>
          <FormField label="Password">
            <Input type="password" value={password} placeholder="Leave blank for default password" onChange={(event) => setPassword(event.target.value)} />
          </FormField>
          <FormField label="Gender">
            <Select value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
          </FormField>
          <FormField label="Joining Date">
            <NepaliDateField value={form.joinedDateBs} onChange={(value) => setForm((current) => ({ ...current, joinedDateBs: value }))} />
          </FormField>
          <FormField label="Status">
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AccountantInput["status"] }))}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </FormField>
          <div className="md:col-span-2">
            <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />
          </div>
          <div className="flex gap-2 md:col-span-2">
            {editing ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setForm(defaultAccountant);
                  setPassword("");
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              onClick={() => {
                const parsed = accountantSchema.safeParse({ ...form, password: password.trim() || undefined });
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Invalid accountant");
                  return;
                }
                void saveAccountant.mutateAsync(parsed.data);
              }}
            >
              {editing ? "Update Accountant" : "Create Accountant"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accountants</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Employee ID</Th>
                  <Th>Login</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {(accountantsQuery.data ?? []).map((accountant) => (
                  <tr key={accountant._id}>
                    <Td>{accountant.user.fullName}</Td>
                    <Td>{accountant.employeeId}</Td>
                    <Td>{accountant.user.email}</Td>
                    <Td>
                      <Badge>{accountant.status}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(accountant);
                            setForm({
                              fullName: accountant.user.fullName,
                              email: accountant.user.email,
                              phone: accountant.user.phone ?? "",
                              employeeId: accountant.employeeId,
                              gender: accountant.gender,
                              address: accountant.address,
                              joinedDateBs: accountant.joinedDateBs,
                              status: accountant.status,
                              photoUrl: accountant.photoUrl ?? ""
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={accountant.status !== "ACTIVE" || resendCredentials.isPending}
                          onClick={() => void resendCredentials.mutateAsync(accountant.user._id)}
                        >
                          Resend Credentials
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void deactivateAccountant.mutateAsync(accountant._id)}>
                          Deactivate
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};