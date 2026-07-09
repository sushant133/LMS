import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  adminAccountSchema,
  type AdminAccountInput,
  type AdminAccountRecord,
  type AdminActivityLogEntry,
} from "@phit-erp/shared";
import { KeyRound, LogIn, Shield, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import {
  toastAdminCredentialsUpdated,
  toastCredentialCreateResult,
  toastResendCredentials,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultForm: AdminAccountInput = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
};

type AdminCredentialUpdateResult = {
  admin: AdminAccountRecord;
  loginEmail?: string;
  defaultPassword?: string;
  credentialsEmail?: CredentialsEmailResult;
};

const statusBadge = (admin: AdminAccountRecord) => {
  if (admin.isDeleted) {
    return <Badge className="bg-slate-200 text-slate-700">Deleted</Badge>;
  }
  if (!admin.isActive) {
    return (
      <Badge className="bg-amber-100 text-amber-800">Inactive / Locked</Badge>
    );
  }
  return <Badge className="bg-brand-100 text-brand-800">Active</Badge>;
};

export const AdminManagementManager = () => {
  const [form, setForm] = useState<AdminAccountInput>(defaultForm);
  const [editing, setEditing] = useState<AdminAccountRecord | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [credentialLoginId, setCredentialLoginId] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");

  const adminsQuery = useQuery({
    queryKey: ["admins", includeDeleted],
    queryFn: () =>
      unwrap<AdminAccountRecord[]>(
        api.get("/admins", { params: { includeDeleted } }),
      ),
  });

  const activityQuery = useQuery({
    queryKey: ["admins", selectedAdminId, "activity"],
    queryFn: () =>
      unwrap<AdminActivityLogEntry[]>(
        api.get(`/admins/${selectedAdminId}/activity`),
      ),
    enabled: Boolean(selectedAdminId),
  });

  const invalidateAdmins = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admins"] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: AdminAccountInput) =>
      unwrap<{
        admin: AdminAccountRecord;
        loginEmail: string;
        defaultPassword: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post("/admins", payload)),
    onSuccess: async (data) => {
      toastCredentialCreateResult(data, {
        successTitle: "Administrator created successfully",
      });
      setForm(defaultForm);
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resendCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => toastResendCredentials(userId),
    onSuccess: async () => {
      await invalidateAdmins();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: AdminAccountInput;
    }) => unwrap<AdminCredentialUpdateResult>(api.put(`/admins/${id}`, payload)),
    onSuccess: async (data) => {
      if (data.credentialsEmail) {
        toastAdminCredentialsUpdated(data, {
          successTitle: "Administrator updated",
        });
      } else {
        toast.success("Administrator updated");
      }
      setEditing(null);
      setForm(defaultForm);
      setCredentialLoginId(data.admin?.email ?? "");
      setCredentialPassword("");
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      if (action === "delete") {
        return unwrap<AdminAccountRecord>(api.delete(`/admins/${id}`));
      }
      return unwrap<AdminAccountRecord>(api.post(`/admins/${id}/${action}`));
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        `Administrator ${variables.action.replace("-", " ")} successful`,
      );
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const updateCredentialsMutation = useMutation({
    mutationFn: async ({
      id,
      email,
      password,
    }: {
      id: string;
      email: string;
      password?: string;
    }) =>
      unwrap<AdminCredentialUpdateResult>(
        api.put(`/admins/${id}`, {
          email,
          ...(password ? { password } : {}),
        }),
      ),
    onSuccess: async (data) => {
      toastAdminCredentialsUpdated(data, {
        successTitle: "Admin login credentials updated",
      });
      setCredentialPassword("");
      if (data.admin?.email) {
        setCredentialLoginId(data.admin.email);
      }
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) =>
      unwrap<AdminCredentialUpdateResult>(
        api.post(`/admins/${id}/reset-password`, {
          password,
          mustChangePassword: true,
        }),
      ),
    onSuccess: async (data) => {
      toastAdminCredentialsUpdated(data, {
        successTitle: "Administrator password reset",
      });
      setCredentialPassword("");
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrap<{ redirectTo: string }>(api.post(`/admins/${id}/impersonate`)),
    onSuccess: async (data) => {
      toast.success("Impersonation started");
      window.location.href = data.redirectTo ?? "/dashboard/college_admin";
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const selectedAdmin = useMemo(
    () =>
      (adminsQuery.data ?? []).find((admin) => admin._id === selectedAdminId) ??
      null,
    [adminsQuery.data, selectedAdminId],
  );

  const openCredentialsPanel = (admin: AdminAccountRecord) => {
    setSelectedAdminId(admin._id);
    setCredentialLoginId(admin.email);
    setCredentialPassword("");
  };

  if (adminsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Users"
        description="As Super Admin, create and manage Administrators, change their login ID and password, and email them the new credentials automatically."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-brand-700" />
            {editing ? "Edit Administrator" : "Create Administrator"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = adminAccountSchema.safeParse(form);
              if (!parsed.success) {
                toast.error(
                  parsed.error.issues[0]?.message ?? "Validation failed",
                );
                return;
              }

              if (editing) {
                void updateMutation.mutateAsync({
                  id: editing._id,
                  payload: parsed.data,
                });
                return;
              }

              void createMutation.mutateAsync(parsed.data);
            }}
          >
            <FormField label="Full Name">
              <Input
                value={form.fullName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fullName: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Login ID (Email or Username)">
              <Input
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Phone">
              <Input
                value={form.phone ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField
              label={
                editing
                  ? "New Password (optional — emailed if changed)"
                  : "Initial Password (optional)"
              }
            >
              <Input
                type="password"
                value={form.password ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder={
                  editing
                    ? "Leave blank to keep current password"
                    : "Uses system default if blank"
                }
              />
            </FormField>
            {editing ? (
              <p className="md:col-span-2 text-xs text-slate-500">
                Changing Login ID or password emails the Administrator their
                updated credentials. Use &quot;Login &amp; Password&quot; on a
                row for a dedicated credentials update panel.
              </p>
            ) : null}
            <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setForm(defaultForm);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editing
                  ? updateMutation.isPending
                    ? "Saving..."
                    : "Save Changes"
                  : createMutation.isPending
                    ? "Creating..."
                    : "Create Administrator"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-brand-700" />
            Administrators
          </CardTitle>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => setIncludeDeleted(event.target.checked)}
            />
            Show deleted accounts
          </label>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(adminsQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="No administrators found"
              description="Create the first Administrator account for PHIT."
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Login ID</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                  <Th>Role</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(adminsQuery.data ?? []).map((admin) => (
                  <tr key={admin._id}>
                    <Td>
                      <div className="font-medium text-slate-900">
                        {admin.fullName}
                      </div>
                      {admin.mustChangePassword ? (
                        <div className="text-xs text-amber-700">
                          Must change password
                        </div>
                      ) : null}
                    </Td>
                    <Td>{admin.email}</Td>
                    <Td>{admin.phone || "—"}</Td>
                    <Td>{statusBadge(admin)}</Td>
                    <Td>Administrator</Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={admin.isDeleted}
                          onClick={() => {
                            setEditing(admin);
                            setForm({
                              fullName: admin.fullName,
                              email: admin.email,
                              phone: admin.phone ?? "",
                              password: "",
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={admin.isDeleted}
                          onClick={() => openCredentialsPanel(admin)}
                        >
                          <KeyRound className="mr-1 h-3.5 w-3.5" />
                          Login & Password
                        </Button>
                        {admin.isActive && !admin.isDeleted ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() =>
                                void actionMutation.mutateAsync({
                                  id: admin._id,
                                  action: "deactivate",
                                })
                              }
                            >
                              Deactivate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() =>
                                void actionMutation.mutateAsync({
                                  id: admin._id,
                                  action: "lock",
                                })
                              }
                            >
                              Lock
                            </Button>
                          </>
                        ) : !admin.isDeleted ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() =>
                                void actionMutation.mutateAsync({
                                  id: admin._id,
                                  action: "activate",
                                })
                              }
                            >
                              Activate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() =>
                                void actionMutation.mutateAsync({
                                  id: admin._id,
                                  action: "unlock",
                                })
                              }
                            >
                              Unlock
                            </Button>
                          </>
                        ) : null}
                        {admin.isDeleted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionMutation.isPending}
                            onClick={() =>
                              void actionMutation.mutateAsync({
                                id: admin._id,
                                action: "restore",
                              })
                            }
                          >
                            Restore
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                impersonateMutation.isPending || !admin.isActive
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Login as ${admin.fullName} for troubleshooting?`,
                                  )
                                ) {
                                  void impersonateMutation.mutateAsync(
                                    admin._id,
                                  );
                                }
                              }}
                            >
                              <LogIn className="mr-1 h-3.5 w-3.5" />
                              Login As
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={actionMutation.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${admin.fullName}? This is a soft delete and preserves audit history.`,
                                  )
                                ) {
                                  void actionMutation.mutateAsync({
                                    id: admin._id,
                                    action: "delete",
                                  });
                                }
                              }}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedAdmin ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-brand-700" />
              {selectedAdmin.fullName} — Login Credentials & Activity
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedAdminId(null);
                setCredentialPassword("");
              }}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
              <h3 className="text-sm font-semibold text-brand-900">
                Change Administrator Login ID & Password
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Super Admin can update the Administrator login ID and/or
                password. When either is changed, an email is sent to the
                Administrator with the new login details.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <FormField label="Admin Login ID (Email or Username)">
                  <Input
                    value={credentialLoginId}
                    onChange={(event) =>
                      setCredentialLoginId(event.target.value)
                    }
                    placeholder="admin@college.edu or admin.login"
                    disabled={selectedAdmin.isDeleted}
                  />
                </FormField>
                <FormField label="New Password (optional)">
                  <Input
                    type="password"
                    value={credentialPassword}
                    onChange={(event) =>
                      setCredentialPassword(event.target.value)
                    }
                    placeholder="Min 6 characters — leave blank to keep current"
                    disabled={selectedAdmin.isDeleted}
                  />
                </FormField>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  disabled={
                    updateCredentialsMutation.isPending ||
                    selectedAdmin.isDeleted ||
                    !credentialLoginId.trim() ||
                    (credentialLoginId.trim().toLowerCase() ===
                      selectedAdmin.email.toLowerCase() &&
                      !credentialPassword)
                  }
                  onClick={() => {
                    if (
                      credentialPassword &&
                      credentialPassword.trim().length < 6
                    ) {
                      toast.error("Password must be at least 6 characters");
                      return;
                    }
                    if (
                      !window.confirm(
                        `Update login credentials for ${selectedAdmin.fullName} and email the new details to ${credentialLoginId.trim()}?`,
                      )
                    ) {
                      return;
                    }
                    void updateCredentialsMutation.mutateAsync({
                      id: selectedAdmin._id,
                      email: credentialLoginId.trim(),
                      password: credentialPassword.trim() || undefined,
                    });
                  }}
                >
                  {updateCredentialsMutation.isPending
                    ? "Updating..."
                    : "Update Login & Email Admin"}
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    resetPasswordMutation.isPending ||
                    selectedAdmin.isDeleted ||
                    credentialPassword.trim().length < 6
                  }
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Reset password for ${selectedAdmin.fullName} and email the new password to ${selectedAdmin.email}?`,
                      )
                    ) {
                      return;
                    }
                    void resetPasswordMutation.mutateAsync({
                      id: selectedAdmin._id,
                      password: credentialPassword.trim(),
                    });
                  }}
                >
                  {resetPasswordMutation.isPending
                    ? "Resetting..."
                    : "Reset Password Only & Email"}
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    resendCredentialsMutation.isPending ||
                    selectedAdmin.isDeleted ||
                    !selectedAdmin.isActive
                  }
                  onClick={() =>
                    void resendCredentialsMutation.mutateAsync(
                      selectedAdmin._id,
                    )
                  }
                >
                  Generate New Password & Resend Email
                </Button>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">
                Activity Logs
              </h3>
              {activityQuery.isLoading ? (
                <LoadingState />
              ) : (activityQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">
                  No activity recorded for this administrator yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {(activityQuery.data ?? []).map((entry) => (
                    <div
                      key={entry._id}
                      className="rounded-xl border border-slate-200 px-4 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">
                          {entry.action}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600">
                        {entry.entity} · {entry.entityId}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
