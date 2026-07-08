import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  collegeAdministratorSchema,
  type CollegeAdministratorInput,
  type CollegeAdministratorRecord
} from "@phit-erp/shared";
import type { AdminActivityLogEntry } from "@phit-erp/shared";
import { Eye, KeyRound, Trash2, UserCog } from "lucide-react";
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
  toastCredentialCreateResult,
  toastResendCredentials,
  type CredentialsEmailResult
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultForm: CollegeAdministratorInput = {
  fullName: "",
  employeeId: "",
  designation: "",
  department: "",
  phone: "",
  email: "",
  password: "",
  profilePhotoUrl: ""
};

const statusBadge = (admin: CollegeAdministratorRecord) => {
  if (admin.isDeleted) {
    return <Badge className="bg-slate-200 text-slate-700">Deleted</Badge>;
  }
  if (!admin.isActive) {
    return <Badge className="bg-amber-100 text-amber-800">Inactive</Badge>;
  }
  return <Badge className="bg-brand-100 text-brand-800">Active</Badge>;
};

export const CollegeAdministratorManager = () => {
  const [form, setForm] = useState<CollegeAdministratorInput>(defaultForm);
  const [editing, setEditing] = useState<CollegeAdministratorRecord | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const adminsQuery = useQuery({
    queryKey: ["college-administrators", includeDeleted],
    queryFn: () =>
      unwrap<CollegeAdministratorRecord[]>(api.get("/college-administrators", { params: { includeDeleted } }))
  });

  const activityQuery = useQuery({
    queryKey: ["college-administrators", selectedAdminId, "activity"],
    queryFn: () =>
      unwrap<AdminActivityLogEntry[]>(api.get(`/college-administrators/${selectedAdminId}/activity`)),
    enabled: Boolean(selectedAdminId)
  });

  const invalidateAdmins = async () => {
    await queryClient.invalidateQueries({ queryKey: ["college-administrators"] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: CollegeAdministratorInput) =>
      unwrap<{
        admin: CollegeAdministratorRecord;
        loginEmail: string;
        defaultPassword: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post("/college-administrators", payload)),
    onSuccess: async (data) => {
      toastCredentialCreateResult(data, { successTitle: "College Administrator created successfully" });
      setForm(defaultForm);
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const resendCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => toastResendCredentials(userId),
    onSuccess: async () => {
      await invalidateAdmins();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: CollegeAdministratorInput }) =>
      unwrap<CollegeAdministratorRecord>(api.put(`/college-administrators/${id}`, payload)),
    onSuccess: async () => {
      toast.success("College Administrator updated");
      setEditing(null);
      setForm(defaultForm);
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      if (action === "delete") {
        return unwrap<CollegeAdministratorRecord>(api.delete(`/college-administrators/${id}`));
      }
      return unwrap<CollegeAdministratorRecord>(api.post(`/college-administrators/${id}/${action}`));
    },
    onSuccess: async (_data, variables) => {
      toast.success(`College Administrator ${variables.action.replace("-", " ")} successful`);
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) =>
      unwrap<{ admin: CollegeAdministratorRecord; loginEmail: string }>(
        api.post(`/college-administrators/${id}/reset-password`, { password })
      ),
    onSuccess: async (data) => {
      toast.success("Password reset", { description: `Login ID: ${data.loginEmail}` });
      setResetPassword("");
      setSelectedAdminId(null);
      await invalidateAdmins();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const selectedAdmin = useMemo(
    () => (adminsQuery.data ?? []).find((admin) => admin._id === selectedAdminId) ?? null,
    [adminsQuery.data, selectedAdminId]
  );

  if (adminsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="College Administrators"
        description="Create and manage read-only College Administrator accounts with full LMS visibility and no data modification privileges."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-brand-700" />
            {editing ? "Edit College Administrator" : "Create College Administrator"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = collegeAdministratorSchema.safeParse(form);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                return;
              }

              if (editing) {
                void updateMutation.mutateAsync({ id: editing._id, payload: parsed.data });
                return;
              }

              void createMutation.mutateAsync(parsed.data);
            }}
          >
            <FormField label="Full Name">
              <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
            </FormField>
            <FormField label="Employee ID">
              <Input value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))} />
            </FormField>
            <FormField label="Designation">
              <Input value={form.designation} onChange={(event) => setForm((current) => ({ ...current, designation: event.target.value }))} />
            </FormField>
            <FormField label="Department">
              <Input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
            </FormField>
            <FormField label="Mobile Number">
              <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </FormField>
            <FormField label="Email Address / Username">
              <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </FormField>
            <FormField label="Profile Photo URL">
              <Input
                value={form.profilePhotoUrl ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, profilePhotoUrl: event.target.value }))}
                placeholder="https://..."
              />
            </FormField>
            <FormField label={editing ? "New Password (optional)" : "Initial Password (optional)"}>
              <Input
                type="password"
                value={form.password ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={editing ? "Leave blank to keep current password" : "Uses system default if blank"}
              />
            </FormField>
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
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editing
                  ? updateMutation.isPending
                    ? "Saving..."
                    : "Save Changes"
                  : createMutation.isPending
                    ? "Creating..."
                    : "Create College Administrator"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-brand-700" />
            College Administrators
          </CardTitle>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} />
            Show deleted accounts
          </label>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(adminsQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="No College Administrators found"
              description="Create the first read-only College Administrator account for monitoring and auditing."
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Employee ID</Th>
                  <Th>Designation</Th>
                  <Th>Department</Th>
                  <Th>Login ID</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(adminsQuery.data ?? []).map((admin) => (
                  <tr key={admin._id}>
                    <Td>
                      <div className="font-medium text-slate-900">{admin.fullName}</div>
                      {admin.mustChangePassword ? <div className="text-xs text-amber-700">Must change password</div> : null}
                    </Td>
                    <Td>{admin.employeeId || "—"}</Td>
                    <Td>{admin.designation || "—"}</Td>
                    <Td>{admin.department || "—"}</Td>
                    <Td>{admin.email}</Td>
                    <Td>{statusBadge(admin)}</Td>
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
                              employeeId: admin.employeeId ?? "",
                              designation: admin.designation ?? "",
                              department: admin.department ?? "",
                              phone: admin.phone ?? "",
                              email: admin.email,
                              password: "",
                              profilePhotoUrl: admin.profilePhotoUrl ?? ""
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" disabled={admin.isDeleted} onClick={() => setSelectedAdminId(admin._id)}>
                          Activity
                        </Button>
                        {admin.isActive && !admin.isDeleted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionMutation.isPending}
                            onClick={() => void actionMutation.mutateAsync({ id: admin._id, action: "deactivate" })}
                          >
                            Deactivate
                          </Button>
                        ) : !admin.isDeleted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionMutation.isPending}
                            onClick={() => void actionMutation.mutateAsync({ id: admin._id, action: "activate" })}
                          >
                            Activate
                          </Button>
                        ) : null}
                        {admin.isDeleted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionMutation.isPending}
                            onClick={() => void actionMutation.mutateAsync({ id: admin._id, action: "restore" })}
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={actionMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete ${admin.fullName}? This is a soft delete and preserves audit history.`)) {
                                void actionMutation.mutateAsync({ id: admin._id, action: "delete" });
                              }
                            }}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Delete
                          </Button>
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
              {selectedAdmin.fullName} — Credentials & Activity
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setSelectedAdminId(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
              <FormField label="Reset Password">
                <Input
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  placeholder="Enter a new password (min 6 characters)"
                />
              </FormField>
              <Button
                disabled={resetPasswordMutation.isPending || resetPassword.length < 6 || selectedAdmin.isDeleted}
                onClick={() => void resetPasswordMutation.mutateAsync({ id: selectedAdmin._id, password: resetPassword })}
              >
                Reset Password
              </Button>
              <Button
                variant="outline"
                disabled={resendCredentialsMutation.isPending || selectedAdmin.isDeleted || !selectedAdmin.isActive}
                onClick={() => void resendCredentialsMutation.mutateAsync(selectedAdmin._id)}
              >
                Resend Credentials
              </Button>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">Login History & Activity</h3>
              {activityQuery.isLoading ? (
                <LoadingState />
              ) : (activityQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">No activity recorded for this College Administrator yet.</p>
              ) : (
                <div className="space-y-3">
                  {(activityQuery.data ?? []).map((entry) => (
                    <div key={entry._id} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{entry.action}</span>
                        <span className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
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