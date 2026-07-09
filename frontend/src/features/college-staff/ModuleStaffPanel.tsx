import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  moduleStaffSchema,
  type ModuleStaffInput,
  type UserProfile,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { api, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  toastResendCredentials,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultStaff: ModuleStaffInput = {
  fullName: "",
  email: "",
  phone: "",
};

interface ModuleStaffPanelProps {
  title: string;
  apiBase: "/library/staff" | "/laboratory/staff";
  queryKey: string;
}

export const ModuleStaffPanel = ({
  title,
  apiBase,
  queryKey,
}: ModuleStaffPanelProps) => {
  const canManage = useIsTenantAdmin();
  const [form, setForm] = useState<ModuleStaffInput>(defaultStaff);

  const staffQuery = useQuery({
    queryKey: [queryKey],
    queryFn: () => unwrap<UserProfile[]>(api.get(apiBase)),
  });

  const createStaff = useMutation({
    mutationFn: (payload: ModuleStaffInput) =>
      unwrap<{
        staff?: UserProfile;
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: CredentialsEmailResult;
      }>(api.post(apiBase, payload)),
    onSuccess: async (data) => {
      toastCredentialCreateResult(data ?? {}, {
        successTitle: `${title} created successfully`,
      });
      setForm(defaultStaff);
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deactivateStaff = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`${apiBase}/${id}`)),
    onSuccess: async () => {
      toast.success(`${title} deactivated`);
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resendCredentials = useMutation({
    mutationFn: (userId: string) => toastResendCredentials(userId),
  });

  if (staffQuery.isLoading) {
    return (
      <EmptyState
        title={`Loading ${title.toLowerCase()}`}
        description="Please wait."
      />
    );
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Create {title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
            <FormField label="Login Email">
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
            <Button
              onClick={() => {
                const parsed = moduleStaffSchema.safeParse(form);
                if (!parsed.success) {
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Invalid staff details",
                  );
                  return;
                }
                void createStaff.mutateAsync(parsed.data);
              }}
            >
              Create {title}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {(staffQuery.data ?? []).length === 0 ? (
            <EmptyState
              title={`No ${title.toLowerCase()} yet`}
              description={`Create ${title.toLowerCase()} accounts with portal login credentials.`}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(staffQuery.data ?? []).map((member) => (
                    <tr key={member._id}>
                      <Td>{member.fullName}</Td>
                      <Td>{member.email}</Td>
                      <Td>{member.phone ?? "—"}</Td>
                      <Td>{member.isActive ? "Active" : "Inactive"}</Td>
                      <Td className="space-x-2 text-right">
                        {canManage ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !member.isActive || resendCredentials.isPending
                              }
                              onClick={() =>
                                void resendCredentials.mutateAsync(member._id)
                              }
                            >
                              Resend Credentials
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deactivateStaff.isPending}
                              onClick={() =>
                                void deactivateStaff.mutateAsync(member._id)
                              }
                            >
                              Deactivate
                            </Button>
                          </>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
