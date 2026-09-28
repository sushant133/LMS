import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEPARTMENT_ACCOUNT_DESCRIPTIONS,
  DEPARTMENT_ACCOUNT_LABELS,
  DEPARTMENT_ACCOUNT_TYPES,
  departmentAccountSchema,
  departmentAccountUpdateSchema,
  type DepartmentAccountRecord,
  type DepartmentAccountType,
} from "@phit-erp/shared";
import { Building2, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const QUERY_KEY = ["department-accounts"];

const DEPARTMENT_BADGE_CLASS: Record<DepartmentAccountType, string> = {
  ACCOUNTING: "bg-emerald-100 text-emerald-800",
  EXAMINATION: "bg-amber-100 text-amber-800",
  ACADEMICS: "bg-sky-100 text-sky-800",
};

interface CreateForm {
  departmentType: DepartmentAccountType;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

const emptyCreateForm = (departmentType: DepartmentAccountType = "ACCOUNTING"): CreateForm => ({
  departmentType,
  fullName: `${DEPARTMENT_ACCOUNT_LABELS[departmentType]} Department`,
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
});

/**
 * Settings → Department Accounts.
 * One shared login per department (Accounting / Examination / Academics).
 * Not linked to staff and no Module Access — the department decides the access.
 */
export const DepartmentAccountsPanel = () => {
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm());
  const [editing, setEditing] = useState<DepartmentAccountRecord | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", phone: "" });
  const [passwordFor, setPasswordFor] = useState<DepartmentAccountRecord | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirmPassword: "" });

  const accountsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => unwrap<DepartmentAccountRecord[]>(api.get("/department-accounts")),
  });
  const accounts = accountsQuery.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: (payload: unknown) =>
      unwrap<DepartmentAccountRecord>(api.post("/department-accounts", payload)),
    onSuccess: async (record) => {
      toast.success(`${record.departmentLabel} account created. Login ID: ${record.email}`);
      setCreateForm(emptyCreateForm(createForm.departmentType));
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
      unwrap<DepartmentAccountRecord>(api.put(`/department-accounts/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Account updated");
      setEditing(null);
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const passwordMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
      unwrap<DepartmentAccountRecord>(api.post(`/department-accounts/${id}/password`, payload)),
    onSuccess: async (record) => {
      toast.success(`Password changed for ${record.email}`);
      setPasswordFor(null);
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" | "delete" }) =>
      action === "delete"
        ? unwrap<DepartmentAccountRecord>(api.delete(`/department-accounts/${id}`))
        : unwrap<DepartmentAccountRecord>(api.post(`/department-accounts/${id}/${action}`)),
    onSuccess: async (_record, variables) => {
      toast.success(
        variables.action === "delete"
          ? "Account deleted"
          : variables.action === "activate"
            ? "Account activated"
            : "Account deactivated",
      );
      if (editing?._id === variables.id) setEditing(null);
      if (passwordFor?._id === variables.id) setPasswordFor(null);
      await refresh();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitCreate = () => {
    if (createForm.password !== createForm.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    const parsed = departmentAccountSchema.safeParse({
      departmentType: createForm.departmentType,
      fullName: createForm.fullName,
      email: createForm.email,
      phone: createForm.phone,
      password: createForm.password,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    void createMutation.mutateAsync(parsed.data);
  };

  const startEdit = (account: DepartmentAccountRecord) => {
    setPasswordFor(null);
    setEditing(account);
    setEditForm({
      fullName: account.fullName,
      email: account.email,
      phone: account.phone ?? "",
    });
  };

  const submitEdit = () => {
    if (!editing) return;
    const parsed = departmentAccountUpdateSchema.safeParse(editForm);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    void updateMutation.mutateAsync({ id: editing._id, payload: parsed.data });
  };

  const startPasswordChange = (account: DepartmentAccountRecord) => {
    setEditing(null);
    setPasswordFor(account);
    setPasswordForm({ password: "", confirmPassword: "" });
  };

  const submitPassword = () => {
    if (!passwordFor) return;
    if (passwordForm.password.trim().length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    void passwordMutation.mutateAsync({
      id: passwordFor._id,
      payload: { password: passwordForm.password },
    });
  };

  const countFor = (type: DepartmentAccountType) =>
    accounts.filter((account) => account.departmentType === type).length;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-700" />
          Department Accounts
        </CardTitle>
        <p className="text-sm text-slate-600">
          Create separate logins for each department. Each account signs in with its
          email as the login ID and sees only its own department. These accounts are
          not linked to any staff member and need no Module Access setup.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          {DEPARTMENT_ACCOUNT_TYPES.map((type) => (
            <div key={type} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge className={DEPARTMENT_BADGE_CLASS[type]}>
                  {DEPARTMENT_ACCOUNT_LABELS[type]}
                </Badge>
                <span className="text-xs text-slate-500">
                  {countFor(type)} account{countFor(type) === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {DEPARTMENT_ACCOUNT_DESCRIPTIONS[type]}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">Create account</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Department">
              <Select
                value={createForm.departmentType}
                onChange={(event) => {
                  const next = event.target.value as DepartmentAccountType;
                  setCreateForm((current) => ({
                    ...current,
                    departmentType: next,
                    // Keep a custom name; otherwise follow the department
                    fullName:
                      current.fullName ===
                      `${DEPARTMENT_ACCOUNT_LABELS[current.departmentType]} Department`
                        ? `${DEPARTMENT_ACCOUNT_LABELS[next]} Department`
                        : current.fullName,
                  }));
                }}
              >
                {DEPARTMENT_ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DEPARTMENT_ACCOUNT_LABELS[type]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Account Name">
              <Input
                value={createForm.fullName}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, fullName: event.target.value }))
                }
              />
            </FormField>
            <FormField label="Email (Login ID)">
              <Input
                type="email"
                autoComplete="off"
                value={createForm.email}
                placeholder="accounts@college.edu.np"
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </FormField>
            <FormField label="Phone (optional)">
              <Input
                value={createForm.phone}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </FormField>
            <FormField label="Password">
              <Input
                type="password"
                autoComplete="new-password"
                value={createForm.password}
                placeholder="Minimum 6 characters"
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </FormField>
            <FormField label="Confirm Password">
              <Input
                type="password"
                autoComplete="new-password"
                value={createForm.confirmPassword}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    confirmPassword: event.target.value,
                  }))
                }
              />
            </FormField>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" disabled={createMutation.isPending} onClick={submitCreate}>
              {createMutation.isPending ? "Creating..." : "Create Account"}
            </Button>
          </div>
        </div>

        {accountsQuery.isLoading ? (
          <LoadingState />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="No department accounts yet"
            description="Create an Accounting, Examination Management, or Academics account above."
          />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <Th>Department</Th>
                <Th>Account Name</Th>
                <Th>Login ID (Email)</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {accounts.map((account) => (
                <tr key={account._id}>
                  <Td>
                    <Badge className={DEPARTMENT_BADGE_CLASS[account.departmentType]}>
                      {account.departmentLabel}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="font-medium text-slate-900">{account.fullName}</div>
                    {account.phone ? (
                      <div className="text-xs text-slate-500">{account.phone}</div>
                    ) : null}
                  </Td>
                  <Td className="break-all">{account.email}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        className={
                          account.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-700"
                        }
                      >
                        {account.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(account)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startPasswordChange(account)}
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" />
                        Change Password
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionMutation.isPending}
                        onClick={() =>
                          void actionMutation.mutateAsync({
                            id: account._id,
                            action: account.isActive ? "deactivate" : "activate",
                          })
                        }
                      >
                        {account.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={actionMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${account.fullName} (${account.email})? The login will stop working.`,
                            )
                          ) {
                            void actionMutation.mutateAsync({
                              id: account._id,
                              action: "delete",
                            });
                          }
                        }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        )}

        {editing ? (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Edit {editing.departmentLabel} account
              </h3>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="Account Name">
                <Input
                  value={editForm.fullName}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Email (Login ID)">
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Phone (optional)">
                <Input
                  value={editForm.phone}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </FormField>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" disabled={updateMutation.isPending} onClick={submitEdit}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        ) : null}

        {passwordFor ? (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Change password — {passwordFor.fullName} ({passwordFor.email})
              </h3>
              <Button size="sm" variant="outline" onClick={() => setPasswordFor(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="New Password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.password}
                  placeholder="Minimum 6 characters"
                  onChange={(event) =>
                    setPasswordForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Confirm New Password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" disabled={passwordMutation.isPending} onClick={submitPassword}>
                {passwordMutation.isPending ? "Saving..." : "Change Password"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
